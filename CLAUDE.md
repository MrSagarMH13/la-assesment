# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI-powered timetable extraction system that processes teacher timetables from images, PDFs, and DOCX files using a hybrid AI approach (Google Document AI + Claude 3.5 Sonnet) with asynchronous processing via AWS SQS.

## Common Commands

### Development
```bash
# Install dependencies
npm install

# Generate Prisma client
npm run prisma:generate

# Push database schema (development)
npm run prisma:push

# Run migrations (production)
npm run prisma:migrate

# Start API server (development mode with auto-reload)
npm run dev

# Start worker (development mode with auto-reload)
npm run dev:worker

# Start both API and worker concurrently
npm run start:all

# Build for production
npm run build

# Start production API server
npm start

# Start production worker
npm run worker
```

### Docker & Infrastructure
```bash
# Start all services (PostgreSQL, Redis, LocalStack)
docker-compose up -d

# Setup LocalStack (S3 buckets, SQS queues)
./setup-localstack.sh

# Stop all services
docker-compose down

# View logs
docker-compose logs -f
```

### Testing
```bash
# Manual test upload
./test-upload.sh

# Test V2 async endpoint
curl -X POST http://localhost:3000/api/v2/timetable/upload \
  -F "file=@/path/to/timetable.png" \
  -F "teacherName=Miss Smith" \
  -F "className=Year 2"

# Check job status
curl http://localhost:3000/api/v2/timetable/jobs/{jobId}
```

## Architecture

### System Components

**Two-Tier Architecture:**
- **API Server** (`src/index.ts`): Express.js REST API that handles file uploads, enqueues jobs to SQS, and provides job status endpoints
- **Worker Process** (`src/worker.ts`): Background worker that polls SQS, processes extraction jobs using hybrid AI, and stores results in PostgreSQL

**Async Processing Flow:**
```
Client → API → S3 Upload → SQS Enqueue → Return Job ID
                                ↓
                         Worker Polls SQS
                                ↓
                    Complexity Analyzer (simple/medium/complex)
                          /     |     \
                   Doc AI   Hybrid   Claude
                          \     |     /
                                ↓
                   Save to PostgreSQL + S3
                                ↓
                        Trigger Webhooks
```

### Key Service Architecture

**Extraction Orchestrator** (`src/services/extractionOrchestrator.ts`):
- Coordinates the entire extraction pipeline
- Routes jobs to appropriate extraction method based on complexity
- Implements fallback logic (Document AI → Claude fallback on failure)

**Complexity Analyzer** (`src/services/complexityAnalyzer.ts`):
- Analyzes uploaded files to determine extraction complexity
- Returns: `simple` (clean typed), `medium` (standard scan), `complex` (handwritten/poor quality)
- Routes to optimal extraction method for cost/accuracy balance

**Intelligent Routing:**
- Simple files → Google Document AI (fast, cheap, 90-95% accuracy)
- Medium files → Document AI + Claude validation (hybrid mode, 97-99% accuracy)
- Complex files → Claude Vision (slower, more expensive, 95-98% accuracy)
- All failures fall back to Claude as last resort

### Database Schema

**ExtractionJob**: Tracks async processing jobs (status, retry count, processing method)
**Timetable**: Stores extracted timetable metadata (teacher, class, term, week)
**TimeBlock**: Individual scheduled events (day-specific, start/end times)
**RecurringBlock**: Daily recurring events (registration, lunch, break)
**Webhook**: Registered webhooks for job completion notifications
**RetryLog**: Error tracking for failed extraction attempts

Note: Prisma client is generated to `src/generated/prisma` (not `node_modules/.prisma`)

### API Versioning

- **V1 API** (`/api/timetable/*`): Legacy synchronous extraction (blocks until complete)
- **V2 API** (`/api/v2/timetable/*`): Production async extraction with SQS (recommended)

Always use V2 for new features. V1 is maintained for backward compatibility only.

## AI/LLM Integration

### Primary Model
Claude 3.5 Sonnet (`claude-3-5-sonnet-20241022`) via `@anthropic-ai/sdk`

**Service Location**: `src/services/claudeService.ts`

### Multi-Modal Extraction Strategy

The system sends both image and OCR text to Claude for maximum accuracy:

1. Image is processed by Sharp and converted to base64 PNG
2. Tesseract.js performs OCR to extract raw text
3. Both are sent to Claude vision model in a single API call
4. Claude analyzes visual structure AND validates with OCR text
5. Returns structured JSON matching Zod schema in `src/types/timetable.ts`

**Why multi-modal**: Visual layout detection + text validation = highest accuracy (97-99%)

### Prompt Engineering

The system prompt is defined in `claudeService.ts` and includes:
- Role definition (expert timetable extraction assistant)
- 7 core extraction rules (time accuracy, recurring detection, implicit durations, etc.)
- Edge case handling (merged cells, missing times, ambiguous structure)
- Exact JSON schema specification
- Temperature = 0 for deterministic output

**Critical Rule**: Always extract exact times. If implicit, calculate by dividing parent block duration equally across events.

### Hybrid AI Mode

When `USE_HYBRID_MODE=true` (default):
- Document AI extracts text structure (fast, cheap)
- Claude validates and enriches the extraction (accuracy boost)
- Falls back to Claude-only if Document AI fails
- Tracks `processingMethod` in database: `document_ai`, `claude`, or `hybrid`

## File Processing

**Supported Formats**:
- Images: PNG, JPG, JPEG (via Sharp + Tesseract OCR)
- PDFs: Multi-page support (via pdf-parse)
- DOCX: Text extraction (via mammoth)

**Processing Pipeline** (`src/utils/fileProcessor.ts`):
1. File validation (mime type, size < 10MB)
2. Format-specific processing:
   - Images → Sharp resize → PNG buffer → Tesseract OCR
   - PDF → pdf-parse → text extraction
   - DOCX → mammoth → HTML/text extraction
3. Returns `ProcessedFile` with image buffer, OCR text, metadata

**Multer Configuration**: Files uploaded to `/tmp` directory, automatically cleaned up after processing

## Error Handling & Retry Logic

### Worker Retry Mechanism

- Jobs fail → Retry count incremented → Left in SQS queue (visibility timeout makes it reappear)
- Max retries (default 3) → Job marked as `failed` → Sent to Dead Letter Queue (DLQ)
- Each retry logged in `RetryLog` table with error classification

**Error Types** (classified in worker):
- `ocr_error`: Tesseract processing failure
- `document_ai_error`: Google Document AI API failure
- `llm_error`: Claude API failure
- `validation_error`: Zod schema validation failure
- `s3_error`: AWS S3 upload/download failure
- `database_error`: Prisma/PostgreSQL failure

### Fallback Chain

```
Primary: Document AI + Claude Validation (hybrid)
    ↓ (Document AI fails)
Fallback: Claude Vision Only
    ↓ (Claude fails)
Retry with exponential backoff
    ↓ (Max retries exceeded)
Dead Letter Queue + Job marked failed
```

## Environment Variables

**Critical Variables**:
- `DATABASE_URL`: PostgreSQL connection (production) or SQLite file path (dev)
- `ANTHROPIC_API_KEY`: Claude API key (required)
- `GOOGLE_APPLICATION_CREDENTIALS`: Path to GCP service account JSON (for Document AI)
- `AWS_S3_BUCKET`: S3 bucket for file/result storage
- `AWS_SQS_QUEUE_URL`: Main processing queue URL
- `AWS_SQS_DLQ_URL`: Dead letter queue for failed jobs

**Feature Flags**:
- `USE_DOCUMENT_AI=true`: Enable Google Document AI (fast, cheap extraction)
- `USE_CLAUDE_FALLBACK=true`: Fall back to Claude on Document AI failure
- `USE_HYBRID_MODE=true`: Use Document AI + Claude validation for best accuracy

**Worker Tuning**:
- `WORKER_CONCURRENCY=5`: Number of concurrent workers polling SQS
- `MAX_RETRIES=3`: Maximum retry attempts before sending to DLQ

## AWS Configuration

**Region**: `ap-south-1` (Mumbai) - set in environment variables

**Required Services**:
- S3: File storage (uploaded timetables + result JSONs)
- SQS: Job queue (main queue + dead letter queue)
- (Optional) RDS PostgreSQL: Production database

**LocalStack for Development**:
- `setup-localstack.sh` creates S3 buckets and SQS queues locally
- Uses Docker container for AWS service emulation
- No AWS credentials needed for local development

## Code Conventions

### TypeScript Patterns

- All service methods are async and return Promises
- Zod schemas in `src/types/timetable.ts` define validation rules and TypeScript types
- Error handling: try/catch in routes, centralized error handler middleware
- Prisma queries use generated client from `src/generated/prisma`

### Naming Conventions

- Services: `{Domain}Service.ts` (e.g., `s3Service.ts`, `sqsService.ts`)
- Routes: `{resource}.ts` or `{resource}V2.ts` for versioned APIs
- Database models: PascalCase (e.g., `ExtractionJob`, `TimeBlock`)
- API endpoints: kebab-case (e.g., `/api/v2/timetable/upload`)

### Service Instantiation Pattern

Services are instantiated once at worker/server startup:
```typescript
const sqsService = new SQSService();
const s3Service = new S3Service();
const orchestrator = new ExtractionOrchestrator();
```

Shared across all requests/workers (stateless services with no instance state).

## Key Design Decisions

### Why Async Processing?

- Timetable extraction takes 2-10 seconds (OCR + LLM API calls)
- Synchronous API would block and timeout
- SQS queue enables horizontal scaling of workers independent of API servers
- Webhooks notify clients when jobs complete

### Why Hybrid AI?

- Google Document AI: Fast (1-2s), cheap ($0.0015/page), 90-95% accuracy on clean images
- Claude Vision: Slower (2-5s), expensive ($0.015-0.05/image), 95-98% accuracy on complex layouts
- Hybrid: Document AI first, Claude validates → 97-99% accuracy at ~$0.005-0.01 cost
- Intelligent routing based on complexity analysis optimizes cost/accuracy tradeoff

### Why Separate TimeBlock and RecurringBlock?

- RecurringBlocks: Events that occur daily at same time (registration, lunch, break)
- TimeBlocks: Day-specific scheduled events (Math on Monday 9:00, English on Tuesday 10:00)
- Separation enables efficient queries and UI rendering of "fixed" vs "variable" schedule items

### Database Choice

- Development: SQLite (file-based, zero config, `file:./dev.db`)
- Production: PostgreSQL on RDS (ACID guarantees, concurrent workers, horizontal read replicas)
- Prisma ORM abstracts differences → same code works with both

## Troubleshooting

### Worker Not Processing Jobs

1. Check worker is running: `npm run dev:worker`
2. Verify SQS queue URL in `.env` matches queue created by `setup-localstack.sh`
3. Check logs for SQS polling errors (permissions, network)
4. Inspect database: `ExtractionJob` status should transition `pending → processing → completed`

### Claude API Errors

- Rate limit: Reduce `WORKER_CONCURRENCY` to slow down API calls
- Invalid API key: Check `ANTHROPIC_API_KEY` in `.env` (should start with `sk-ant-api03-`)
- Timeout: Increase client timeout in `claudeService.ts` (default 60s)

### Document AI Errors

- Missing credentials: Ensure `GOOGLE_APPLICATION_CREDENTIALS` points to valid service account JSON
- Quota exceeded: Monitor Google Cloud Console quotas (free tier: 1000 pages/month)
- Wrong processor ID: Verify `GOOGLE_PROCESSOR_ID` matches processor created in GCP console

### Database Migration Issues

- Run `npm run prisma:generate` after schema changes to regenerate client
- Use `npm run prisma:push` for dev (direct schema sync)
- Use `npm run prisma:migrate` for production (versioned migrations)
- Check `DATABASE_URL` format: PostgreSQL vs SQLite connection strings differ

### Build Errors

**TypeScript compile errors:**
- Always run `npm run prisma:generate` before building to ensure Prisma client is up to date
- If you see "Cannot find module '@aws-sdk/s3-request-presigner'", it's commented out by design (optional dependency for signed URLs)
- If you see "This expression is not callable" for pdf-parse, ensure it's imported using `require()` not `import`

**Docker build issues:**
- Ensure Dockerfile runs `npx prisma generate` before `npm run build`
- Build may fail if node_modules from different architectures (Mac vs Linux) - use multi-stage build

## Testing Approach

### Manual Testing

Use provided test timetables in repository root:
- `Teacher Timetable Example 1.2.png` - Standard weekly grid
- `Teacher Timetable Example 3.png` - Daily schedule format
- `Teacher Timetable Example 4.jpeg` - Simple layout

Upload via `test-upload.sh` script or curl commands in "Common Commands" section.

### Verification Steps

1. Upload file → Receive `jobId`
2. Poll `/api/v2/timetable/jobs/{jobId}` → Status should transition to `completed`
3. Check response contains `timetable` object with `blocks` and `recurringBlocks`
4. Verify extracted times match visual timetable
5. Confirm `confidence` scores are reasonable (>0.7 for clean images)

### Monitoring Extraction Quality

Query database to analyze extraction accuracy:
```sql
SELECT
  processingMethod,
  complexity,
  AVG(confidence) as avg_confidence,
  COUNT(*) as total_jobs
FROM ExtractionJob ej
JOIN Timetable t ON ej.timetableId = t.id
JOIN TimeBlock tb ON t.id = tb.timetableId
GROUP BY processingMethod, complexity;
```

## Production Deployment

See `DEPLOYMENT.md` for comprehensive AWS deployment guide.

**Key Points**:
- Deploy API server and worker as separate ECS Fargate services (independent scaling)
- API auto-scales on CPU (target 70% utilization)
- Worker auto-scales on SQS queue depth (formula: workers = queue_depth / 600)
- Use RDS PostgreSQL with read replicas for high traffic
- Enable CloudWatch monitoring for API latency, worker throughput, error rates
- Use AWS Secrets Manager for sensitive credentials (not environment variables)

## Future Enhancements Roadmap

Documented in `PROJECT_SUMMARY.md` and `ARCHITECTURE.md`.

**Current Focus** (Phase 2):
- Batch upload (multiple timetables in one request)
- CSV/Excel import (alternative to image upload)
- Export to iCal/Google Calendar (integration with calendar apps)
- Mobile app (React Native for teachers on the go)

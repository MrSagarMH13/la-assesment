# Timetable Extraction API

An AI-powered system for extracting structured timetable data from teacher timetables in various formats (images, PDFs, DOCX). Built with Node.js, TypeScript, Claude AI, and OCR technologies.

## 🎯 Overview

This system allows teachers to upload their timetables in any format and automatically extracts:
- **Time blocks** with accurate start/end times
- **Event names** and descriptions
- **Recurring daily blocks** (e.g., Registration, Lunch)
- **Metadata** (teacher name, class, term, week)

The API handles diverse timetable formats including:
- ✅ Typed/digital timetables
- ✅ Scanned images
- ✅ Color-coded schedules
- ✅ Handwritten timetables
- ✅ Various table layouts (days as columns/rows)
- ✅ Merged cells and vertical text
- ✅ Missing or implicit timings

## 🏗️ Architecture

### System Workflow

```
File Upload (Image/PDF/DOCX)
    ↓
File Processing & OCR
    ↓
Claude AI Vision + Text Analysis
    ↓
Structured JSON Extraction
    ↓
Validation & Response
    ↓
Database Storage (Optional)
```

### Technology Stack

**Backend:**
- **Runtime:** Node.js 18+
- **Language:** TypeScript
- **Framework:** Express.js
- **File Upload:** Multer
- **OCR:** Tesseract.js (images), pdf-parse (PDFs), mammoth (DOCX)
- **AI/LLM:** Anthropic Claude 3.5 Sonnet (vision + text)
- **Database:** SQLite with Prisma ORM
- **Validation:** Zod

**Key Design Decisions:**
1. **Multi-modal LLM approach:** Combines OCR text with Claude's vision capabilities for maximum accuracy
2. **Flexible schema:** Supports both fixed recurring blocks and one-time events
3. **Confidence scoring:** Each extracted block includes a confidence score
4. **Error handling:** Graceful fallbacks and detailed error messages

## 📦 Installation

### Prerequisites
- Node.js 18+ and npm
- Anthropic API key ([Get one here](https://console.anthropic.com/))

### Setup Steps

1. **Clone and install dependencies:**
```bash
npm install
```

2. **Configure environment variables:**
```bash
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
```

Your `.env` should contain:
```
ANTHROPIC_API_KEY=your_actual_api_key_here
PORT=3000
DATABASE_URL="file:./dev.db"
```

3. **Initialize database:**
```bash
npx prisma generate
npx prisma db push
```

4. **Build TypeScript:**
```bash
npm run build
```

5. **Run the server:**
```bash
# Development mode (auto-reload)
npm run dev

# Production mode
npm start
```

The API will be available at `http://localhost:3000`

## 📡 API Documentation

### Base URL
```
http://localhost:3000
```

### Endpoints

#### 1. Upload Timetable
```http
POST /api/timetable/upload
```

**Request:**
- **Content-Type:** `multipart/form-data`
- **Fields:**
  - `file` (required): The timetable file (image/PDF/DOCX, max 10MB)
  - `teacherName` (optional): Teacher's name
  - `className` (optional): Class name/identifier

**Example using cURL:**
```bash
curl -X POST http://localhost:3000/api/timetable/upload \
  -F "file=@/path/to/timetable.png" \
  -F "teacherName=Miss Joynes" \
  -F "className=2EJ"
```

**Example using JavaScript:**
```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);
formData.append('teacherName', 'Miss Joynes');
formData.append('className', '2EJ');

const response = await fetch('http://localhost:3000/api/timetable/upload', {
  method: 'POST',
  body: formData
});

const data = await response.json();
```

**Response (Success - 200):**
```json
{
  "success": true,
  "data": {
    "timetableId": "tt-1234567890",
    "metadata": {
      "teacherName": "Miss Joynes",
      "className": "2EJ",
      "term": "Spring 2",
      "week": "2",
      "extractedAt": "2025-10-03T10:30:00.000Z"
    },
    "blocks": [
      {
        "day": "Monday",
        "startTime": "09:30",
        "endTime": "10:00",
        "eventName": "Maths",
        "notes": "Consolidation",
        "isFixed": false,
        "confidence": 0.95
      },
      {
        "day": "Monday",
        "startTime": "10:50",
        "endTime": "12:00",
        "eventName": "English",
        "notes": "Experience Day",
        "isFixed": false,
        "confidence": 0.92
      }
    ],
    "recurringBlocks": [
      {
        "startTime": "08:35",
        "endTime": "08:50",
        "eventName": "Registration and Early Morning Work",
        "appliesDaily": true
      },
      {
        "startTime": "12:00",
        "endTime": "13:15",
        "eventName": "Lunch",
        "appliesDaily": true
      }
    ],
    "warnings": [
      "Some time blocks had implicit durations and were calculated automatically"
    ]
  }
}
```

**Response (Error - 400/500):**
```json
{
  "success": false,
  "error": "Invalid file type. Only images, PDFs, and DOCX files are allowed."
}
```

#### 2. Health Check
```http
GET /api/timetable/health
```

**Response:**
```json
{
  "status": "ok",
  "service": "timetable-extraction-api"
}
```

### Supported File Types
- **Images:** `.jpg`, `.jpeg`, `.png`, `.gif`
- **Documents:** `.pdf`, `.docx`
- **Max size:** 10MB

## 🧠 LLM Integration Strategy

### Architecture

The system uses a **multi-stage extraction pipeline** with Claude 3.5 Sonnet:

1. **Vision Analysis** (Primary)
   - Claude's vision model analyzes the timetable image directly
   - Handles complex layouts, colors, merged cells, rotated text
   - Provides highest accuracy for visual timetables

2. **OCR Fallback** (Secondary)
   - Tesseract OCR extracts text from images
   - pdf-parse extracts text from PDFs
   - mammoth extracts text from DOCX
   - Text is provided to Claude as supplementary context

3. **Structured Extraction**
   - Claude is prompted to return JSON with strict schema
   - Uses function calling / structured output mode
   - Temperature set to 0 for reproducibility

### Prompt Engineering

**System Prompt Strategy:**
- Defines clear extraction rules (time accuracy, recurring blocks, implicit timings)
- Provides JSON schema with examples
- Handles edge cases (missing times, merged cells, vertical text)
- Instructs Claude to identify table structure (rows vs columns)

**User Prompt Strategy:**
- Provides visual image (base64 encoded)
- Includes OCR text as fallback/validation
- Adds provided metadata (teacher name, class) for context

**Key Prompt Rules:**
1. Extract exact start/end times
2. Identify recurring blocks (same time daily)
3. Handle implicit timings (divide duration equally)
4. Detect table orientation
5. Preserve original event names
6. Return confidence scores

### Accuracy & Reproducibility

**Ensuring Accuracy:**
- Multi-modal input (vision + OCR text)
- Strict JSON schema validation with Zod
- Business logic validation (time continuity, no overlaps)
- Confidence scores for each extracted block
- Warning flags for assumptions/issues

**Ensuring Reproducibility:**
- Temperature = 0 (deterministic output)
- Consistent prompt structure
- Version-pinned Claude model (`claude-3-5-sonnet-20241022`)
- Validation layer rejects malformed responses

## 🗄️ Database Schema

```prisma
model Timetable {
  id              String   @id @default(uuid())
  teacherId       String?
  teacherName     String?
  className       String?
  term            String?
  week            String?
  uploadedFileUrl String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  timeBlocks      TimeBlock[]
  recurringBlocks RecurringBlock[]
}

model TimeBlock {
  id          String   @id @default(uuid())
  timetableId String
  day         String
  startTime   String
  endTime     String
  eventName   String
  notes       String?
  isFixed     Boolean  @default(false)
  color       String?
  confidence  Float?

  timetable   Timetable @relation(...)
}

model RecurringBlock {
  id          String   @id @default(uuid())
  timetableId String
  startTime   String
  endTime     String
  eventName   String
  appliesDaily Boolean @default(true)
  notes       String?

  timetable   Timetable @relation(...)
}
```

**Design Decisions:**
- Separate tables for one-time vs recurring blocks
- String-based time storage (HH:MM format) for flexibility
- Optional fields for graceful degradation
- Cascade deletes for data integrity

## ⚠️ Error Handling

### File Upload Errors
- Invalid file type → 400 error
- File too large (>10MB) → 400 error
- Missing file → 400 error

### Processing Errors
- OCR failure → Falls back to vision-only
- Claude API error → Returns detailed error message
- JSON parsing error → Returns original response for debugging

### Fallback Strategy
1. Primary: Vision + OCR combined analysis
2. Fallback 1: Vision-only (if OCR fails)
3. Fallback 2: OCR-only + text analysis (if vision fails)
4. Error: Return detailed error with troubleshooting steps

### Ambiguous Data Handling
- Missing times: Flag in warnings, attempt to calculate from surrounding blocks
- Unclear structure: Use Claude's best interpretation + low confidence score
- Partial extraction: Return what was extracted + warnings array

## 🔧 Testing

### Manual Testing

1. **Run test script:**
```bash
# Make sure server is running (npm run dev)
./test-upload.sh
```

2. **Test individual file:**
```bash
curl -X POST http://localhost:3000/api/timetable/upload \
  -F "file=@/path/to/timetable.png" | jq '.'
```

3. **Programmatic test:**
```bash
npm run build
node test-manual.js
```

### Sample Test Cases

The repo includes test scripts for the provided examples:
- Teacher Timetable Example 1.2.png (standard grid layout)
- Teacher Timetable Example 3.png (daily schedules)
- Teacher Timetable Example 4.jpeg (simple weekly view)

## 🔮 Frontend Strategy

### Recommended Stack

**Framework:** React 18+ with TypeScript
- Component-based architecture for reusable timetable blocks
- Type safety for API responses

**UI Library:** TailwindCSS + shadcn/ui
- Rapid development with pre-built components
- Customizable design system
- Responsive by default

**State Management:**
- React Query (TanStack Query) for API state
- Zustand for local UI state

**Calendar/Schedule Display:**
- **Option 1:** Custom grid component (recommended for full control)
- **Option 2:** react-big-calendar (feature-rich)
- **Option 3:** FullCalendar (comprehensive)

### UI Components Architecture

```
<TimetableUploader />
  ↓
<FileDropzone />
  ↓
<ProcessingSpinner />
  ↓
<TimetableGrid />
  ├── <TimeColumn />
  ├── <DayColumn />
  │   ├── <TimeBlock />
  │   └── <RecurringBlock />
  └── <WarningsPanel />
```

### Key UI Patterns

1. **File Upload:**
   - Drag-and-drop zone
   - File type validation
   - Progress indicator
   - Preview before upload

2. **Timetable Display:**
   - Responsive grid (mobile: stack days, desktop: side-by-side)
   - Color-coded blocks (preserve original colors if extracted)
   - Hover tooltips for full event details
   - Fixed recurring blocks visually distinct

3. **Interactive Features:**
   - Click to edit extracted blocks
   - Drag-to-adjust time boundaries
   - Confidence score indicators
   - Warning notifications

4. **Responsive Design:**
   - Mobile: Vertical day list with time blocks
   - Tablet: 2-3 days per row
   - Desktop: Full week view

### Sample React Component

```tsx
interface TimetableViewProps {
  data: TimetableResponse['data'];
}

function TimetableView({ data }: TimetableViewProps) {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

  return (
    <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
      {days.map(day => (
        <div key={day} className="border rounded-lg p-4">
          <h3 className="font-bold mb-3">{day}</h3>

          {/* Recurring blocks */}
          {data.recurringBlocks?.map(block => (
            <RecurringBlock key={block.startTime} {...block} />
          ))}

          {/* Day-specific blocks */}
          {data.blocks
            .filter(b => b.day === day)
            .map(block => (
              <TimeBlock key={block.id} {...block} />
            ))}
        </div>
      ))}
    </div>
  );
}
```

## 🚀 Future Enhancements

### Scalability & Flexibility

1. **Plugin Architecture:**
   - Custom extractors for specific school formats
   - Configurable extraction rules per institution

2. **Multi-format Support:**
   - Excel spreadsheets (.xlsx)
   - CSV imports
   - Google Sheets integration

3. **LLM Provider Flexibility:**
   - Support for OpenAI GPT-4 Vision
   - Support for local models (LLaVA, Llama)
   - Fallback provider chain

4. **Enhanced Processing:**
   - Batch upload (multiple timetables)
   - PDF multi-page support
   - Handwriting recognition improvements

5. **Data Management:**
   - Version history for timetables
   - Comparison between uploaded vs extracted
   - Export to calendar formats (iCal, Google Calendar)

6. **API Versioning:**
   - `/v2/api/timetable/upload` for breaking changes
   - Backwards compatibility layer

## 🛠️ Development with AI Tools

This project extensively leveraged AI-powered development tools:

### Tools Used

1. **Claude Code (Primary)**
   - Architectural planning and design decisions
   - Code generation (TypeScript, Prisma schema)
   - Prompt engineering for extraction logic
   - Error handling patterns

2. **GitHub Copilot**
   - Autocomplete for boilerplate code
   - Test script generation
   - Type definitions

3. **ChatGPT**
   - Architecture diagram concepts
   - Database schema optimization
   - Documentation writing

### AI-Assisted Workflow

1. **Planning Phase:**
   - Discussed requirements with Claude
   - Generated system architecture diagram
   - Defined database schema

2. **Implementation Phase:**
   - Claude generated core service logic
   - Copilot assisted with Express routes
   - AI-suggested error handling patterns

3. **Testing Phase:**
   - Generated test scripts with Claude
   - AI-suggested edge cases

4. **Documentation Phase:**
   - README structure via ChatGPT
   - API docs formatted by Claude

**Time Saved:** Estimated ~60% faster development vs manual coding

**Quality Impact:**
- ✅ Fewer bugs due to AI-suggested error handling
- ✅ Better code organization from AI architectural suggestions
- ✅ More comprehensive documentation

## 📝 Known Limitations

1. **Handwriting Recognition:**
   - Works but less accurate than typed text
   - Requires high-quality scans

2. **Complex Layouts:**
   - Very irregular table structures may need manual review
   - Multi-page PDFs: currently only processes first page

3. **Time Format Variations:**
   - Assumes HH:MM format
   - 12-hour format (AM/PM) converted to 24-hour

4. **Language Support:**
   - Currently optimized for English
   - Other languages may work but untested

5. **Cost:**
   - Claude API calls cost ~$0.01-0.05 per timetable
   - Consider caching for repeated uploads

## 🤝 Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Follow TypeScript best practices
4. Add tests for new features
5. Submit a pull request

## 📄 License

ISC License - see LICENSE file for details

## 📞 Support

For issues or questions:
- Open a GitHub issue
- Check the troubleshooting section below

---

## 🔍 Troubleshooting

**Issue:** "ANTHROPIC_API_KEY environment variable is required"
- **Solution:** Ensure `.env` file exists and contains valid API key

**Issue:** OCR extraction is slow
- **Solution:** This is normal for first run (Tesseract model download). Subsequent runs are faster.

**Issue:** Low confidence scores
- **Solution:** Ensure uploaded image is high quality (300+ DPI). Avoid blurry scans.

**Issue:** Missing time blocks
- **Solution:** Check `warnings` array in response. May indicate ambiguous structure.

---

**Built with ❤️ using Node.js, TypeScript, Claude AI, and modern web technologies**

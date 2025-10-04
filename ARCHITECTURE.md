# Timetable Extraction System - Architectural Design

## Table of Contents
1. [System Overview](#system-overview)
2. [Architecture Diagrams](#architecture-diagrams)
3. [Component Design](#component-design)
4. [Technology Stack](#technology-stack)
5. [Database Schema](#database-schema)
6. [LLM Integration Strategy](#llm-integration-strategy)
7. [Error Handling & Fallbacks](#error-handling--fallbacks)
8. [Scalability & Future Enhancements](#scalability--future-enhancements)

---

## 1. System Overview

### Purpose
The Timetable Extraction System is designed to automatically extract structured data from teacher timetables uploaded in various formats (images, PDFs, DOCX files). The system handles diverse timetable layouts and formats, ensuring robustness and accuracy.

### Key Features
- Multi-format support (images, PDFs, DOCX)
- AI-powered extraction using Claude vision model
- OCR fallback for text extraction
- Structured JSON output
- Database persistence
- RESTful API interface

### Design Principles
1. **Robustness**: Handle any timetable format gracefully
2. **Accuracy**: Multi-modal approach (vision + OCR) for highest precision
3. **Flexibility**: Extensible architecture for future enhancements
4. **Reliability**: Comprehensive error handling and fallbacks

---

## 2. Architecture Diagrams

### 2.1 High-Level System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                            │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │   Web App    │  │  Mobile App  │  │   CLI Tool   │         │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘         │
│         │                  │                  │                 │
│         └──────────────────┴──────────────────┘                 │
│                            │                                     │
└────────────────────────────┼─────────────────────────────────────┘
                             │ HTTP/REST
┌────────────────────────────▼─────────────────────────────────────┐
│                      API GATEWAY LAYER                          │
│                                                                 │
│              ┌─────────────────────────────┐                   │
│              │   Express.js API Server     │                   │
│              │                             │                   │
│              │  ┌────────────────────────┐ │                   │
│              │  │  CORS Middleware       │ │                   │
│              │  │  Body Parser           │ │                   │
│              │  │  Error Handler         │ │                   │
│              │  └────────────────────────┘ │                   │
│              └─────────────┬───────────────┘                   │
└────────────────────────────┼─────────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────────┐
│                    PROCESSING LAYER                             │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              Upload & Validation                           │ │
│  │  ┌──────────────────────────────────────────────────────┐  │ │
│  │  │  Multer File Upload                                  │  │ │
│  │  │  - File type validation                              │  │ │
│  │  │  - Size limits (10MB)                                │  │ │
│  │  │  - Storage configuration                             │  │ │
│  │  └──────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              File Processing Pipeline                      │ │
│  │                                                            │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐                │ │
│  │  │  Image   │  │   PDF    │  │  DOCX    │                │ │
│  │  │ Handler  │  │ Handler  │  │ Handler  │                │ │
│  │  └─────┬────┘  └────┬─────┘  └────┬─────┘                │ │
│  │        │            │             │                        │ │
│  │        ▼            ▼             ▼                        │ │
│  │  ┌─────────────────────────────────────┐                  │ │
│  │  │  OCR Processing (Tesseract)         │                  │ │
│  │  │  Text Extraction (pdf-parse/mammoth)│                  │ │
│  │  │  Image Buffer Preparation           │                  │ │
│  │  └─────────────────┬───────────────────┘                  │ │
│  └────────────────────┼───────────────────────────────────────┘ │
└─────────────────────────┼───────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────┐
│                    AI EXTRACTION LAYER                          │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │           Claude AI Service                                │ │
│  │                                                            │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  Multi-Modal Analysis                                │ │ │
│  │  │  ┌─────────────────┐  ┌─────────────────┐            │ │ │
│  │  │  │  Vision Model   │  │  Text Analysis  │            │ │ │
│  │  │  │  (Primary)      │  │  (Fallback)     │            │ │ │
│  │  │  └─────────────────┘  └─────────────────┘            │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  │                                                            │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  Prompt Engineering                                  │ │ │
│  │  │  - System prompt (extraction rules)                 │ │ │
│  │  │  - User prompt (image + text + metadata)            │ │ │
│  │  │  - Structured JSON output                           │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  │                                                            │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  Response Parsing & Validation                       │ │ │
│  │  │  - JSON extraction                                   │ │ │
│  │  │  - Schema validation (Zod)                           │ │ │
│  │  │  - Business logic validation                         │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────┬───────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────┐
│                    DATA LAYER                                   │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              Prisma ORM                                    │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  Data Models                                         │ │ │
│  │  │  - Timetable                                         │ │ │
│  │  │  - TimeBlock                                         │ │ │
│  │  │  - RecurringBlock                                    │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              SQLite Database                               │ │
│  │  (Production: PostgreSQL/MySQL)                            │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Sequence Diagram - Upload Flow

```
┌──────┐      ┌──────────┐      ┌──────────┐      ┌─────────┐      ┌──────────┐      ┌──────────┐
│Client│      │   API    │      │  Upload  │      │  File   │      │  Claude  │      │ Database │
│      │      │  Router  │      │Middleware│      │Processor│      │ Service  │      │          │
└──┬───┘      └────┬─────┘      └────┬─────┘      └────┬────┘      └────┬─────┘      └────┬─────┘
   │               │                 │                 │                │                │
   │ POST /upload  │                 │                 │                │                │
   ├──────────────>│                 │                 │                │                │
   │               │                 │                 │                │                │
   │               │ Validate file   │                 │                │                │
   │               ├────────────────>│                 │                │                │
   │               │                 │                 │                │                │
   │               │ File validated  │                 │                │                │
   │               │<────────────────┤                 │                │                │
   │               │                 │                 │                │                │
   │               │     Process file (OCR/extract)    │                │                │
   │               ├──────────────────────────────────>│                │                │
   │               │                 │                 │                │                │
   │               │                 │                 │ Extract text   │                │
   │               │                 │                 │ Prepare image  │                │
   │               │                 │                 │                │                │
   │               │     Processed data                │                │                │
   │               │<──────────────────────────────────┤                │                │
   │               │                 │                 │                │                │
   │               │            Extract timetable (vision + text)       │                │
   │               ├───────────────────────────────────────────────────>│                │
   │               │                 │                 │                │                │
   │               │                 │                 │   Claude API   │                │
   │               │                 │                 │   (vision)     │                │
   │               │                 │                 │                │                │
   │               │            Structured JSON response                │                │
   │               │<───────────────────────────────────────────────────┤                │
   │               │                 │                 │                │                │
   │               │ Validate schema │                 │                │                │
   │               │ (Zod)           │                 │                │                │
   │               │                 │                 │                │                │
   │               │                       Save to database             │                │
   │               ├────────────────────────────────────────────────────────────────────>│
   │               │                 │                 │                │                │
   │               │                       Saved (timetableId)          │                │
   │               │<────────────────────────────────────────────────────────────────────┤
   │               │                 │                 │                │                │
   │               │ Cleanup temp    │                 │                │                │
   │               ├────────────────>│                 │                │                │
   │               │                 │                 │                │                │
   │  JSON response│                 │                 │                │                │
   │<──────────────┤                 │                 │                │                │
   │               │                 │                 │                │                │
```

### 2.3 Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        INPUT SOURCES                            │
│                                                                 │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐    │
│  │  PNG/JPG │   │   PDF    │   │   DOCX   │   │  Scanned │    │
│  │  Image   │   │   File   │   │   File   │   │  Images  │    │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘   └────┬─────┘    │
│       │              │              │              │           │
└───────┼──────────────┼──────────────┼──────────────┼───────────┘
        │              │              │              │
        └──────────────┴──────────────┴──────────────┘
                       │
                       ▼
        ┌──────────────────────────────────┐
        │       FILE VALIDATION            │
        │  - Type check (mime type)        │
        │  - Size check (<10MB)            │
        │  - Format verification           │
        └──────────────┬───────────────────┘
                       │
                       ▼
        ┌──────────────────────────────────┐
        │     PREPROCESSING                │
        │                                  │
        │  Image → Sharp → PNG Buffer      │
        │  PDF   → pdf-parse → Text        │
        │  DOCX  → mammoth → Text          │
        └──────────────┬───────────────────┘
                       │
                       ▼
        ┌──────────────────────────────────┐
        │     OCR EXTRACTION               │
        │  (Tesseract.js)                  │
        │  - Text recognition              │
        │  - Table structure detection     │
        │  - Confidence scoring            │
        └──────────────┬───────────────────┘
                       │
                       ▼
        ┌──────────────────────────────────┐
        │   MULTI-MODAL PREPARATION        │
        │                                  │
        │  ┌────────────┐  ┌─────────────┐│
        │  │ Image      │  │ Extracted   ││
        │  │ (base64)   │  │ Text (OCR)  ││
        │  └────────────┘  └─────────────┘│
        └──────────────┬───────────────────┘
                       │
                       ▼
        ┌──────────────────────────────────┐
        │   CLAUDE AI ANALYSIS             │
        │                                  │
        │  Vision Model:                   │
        │  - Visual structure detection    │
        │  - Table layout understanding    │
        │  - Color/formatting recognition  │
        │                                  │
        │  Text Analysis:                  │
        │  - Time extraction               │
        │  - Event name extraction         │
        │  - Pattern recognition           │
        └──────────────┬───────────────────┘
                       │
                       ▼
        ┌──────────────────────────────────┐
        │   STRUCTURED EXTRACTION          │
        │                                  │
        │  {                               │
        │    metadata: {...},              │
        │    blocks: [{                    │
        │      day, startTime, endTime,    │
        │      eventName, notes, ...       │
        │    }],                           │
        │    recurringBlocks: [...]        │
        │  }                               │
        └──────────────┬───────────────────┘
                       │
                       ▼
        ┌──────────────────────────────────┐
        │   VALIDATION & POST-PROCESSING   │
        │                                  │
        │  - Schema validation (Zod)       │
        │  - Time continuity check         │
        │  - Overlap detection             │
        │  - Confidence threshold          │
        │  - Warning generation            │
        └──────────────┬───────────────────┘
                       │
                       ▼
        ┌──────────────────────────────────┐
        │   DATABASE PERSISTENCE           │
        │                                  │
        │  Timetable → TimeBlocks          │
        │           → RecurringBlocks      │
        └──────────────┬───────────────────┘
                       │
                       ▼
        ┌──────────────────────────────────┐
        │   JSON RESPONSE                  │
        │                                  │
        │  {                               │
        │    success: true,                │
        │    data: {                       │
        │      timetableId,                │
        │      metadata,                   │
        │      blocks,                     │
        │      recurringBlocks,            │
        │      warnings                    │
        │    }                             │
        │  }                               │
        └──────────────────────────────────┘
```

---

## 3. Component Design

### 3.1 Backend Components

#### API Layer
- **Express Server** (`src/index.ts`)
  - Entry point
  - Middleware configuration
  - Route registration
  - Error handling

#### Middleware
- **Upload Middleware** (`src/middleware/upload.ts`)
  - Multer configuration
  - File type validation
  - Size limits
  - Storage management

- **Error Handler** (`src/middleware/errorHandler.ts`)
  - Centralized error handling
  - Error classification
  - Response formatting

#### Routes
- **Timetable Routes** (`src/routes/timetable.ts`)
  - POST `/api/timetable/upload` - Upload and extract timetable
  - GET `/api/timetable/health` - Health check

#### Services
- **File Processor** (`src/utils/fileProcessor.ts`)
  - Image processing (Tesseract OCR)
  - PDF text extraction (pdf-parse)
  - DOCX text extraction (mammoth)
  - Buffer preparation for vision API

- **Claude Service** (`src/services/claudeService.ts`)
  - Anthropic API integration
  - Prompt engineering
  - Multi-modal input handling
  - Response parsing

#### Data Layer
- **Prisma ORM** (`prisma/schema.prisma`)
  - Type-safe database access
  - Schema definitions
  - Migrations

- **Type Definitions** (`src/types/timetable.ts`)
  - Zod schemas for validation
  - TypeScript interfaces
  - Request/response types

### 3.2 Frontend Components (Recommended)

```
src/
├── components/
│   ├── upload/
│   │   ├── FileDropzone.tsx
│   │   ├── UploadProgress.tsx
│   │   └── FilePreview.tsx
│   ├── timetable/
│   │   ├── TimetableGrid.tsx
│   │   ├── TimeBlock.tsx
│   │   ├── RecurringBlock.tsx
│   │   ├── DayColumn.tsx
│   │   └── TimeColumn.tsx
│   ├── ui/
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   └── Alert.tsx
│   └── layout/
│       ├── Header.tsx
│       └── Container.tsx
├── hooks/
│   ├── useFileUpload.ts
│   ├── useTimetable.ts
│   └── useToast.ts
├── services/
│   └── api.ts
└── types/
    └── timetable.ts
```

---

## 4. Technology Stack

### Backend

| Component | Technology | Justification |
|-----------|-----------|---------------|
| Runtime | Node.js 18+ | Wide ecosystem, async I/O, excellent for API servers |
| Language | TypeScript | Type safety, better tooling, fewer runtime errors |
| Framework | Express.js | Mature, minimal, flexible, extensive middleware |
| File Upload | Multer | De facto standard for multipart/form-data in Express |
| OCR | Tesseract.js | Open-source, runs in Node.js, good accuracy |
| PDF Parsing | pdf-parse | Simple API, extracts text reliably |
| DOCX Parsing | mammoth | Converts DOCX to text/HTML cleanly |
| Image Processing | Sharp | Fast, production-ready, format conversion |
| AI/LLM | Anthropic Claude 3.5 | Best-in-class vision + text, structured output |
| Database | SQLite (dev), PostgreSQL (prod) | SQLite for development, Postgres for production scale |
| ORM | Prisma | Type-safe, great DX, migration management |
| Validation | Zod | Runtime type validation, TypeScript integration |

### Frontend (Recommended)

| Component | Technology | Justification |
|-----------|-----------|---------------|
| Framework | React 18+ | Component-based, large ecosystem, TypeScript support |
| UI Library | TailwindCSS + shadcn/ui | Utility-first CSS, customizable components |
| State Management | React Query + Zustand | Server state (React Query), UI state (Zustand) |
| Forms | React Hook Form | Performance, easy validation integration |
| HTTP Client | Axios/Fetch | Standard HTTP requests |

---

## 5. Database Schema

### Entity Relationship Diagram

```
┌─────────────────────────────────────┐
│           Timetable                 │
├─────────────────────────────────────┤
│ id (PK)              String UUID    │
│ teacherId            String?        │
│ teacherName          String?        │
│ className            String?        │
│ term                 String?        │
│ week                 String?        │
│ uploadedFileUrl      String?        │
│ createdAt            DateTime       │
│ updatedAt            DateTime       │
└──────────────┬──────────────────────┘
               │
               │ 1:N
               │
      ┌────────┴────────┐
      │                 │
      ▼                 ▼
┌──────────────┐  ┌──────────────────┐
│  TimeBlock   │  │ RecurringBlock   │
├──────────────┤  ├──────────────────┤
│ id (PK)      │  │ id (PK)          │
│ timetableId  │  │ timetableId      │
│ day          │  │ startTime        │
│ startTime    │  │ endTime          │
│ endTime      │  │ eventName        │
│ eventName    │  │ appliesDaily     │
│ notes        │  │ notes            │
│ isFixed      │  │ createdAt        │
│ color        │  └──────────────────┘
│ confidence   │
│ createdAt    │
└──────────────┘
```

### Schema Details

**Timetable**
- Primary entity for uploaded timetables
- Stores metadata (teacher, class, term, week)
- One-to-many with TimeBlock and RecurringBlock

**TimeBlock**
- Individual scheduled events
- Day-specific (Monday-Friday)
- Start/end times in HH:MM format
- Optional notes, color, confidence score
- `isFixed` flag for blocks that shouldn't be edited

**RecurringBlock**
- Events that occur daily at the same time
- Examples: Registration, Lunch, Break
- `appliesDaily` flag (for potential future weekly patterns)

### Design Decisions

1. **String-based times**: Store as "HH:MM" for flexibility and timezone-independence
2. **Optional fields**: Graceful degradation if extraction is partial
3. **Separate recurring blocks**: Distinct table for fixed daily events
4. **Confidence scores**: Track extraction quality per block
5. **Cascade deletes**: When timetable is deleted, blocks are auto-removed

---

## 6. LLM Integration Strategy

### 6.1 Model Selection

**Primary:** Claude 3.5 Sonnet (`claude-3-5-sonnet-20241022`)

**Reasons:**
- ✅ Excellent vision capabilities (handles complex layouts)
- ✅ Structured output support (reliable JSON)
- ✅ Large context window (handles detailed images + text)
- ✅ High accuracy on table/grid recognition
- ✅ Better than GPT-4V for document understanding

**Alternative Options:**
- OpenAI GPT-4 Vision (fallback)
- Google Gemini Pro Vision (cost optimization)
- Local models (LLaVA, Llama-Vision) for privacy-sensitive deployments

### 6.2 Prompt Engineering

#### System Prompt Structure

```
Role Definition
    ↓
Task Description
    ↓
Extraction Rules (key logic)
    ↓
Edge Case Handling
    ↓
Output Format (JSON schema)
```

**Key Prompt Rules:**
1. **Time Accuracy**: Extract exact start/end times, calculate if missing
2. **Recurring Detection**: Identify daily fixed blocks (grey/repeated)
3. **Implicit Durations**: Divide time equally if multiple events in one slot
4. **Table Structure**: Auto-detect rows vs columns orientation
5. **Name Preservation**: Keep original event names verbatim
6. **Merged Cells**: Split into individual day entries
7. **Metadata Extraction**: Pull teacher, class, term, week from image

#### User Prompt Strategy

**Multi-modal Input:**
```json
[
  {
    "type": "text",
    "text": "Additional context: Teacher: Miss Joynes, Class: 2EJ"
  },
  {
    "type": "image",
    "source": {
      "type": "base64",
      "media_type": "image/png",
      "data": "<base64_image>"
    }
  },
  {
    "type": "text",
    "text": "OCR Text: [extracted text]\n\nAnalyze and extract timetable..."
  }
]
```

**Benefits:**
- Vision model sees actual layout (primary)
- OCR text provides fallback/validation
- Metadata adds context for better extraction

### 6.3 Accuracy & Reproducibility

**Ensuring Accuracy:**

1. **Multi-modal Validation**
   - Cross-check vision extraction with OCR text
   - Flag discrepancies in warnings

2. **Business Logic Validation**
   ```typescript
   - Time continuity: No gaps between blocks
   - No overlaps: Blocks don't conflict
   - Time format: HH:MM 24-hour
   - Day validity: Only Mon-Fri
   - Duration sanity: Blocks are 5-60 minutes
   ```

3. **Confidence Scoring**
   - High confidence (>0.9): Clear structure, all times explicit
   - Medium (0.7-0.9): Some calculated times, minor ambiguity
   - Low (<0.7): Complex layout, many assumptions

**Ensuring Reproducibility:**

1. **Deterministic Settings**
   - Temperature = 0 (no randomness)
   - Seed parameter (if available)
   - Version-pinned model

2. **Consistent Prompts**
   - Templated system/user prompts
   - No dynamic instructions that vary

3. **Validation Layer**
   - Zod schema enforcement
   - Reject malformed JSON
   - Retry with error feedback (once)

### 6.4 Cost Optimization

**Current Cost:** ~$0.01-0.05 per timetable

**Optimization Strategies:**

1. **Caching**
   - Cache responses for identical files (hash-based)
   - 15-minute TTL for repeated uploads

2. **Intelligent Fallback**
   - Try OCR-only first for simple typed timetables
   - Use vision only if OCR confidence is low

3. **Batch Processing**
   - Process multiple pages/timetables in one API call
   - Reduce per-request overhead

4. **Model Selection**
   - Use Claude Haiku for simple layouts (cheaper)
   - Use Sonnet/Opus for complex handwritten timetables

---

## 7. Error Handling & Fallbacks

### 7.1 Error Categories

| Category | Examples | Handling |
|----------|----------|----------|
| **User Errors** | Invalid file type, file too large | 400 response with clear message |
| **Processing Errors** | OCR failure, corrupt file | Fallback to vision-only |
| **LLM Errors** | API timeout, rate limit | Retry with exponential backoff |
| **System Errors** | Database down, out of memory | 500 response, log for investigation |

### 7.2 Fallback Strategy

```
Primary: Vision + OCR Combined
           ↓ (OCR fails)
Fallback 1: Vision-Only Analysis
           ↓ (Vision fails)
Fallback 2: OCR-Only + Text LLM
           ↓ (All fail)
Error Response: Detailed message + troubleshooting
```

### 7.3 Handling Ambiguous Data

**Missing Times:**
```
IF time slot has events but no explicit times:
  1. Check if adjacent blocks have times → calculate from duration
  2. If parent block has total duration → divide equally
  3. Flag in warnings: "Times calculated automatically"
```

**Unclear Structure:**
```
IF table orientation is ambiguous:
  1. Let Claude make best guess
  2. Lower confidence score
  3. Add warning: "Please verify extracted structure"
```

**Partial Extraction:**
```
IF only some blocks are extracted:
  1. Return extracted blocks
  2. Add warnings for missing sections
  3. Confidence score reflects completeness
```

### 7.4 Logging & Monitoring

**Log Levels:**
- **INFO**: Successful extractions, API calls
- **WARN**: Fallbacks used, low confidence, partial extraction
- **ERROR**: Failed uploads, API errors, validation failures

**Key Metrics:**
- Extraction success rate
- Average confidence score
- Processing time (OCR, LLM, total)
- Error rate by type
- Cost per extraction

---

## 8. Scalability & Future Enhancements

### 8.1 Horizontal Scaling

**Current Architecture:** Single Node.js server

**Scaling Strategy:**
```
┌───────────────────────────────────────┐
│         Load Balancer (nginx)         │
└──────────┬────────────┬───────────────┘
           │            │
     ┌─────▼─────┐  ┌──▼─────────┐
     │ API Node 1│  │ API Node 2 │  ... N nodes
     └─────┬─────┘  └──┬─────────┘
           │            │
     ┌─────▼────────────▼─────┐
     │   Shared Database      │
     │   (PostgreSQL)         │
     └────────────────────────┘
     ┌────────────────────────┐
     │   Shared File Storage  │
     │   (S3/Cloud Storage)   │
     └────────────────────────┘
```

**Stateless Design:**
- No session state in API nodes
- Uploaded files stored in shared storage
- Database handles concurrency

### 8.2 Performance Optimization

**Current Bottlenecks:**
1. OCR processing (Tesseract) - 2-5s per image
2. Claude API call - 1-3s per request
3. File upload - Network dependent

**Optimization Strategies:**

1. **Async Processing**
   ```
   Upload → Queue → Background Worker → Webhook notification
   ```
   - Immediate response to client
   - Worker processes extraction
   - Notify client when done (webhook/websocket)

2. **Caching**
   - Redis cache for repeated file hashes
   - CDN for static assets
   - Database query caching (Prisma)

3. **Parallel Processing**
   - Process multi-page PDFs in parallel
   - Concurrent OCR + vision API calls

### 8.3 Plugin Architecture

**Goal:** Support custom extractors per school/format

```typescript
interface TimetableExtractor {
  name: string;
  supports(file: ProcessedFile): boolean;
  extract(file: ProcessedFile): Promise<ExtractedData>;
}

class CustomSchoolExtractor implements TimetableExtractor {
  name = 'St. Mary\'s School Format';

  supports(file: ProcessedFile): boolean {
    // Check if file matches known pattern
    return file.text?.includes('St. Mary\'s Primary');
  }

  async extract(file: ProcessedFile): Promise<ExtractedData> {
    // Custom extraction logic for this school's format
  }
}
```

**Registry:**
```typescript
const extractorRegistry = [
  new CustomSchoolExtractor(),
  new GenericLLMExtractor(), // fallback
];

for (const extractor of extractorRegistry) {
  if (extractor.supports(file)) {
    return await extractor.extract(file);
  }
}
```

### 8.4 Additional Features (Roadmap)

**Phase 2:**
- [ ] Batch upload (multiple timetables)
- [ ] CSV/Excel import
- [ ] Google Sheets integration
- [ ] Export to iCal/Google Calendar

**Phase 3:**
- [ ] Real-time collaboration (edit timetables)
- [ ] Conflict detection (teacher double-booked)
- [ ] Room allocation management
- [ ] Absence/substitution handling

**Phase 4:**
- [ ] Mobile app (React Native)
- [ ] Offline mode (local LLM)
- [ ] Multi-language support
- [ ] Advanced analytics dashboard

### 8.5 Database Migration Path

**Current:** SQLite (file-based)

**Production Path:**
```
SQLite (dev)
    ↓
PostgreSQL (production)
    ↓
PostgreSQL + Read Replicas (high traffic)
    ↓
PostgreSQL + Redis cache (extreme scale)
```

**Migration Steps:**
1. Update Prisma datasource to PostgreSQL
2. Run `prisma db push` or migrations
3. No application code changes needed (ORM abstraction)

### 8.6 API Versioning Strategy

**Current:** Unversioned (`/api/timetable/upload`)

**Future:**
```
/v1/api/timetable/upload  → Original format
/v2/api/timetable/upload  → Breaking changes
```

**Versioning Approach:**
- URL-based versioning (`/v1`, `/v2`)
- Support 2 versions simultaneously during migration
- Deprecation warnings in v1 responses
- 6-month sunset period for old versions

---

## 9. Security Considerations

### 9.1 File Upload Security

**Risks:**
- Malicious file uploads (viruses, scripts)
- Oversized files (DoS)
- Path traversal attacks

**Mitigations:**
- File type validation (mime type + magic bytes)
- Size limits (10MB)
- Sandboxed processing (no file execution)
- Temp file cleanup
- Antivirus scanning (production)

### 9.2 API Security

**Measures:**
- CORS configuration (whitelist origins)
- Rate limiting (express-rate-limit)
- API key authentication (future)
- HTTPS only (production)
- Input sanitization (Zod validation)

### 9.3 Data Privacy

**Considerations:**
- Teacher/student data is sensitive (GDPR/FERPA)
- Uploaded timetables may contain personal info
- Claude API sends data to Anthropic (third-party)

**Compliance:**
- Add consent notice before upload
- Option for on-premise deployment (local LLM)
- Data retention policy (auto-delete after 30 days)
- Encryption at rest (database) and in transit (HTTPS)

---

## 10. Testing Strategy

### 10.1 Test Pyramid

```
        ┌─────────────┐
        │     E2E     │  (10%) - Full upload flow
        │   Tests     │
        └─────────────┘
       ┌───────────────┐
       │  Integration  │  (30%) - API routes + services
       │    Tests      │
       └───────────────┘
      ┌─────────────────┐
      │   Unit Tests    │  (60%) - Individual functions
      └─────────────────┘
```

### 10.2 Test Cases

**Unit Tests:**
- File type validation
- Time parsing/formatting
- JSON schema validation
- Confidence score calculation

**Integration Tests:**
- Upload endpoint with valid file → 200 response
- Upload with invalid file → 400 error
- Claude service with mock response → parsed data
- Database save and retrieve

**E2E Tests:**
- Upload PNG timetable → extract → verify blocks
- Upload PDF → extract → verify metadata
- Upload with missing times → verify warnings

### 10.3 Test Fixtures

Provide sample timetables for testing:
- `fixtures/simple-grid.png` - Clean typed timetable
- `fixtures/handwritten.jpg` - Handwritten timetable
- `fixtures/complex-layout.pdf` - Multi-page PDF
- `fixtures/missing-times.png` - Implicit durations

---

## Conclusion

This architecture provides:

✅ **Robustness**: Handles diverse timetable formats gracefully
✅ **Accuracy**: Multi-modal LLM + OCR for high precision
✅ **Flexibility**: Plugin architecture for custom extractors
✅ **Scalability**: Stateless design, horizontal scaling ready
✅ **Reliability**: Comprehensive error handling and fallbacks

The system is production-ready with clear paths for enhancement and scaling as requirements evolve.

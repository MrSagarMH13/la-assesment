# Timetable Extraction API - Usage Guide

## Quick Start

### 1. Import Postman Collection

Import `Timetable_Extraction_API.postman_collection.json` into Postman.

The collection includes:
- ✅ Pre-configured endpoints
- ✅ Auto-save jobId from upload response
- ✅ Environment variables setup
- ✅ Request/response examples

### 2. Setup Environment

Default values are already set:
- `baseUrl`: http://localhost:3000
- `jobId`: (auto-populated from upload response)

For production, update `baseUrl` to your deployed URL.

---

## API Workflow (V2 - Recommended)

### Step 1: Upload Timetable
```bash
curl -X POST http://localhost:3000/api/v2/timetable/upload \
  -F "file=@/path/to/timetable.png" \
  -F "teacherName=Miss Joynes" \
  -F "className=2EJ"
```

**Response:**
```json
{
  "success": true,
  "message": "File uploaded successfully. Processing in background.",
  "data": {
    "jobId": "f4ac3c04-0a45-4f9d-b587-1cb4f8874567",
    "status": "pending",
    "createdAt": "2025-10-05T04:05:34.134Z",
    "statusUrl": "/api/v2/timetable/jobs/f4ac3c04-0a45-4f9d-b587-1cb4f8874567",
    "webhookRegistered": false
  }
}
```

**Save the `jobId` for next steps!**

---

### Step 2: Check Job Status
```bash
curl http://localhost:3000/api/v2/timetable/jobs/{jobId}
```

**Response (Processing):**
```json
{
  "success": true,
  "data": {
    "jobId": "f4ac3c04-0a45-4f9d-b587-1cb4f8874567",
    "status": "processing",
    "createdAt": "2025-10-05T04:05:34.134Z",
    "startedAt": "2025-10-05T04:05:34.249Z",
    "completedAt": null,
    "processingMethod": "claude",
    "complexity": "medium",
    "retryCount": 0,
    "originalFileName": "Teacher Timetable Example 1.2.png"
  }
}
```

**Status values:**
- `pending` - Job queued, waiting for worker
- `processing` - Worker is extracting data
- `completed` - Extraction successful
- `failed` - Extraction failed (check errorMessage)

---

### Step 3: Get Extraction Result (NEW!)
```bash
curl http://localhost:3000/api/v2/timetable/jobs/{jobId}/result
```

**Response (Completed):**
```json
{
  "success": true,
  "data": {
    "jobId": "f4ac3c04-0a45-4f9d-b587-1cb4f8874567",
    "status": "completed",
    "processingMethod": "claude",
    "complexity": "medium",
    "completedAt": "2025-10-05T04:06:13.535Z",
    "result": {
      "timetableId": "0637495b-360d-4b86-a372-69cf870251de",
      "metadata": {
        "teacherName": "Miss Joynes",
        "className": "2EJ",
        "term": "Spring 2",
        "week": "2"
      },
      "timeBlocks": [
        {
          "id": "7d362712-1750-4b95-98a7-690a26955ab5",
          "day": "Monday",
          "startTime": "09:30",
          "endTime": "10:00",
          "eventName": "Maths",
          "notes": "Consolidation",
          "confidence": null
        }
        // ... 23 more time blocks
      ],
      "recurringBlocks": [
        {
          "id": "59af7908-94cc-46a7-80a1-199fa2b87a18",
          "startTime": "08:35",
          "endTime": "08:50",
          "eventName": "Registration and Early Morning Work",
          "appliesDaily": true,
          "notes": "Shown in grey column"
        }
        // ... 10 more recurring blocks
      ]
    }
  }
}
```

---

### Step 4 (Optional): Register Webhook
```bash
curl -X POST http://localhost:3000/api/v2/timetable/jobs/{jobId}/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-webhook-url.com/callback"
  }'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "webhookId": "webhook-uuid",
    "jobId": "f4ac3c04-0a45-4f9d-b587-1cb4f8874567",
    "url": "https://your-webhook-url.com/callback",
    "createdAt": "2025-10-05T04:05:40.000Z"
  }
}
```

When job completes, webhook will receive:
```json
{
  "jobId": "f4ac3c04-0a45-4f9d-b587-1cb4f8874567",
  "status": "completed",
  "timestamp": "2025-10-05T04:06:13.535Z"
}
```

---

## Additional Endpoints

### List All Jobs
```bash
curl "http://localhost:3000/api/v2/timetable/jobs?page=1&limit=20&status=completed"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "jobs": [
      {
        "id": "f4ac3c04-0a45-4f9d-b587-1cb4f8874567",
        "status": "completed",
        "originalFileName": "Teacher Timetable Example 1.2.png",
        "createdAt": "2025-10-05T04:05:34.134Z",
        "completedAt": "2025-10-05T04:06:13.535Z",
        "processingMethod": "claude",
        "complexity": "medium",
        "errorMessage": null
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 1,
      "totalPages": 1
    }
  }
}
```

**Query Parameters:**
- `page` - Page number (default: 1)
- `limit` - Results per page (default: 20)
- `status` - Filter by status (pending/processing/completed/failed)
- `userId` - Filter by user ID

---

### Cancel Job
```bash
curl -X DELETE http://localhost:3000/api/v2/timetable/jobs/{jobId}
```

**Response:**
```json
{
  "success": true,
  "message": "Job cancelled successfully"
}
```

**Note:** Can only cancel jobs with status `pending`

---

## Complete Example Sequence

```bash
#!/bin/bash

# 1. Upload timetable
RESPONSE=$(curl -s -X POST http://localhost:3000/api/v2/timetable/upload \
  -F "file=@timetable.png" \
  -F "teacherName=Miss Joynes" \
  -F "className=2EJ")

# 2. Extract jobId
JOB_ID=$(echo $RESPONSE | jq -r '.data.jobId')
echo "Job ID: $JOB_ID"

# 3. Wait for processing (poll every 5 seconds)
while true; do
  STATUS=$(curl -s http://localhost:3000/api/v2/timetable/jobs/$JOB_ID | jq -r '.data.status')
  echo "Status: $STATUS"

  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; then
    break
  fi

  sleep 5
done

# 4. Get extraction result
if [ "$STATUS" = "completed" ]; then
  curl -s http://localhost:3000/api/v2/timetable/jobs/$JOB_ID/result | jq '.'
else
  echo "Extraction failed"
  curl -s http://localhost:3000/api/v2/timetable/jobs/$JOB_ID | jq '.data.errorMessage'
fi
```

---

## Supported File Formats

- **Images**: PNG, JPG, JPEG (max 10MB)
- **Documents**: PDF, DOCX (max 10MB)

---

## Processing Times

| File Type | Complexity | Avg Time |
|-----------|------------|----------|
| Clean typed image | Simple | 20-30s |
| Standard scan | Medium | 30-60s |
| Handwritten/complex | Complex | 60-90s |

**Processing includes:**
1. S3 upload (~1s)
2. OCR extraction (10-30s for Tesseract)
3. AI analysis (10-40s for Claude API)
4. Database persistence (~1s)

---

## Error Handling

### Common Errors

**400 - Bad Request**
```json
{
  "success": false,
  "error": "No file uploaded"
}
```

**404 - Not Found**
```json
{
  "success": false,
  "error": "Job not found"
}
```

**500 - Internal Server Error**
```json
{
  "success": false,
  "error": "Claude extraction failed: model not found"
}
```

### Retry Logic

Workers automatically retry failed jobs:
- Max retries: 3
- Retry delay: Exponential backoff
- Failed jobs moved to Dead Letter Queue after max retries

---

## Health Check

```bash
curl http://localhost:3000/api/v2/timetable/health
```

**Response:**
```json
{
  "status": "ok",
  "service": "timetable-extraction-api-v2",
  "version": "2.0.0",
  "features": {
    "asyncProcessing": true,
    "documentAI": false,
    "claudeFallback": true,
    "hybridMode": true
  }
}
```

---

## Rate Limits

Current setup has no rate limits. For production, consider:
- API Gateway rate limiting (e.g., 100 requests/minute per IP)
- SQS queue depth monitoring
- Worker auto-scaling based on queue size

---

## Production Deployment

See `DEPLOYMENT.md` for AWS deployment guide.

**Key URLs:**
- Development: http://localhost:3000
- Production: https://your-domain.com (configure in Postman environment)

---

## Support

For issues or questions:
- Check `CLAUDE.md` for technical details
- Check `TROUBLESHOOTING.md` for common issues
- Check worker logs: `docker-compose logs worker`
- Check API logs: `docker-compose logs api`

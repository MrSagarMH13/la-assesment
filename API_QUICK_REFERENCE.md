# API Quick Reference

## 🚀 Complete Workflow (3 Steps)

### 1️⃣ Upload Timetable
```bash
curl -X POST http://localhost:3000/api/v2/timetable/upload \
  -F "file=@timetable.png" \
  -F "teacherName=Miss Joynes" \
  -F "className=2EJ"
```
**→ Save the `jobId` from response**

---

### 2️⃣ Check Status (Poll until completed)
```bash
curl http://localhost:3000/api/v2/timetable/jobs/{jobId}
```
**Status: `pending` → `processing` → `completed`**

---

### 3️⃣ Get Extraction Result
```bash
curl http://localhost:3000/api/v2/timetable/jobs/{jobId}/result
```
**→ Returns complete JSON with timeBlocks & recurringBlocks**

---

### 4️⃣ Get FullCalendar Format (NEW!)
```bash
curl "http://localhost:3000/api/v2/timetable/jobs/{jobId}/fullcalendar?format=recurring&termStart=2024-09-01&termEnd=2024-12-20"
```
**→ Returns FullCalendar-ready events for direct frontend integration**

---

## 📋 All V2 Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v2/timetable/upload` | Upload timetable (async) |
| `GET` | `/api/v2/timetable/jobs/:jobId` | Check job status |
| `GET` | `/api/v2/timetable/jobs/:jobId/result` | **Get extracted JSON** ✨ |
| `GET` | `/api/v2/timetable/jobs/:jobId/fullcalendar` | **Get FullCalendar format** 📅 |
| `GET` | `/api/v2/timetable/jobs` | List all jobs (paginated) |
| `POST` | `/api/v2/timetable/jobs/:jobId/webhook` | Register webhook |
| `DELETE` | `/api/v2/timetable/jobs/:jobId` | Cancel pending job |
| `GET` | `/api/v2/timetable/health` | Health check |

---

## 📦 Postman Collection

**File:** `Timetable_Extraction_API.postman_collection.json`

### Import Steps:
1. Open Postman
2. Click **Import**
3. Select `Timetable_Extraction_API.postman_collection.json`
4. Collection auto-configures with:
   - ✅ All endpoints ready to use
   - ✅ Auto-save jobId from upload
   - ✅ Environment variables
   - ✅ Request examples

### Postman Workflow:
1. **Health Check** → Verify API is running
2. **Upload Timetable** → Auto-saves jobId
3. **Get Job Status** → Check progress (uses saved jobId)
4. **Get Extraction Result** → Download JSON (uses saved jobId)

---

## 🎯 Response Examples

### Upload Response
```json
{
  "success": true,
  "data": {
    "jobId": "f4ac3c04-0a45-4f9d-b587-1cb4f8874567",
    "status": "pending",
    "statusUrl": "/api/v2/timetable/jobs/f4ac3c04-0a45-4f9d-b587-1cb4f8874567"
  }
}
```

### Status Response
```json
{
  "success": true,
  "data": {
    "jobId": "f4ac3c04-0a45-4f9d-b587-1cb4f8874567",
    "status": "completed",
    "processingMethod": "claude",
    "complexity": "medium",
    "completedAt": "2025-10-05T04:06:13.535Z"
  }
}
```

### Result Response (NEW!)
```json
{
  "success": true,
  "data": {
    "jobId": "f4ac3c04-0a45-4f9d-b587-1cb4f8874567",
    "status": "completed",
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
          "day": "Monday",
          "startTime": "09:30",
          "endTime": "10:00",
          "eventName": "Maths",
          "notes": "Consolidation"
        }
        // ... more blocks
      ],
      "recurringBlocks": [
        {
          "startTime": "08:35",
          "endTime": "08:50",
          "eventName": "Registration",
          "appliesDaily": true
        }
        // ... more blocks
      ]
    }
  }
}
```

---

## ⏱️ Processing Times

- **Simple images**: 20-30 seconds
- **Standard scans**: 30-60 seconds  
- **Complex/handwritten**: 60-90 seconds

---

## 📝 Supported Formats

- PNG, JPG, JPEG (max 10MB)
- PDF, DOCX (max 10MB)

---

## 🔍 Troubleshooting

### Job stuck in "pending"?
```bash
# Check worker logs
docker-compose logs worker --tail 50
```

### Job failed?
```bash
# Get error message
curl http://localhost:3000/api/v2/timetable/jobs/{jobId} | jq '.data.errorMessage'
```

### Worker not processing?
```bash
# Restart workers
docker-compose restart worker
```

---

## 📚 Full Documentation

- **Complete Guide**: `API_USAGE_GUIDE.md`
- **Technical Details**: `CLAUDE.md`
- **Deployment**: `DEPLOYMENT.md`
- **Architecture**: `ARCHITECTURE.md`

---

**🎉 Ready to use! Import the Postman collection and start extracting timetables!**

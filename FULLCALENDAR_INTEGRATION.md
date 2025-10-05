# FullCalendar Integration Guide

## Overview

The Timetable Extraction API provides native FullCalendar format support, allowing you to directly integrate extracted timetables into your frontend calendar applications.

## Quick Start

### 1. Extract Timetable
```bash
# Upload timetable
curl -X POST http://localhost:3000/api/v2/timetable/upload \
  -F "file=@timetable.png" \
  -F "teacherName=Miss Smith" \
  -F "className=Year 2"

# Response: { "data": { "jobId": "abc-123" } }
```

### 2. Wait for Processing
```bash
curl http://localhost:3000/api/v2/timetable/jobs/{jobId}
# Wait until status: "completed"
```

### 3. Get FullCalendar Events
```bash
curl "http://localhost:3000/api/v2/timetable/jobs/{jobId}/fullcalendar?format=recurring&termStart=2024-09-01&termEnd=2024-12-20"
```

---

## API Endpoint

```
GET /api/v2/timetable/jobs/:jobId/fullcalendar
```

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `format` | string | No | `recurring` or `explicit` (default: `recurring`) |
| `weekStart` | string | No | ISO date for week start (e.g., "2024-10-07") |
| `termStart` | string | No | ISO date for term start (e.g., "2024-09-01") |
| `termEnd` | string | No | ISO date for term end (e.g., "2024-12-20") |

### Format Types

#### 1. Recurring Format (`format=recurring`)
Uses FullCalendar's recurring events with `daysOfWeek`, `startTime`, `endTime`.

**Best for**: Displaying repeating weekly schedules.

**Example Event**:
```json
{
  "id": "recurring-09:30-10:00-Maths",
  "title": "Maths",
  "daysOfWeek": [1, 2, 3],           // Monday, Tuesday, Wednesday
  "startTime": "09:30:00",
  "endTime": "10:00:00",
  "startRecur": "2024-09-01",        // Term start
  "endRecur": "2024-12-20",          // Term end
  "backgroundColor": "#2ecc71",
  "borderColor": "#2ecc71",
  "extendedProps": {
    "eventType": "class",
    "notes": "Consolidation",
    "teacherName": "Miss Smith",
    "className": "Year 2",
    "isRecurring": true
  }
}
```

#### 2. Explicit Format (`format=explicit`)
Creates individual one-time events for each occurrence in the specified week.

**Best for**: Single-week views or when you need explicit datetime control.

**Example Event**:
```json
{
  "id": "2024-10-07-09:30-Maths",
  "title": "Maths",
  "start": "2024-10-07T09:30:00",   // ISO datetime
  "end": "2024-10-07T10:00:00",     // ISO datetime
  "backgroundColor": "#2ecc71",
  "borderColor": "#2ecc71",
  "allDay": false,
  "extendedProps": {
    "eventType": "class",
    "teacherName": "Miss Smith",
    "className": "Year 2",
    "isRecurring": false,
    "originalDay": "Monday"
  }
}
```

---

## Frontend Integration

### React + FullCalendar Example

```javascript
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import rrulePlugin from '@fullcalendar/rrule'; // For recurring events
import { useState, useEffect } from 'react';

function TimetableCalendar({ jobId }) {
  const [events, setEvents] = useState([]);

  useEffect(() => {
    const fetchTimetable = async () => {
      const response = await fetch(
        `http://localhost:3000/api/v2/timetable/jobs/${jobId}/fullcalendar?format=recurring&termStart=2024-09-01&termEnd=2024-12-20`
      );
      const data = await response.json();
      setEvents(data.data.events);
    };

    fetchTimetable();
  }, [jobId]);

  return (
    <FullCalendar
      plugins={[dayGridPlugin, timeGridPlugin, rrulePlugin]}
      initialView="timeGridWeek"
      headerToolbar={{
        left: 'prev,next today',
        center: 'title',
        right: 'dayGridMonth,timeGridWeek,timeGridDay'
      }}
      slotMinTime="08:00:00"
      slotMaxTime="16:00:00"
      events={events}
      eventContent={(arg) => (
        <div>
          <strong>{arg.event.title}</strong>
          {arg.event.extendedProps.notes && (
            <div className="event-notes">{arg.event.extendedProps.notes}</div>
          )}
        </div>
      )}
      eventClick={(info) => {
        alert(`Event: ${info.event.title}\nType: ${info.event.extendedProps.eventType}\nTeacher: ${info.event.extendedProps.teacherName}`);
      }}
    />
  );
}
```

### Vanilla JavaScript Example

```javascript
document.addEventListener('DOMContentLoaded', async function() {
  const jobId = 'your-job-id';

  // Fetch FullCalendar events
  const response = await fetch(
    `http://localhost:3000/api/v2/timetable/jobs/${jobId}/fullcalendar?format=recurring&termStart=2024-09-01&termEnd=2024-12-20`
  );
  const data = await response.json();

  // Initialize FullCalendar
  const calendarEl = document.getElementById('calendar');
  const calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'timeGridWeek',
    plugins: [ 'dayGrid', 'timeGrid', 'rrule' ],
    slotMinTime: '08:00:00',
    slotMaxTime: '16:00:00',
    events: data.data.events,
    eventClick: function(info) {
      console.log('Event clicked:', info.event);
    }
  });

  calendar.render();
});
```

---

## Event Types & Colors

The API automatically categorizes events and assigns colors:

| Event Type | Color | Example Events |
|------------|-------|----------------|
| `class` | Green (#2ecc71) | Maths, English, Science, History |
| `assembly` | Blue (#3498db) | Assembly, Singing Assembly |
| `break` | Gray (#95a5a6) | Break, Recess |
| `lunch` | Gray (#95a5a6) | Lunch |
| `other` | Purple (#9b59b6) | Registration, Storytime, Handwriting |

---

## Extended Properties

All events include rich metadata in `extendedProps`:

```typescript
{
  eventType: 'class' | 'break' | 'assembly' | 'lunch' | 'other';
  notes?: string;                  // Additional details
  teacherName?: string;            // From metadata
  className?: string;              // From metadata
  isRecurring: boolean;            // true if recurring event
  originalDay?: string;            // e.g., "Monday, Wednesday"
}
```

### Using Extended Props in UI

```javascript
eventContent: (arg) => {
  const props = arg.event.extendedProps;
  return `
    <div class="event-${props.eventType}">
      <strong>${arg.event.title}</strong>
      ${props.notes ? `<p>${props.notes}</p>` : ''}
      <small>${props.className} - ${props.teacherName}</small>
    </div>
  `;
}
```

---

## Response Format

```json
{
  "success": true,
  "data": {
    "jobId": "abc-123",
    "events": [ /* FullCalendar events array */ ],
    "metadata": {
      "teacherName": "Miss Smith",
      "className": "Year 2",
      "term": "Spring 2",
      "week": "2",
      "totalEvents": 35,
      "format": "recurring"
    }
  }
}
```

---

## Common Use Cases

### 1. Weekly Timetable View (Recurring Events)
```bash
curl "http://localhost:3000/api/v2/timetable/jobs/{jobId}/fullcalendar?format=recurring&termStart=2024-09-01&termEnd=2024-12-20"
```

Use this when you want to display a repeating weekly schedule for the entire term.

### 2. Single Week View (Explicit Events)
```bash
curl "http://localhost:3000/api/v2/timetable/jobs/{jobId}/fullcalendar?format=explicit&weekStart=2024-10-07"
```

Use this when you want explicit datetime events for a specific week.

### 3. Current Week View (Auto-calculated)
```bash
curl "http://localhost:3000/api/v2/timetable/jobs/{jobId}/fullcalendar?format=explicit"
```

If no `weekStart` is provided, it defaults to the current week's Monday.

---

## Error Handling

```javascript
async function loadTimetable(jobId) {
  try {
    const response = await fetch(
      `http://localhost:3000/api/v2/timetable/jobs/${jobId}/fullcalendar?format=recurring&termStart=2024-09-01&termEnd=2024-12-20`
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to load timetable');
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Unknown error');
    }

    return data.data.events;

  } catch (error) {
    console.error('Failed to load timetable:', error);
    // Show user-friendly error message
    alert('Failed to load timetable. Please try again.');
    return [];
  }
}
```

---

## Best Practices

1. **Use Recurring Format for Term Views**: More efficient and FullCalendar handles the recurrence automatically.

2. **Use Explicit Format for Single Weeks**: When you need precise control over individual days.

3. **Handle Loading States**: Show loading indicators while waiting for extraction to complete.

4. **Cache Events**: Store events in state/store to avoid redundant API calls.

5. **Filter by Event Type**: Use `extendedProps.eventType` to filter/color-code events.

6. **Responsive Design**: Use FullCalendar's responsive features to adapt to mobile screens.

---

## Styling Events by Type

```css
/* Custom colors by event type */
.fc-event.event-class {
  background-color: #2ecc71 !important;
  border-color: #27ae60 !important;
}

.fc-event.event-assembly {
  background-color: #3498db !important;
  border-color: #2980b9 !important;
}

.fc-event.event-break,
.fc-event.event-lunch {
  background-color: #95a5a6 !important;
  border-color: #7f8c8d !important;
  opacity: 0.7;
}

.fc-event.event-other {
  background-color: #9b59b6 !important;
  border-color: #8e44ad !important;
}
```

---

## Complete Example

See `examples/fullcalendar-integration.html` for a complete working example with:
- Event loading
- Loading states
- Error handling
- Event type filtering
- Custom event rendering
- Click handlers

---

## Support

For issues or questions:
- Check `API_USAGE_GUIDE.md` for API details
- Check `CLAUDE.md` for technical architecture
- Test with Postman collection: `Timetable_Extraction_API.postman_collection.json`

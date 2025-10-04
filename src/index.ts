import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import timetableRoutes from './routes/timetable';
import timetableV2Routes from './routes/timetableV2';
import { errorHandler } from './middleware/errorHandler';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/timetable', timetableRoutes); // V1 - Synchronous (legacy)
app.use('/api/v2/timetable', timetableV2Routes); // V2 - Async with SQS

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Timetable Extraction API',
    version: '2.0.0',
    apis: {
      v1: {
        description: 'Synchronous extraction (legacy)',
        endpoints: {
          upload: 'POST /api/timetable/upload',
          health: 'GET /api/timetable/health'
        }
      },
      v2: {
        description: 'Async extraction with SQS queue',
        endpoints: {
          upload: 'POST /api/v2/timetable/upload',
          getJob: 'GET /api/v2/timetable/jobs/:jobId',
          listJobs: 'GET /api/v2/timetable/jobs',
          registerWebhook: 'POST /api/v2/timetable/jobs/:jobId/webhook',
          cancelJob: 'DELETE /api/v2/timetable/jobs/:jobId',
          health: 'GET /api/v2/timetable/health'
        }
      }
    },
    features: {
      documentAI: process.env.USE_DOCUMENT_AI === 'true',
      claudeFallback: process.env.USE_CLAUDE_FALLBACK === 'true',
      hybridMode: process.env.USE_HYBRID_MODE === 'true',
      asyncProcessing: true,
      intelligentRouting: true
    }
  });
});

// Error handling middleware (must be last)
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 API: http://localhost:${PORT}`);
  console.log(`📤 V1 Upload: http://localhost:${PORT}/api/timetable/upload`);
  console.log(`📤 V2 Upload: http://localhost:${PORT}/api/v2/timetable/upload`);
  console.log(`👷 Start worker with: npm run worker`);
});

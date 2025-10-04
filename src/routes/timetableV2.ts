import { Router, Request, Response, NextFunction } from 'express';
import { upload } from '../middleware/upload';
import { S3Service } from '../services/s3Service';
import { SQSService } from '../services/sqsService';
import { AppError } from '../middleware/errorHandler';
import { PrismaClient } from '../generated/prisma';
import fs from 'fs/promises';

const router = Router();
const prisma = new PrismaClient();
const s3Service = new S3Service();
const sqsService = new SQSService();

/**
 * POST /api/v2/timetable/upload
 * Async upload: Returns job ID immediately, processes in background
 */
router.post('/upload', upload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  let filePath: string | undefined;

  try {
    // Validate file upload
    if (!req.file) {
      throw new AppError(400, 'No file uploaded');
    }

    filePath = req.file.path;
    const { mimetype: mimeType, originalname: originalName, size: fileSize } = req.file;

    // Extract metadata from request body
    const teacherName = req.body.teacherName;
    const className = req.body.className;
    const userId = req.body.userId || null;
    const webhookUrl = req.body.webhookUrl; // Optional webhook for notifications

    console.log(`[Upload] Received file: ${originalName} (${mimeType}, ${fileSize} bytes)`);

    // Step 1: Upload file to S3
    const s3Key = S3Service.generateFileKey(userId, originalName);
    const fileUrl = await s3Service.uploadFile(filePath, s3Key, mimeType);
    console.log(`[Upload] File uploaded to S3: ${s3Key}`);

    // Step 2: Create extraction job in database
    const job = await prisma.extractionJob.create({
      data: {
        userId,
        fileUrl,
        originalFileName: originalName,
        fileSize,
        mimeType,
        teacherName,
        className,
        status: 'pending'
      }
    });

    console.log(`[Upload] Created job: ${job.id}`);

    // Step 3: Register webhook if provided
    if (webhookUrl) {
      await prisma.webhook.create({
        data: {
          jobId: job.id,
          url: webhookUrl
        }
      });
      console.log(`[Upload] Webhook registered: ${webhookUrl}`);
    }

    // Step 4: Enqueue job to SQS
    await sqsService.enqueueJob({
      jobId: job.id,
      fileUrl,
      originalFileName: originalName,
      mimeType,
      teacherName,
      className,
      userId
    });

    console.log(`[Upload] Job ${job.id} enqueued to SQS`);

    // Step 5: Cleanup local file
    await fs.unlink(filePath);

    // Step 6: Return job ID immediately
    res.status(202).json({
      success: true,
      message: 'File uploaded successfully. Processing in background.',
      data: {
        jobId: job.id,
        status: 'pending',
        createdAt: job.createdAt,
        statusUrl: `/api/v2/timetable/jobs/${job.id}`,
        webhookRegistered: !!webhookUrl
      }
    });

  } catch (error) {
    // Cleanup on error
    if (filePath) {
      try {
        await fs.unlink(filePath);
      } catch {}
    }

    next(error instanceof AppError ? error : new AppError(500, error instanceof Error ? error.message : 'Upload failed'));
  }
});

/**
 * GET /api/v2/timetable/jobs/:jobId
 * Get job status and results
 */
router.get('/jobs/:jobId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;

    const job = await prisma.extractionJob.findUnique({
      where: { id: jobId },
      include: {
        timetable: {
          include: {
            timeBlocks: true,
            recurringBlocks: true
          }
        },
        retryLogs: true
      }
    });

    if (!job) {
      throw new AppError(404, 'Job not found');
    }

    // Build response based on job status
    const response: any = {
      success: true,
      data: {
        jobId: job.id,
        status: job.status,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        processingMethod: job.processingMethod,
        complexity: job.complexity,
        retryCount: job.retryCount,
        originalFileName: job.originalFileName
      }
    };

    // Include results if completed
    if (job.status === 'completed' && job.timetable) {
      response.data.result = {
        timetableId: job.timetable.id,
        metadata: {
          teacherName: job.timetable.teacherName,
          className: job.timetable.className,
          term: job.timetable.term,
          week: job.timetable.week
        },
        blocks: job.timetable.timeBlocks,
        recurringBlocks: job.timetable.recurringBlocks
      };

      // Include pre-signed URL for result JSON
      if (job.resultUrl) {
        const resultKey = job.resultUrl.split('.com/')[1];
        response.data.resultDownloadUrl = await s3Service.getSignedUrl(resultKey, 3600);
      }
    }

    // Include error if failed
    if (job.status === 'failed') {
      response.data.error = job.errorMessage;
      response.data.retryLogs = job.retryLogs;
    }

    res.json(response);

  } catch (error) {
    next(error instanceof AppError ? error : new AppError(500, error instanceof Error ? error.message : 'Failed to fetch job'));
  }
});

/**
 * GET /api/v2/timetable/jobs
 * List user's jobs (paginated)
 */
router.get('/jobs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.query.userId as string;
    const status = req.query.status as string;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    const where: any = {};
    if (userId) where.userId = userId;
    if (status) where.status = status;

    const [jobs, total] = await Promise.all([
      prisma.extractionJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          status: true,
          originalFileName: true,
          createdAt: true,
          completedAt: true,
          processingMethod: true,
          complexity: true,
          errorMessage: true
        }
      }),
      prisma.extractionJob.count({ where })
    ]);

    res.json({
      success: true,
      data: {
        jobs,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    next(error instanceof AppError ? error : new AppError(500, error instanceof Error ? error.message : 'Failed to list jobs'));
  }
});

/**
 * POST /api/v2/timetable/jobs/:jobId/webhook
 * Register webhook for job completion
 */
router.post('/jobs/:jobId/webhook', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;
    const { url } = req.body;

    if (!url) {
      throw new AppError(400, 'Webhook URL is required');
    }

    const job = await prisma.extractionJob.findUnique({
      where: { id: jobId }
    });

    if (!job) {
      throw new AppError(404, 'Job not found');
    }

    const webhook = await prisma.webhook.create({
      data: {
        jobId,
        url
      }
    });

    res.json({
      success: true,
      data: {
        webhookId: webhook.id,
        jobId,
        url,
        createdAt: webhook.createdAt
      }
    });

  } catch (error) {
    next(error instanceof AppError ? error : new AppError(500, error instanceof Error ? error.message : 'Failed to register webhook'));
  }
});

/**
 * DELETE /api/v2/timetable/jobs/:jobId
 * Cancel pending job (if not yet processing)
 */
router.delete('/jobs/:jobId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;

    const job = await prisma.extractionJob.findUnique({
      where: { id: jobId }
    });

    if (!job) {
      throw new AppError(404, 'Job not found');
    }

    if (job.status === 'processing' || job.status === 'completed') {
      throw new AppError(400, `Cannot cancel job with status: ${job.status}`);
    }

    await prisma.extractionJob.update({
      where: { id: jobId },
      data: {
        status: 'cancelled',
        completedAt: new Date()
      }
    });

    res.json({
      success: true,
      message: 'Job cancelled successfully'
    });

  } catch (error) {
    next(error instanceof AppError ? error : new AppError(500, error instanceof Error ? error.message : 'Failed to cancel job'));
  }
});

// Health check endpoint
router.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'timetable-extraction-api-v2',
    version: '2.0.0',
    features: {
      asyncProcessing: true,
      documentAI: process.env.USE_DOCUMENT_AI === 'true',
      claudeFallback: process.env.USE_CLAUDE_FALLBACK === 'true',
      hybridMode: process.env.USE_HYBRID_MODE === 'true'
    }
  });
});

export default router;

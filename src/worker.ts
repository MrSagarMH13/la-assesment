import dotenv from 'dotenv';
import { SQSService, ExtractionJobMessage } from './services/sqsService';
import { S3Service } from './services/s3Service';
import { FileProcessor } from './utils/fileProcessor';
import { ExtractionOrchestrator } from './services/extractionOrchestrator';
import { PrismaClient } from './generated/prisma';
import { Message } from '@aws-sdk/client-sqs';

// Load environment variables
dotenv.config();

const prisma = new PrismaClient();
const sqsService = new SQSService();
const s3Service = new S3Service();
const orchestrator = new ExtractionOrchestrator();

class ExtractionWorker {
  private isRunning = false;
  private concurrency: number;

  constructor() {
    this.concurrency = parseInt(process.env.WORKER_CONCURRENCY || '5');
  }

  /**
   * Start the worker process
   */
  async start() {
    console.log('🚀 Extraction Worker starting...');
    console.log(`Concurrency: ${this.concurrency}`);

    this.isRunning = true;

    // Start multiple concurrent workers
    const workers = Array.from({ length: this.concurrency }, (_, i) =>
      this.processLoop(i + 1)
    );

    await Promise.all(workers);
  }

  /**
   * Stop the worker gracefully
   */
  async stop() {
    console.log('Stopping worker...');
    this.isRunning = false;
    await prisma.$disconnect();
  }

  /**
   * Main processing loop for a single worker
   */
  private async processLoop(workerId: number) {
    console.log(`Worker ${workerId} started`);

    while (this.isRunning) {
      try {
        // Receive messages from SQS
        const messages = await sqsService.receiveMessages(1, 20);

        if (messages.length === 0) {
          // No messages, continue polling
          continue;
        }

        for (const message of messages) {
          await this.processMessage(message, workerId);
        }
      } catch (error) {
        console.error(`Worker ${workerId} error:`, error);
        // Wait a bit before retrying
        await this.sleep(5000);
      }
    }

    console.log(`Worker ${workerId} stopped`);
  }

  /**
   * Process a single SQS message
   */
  private async processMessage(message: Message, workerId: number) {
    const jobData = SQSService.parseMessage(message);

    if (!jobData) {
      console.error('Failed to parse message, deleting...');
      if (message.ReceiptHandle) {
        await sqsService.deleteMessage(message.ReceiptHandle);
      }
      return;
    }

    const { jobId } = jobData;
    console.log(`[Worker ${workerId}] Processing job ${jobId}`);

    try {
      // Update job status to processing
      await this.updateJobStatus(jobId, 'processing');

      // Process the extraction
      const result = await this.extractTimetable(jobData);

      // Save results
      await this.saveResults(jobId, result);

      // Update job status to completed
      await this.updateJobStatus(jobId, 'completed');

      // Trigger webhooks
      await this.triggerWebhooks(jobId);

      // Delete message from queue (success)
      if (message.ReceiptHandle) {
        await sqsService.deleteMessage(message.ReceiptHandle);
      }

      console.log(`[Worker ${workerId}] Job ${jobId} completed successfully`);

    } catch (error) {
      console.error(`[Worker ${workerId}] Job ${jobId} failed:`, error);
      await this.handleJobFailure(jobId, error, jobData, message);
    }
  }

  /**
   * Extract timetable from file
   */
  private async extractTimetable(jobData: ExtractionJobMessage) {
    // Download file from S3 to temp location
    const tempPath = `/tmp/${jobData.jobId}-${jobData.originalFileName}`;

    // For now, assume file is already in S3
    // In production, download from S3, process, then cleanup

    // Process file (OCR, image prep)
    const processedFile = await FileProcessor.processFile(
      tempPath,
      jobData.mimeType,
      jobData.originalFileName
    );

    // Run intelligent extraction
    const result = await orchestrator.extract(processedFile, {
      teacherName: jobData.teacherName,
      className: jobData.className
    });

    return result;
  }

  /**
   * Save extraction results to database and S3
   */
  private async saveResults(jobId: string, result: any) {
    // Save result JSON to S3
    const resultKey = S3Service.generateResultKey(jobId);
    const resultUrl = await s3Service.uploadJSON(result.data, resultKey);

    // Create timetable in database
    const timetable = await prisma.timetable.create({
      data: {
        teacherName: result.data.metadata.teacherName,
        className: result.data.metadata.className,
        term: result.data.metadata.term,
        week: result.data.metadata.week,
        timeBlocks: {
          create: result.data.blocks.map((block: any) => ({
            day: block.day,
            startTime: block.startTime,
            endTime: block.endTime,
            eventName: block.eventName,
            notes: block.notes,
            isFixed: block.isFixed || false,
            color: block.color,
            confidence: block.confidence
          }))
        },
        recurringBlocks: {
          create: (result.data.recurringBlocks || []).map((block: any) => ({
            startTime: block.startTime,
            endTime: block.endTime,
            eventName: block.eventName,
            appliesDaily: block.appliesDaily !== false,
            notes: block.notes
          }))
        }
      }
    });

    // Update job with results
    await prisma.extractionJob.update({
      where: { id: jobId },
      data: {
        timetableId: timetable.id,
        resultUrl,
        processingMethod: result.method,
        complexity: result.complexity.level,
        completedAt: new Date()
      }
    });
  }

  /**
   * Update job status
   */
  private async updateJobStatus(jobId: string, status: string) {
    await prisma.extractionJob.update({
      where: { id: jobId },
      data: {
        status,
        ...(status === 'processing' && { startedAt: new Date() })
      }
    });
  }

  /**
   * Handle job failure with retry logic
   */
  private async handleJobFailure(
    jobId: string,
    error: any,
    jobData: ExtractionJobMessage,
    message: Message
  ) {
    const job = await prisma.extractionJob.findUnique({
      where: { id: jobId }
    });

    if (!job) {
      console.error('Job not found:', jobId);
      return;
    }

    const retryCount = job.retryCount + 1;
    const maxRetries = job.maxRetries;

    // Log retry
    await prisma.retryLog.create({
      data: {
        jobId,
        attemptNumber: retryCount,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        errorType: this.classifyError(error),
        stackTrace: error instanceof Error ? error.stack : undefined
      }
    });

    if (retryCount < maxRetries) {
      // Retry: update retry count and leave message in queue
      await prisma.extractionJob.update({
        where: { id: jobId },
        data: {
          retryCount,
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        }
      });

      console.log(`Job ${jobId} will retry (attempt ${retryCount}/${maxRetries})`);

      // Message will automatically become visible again after visibility timeout

    } else {
      // Max retries exceeded: mark as failed and send to DLQ
      await prisma.extractionJob.update({
        where: { id: jobId },
        data: {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          completedAt: new Date()
        }
      });

      // Send to Dead Letter Queue
      await sqsService.sendToDLQ(jobData, error instanceof Error ? error.message : 'Unknown error');

      // Delete from main queue
      if (message.ReceiptHandle) {
        await sqsService.deleteMessage(message.ReceiptHandle);
      }

      console.error(`Job ${jobId} failed permanently after ${maxRetries} retries`);
    }
  }

  /**
   * Classify error type for monitoring
   */
  private classifyError(error: any): string {
    const message = error instanceof Error ? error.message.toLowerCase() : '';

    if (message.includes('ocr')) return 'ocr_error';
    if (message.includes('document ai')) return 'document_ai_error';
    if (message.includes('claude')) return 'llm_error';
    if (message.includes('validation')) return 'validation_error';
    if (message.includes('s3')) return 's3_error';
    if (message.includes('database') || message.includes('prisma')) return 'database_error';

    return 'unknown_error';
  }

  /**
   * Trigger webhooks for job completion
   */
  private async triggerWebhooks(jobId: string) {
    const webhooks = await prisma.webhook.findMany({
      where: {
        jobId,
        delivered: false
      }
    });

    for (const webhook of webhooks) {
      try {
        // Trigger webhook (HTTP POST)
        const response = await fetch(webhook.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobId,
            status: 'completed',
            timestamp: new Date().toISOString()
          })
        });

        if (response.ok) {
          await prisma.webhook.update({
            where: { id: webhook.id },
            data: {
              delivered: true,
              deliveredAt: new Date()
            }
          });
        } else {
          throw new Error(`Webhook returned ${response.status}`);
        }

      } catch (error) {
        console.error('Webhook delivery failed:', error);

        const attempts = webhook.attempts + 1;

        if (attempts < webhook.maxAttempts) {
          await prisma.webhook.update({
            where: { id: webhook.id },
            data: {
              attempts,
              lastAttemptAt: new Date(),
              errorMessage: error instanceof Error ? error.message : 'Unknown error'
            }
          });
        } else {
          console.error(`Webhook ${webhook.id} failed after ${webhook.maxAttempts} attempts`);
        }
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Start worker
const worker = new ExtractionWorker();

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  await worker.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Received SIGINT, shutting down gracefully...');
  await worker.stop();
  process.exit(0);
});

// Start the worker
worker.start().catch(async (error) => {
  console.error('Worker fatal error:', error);
  await worker.stop();
  process.exit(1);
});

import { SQSClient, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand, Message } from '@aws-sdk/client-sqs';

export interface ExtractionJobMessage {
  jobId: string;
  fileUrl: string;
  originalFileName: string;
  mimeType: string;
  teacherName?: string;
  className?: string;
  userId?: string;
}

export class SQSService {
  private client: SQSClient;
  private queueUrl: string;
  private dlqUrl: string;

  constructor() {
    this.queueUrl = process.env.AWS_SQS_QUEUE_URL || '';
    this.dlqUrl = process.env.AWS_SQS_DLQ_URL || '';

    this.client = new SQSClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
      }
    });
  }

  /**
   * Send extraction job to SQS queue
   */
  async enqueueJob(jobData: ExtractionJobMessage): Promise<string> {
    try {
      const command = new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(jobData),
        MessageAttributes: {
          jobId: {
            DataType: 'String',
            StringValue: jobData.jobId
          },
          userId: {
            DataType: 'String',
            StringValue: jobData.userId || 'anonymous'
          }
        },
        // Delay delivery by specified seconds (optional)
        // DelaySeconds: 0
      });

      const response = await this.client.send(command);
      return response.MessageId || '';
    } catch (error) {
      throw new Error(`SQS enqueue failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Receive messages from queue (used by worker)
   */
  async receiveMessages(maxMessages: number = 1, waitTimeSeconds: number = 20): Promise<Message[]> {
    try {
      const command = new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: maxMessages,
        WaitTimeSeconds: waitTimeSeconds, // Long polling
        VisibilityTimeout: 300, // 5 minutes to process
        MessageAttributeNames: ['All']
      });

      const response = await this.client.send(command);
      return response.Messages || [];
    } catch (error) {
      throw new Error(`SQS receive failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete message from queue (after successful processing)
   */
  async deleteMessage(receiptHandle: string): Promise<void> {
    try {
      const command = new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle
      });

      await this.client.send(command);
    } catch (error) {
      console.error('SQS delete error:', error);
      // Don't throw - message will become visible again
    }
  }

  /**
   * Send failed job to Dead Letter Queue
   */
  async sendToDLQ(jobData: ExtractionJobMessage, errorMessage: string): Promise<void> {
    try {
      const command = new SendMessageCommand({
        QueueUrl: this.dlqUrl,
        MessageBody: JSON.stringify({
          ...jobData,
          error: errorMessage,
          failedAt: new Date().toISOString()
        }),
        MessageAttributes: {
          jobId: {
            DataType: 'String',
            StringValue: jobData.jobId
          },
          errorType: {
            DataType: 'String',
            StringValue: 'extraction_failure'
          }
        }
      });

      await this.client.send(command);
    } catch (error) {
      console.error('Failed to send to DLQ:', error);
    }
  }

  /**
   * Parse SQS message body
   */
  static parseMessage(message: Message): ExtractionJobMessage | null {
    try {
      if (!message.Body) return null;
      return JSON.parse(message.Body) as ExtractionJobMessage;
    } catch (error) {
      console.error('Failed to parse SQS message:', error);
      return null;
    }
  }
}

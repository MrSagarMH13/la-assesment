import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
// import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import fs from 'fs/promises';
import path from 'path';

export class S3Service {
  private client: S3Client;
  private bucket: string;

  constructor() {
    this.bucket = process.env.AWS_S3_BUCKET || 'timetable-uploads';

    const config: any = {
      region: process.env.AWS_REGION || 'ap-south-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
      }
    };

    // Use LocalStack endpoint for local development
    if (process.env.AWS_ENDPOINT_URL) {
      config.endpoint = process.env.AWS_ENDPOINT_URL;
      config.forcePathStyle = true; // Required for LocalStack
    }

    this.client = new S3Client(config);
  }

  /**
   * Upload file to S3
   */
  async uploadFile(filePath: string, key: string, contentType: string): Promise<string> {
    try {
      const fileContent = await fs.readFile(filePath);

      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: fileContent,
        ContentType: contentType,
        // ServerSideEncryption: 'AES256' // Enable encryption at rest
      });

      await this.client.send(command);

      return `https://${this.bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
    } catch (error) {
      throw new Error(`S3 upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Upload buffer to S3
   */
  async uploadBuffer(buffer: Buffer, key: string, contentType: string): Promise<string> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      });

      await this.client.send(command);

      return `https://${this.bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
    } catch (error) {
      throw new Error(`S3 buffer upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Upload JSON result to S3
   */
  async uploadJSON(data: any, key: string): Promise<string> {
    const buffer = Buffer.from(JSON.stringify(data, null, 2));
    return this.uploadBuffer(buffer, key, 'application/json');
  }

  /**
   * Download file from S3 to local path
   */
  async downloadFile(s3Url: string, localPath: string): Promise<void> {
    try {
      // Extract key from URL
      const key = s3Url.split('/').slice(3).join('/');

      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key
      });

      const response = await this.client.send(command);
      const stream = response.Body as any;

      // Convert stream to buffer and write to file
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      await fs.writeFile(localPath, buffer);
    } catch (error) {
      throw new Error(`S3 download failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get pre-signed URL for temporary access
   * Note: Requires @aws-sdk/s3-request-presigner package
   */
  async getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    // For now, return public URL (works if bucket is public)
    // To enable signed URLs, install: npm install @aws-sdk/s3-request-presigner
    // and uncomment the import at the top

    // const command = new GetObjectCommand({
    //   Bucket: this.bucket,
    //   Key: key
    // });
    // return getSignedUrl(this.client, command, { expiresIn });

    // Return direct URL for now
    return `https://${this.bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
  }

  /**
   * Delete file from S3
   */
  async deleteFile(key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key
      });

      await this.client.send(command);
    } catch (error) {
      console.error('S3 delete error:', error);
      // Don't throw - deletion failures shouldn't break the flow
    }
  }

  /**
   * Generate S3 key for uploaded file
   */
  static generateFileKey(userId: string | null, filename: string): string {
    const timestamp = Date.now();
    const sanitized = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    const userPrefix = userId ? `users/${userId}` : 'anonymous';
    return `uploads/${userPrefix}/${timestamp}-${sanitized}`;
  }

  /**
   * Generate S3 key for result JSON
   */
  static generateResultKey(jobId: string): string {
    return `results/${jobId}/extraction-result.json`;
  }
}

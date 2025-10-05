import Tesseract from 'tesseract.js';
import mammoth from 'mammoth';
import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';

export interface ProcessedFile {
  text?: string;
  imageBuffer?: Buffer;
  mimeType: string;
  originalName: string;
}

export class FileProcessor {
  /**
   * Process uploaded file based on its type
   */
  static async processFile(filePath: string, mimeType: string, originalName: string): Promise<ProcessedFile> {
    try {
      if (mimeType.startsWith('image/')) {
        return await this.processImage(filePath, mimeType, originalName);
      } else if (mimeType === 'application/pdf') {
        return await this.processPDF(filePath, mimeType, originalName);
      } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        return await this.processDOCX(filePath, mimeType, originalName);
      } else {
        throw new Error(`Unsupported file type: ${mimeType}`);
      }
    } catch (error) {
      throw new Error(`File processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Process image files - extract text via OCR and prepare for vision API
   */
  private static async processImage(filePath: string, mimeType: string, originalName: string): Promise<ProcessedFile> {
    // Read image buffer for vision API
    const imageBuffer = await fs.readFile(filePath);

    // Convert to PNG if needed for better OCR
    const processedBuffer = await sharp(imageBuffer)
      .png()
      .toBuffer();

    // Extract text using Tesseract OCR
    const { data } = await Tesseract.recognize(processedBuffer, 'eng', {
      logger: m => console.log(m)
    });

    return {
      text: data.text,
      imageBuffer: imageBuffer,
      mimeType,
      originalName
    };
  }

  /**
   * Process PDF files - extract text and convert first page to image for vision API
   */
  private static async processPDF(filePath: string, mimeType: string, originalName: string): Promise<ProcessedFile> {
    const dataBuffer = await fs.readFile(filePath);

    // Use dynamic import for pdf-parse to avoid ESM issues
    const pdfParse = await import('pdf-parse');
    const pdf = pdfParse.default || pdfParse;
    const pdfData = await (pdf as any)(dataBuffer);

    // For PDFs, we'll rely primarily on the vision API with the image
    // But we can use the text as a fallback
    return {
      text: pdfData.text,
      imageBuffer: dataBuffer, // We'll let Claude's vision handle PDF rendering
      mimeType,
      originalName
    };
  }

  /**
   * Process DOCX files - extract text and tables
   */
  private static async processDOCX(filePath: string, mimeType: string, originalName: string): Promise<ProcessedFile> {
    const dataBuffer = await fs.readFile(filePath);
    const result = await mammoth.extractRawText({ buffer: dataBuffer });

    return {
      text: result.value,
      mimeType,
      originalName
    };
  }

  /**
   * Clean up temporary files
   */
  static async cleanup(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  }
}

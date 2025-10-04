import { DocumentProcessorServiceClient } from '@google-cloud/documentai';
import { ProcessedFile } from '../utils/fileProcessor';
import { ExtractedData, TimeBlock } from '../types/timetable';

export class DocumentAIService {
  private client: DocumentProcessorServiceClient;
  private projectId: string;
  private location: string;
  private processorId: string;

  constructor() {
    this.projectId = process.env.GOOGLE_PROJECT_ID || '';
    this.location = process.env.GOOGLE_LOCATION || 'us';
    this.processorId = process.env.GOOGLE_PROCESSOR_ID || '';

    // Initialize client with service account credentials
    this.client = new DocumentProcessorServiceClient({
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
    });
  }

  /**
   * Extract timetable using Google Document AI
   */
  async extractTimetable(processedFile: ProcessedFile, metadata?: { teacherName?: string; className?: string }): Promise<ExtractedData> {
    try {
      if (!processedFile.imageBuffer) {
        throw new Error('Image buffer required for Document AI');
      }

      // Construct the processor name
      const name = `projects/${this.projectId}/locations/${this.location}/processors/${this.processorId}`;

      // Process the document
      const [result] = await this.client.processDocument({
        name,
        rawDocument: {
          content: processedFile.imageBuffer,
          mimeType: processedFile.mimeType
        }
      });

      if (!result.document) {
        throw new Error('No document returned from Document AI');
      }

      // Extract structured data from Document AI response
      return this.parseDocumentAIResponse(result.document, metadata);
    } catch (error) {
      throw new Error(`Document AI extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Parse Document AI response into our timetable format
   */
  private parseDocumentAIResponse(document: any, metadata?: { teacherName?: string; className?: string }): ExtractedData {
    const blocks: TimeBlock[] = [];
    const warnings: string[] = [];

    // Document AI returns entities and tables
    const text = document.text || '';
    const entities = document.entities || [];
    const tables = document.pages?.[0]?.tables || [];

    // Extract metadata from entities
    const extractedMetadata: any = {
      teacherName: metadata?.teacherName,
      className: metadata?.className
    };

    // Look for teacher name, class, term, week in entities
    for (const entity of entities) {
      const entityType = entity.type?.toLowerCase();
      const entityText = this.getTextFromTextAnchor(entity.textAnchor, text);

      if (entityType?.includes('teacher') || entityType?.includes('name')) {
        extractedMetadata.teacherName = extractedMetadata.teacherName || entityText;
      } else if (entityType?.includes('class')) {
        extractedMetadata.className = extractedMetadata.className || entityText;
      } else if (entityType?.includes('term')) {
        extractedMetadata.term = entityText;
      } else if (entityType?.includes('week')) {
        extractedMetadata.week = entityText;
      }
    }

    // Process tables to extract time blocks
    if (tables.length > 0) {
      const tableData = this.extractTableData(tables[0], text);
      const extractedBlocks = this.parseTableToTimeBlocks(tableData);
      blocks.push(...extractedBlocks);
    } else {
      warnings.push('No tables detected in document - using text-based extraction');
      // Fallback: parse text manually (less accurate)
      const textBlocks = this.extractFromText(text);
      blocks.push(...textBlocks);
    }

    if (blocks.length === 0) {
      warnings.push('No time blocks extracted - document may be too complex for Document AI');
    }

    return {
      metadata: extractedMetadata,
      blocks,
      warnings
    };
  }

  /**
   * Extract table data from Document AI table structure
   */
  private extractTableData(table: any, documentText: string): string[][] {
    const rows: string[][] = [];
    const headerRows = table.headerRows || [];
    const bodyRows = table.bodyRows || [];

    // Process header rows
    for (const row of headerRows) {
      const rowData: string[] = [];
      for (const cell of row.cells || []) {
        const cellText = this.getTextFromTextAnchor(cell.layout?.textAnchor, documentText);
        rowData.push(cellText.trim());
      }
      rows.push(rowData);
    }

    // Process body rows
    for (const row of bodyRows) {
      const rowData: string[] = [];
      for (const cell of row.cells || []) {
        const cellText = this.getTextFromTextAnchor(cell.layout?.textAnchor, documentText);
        rowData.push(cellText.trim());
      }
      rows.push(rowData);
    }

    return rows;
  }

  /**
   * Convert table data to time blocks
   */
  private parseTableToTimeBlocks(tableData: string[][]): TimeBlock[] {
    const blocks: TimeBlock[] = [];

    if (tableData.length < 2) return blocks;

    // Assume first row is headers (days)
    const headers = tableData[0];
    const days = this.extractDaysFromHeaders(headers);

    // Process each row as time slots
    for (let i = 1; i < tableData.length; i++) {
      const row = tableData[i];

      // First column usually contains time
      const timeSlot = row[0];
      const times = this.extractTimes(timeSlot);

      if (!times) continue;

      // Each subsequent column corresponds to a day
      for (let j = 1; j < row.length && j < days.length + 1; j++) {
        const eventName = row[j]?.trim();
        if (!eventName || eventName === '') continue;

        blocks.push({
          day: days[j - 1],
          startTime: times.start,
          endTime: times.end,
          eventName,
          isFixed: false,
          confidence: 0.85 // Document AI confidence
        });
      }
    }

    return blocks;
  }

  /**
   * Extract day names from headers
   */
  private extractDaysFromHeaders(headers: string[]): string[] {
    const dayPatterns = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'mon', 'tue', 'wed', 'thu', 'fri'];
    const days: string[] = [];

    for (const header of headers) {
      const lower = header.toLowerCase();
      for (const pattern of dayPatterns) {
        if (lower.includes(pattern)) {
          // Normalize to full day name
          const fullDay = pattern.length === 3
            ? { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday' }[pattern]
            : header;
          days.push(fullDay || header);
          break;
        }
      }
    }

    return days;
  }

  /**
   * Extract start and end times from text
   */
  private extractTimes(text: string): { start: string; end: string } | null {
    // Match patterns like "9:00 - 10:00", "9:00-10:00", "09:00 - 10:00"
    const timeRange = text.match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/);

    if (timeRange) {
      const startHour = timeRange[1].padStart(2, '0');
      const startMin = timeRange[2];
      const endHour = timeRange[3].padStart(2, '0');
      const endMin = timeRange[4];

      return {
        start: `${startHour}:${startMin}`,
        end: `${endHour}:${endMin}`
      };
    }

    return null;
  }

  /**
   * Get text from text anchor (Document AI structure)
   */
  private getTextFromTextAnchor(textAnchor: any, documentText: string): string {
    if (!textAnchor || !textAnchor.textSegments) return '';

    let text = '';
    for (const segment of textAnchor.textSegments) {
      const startIndex = parseInt(segment.startIndex || '0');
      const endIndex = parseInt(segment.endIndex || '0');
      text += documentText.substring(startIndex, endIndex);
    }

    return text;
  }

  /**
   * Fallback: Extract from plain text (less accurate)
   */
  private extractFromText(text: string): TimeBlock[] {
    // Simple text-based extraction
    // This is a fallback - Document AI should handle most cases
    return [];
  }
}

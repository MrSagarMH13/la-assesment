import Anthropic from '@anthropic-ai/sdk';
import { ProcessedFile } from '../utils/fileProcessor';
import { ExtractedData, TimeBlock, RecurringBlock } from '../types/timetable';

export class ClaudeService {
  private client: Anthropic;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required');
    }
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Extract timetable data using Claude's vision and text analysis
   * (Primary extraction for complex cases)
   */
  async extractTimetable(processedFile: ProcessedFile, metadata?: { teacherName?: string; className?: string }): Promise<ExtractedData> {
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(processedFile, metadata);

    try {
      const message = await this.client.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4000,
        temperature: 0,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: userPrompt
          }
        ]
      });

      const response = message.content[0];
      if (response.type !== 'text') {
        throw new Error('Unexpected response type from Claude');
      }

      return this.parseClaudeResponse(response.text, metadata);
    } catch (error) {
      throw new Error(`Claude extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Build system prompt for Claude
   */
  private buildSystemPrompt(): string {
    return `You are an expert at extracting structured timetable data from various formats (images, PDFs, documents).

Your task is to analyze teacher timetables and extract ALL timeblock events with their exact timings.

KEY RULES:
1. **Time Accuracy**: Extract exact start and end times. If times are missing but duration is clear, calculate them.
2. **Recurring Blocks**: Identify "fixed" blocks that occur at the same time daily (e.g., Registration, Lunch, Break) - these are often shown in grey or mentioned once for all days.
3. **Implicit Timings**: If a time slot has multiple events but no explicit time splits, divide the duration equally.
4. **Table Structure**: Detect whether days are columns or rows. Handle both layouts.
5. **Preserve Names**: Keep original event names exactly as written, including notes in parentheses.
6. **Merged Cells**: If an event spans multiple days at the same time, create separate entries for each day.
7. **Vertical Text**: Read rotated/vertical text correctly.
8. **Metadata**: Extract teacher name, class name, term, and week if visible.

OUTPUT FORMAT (JSON):
{
  "metadata": {
    "teacherName": "string or null",
    "className": "string or null",
    "term": "string or null",
    "week": "string or null"
  },
  "blocks": [
    {
      "day": "Monday|Tuesday|Wednesday|Thursday|Friday",
      "startTime": "HH:MM",
      "endTime": "HH:MM",
      "eventName": "Exact event name",
      "notes": "Any additional notes or details",
      "isFixed": false
    }
  ],
  "recurringBlocks": [
    {
      "startTime": "HH:MM",
      "endTime": "HH:MM",
      "eventName": "Event name",
      "appliesDaily": true,
      "notes": "optional"
    }
  ],
  "warnings": ["Any issues or assumptions made"]
}

Return ONLY valid JSON, no other text.`;
  }

  /**
   * Build user prompt based on file type
   */
  private buildUserPrompt(processedFile: ProcessedFile, metadata?: { teacherName?: string; className?: string }): any[] {
    const content: any[] = [];

    // Add metadata if provided
    if (metadata?.teacherName || metadata?.className) {
      content.push({
        type: 'text',
        text: `Additional context: ${metadata.teacherName ? `Teacher: ${metadata.teacherName}` : ''} ${metadata.className ? `Class: ${metadata.className}` : ''}`
      });
    }

    // Add image if available (for vision analysis)
    if (processedFile.imageBuffer) {
      const base64Image = processedFile.imageBuffer.toString('base64');
      const mediaType = processedFile.mimeType.startsWith('image/')
        ? processedFile.mimeType
        : processedFile.mimeType === 'application/pdf'
          ? 'application/pdf'
          : 'image/png';

      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType,
          data: base64Image
        }
      });
    }

    // Add text as fallback/supplement
    if (processedFile.text) {
      content.push({
        type: 'text',
        text: `OCR/Extracted Text:\n${processedFile.text}\n\nAnalyze the timetable and extract all information according to the system prompt.`
      });
    } else {
      content.push({
        type: 'text',
        text: 'Analyze this timetable image and extract all information according to the system prompt.'
      });
    }

    return content;
  }

  /**
   * Validate and enhance Document AI extraction using Claude
   * (Hybrid mode: Document AI provides structure, Claude validates/enhances)
   */
  async validateExtraction(documentAIData: ExtractedData, processedFile: ProcessedFile): Promise<ExtractedData> {
    const systemPrompt = `You are a timetable validation assistant. You will receive:
1. An extraction result from Google Document AI
2. The original timetable image

Your task is to:
- Verify the Document AI extraction is correct
- Fill in any missing time blocks
- Correct any errors or misreadings
- Identify recurring blocks (same time daily)
- Return the validated/enhanced JSON in the same format

Return ONLY valid JSON, no other text.`;

    const userPrompt: any[] = [
      {
        type: 'text',
        text: `Document AI extracted this data:\n${JSON.stringify(documentAIData, null, 2)}\n\nPlease validate and enhance this extraction.`
      }
    ];

    // Add image for visual verification
    if (processedFile.imageBuffer) {
      const base64Image = processedFile.imageBuffer.toString('base64');
      userPrompt.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: processedFile.mimeType,
          data: base64Image
        }
      });
    }

    try {
      const message = await this.client.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4000,
        temperature: 0,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: userPrompt
          }
        ]
      });

      const response = message.content[0];
      if (response.type !== 'text') {
        throw new Error('Unexpected response type from Claude');
      }

      return this.parseClaudeResponse(response.text, documentAIData.metadata);
    } catch (error) {
      console.error('Claude validation failed, returning Document AI data:', error);
      // If validation fails, return original Document AI data
      return documentAIData;
    }
  }

  /**
   * Parse Claude's JSON response
   */
  private parseClaudeResponse(responseText: string, providedMetadata?: { teacherName?: string; className?: string }): ExtractedData {
    try {
      // Extract JSON from response (Claude sometimes adds explanatory text)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in Claude response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Merge provided metadata with extracted metadata
      const metadata = {
        ...parsed.metadata,
        ...(providedMetadata?.teacherName && { teacherName: providedMetadata.teacherName }),
        ...(providedMetadata?.className && { className: providedMetadata.className }),
      };

      return {
        blocks: parsed.blocks || [],
        recurringBlocks: parsed.recurringBlocks || [],
        metadata,
        warnings: parsed.warnings || []
      };
    } catch (error) {
      throw new Error(`Failed to parse Claude response: ${error instanceof Error ? error.message : 'Unknown error'}\nResponse: ${responseText}`);
    }
  }
}

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
        model: 'claude-sonnet-4-5-20250929',
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
    return `You are an expert at extracting structured timetable data from complex teacher schedules with various layouts and formats.

Your task is to analyze teacher timetables and extract ALL timeblock events with EXACT timings, handling complex cases.

CRITICAL EXTRACTION RULES:

1. **MERGED CELLS & SPLIT TIME FRAMES**:
   - If a single cell spans multiple time columns, the event runs for the ENTIRE duration across all columns
   - Example: "Maths" spanning 9:30-10:00 and 10:00-10:35 means ONE event from 9:30-10:35
   - DO NOT create separate entries for the same event unless explicitly different activities
   - If times are split (e.g., "10:20-10:35am" shown in parts), combine into single continuous block

2. **TIME CALCULATION**:
   - Extract exact times from headers (top row or left column)
   - If a cell spans multiple columns, calculate total duration by summing all spanned time slots
   - For split cells within one slot, preserve the subdivision with exact times
   - Always use 24-hour format internally, convert AM/PM correctly

3. **RECURRING/FIXED BLOCKS**:
   - Grey shaded cells = recurring blocks (Registration, Break, Lunch, etc.)
   - Rotated text columns = recurring blocks applying to all days
   - Events mentioned once but applying daily = recurring blocks with appliesDaily=true
   - Include these in "recurringBlocks" array, NOT in daily "blocks"

4. **TABLE LAYOUT DETECTION**:
   - Detect if days are in ROWS (left side) or COLUMNS (top)
   - Detect if times are in ROWS (left side) or COLUMNS (top)
   - Handle both weekly grids and daily schedule formats
   - For daily schedules (3 separate day columns), extract each day independently

5. **VERTICAL/ROTATED TEXT**:
   - Read vertical text carefully (often labels for recurring activities)
   - Common rotated labels: "Registration and Early Morning Work", "Handwriting", "Storytime"

6. **EVENT NAMES & NOTES**:
   - Preserve EXACT event names as written
   - Extract colored text, underlined text, or parenthetical notes into "notes" field
   - Keep subject names, activity details, room numbers in eventName
   - Move descriptive details (e.g., "Sentence Stack 5", "Inside the Titanic") to notes field

7. **SPECIAL CASES**:
   - Assembly slots that vary by day: create separate entries per day
   - Break times in grey: add as recurringBlocks
   - Lunch shown once: add as recurringBlock with appliesDaily=true
   - Split lessons (e.g., PE twice on same day): create TWO separate blocks with exact times each

8. **METADATA EXTRACTION**:
   - Extract teacher name (often after "Teacher:")
   - Extract class name (often after "Class:")
   - Extract term (e.g., "Spring 2", "Autumn 1")
   - Extract week number if shown

9. **ACCURACY REQUIREMENTS**:
   - Times MUST match the column/row headers EXACTLY
   - NO rounding or approximation
   - If uncertain about a time, use the nearest visible header time
   - For implicit durations, calculate by cell span, not guessing

10. **VALIDATION**:
    - Each day should have NO overlapping time blocks
    - All times should be valid HH:MM format
    - StartTime must be before EndTime
    - No gaps unless intentional (free periods)

OUTPUT FORMAT (STRICT JSON):
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
      "eventName": "Subject/Activity name",
      "notes": "Additional details, lesson specifics, room info",
      "isFixed": false
    }
  ],
  "recurringBlocks": [
    {
      "startTime": "HH:MM",
      "endTime": "HH:MM",
      "eventName": "Registration|Break|Lunch|Assembly|etc",
      "appliesDaily": true|false,
      "notes": "Which days or special conditions"
    }
  ],
  "warnings": ["List any ambiguities, assumptions, or unclear elements"]
}

IMPORTANT: Return ONLY valid JSON, no markdown, no explanations, no extra text.`;
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
        model: 'claude-sonnet-4-5-20250929',
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

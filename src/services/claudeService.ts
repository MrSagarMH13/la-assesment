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

STEP 1: IDENTIFY TIMETABLE FORMAT TYPE
Before extracting data, determine which format you're analyzing:

A. **WEEKLY GRID FORMAT**:
   - Days listed in ROWS (left column shows Monday, Tuesday, etc.)
   - Times listed in COLUMNS (top row shows time ranges)
   - Creates a week-at-a-glance matrix
   - Example: "Little Thurrock Primary School" weekly timetables

B. **DAILY SCHEDULE FORMAT**:
   - Separate COLUMNS for each day (e.g., "Monday/Tuesday/Thursday", "Wednesday", "Friday")
   - Times listed in LEFT COLUMN as numbered rows or explicit times
   - Each column is a complete daily schedule
   - Example: "Daily Schedule—Monday, Tuesday, Thursday" format

C. **VERTICAL TIME FORMAT**:
   - Times in rows (left side), days in columns (top)
   - Read down for time progression

CRITICAL: Identify format type first, then apply appropriate extraction logic.

CRITICAL EXTRACTION RULES:

0. **TEXT ACCURACY - READ EVERY CELL CAREFULLY**:
   - **CRITICAL**: Read the ACTUAL text inside each cell, not what you expect based on recurring patterns
   - **Example**: If Friday's 09:30-10:15 slot shows "Celebration Assembly", extract "Celebration Assembly", NOT "RWI" just because other days have RWI
   - **Example**: If a cell shows "PE", extract "PE", not "Physical Education" or "Phys Ed"
   - Each day's schedule is UNIQUE - always read the actual cell content before classifying
   - Only add events to recurringBlocks if they appear at the SAME TIME with the SAME NAME across multiple days

1. **TIME EXTRACTION PRIORITY** (MOST IMPORTANT - FOLLOW THIS ORDER):
   - **PRIORITY 1 - EXPLICIT TIMES IN CELL TEXT** (ALWAYS USE FIRST):
     * If a cell contains time text like "9:30-10:00", "10:35-10:50", or "10:35 - 10:50am", USE THAT TIME EXACTLY
     * Look for patterns: "HH:MM-HH:MM", "HH:MM - HH:MM", "H:MM-H:MM am/pm" anywhere in cell text
     * Example: Cell spanning columns 10:35-11:00 but containing text "10:35-10:50 Maths Con" → Extract as 10:35-10:50
     * The text inside the cell OVERRIDES everything (column boundaries, visual size, etc.)
   - **PRIORITY 2 - VISUAL CELL SPANNING** (if no explicit time text in cell):
     * Measure how many columns the cell visually spans
     * Calculate duration based on cell width relative to standard column width
     * Example: Cell spans 1.5 columns of 30 minutes each = 45 minute event
     * Use the starting column's start time + calculated duration
   - **PRIORITY 3 - COLUMN/ROW HEADER TIMES** (if cell is exactly one column wide):
     * Only use single column header times if cell width = one column AND no explicit time text
     * Map cell to its column's time range from header
   - **CRITICAL**: Explicit text times > Visual cell spanning > Column headers!

2. **MERGED CELLS & VISUAL CELL SPANNING** (CRITICAL - READ CAREFULLY):
   - **PRIORITY 1**: Look at the VISUAL cell boundaries by examining where the cell's right border ends
   - **HOW TO MEASURE CELL SPAN**:
     * Identify the cell's starting column (e.g., "9-9:30 RWI")
     * Trace the cell's right border - does it end at the column boundary or extend beyond?
     * If the border extends into the next column, the cell spans multiple columns
     * Calculate duration: count how many full/partial columns the cell covers
   - **CRITICAL EXAMPLE - Friday "Celebration Assembly"**:
     * Cell STARTS in "9-9:30 RWI" column (starts at 09:00)
     * Cell's RIGHT BORDER does NOT stop at 9:30 - it extends past 9:30 into the next column
     * Visually, the cell is wider than the standard "9-9:30 RWI" column on other days
     * The cell extends approximately halfway into the "9:30-10am" column
     * Calculation: 30 minutes (9:00-9:30) + 15 minutes (half of 9:30-10:00) = 45 minutes
     * **RESULT**: 09:00-09:45 (NOT 09:00-09:30)
   - **CRITICAL EXAMPLE - Monday "RWI"**:
     * Cell STARTS and ENDS within "9-9:30 RWI" column boundaries
     * Cell width = one column = 30 minutes
     * **RESULT**: 09:00-09:30
   - **RULE**: If Friday's cell is visually wider than Monday's cell in the same column position, they have different durations
   - **COMPARISON METHOD**:
     * Look at Monday's "RWI" cell in the "9-9:30 RWI" column - note its width
     * Look at Friday's "Celebration Assembly" cell in the same column position - is it wider?
     * If Friday's cell is wider and extends past where Monday's cell ends, it spans more time
     * Estimate: If Friday's cell is roughly 1.5x wider, add 50% more time (30 min → 45 min)
   - **For "Celebration Assembly" on Friday specifically**:
     * This is an assembly event, typically 45 minutes long in UK primary schools
     * The cell starts at 09:00 and extends noticeably past 09:30
     * If visual measurement is uncertain, default to 09:00-09:45 for assembly events that span beyond their starting column
   - If a cell is 1.5x the width of a standard column, it's 1.5x the duration
   - DO NOT create separate entries for the same event unless explicitly different activities

3. **TIME CALCULATION & EXPLICIT TIME HEADERS**:
   - **CRITICAL**: Headers often show EXACT time ranges for each column (e.g., "9-9.30am", "9.30-10am", "10-10.15am", "10.20-10.35am")
   - When you see time ranges in headers with GAPS (e.g., 10-10.15am followed by 10.20-10.35am), there is a 5-minute implicit break from 10:15-10:20
   - **Each cell occupies EXACTLY the time range of its column header** - do NOT extend beyond column boundaries
   - Example: If a cell is under "10-10.15am" header, it runs 10:00-10:15, NOT 10:00-10:35
   - If multiple adjacent cells have the same content, only then combine into one longer event
   - Compare cell height/width to column widths - one cell = one column = one time slot
   - Always use 24-hour format internally, convert AM/PM correctly (9.30am = 09:30, 2pm = 14:00)
   - **DO NOT merge time slots unless the cell visually spans multiple columns**

4. **RECURRING/FIXED BLOCKS** (DO NOT USE COLORS):
   - **DO NOT rely on grey/colored backgrounds** - colors are not consistent across timetables
   - Identify recurring blocks by CONTENT and PATTERN, not colors:
     * Event name patterns: "Registration", "Break", "Recess", "Lunch", "Handwriting", "Storytime"
     * Rotated text columns (often indicate recurring daily activities)
     * Same event at SAME TIME with EXACT SAME NAME appearing on ALL or MOST weekdays (Mon-Fri)
     * Structural position: start-of-day events (before 9am), end-of-day events (after 3pm), mid-day (lunch 12-1pm)
   - **CRITICAL RULE**: Only add to recurringBlocks if SAME TIME + SAME EVENT NAME across multiple days
   - **Example**: "Handwriting 13:00-13:15" appears on Mon, Tue, Wed, Thu, Fri → Add ONCE to recurringBlocks with appliesDaily=true, NOT to daily blocks
   - **Example**: "RWI 09:00-09:30" appears on Mon-Thu but Friday has "Celebration Assembly 09:00-09:45" → Add RWI to recurringBlocks (Mon-Thu), add Celebration Assembly to Friday's daily blocks
   - **NEVER DUPLICATE**: Do not put the same event in both recurringBlocks AND daily blocks
   - **ALWAYS CHECK**: Read the actual cell text before assuming it's a recurring event

5. **TABLE LAYOUT DETECTION**:
   - Detect if days are in ROWS (left side) or COLUMNS (top)
   - Detect if times are in ROWS (left side) or COLUMNS (top)
   - **READ EVERY TIME HEADER CAREFULLY**: Time headers show exact start-end for each column
   - Headers like "10-10.15am" mean that column is ONLY 10:00-10:15, nothing more
   - **IDENTIFY GAPS IN TIME SEQUENCES**: If headers jump from "10-10.15am" to "10.20-10.35am", there's a break
   - The gap (10:15-10:20) should be added to recurringBlocks as "Break" if it appears across all days
   - Handle both weekly grids and daily schedule formats
   - For daily schedules (3 separate day columns), extract each day independently
   - **MAP EACH CELL TO ITS COLUMN**: A cell in the "10-10.15am" column is ONLY 15 minutes, even if next column exists

6. **VERTICAL/ROTATED TEXT**:
   - Read vertical text carefully (often labels for recurring activities)
   - Common rotated labels: "Registration and Early Morning Work", "Handwriting", "Storytime"

7. **EVENT NAMES & NOTES**:
   - Preserve EXACT event names as written
   - Extract colored text, underlined text, or parenthetical notes into "notes" field
   - Keep subject names, activity details, room numbers in eventName
   - Move descriptive details (e.g., "Sentence Stack 5", "Inside the Titanic") to notes field

8. **SPECIAL CASES**:
   - Assembly slots that vary by day: create separate entries per day
   - Break times in grey: add as recurringBlocks
   - Lunch shown once: add as recurringBlock with appliesDaily=true
   - Split lessons (e.g., PE twice on same day): create TWO separate blocks with exact times each
   - **Small cells between events**: Often represent breaks or transition periods - analyze cell size carefully
   - If you see gaps in the visual grid, they likely represent breaks or free periods
   - **Daily Schedule Format**: If one column shows "Monday, Tuesday, Thursday", create blocks for EACH of those days
   - **Numbered Rows**: If times are shown as row numbers (1, 2, 3...), look for time ranges in first column
   - **Different layouts per day**: Friday may have different events/timing than Mon-Thu even in same column positions
     * Example: Friday "Celebration Assembly" in 9-9:30 RWI column position does NOT mean it's 9:00-9:30
     * Measure the actual cell width - if it extends beyond the column boundary, calculate the full span
     * Friday "Celebration Assembly" spanning 1.5 columns from 9:00 = 09:00-09:45 (not 09:00-09:30)

9. **VISUAL INDICATORS** (COLORS ARE OPTIONAL):
   - **DO NOT use background colors to determine event types or categories**
   - Colors may vary between timetables - they are styling, not data
   - If you can identify background colors, you may extract them to "color" field for visual reference only
   - Focus on TEXT CONTENT and TIME STRUCTURE to identify events
   - Note colored text or highlights in the "notes" field only if they contain additional information

10. **METADATA EXTRACTION**:
   - Extract teacher name (often after "Teacher:")
   - Extract class name (often after "Class:")
   - Extract term (e.g., "Spring 2", "Autumn 1")
   - Extract week number if shown

11. **ACCURACY REQUIREMENTS**:
   - Times MUST match the column/row headers EXACTLY
   - NO rounding or approximation
   - **CRITICAL EXAMPLE**: If you see time headers like:
     * Column 1: "9.30-10am" → any cell here is 09:30-10:00
     * Column 2: "10-10.15am" → any cell here is 10:00-10:15 (15 minutes ONLY)
     * Column 3: "10.20-10.35am" → any cell here is 10:20-10:35
     * Gap: 10:15-10:20 is an implicit 5-minute break
   - **DO NOT assume** a cell in "10-10.15am" extends to "10.20-10.35am" just because they're adjacent
   - Each cell = one column = exact time range shown in that column's header
   - Only merge adjacent cells if they contain the SAME event name AND span multiple columns visually
   - **For Daily Schedule format**: Extract time from first column or row number sequence

12. **VALIDATION & COMPLETE TIMELINE COVERAGE**:
    - **Complete Coverage Required**: Every minute from school start to school end must be accounted for
    - Each day should have NO overlapping time blocks
    - All times should be valid HH:MM format
    - StartTime must be before EndTime
    - **Check for time gaps**: If event ends at 10:50 and next starts at 11:00, there's a 10-minute gap
    - **Fill small gaps** (< 5 minutes): Extend the previous event's endTime to match next event's startTime
    - **Label larger gaps**: For gaps ≥ 5 minutes, create explicit "Transition" or "Free Period" blocks
    - Timeline validation:
      * Sort all blocks by time
      * Verify event[i].endTime = event[i+1].startTime (no gaps, no overlaps)
      * First event should start at school start time (e.g., 08:35)
      * Last event should end at school end time (e.g., 15:15)

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

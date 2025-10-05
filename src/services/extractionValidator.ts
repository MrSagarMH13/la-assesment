import { ExtractedData, TimeBlock, RecurringBlock } from '../types/timetable';

export interface ValidationWarning {
  type: 'gap' | 'overlap' | 'missing_coverage' | 'invalid_time';
  day?: string;
  message: string;
  details?: any;
}

export class ExtractionValidator {
  private readonly DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

  /**
   * Validate and auto-fix timeline gaps and overlaps
   */
  validate(data: ExtractedData): { data: ExtractedData; warnings: ValidationWarning[] } {
    const warnings: ValidationWarning[] = [];
    const newBlocks: TimeBlock[] = [];

    // Get all recurring blocks time ranges to avoid filling those gaps
    const recurringTimeRanges = this.getRecurringTimeRanges(data.recurringBlocks || []);

    // Process each day separately
    for (const day of this.DAYS) {
      const dayBlocks = data.blocks
        .filter(b => b.day === day)
        .sort((a, b) => this.timeToMinutes(a.startTime) - this.timeToMinutes(b.startTime));

      if (dayBlocks.length === 0) continue;

      // Validate and fill gaps for this day
      const { blocks: fixedBlocks, warnings: dayWarnings } = this.validateDay(day, dayBlocks, recurringTimeRanges);
      newBlocks.push(...fixedBlocks);
      warnings.push(...dayWarnings);
    }

    return {
      data: {
        ...data,
        blocks: newBlocks,
        warnings: [...(data.warnings || []), ...warnings.map(w => w.message)]
      },
      warnings
    };
  }

  /**
   * Get time ranges covered by recurring blocks
   */
  private getRecurringTimeRanges(recurringBlocks: RecurringBlock[]): Array<{ start: number; end: number }> {
    return recurringBlocks.map(block => ({
      start: this.timeToMinutes(block.startTime),
      end: this.timeToMinutes(block.endTime)
    }));
  }

  /**
   * Check if a time range overlaps with any recurring block
   */
  private overlapsRecurringBlock(startMinutes: number, endMinutes: number, recurringRanges: Array<{ start: number; end: number }>): boolean {
    return recurringRanges.some(range =>
      (startMinutes >= range.start && startMinutes < range.end) ||
      (endMinutes > range.start && endMinutes <= range.end) ||
      (startMinutes <= range.start && endMinutes >= range.end)
    );
  }

  /**
   * Validate and fix a single day's timeline
   */
  private validateDay(day: string, blocks: TimeBlock[], recurringRanges: Array<{ start: number; end: number }>): { blocks: TimeBlock[]; warnings: ValidationWarning[] } {
    const warnings: ValidationWarning[] = [];
    const result: TimeBlock[] = [];

    if (blocks.length === 0) return { blocks: result, warnings };

    // Add first block
    result.push({ ...blocks[0] });

    // Process each subsequent block
    for (let i = 1; i < blocks.length; i++) {
      const prev = result[result.length - 1];
      const current = blocks[i];

      const prevEndMinutes = this.timeToMinutes(prev.endTime);
      const currentStartMinutes = this.timeToMinutes(current.startTime);
      const gapMinutes = currentStartMinutes - prevEndMinutes;

      if (gapMinutes < 0) {
        // Overlap detected
        warnings.push({
          type: 'overlap',
          day,
          message: `Overlap on ${day}: ${prev.eventName} (${prev.startTime}-${prev.endTime}) overlaps with ${current.eventName} (${current.startTime}-${current.endTime})`,
          details: { prev, current }
        });

        // Fix: Trim previous event to end at current event's start
        prev.endTime = current.startTime;

      } else if (gapMinutes > 0) {
        // Check if gap is covered by a recurring block
        const gapCoveredByRecurring = this.overlapsRecurringBlock(prevEndMinutes, currentStartMinutes, recurringRanges);

        if (gapCoveredByRecurring) {
          // Gap is covered by recurring block (like RWI, Registration, etc.) - don't fill
          warnings.push({
            type: 'gap',
            day,
            message: `${gapMinutes}-minute gap on ${day} (${prev.endTime}-${current.startTime}) covered by recurring block - not filled`,
            details: { gapMinutes, coveredByRecurring: true }
          });
        } else if (gapMinutes <= 5) {
          // Small gap (≤5 minutes) not covered by recurring: Extend previous event to fill gap
          warnings.push({
            type: 'gap',
            day,
            message: `Small ${gapMinutes}-minute gap filled on ${day} by extending ${prev.eventName} from ${prev.endTime} to ${current.startTime}`,
            details: { gapMinutes, prev: prev.eventName, extended: true }
          });

          prev.endTime = current.startTime;
        } else {
          // Larger gap (>5 minutes) not covered by recurring: Insert transition/free period block
          const transitionBlock: TimeBlock = {
            day,
            startTime: prev.endTime,
            endTime: current.startTime,
            eventName: gapMinutes >= 10 ? 'Free Period' : 'Transition',
            notes: `Auto-inserted to fill ${gapMinutes}-minute gap`,
            isFixed: false
          };

          warnings.push({
            type: 'gap',
            day,
            message: `${gapMinutes}-minute gap on ${day} filled with ${transitionBlock.eventName} block (${prev.endTime}-${current.startTime})`,
            details: { gapMinutes, inserted: transitionBlock.eventName }
          });

          result.push(transitionBlock);
        }
      }

      // Add current block
      result.push({ ...current });
    }

    return { blocks: result, warnings };
  }

  /**
   * Convert time string to minutes since midnight
   */
  private timeToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }

  /**
   * Convert minutes since midnight to time string
   */
  private minutesToTime(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }

  /**
   * Validate complete day coverage (start to end)
   */
  validateCompleteCoverage(data: ExtractedData): ValidationWarning[] {
    const warnings: ValidationWarning[] = [];

    for (const day of this.DAYS) {
      const dayBlocks = data.blocks
        .filter(b => b.day === day)
        .sort((a, b) => this.timeToMinutes(a.startTime) - this.timeToMinutes(b.startTime));

      if (dayBlocks.length === 0) continue;

      const firstStart = dayBlocks[0].startTime;
      const lastEnd = dayBlocks[dayBlocks.length - 1].endTime;

      // Check if first block starts too late (assuming school starts around 08:30-09:00)
      const firstStartMinutes = this.timeToMinutes(firstStart);
      if (firstStartMinutes > this.timeToMinutes('09:00')) {
        warnings.push({
          type: 'missing_coverage',
          day,
          message: `${day} starts late at ${firstStart}. Missing early morning period?`,
          details: { firstStart }
        });
      }

      // Check if last block ends too early (assuming school ends around 15:00-15:30)
      const lastEndMinutes = this.timeToMinutes(lastEnd);
      if (lastEndMinutes < this.timeToMinutes('15:00')) {
        warnings.push({
          type: 'missing_coverage',
          day,
          message: `${day} ends early at ${lastEnd}. Missing afternoon period?`,
          details: { lastEnd }
        });
      }
    }

    return warnings;
  }

  /**
   * Merge recurring blocks into daily timeline for validation
   */
  mergeRecurringBlocks(data: ExtractedData): ExtractedData {
    if (!data.recurringBlocks || data.recurringBlocks.length === 0) {
      return data;
    }

    const allBlocks: TimeBlock[] = [...data.blocks];

    for (const recBlock of data.recurringBlocks) {
      const days = recBlock.appliesDaily
        ? this.DAYS
        : this.parseDaysFromNotes(recBlock.notes || '');

      for (const day of days) {
        // Check if this recurring block is already in daily blocks
        const exists = data.blocks.some(
          b => b.day === day &&
               b.startTime === recBlock.startTime &&
               b.endTime === recBlock.endTime &&
               b.eventName === recBlock.eventName
        );

        if (!exists) {
          allBlocks.push({
            day,
            startTime: recBlock.startTime,
            endTime: recBlock.endTime,
            eventName: recBlock.eventName,
            notes: recBlock.notes,
            isFixed: true
          });
        }
      }
    }

    return {
      ...data,
      blocks: allBlocks
    };
  }

  /**
   * Parse day names from notes field
   */
  private parseDaysFromNotes(notes: string): string[] {
    const days: string[] = [];
    const daysPattern = /(Monday|Tuesday|Wednesday|Thursday|Friday)/gi;
    const matches = notes.match(daysPattern);

    if (matches) {
      return [...new Set(matches.map(d => d.charAt(0).toUpperCase() + d.slice(1).toLowerCase()))];
    }

    return this.DAYS; // Default to all days if can't parse
  }
}

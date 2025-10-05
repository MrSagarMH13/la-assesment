import { ExtractedData, TimeBlock, RecurringBlock } from '../types/timetable';

export interface FullCalendarEvent {
  id: string;
  title: string;
  start?: string;           // ISO8601: "2024-10-07T09:30:00" (for one-time events)
  end?: string;             // ISO8601: "2024-10-07T10:00:00" (for one-time events)
  daysOfWeek?: number[];    // For recurring: [1, 2, 3] = Mon, Tue, Wed (0=Sun, 6=Sat)
  startTime?: string;       // For recurring: "09:30:00"
  endTime?: string;         // For recurring: "10:00:00"
  startRecur?: string;      // For recurring: "2024-09-01"
  endRecur?: string;        // For recurring: "2024-12-20"
  backgroundColor?: string;
  borderColor?: string;
  textColor?: string;
  allDay?: boolean;
  extendedProps: {
    eventType: 'class' | 'break' | 'assembly' | 'lunch' | 'other';
    notes?: string;
    teacherName?: string;
    className?: string;
    isRecurring: boolean;
    originalDay?: string;
  };
}

export interface FullCalendarTransformOptions {
  weekStart?: string;      // ISO date for week start (e.g., "2024-10-07")
  termStart?: string;      // ISO date for term start
  termEnd?: string;        // ISO date for term end
  format: 'recurring' | 'explicit'; // recurring uses daysOfWeek, explicit creates individual events
}

export class FullCalendarTransformer {
  private dayNameToNumber: { [key: string]: number } = {
    'sunday': 0,
    'monday': 1,
    'tuesday': 2,
    'wednesday': 3,
    'thursday': 4,
    'friday': 5,
    'saturday': 6
  };

  private eventTypeColors: { [key: string]: string } = {
    'break': '#95a5a6',
    'lunch': '#95a5a6',
    'assembly': '#3498db',
    'registration': '#34495e',
    'class': '#2ecc71',
    'other': '#9b59b6'
  };

  /**
   * Transform extracted timetable data to FullCalendar events
   */
  transform(
    extractedData: ExtractedData,
    options: FullCalendarTransformOptions
  ): FullCalendarEvent[] {
    const events: FullCalendarEvent[] = [];

    if (options.format === 'recurring') {
      // Use recurring event format with daysOfWeek
      events.push(...this.transformToRecurring(extractedData, options));
    } else {
      // Create explicit one-time events for the given week
      events.push(...this.transformToExplicit(extractedData, options));
    }

    return events;
  }

  /**
   * Transform to recurring events using daysOfWeek
   */
  private transformToRecurring(
    data: ExtractedData,
    options: FullCalendarTransformOptions
  ): FullCalendarEvent[] {
    const events: FullCalendarEvent[] = [];

    // First, add recurring blocks to establish the baseline recurring events
    const recurringEventKeys = new Set<string>();

    if (data.recurringBlocks) {
      for (const recBlock of data.recurringBlocks) {
        const key = `${recBlock.startTime}-${recBlock.endTime}-${recBlock.eventName}`;
        recurringEventKeys.add(key);

        const daysOfWeek = recBlock.appliesDaily ? [1, 2, 3, 4, 5] : this.parseDaysFromNotes(recBlock.notes || '');

        events.push({
          id: `recurring-${recBlock.eventName}-${recBlock.startTime}`,
          title: recBlock.eventName,
          daysOfWeek,
          startTime: this.formatTime(recBlock.startTime),
          endTime: this.formatTime(recBlock.endTime),
          startRecur: options.termStart || options.weekStart,
          endRecur: options.termEnd,
          backgroundColor: this.inferColor(recBlock.eventName),
          borderColor: this.inferColor(recBlock.eventName),
          extendedProps: {
            eventType: this.inferEventType(recBlock.eventName),
            notes: recBlock.notes,
            teacherName: data.metadata.teacherName,
            className: data.metadata.className,
            isRecurring: true
          }
        });
      }
    }

    // Group time blocks by unique event signature (time + eventName)
    // BUT exclude any blocks that match recurring blocks
    const eventGroups = new Map<string, TimeBlock[]>();

    for (const block of data.blocks) {
      const key = `${block.startTime}-${block.endTime}-${block.eventName}`;

      // Skip if this block matches a recurring block (already added above)
      if (recurringEventKeys.has(key)) {
        continue;
      }

      if (!eventGroups.has(key)) {
        eventGroups.set(key, []);
      }
      eventGroups.get(key)!.push(block);
    }

    // Create recurring events for grouped blocks (non-recurring daily blocks)
    for (const [key, blocks] of eventGroups.entries()) {
      const firstBlock = blocks[0];
      const daysOfWeek = blocks.map(b => this.getDayNumber(b.day)).filter(d => d !== null) as number[];

      events.push({
        id: `recurring-${key}`,
        title: firstBlock.eventName,
        daysOfWeek,
        startTime: this.formatTime(firstBlock.startTime),
        endTime: this.formatTime(firstBlock.endTime),
        startRecur: options.termStart || options.weekStart,
        endRecur: options.termEnd,
        backgroundColor: firstBlock.color || this.inferColor(firstBlock.eventName),
        borderColor: firstBlock.color || this.inferColor(firstBlock.eventName),
        extendedProps: {
          eventType: this.inferEventType(firstBlock.eventName),
          notes: firstBlock.notes,
          teacherName: data.metadata.teacherName,
          className: data.metadata.className,
          isRecurring: true,
          originalDay: blocks.map(b => b.day).join(', ')
        }
      });
    }

    return events;
  }

  /**
   * Transform to explicit one-time events for a specific week
   */
  private transformToExplicit(
    data: ExtractedData,
    options: FullCalendarTransformOptions
  ): FullCalendarEvent[] {
    const events: FullCalendarEvent[] = [];
    const weekStart = options.weekStart || this.getCurrentWeekMonday();

    // Create one-time events for each time block
    for (const block of data.blocks) {
      const date = this.getDateForDay(weekStart, block.day);
      if (!date) continue;

      events.push({
        id: `${date}-${block.startTime}-${block.eventName}`,
        title: block.eventName,
        start: `${date}T${block.startTime}:00`,
        end: `${date}T${block.endTime}:00`,
        backgroundColor: block.color || this.inferColor(block.eventName),
        borderColor: block.color || this.inferColor(block.eventName),
        allDay: false,
        extendedProps: {
          eventType: this.inferEventType(block.eventName),
          notes: block.notes,
          teacherName: data.metadata.teacherName,
          className: data.metadata.className,
          isRecurring: false,
          originalDay: block.day
        }
      });
    }

    // Add recurring blocks as explicit events for the week
    if (data.recurringBlocks) {
      for (const recBlock of data.recurringBlocks) {
        const days = recBlock.appliesDaily ? ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] : [];

        for (const day of days) {
          const date = this.getDateForDay(weekStart, day);
          if (!date) continue;

          events.push({
            id: `${date}-${recBlock.startTime}-${recBlock.eventName}`,
            title: recBlock.eventName,
            start: `${date}T${recBlock.startTime}:00`,
            end: `${date}T${recBlock.endTime}:00`,
            backgroundColor: this.inferColor(recBlock.eventName),
            borderColor: this.inferColor(recBlock.eventName),
            allDay: false,
            extendedProps: {
              eventType: this.inferEventType(recBlock.eventName),
              notes: recBlock.notes,
              teacherName: data.metadata.teacherName,
              className: data.metadata.className,
              isRecurring: true,
              originalDay: day
            }
          });
        }
      }
    }

    return events;
  }

  /**
   * Get day number for FullCalendar (0=Sunday, 1=Monday, etc.)
   */
  private getDayNumber(dayName: string): number | null {
    const normalized = dayName.toLowerCase();
    return this.dayNameToNumber[normalized] ?? null;
  }

  /**
   * Format time for FullCalendar (HH:MM to HH:MM:SS)
   */
  private formatTime(time: string): string {
    // Already in HH:MM format, add :00 for seconds
    return `${time}:00`;
  }

  /**
   * Get ISO date for a day name relative to week start
   */
  private getDateForDay(weekStart: string, dayName: string): string | null {
    const dayNum = this.getDayNumber(dayName);
    if (dayNum === null) return null;

    const startDate = new Date(weekStart);
    const startDayNum = startDate.getDay();

    // Calculate offset from week start (assuming weekStart is Monday)
    let offset = dayNum - startDayNum;
    if (offset < 0) offset += 7;

    const targetDate = new Date(startDate);
    targetDate.setDate(startDate.getDate() + offset);

    return targetDate.toISOString().split('T')[0];
  }

  /**
   * Get current week's Monday in ISO format
   */
  private getCurrentWeekMonday(): string {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Adjust for Sunday
    const monday = new Date(today);
    monday.setDate(today.getDate() + diff);
    return monday.toISOString().split('T')[0];
  }

  /**
   * Infer event type from event name
   */
  private inferEventType(eventName: string): 'class' | 'break' | 'assembly' | 'lunch' | 'other' {
    const lower = eventName.toLowerCase();

    if (lower.includes('break') || lower.includes('recess')) return 'break';
    if (lower.includes('lunch')) return 'lunch';
    if (lower.includes('assembly')) return 'assembly';
    if (lower.includes('registration') || lower.includes('storytime') || lower.includes('handwriting')) {
      return 'other';
    }

    return 'class';
  }

  /**
   * Infer color based on event name/type
   */
  private inferColor(eventName: string): string {
    const eventType = this.inferEventType(eventName);
    return this.eventTypeColors[eventType] || this.eventTypeColors['other'];
  }

  /**
   * Parse day numbers from notes field (e.g., "Monday, Tuesday, Thursday" -> [1, 2, 4])
   */
  private parseDaysFromNotes(notes: string): number[] {
    const days: number[] = [];
    const daysPattern = /(Monday|Tuesday|Wednesday|Thursday|Friday)/gi;
    const matches = notes.match(daysPattern);

    if (matches) {
      const uniqueDays = [...new Set(matches.map(d => d.charAt(0).toUpperCase() + d.slice(1).toLowerCase()))];
      return uniqueDays.map(d => this.getDayNumber(d)).filter(n => n !== null) as number[];
    }

    return []; // Return empty array if can't parse (will show on no days)
  }
}

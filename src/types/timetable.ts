import { z } from 'zod';

export const TimeBlockSchema = z.object({
  day: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  eventName: z.string(),
  notes: z.string().optional(),
  isFixed: z.boolean().default(false),
  color: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export const RecurringBlockSchema = z.object({
  startTime: z.string(),
  endTime: z.string(),
  eventName: z.string(),
  appliesDaily: z.boolean().default(true),
  notes: z.string().optional(),
});

export const TimetableResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    timetableId: z.string().optional(),
    metadata: z.object({
      teacherName: z.string().optional(),
      className: z.string().optional(),
      term: z.string().optional(),
      week: z.string().optional(),
      extractedAt: z.string(),
    }),
    blocks: z.array(TimeBlockSchema),
    recurringBlocks: z.array(RecurringBlockSchema).optional(),
    warnings: z.array(z.string()).optional(),
  }).optional(),
  error: z.string().optional(),
});

export type TimeBlock = z.infer<typeof TimeBlockSchema>;
export type RecurringBlock = z.infer<typeof RecurringBlockSchema>;
export type TimetableResponse = z.infer<typeof TimetableResponseSchema>;

export interface ExtractedData {
  blocks: TimeBlock[];
  recurringBlocks?: RecurringBlock[];
  metadata: {
    teacherName?: string;
    className?: string;
    term?: string;
    week?: string;
  };
  warnings?: string[];
}

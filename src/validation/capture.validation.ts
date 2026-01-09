import { z } from 'zod';

/**
 * Schema for capture request body
 */
export const captureSchema = z.object({
  user_id: z.string().uuid('Invalid user ID format'),
  content: z.string().min(1, 'Content is required').max(5000),
});

export type CaptureInput = z.infer<typeof captureSchema>;

/**
 * Schema for capture classification response
 */
export const captureClassificationSchema = z.object({
  category: z.enum(['ACTION', 'IDEA', 'FACT', 'PERSON']),
  summary: z.string(),
  person_name: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

export type CaptureClassification = z.infer<typeof captureClassificationSchema>;

/**
 * Schema for capture response
 */
export const captureResponseSchema = z.object({
  routed_to: z.enum(['action', 'idea', 'fact', 'person', 'clarification']),
  summary: z.string(),
  confidence: z.number(),
  record_id: z.string().uuid().optional(),
  needs_clarification: z.boolean().optional(),
});

export type CaptureResponse = z.infer<typeof captureResponseSchema>;

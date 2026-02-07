import { z } from 'zod';

/**
 * Schema for creating a summary
 */
export const createSummarySchema = z.object({
  conversation_id: z
    .string()
    .uuid('conversation_id must be a valid UUID'),

  user_id: z
    .string()
    .uuid('user_id must be a valid UUID'),

  user_perspective: z
    .string()
    .min(1, 'user_perspective cannot be empty')
    .max(5000, 'user_perspective must be less than 5000 characters')
    .optional(),

  model_perspective: z
    .string()
    .min(1, 'model_perspective cannot be empty')
    .max(5000, 'model_perspective must be less than 5000 characters')
    .optional(),

  conversation_overview: z
    .string()
    .min(1, 'conversation_overview cannot be empty')
    .max(5000, 'conversation_overview must be less than 5000 characters')
    .optional(),

  message_count: z
    .number()
    .int()
    .min(0)
    .optional(),

  skip_embeddings: z
    .boolean()
    .optional(),
});

/**
 * Schema for generating a summary from messages
 */
export const generateSummarySchema = z.object({
  conversation_id: z
    .string()
    .uuid('conversation_id must be a valid UUID'),

  user_id: z
    .string()
    .uuid('user_id must be a valid UUID'),

  message_count: z
    .number()
    .int()
    .min(1, 'message_count must be at least 1')
    .max(100, 'message_count must be at most 100')
    .optional(),
});

/**
 * Schema for summary ID parameter
 */
export const summaryIdSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});

/**
 * Schema for listing summaries query parameters
 */
export const summaryListQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((val: string | undefined) => (val ? parseInt(val, 10) : 50))
    .refine((val: number) => val > 0 && val <= 500, {
      message: 'limit must be between 1 and 500',
    }),

  offset: z
    .string()
    .optional()
    .transform((val: string | undefined) => (val ? parseInt(val, 10) : 0))
    .refine((val: number) => val >= 0, {
      message: 'offset must be >= 0',
    }),
});

/**
 * Schema for semantic summary search
 */
export const summarySearchSchema = z.object({
  query: z
    .string()
    .min(1, 'query cannot be empty')
    .max(1000, 'query must be less than 1000 characters'),

  user_id: z
    .string()
    .uuid('user_id must be a valid UUID')
    .optional(),

  conversation_id: z
    .string()
    .uuid('conversation_id must be a valid UUID')
    .optional(),

  perspective: z
    .enum(['user', 'model', 'overview'])
    .optional()
    .default('overview'),

  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(10),

  min_similarity: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .default(0.82),
});

export type CreateSummaryInput = z.infer<typeof createSummarySchema>;
export type GenerateSummaryInput = z.infer<typeof generateSummarySchema>;
export type SummarySearchInput = z.infer<typeof summarySearchSchema>;

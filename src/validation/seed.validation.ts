import { z } from 'zod';

/**
 * Schema for planting a seed request body
 */
export const seedSchema = z.object({
  user_id: z.string().uuid('Invalid user ID format'),
  content: z.string().min(1, 'Content is required').max(5000),
  source: z.enum(['app', 'voice', 'share']).optional().default('app'),
  source_metadata: z.record(z.any()).optional().default({}),
  planted_context: z.string().max(1000).optional().nullable(),
});

export type SeedInput = z.infer<typeof seedSchema>;

/**
 * Schema for updating a seed
 */
export const updateSeedSchema = z.object({
  content: z.string().min(1).max(5000).optional(),
  planted_context: z.string().max(1000).optional().nullable(),
  status: z.enum(['held', 'growing', 'grown', 'released']).optional(),
});

export type UpdateSeedInput = z.infer<typeof updateSeedSchema>;

/**
 * Schema for seed status filter
 */
export const seedStatusSchema = z.enum(['held', 'growing', 'grown', 'released']);

export type SeedStatusInput = z.infer<typeof seedStatusSchema>;

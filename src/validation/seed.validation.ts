import { z } from 'zod';

/**
 * Schema for planting a seed request body
 */
export const seedSchema = z.object({
  user_id: z.string().uuid('Invalid user ID format'),
  content: z.string().min(1, 'Content is required').max(5000),
  seed_type: z.enum(['thought', 'investment_recommendation', 'trade_execution', 'portfolio_update']).optional().default('thought'),
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
  source_metadata: z.record(z.any()).optional(),
});

export type UpdateSeedInput = z.infer<typeof updateSeedSchema>;

/**
 * Schema for seed status filter
 */
export const seedStatusSchema = z.enum(['held', 'growing', 'grown', 'released']);

export type SeedStatusInput = z.infer<typeof seedStatusSchema>;

/**
 * Schema for recording a trade execution
 */
export const recordTradeSchema = z.object({
  user_id: z.string().uuid('Invalid user ID format'),
  symbol: z.string().min(1).max(10).transform((s: string) => s.toUpperCase()),
  action: z.enum(['buy', 'sell']),
  shares: z.number().positive('Shares must be positive'),
  price: z.number().positive('Price must be positive'),
  executed_at: z.string().optional(),
  recommendation_seed_id: z.string().uuid().optional(),
  notes: z.string().max(1000).optional(),
});

export type RecordTradeInput = z.infer<typeof recordTradeSchema>;

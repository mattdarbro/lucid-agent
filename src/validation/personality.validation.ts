import { z } from 'zod';

/**
 * Schema for creating a personality assessment
 */
export const createPersonalitySnapshotSchema = z.object({
  user_id: z.string().uuid('Invalid user ID'),

  conversation_id: z.string().uuid('Invalid conversation ID').optional(),

  // Sample size (number of messages analyzed)
  sample_size: z.number().int().min(1, 'Sample size must be at least 1').optional(),

  // Whether to trigger automatic emotional state detection after creation
  detect_emotional_state: z.boolean().optional().default(false),
});

/**
 * Schema for Big 5 personality traits (0.00 to 1.00)
 */
export const personalityTraitsSchema = z.object({
  openness: z.number().min(0).max(1).nullable().optional(),
  conscientiousness: z.number().min(0).max(1).nullable().optional(),
  extraversion: z.number().min(0).max(1).nullable().optional(),
  agreeableness: z.number().min(0).max(1).nullable().optional(),
  neuroticism: z.number().min(0).max(1).nullable().optional(),
});

/**
 * Schema for querying personality statistics
 */
export const getPersonalityStatisticsSchema = z.object({
  user_id: z.string().uuid('Invalid user ID'),
  window_days: z.number().int().min(1).max(365).optional().default(90),
});

/**
 * Schema for querying personality snapshots
 */
export const listPersonalitySnapshotsSchema = z.object({
  user_id: z.string().uuid('Invalid user ID'),
  limit: z.number().int().min(1).max(100).optional().default(20),
  offset: z.number().int().min(0).optional().default(0),
});

// Type exports
export type CreatePersonalitySnapshotInput = z.infer<typeof createPersonalitySnapshotSchema>;
export type PersonalityTraitsInput = z.infer<typeof personalityTraitsSchema>;
export type GetPersonalityStatisticsInput = z.infer<typeof getPersonalityStatisticsSchema>;
export type ListPersonalitySnapshotsInput = z.infer<typeof listPersonalitySnapshotsSchema>;

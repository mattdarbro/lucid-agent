import { z } from 'zod';

/**
 * Schema for user_id path parameter
 */
export const userIdParamSchema = z.object({
  user_id: z.string().uuid('Invalid user ID format'),
});

/**
 * Schema for orbit tier
 */
export const orbitTierSchema = z.enum(['inner', 'mid', 'outer']);

/**
 * Schema for creating/updating an orbit person
 */
export const upsertOrbitSchema = z.object({
  person_name: z.string().min(1).max(255),
  relationship: z.string().max(100).optional(),
  current_situation: z.record(z.any()).optional(),
  how_this_affects_user: z.string().max(1000).optional(),
  orbit_tier: orbitTierSchema.optional(),
});

export type UpsertOrbitInput = z.infer<typeof upsertOrbitSchema>;

/**
 * Schema for changing orbit tier
 */
export const changeTierSchema = z.object({
  person_name: z.string().min(1).max(255),
  new_tier: orbitTierSchema,
});

export type ChangeTierInput = z.infer<typeof changeTierSchema>;

/**
 * Schema for orbits list query params
 */
export const orbitsListQuerySchema = z.object({
  tier: orbitTierSchema.optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  recently_mentioned_days: z.coerce.number().min(1).max(365).optional(),
});

/**
 * Schema for orbit ID param
 */
export const orbitIdParamSchema = z.object({
  id: z.string().uuid('Invalid orbit ID format'),
});

/**
 * Schema for person name param
 */
export const personNameParamSchema = z.object({
  person_name: z.string().min(1).max(255),
});

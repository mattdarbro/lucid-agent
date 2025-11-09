import { z } from 'zod';

/**
 * Valid curiosity approaches
 */
export const curiosityApproaches = [
  'gentle',
  'exploratory',
  'supportive',
  'analytical',
  'minimal',
] as const;

/**
 * Schema for generating a context adaptation
 */
export const generateAdaptationSchema = z.object({
  user_id: z.string().uuid('Invalid user ID'),
  emotional_state_id: z.string().uuid('Invalid emotional state ID'),
});

/**
 * Schema for creating a context adaptation manually
 */
export const createContextAdaptationSchema = z.object({
  user_id: z.string().uuid('Invalid user ID'),
  emotional_state_id: z.string().uuid('Invalid emotional state ID').optional(),

  // Schedule adjustments (time strings or "disabled")
  morning_schedule: z.string().optional(),
  midday_schedule: z.string().optional(),
  evening_schedule: z.string().optional(),
  night_schedule: z.string().optional(),

  // Prompt adjustments
  temperature_modifier: z.number().min(0.1).max(2.0).default(1.0),
  tone_directive: z.string().optional(),

  // Research strategy
  curiosity_approach: z.enum(curiosityApproaches).optional(),
  research_topics: z.array(z.string()).optional(),
  research_avoidance: z.array(z.string()).optional(),
  research_priority: z.number().int().min(1).max(10).default(5),

  // Reasoning
  adaptation_reasoning: z.string().optional(),

  // Validity period
  active_until: z.date().optional(),
});

/**
 * Schema for getting active adaptation
 */
export const getActiveAdaptationSchema = z.object({
  user_id: z.string().uuid('Invalid user ID'),
});

/**
 * Schema for listing adaptations
 */
export const listAdaptationsSchema = z.object({
  user_id: z.string().uuid('Invalid user ID'),
  include_expired: z.boolean().optional().default(false),
  limit: z.number().int().min(1).max(100).optional().default(20),
  offset: z.number().int().min(0).optional().default(0),
});

/**
 * Schema for expiring an adaptation
 */
export const expireAdaptationSchema = z.object({
  adaptation_id: z.string().uuid('Invalid adaptation ID'),
});

// Type exports
export type GenerateAdaptationInput = z.infer<typeof generateAdaptationSchema>;
export type CreateContextAdaptationInput = z.infer<typeof createContextAdaptationSchema>;
export type GetActiveAdaptationInput = z.infer<typeof getActiveAdaptationSchema>;
export type ListAdaptationsInput = z.infer<typeof listAdaptationsSchema>;
export type ExpireAdaptationInput = z.infer<typeof expireAdaptationSchema>;
export type CuriosityApproach = typeof curiosityApproaches[number];

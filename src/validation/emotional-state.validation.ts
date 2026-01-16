import { z } from 'zod';

/**
 * Valid emotional state types
 */
export const emotionalStateTypes = [
  'struggling',
  'energized',
  'withdrawn',
  'reflective',
  'stable',
] as const;

/**
 * Valid trigger types for emotional state detection
 */
export const triggerTypes = [
  'personality_shift',
  'conversation_pattern',
  'time_pattern',
  'topic_analysis',
] as const;

/**
 * Valid recommended approaches
 */
export const recommendedApproaches = [
  'gentle',
  'supportive',
  'exploratory',
  'analytical',
  'minimal',
] as const;

/**
 * Schema for detecting emotional state
 */
export const detectEmotionalStateSchema = z.object({
  user_id: z.string().uuid('Invalid user ID'),

  // Optional: analyze a specific conversation
  conversation_id: z.string().uuid('Invalid conversation ID').optional(),

  // Minimum confidence threshold to store state (0.0-1.0)
  min_confidence: z.number().min(0).max(1).optional().default(0.5),
});

/**
 * Schema for creating an emotional state manually
 */
export const createEmotionalStateSchema = z.object({
  user_id: z.string().uuid('Invalid user ID'),
  conversation_id: z.string().uuid('Invalid conversation ID').optional(),

  state_type: z.enum(emotionalStateTypes),
  confidence: z.number().min(0).max(1),

  trigger_type: z.enum(triggerTypes),
  indicators: z.record(z.any()),

  recommended_approach: z.enum(recommendedApproaches).optional(),
});

/**
 * Schema for resolving an emotional state
 */
export const resolveEmotionalStateSchema = z.object({
  state_id: z.string().uuid('Invalid state ID'),
});

/**
 * Schema for querying active emotional states
 */
export const getActiveEmotionalStateSchema = z.object({
  user_id: z.string().uuid('Invalid user ID'),
});

/**
 * Schema for listing emotional states
 */
export const listEmotionalStatesSchema = z.object({
  user_id: z.string().uuid('Invalid user ID'),
  include_resolved: z.boolean().optional().default(false),
  limit: z.number().int().min(1).max(100).optional().default(20),
  offset: z.number().int().min(0).optional().default(0),
});

// Type exports
export type DetectEmotionalStateInput = z.infer<typeof detectEmotionalStateSchema>;
export type CreateEmotionalStateInput = z.infer<typeof createEmotionalStateSchema>;
export type ResolveEmotionalStateInput = z.infer<typeof resolveEmotionalStateSchema>;
export type GetActiveEmotionalStateInput = z.infer<typeof getActiveEmotionalStateSchema>;
export type ListEmotionalStatesInput = z.infer<typeof listEmotionalStatesSchema>;
export type EmotionalStateType = typeof emotionalStateTypes[number];
export type TriggerType = typeof triggerTypes[number];
export type RecommendedApproach = typeof recommendedApproaches[number];

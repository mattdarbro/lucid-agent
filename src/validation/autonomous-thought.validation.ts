import { z } from 'zod';

// Thought categories aligned with database schema
export const thoughtCategorySchema = z.enum([
  'reflection',
  'curiosity',
  'consolidation',
  'dream',
  'insight',
  'question',
]);

// Circadian phases aligned with database schema
export const circadianPhaseSchema = z.enum([
  'morning',
  'midday',
  'evening',
  'night',
]);

// Create autonomous thought schema
export const createAutonomousThoughtSchema = z.object({
  user_id: z.string().uuid(),
  agent_job_id: z.string().uuid().optional(),
  content: z.string().min(1),
  thought_type: thoughtCategorySchema,
  circadian_phase: circadianPhaseSchema.nullable().optional(),
  generated_at_time: z.string().regex(/^([0-1]\d|2[0-3]):([0-5]\d):([0-5]\d)$/).optional(), // HH:MM:SS
  importance_score: z.number().min(0).max(1).optional(),
  is_shared: z.boolean().optional().default(false),
});

// Update autonomous thought schema
export const updateAutonomousThoughtSchema = z.object({
  is_shared: z.boolean().optional(),
  shared_at: z.coerce.date().optional(),
  importance_score: z.number().min(0).max(1).optional(),
});

// Query params for listing thoughts
export const listAutonomousThoughtsSchema = z.object({
  user_id: z.string().uuid().optional(),
  thought_type: thoughtCategorySchema.optional(),
  circadian_phase: circadianPhaseSchema.optional(),
  is_shared: z.coerce.boolean().optional(),
  min_importance: z.coerce.number().min(0).max(1).optional(),
  created_after: z.coerce.date().optional(),
  created_before: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// Search thoughts by semantic similarity
export const searchThoughtsSchema = z.object({
  user_id: z.string().uuid(),
  query: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  min_similarity: z.coerce.number().min(0).max(1).default(0.7),
  thought_type: thoughtCategorySchema.optional(),
  circadian_phase: circadianPhaseSchema.optional(),
});

export type ThoughtCategory = z.infer<typeof thoughtCategorySchema>;
export type CircadianPhase = z.infer<typeof circadianPhaseSchema>;
export type CreateAutonomousThoughtInput = z.infer<typeof createAutonomousThoughtSchema>;
export type UpdateAutonomousThoughtInput = z.infer<typeof updateAutonomousThoughtSchema>;
export type ListAutonomousThoughtsInput = z.infer<typeof listAutonomousThoughtsSchema>;
export type SearchThoughtsInput = z.infer<typeof searchThoughtsSchema>;

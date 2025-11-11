import { z } from 'zod';

// Research approach types aligned with database schema
export const researchApproachSchema = z.enum([
  'gentle',
  'exploratory',
  'supportive',
  'analytical',
]);

// Research task status aligned with database schema
export const researchStatusSchema = z.enum([
  'pending',
  'in_progress',
  'completed',
  'failed',
]);

// Create research task schema
export const createResearchTaskSchema = z.object({
  user_id: z.string().uuid(),
  emotional_state_id: z.string().uuid().optional(),
  query: z.string().min(1),
  purpose: z.string().optional(),
  approach: researchApproachSchema.default('exploratory'),
  priority: z.number().int().min(1).max(10).default(5),
});

// Update research task schema
export const updateResearchTaskSchema = z.object({
  status: researchStatusSchema.optional(),
  results: z.record(z.unknown()).optional(), // JSONB data
  derived_facts: z.array(z.string()).optional(),
  started_at: z.coerce.date().optional(),
  completed_at: z.coerce.date().optional(),
});

// Query params for listing research tasks
export const listResearchTasksSchema = z.object({
  user_id: z.string().uuid().optional(),
  status: researchStatusSchema.optional(),
  approach: researchApproachSchema.optional(),
  min_priority: z.coerce.number().int().min(1).max(10).optional(),
  created_after: z.coerce.date().optional(),
  created_before: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ResearchApproach = z.infer<typeof researchApproachSchema>;
export type ResearchStatus = z.infer<typeof researchStatusSchema>;
export type CreateResearchTaskInput = z.infer<typeof createResearchTaskSchema>;
export type UpdateResearchTaskInput = z.infer<typeof updateResearchTaskSchema>;
export type ListResearchTasksInput = z.infer<typeof listResearchTasksSchema>;

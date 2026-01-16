import { z } from 'zod';

/**
 * Goal schema
 */
export const goalSchema = z.object({
  goal: z.string().min(1).max(500),
  timeline: z.string().max(200).optional(),
  progress: z.string().max(200).optional(),
});

/**
 * Commitment schema
 */
export const commitmentSchema = z.object({
  commitment: z.string().min(1).max(500),
  frequency: z.string().max(200).optional(),
  impact: z.string().max(500).optional(),
});

/**
 * Resources schema
 */
export const resourcesSchema = z.object({
  time_budget: z.string().max(500).optional(),
  financial_runway: z.string().max(500).optional(),
  skills: z.array(z.string().max(100)).max(20).optional(),
  support: z.array(z.string().max(100)).max(20).optional(),
});

/**
 * Constraints schema
 */
export const constraintsSchema = z.object({
  api_costs: z.string().max(500).optional(),
  technical_debt: z.array(z.string().max(200)).max(10).optional(),
  health: z.string().max(500).optional(),
  other: z.array(z.string().max(200)).max(10).optional(),
});

/**
 * Values/priorities schema
 */
export const valuesPrioritiesSchema = z.object({
  top_values: z.array(z.string().max(100)).max(10).optional(),
  current_focus: z.string().max(500).optional(),
});

/**
 * Schema for user_id path parameter
 */
export const userIdParamSchema = z.object({
  user_id: z.string().uuid('Invalid user ID format'),
});

/**
 * Schema for updating Matt's state
 */
export const updateMattStateSchema = z.object({
  active_goals: z.array(goalSchema).max(10).optional(),
  active_commitments: z.array(commitmentSchema).max(10).optional(),
  resources: resourcesSchema.optional(),
  constraints: constraintsSchema.optional(),
  values_priorities: valuesPrioritiesSchema.optional(),
});

export type UpdateMattStateInput = z.infer<typeof updateMattStateSchema>;

/**
 * Schema for history query params
 */
export const stateHistoryQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).optional().default(10),
});

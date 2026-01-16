import { z } from 'zod';

/**
 * Schema for user_id path parameter
 */
export const userIdParamSchema = z.object({
  user_id: z.string().uuid('Invalid user ID format'),
});

/**
 * Schema for action_id path parameter
 */
export const actionIdParamSchema = z.object({
  action_id: z.string().uuid('Invalid action ID format'),
});

/**
 * Schema for action status
 */
export const actionStatusSchema = z.enum(['open', 'done', 'cancelled']);

/**
 * Schema for action source
 */
export const actionSourceSchema = z.enum(['capture', 'conversation', 'briefing']);

/**
 * Schema for creating an action
 */
export const createActionSchema = z.object({
  content: z.string().min(1, 'Content is required').max(2000),
  summary: z.string().max(500).optional(),
  person_id: z.string().uuid().optional(),
  source: actionSourceSchema.optional(),
});

export type CreateActionInput = z.infer<typeof createActionSchema>;

/**
 * Schema for updating an action
 */
export const updateActionSchema = z.object({
  content: z.string().min(1).max(2000).optional(),
  summary: z.string().max(500).optional(),
  status: actionStatusSchema.optional(),
  person_id: z.string().uuid().nullable().optional(),
});

export type UpdateActionInput = z.infer<typeof updateActionSchema>;

/**
 * Schema for action list query params
 */
export const actionsListQuerySchema = z.object({
  status: actionStatusSchema.optional(),
  person_id: z.string().uuid().optional(),
  source: actionSourceSchema.optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  offset: z.coerce.number().min(0).optional(),
});

/**
 * Schema for changing action status
 */
export const changeStatusSchema = z.object({
  status: actionStatusSchema,
});

export type ChangeStatusInput = z.infer<typeof changeStatusSchema>;

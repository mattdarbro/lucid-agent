import { z } from 'zod';

/**
 * Valid modes that have documents (chat is excluded - ephemeral)
 */
export const documentModeSchema = z.enum(['me', 'lucid', 'others', 'possibilities', 'state']);

/**
 * User ID parameter validation
 */
export const userIdParamSchema = z.object({
  user_id: z.string().uuid('Invalid user ID format'),
});

/**
 * Mode parameter validation
 */
export const modeParamSchema = z.object({
  mode: documentModeSchema,
});

/**
 * Combined user_id and mode params
 */
export const userModeParamsSchema = z.object({
  user_id: z.string().uuid('Invalid user ID format'),
  mode: documentModeSchema,
});

/**
 * Update document request body
 */
export const updateDocumentSchema = z.object({
  content: z.string().min(1, 'Content cannot be empty'),
  updated_by: z.enum(['user', 'lucid', 'agent']).default('user'),
});

/**
 * Append to section request body
 */
export const appendToSectionSchema = z.object({
  section: z.string().min(1, 'Section name required'),
  content: z.string().min(1, 'Content cannot be empty'),
  updated_by: z.enum(['lucid', 'agent']).default('lucid'),
});

/**
 * Rollback request body
 */
export const rollbackSchema = z.object({
  version: z.number().int().positive('Version must be a positive integer'),
});

/**
 * History query parameters
 */
export const historyQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).default(10),
});

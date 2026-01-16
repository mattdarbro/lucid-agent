import { z } from 'zod';

/**
 * Validation schemas for conversation-related operations
 */

/**
 * Schema for creating a new conversation
 */
export const createConversationSchema = z.object({
  user_id: z
    .string()
    .uuid('user_id must be a valid UUID'),

  title: z
    .string()
    .min(1, 'title cannot be empty')
    .max(255, 'title must be less than 255 characters')
    .optional(),

  user_timezone: z
    .string()
    .refine(
      (tz) => {
        try {
          Intl.DateTimeFormat(undefined, { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      },
      { message: 'Invalid timezone' }
    )
    .optional(),
});

/**
 * Schema for updating a conversation
 */
export const updateConversationSchema = z.object({
  title: z
    .string()
    .min(1, 'title cannot be empty')
    .max(255, 'title must be less than 255 characters')
    .optional(),

  user_timezone: z
    .string()
    .refine(
      (tz) => {
        try {
          Intl.DateTimeFormat(undefined, { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      },
      { message: 'Invalid timezone' }
    )
    .optional(),
});

/**
 * Schema for conversation ID parameter
 */
export const conversationIdSchema = z.object({
  id: z.string().uuid('Conversation ID must be a valid UUID'),
});

/**
 * Schema for user ID parameter
 */
export const userIdParamSchema = z.object({
  user_id: z.string().uuid('User ID must be a valid UUID'),
});

// Type exports
export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export type UpdateConversationInput = z.infer<typeof updateConversationSchema>;
export type ConversationIdParam = z.infer<typeof conversationIdSchema>;
export type UserIdParam = z.infer<typeof userIdParamSchema>;

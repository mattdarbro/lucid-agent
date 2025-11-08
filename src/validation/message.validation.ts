import { z } from 'zod';

/**
 * Validation schemas for message-related operations
 */

/**
 * Valid message roles
 */
export const messageRoles = ['user', 'assistant', 'system'] as const;

/**
 * Schema for creating a new message
 */
export const createMessageSchema = z.object({
  conversation_id: z.string().uuid('conversation_id must be a valid UUID'),

  user_id: z.string().uuid('user_id must be a valid UUID'),

  role: z.enum(messageRoles, {
    errorMap: () => ({ message: 'role must be one of: user, assistant, system' }),
  }),

  content: z
    .string()
    .min(1, 'content cannot be empty')
    .max(100000, 'content must be less than 100,000 characters'),

  model: z
    .string()
    .max(100, 'model must be less than 100 characters')
    .optional(),

  // Optional: Allow skipping embedding generation (for bulk imports, etc.)
  skip_embedding: z.boolean().optional().default(false),
});

/**
 * Schema for message ID parameter
 */
export const messageIdSchema = z.object({
  id: z.string().uuid('Message ID must be a valid UUID'),
});

/**
 * Schema for conversation ID parameter
 */
export const conversationIdParamSchema = z.object({
  conversation_id: z.string().uuid('Conversation ID must be a valid UUID'),
});

/**
 * Schema for message list query parameters
 */
export const messageListQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 50))
    .refine((val) => val > 0 && val <= 500, {
      message: 'limit must be between 1 and 500',
    }),

  offset: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 0))
    .refine((val) => val >= 0, {
      message: 'offset must be >= 0',
    }),

  role: z.enum(messageRoles).optional(),
});

/**
 * Schema for semantic search query
 */
export const semanticSearchSchema = z.object({
  query: z
    .string()
    .min(1, 'query cannot be empty')
    .max(1000, 'query must be less than 1000 characters'),

  conversation_id: z.string().uuid('conversation_id must be a valid UUID').optional(),

  user_id: z.string().uuid('user_id must be a valid UUID').optional(),

  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(10),

  min_similarity: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .default(0.7),
});

// Type exports
export type CreateMessageInput = z.infer<typeof createMessageSchema>;
export type MessageIdParam = z.infer<typeof messageIdSchema>;
export type ConversationIdParam = z.infer<typeof conversationIdParamSchema>;
export type MessageListQuery = z.infer<typeof messageListQuerySchema>;
export type SemanticSearchInput = z.infer<typeof semanticSearchSchema>;
export type MessageRole = (typeof messageRoles)[number];

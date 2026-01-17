import { z } from 'zod';

/**
 * Schema for chat completion request
 */
export const chatCompletionSchema = z.object({
  conversation_id: z
    .string()
    .uuid('conversation_id must be a valid UUID'),

  user_id: z
    .string()
    .uuid('user_id must be a valid UUID'),

  message: z
    .string()
    .min(1, 'message cannot be empty')
    .max(10000, 'message must be less than 10000 characters'),

  model: z
    .string()
    .optional()
    .default('claude-opus-4-5-20251101'),

  max_tokens: z
    .number()
    .int()
    .min(1)
    .max(4096)
    .optional()
    .default(2000),

  temperature: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .default(0.7),

  system_prompt: z
    .string()
    .max(5000)
    .optional(),

  /** Enable recursive context search for "infinite context" */
  enable_recursive_search: z
    .boolean()
    .optional()
    .default(false),

  /** Configuration for recursive context search */
  recursive_search_config: z.object({
    /** Maximum recursion depth (default: 3) */
    max_depth: z.number().int().min(1).max(10).optional(),
    /** Maximum context chunks to return (default: 20) */
    max_chunks: z.number().int().min(1).max(50).optional(),
    /** Minimum similarity threshold (default: 0.4) */
    min_similarity: z.number().min(0).max(1).optional(),
    /** Search scope: conversation, user, or all */
    search_scope: z.enum(['conversation', 'user', 'all']).optional(),
    /** Target token budget for context (default: 4000) */
    target_token_budget: z.number().int().min(500).max(20000).optional(),
  }).optional(),
});

export type ChatCompletionInput = z.infer<typeof chatCompletionSchema>;

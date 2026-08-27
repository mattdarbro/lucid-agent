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
    .default('claude-sonnet-5'),

  max_tokens: z
    .number()
    .int()
    .min(1)
    // Adaptive thinking (Sonnet 5) counts toward max_tokens, so the ceiling must
    // cover reasoning + reply. Raised from 4096/2000 to give thinking headroom;
    // 16000 stays under the SDK's non-streaming HTTP-timeout threshold.
    .max(16000)
    .optional()
    .default(8000),

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

  /**
   * v3 (plan §6): a heart to heart is the repair lever. The client sends
   * mode: 'heart_to_heart' while the Room's option is on; the server also
   * treats a message that plainly asks for one ("heart to heart") the same
   * way for that turn. Ordinary turns omit it.
   */
  mode: z.enum(['heart_to_heart']).optional(),

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

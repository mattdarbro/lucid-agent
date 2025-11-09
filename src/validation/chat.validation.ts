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
    .default('claude-sonnet-4-5-20250929'),

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
});

export type ChatCompletionInput = z.infer<typeof chatCompletionSchema>;

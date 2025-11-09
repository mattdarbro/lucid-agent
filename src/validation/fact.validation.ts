import { z } from 'zod';

/**
 * Fact categories
 */
export const factCategories = [
  'personal',      // Personal information (age, location, occupation)
  'preference',    // Likes, dislikes, favorites
  'goal',          // Aspirations, plans, objectives
  'relationship',  // Family, friends, colleagues
  'skill',         // Abilities, expertise, learning
  'habit',         // Regular behaviors, routines
  'belief',        // Opinions, values, principles
  'experience',    // Past events, memories
  'health',        // Medical, fitness, wellness
  'other',         // Miscellaneous
] as const;

export type FactCategory = typeof factCategories[number];

/**
 * Schema for creating a fact
 */
export const createFactSchema = z.object({
  user_id: z
    .string()
    .uuid('user_id must be a valid UUID'),

  content: z
    .string()
    .min(1, 'content cannot be empty')
    .max(1000, 'content must be less than 1000 characters'),

  category: z
    .enum(factCategories)
    .optional(),

  confidence: z
    .number()
    .min(0)
    .max(1)
    .optional(),

  is_active: z
    .boolean()
    .optional(),

  skip_embedding: z
    .boolean()
    .optional(),
});

/**
 * Schema for updating a fact
 */
export const updateFactSchema = z.object({
  content: z
    .string()
    .min(1, 'content cannot be empty')
    .max(1000, 'content must be less than 1000 characters')
    .optional(),

  category: z
    .enum(factCategories)
    .optional(),

  confidence: z
    .number()
    .min(0)
    .max(1)
    .optional(),

  is_active: z
    .boolean()
    .optional(),
});

/**
 * Schema for fact ID parameter
 */
export const factIdSchema = z.object({
  id: z.string().uuid('Fact ID must be a valid UUID'),
});

/**
 * Schema for user ID parameter
 */
export const userIdParamSchema = z.object({
  user_id: z.string().uuid('User ID must be a valid UUID'),
});

/**
 * Schema for fact list query parameters
 */
export const factListQuerySchema = z.object({
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

  category: z
    .enum(factCategories)
    .optional(),

  is_active: z
    .string()
    .optional()
    .transform((val) => {
      if (val === undefined) return undefined;
      return val === 'true';
    }),

  min_confidence: z
    .string()
    .optional()
    .transform((val) => (val ? parseFloat(val) : undefined))
    .refine((val) => val === undefined || (val >= 0 && val <= 1), {
      message: 'min_confidence must be between 0 and 1',
    }),
});

/**
 * Schema for semantic fact search
 */
export const factSearchSchema = z.object({
  query: z
    .string()
    .min(1, 'query cannot be empty')
    .max(1000, 'query must be less than 1000 characters'),

  user_id: z
    .string()
    .uuid('user_id must be a valid UUID')
    .optional(),

  category: z
    .enum(factCategories)
    .optional(),

  is_active: z
    .boolean()
    .optional()
    .default(true),

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
    .default(0.82),

  min_confidence: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .default(0.5),
});

/**
 * Schema for extracting facts from messages
 * This is what the LLM will use to extract facts
 */
export const extractFactsSchema = z.object({
  user_id: z
    .string()
    .uuid('user_id must be a valid UUID'),

  conversation_id: z
    .string()
    .uuid('conversation_id must be a valid UUID')
    .optional(),

  message_ids: z
    .array(z.string().uuid())
    .min(1, 'At least one message ID is required')
    .max(50, 'Maximum 50 messages can be processed at once')
    .optional(),

  // If neither conversation_id nor message_ids provided, process all user's messages
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(20),
});

// Type exports
export type CreateFactInput = z.infer<typeof createFactSchema>;
export type UpdateFactInput = z.infer<typeof updateFactSchema>;
export type FactIdParam = z.infer<typeof factIdSchema>;
export type UserIdParam = z.infer<typeof userIdParamSchema>;
export type FactListQuery = z.infer<typeof factListQuerySchema>;
export type FactSearchInput = z.infer<typeof factSearchSchema>;
export type ExtractFactsInput = z.infer<typeof extractFactsSchema>;

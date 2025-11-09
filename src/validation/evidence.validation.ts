import { z } from 'zod';

/**
 * Evidence context types
 */
export const evidenceContextTypes = [
  'direct_statement',  // User explicitly stated this
  'implied',          // Strongly implied by context
  'inferred',         // Logical inference from statements
  'contradiction',    // Contradicts the fact (lowers confidence)
] as const;

export type EvidenceContextType = typeof evidenceContextTypes[number];

/**
 * Schema for creating evidence
 */
export const createEvidenceSchema = z.object({
  fact_id: z
    .string()
    .uuid('fact_id must be a valid UUID'),

  message_id: z
    .string()
    .uuid('message_id must be a valid UUID')
    .optional(),

  conversation_id: z
    .string()
    .uuid('conversation_id must be a valid UUID')
    .optional(),

  excerpt: z
    .string()
    .min(1, 'excerpt cannot be empty')
    .max(5000, 'excerpt must be less than 5000 characters'),

  strength: z
    .number()
    .min(0)
    .max(1)
    .optional(),

  context_type: z
    .enum(evidenceContextTypes)
    .optional(),
});

/**
 * Schema for updating evidence
 */
export const updateEvidenceSchema = z.object({
  excerpt: z
    .string()
    .min(1, 'excerpt cannot be empty')
    .max(5000, 'excerpt must be less than 5000 characters')
    .optional(),

  strength: z
    .number()
    .min(0)
    .max(1)
    .optional(),

  context_type: z
    .enum(evidenceContextTypes)
    .optional(),
});

/**
 * Schema for evidence ID parameter
 */
export const evidenceIdSchema = z.object({
  id: z.string().uuid('Evidence ID must be a valid UUID'),
});

/**
 * Schema for fact ID parameter
 */
export const factIdParamSchema = z.object({
  fact_id: z.string().uuid('Fact ID must be a valid UUID'),
});

/**
 * Schema for evidence list query parameters
 */
export const evidenceListQuerySchema = z.object({
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

  context_type: z
    .enum(evidenceContextTypes)
    .optional(),

  min_strength: z
    .string()
    .optional()
    .transform((val) => (val ? parseFloat(val) : undefined))
    .refine((val) => val === undefined || (val >= 0 && val <= 1), {
      message: 'min_strength must be between 0 and 1',
    }),
});

// Type exports
export type CreateEvidenceInput = z.infer<typeof createEvidenceSchema>;
export type UpdateEvidenceInput = z.infer<typeof updateEvidenceSchema>;
export type EvidenceIdParam = z.infer<typeof evidenceIdSchema>;
export type FactIdParam = z.infer<typeof factIdParamSchema>;
export type EvidenceListQuery = z.infer<typeof evidenceListQuerySchema>;

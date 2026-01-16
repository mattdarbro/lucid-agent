import { z } from 'zod';

/**
 * Sigma levels for possibilities
 * 1 = Adjacent thinking (user might get here naturally)
 * 2 = Requires stretching (user would probably miss)
 * 3 = Edge cases, contrarian views (almost never considered)
 */
export const sigmaLevels = [1, 2, 3] as const;
export type SigmaLevel = typeof sigmaLevels[number];

/**
 * Categories for possibilities
 */
export const possibilityCategories = [
  'practical',    // Practical alternatives, adjacent approaches
  'reframe',      // Reframes the question or problem
  'contrarian',   // Contrarian view, challenges assumptions
] as const;
export type PossibilityCategory = typeof possibilityCategories[number];

/**
 * A single possibility
 */
export interface Possibility {
  id: string;
  text: string;
  sigma: SigmaLevel;
  category: PossibilityCategory;
  reasoning?: string;  // Why this possibility exists at this sigma level
}

/**
 * The full possibilities response
 */
export interface PossibilitiesResponse {
  focus: string;
  focusReframed?: string;  // How Lucid understands the deeper question
  possibilities: {
    sigma1: Possibility[];
    sigma2: Possibility[];
    sigma3: Possibility[];
  };
}

/**
 * Schema for generating possibilities
 */
export const generatePossibilitiesSchema = z.object({
  user_id: z
    .string()
    .uuid('user_id must be a valid UUID'),

  focus: z
    .string()
    .min(1, 'focus is required')
    .max(1000, 'focus must be under 1000 characters'),

  sigma: z
    .number()
    .int()
    .min(1)
    .max(3)
    .optional(),  // If provided, only generate for this sigma level

  count: z
    .number()
    .int()
    .min(1)
    .max(5)
    .default(3),  // Number of possibilities per sigma level

  conversation_id: z
    .string()
    .uuid()
    .optional(),  // For context
});

export type GeneratePossibilitiesInput = z.infer<typeof generatePossibilitiesSchema>;

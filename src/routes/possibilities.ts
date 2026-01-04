import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '../logger';
import { pool } from '../db';
import { PossibilityThinkingService } from '../services/possibility-thinking.service';
import { generatePossibilitiesSchema } from '../validation/possibilities.validation';

const router = Router();
const possibilityService = new PossibilityThinkingService(pool);

/**
 * Validation middleware helper
 */
function validateBody(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: Function) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.errors.map((err) => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        });
      }
      next(error);
    }
  };
}

/**
 * POST /v1/possibilities/generate
 *
 * Generate sigma-based possibilities for a given focus
 *
 * Request body:
 * - user_id: string (required) - UUID of the user
 * - focus: string (required) - What the user is focused on / considering
 * - sigma: number (optional) - 1, 2, or 3 - only generate for this level
 * - count: number (optional) - possibilities per level (default: 3, max: 5)
 * - conversation_id: string (optional) - for context
 *
 * Response:
 * {
 *   focus: "Opening a pizza shop",
 *   focusReframed: "Finding a path to community and ownership",
 *   possibilities: {
 *     sigma1: [{ id, text, category, reasoning }],
 *     sigma2: [{ id, text, category, reasoning }],
 *     sigma3: [{ id, text, category, reasoning }]
 *   }
 * }
 */
router.post('/generate', validateBody(generatePossibilitiesSchema), async (req: Request, res: Response) => {
  try {
    const { user_id, focus, sigma, count, conversation_id } = req.body;

    logger.info('Possibilities generation requested', {
      user_id,
      focus: focus.slice(0, 50),
      sigma,
      count,
    });

    const result = await possibilityService.generateSigmaPossibilities(
      user_id,
      focus,
      {
        sigma: sigma as 1 | 2 | 3 | undefined,
        count,
        conversationId: conversation_id,
      }
    );

    res.status(200).json(result);
  } catch (error: any) {
    logger.error('Error in POST /v1/possibilities/generate:', {
      message: error.message,
      stack: error.stack,
      user_id: req.body.user_id,
    });

    res.status(500).json({
      error: 'Failed to generate possibilities',
      details: error.message,
    });
  }
});

/**
 * POST /v1/possibilities/expand
 *
 * Generate more possibilities at a specific sigma level
 * (For when user taps "generate more" on a ring)
 *
 * Request body:
 * - user_id: string (required)
 * - focus: string (required) - same focus as original request
 * - sigma: number (required) - 1, 2, or 3
 * - count: number (optional) - how many more (default: 3)
 * - exclude: string[] (optional) - IDs to exclude (already shown)
 */
router.post('/expand', async (req: Request, res: Response) => {
  try {
    const { user_id, focus, sigma, count = 3, exclude = [] } = req.body;

    if (!user_id || !focus || !sigma) {
      return res.status(400).json({
        error: 'user_id, focus, and sigma are required',
      });
    }

    if (![1, 2, 3].includes(sigma)) {
      return res.status(400).json({
        error: 'sigma must be 1, 2, or 3',
      });
    }

    logger.info('Possibilities expansion requested', {
      user_id,
      focus: focus.slice(0, 50),
      sigma,
      count,
      excludeCount: exclude.length,
    });

    const result = await possibilityService.generateSigmaPossibilities(
      user_id,
      focus,
      {
        sigma: sigma as 1 | 2 | 3,
        count: Math.min(count, 5),
      }
    );

    // Return only the requested sigma level
    const sigmaKey = `sigma${sigma}` as 'sigma1' | 'sigma2' | 'sigma3';
    const possibilities = result.possibilities[sigmaKey];

    res.status(200).json({
      sigma,
      possibilities,
    });
  } catch (error: any) {
    logger.error('Error in POST /v1/possibilities/expand:', {
      message: error.message,
      user_id: req.body.user_id,
    });

    res.status(500).json({
      error: 'Failed to expand possibilities',
      details: error.message,
    });
  }
});

export default router;

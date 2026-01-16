import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { logger } from '../logger';
import { CaptureService } from '../services/capture.service';
import { captureSchema } from '../validation/capture.validation';
import { z } from 'zod';

/**
 * Schema for force route request
 */
const forceRouteSchema = z.object({
  user_id: z.string().uuid('Invalid user ID format'),
  content: z.string().min(1, 'Content is required').max(5000),
  category: z.enum(['ACTION', 'IDEA', 'FACT', 'PERSON']),
});

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
 * Creates the Capture router with injected pool
 */
export function createCaptureRouter(pool: Pool): Router {
  const router = Router();
  const captureService = new CaptureService(pool);

  /**
   * POST /v1/capture
   *
   * Main capture endpoint - classifies user input and routes to appropriate storage
   *
   * Request body:
   * - user_id: string (required) - UUID of the user
   * - content: string (required) - The capture content
   *
   * Response:
   * - routed_to: string - Where the capture was stored (action/idea/fact/person/clarification)
   * - summary: string - Cleaned summary of the capture
   * - confidence: number - AI confidence in the classification (0-1)
   * - record_id: string (optional) - ID of the created record
   * - needs_clarification: boolean (optional) - True if confidence was too low
   * - clarification_message: string (optional) - Message to show user for clarification
   */
  router.post(
    '/',
    validateBody(captureSchema),
    async (req: Request, res: Response) => {
      try {
        const { user_id, content } = req.body;

        logger.info('Capture received', {
          userId: user_id,
          contentLength: content.length,
        });

        const result = await captureService.capture(user_id, content);

        // Return 202 if needs clarification, 201 if successfully stored
        const statusCode = result.needs_clarification ? 202 : 201;

        res.status(statusCode).json(result);
      } catch (error: any) {
        logger.error('Error in POST /v1/capture:', error);
        res.status(500).json({
          error: 'Failed to process capture',
          details: error.message,
        });
      }
    }
  );

  /**
   * POST /v1/capture/force
   *
   * Force-route a capture to a specific category (used after clarification)
   *
   * Request body:
   * - user_id: string (required) - UUID of the user
   * - content: string (required) - The capture content
   * - category: string (required) - Category to route to (ACTION/IDEA/FACT/PERSON)
   *
   * Response: Same as /v1/capture
   */
  router.post(
    '/force',
    validateBody(forceRouteSchema),
    async (req: Request, res: Response) => {
      try {
        const { user_id, content, category } = req.body;

        logger.info('Forced capture received', {
          userId: user_id,
          category,
          contentLength: content.length,
        });

        const result = await captureService.forceRoute(user_id, content, category);

        res.status(201).json(result);
      } catch (error: any) {
        logger.error('Error in POST /v1/capture/force:', error);
        res.status(500).json({
          error: 'Failed to process forced capture',
          details: error.message,
        });
      }
    }
  );

  /**
   * POST /v1/capture/classify
   *
   * Classify content without storing (useful for previewing)
   *
   * Request body:
   * - content: string (required) - The content to classify
   *
   * Response:
   * - category: string - Predicted category
   * - summary: string - Cleaned summary
   * - confidence: number - Classification confidence
   * - person_name: string | null - Extracted person name if applicable
   */
  router.post('/classify', async (req: Request, res: Response) => {
    try {
      const { content } = req.body;

      if (!content || typeof content !== 'string') {
        return res.status(400).json({ error: 'content is required' });
      }

      logger.info('Classification preview requested', {
        contentLength: content.length,
      });

      const classification = await captureService.classify(content);

      res.json(classification);
    } catch (error: any) {
      logger.error('Error in POST /v1/capture/classify:', error);
      res.status(500).json({
        error: 'Failed to classify content',
        details: error.message,
      });
    }
  });

  return router;
}

export default createCaptureRouter;

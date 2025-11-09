import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { logger } from '../logger';
import { SummaryService } from '../services/summary.service';
import { VectorService } from '../services/vector.service';
import {
  createSummarySchema,
  generateSummarySchema,
  summaryIdSchema,
  summaryListQuerySchema,
  summarySearchSchema,
} from '../validation/summary.validation';
import { z } from 'zod';

const router = Router();
const vectorService = new VectorService();
const summaryService = new SummaryService(pool, vectorService);

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
 * POST /v1/summaries/generate
 *
 * Generates a summary from conversation messages using LLM
 *
 * Request body:
 * - conversation_id: string (required) - UUID of the conversation
 * - user_id: string (required) - UUID of the user
 * - message_count: number (optional) - Number of messages to analyze (default: 20, max: 100)
 */
router.post(
  '/generate',
  validateBody(generateSummarySchema),
  async (req: Request, res: Response) => {
    try {
      const summary = await summaryService.generateSummary(req.body);

      logger.info('Summary generated', {
        id: summary.id,
        conversation_id: req.body.conversation_id,
        message_count: summary.message_count,
      });

      res.status(201).json(summary);
    } catch (error: any) {
      logger.error('Error in POST /v1/summaries/generate:', {
        message: error.message,
      });

      if (error.message.includes('No messages found')) {
        return res.status(404).json({
          error: 'No messages found in conversation',
        });
      }

      if (error.message.includes('Claude') || error.message.includes('Anthropic')) {
        return res.status(503).json({
          error: 'Summary generation temporarily unavailable',
          details: error.message,
        });
      }

      res.status(500).json({
        error: 'Failed to generate summary',
        details: error.message,
      });
    }
  }
);

/**
 * POST /v1/summaries
 *
 * Creates a summary manually
 *
 * Request body:
 * - conversation_id: string (required) - UUID of the conversation
 * - user_id: string (required) - UUID of the user
 * - user_perspective: string (optional) - User's perspective summary
 * - model_perspective: string (optional) - Model's perspective summary
 * - conversation_overview: string (optional) - Objective overview
 * - message_count: number (optional) - Number of messages in conversation
 * - skip_embeddings: boolean (optional) - Skip embedding generation (default: false)
 */
router.post(
  '/',
  validateBody(createSummarySchema),
  async (req: Request, res: Response) => {
    try {
      const summary = await summaryService.createSummary(req.body);

      logger.info('Summary created manually', {
        id: summary.id,
        conversation_id: req.body.conversation_id,
      });

      res.status(201).json(summary);
    } catch (error: any) {
      logger.error('Error in POST /v1/summaries:', {
        message: error.message,
      });

      res.status(500).json({
        error: 'Failed to create summary',
        details: error.message,
      });
    }
  }
);

/**
 * GET /v1/summaries/:id
 *
 * Retrieves a specific summary by ID
 *
 * Path parameters:
 * - id: string - UUID of the summary
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = summaryIdSchema.parse(req.params);

    const summary = await summaryService.findById(id);

    if (!summary) {
      return res.status(404).json({ error: 'Summary not found' });
    }

    res.json(summary);
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

    logger.error('Error in GET /v1/summaries/:id:', error);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

/**
 * GET /v1/conversations/:conversation_id/summaries
 *
 * Lists all summaries for a specific conversation
 *
 * Path parameters:
 * - conversation_id: string - UUID of the conversation
 *
 * Query parameters:
 * - limit: number (optional) - Maximum summaries to return (default: 50, max: 500)
 * - offset: number (optional) - Number of summaries to skip (default: 0)
 */
router.get('/conversations/:conversation_id', async (req: Request, res: Response) => {
  try {
    const conversationIdSchema = z.object({
      conversation_id: z.string().uuid(),
    });

    const { conversation_id } = conversationIdSchema.parse(req.params);
    const queryParams = summaryListQuerySchema.parse(req.query);

    const summaries = await summaryService.listByConversation(conversation_id, {
      limit: queryParams.limit,
      offset: queryParams.offset,
    });

    res.json({
      summaries,
      count: summaries.length,
      conversation_id,
      limit: queryParams.limit,
      offset: queryParams.offset,
    });
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

    logger.error('Error in GET /v1/conversations/:conversation_id/summaries:', error);
    res.status(500).json({ error: 'Failed to fetch summaries' });
  }
});

/**
 * GET /v1/users/:user_id/summaries
 *
 * Lists all summaries for a specific user
 *
 * Path parameters:
 * - user_id: string - UUID of the user
 *
 * Query parameters:
 * - limit: number (optional) - Maximum summaries to return (default: 50, max: 500)
 * - offset: number (optional) - Number of summaries to skip (default: 0)
 */
router.get('/users/:user_id', async (req: Request, res: Response) => {
  try {
    const userIdSchema = z.object({
      user_id: z.string().uuid(),
    });

    const { user_id } = userIdSchema.parse(req.params);
    const queryParams = summaryListQuerySchema.parse(req.query);

    const summaries = await summaryService.listByUser(user_id, {
      limit: queryParams.limit,
      offset: queryParams.offset,
    });

    res.json({
      summaries,
      count: summaries.length,
      user_id,
      limit: queryParams.limit,
      offset: queryParams.offset,
    });
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

    logger.error('Error in GET /v1/users/:user_id/summaries:', error);
    res.status(500).json({ error: 'Failed to fetch summaries' });
  }
});

/**
 * POST /v1/summaries/search
 *
 * Performs semantic search across summaries using vector similarity.
 * Can search specific perspectives (user, model, or overview).
 *
 * Request body:
 * - query: string (required) - Search query
 * - user_id: string (optional) - Limit search to specific user
 * - conversation_id: string (optional) - Limit to specific conversation
 * - perspective: string (optional) - Which perspective to search: 'user', 'model', or 'overview' (default: 'overview')
 * - limit: number (optional) - Maximum results (default: 10, max: 100)
 * - min_similarity: number (optional) - Minimum similarity threshold 0-1 (default: 0.7)
 */
router.post(
  '/search',
  validateBody(summarySearchSchema),
  async (req: Request, res: Response) => {
    try {
      const {
        query,
        user_id,
        conversation_id,
        perspective,
        limit,
        min_similarity,
      } = req.body;

      const results = await summaryService.semanticSearch(query, {
        user_id,
        conversation_id,
        perspective,
        limit,
        min_similarity,
      });

      res.json({
        results,
        count: results.length,
        query,
        perspective: perspective || 'overview',
        min_similarity,
      });
    } catch (error: any) {
      logger.error('Error in POST /v1/summaries/search:', error);

      if (
        error.message.includes('OpenAI') ||
        error.message.includes('embedding')
      ) {
        return res.status(503).json({
          error: 'Semantic search temporarily unavailable',
          details: error.message,
        });
      }

      res.status(500).json({
        error: 'Failed to perform semantic search',
        details: error.message,
      });
    }
  }
);

/**
 * DELETE /v1/summaries/:id
 *
 * Deletes a summary
 *
 * Path parameters:
 * - id: string - UUID of the summary
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = summaryIdSchema.parse(req.params);

    const deleted = await summaryService.deleteSummary(id);

    if (!deleted) {
      return res.status(404).json({ error: 'Summary not found' });
    }

    logger.info('Summary deleted', { id });
    res.status(204).send();
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

    logger.error('Error in DELETE /v1/summaries/:id:', error);
    res.status(500).json({ error: 'Failed to delete summary' });
  }
});

export default router;

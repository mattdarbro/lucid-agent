import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '../logger';
import { ResearchQueueService } from '../services/research-queue.service';
import { pool } from '../db';

const router = Router();
const researchQueueService = new ResearchQueueService(pool);

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

function validateQuery(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: Function) => {
    try {
      req.query = schema.parse(req.query);
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

// Validation schemas
const userIdParamSchema = z.object({
  userId: z.string().uuid(),
});

const itemIdParamSchema = z.object({
  itemId: z.string().uuid(),
});

const addToQueueSchema = z.object({
  user_id: z.string().uuid(),
  topic: z.string().min(1).max(500),
  search_query: z.string().max(500).optional(),
  why_it_matters: z.string().min(1).max(1000),
  source_conversation_id: z.string().uuid().optional(),
  source_snippet: z.string().max(500).optional(),
  priority: z.number().int().min(1).max(10).optional(),
});

const listQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'in_progress', 'completed', 'not_useful', 'abandoned']).optional(),
  limit: z.string().transform(Number).pipe(z.number().int().min(1).max(50)).optional(),
});

const updatePrioritySchema = z.object({
  priority: z.number().int().min(1).max(10),
});

/**
 * GET /v1/research-queue/user/:userId
 *
 * Get all research queue items for a user
 */
router.get(
  '/user/:userId',
  async (req: Request, res: Response) => {
    try {
      const { userId } = userIdParamSchema.parse(req.params);
      const { status, limit } = listQuerySchema.parse(req.query);

      let items;
      if (status === 'pending') {
        items = await researchQueueService.getPendingItems(userId, limit || 20);
      } else if (status === 'approved') {
        items = await researchQueueService.getApprovedItems(userId);
      } else if (status === 'in_progress') {
        items = await researchQueueService.getInProgressItems(userId);
      } else {
        // Get all pending by default
        items = await researchQueueService.getPendingItems(userId, limit || 20);
      }

      res.status(200).json({ items });
    } catch (error: any) {
      logger.error('Error in GET /v1/research-queue/user/:userId:', {
        message: error.message,
      });
      res.status(500).json({
        error: 'Failed to fetch research queue',
        details: error.message,
      });
    }
  }
);

/**
 * GET /v1/research-queue/user/:userId/stats
 *
 * Get queue statistics for a user
 */
router.get(
  '/user/:userId/stats',
  async (req: Request, res: Response) => {
    try {
      const { userId } = userIdParamSchema.parse(req.params);
      const stats = await researchQueueService.getQueueStats(userId);

      res.status(200).json(stats);
    } catch (error: any) {
      logger.error('Error in GET /v1/research-queue/user/:userId/stats:', {
        message: error.message,
      });
      res.status(500).json({
        error: 'Failed to fetch queue stats',
        details: error.message,
      });
    }
  }
);

/**
 * POST /v1/research-queue
 *
 * Add a new item to the research queue
 */
router.post(
  '/',
  validateBody(addToQueueSchema),
  async (req: Request, res: Response) => {
    try {
      const item = await researchQueueService.addToQueue({
        userId: req.body.user_id,
        topic: req.body.topic,
        searchQuery: req.body.search_query,
        whyItMatters: req.body.why_it_matters,
        sourceConversationId: req.body.source_conversation_id,
        sourceSnippet: req.body.source_snippet,
        priority: req.body.priority,
      });

      res.status(201).json(item);
    } catch (error: any) {
      logger.error('Error in POST /v1/research-queue:', {
        message: error.message,
      });
      res.status(500).json({
        error: 'Failed to add to research queue',
        details: error.message,
      });
    }
  }
);

/**
 * POST /v1/research-queue/:itemId/approve
 *
 * User approves a research topic
 */
router.post(
  '/:itemId/approve',
  async (req: Request, res: Response) => {
    try {
      const { itemId } = itemIdParamSchema.parse(req.params);

      await researchQueueService.userApproves(itemId);

      const item = await researchQueueService.getItemById(itemId);
      res.status(200).json({
        message: 'Research topic approved',
        item,
      });
    } catch (error: any) {
      logger.error('Error in POST /v1/research-queue/:itemId/approve:', {
        message: error.message,
      });
      res.status(500).json({
        error: 'Failed to approve research topic',
        details: error.message,
      });
    }
  }
);

/**
 * POST /v1/research-queue/:itemId/reject
 *
 * User rejects a research topic
 */
router.post(
  '/:itemId/reject',
  async (req: Request, res: Response) => {
    try {
      const { itemId } = itemIdParamSchema.parse(req.params);

      await researchQueueService.userRejects(itemId);

      res.status(200).json({
        message: 'Research topic rejected',
      });
    } catch (error: any) {
      logger.error('Error in POST /v1/research-queue/:itemId/reject:', {
        message: error.message,
      });
      res.status(500).json({
        error: 'Failed to reject research topic',
        details: error.message,
      });
    }
  }
);

/**
 * PATCH /v1/research-queue/:itemId/priority
 *
 * Update priority of a research item
 */
router.patch(
  '/:itemId/priority',
  validateBody(updatePrioritySchema),
  async (req: Request, res: Response) => {
    try {
      const { itemId } = itemIdParamSchema.parse(req.params);
      const { priority } = req.body;

      await researchQueueService.updatePriority(itemId, priority);

      const item = await researchQueueService.getItemById(itemId);
      res.status(200).json(item);
    } catch (error: any) {
      logger.error('Error in PATCH /v1/research-queue/:itemId/priority:', {
        message: error.message,
      });
      res.status(500).json({
        error: 'Failed to update priority',
        details: error.message,
      });
    }
  }
);

/**
 * DELETE /v1/research-queue/:itemId
 *
 * Delete a research queue item
 */
router.delete(
  '/:itemId',
  async (req: Request, res: Response) => {
    try {
      const { itemId } = itemIdParamSchema.parse(req.params);

      await researchQueueService.deleteItem(itemId);

      res.status(200).json({
        message: 'Research queue item deleted',
      });
    } catch (error: any) {
      logger.error('Error in DELETE /v1/research-queue/:itemId:', {
        message: error.message,
      });
      res.status(500).json({
        error: 'Failed to delete research queue item',
        details: error.message,
      });
    }
  }
);

/**
 * GET /v1/research-queue/:itemId
 *
 * Get a single research queue item
 */
router.get(
  '/:itemId',
  async (req: Request, res: Response) => {
    try {
      const { itemId } = itemIdParamSchema.parse(req.params);

      const item = await researchQueueService.getItemById(itemId);

      if (!item) {
        return res.status(404).json({ error: 'Research queue item not found' });
      }

      res.status(200).json(item);
    } catch (error: any) {
      logger.error('Error in GET /v1/research-queue/:itemId:', {
        message: error.message,
      });
      res.status(500).json({
        error: 'Failed to fetch research queue item',
        details: error.message,
      });
    }
  }
);

export default router;

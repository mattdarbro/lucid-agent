import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { logger } from '../logger';
import { MattStateService } from '../services/matt-state.service';
import {
  userIdParamSchema,
  updateMattStateSchema,
  stateHistoryQuerySchema,
} from '../validation/matt-state.validation';
import { z } from 'zod';

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
 * Creates the Matt State router with injected pool
 */
export function createMattStateRouter(pool: Pool): Router {
  const router = Router();
  const mattStateService = new MattStateService(pool);

  /**
   * GET /v1/matt-state/:user_id
   *
   * Gets or creates the current state for a user
   *
   * Path parameters:
   * - user_id: string - UUID of the user
   */
  router.get('/:user_id', async (req: Request, res: Response) => {
    try {
      const { user_id } = userIdParamSchema.parse(req.params);

      const state = await mattStateService.getOrCreateState(user_id);

      res.json(state);
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

      logger.error('Error in GET /v1/matt-state/:user_id:', error);
      res.status(500).json({ error: 'Failed to fetch state' });
    }
  });

  /**
   * PUT /v1/matt-state/:user_id
   *
   * Updates the current state for a user
   *
   * Path parameters:
   * - user_id: string - UUID of the user
   *
   * Request body:
   * - active_goals: array (optional) - Array of goal objects
   * - active_commitments: array (optional) - Array of commitment objects
   * - resources: object (optional) - Resources object
   * - constraints: object (optional) - Constraints object
   * - values_priorities: object (optional) - Values and priorities
   */
  router.put(
    '/:user_id',
    validateBody(updateMattStateSchema),
    async (req: Request, res: Response) => {
      try {
        const { user_id } = userIdParamSchema.parse(req.params);

        const state = await mattStateService.updateState(user_id, req.body, 'user');

        res.json(state);
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

        logger.error('Error in PUT /v1/matt-state/:user_id:', error);
        res.status(500).json({ error: 'Failed to update state' });
      }
    }
  );

  /**
   * PATCH /v1/matt-state/:user_id
   *
   * Partially updates the current state for a user
   * Same as PUT but clearer intent for partial updates
   */
  router.patch(
    '/:user_id',
    validateBody(updateMattStateSchema),
    async (req: Request, res: Response) => {
      try {
        const { user_id } = userIdParamSchema.parse(req.params);

        const state = await mattStateService.updateState(user_id, req.body, 'user');

        res.json(state);
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

        logger.error('Error in PATCH /v1/matt-state/:user_id:', error);
        res.status(500).json({ error: 'Failed to update state' });
      }
    }
  );

  /**
   * GET /v1/matt-state/:user_id/history
   *
   * Gets state history for a user
   *
   * Path parameters:
   * - user_id: string - UUID of the user
   *
   * Query parameters:
   * - limit: number (optional) - Maximum entries to return (default: 10)
   */
  router.get('/:user_id/history', async (req: Request, res: Response) => {
    try {
      const { user_id } = userIdParamSchema.parse(req.params);
      const { limit } = stateHistoryQuerySchema.parse(req.query);

      const history = await mattStateService.getStateHistory(user_id, limit);

      res.json({
        history,
        count: history.length,
        limit,
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

      logger.error('Error in GET /v1/matt-state/:user_id/history:', error);
      res.status(500).json({ error: 'Failed to fetch state history' });
    }
  });

  /**
   * GET /v1/matt-state/:user_id/summary
   *
   * Gets a concise state summary for a user
   *
   * Path parameters:
   * - user_id: string - UUID of the user
   */
  router.get('/:user_id/summary', async (req: Request, res: Response) => {
    try {
      const { user_id } = userIdParamSchema.parse(req.params);

      const summary = await mattStateService.getStateSummary(user_id);

      res.json({ summary });
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

      logger.error('Error in GET /v1/matt-state/:user_id/summary:', error);
      res.status(500).json({ error: 'Failed to fetch state summary' });
    }
  });

  return router;
}

export default createMattStateRouter;

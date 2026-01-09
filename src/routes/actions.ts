import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { logger } from '../logger';
import { ActionsService } from '../services/actions.service';
import {
  userIdParamSchema,
  actionIdParamSchema,
  createActionSchema,
  updateActionSchema,
  actionsListQuerySchema,
  changeStatusSchema,
} from '../validation/actions.validation';
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
 * Creates the Actions router with injected pool
 */
export function createActionsRouter(pool: Pool): Router {
  const router = Router();
  const actionsService = new ActionsService(pool);

  /**
   * GET /v1/actions/:user_id
   *
   * Gets all actions for a user with optional filters
   *
   * Path parameters:
   * - user_id: string - UUID of the user
   *
   * Query parameters:
   * - status: string (optional) - Filter by status (open/done/cancelled)
   * - person_id: string (optional) - Filter by linked person
   * - source: string (optional) - Filter by source
   * - limit: number (optional) - Maximum actions to return
   * - offset: number (optional) - Pagination offset
   */
  router.get('/:user_id', async (req: Request, res: Response) => {
    try {
      const { user_id } = userIdParamSchema.parse(req.params);
      const query = actionsListQuerySchema.parse(req.query);

      const actions = await actionsService.getByUser(user_id, query);
      const counts = await actionsService.getCounts(user_id);

      res.json({
        actions,
        count: actions.length,
        totals: counts,
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

      logger.error('Error in GET /v1/actions/:user_id:', error);
      res.status(500).json({ error: 'Failed to fetch actions' });
    }
  });

  /**
   * GET /v1/actions/:user_id/open
   *
   * Gets open (active) actions for a user
   *
   * Path parameters:
   * - user_id: string - UUID of the user
   */
  router.get('/:user_id/open', async (req: Request, res: Response) => {
    try {
      const { user_id } = userIdParamSchema.parse(req.params);

      const actions = await actionsService.getOpenActions(user_id);

      res.json({
        actions,
        count: actions.length,
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

      logger.error('Error in GET /v1/actions/:user_id/open:', error);
      res.status(500).json({ error: 'Failed to fetch open actions' });
    }
  });

  /**
   * GET /v1/actions/:user_id/counts
   *
   * Gets action counts by status for a user
   *
   * Path parameters:
   * - user_id: string - UUID of the user
   */
  router.get('/:user_id/counts', async (req: Request, res: Response) => {
    try {
      const { user_id } = userIdParamSchema.parse(req.params);

      const counts = await actionsService.getCounts(user_id);

      res.json(counts);
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

      logger.error('Error in GET /v1/actions/:user_id/counts:', error);
      res.status(500).json({ error: 'Failed to fetch action counts' });
    }
  });

  /**
   * GET /v1/actions/:user_id/completed
   *
   * Gets recently completed actions
   *
   * Path parameters:
   * - user_id: string - UUID of the user
   *
   * Query parameters:
   * - days: number (optional) - Days to look back (default: 7)
   * - limit: number (optional) - Maximum results (default: 20)
   */
  router.get('/:user_id/completed', async (req: Request, res: Response) => {
    try {
      const { user_id } = userIdParamSchema.parse(req.params);
      const days = parseInt(req.query.days as string) || 7;
      const limit = parseInt(req.query.limit as string) || 20;

      const actions = await actionsService.getRecentlyCompleted(user_id, days, limit);

      res.json({
        actions,
        count: actions.length,
        days_back: days,
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

      logger.error('Error in GET /v1/actions/:user_id/completed:', error);
      res.status(500).json({ error: 'Failed to fetch completed actions' });
    }
  });

  /**
   * GET /v1/actions/:user_id/action/:action_id
   *
   * Gets a specific action by ID
   *
   * Path parameters:
   * - user_id: string - UUID of the user
   * - action_id: string - UUID of the action
   */
  router.get('/:user_id/action/:action_id', async (req: Request, res: Response) => {
    try {
      userIdParamSchema.parse(req.params);
      const { action_id } = actionIdParamSchema.parse(req.params);

      const action = await actionsService.getById(action_id);

      if (!action) {
        return res.status(404).json({ error: 'Action not found' });
      }

      res.json(action);
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

      logger.error('Error in GET /v1/actions/:user_id/action/:action_id:', error);
      res.status(500).json({ error: 'Failed to fetch action' });
    }
  });

  /**
   * POST /v1/actions/:user_id
   *
   * Creates a new action
   *
   * Path parameters:
   * - user_id: string - UUID of the user
   *
   * Request body:
   * - content: string (required) - Action content
   * - summary: string (optional) - Cleaned summary
   * - person_id: string (optional) - Link to orbit person
   * - source: string (optional) - Source of the action
   */
  router.post(
    '/:user_id',
    validateBody(createActionSchema),
    async (req: Request, res: Response) => {
      try {
        const { user_id } = userIdParamSchema.parse(req.params);

        const action = await actionsService.create(user_id, req.body);

        res.status(201).json(action);
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

        logger.error('Error in POST /v1/actions/:user_id:', error);
        res.status(500).json({ error: 'Failed to create action' });
      }
    }
  );

  /**
   * PUT /v1/actions/:user_id/action/:action_id
   *
   * Updates an action
   *
   * Path parameters:
   * - user_id: string - UUID of the user
   * - action_id: string - UUID of the action
   *
   * Request body:
   * - content: string (optional) - Updated content
   * - summary: string (optional) - Updated summary
   * - status: string (optional) - New status
   * - person_id: string (optional) - Updated person link
   */
  router.put(
    '/:user_id/action/:action_id',
    validateBody(updateActionSchema),
    async (req: Request, res: Response) => {
      try {
        userIdParamSchema.parse(req.params);
        const { action_id } = actionIdParamSchema.parse(req.params);

        const action = await actionsService.update(action_id, req.body);

        if (!action) {
          return res.status(404).json({ error: 'Action not found' });
        }

        res.json(action);
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

        logger.error('Error in PUT /v1/actions/:user_id/action/:action_id:', error);
        res.status(500).json({ error: 'Failed to update action' });
      }
    }
  );

  /**
   * PATCH /v1/actions/:user_id/action/:action_id/done
   *
   * Marks an action as done
   *
   * Path parameters:
   * - user_id: string - UUID of the user
   * - action_id: string - UUID of the action
   */
  router.patch('/:user_id/action/:action_id/done', async (req: Request, res: Response) => {
    try {
      userIdParamSchema.parse(req.params);
      const { action_id } = actionIdParamSchema.parse(req.params);

      const action = await actionsService.markDone(action_id);

      if (!action) {
        return res.status(404).json({ error: 'Action not found' });
      }

      res.json(action);
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

      logger.error('Error in PATCH /v1/actions/:user_id/action/:action_id/done:', error);
      res.status(500).json({ error: 'Failed to mark action as done' });
    }
  });

  /**
   * PATCH /v1/actions/:user_id/action/:action_id/cancel
   *
   * Marks an action as cancelled
   *
   * Path parameters:
   * - user_id: string - UUID of the user
   * - action_id: string - UUID of the action
   */
  router.patch('/:user_id/action/:action_id/cancel', async (req: Request, res: Response) => {
    try {
      userIdParamSchema.parse(req.params);
      const { action_id } = actionIdParamSchema.parse(req.params);

      const action = await actionsService.markCancelled(action_id);

      if (!action) {
        return res.status(404).json({ error: 'Action not found' });
      }

      res.json(action);
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

      logger.error('Error in PATCH /v1/actions/:user_id/action/:action_id/cancel:', error);
      res.status(500).json({ error: 'Failed to cancel action' });
    }
  });

  /**
   * PATCH /v1/actions/:user_id/action/:action_id/reopen
   *
   * Reopens a completed or cancelled action
   *
   * Path parameters:
   * - user_id: string - UUID of the user
   * - action_id: string - UUID of the action
   */
  router.patch('/:user_id/action/:action_id/reopen', async (req: Request, res: Response) => {
    try {
      userIdParamSchema.parse(req.params);
      const { action_id } = actionIdParamSchema.parse(req.params);

      const action = await actionsService.reopen(action_id);

      if (!action) {
        return res.status(404).json({ error: 'Action not found' });
      }

      res.json(action);
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

      logger.error('Error in PATCH /v1/actions/:user_id/action/:action_id/reopen:', error);
      res.status(500).json({ error: 'Failed to reopen action' });
    }
  });

  /**
   * DELETE /v1/actions/:user_id/action/:action_id
   *
   * Deletes an action permanently
   *
   * Path parameters:
   * - user_id: string - UUID of the user
   * - action_id: string - UUID of the action
   */
  router.delete('/:user_id/action/:action_id', async (req: Request, res: Response) => {
    try {
      userIdParamSchema.parse(req.params);
      const { action_id } = actionIdParamSchema.parse(req.params);

      const deleted = await actionsService.delete(action_id);

      if (!deleted) {
        return res.status(404).json({ error: 'Action not found' });
      }

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

      logger.error('Error in DELETE /v1/actions/:user_id/action/:action_id:', error);
      res.status(500).json({ error: 'Failed to delete action' });
    }
  });

  return router;
}

export default createActionsRouter;

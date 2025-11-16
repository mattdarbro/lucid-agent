import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { logger } from '../logger';
import { ThoughtNotificationService } from '../services/thought-notification.service';
import {
  createThoughtNotificationSchema,
  updateThoughtNotificationSchema,
  respondToNotificationSchema,
  notificationListQuerySchema,
  notificationIdSchema,
} from '../validation/thought-notification.validation';
import { z } from 'zod';

const router = Router();
const notificationService = new ThoughtNotificationService(pool);

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
 * POST /v1/thought-notifications
 *
 * Create a new thought notification
 * Used by autonomous thoughts or manually to queue questions for users
 *
 * Request body:
 * - user_id: string (required) - UUID of the user
 * - thought_id: string (optional) - UUID of associated autonomous thought
 * - research_task_id: string (optional) - UUID of associated research task
 * - question: string (required) - What Lucid wants to ask
 * - context: string (optional) - Background context
 * - preferred_time_of_day: string (optional) - 'morning', 'afternoon', 'evening', 'late_night', 'any'
 * - preferred_cognitive_state: string (optional) - 'analytical', 'creative', 'reflective', 'philosophical', 'emotional', 'any'
 * - priority: number (optional) - 0.0 to 1.0 (default: 0.5)
 * - expires_at: string (optional) - ISO datetime when notification becomes irrelevant
 */
router.post(
  '/',
  validateBody(createThoughtNotificationSchema),
  async (req: Request, res: Response) => {
    try {
      const notification = await notificationService.createNotification(req.body);
      res.status(201).json(notification);
    } catch (error: any) {
      logger.error('Error in POST /v1/thought-notifications:', error);

      if (error.message.includes('not found')) {
        return res.status(404).json({ error: error.message });
      }

      res.status(500).json({
        error: 'Failed to create thought notification',
        details: error.message,
      });
    }
  }
);

/**
 * GET /v1/thought-notifications/:id
 *
 * Get a specific thought notification
 *
 * Path parameters:
 * - id: string - UUID of the notification
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = notificationIdSchema.parse(req.params);

    const notification = await notificationService.findById(id);

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json(notification);
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

    logger.error('Error in GET /v1/thought-notifications/:id:', error);
    res.status(500).json({ error: 'Failed to fetch notification' });
  }
});

/**
 * GET /v1/users/:user_id/thought-notifications
 *
 * List thought notifications for a user
 *
 * Path parameters:
 * - user_id: string - UUID of the user
 *
 * Query parameters:
 * - status: string (optional) - Filter by status ('pending', 'sent', 'responded', 'expired', 'skipped')
 * - limit: number (optional) - Maximum notifications to return (default: 50, max: 100)
 * - offset: number (optional) - Number of notifications to skip (default: 0)
 */
router.get('/users/:user_id', async (req: Request, res: Response) => {
  try {
    const userIdSchema = z.object({
      user_id: z.string().uuid(),
    });

    const { user_id } = userIdSchema.parse(req.params);
    const queryParams = notificationListQuerySchema.parse(req.query);

    const notifications = await notificationService.listByUser(user_id, {
      status: queryParams.status,
      limit: queryParams.limit,
      offset: queryParams.offset,
    });

    res.json({
      notifications,
      count: notifications.length,
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

    logger.error('Error in GET /v1/users/:user_id/thought-notifications:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

/**
 * GET /v1/users/:user_id/thought-notifications/pending
 *
 * Get pending notifications for a user (most important first)
 *
 * Path parameters:
 * - user_id: string - UUID of the user
 *
 * Query parameters:
 * - limit: number (optional) - Maximum notifications to return (default: 10)
 */
router.get('/users/:user_id/pending', async (req: Request, res: Response) => {
  try {
    const userIdSchema = z.object({
      user_id: z.string().uuid(),
    });

    const { user_id } = userIdSchema.parse(req.params);
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;

    const notifications = await notificationService.getPendingNotifications(user_id, limit);

    res.json({
      notifications,
      count: notifications.length,
      user_id,
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

    logger.error('Error in GET /v1/users/:user_id/thought-notifications/pending:', error);
    res.status(500).json({ error: 'Failed to fetch pending notifications' });
  }
});

/**
 * PATCH /v1/thought-notifications/:id
 *
 * Update a thought notification
 *
 * Path parameters:
 * - id: string - UUID of the notification
 *
 * Request body:
 * - question: string (optional)
 * - context: string (optional)
 * - preferred_time_of_day: string (optional)
 * - preferred_cognitive_state: string (optional)
 * - priority: number (optional)
 * - expires_at: string (optional)
 * - status: string (optional)
 */
router.patch(
  '/:id',
  validateBody(updateThoughtNotificationSchema),
  async (req: Request, res: Response) => {
    try {
      const { id } = notificationIdSchema.parse(req.params);

      const notification = await notificationService.updateNotification(id, req.body);

      if (!notification) {
        return res.status(404).json({ error: 'Notification not found' });
      }

      res.json(notification);
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

      logger.error('Error in PATCH /v1/thought-notifications/:id:', error);
      res.status(500).json({ error: 'Failed to update notification' });
    }
  }
);

/**
 * POST /v1/thought-notifications/:id/respond
 *
 * User responds to a thought notification
 * This is the key interaction point!
 *
 * Path parameters:
 * - id: string - UUID of the notification
 *
 * Request body:
 * - response_text: string (required) - User's response
 * - self_reported_energy: number (optional) - 1-5 scale
 * - self_reported_mood: number (optional) - 1-5 scale
 * - self_reported_focus: number (optional) - 1-5 scale
 */
router.post(
  '/:id/respond',
  validateBody(respondToNotificationSchema),
  async (req: Request, res: Response) => {
    try {
      const { id } = notificationIdSchema.parse(req.params);

      const notification = await notificationService.respondToNotification(id, req.body);

      logger.info('User responded to notification', {
        id,
        user_id: notification.user_id,
      });

      res.json({
        notification,
        message: 'Response recorded successfully',
      });
    } catch (error: any) {
      logger.error('Error in POST /v1/thought-notifications/:id/respond:', error);

      if (error.message.includes('not found')) {
        return res.status(404).json({ error: 'Notification not found' });
      }

      if (error.message.includes('Cannot respond')) {
        return res.status(400).json({ error: error.message });
      }

      res.status(500).json({
        error: 'Failed to record response',
        details: error.message,
      });
    }
  }
);

/**
 * POST /v1/thought-notifications/:id/skip
 *
 * Skip/dismiss a notification without responding
 *
 * Path parameters:
 * - id: string - UUID of the notification
 */
router.post('/:id/skip', async (req: Request, res: Response) => {
  try {
    const { id } = notificationIdSchema.parse(req.params);

    const notification = await notificationService.skipNotification(id);

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({
      notification,
      message: 'Notification skipped',
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

    logger.error('Error in POST /v1/thought-notifications/:id/skip:', error);
    res.status(500).json({ error: 'Failed to skip notification' });
  }
});

/**
 * POST /v1/thought-notifications/:id/send
 *
 * Mark a notification as sent
 * Used by notification delivery system
 *
 * Path parameters:
 * - id: string - UUID of the notification
 */
router.post('/:id/send', async (req: Request, res: Response) => {
  try {
    const { id } = notificationIdSchema.parse(req.params);

    const notification = await notificationService.markAsSent(id);

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({
      notification,
      message: 'Notification marked as sent',
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

    logger.error('Error in POST /v1/thought-notifications/:id/send:', error);
    res.status(500).json({ error: 'Failed to mark notification as sent' });
  }
});

/**
 * DELETE /v1/thought-notifications/:id
 *
 * Delete a notification
 *
 * Path parameters:
 * - id: string - UUID of the notification
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = notificationIdSchema.parse(req.params);

    const deleted = await notificationService.deleteNotification(id);

    if (!deleted) {
      return res.status(404).json({ error: 'Notification not found' });
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

    logger.error('Error in DELETE /v1/thought-notifications/:id:', error);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

export default router;

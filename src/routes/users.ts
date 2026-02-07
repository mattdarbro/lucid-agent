import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { logger } from '../logger';
import { UserService } from '../services/user.service';
import { ThoughtNotificationService } from '../services/thought-notification.service';
import { MultiDayTaskService } from '../services/multi-day-task.service';
import { PushNotificationService } from '../services/push-notification.service';
import { ProfileService } from '../services/profile.service';
import {
  createUserSchema,
  updateUserSchema,
  userExternalIdSchema,
} from '../validation/user.validation';
import { notificationListQuerySchema } from '../validation/thought-notification.validation';
import { multiDayTaskListQuerySchema } from '../validation/multi-day-task.validation';
import { z } from 'zod';

const router = Router();
const userService = new UserService(pool);
const notificationService = new ThoughtNotificationService(pool);
const taskService = new MultiDayTaskService(pool);
const pushService = new PushNotificationService(pool);
const profileService = new ProfileService(pool);

/**
 * Validation middleware helper
 * Validates request body against a Zod schema
 */
function validateBody(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: Function) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.errors.map((err: any) => ({
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
 * POST /v1/users
 *
 * Creates a new user or updates existing user if external_id already exists.
 * This is the primary endpoint that iOS apps will call.
 *
 * Request body:
 * - external_id: string (required) - iOS app user ID
 * - name: string (optional)
 * - email: string (optional)
 * - timezone: string (optional, defaults to UTC)
 * - preferences: object (optional)
 */
router.post('/', validateBody(createUserSchema), async (req: Request, res: Response) => {
  try {
    const user = await userService.createOrUpdateUser(req.body);
    res.status(201).json(user);
  } catch (error: any) {
    logger.error('Error in POST /v1/users:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

/**
 * GET /v1/users/by-id/:id
 *
 * Retrieves a user by their internal UUID (for testing/debugging)
 *
 * Path parameters:
 * - id: string - The internal user UUID
 */
router.get('/by-id/:id', async (req: Request, res: Response) => {
  try {
    const uuidSchema = z.object({
      id: z.string().uuid(),
    });

    const { id } = uuidSchema.parse(req.params);

    const query = 'SELECT * FROM users WHERE id = $1';
    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors.map((err: any) => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      });
    }

    logger.error('Error in GET /v1/users/by-id/:id:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

/**
 * GET /v1/users/:user_id/thought-notifications/pending
 *
 * RESTful alias for iOS compatibility
 * Get pending notifications for a user (most important first)
 *
 * Path parameters:
 * - user_id: string - UUID of the user
 *
 * Query parameters:
 * - limit: number (optional) - Maximum notifications to return (default: 10)
 */
router.get('/:user_id/thought-notifications/pending', async (req: Request, res: Response) => {
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
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors.map((err: any) => ({
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
 * GET /v1/users/:user_id/thought-notifications
 *
 * RESTful alias for iOS compatibility
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
router.get('/:user_id/thought-notifications', async (req: Request, res: Response) => {
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
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors.map((err: any) => ({
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
 * GET /v1/users/:user_id/multi-day-tasks
 *
 * RESTful alias for iOS compatibility
 * List multi-day tasks for a user
 *
 * Path parameters:
 * - user_id: string - UUID of the user
 *
 * Query parameters:
 * - status: string (optional) - Filter by status ('active', 'paused', 'completed', 'abandoned')
 * - topic_category: string (optional) - Filter by category
 * - limit: number (optional) - Maximum tasks to return (default: 50, max: 100)
 * - offset: number (optional) - Number of tasks to skip (default: 0)
 */
router.get('/:user_id/multi-day-tasks', async (req: Request, res: Response) => {
  try {
    const userIdSchema = z.object({
      user_id: z.string().uuid(),
    });

    const { user_id } = userIdSchema.parse(req.params);
    const queryParams = multiDayTaskListQuerySchema.parse(req.query);

    const tasks = await taskService.listByUser(user_id, {
      status: queryParams.status,
      topic_category: queryParams.topic_category,
      limit: queryParams.limit,
      offset: queryParams.offset,
    });

    res.json({
      tasks,
      count: tasks.length,
      user_id,
      limit: queryParams.limit,
      offset: queryParams.offset,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors.map((err: any) => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      });
    }

    logger.error('Error in GET /v1/users/:user_id/multi-day-tasks:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

/**
 * GET /v1/users/:external_id
 *
 * Retrieves a user by their external ID (iOS app user ID)
 *
 * Path parameters:
 * - external_id: string - The external identifier
 */
router.get('/:external_id', async (req: Request, res: Response) => {
  try {
    // Validate parameter
    const { external_id } = userExternalIdSchema.parse(req.params);

    const user = await userService.findByExternalId(external_id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors.map((err: any) => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      });
    }

    logger.error('Error in GET /v1/users/:external_id:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

/**
 * PATCH /v1/users/:external_id
 *
 * Updates an existing user by external ID
 *
 * Path parameters:
 * - external_id: string - The external identifier
 *
 * Request body:
 * - name: string (optional)
 * - email: string (optional)
 * - timezone: string (optional)
 * - preferences: object (optional)
 */
router.patch(
  '/:external_id',
  validateBody(updateUserSchema),
  async (req: Request, res: Response) => {
    try {
      // Validate parameter
      const { external_id } = userExternalIdSchema.parse(req.params);

      // First find the user by external_id to get internal ID
      const existingUser = await userService.findByExternalId(external_id);

      if (!existingUser) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Update using internal ID
      const updatedUser = await userService.updateUser(existingUser.id, req.body);

      res.json(updatedUser);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.errors.map((err: any) => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        });
      }

      logger.error('Error in PATCH /v1/users/:external_id:', error);
      res.status(500).json({ error: 'Failed to update user' });
    }
  }
);

/**
 * DELETE /v1/users/:external_id
 *
 * Deletes a user and all their associated data
 * Use with caution - this cascades to conversations, messages, facts, etc.
 *
 * Path parameters:
 * - external_id: string - The external identifier
 */
router.delete('/:external_id', async (req: Request, res: Response) => {
  try {
    // Validate parameter
    const { external_id } = userExternalIdSchema.parse(req.params);

    // First find the user by external_id to get internal ID
    const existingUser = await userService.findByExternalId(external_id);

    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Delete using internal ID
    await userService.deleteUser(existingUser.id);

    res.status(204).send();
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors.map((err: any) => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      });
    }

    logger.error('Error in DELETE /v1/users/:external_id:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

/**
 * POST /v1/users/:user_id/push-token
 *
 * Register a push notification token for a user
 *
 * Path parameters:
 * - user_id: string - UUID of the user
 *
 * Request body:
 * - push_token: string - The device push token (APNs or Expo)
 */
router.post('/:user_id/push-token', async (req: Request, res: Response) => {
  try {
    const userIdSchema = z.object({
      user_id: z.string().uuid(),
    });

    const bodySchema = z.object({
      push_token: z.string().min(1),
    });

    const { user_id } = userIdSchema.parse(req.params);
    const { push_token } = bodySchema.parse(req.body);

    await pushService.registerPushToken(user_id, push_token);

    res.json({
      success: true,
      message: 'Push token registered successfully',
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors.map((err: any) => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      });
    }

    logger.error('Error in POST /v1/users/:user_id/push-token:', error);
    res.status(500).json({ error: 'Failed to register push token' });
  }
});

/**
 * DELETE /v1/users/:user_id/push-token
 *
 * Remove push notification token for a user
 *
 * Path parameters:
 * - user_id: string - UUID of the user
 */
router.delete('/:user_id/push-token', async (req: Request, res: Response) => {
  try {
    const userIdSchema = z.object({
      user_id: z.string().uuid(),
    });

    const { user_id } = userIdSchema.parse(req.params);

    await pushService.removePushToken(user_id);

    res.json({
      success: true,
      message: 'Push token removed successfully',
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors.map((err: any) => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      });
    }

    logger.error('Error in DELETE /v1/users/:user_id/push-token:', error);
    res.status(500).json({ error: 'Failed to remove push token' });
  }
});

/**
 * GET /v1/users/:user_id/settings/deep-thinking-bias
 *
 * Get the user's deep thinking bias setting
 *
 * Path parameters:
 * - user_id: string - UUID of the user
 *
 * Response:
 * - deep_thinking_bias: number (0-100)
 *   - 0 = always chatty, quick responses
 *   - 50 = balanced (default)
 *   - 100 = always deep thinking, Library entries
 */
router.get('/:user_id/settings/deep-thinking-bias', async (req: Request, res: Response) => {
  try {
    const userIdSchema = z.object({
      user_id: z.string().uuid(),
    });

    const { user_id } = userIdSchema.parse(req.params);

    const profile = await profileService.getUserProfile(user_id);
    const bias = profile.chat?.deepThinkingBias ?? 50;

    res.json({
      deep_thinking_bias: bias,
      description: bias <= 30
        ? 'Chatty mode: Quick, conversational responses'
        : bias >= 70
          ? 'Deep mode: Thoughtful analysis, more Library entries'
          : 'Balanced: Mix of quick chat and deep thinking',
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors.map((err: any) => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      });
    }

    logger.error('Error in GET /v1/users/:user_id/settings/deep-thinking-bias:', error);
    res.status(500).json({ error: 'Failed to get deep thinking bias' });
  }
});

/**
 * PUT /v1/users/:user_id/settings/deep-thinking-bias
 *
 * Set the user's deep thinking bias
 *
 * Path parameters:
 * - user_id: string - UUID of the user
 *
 * Request body:
 * - deep_thinking_bias: number (0-100)
 *   - 0 = always chatty, quick responses
 *   - 50 = balanced (default)
 *   - 100 = always deep thinking, Library entries
 */
router.put('/:user_id/settings/deep-thinking-bias', async (req: Request, res: Response) => {
  try {
    const userIdSchema = z.object({
      user_id: z.string().uuid(),
    });

    const bodySchema = z.object({
      deep_thinking_bias: z.number().int().min(0).max(100),
    });

    const { user_id } = userIdSchema.parse(req.params);
    const { deep_thinking_bias } = bodySchema.parse(req.body);

    // Update the chat.deepThinkingBias setting
    await profileService.updateUserSettings(user_id, {
      chat: {
        deepThinkingBias: deep_thinking_bias,
      },
    });

    const description = deep_thinking_bias <= 30
      ? 'Chatty mode: Quick, conversational responses'
      : deep_thinking_bias >= 70
        ? 'Deep mode: Thoughtful analysis, more Library entries'
        : 'Balanced: Mix of quick chat and deep thinking';

    logger.info('Deep thinking bias updated', { user_id, deep_thinking_bias });

    res.json({
      success: true,
      deep_thinking_bias,
      description,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors.map((err: any) => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      });
    }

    logger.error('Error in PUT /v1/users/:user_id/settings/deep-thinking-bias:', error);
    res.status(500).json({ error: 'Failed to set deep thinking bias' });
  }
});

export default router;

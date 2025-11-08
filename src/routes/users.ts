import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { logger } from '../logger';
import { UserService } from '../services/user.service';
import {
  createUserSchema,
  updateUserSchema,
  userExternalIdSchema,
} from '../validation/user.validation';
import { z } from 'zod';

const router = Router();
const userService = new UserService(pool);

/**
 * Validation middleware helper
 * Validates request body against a Zod schema
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

    logger.error('Error in DELETE /v1/users/:external_id:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;

/**
 * Authentication Middleware
 *
 * Basic middleware to ensure user_id is provided in requests.
 *
 * TODO: This should be upgraded to use:
 * - JWT token validation
 * - Session management
 * - Integration with studio-api for auth
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../logger';
import { userService } from '../services';

/**
 * Validates that user_id is present and exists in database
 * Can be applied to routes that require authentication
 */
export async function requireUser(req: Request, res: Response, next: NextFunction) {
  try {
    // Check for user_id in body or params
    const userId = req.body.user_id || req.params.user_id;

    if (!userId) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'user_id is required',
      });
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid user_id format',
      });
    }

    // Verify user exists in database
    try {
      const user = await userService.findById(userId);
      if (!user) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'User not found',
        });
      }

      // Attach user to request for downstream handlers
      (req as any).user = user;
      next();
    } catch (error: any) {
      logger.error('Error verifying user:', error);
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to verify user',
      });
    }
  } catch (error: any) {
    logger.error('Error in auth middleware:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Authentication failed',
    });
  }
}

/**
 * Optional: validates user_id if present, but doesn't require it
 */
export async function optionalUser(req: Request, res: Response, next: NextFunction) {
  const userId = req.body.user_id || req.params.user_id;

  if (!userId) {
    return next();
  }

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(userId)) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Invalid user_id format',
    });
  }

  try {
    const user = await userService.findById(userId);
    if (user) {
      (req as any).user = user;
    }
    next();
  } catch (error: any) {
    logger.warn('Error loading optional user:', error);
    next(); // Continue even if user lookup fails
  }
}

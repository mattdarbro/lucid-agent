import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { logger } from '../logger';
import { BackgroundJobsService } from '../services/background-jobs.service';
import { z } from 'zod';

const router = Router();

// Validation schemas
const userIdSchema = z.object({
  user_id: z.string().uuid('Invalid user ID format'),
});

const triggerReflectionSchema = z.object({
  user_id: z.string().uuid('Invalid user ID format'),
  force: z.boolean().optional().default(false),
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
 * POST /v1/sync/facts
 *
 * Manually triggers fact extraction for a specific user.
 * Processes up to 10 recent conversations with 3+ messages.
 *
 * Request body:
 * - user_id: string (required) - UUID of the user
 *
 * Response:
 * - conversations_processed: number
 * - facts_created: number
 * - details: array of { conversation_id, facts_created }
 */
router.post(
  '/facts',
  validateBody(userIdSchema),
  async (req: Request, res: Response) => {
    try {
      const { user_id } = req.body;

      logger.info(`[SYNC] Manual fact extraction triggered for user ${user_id}`);

      const backgroundJobs = new BackgroundJobsService(pool);
      const result = await backgroundJobs.triggerFactExtractionForUser(user_id);

      res.json({
        success: true,
        message: `Extracted ${result.facts_created} facts from ${result.conversations_processed} conversations`,
        ...result,
      });
    } catch (error: any) {
      logger.error('Error in POST /v1/sync/facts:', {
        message: error.message,
      });

      res.status(500).json({
        error: 'Failed to trigger fact extraction',
        details: error.message,
      });
    }
  }
);

/**
 * POST /v1/sync/reflection
 *
 * Manually triggers a morning reflection for a specific user.
 * Generates a thoughtful reflection based on recent conversations and facts.
 *
 * Request body:
 * - user_id: string (required) - UUID of the user
 * - force: boolean (optional) - If true, bypasses the daily limit check (default: false)
 *
 * Response:
 * - The created library entry, or { skipped: true, reason: "..." } if skipped
 */
router.post(
  '/reflection',
  validateBody(triggerReflectionSchema),
  async (req: Request, res: Response) => {
    try {
      const { user_id, force } = req.body;

      logger.info(`[SYNC] Manual reflection triggered for user ${user_id} (force: ${force})`);

      const backgroundJobs = new BackgroundJobsService(pool);
      const result = await backgroundJobs.triggerReflectionForUser(user_id, force);

      if (result?.skipped) {
        return res.json({
          success: false,
          ...result,
        });
      }

      if (!result) {
        return res.json({
          success: false,
          skipped: true,
          reason: 'No reflection generated (user may not have autonomousAgents enabled or no context available)',
        });
      }

      res.json({
        success: true,
        message: 'Morning reflection generated successfully',
        entry: result,
      });
    } catch (error: any) {
      logger.error('Error in POST /v1/sync/reflection:', {
        message: error.message,
      });

      res.status(500).json({
        error: 'Failed to trigger reflection',
        details: error.message,
      });
    }
  }
);

/**
 * POST /v1/sync/all
 *
 * Triggers both fact extraction and morning reflection for a user.
 * Useful for a "sync everything" button in the iOS app.
 *
 * Request body:
 * - user_id: string (required) - UUID of the user
 * - force_reflection: boolean (optional) - If true, forces reflection even if one exists today
 */
router.post(
  '/all',
  validateBody(
    z.object({
      user_id: z.string().uuid('Invalid user ID format'),
      force_reflection: z.boolean().optional().default(false),
    })
  ),
  async (req: Request, res: Response) => {
    try {
      const { user_id, force_reflection } = req.body;

      logger.info(`[SYNC] Full sync triggered for user ${user_id}`);

      const backgroundJobs = new BackgroundJobsService(pool);

      // Run fact extraction first
      const factsResult = await backgroundJobs.triggerFactExtractionForUser(user_id);

      // Then generate reflection
      const reflectionResult = await backgroundJobs.triggerReflectionForUser(user_id, force_reflection);

      res.json({
        success: true,
        facts: {
          conversations_processed: factsResult.conversations_processed,
          facts_created: factsResult.facts_created,
        },
        reflection: reflectionResult?.skipped
          ? { generated: false, reason: reflectionResult.reason }
          : reflectionResult
          ? { generated: true, entry_id: reflectionResult.id }
          : { generated: false, reason: 'No context available or autonomousAgents disabled' },
      });
    } catch (error: any) {
      logger.error('Error in POST /v1/sync/all:', {
        message: error.message,
      });

      res.status(500).json({
        error: 'Failed to trigger sync',
        details: error.message,
      });
    }
  }
);

/**
 * GET /v1/sync/status
 *
 * Returns the current status of background jobs and last sync times for a user.
 *
 * Query parameters:
 * - user_id: string (required) - UUID of the user
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const { user_id } = req.query;

    if (!user_id || typeof user_id !== 'string') {
      return res.status(400).json({ error: 'user_id query parameter is required' });
    }

    // Validate UUID format
    try {
      z.string().uuid().parse(user_id);
    } catch {
      return res.status(400).json({ error: 'Invalid user_id format' });
    }

    // Get user's last activity and sync status
    const userResult = await pool.query(
      `SELECT
        u.id,
        u.last_active_at,
        (SELECT MAX(last_fact_extraction_at) FROM conversations WHERE user_id = u.id) as last_fact_extraction,
        (SELECT MAX(created_at) FROM library_entries WHERE user_id = u.id AND entry_type = 'lucid_thought') as last_reflection,
        (SELECT COUNT(*) FROM facts WHERE user_id = u.id AND is_active = true) as active_facts,
        (SELECT COUNT(*) FROM library_entries WHERE user_id = u.id) as library_entries
      FROM users u
      WHERE u.id = $1`,
      [user_id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    res.json({
      user_id,
      last_active: user.last_active_at,
      sync_status: {
        last_fact_extraction: user.last_fact_extraction,
        last_reflection: user.last_reflection,
      },
      counts: {
        active_facts: parseInt(user.active_facts),
        library_entries: parseInt(user.library_entries),
      },
      schedule: {
        fact_extraction: 'Every 5 minutes (automatic)',
        morning_reflection: '7:00 AM Pacific Time (daily)',
      },
    });
  } catch (error: any) {
    logger.error('Error in GET /v1/sync/status:', {
      message: error.message,
    });

    res.status(500).json({
      error: 'Failed to get sync status',
      details: error.message,
    });
  }
});

export default router;

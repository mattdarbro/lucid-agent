import { Router, Request, Response } from 'express';
import { pool, supabase } from '../db';
import { logger } from '../logger';
import { BackgroundJobsService } from '../services/background-jobs.service';
import { ProfileService } from '../services/profile.service';
import { AgentJobService } from '../services/agent-job.service';
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

/**
 * GET /v1/sync/at-debug
 *
 * Diagnostic endpoint to debug Autonomous Thinking scheduling issues.
 * Shows why AT jobs may not be running for a user.
 *
 * Query parameters:
 * - user_id: string (required) - UUID of the user
 */
router.get('/at-debug', async (req: Request, res: Response) => {
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

    const profileService = new ProfileService(pool);
    const agentJobService = new AgentJobService(pool, supabase);

    // Get user info
    const userResult = await pool.query(
      `SELECT id, name, last_active_at FROM users WHERE id = $1`,
      [user_id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    // Check if user is "recently active" (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const isRecentlyActive = user.last_active_at && new Date(user.last_active_at) > sevenDaysAgo;

    // Get profile info
    const profile = await profileService.getUserProfile(user_id);
    const agentsEnabled = await profileService.areAgentsEnabled(user_id);

    // Get user overrides
    const overrides = await profileService.getUserOverrides(user_id);

    // Get pending jobs for user
    const pendingJobs = await agentJobService.listJobs({
      user_id,
      status: 'pending',
      offset: 0,
      limit: 20,
    });

    // Get recent jobs (all statuses)
    const recentJobs = await agentJobService.listJobs({
      user_id,
      offset: 0,
      limit: 20,
    });

    // Build diagnosis
    const diagnosis: string[] = [];

    if (!isRecentlyActive) {
      diagnosis.push(`❌ User is NOT recently active (last_active_at: ${user.last_active_at || 'null'}). Users inactive for 7+ days don't get jobs scheduled.`);
    } else {
      diagnosis.push(`✅ User is recently active (last_active_at: ${user.last_active_at})`);
    }

    if (!profile.features.autonomousAgents) {
      diagnosis.push(`❌ Profile "${profile.id}" has features.autonomousAgents = false`);
    } else {
      diagnosis.push(`✅ Profile "${profile.id}" has features.autonomousAgents = true`);
    }

    if (!profile.agents?.enabled) {
      diagnosis.push(`❌ Profile "${profile.id}" has agents.enabled = ${profile.agents?.enabled ?? 'undefined'}`);
    } else {
      diagnosis.push(`✅ Profile "${profile.id}" has agents.enabled = true`);
    }

    if (!agentsEnabled) {
      diagnosis.push(`❌ areAgentsEnabled() returns FALSE - AT will NOT run`);
    } else {
      diagnosis.push(`✅ areAgentsEnabled() returns TRUE - AT should run`);
    }

    if (pendingJobs.length === 0) {
      diagnosis.push(`⚠️ No pending jobs in database for this user`);
    } else {
      diagnosis.push(`✅ ${pendingJobs.length} pending jobs found`);
    }

    res.json({
      user: {
        id: user.id,
        name: user.name,
        last_active_at: user.last_active_at,
        is_recently_active: isRecentlyActive,
      },
      profile: {
        id: profile.id,
        name: profile.name,
        features_autonomousAgents: profile.features.autonomousAgents,
        agents_enabled: profile.agents?.enabled,
        agents_config: profile.agents,
      },
      overrides,
      agentsEnabled,
      jobs: {
        pending: pendingJobs.map(j => ({
          id: j.id,
          type: j.job_type,
          status: j.status,
          scheduled_for: j.scheduled_for,
        })),
        recent: recentJobs.map(j => ({
          id: j.id,
          type: j.job_type,
          status: j.status,
          scheduled_for: j.scheduled_for,
          error_message: j.error_message,
        })),
      },
      diagnosis,
    });
  } catch (error: any) {
    logger.error('Error in GET /v1/sync/at-debug:', {
      message: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      error: 'Failed to get AT debug info',
      details: error.message,
    });
  }
});

/**
 * POST /v1/sync/at-schedule
 *
 * Manually trigger job scheduling for a user.
 * Also updates last_active_at to ensure user is considered "active".
 *
 * Request body:
 * - user_id: string (required) - UUID of the user
 */
router.post(
  '/at-schedule',
  validateBody(userIdSchema),
  async (req: Request, res: Response) => {
    try {
      const { user_id } = req.body;

      logger.info(`[SYNC] Manual AT job scheduling triggered for user ${user_id}`);

      const profileService = new ProfileService(pool);
      const agentJobService = new AgentJobService(pool, supabase);

      // First, update last_active_at to NOW so user is considered active
      await pool.query(
        'UPDATE users SET last_active_at = NOW() WHERE id = $1',
        [user_id]
      );
      logger.info(`[SYNC] Updated last_active_at for user ${user_id}`);

      // Check if agents enabled
      const agentsEnabled = await profileService.areAgentsEnabled(user_id);

      if (!agentsEnabled) {
        const profile = await profileService.getUserProfile(user_id);
        return res.json({
          success: false,
          reason: 'Agents not enabled for this user',
          profile_id: profile.id,
          features_autonomousAgents: profile.features.autonomousAgents,
          agents_enabled: profile.agents?.enabled,
        });
      }

      // Schedule jobs for today
      const today = new Date();
      const createdJobs = await agentJobService.scheduleCircadianJobs(user_id, today);

      res.json({
        success: true,
        message: `Scheduled ${createdJobs.length} jobs`,
        last_active_at_updated: true,
        jobs: createdJobs.map(j => ({
          id: j.id,
          type: j.job_type,
          scheduled_for: j.scheduled_for,
        })),
      });
    } catch (error: any) {
      logger.error('Error in POST /v1/sync/at-schedule:', {
        message: error.message,
      });

      res.status(500).json({
        error: 'Failed to schedule AT jobs',
        details: error.message,
      });
    }
  }
);

export default router;

import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { PersonalityService } from '../services/personality.service';
import { logger } from '../logger';
import {
  createPersonalitySnapshotSchema,
  getPersonalityStatisticsSchema,
  listPersonalitySnapshotsSchema,
} from '../validation/personality.validation';

const router = Router();
const personalityService = new PersonalityService(pool);

/**
 * POST /v1/personality/assess
 * Generates a personality assessment for a user
 */
router.post('/assess', async (req: Request, res: Response) => {
  try {
    const input = createPersonalitySnapshotSchema.parse(req.body);

    const snapshot = await personalityService.createPersonalitySnapshot(input);

    logger.info('Personality snapshot created via API', {
      snapshot_id: snapshot.id,
      user_id: input.user_id,
    });

    res.json({
      success: true,
      snapshot,
    });
  } catch (error: any) {
    logger.error('Error creating personality snapshot:', error);

    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.errors,
      });
    }

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /v1/personality/latest/:userId
 * Gets the latest personality snapshot for a user
 */
router.get('/latest/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    const snapshot = await personalityService.getLatestSnapshot(userId);

    if (!snapshot) {
      return res.status(404).json({
        success: false,
        error: 'No personality snapshot found for this user',
      });
    }

    res.json({
      success: true,
      snapshot,
    });
  } catch (error: any) {
    logger.error('Error fetching latest personality snapshot:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /v1/personality/overview/:userId
 * Gets personality overview with deviations from baseline
 */
router.get('/overview/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    // Get latest snapshot
    const snapshot = await personalityService.getLatestSnapshot(userId);
    if (!snapshot) {
      return res.status(404).json({
        success: false,
        error: 'No personality snapshot found',
      });
    }

    // Get baseline statistics
    const stats = await personalityService.getPersonalityStatistics({
      user_id: userId,
      window_days: 90,
    });

    // Get deviations
    const deviations = await personalityService.getPersonalityDeviations(userId);

    res.json({
      success: true,
      overview: {
        current: {
          openness: snapshot.openness,
          conscientiousness: snapshot.conscientiousness,
          extraversion: snapshot.extraversion,
          agreeableness: snapshot.agreeableness,
          neuroticism: snapshot.neuroticism,
          confidence: snapshot.message_count ? Math.min(snapshot.message_count / 50, 1.0) : 0.5, // Derive from message count
          assessed_at: snapshot.created_at,
          reasoning: snapshot.assessment_reasoning,
          message_count: snapshot.message_count,
        },
        baseline: stats ? {
          openness: stats.avg_openness,
          conscientiousness: stats.avg_conscientiousness,
          extraversion: stats.avg_extraversion,
          agreeableness: stats.avg_agreeableness,
          neuroticism: stats.avg_neuroticism,
          sample_size: stats.sample_size,
        } : null,
        deviations: deviations ? {
          openness: `${deviations.openness > 0 ? '+' : ''}${deviations.openness.toFixed(2)}σ`,
          conscientiousness: `${deviations.conscientiousness > 0 ? '+' : ''}${deviations.conscientiousness.toFixed(2)}σ`,
          extraversion: `${deviations.extraversion > 0 ? '+' : ''}${deviations.extraversion.toFixed(2)}σ`,
          agreeableness: `${deviations.agreeableness > 0 ? '+' : ''}${deviations.agreeableness.toFixed(2)}σ`,
          neuroticism: `${deviations.neuroticism > 0 ? '+' : ''}${deviations.neuroticism.toFixed(2)}σ`,
        } : null,
      },
    });
  } catch (error: any) {
    logger.error('Error fetching personality overview:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /v1/personality/statistics/:userId
 * Gets personality statistics (baseline and standard deviations)
 */
router.get('/statistics/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const windowDays = parseInt(req.query.window_days as string) || 90;

    const input = getPersonalityStatisticsSchema.parse({
      user_id: userId,
      window_days: windowDays,
    });

    const stats = await personalityService.getPersonalityStatistics(input);

    if (!stats) {
      return res.status(404).json({
        success: false,
        error: 'No personality statistics found for this user',
      });
    }

    res.json({
      success: true,
      statistics: stats,
    });
  } catch (error: any) {
    logger.error('Error fetching personality statistics:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /v1/personality/snapshots/:userId
 * Lists personality snapshots for a user
 */
router.get('/snapshots/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;

    const input = listPersonalitySnapshotsSchema.parse({
      user_id: userId,
      limit,
      offset,
    });

    const snapshots = await personalityService.listSnapshots(
      input.user_id,
      input.limit,
      input.offset
    );

    res.json({
      success: true,
      snapshots,
      pagination: {
        limit,
        offset,
        count: snapshots.length,
      },
    });
  } catch (error: any) {
    logger.error('Error listing personality snapshots:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;

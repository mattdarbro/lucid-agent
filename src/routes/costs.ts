import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { logger } from '../logger';
import { CostTrackingService, MODEL_PRICING } from '../services/cost-tracking.service';
import { z } from 'zod';

const router = Router();
const costService = new CostTrackingService(pool);

/**
 * GET /v1/costs/user/:userId/summary
 *
 * Get cost summary for a user over a period
 *
 * Query parameters:
 * - period: 'day' | 'week' | 'month' | 'all' (default: 'month')
 */
router.get('/user/:userId/summary', async (req: Request, res: Response) => {
  try {
    const userIdSchema = z.object({
      userId: z.string().uuid('Invalid user ID format'),
    });

    const { userId } = userIdSchema.parse(req.params);
    const period = (req.query.period as string) || 'month';

    if (!['day', 'week', 'month', 'all'].includes(period)) {
      return res.status(400).json({ error: 'Invalid period. Use: day, week, month, or all' });
    }

    const summary = await costService.getCostSummary(userId, {
      period: period as 'day' | 'week' | 'month' | 'all',
    });

    // Add human-readable formatting
    const formatted = {
      ...summary,
      totalCostFormatted: `$${summary.totalCostUsd.toFixed(4)}`,
      breakdown: Object.entries(summary.bySource)
        .sort(([, a], [, b]) => b.costUsd - a.costUsd)
        .map(([source, data]) => ({
          source,
          costUsd: data.costUsd,
          costFormatted: `$${data.costUsd.toFixed(4)}`,
          percentage: summary.totalCostUsd > 0
            ? ((data.costUsd / summary.totalCostUsd) * 100).toFixed(1) + '%'
            : '0%',
          calls: data.count,
          inputTokens: data.inputTokens,
          outputTokens: data.outputTokens,
        })),
    };

    res.json(formatted);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors,
      });
    }
    logger.error('Error in GET /v1/costs/user/:userId/summary:', error);
    res.status(500).json({ error: 'Failed to get cost summary', details: error.message });
  }
});

/**
 * GET /v1/costs/user/:userId/daily
 *
 * Get daily cost breakdown for a user
 *
 * Query parameters:
 * - days: number (default: 30)
 */
router.get('/user/:userId/daily', async (req: Request, res: Response) => {
  try {
    const userIdSchema = z.object({
      userId: z.string().uuid('Invalid user ID format'),
    });

    const { userId } = userIdSchema.parse(req.params);
    const days = parseInt(req.query.days as string) || 30;

    const dailyCosts = await costService.getDailyCosts(userId, days);

    const formatted = dailyCosts.map(day => ({
      date: day.date,
      costUsd: day.costUsd,
      costFormatted: `$${day.costUsd.toFixed(4)}`,
      bySource: Object.entries(day.bySource)
        .sort(([, a], [, b]) => b - a)
        .map(([source, cost]) => ({
          source,
          costUsd: cost,
          costFormatted: `$${cost.toFixed(4)}`,
        })),
    }));

    res.json({
      userId,
      days,
      dailyCosts: formatted,
      totalCostUsd: dailyCosts.reduce((sum, d) => sum + d.costUsd, 0),
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors,
      });
    }
    logger.error('Error in GET /v1/costs/user/:userId/daily:', error);
    res.status(500).json({ error: 'Failed to get daily costs', details: error.message });
  }
});

/**
 * GET /v1/costs/user/:userId/projection
 *
 * Get estimated monthly cost based on recent usage
 */
router.get('/user/:userId/projection', async (req: Request, res: Response) => {
  try {
    const userIdSchema = z.object({
      userId: z.string().uuid('Invalid user ID format'),
    });

    const { userId } = userIdSchema.parse(req.params);

    const projection = await costService.estimateMonthlyProjection(userId);

    res.json({
      userId,
      dailyAverage: projection.dailyAverage,
      dailyAverageFormatted: `$${projection.dailyAverage.toFixed(4)}`,
      monthlyProjection: projection.monthlyProjection,
      monthlyProjectionFormatted: `$${projection.monthlyProjection.toFixed(2)}`,
      breakdown: Object.entries(projection.breakdown)
        .sort(([, a], [, b]) => b - a)
        .map(([source, cost]) => ({
          source,
          costUsd: cost,
          monthlyProjection: (cost / 7) * 30,
          monthlyFormatted: `$${((cost / 7) * 30).toFixed(2)}`,
        })),
      note: 'Based on last 7 days of usage',
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors,
      });
    }
    logger.error('Error in GET /v1/costs/user/:userId/projection:', error);
    res.status(500).json({ error: 'Failed to get projection', details: error.message });
  }
});

/**
 * GET /v1/costs/pricing
 *
 * Get current model pricing information
 */
router.get('/pricing', async (req: Request, res: Response) => {
  const pricing = Object.entries(MODEL_PRICING).map(([model, prices]) => ({
    model,
    inputPer1M: `$${prices.input.toFixed(2)}`,
    outputPer1M: `$${prices.output.toFixed(2)}`,
    inputPer1K: `$${(prices.input / 1000).toFixed(6)}`,
    outputPer1K: `$${(prices.output / 1000).toFixed(6)}`,
  }));

  res.json({
    pricing,
    note: 'Prices per million tokens unless otherwise noted',
    source: 'https://www.anthropic.com/pricing',
  });
});

export default router;

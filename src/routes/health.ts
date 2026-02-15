import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { z } from 'zod';
import { logger } from '../logger';
import { HealthService } from '../services/health.service';
import {
  createHealthMetricSchema,
  batchHealthMetricsSchema,
  queryHealthMetricsSchema,
  dailySummarySchema,
} from '../validation/health.validation';

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
 * Creates the Health router for Apple HealthKit data ingestion and querying.
 *
 * iOS App workflow:
 *   1. App reads HealthKit samples (BP, weight, steps, etc.)
 *   2. App POSTs batch to /v1/health/metrics/sync
 *   3. Lucid's morning/evening health loops query getDailySummary()
 */
export function createHealthRouter(pool: Pool): Router {
  const router = Router();
  const healthService = new HealthService(pool);

  /**
   * POST /v1/health/metrics
   *
   * Store a single health metric from the iOS app.
   */
  router.post(
    '/metrics',
    validateBody(createHealthMetricSchema),
    async (req: Request, res: Response) => {
      try {
        const metric = await healthService.createMetric(req.body);

        logger.info('Health metric stored', {
          userId: req.body.user_id,
          type: req.body.metric_type,
          value: req.body.value,
        });

        res.status(201).json({ metric });
      } catch (error: any) {
        logger.error('Error in POST /v1/health/metrics:', error);
        res.status(500).json({
          error: 'Failed to store health metric',
          details: error.message,
        });
      }
    }
  );

  /**
   * POST /v1/health/metrics/sync
   *
   * Batch sync health metrics from the iOS app.
   * This is the primary endpoint the iOS HealthKit sync uses.
   * Safe to call repeatedly - duplicates are upserted.
   */
  router.post(
    '/metrics/sync',
    validateBody(batchHealthMetricsSchema),
    async (req: Request, res: Response) => {
      try {
        const result = await healthService.batchCreateMetrics(req.body);

        logger.info('Health metrics batch synced', {
          userId: req.body.user_id,
          count: req.body.metrics.length,
          inserted: result.inserted,
          updated: result.updated,
        });

        res.status(200).json({
          success: true,
          ...result,
        });
      } catch (error: any) {
        logger.error('Error in POST /v1/health/metrics/sync:', error);
        res.status(500).json({
          error: 'Failed to sync health metrics',
          details: error.message,
        });
      }
    }
  );

  /**
   * GET /v1/health/metrics/:user_id
   *
   * Query health metrics for a user with optional filters.
   */
  router.get('/metrics/:user_id', async (req: Request, res: Response) => {
    try {
      const { user_id } = req.params;
      const query = queryHealthMetricsSchema.parse(req.query);
      const result = await healthService.getMetrics(user_id, query);

      res.json({
        metrics: result.metrics,
        total: result.total,
        limit: query.limit,
        offset: query.offset,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Invalid query parameters',
          details: error.errors,
        });
      }
      logger.error('Error in GET /v1/health/metrics/:user_id:', error);
      res.status(500).json({
        error: 'Failed to get health metrics',
        details: error.message,
      });
    }
  });

  /**
   * GET /v1/health/metrics/:user_id/latest
   *
   * Get the most recent value for each metric type.
   * Useful for the iOS app dashboard.
   */
  router.get('/metrics/:user_id/latest', async (req: Request, res: Response) => {
    try {
      const { user_id } = req.params;
      const metrics = await healthService.getLatestMetrics(user_id);

      res.json({ metrics });
    } catch (error: any) {
      logger.error('Error in GET /v1/health/metrics/:user_id/latest:', error);
      res.status(500).json({
        error: 'Failed to get latest metrics',
        details: error.message,
      });
    }
  });

  /**
   * GET /v1/health/summary/:user_id
   *
   * Get a daily health summary (or multi-day if ?days=N).
   * This is what Lucid's health check loops call.
   *
   * Query params:
   *   date: YYYY-MM-DD (default: today)
   *   days: number of days to summarize (default: 1, max: 90)
   */
  router.get('/summary/:user_id', async (req: Request, res: Response) => {
    try {
      const { user_id } = req.params;
      const query = dailySummarySchema.parse(req.query);
      const date = query.date || new Date().toISOString().split('T')[0];

      if (query.days === 1) {
        const summary = await healthService.getDailySummary(user_id, date);
        res.json({ summary });
      } else {
        const summaries = await healthService.getMultiDaySummaries(
          user_id,
          query.days,
          date
        );
        res.json({ summaries });
      }
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Invalid query parameters',
          details: error.errors,
        });
      }
      logger.error('Error in GET /v1/health/summary/:user_id:', error);
      res.status(500).json({
        error: 'Failed to get health summary',
        details: error.message,
      });
    }
  });

  return router;
}

export default createHealthRouter;

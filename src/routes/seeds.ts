import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { logger } from '../logger';
import { SeedService } from '../services/seed.service';
import { seedSchema, updateSeedSchema } from '../validation/seed.validation';
import { z } from 'zod';
import { SeedStatus } from '../types/database';

/**
 * Validation middleware helper
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
 * Creates the Seeds router with injected pool
 */
export function createSeedsRouter(pool: Pool): Router {
  const router = Router();
  const seedService = new SeedService(pool);

  /**
   * POST /v1/seeds
   *
   * Plant a new seed - stores content without classification
   *
   * Request body:
   * - user_id: string (required) - UUID of the user
   * - content: string (required) - The seed content
   * - source: 'app' | 'voice' | 'share' (optional) - Source of the seed
   * - source_metadata: object (optional) - Additional metadata
   * - planted_context: string (optional) - Context when planting
   *
   * Response:
   * - seed: Seed object
   * - message: string
   */
  router.post(
    '/',
    validateBody(seedSchema),
    async (req: Request, res: Response) => {
      try {
        const { user_id, content, source, source_metadata, planted_context } = req.body;

        logger.info('Planting seed', {
          userId: user_id,
          contentLength: content.length,
          source,
        });

        const result = await seedService.plant({
          user_id,
          content,
          source,
          source_metadata,
          planted_context,
        });

        res.status(201).json(result);
      } catch (error: any) {
        logger.error('Error in POST /v1/seeds:', error);
        res.status(500).json({
          error: 'Failed to plant seed',
          details: error.message,
        });
      }
    }
  );

  /**
   * GET /v1/seeds/:user_id
   *
   * Get all seeds for a user
   *
   * Query params:
   * - status: Filter by status (held, growing, grown, released)
   * - limit: Max results (default 50)
   * - offset: Pagination offset
   */
  router.get('/:user_id', async (req: Request, res: Response) => {
    try {
      const { user_id } = req.params;
      const { status, limit, offset } = req.query;

      // Parse status filter
      let statusFilter: SeedStatus | SeedStatus[] | undefined;
      if (status) {
        if (typeof status === 'string' && status.includes(',')) {
          statusFilter = status.split(',') as SeedStatus[];
        } else {
          statusFilter = status as SeedStatus;
        }
      }

      const result = await seedService.getSeeds(user_id, {
        status: statusFilter,
        limit: limit ? parseInt(limit as string, 10) : undefined,
        offset: offset ? parseInt(offset as string, 10) : undefined,
      });

      res.json({
        seeds: result.seeds,
        total: result.total,
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
      });
    } catch (error: any) {
      logger.error('Error in GET /v1/seeds/:user_id:', error);
      res.status(500).json({
        error: 'Failed to get seeds',
        details: error.message,
      });
    }
  });

  /**
   * GET /v1/seeds/seed/:id
   *
   * Get a specific seed by ID
   */
  router.get('/seed/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const seed = await seedService.getSeed(id);

      if (!seed) {
        return res.status(404).json({ error: 'Seed not found' });
      }

      res.json(seed);
    } catch (error: any) {
      logger.error('Error in GET /v1/seeds/seed/:id:', error);
      res.status(500).json({
        error: 'Failed to get seed',
        details: error.message,
      });
    }
  });

  /**
   * PATCH /v1/seeds/:id
   *
   * Update a seed (content, context, or status)
   *
   * Request body:
   * - content: string (optional) - Updated content
   * - planted_context: string (optional) - Updated context
   * - status: string (optional) - New status
   */
  router.patch(
    '/:id',
    validateBody(updateSeedSchema),
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const { content, planted_context, status } = req.body;

        const seed = await seedService.update(id, {
          content,
          planted_context,
          status,
        });

        res.json(seed);
      } catch (error: any) {
        if (error.message === 'Seed not found') {
          return res.status(404).json({ error: 'Seed not found' });
        }
        logger.error('Error in PATCH /v1/seeds/:id:', error);
        res.status(500).json({
          error: 'Failed to update seed',
          details: error.message,
        });
      }
    }
  );

  /**
   * DELETE /v1/seeds/:id
   *
   * Soft delete (release) a seed
   */
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const seed = await seedService.release(id);

      res.json({
        released: true,
        seed,
      });
    } catch (error: any) {
      if (error.message === 'Seed not found') {
        return res.status(404).json({ error: 'Seed not found' });
      }
      logger.error('Error in DELETE /v1/seeds/:id:', error);
      res.status(500).json({
        error: 'Failed to release seed',
        details: error.message,
      });
    }
  });

  /**
   * POST /v1/seeds/:id/growing
   *
   * Mark a seed as growing (actively being worked on)
   */
  router.post('/:id/growing', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const seed = await seedService.markGrowing(id);

      res.json(seed);
    } catch (error: any) {
      if (error.message === 'Seed not found') {
        return res.status(404).json({ error: 'Seed not found' });
      }
      logger.error('Error in POST /v1/seeds/:id/growing:', error);
      res.status(500).json({
        error: 'Failed to mark seed as growing',
        details: error.message,
      });
    }
  });

  /**
   * POST /v1/seeds/:id/grown
   *
   * Mark a seed as grown (developed into library entry)
   *
   * Request body:
   * - library_entry_id: string (required) - ID of the library entry it grew into
   */
  router.post('/:id/grown', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { library_entry_id } = req.body;

      if (!library_entry_id) {
        return res.status(400).json({ error: 'library_entry_id is required' });
      }

      const seed = await seedService.markGrown(id, library_entry_id);

      res.json(seed);
    } catch (error: any) {
      if (error.message === 'Seed not found') {
        return res.status(404).json({ error: 'Seed not found' });
      }
      logger.error('Error in POST /v1/seeds/:id/grown:', error);
      res.status(500).json({
        error: 'Failed to mark seed as grown',
        details: error.message,
      });
    }
  });

  /**
   * POST /v1/seeds/:id/surface
   *
   * Record that a seed was surfaced (shown to user)
   */
  router.post('/:id/surface', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const seed = await seedService.recordSurfacing(id);

      res.json(seed);
    } catch (error: any) {
      if (error.message === 'Seed not found') {
        return res.status(404).json({ error: 'Seed not found' });
      }
      logger.error('Error in POST /v1/seeds/:id/surface:', error);
      res.status(500).json({
        error: 'Failed to record surfacing',
        details: error.message,
      });
    }
  });

  /**
   * GET /v1/seeds/:user_id/for-surfacing
   *
   * Get seeds that should be surfaced (not recently shown)
   */
  router.get('/:user_id/for-surfacing', async (req: Request, res: Response) => {
    try {
      const { user_id } = req.params;
      const { limit } = req.query;

      const seeds = await seedService.getSeedsForSurfacing(
        user_id,
        limit ? parseInt(limit as string, 10) : undefined
      );

      res.json({
        seeds,
        count: seeds.length,
      });
    } catch (error: any) {
      logger.error('Error in GET /v1/seeds/:user_id/for-surfacing:', error);
      res.status(500).json({
        error: 'Failed to get seeds for surfacing',
        details: error.message,
      });
    }
  });

  return router;
}

export default createSeedsRouter;

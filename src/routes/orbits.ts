import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { logger } from '../logger';
import { OrbitsService } from '../services/orbits.service';
import {
  userIdParamSchema,
  upsertOrbitSchema,
  changeTierSchema,
  orbitsListQuerySchema,
  personNameParamSchema,
} from '../validation/orbits.validation';
import { z } from 'zod';

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
 * Creates the Orbits router with injected pool
 */
export function createOrbitsRouter(pool: Pool): Router {
  const router = Router();
  const orbitsService = new OrbitsService(pool);

  /**
   * GET /v1/orbits/:user_id
   *
   * Gets all active orbits for a user
   *
   * Path parameters:
   * - user_id: string - UUID of the user
   *
   * Query parameters:
   * - tier: string (optional) - Filter by tier (inner/mid/outer)
   * - limit: number (optional) - Maximum orbits to return
   * - recently_mentioned_days: number (optional) - Filter by recent mentions
   */
  router.get('/:user_id', async (req: Request, res: Response) => {
    try {
      const { user_id } = userIdParamSchema.parse(req.params);
      const query = orbitsListQuerySchema.parse(req.query);

      let orbits;
      if (query.recently_mentioned_days) {
        orbits = await orbitsService.getRecentlyMentioned(
          user_id,
          query.recently_mentioned_days,
          query.limit
        );
      } else if (query.tier) {
        orbits = await orbitsService.getActiveOrbits(user_id, query.tier);
        if (query.limit) {
          orbits = orbits.slice(0, query.limit);
        }
      } else {
        orbits = await orbitsService.getActiveOrbits(user_id);
        if (query.limit) {
          orbits = orbits.slice(0, query.limit);
        }
      }

      res.json({
        orbits,
        count: orbits.length,
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

      logger.error('Error in GET /v1/orbits/:user_id:', error);
      res.status(500).json({ error: 'Failed to fetch orbits' });
    }
  });

  /**
   * GET /v1/orbits/:user_id/by-tier
   *
   * Gets orbits organized by tier
   *
   * Path parameters:
   * - user_id: string - UUID of the user
   */
  router.get('/:user_id/by-tier', async (req: Request, res: Response) => {
    try {
      const { user_id } = userIdParamSchema.parse(req.params);

      const orbits = await orbitsService.getOrbitsByTier(user_id);
      const counts = await orbitsService.getOrbitCounts(user_id);

      res.json({
        ...orbits,
        counts,
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

      logger.error('Error in GET /v1/orbits/:user_id/by-tier:', error);
      res.status(500).json({ error: 'Failed to fetch orbits by tier' });
    }
  });

  /**
   * GET /v1/orbits/:user_id/person/:person_name
   *
   * Gets a specific orbit by person name
   *
   * Path parameters:
   * - user_id: string - UUID of the user
   * - person_name: string - Name of the person
   */
  router.get('/:user_id/person/:person_name', async (req: Request, res: Response) => {
    try {
      const { user_id } = userIdParamSchema.parse(req.params);
      const { person_name } = personNameParamSchema.parse(req.params);

      const orbit = await orbitsService.getOrbitByName(user_id, person_name);

      if (!orbit) {
        return res.status(404).json({ error: 'Person not found in orbits' });
      }

      res.json(orbit);
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

      logger.error('Error in GET /v1/orbits/:user_id/person/:person_name:', error);
      res.status(500).json({ error: 'Failed to fetch orbit person' });
    }
  });

  /**
   * POST /v1/orbits/:user_id
   *
   * Creates or updates an orbit person
   *
   * Path parameters:
   * - user_id: string - UUID of the user
   *
   * Request body:
   * - person_name: string (required) - Name of the person
   * - relationship: string (optional) - Relationship type
   * - current_situation: object (optional) - Their current situation
   * - how_this_affects_user: string (optional) - Impact on user's life
   * - orbit_tier: string (optional) - Tier (inner/mid/outer)
   */
  router.post(
    '/:user_id',
    validateBody(upsertOrbitSchema),
    async (req: Request, res: Response) => {
      try {
        const { user_id } = userIdParamSchema.parse(req.params);

        const orbit = await orbitsService.upsertOrbitPerson(user_id, req.body);

        res.status(201).json(orbit);
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

        logger.error('Error in POST /v1/orbits/:user_id:', error);
        res.status(500).json({ error: 'Failed to create/update orbit' });
      }
    }
  );

  /**
   * PUT /v1/orbits/:user_id
   *
   * Updates an orbit person (same as POST, for RESTful consistency)
   */
  router.put(
    '/:user_id',
    validateBody(upsertOrbitSchema),
    async (req: Request, res: Response) => {
      try {
        const { user_id } = userIdParamSchema.parse(req.params);

        const orbit = await orbitsService.upsertOrbitPerson(user_id, req.body);

        res.json(orbit);
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

        logger.error('Error in PUT /v1/orbits/:user_id:', error);
        res.status(500).json({ error: 'Failed to update orbit' });
      }
    }
  );

  /**
   * PATCH /v1/orbits/:user_id/change-tier
   *
   * Changes the tier of an orbit person
   *
   * Path parameters:
   * - user_id: string - UUID of the user
   *
   * Request body:
   * - person_name: string (required) - Name of the person
   * - new_tier: string (required) - New tier (inner/mid/outer)
   */
  router.patch(
    '/:user_id/change-tier',
    validateBody(changeTierSchema),
    async (req: Request, res: Response) => {
      try {
        const { user_id } = userIdParamSchema.parse(req.params);
        const { person_name, new_tier } = req.body;

        const orbit = await orbitsService.changeOrbitTier(user_id, person_name, new_tier);

        if (!orbit) {
          return res.status(404).json({ error: 'Person not found in orbits' });
        }

        res.json(orbit);
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

        logger.error('Error in PATCH /v1/orbits/:user_id/change-tier:', error);
        res.status(500).json({ error: 'Failed to change orbit tier' });
      }
    }
  );

  /**
   * DELETE /v1/orbits/:user_id/person/:person_name
   *
   * Deactivates an orbit person (soft delete)
   *
   * Path parameters:
   * - user_id: string - UUID of the user
   * - person_name: string - Name of the person
   */
  router.delete('/:user_id/person/:person_name', async (req: Request, res: Response) => {
    try {
      const { user_id } = userIdParamSchema.parse(req.params);
      const { person_name } = personNameParamSchema.parse(req.params);

      await orbitsService.deactivateOrbitPerson(user_id, person_name);

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

      logger.error('Error in DELETE /v1/orbits/:user_id/person/:person_name:', error);
      res.status(500).json({ error: 'Failed to deactivate orbit person' });
    }
  });

  /**
   * GET /v1/orbits/:user_id/counts
   *
   * Gets orbit counts by tier
   *
   * Path parameters:
   * - user_id: string - UUID of the user
   */
  router.get('/:user_id/counts', async (req: Request, res: Response) => {
    try {
      const { user_id } = userIdParamSchema.parse(req.params);

      const counts = await orbitsService.getOrbitCounts(user_id);

      res.json(counts);
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

      logger.error('Error in GET /v1/orbits/:user_id/counts:', error);
      res.status(500).json({ error: 'Failed to fetch orbit counts' });
    }
  });

  return router;
}

export default createOrbitsRouter;

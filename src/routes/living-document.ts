import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { logger } from '../logger';
import { LivingDocumentService } from '../services/living-document.service';
import { z } from 'zod';

/**
 * Validation schemas
 */
const userIdParamSchema = z.object({
  user_id: z.string().uuid('Invalid user ID format'),
});

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).default(10),
});

const rollbackSchema = z.object({
  version: z.number().int().positive('Version must be a positive integer'),
});

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
 * Creates the Living Document router with injected pool
 *
 * Note: The living document is primarily READ-ONLY for users.
 * Updates happen via Document Reflection AT sessions.
 * Only history/rollback endpoints allow user intervention.
 */
export function createLivingDocumentRouter(pool: Pool): Router {
  const router = Router();
  const livingDocumentService = new LivingDocumentService(pool);

  /**
   * GET /v1/living-document/:user_id
   *
   * Gets the living document for a user (read-only)
   * This is Lucid's working memory - what he's thinking about
   */
  router.get('/:user_id', async (req: Request, res: Response) => {
    try {
      const { user_id } = userIdParamSchema.parse(req.params);

      const document = await livingDocumentService.getOrCreateDocument(user_id);

      return res.json({ document });
    } catch (error: any) {
      logger.error('Error getting living document', { error: error.message });

      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.errors,
        });
      }

      return res.status(500).json({ error: 'Failed to get living document' });
    }
  });

  /**
   * GET /v1/living-document/:user_id/history
   *
   * Gets version history for the living document
   *
   * Query:
   * - limit: number (optional, default 10, max 50)
   */
  router.get('/:user_id/history', async (req: Request, res: Response) => {
    try {
      const { user_id } = userIdParamSchema.parse(req.params);
      const { limit } = historyQuerySchema.parse(req.query);

      const history = await livingDocumentService.getDocumentHistory(user_id, limit);

      return res.json({ history });
    } catch (error: any) {
      logger.error('Error getting document history', { error: error.message });

      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.errors,
        });
      }

      return res.status(500).json({ error: 'Failed to get document history' });
    }
  });

  /**
   * POST /v1/living-document/:user_id/rollback
   *
   * Rollback the document to a specific version
   * This is the only way users can modify the document
   *
   * Body:
   * - version: number - The version to rollback to
   */
  router.post(
    '/:user_id/rollback',
    validateBody(rollbackSchema),
    async (req: Request, res: Response) => {
      try {
        const { user_id } = userIdParamSchema.parse(req.params);
        const { version } = req.body;

        const document = await livingDocumentService.rollbackToVersion(user_id, version);

        logger.info('Living document rolled back', { user_id, version });

        return res.json({
          document,
          message: `Rolled back to version ${version}`,
        });
      } catch (error: any) {
        logger.error('Error rolling back document', { error: error.message });

        if (error.message.includes('not found')) {
          return res.status(404).json({ error: error.message });
        }

        if (error instanceof z.ZodError) {
          return res.status(400).json({
            error: 'Validation failed',
            details: error.errors,
          });
        }

        return res.status(500).json({ error: 'Failed to rollback document' });
      }
    }
  );

  /**
   * GET /v1/living-document/:user_id/sections/:section
   *
   * Gets items from a specific section of the document
   * Useful for targeted queries
   */
  router.get('/:user_id/sections/:section', async (req: Request, res: Response) => {
    try {
      const { user_id } = userIdParamSchema.parse(req.params);
      const section = req.params.section;

      // Map URL-friendly names to document section names
      const sectionMap: Record<string, any> = {
        'questions': "Questions I'm Holding",
        'inconsistencies': "Inconsistencies I've Noticed",
        'threads': 'Active Threads',
        'patterns': "Patterns I'm Seeing",
        'ideas': 'Ideas & Possibilities',
        'learned': "What I've Learned Recently",
        'to-ask': 'Questions to Ask',
      };

      const sectionName = sectionMap[section];
      if (!sectionName) {
        return res.status(400).json({
          error: 'Invalid section',
          valid_sections: Object.keys(sectionMap),
        });
      }

      const items = await livingDocumentService.getSectionItems(user_id, sectionName);

      return res.json({
        section: sectionName,
        items,
      });
    } catch (error: any) {
      logger.error('Error getting section items', { error: error.message });
      return res.status(500).json({ error: 'Failed to get section items' });
    }
  });

  return router;
}

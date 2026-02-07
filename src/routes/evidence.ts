import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { logger } from '../logger';
import { EvidenceService } from '../services/evidence.service';
import {
  createEvidenceSchema,
  updateEvidenceSchema,
  evidenceIdSchema,
  factIdParamSchema,
  evidenceListQuerySchema,
  CreateEvidenceInput,
} from '../validation/evidence.validation';
import { z } from 'zod';

const router = Router();
const evidenceService = new EvidenceService(pool);

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
 * POST /v1/evidence
 * Create new evidence for a fact
 */
router.post('/', validateBody(createEvidenceSchema), async (req: Request, res: Response) => {
  try {
    const input: CreateEvidenceInput = req.body;
    const evidence = await evidenceService.createEvidence(input);

    logger.info(`Evidence created: ${evidence.id} for fact ${input.fact_id}`);

    res.status(201).json(evidence);
  } catch (error: any) {
    logger.error('Error creating evidence:', error);

    if (error.message.includes('not found')) {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to create evidence' });
    }
  }
});

/**
 * POST /v1/evidence/batch
 * Create multiple evidence items in a batch
 */
router.post(
  '/batch',
  validateBody(createEvidenceSchema.array().min(1).max(100)),
  async (req: Request, res: Response) => {
    try {
      const evidenceList: CreateEvidenceInput[] = req.body;
      const created = await evidenceService.createEvidenceBatch(evidenceList);

      logger.info(
        `Batch created ${created.length} of ${evidenceList.length} evidence items`
      );

      res.status(201).json({
        created,
        count: created.length,
        total: evidenceList.length,
        message: `Created ${created.length} of ${evidenceList.length} evidence items`,
      });
    } catch (error: any) {
      logger.error('Error creating evidence batch:', error);
      res.status(500).json({ error: 'Failed to create evidence batch' });
    }
  }
);

/**
 * GET /v1/evidence/:id
 * Get evidence by ID
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = evidenceIdSchema.parse(req.params);
    const evidence = await evidenceService.findById(id);

    if (!evidence) {
      return res.status(404).json({ error: 'Evidence not found' });
    }

    res.json(evidence);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors,
      });
    }
    logger.error('Error fetching evidence:', error);
    res.status(500).json({ error: 'Failed to fetch evidence' });
  }
});

/**
 * GET /v1/facts/:fact_id/evidence
 * List all evidence for a specific fact
 */
router.get('/facts/:fact_id', async (req: Request, res: Response) => {
  try {
    const { fact_id } = factIdParamSchema.parse(req.params);
    const options = evidenceListQuerySchema.parse(req.query);

    const evidence = await evidenceService.listByFact(fact_id, options);

    res.json({
      evidence,
      count: evidence.length,
      fact_id,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors,
      });
    }
    logger.error('Error listing evidence:', error);
    res.status(500).json({ error: 'Failed to list evidence' });
  }
});

/**
 * PATCH /v1/evidence/:id
 * Update evidence
 */
router.patch('/:id', validateBody(updateEvidenceSchema), async (req: Request, res: Response) => {
  try {
    const { id } = evidenceIdSchema.parse(req.params);
    const updates = req.body;

    const evidence = await evidenceService.updateEvidence(id, updates);

    if (!evidence) {
      return res.status(404).json({ error: 'Evidence not found' });
    }

    logger.info(`Evidence updated: ${id}`);
    res.json(evidence);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors,
      });
    }
    logger.error('Error updating evidence:', error);
    res.status(500).json({ error: 'Failed to update evidence' });
  }
});

/**
 * DELETE /v1/evidence/:id
 * Delete evidence
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = evidenceIdSchema.parse(req.params);
    const deleted = await evidenceService.deleteEvidence(id);

    if (!deleted) {
      return res.status(404).json({ error: 'Evidence not found' });
    }

    logger.info(`Evidence deleted: ${id}`);
    res.status(204).send();
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors,
      });
    }
    logger.error('Error deleting evidence:', error);
    res.status(500).json({ error: 'Failed to delete evidence' });
  }
});

/**
 * GET /v1/facts/:fact_id/evidence/stats
 * Get evidence statistics for a fact
 */
router.get('/facts/:fact_id/stats', async (req: Request, res: Response) => {
  try {
    const { fact_id } = factIdParamSchema.parse(req.params);

    const count = await evidenceService.getCountByFact(fact_id);
    const avgStrength = await evidenceService.getAverageStrength(fact_id);

    res.json({
      fact_id,
      evidence_count: count,
      average_strength: avgStrength,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors,
      });
    }
    logger.error('Error fetching evidence stats:', error);
    res.status(500).json({ error: 'Failed to fetch evidence stats' });
  }
});

export default router;

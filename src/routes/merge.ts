import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { logger } from '../logger';
import { MergeService } from '../services/merge.service';
import { z } from 'zod';

const router = Router();
const mergeService = new MergeService(pool);

/**
 * Validation schemas
 */
const mergeSchema = z.object({
  sourceUserId: z.string().uuid('Invalid source user ID format'),
  createMergeNarrative: z.boolean().optional().default(true),
  sourceDisplayName: z.string().optional(),
});

/**
 * GET /v1/merge/export/:userId
 *
 * Export all meaningful data for a user.
 * Returns facts, autonomous thoughts, library entries, and summaries.
 *
 * Path parameters:
 * - userId: string - UUID of the user to export
 *
 * Response:
 * - Complete UserExport object with all user data
 */
router.get('/export/:userId', async (req: Request, res: Response) => {
  try {
    const userIdSchema = z.object({
      userId: z.string().uuid('Invalid user ID format'),
    });

    const { userId } = userIdSchema.parse(req.params);

    logger.info('Export requested', { userId });

    const exportData = await mergeService.exportUserData(userId);

    res.json({
      success: true,
      export: exportData,
    });
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

    logger.error('Error in GET /v1/merge/export/:userId:', error);
    res.status(500).json({
      error: 'Failed to export user data',
      details: error.message,
    });
  }
});

/**
 * POST /v1/merge/into/:targetUserId
 *
 * Merge another user's data into this user.
 * Imports facts (with deduplication), autonomous thoughts, library entries,
 * and optionally creates a merge narrative.
 *
 * Path parameters:
 * - targetUserId: string - UUID of the user to merge INTO (the "keeper")
 *
 * Request body:
 * - sourceUserId: string (required) - UUID of the user to merge FROM
 * - createMergeNarrative: boolean (optional, default: true) - Create a library entry about the merge
 * - sourceDisplayName: string (optional) - Friendly name for the source (e.g., "iPad Lucid")
 *
 * Response:
 * - MergeResult with counts of imported/skipped items
 */
router.post('/into/:targetUserId', async (req: Request, res: Response) => {
  try {
    const targetIdSchema = z.object({
      targetUserId: z.string().uuid('Invalid target user ID format'),
    });

    const { targetUserId } = targetIdSchema.parse(req.params);
    const { sourceUserId, createMergeNarrative, sourceDisplayName } = mergeSchema.parse(req.body);

    // Prevent merging user into itself
    if (targetUserId === sourceUserId) {
      return res.status(400).json({
        error: 'Cannot merge user into itself',
      });
    }

    logger.info('Merge requested', { targetUserId, sourceUserId });

    const result = await mergeService.mergeUsers(targetUserId, sourceUserId, {
      createMergeNarrative,
      sourceDisplayName,
    });

    res.json({
      success: true,
      result,
      message: `Successfully merged ${result.imported.facts} facts, ${result.imported.thoughts} thoughts, ${result.imported.libraryEntries} library entries, and ${result.imported.summaries} summaries. ${result.skipped.facts} duplicate facts were skipped.`,
    });
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

    logger.error('Error in POST /v1/merge/into/:targetUserId:', error);
    res.status(500).json({
      error: 'Failed to merge users',
      details: error.message,
    });
  }
});

/**
 * GET /v1/merge/preview/:targetUserId
 *
 * Preview what a merge would look like without actually doing it.
 * Useful for showing the user what will be imported.
 *
 * Path parameters:
 * - targetUserId: string - UUID of the user to merge INTO
 *
 * Query parameters:
 * - sourceUserId: string (required) - UUID of the user to merge FROM
 */
router.get('/preview/:targetUserId', async (req: Request, res: Response) => {
  try {
    const targetIdSchema = z.object({
      targetUserId: z.string().uuid('Invalid target user ID format'),
    });
    const sourceIdSchema = z.object({
      sourceUserId: z.string().uuid('Invalid source user ID format'),
    });

    const { targetUserId } = targetIdSchema.parse(req.params);
    const { sourceUserId } = sourceIdSchema.parse({ sourceUserId: req.query.sourceUserId });

    if (targetUserId === sourceUserId) {
      return res.status(400).json({
        error: 'Cannot merge user into itself',
      });
    }

    // Export source to see what would be imported
    const sourceExport = await mergeService.exportUserData(sourceUserId);

    // Check for duplicate facts
    const duplicateCheckResult = await pool.query(
      `SELECT LOWER(content) as content FROM facts WHERE user_id = $1`,
      [targetUserId]
    );
    const existingFacts = new Set(duplicateCheckResult.rows.map((r: any) => r.content.toLowerCase()));

    const uniqueFacts = sourceExport.facts.filter(
      f => !existingFacts.has(f.content.toLowerCase())
    );
    const duplicateFacts = sourceExport.facts.filter(
      f => existingFacts.has(f.content.toLowerCase())
    );

    res.json({
      success: true,
      preview: {
        sourceUserId,
        sourceUserName: sourceExport.sourceUserName,
        targetUserId,
        wouldImport: {
          facts: uniqueFacts.length,
          thoughts: sourceExport.autonomousThoughts.length,
          libraryEntries: sourceExport.libraryEntries.length,
          summaries: sourceExport.summaries.length,
        },
        wouldSkip: {
          duplicateFacts: duplicateFacts.length,
        },
        sampleContent: {
          // Show a few examples of what would be imported
          facts: uniqueFacts.slice(0, 5).map(f => ({
            content: f.content,
            category: f.category,
          })),
          thoughts: sourceExport.autonomousThoughts.slice(0, 3).map(t => ({
            content: t.content.substring(0, 200) + (t.content.length > 200 ? '...' : ''),
            category: t.category,
            createdAt: t.createdAt,
          })),
        },
      },
    });
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

    logger.error('Error in GET /v1/merge/preview/:targetUserId:', error);
    res.status(500).json({
      error: 'Failed to preview merge',
      details: error.message,
    });
  }
});

export default router;

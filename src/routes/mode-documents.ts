import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { logger } from '../logger';
import { ModeDocumentService } from '../services/mode-document.service';
import { ChatMode } from '../services/chat-mode.service';
import {
  userIdParamSchema,
  userModeParamsSchema,
  updateDocumentSchema,
  appendToSectionSchema,
  rollbackSchema,
  historyQuerySchema,
  documentModeSchema,
} from '../validation/mode-document.validation';
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
 * Creates the Mode Documents router with injected pool
 */
export function createModeDocumentsRouter(pool: Pool): Router {
  const router = Router();
  const modeDocumentService = new ModeDocumentService(pool);

  /**
   * GET /v1/mode-documents/:user_id
   *
   * Gets all mode documents for a user
   *
   * Returns documents for: me, lucid, others, possibilities, state
   * (Chat mode has no document - it's ephemeral)
   */
  router.get('/:user_id', async (req: Request, res: Response) => {
    try {
      const { user_id } = userIdParamSchema.parse(req.params);

      const documents = await modeDocumentService.getAllDocuments(user_id);

      // If no documents exist yet, create them with defaults
      if (documents.length === 0) {
        const modes: Array<Exclude<ChatMode, 'chat'>> = ['me', 'lucid', 'others', 'possibilities', 'state'];
        const createdDocs = await Promise.all(
          modes.map(mode => modeDocumentService.getOrCreateDocument(user_id, mode))
        );
        return res.json({
          documents: createdDocs,
          message: 'Created default documents for all modes',
        });
      }

      return res.json({ documents });
    } catch (error: any) {
      logger.error('Error getting mode documents', { error: error.message });

      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.errors,
        });
      }

      return res.status(500).json({ error: 'Failed to get mode documents' });
    }
  });

  /**
   * GET /v1/mode-documents/:user_id/:mode
   *
   * Gets a specific mode document
   */
  router.get('/:user_id/:mode', async (req: Request, res: Response) => {
    try {
      const { user_id, mode } = userModeParamsSchema.parse(req.params);

      const document = await modeDocumentService.getOrCreateDocument(user_id, mode);

      return res.json({ document });
    } catch (error: any) {
      logger.error('Error getting mode document', { error: error.message });

      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.errors,
        });
      }

      return res.status(500).json({ error: 'Failed to get mode document' });
    }
  });

  /**
   * PUT /v1/mode-documents/:user_id/:mode
   *
   * Updates a mode document (full replacement)
   *
   * Body:
   * - content: string - The new document content
   * - updated_by: 'user' | 'lucid' | 'agent' - Who is making the update
   */
  router.put(
    '/:user_id/:mode',
    validateBody(updateDocumentSchema),
    async (req: Request, res: Response) => {
      try {
        const { user_id, mode } = userModeParamsSchema.parse(req.params);
        const { content, updated_by } = req.body;

        const document = await modeDocumentService.updateDocument(
          user_id,
          mode,
          content,
          updated_by
        );

        logger.info('Mode document updated', { user_id, mode, updated_by });

        return res.json({
          document,
          message: 'Document updated successfully',
        });
      } catch (error: any) {
        logger.error('Error updating mode document', { error: error.message });

        if (error instanceof z.ZodError) {
          return res.status(400).json({
            error: 'Validation failed',
            details: error.errors,
          });
        }

        return res.status(500).json({ error: 'Failed to update mode document' });
      }
    }
  );

  /**
   * POST /v1/mode-documents/:user_id/:mode/append
   *
   * Appends content to a specific section of the document
   * Useful for Lucid to add notes during conversation
   *
   * Body:
   * - section: string - The section header to append to (e.g., "Recent Insights")
   * - content: string - The content to append
   * - updated_by: 'lucid' | 'agent' - Who is making the update
   */
  router.post(
    '/:user_id/:mode/append',
    validateBody(appendToSectionSchema),
    async (req: Request, res: Response) => {
      try {
        const { user_id, mode } = userModeParamsSchema.parse(req.params);
        const { section, content, updated_by } = req.body;

        const document = await modeDocumentService.appendToSection(
          user_id,
          mode,
          section,
          content,
          updated_by
        );

        logger.info('Appended to mode document section', { user_id, mode, section });

        return res.json({
          document,
          message: `Appended to section: ${section}`,
        });
      } catch (error: any) {
        logger.error('Error appending to mode document', { error: error.message });

        if (error instanceof z.ZodError) {
          return res.status(400).json({
            error: 'Validation failed',
            details: error.errors,
          });
        }

        return res.status(500).json({ error: 'Failed to append to mode document' });
      }
    }
  );

  /**
   * GET /v1/mode-documents/:user_id/:mode/history
   *
   * Gets version history for a mode document
   *
   * Query:
   * - limit: number (optional, default 10, max 50)
   */
  router.get('/:user_id/:mode/history', async (req: Request, res: Response) => {
    try {
      const { user_id, mode } = userModeParamsSchema.parse(req.params);
      const { limit } = historyQuerySchema.parse(req.query);

      const history = await modeDocumentService.getDocumentHistory(user_id, mode, limit);

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
   * POST /v1/mode-documents/:user_id/:mode/rollback
   *
   * Rollback a document to a specific version
   *
   * Body:
   * - version: number - The version to rollback to
   */
  router.post(
    '/:user_id/:mode/rollback',
    validateBody(rollbackSchema),
    async (req: Request, res: Response) => {
      try {
        const { user_id, mode } = userModeParamsSchema.parse(req.params);
        const { version } = req.body;

        const document = await modeDocumentService.rollbackToVersion(user_id, mode, version);

        logger.info('Mode document rolled back', { user_id, mode, version });

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
   * GET /v1/mode-documents/modes
   *
   * Gets list of available modes with their descriptions
   * Useful for iOS to display mode options
   */
  router.get('/modes', async (_req: Request, res: Response) => {
    return res.json({
      modes: [
        {
          mode: 'me',
          name: 'Me',
          description: "Your life context, challenges, and growth",
          hasDocument: true,
        },
        {
          mode: 'lucid',
          name: 'Lucid',
          description: "Lucid's self-awareness and evolution",
          hasDocument: true,
        },
        {
          mode: 'others',
          name: 'Others',
          description: 'People in your orbit and relationships',
          hasDocument: true,
        },
        {
          mode: 'possibilities',
          name: 'Possibilities',
          description: 'Paths being explored and alternatives',
          hasDocument: true,
        },
        {
          mode: 'state',
          name: 'State',
          description: 'Goals, visions, and decisions',
          hasDocument: true,
        },
        {
          mode: 'chat',
          name: 'Chat',
          description: 'Light, ephemeral conversation',
          hasDocument: false,
        },
      ],
    });
  });

  return router;
}

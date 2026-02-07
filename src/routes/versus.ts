import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { logger } from '../logger';
import { z } from 'zod';
import { VersusService } from '../services/versus.service';

const router = Router();
const versusService = new VersusService(pool);

/**
 * Validation schemas
 */
const startSessionSchema = z.object({
  user_id: z.string().uuid(),
  topic: z.string().min(1, 'Topic is required'),
  lu_position: z.string().min(1, 'Lu position is required'),
  cid_position: z.string().min(1, 'Cid position is required'),
});

const continueSessionSchema = z.object({
  message: z.string().optional(),
  addressed_to: z.enum(['lu', 'cid']).optional(),
});

/**
 * POST /v1/versus/start
 *
 * Start a new debate session
 *
 * Request body:
 * - user_id: string (required)
 * - topic: string (required) - What are we debating?
 * - lu_position: string (required) - Lu's argument position
 * - cid_position: string (required) - Cid's counter-position
 */
router.post('/start', async (req: Request, res: Response) => {
  try {
    const body = startSessionSchema.parse(req.body);

    const { session, openingMessage } = await versusService.startSession(
      body.user_id,
      body.topic,
      body.lu_position,
      body.cid_position
    );

    res.status(201).json({
      session,
      messages: [openingMessage],
      nextSpeaker: 'cid', // Cid responds next
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

    logger.error('Error in POST /v1/versus/start:', error);
    res.status(500).json({
      error: 'Failed to start debate session',
      details: error.message,
    });
  }
});

/**
 * POST /v1/versus/:id/continue
 *
 * Continue a debate session
 *
 * Path parameters:
 * - id: UUID of the session
 *
 * Request body:
 * - message: string (optional) - User's message (pass/skip if not provided)
 * - addressed_to: 'lu' | 'cid' (optional) - Who to address (@Lu or @Cid)
 */
router.post('/:id/continue', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = continueSessionSchema.parse(req.body);

    const { userMessage, aiMessage } = await versusService.continueSession(
      id,
      body.message || null,
      body.addressed_to || null
    );

    // Determine next speaker
    const nextSpeaker = aiMessage.speaker === 'lu' ? 'cid' : 'lu';

    res.status(200).json({
      userMessage,
      aiMessage,
      nextSpeaker,
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

    if (error.message === 'Session not found') {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (error.message === 'Session is not active') {
      return res.status(400).json({ error: 'Session is not active' });
    }

    logger.error('Error in POST /v1/versus/:id/continue:', error);
    res.status(500).json({
      error: 'Failed to continue debate',
      details: error.message,
    });
  }
});

/**
 * POST /v1/versus/:id/end
 *
 * End a debate session and generate synthesis
 *
 * Path parameters:
 * - id: UUID of the session
 */
router.post('/:id/end', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const libraryEntry = await versusService.endSession(id);

    res.status(200).json({
      message: 'Debate ended and synthesis saved to Library',
      libraryEntry,
    });
  } catch (error: any) {
    if (error.message === 'Session not found') {
      return res.status(404).json({ error: 'Session not found' });
    }

    logger.error('Error in POST /v1/versus/:id/end:', error);
    res.status(500).json({
      error: 'Failed to end debate',
      details: error.message,
    });
  }
});

/**
 * DELETE /v1/versus/:id
 *
 * Abandon a debate session (no synthesis generated)
 *
 * Path parameters:
 * - id: UUID of the session
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await versusService.abandonSession(id);

    res.status(204).send();
  } catch (error: any) {
    logger.error('Error in DELETE /v1/versus/:id:', error);
    res.status(500).json({
      error: 'Failed to abandon session',
      details: error.message,
    });
  }
});

/**
 * GET /v1/versus/:id
 *
 * Get a session with all messages
 *
 * Path parameters:
 * - id: UUID of the session
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const session = await versusService.getSession(id);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const messages = await versusService.getMessages(id);

    // Determine next speaker if session is active
    let nextSpeaker: string | null = null;
    if (session.status === 'active' && messages.length > 0) {
      const lastAiMessage = [...messages].reverse().find((m) => m.speaker !== 'user');
      nextSpeaker = lastAiMessage?.speaker === 'lu' ? 'cid' : 'lu';
    }

    res.status(200).json({
      session,
      messages,
      nextSpeaker,
    });
  } catch (error: any) {
    logger.error('Error in GET /v1/versus/:id:', error);
    res.status(500).json({
      error: 'Failed to fetch session',
      details: error.message,
    });
  }
});

/**
 * GET /v1/versus
 *
 * Get all sessions for a user
 *
 * Query parameters:
 * - user_id: string (required)
 * - limit: number (optional, default: 20)
 * - include_abandoned: boolean (optional, default: false)
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { user_id, limit = '20', include_abandoned = 'false' } = req.query;

    if (!user_id || typeof user_id !== 'string') {
      return res.status(400).json({ error: 'user_id is required' });
    }

    const sessions = await versusService.getUserSessions(
      user_id,
      parseInt(limit as string, 10),
      include_abandoned === 'true'
    );

    res.status(200).json({
      sessions,
      count: sessions.length,
    });
  } catch (error: any) {
    logger.error('Error in GET /v1/versus:', error);
    res.status(500).json({
      error: 'Failed to fetch sessions',
      details: error.message,
    });
  }
});

export default router;

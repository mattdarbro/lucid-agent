import { Router, Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import { z } from 'zod';
import { StateCheckService } from '../services/state-check.service';
import { logger } from '../logger';

/**
 * Validation schemas
 */
const startSessionSchema = z.object({
  user_id: z.string().uuid('Invalid user ID format'),
});

const sendMessageSchema = z.object({
  user_id: z.string().uuid('Invalid user ID format'),
  message: z.string().min(1, 'Message is required'),
});

const userIdQuerySchema = z.object({
  user_id: z.string().uuid('Invalid user ID format'),
});

export function createStateCheckRouter(pool: Pool): Router {
  const router = Router();
  const stateCheckService = new StateCheckService(pool);

  /**
   * Start a new State Check session
   * POST /v1/state-check/start
   *
   * Body: { user_id: string }
   * Returns Lucid's opening message and session info
   */
  router.post('/start', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = startSessionSchema.parse(req.body);
      const { session, message } = await stateCheckService.startSession(body.user_id);

      logger.info('[STATE CHECK API] Session started', {
        userId: body.user_id,
        sessionId: session.id,
        isExisting: session.updated_at > session.created_at,
      });

      res.json({
        session_id: session.id,
        phase: session.phase,
        message,
        session_doc: session.session_doc,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.errors,
        });
      }
      next(error);
    }
  });

  /**
   * Send a message in the State Check session
   * POST /v1/state-check/:sessionId/message
   *
   * Body: { user_id: string, message: string }
   * Returns Lucid's response and updated session state
   */
  router.post('/:sessionId/message', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = sendMessageSchema.parse(req.body);
      const { sessionId } = req.params;

      // Verify session belongs to user
      const session = await stateCheckService.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }
      if (session.user_id !== body.user_id) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const response = await stateCheckService.processMessage(sessionId, body.message);

      logger.info('[STATE CHECK API] Message processed', {
        sessionId,
        phase: response.phase,
        isComplete: response.is_complete,
      });

      res.json({
        message: response.message,
        phase: response.phase,
        session_doc: response.session_doc,
        is_complete: response.is_complete,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.errors,
        });
      }
      next(error);
    }
  });

  /**
   * Get current session state
   * GET /v1/state-check/:sessionId?user_id=...
   */
  router.get('/:sessionId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = userIdQuerySchema.parse(req.query);
      const { sessionId } = req.params;

      const session = await stateCheckService.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }
      if (session.user_id !== query.user_id) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      res.json({
        session_id: session.id,
        phase: session.phase,
        status: session.status,
        session_doc: session.session_doc,
        created_at: session.created_at,
        updated_at: session.updated_at,
        completed_at: session.completed_at,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.errors,
        });
      }
      next(error);
    }
  });

  /**
   * Get active session for user
   * GET /v1/state-check/user/:userId/active
   */
  router.get('/user/:userId/active', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = req.params;

      // Validate userId
      z.string().uuid().parse(userId);

      const session = await stateCheckService.getActiveSession(userId);

      if (!session) {
        return res.json({ active: false, session: null });
      }

      res.json({
        active: true,
        session: {
          session_id: session.id,
          phase: session.phase,
          session_doc: session.session_doc,
          created_at: session.created_at,
          updated_at: session.updated_at,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.errors,
        });
      }
      next(error);
    }
  });

  /**
   * Get session history for user
   * GET /v1/state-check/user/:userId/history
   */
  router.get('/user/:userId/history', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = req.params;

      // Validate userId
      z.string().uuid().parse(userId);

      const limit = parseInt(req.query.limit as string) || 10;
      const sessions = await stateCheckService.getSessionHistory(userId, limit);

      res.json({
        sessions: sessions.map((s) => ({
          session_id: s.id,
          phase: s.phase,
          status: s.status,
          dream: s.session_doc.dream_stated,
          chosen_direction: s.session_doc.chosen_direction,
          created_at: s.created_at,
          completed_at: s.completed_at,
        })),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.errors,
        });
      }
      next(error);
    }
  });

  /**
   * Abandon a session
   * POST /v1/state-check/:sessionId/abandon
   *
   * Body: { user_id: string }
   */
  router.post('/:sessionId/abandon', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = z.object({ user_id: z.string().uuid() }).parse(req.body);
      const { sessionId } = req.params;

      const session = await stateCheckService.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }
      if (session.user_id !== body.user_id) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      await stateCheckService.abandonSession(sessionId);

      res.json({ success: true });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.errors,
        });
      }
      next(error);
    }
  });

  return router;
}

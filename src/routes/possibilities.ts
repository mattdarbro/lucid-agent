import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '../logger';
import { pool } from '../db';
import { PossibilityThinkingService } from '../services/possibility-thinking.service';
import { VectorService } from '../services/vector.service';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
const possibilityService = new PossibilityThinkingService(pool);
const vectorService = new VectorService();

/**
 * In-memory session store for possibilities sessions
 * In production, this could be Redis or database-backed
 */
interface PossibilitySession {
  id: string;
  userId: string;
  focus: string;
  focusReframed?: string;
  possibilities: {
    sigma1: Array<{ id: string; text: string; category: string; reasoning?: string }>;
    sigma2: Array<{ id: string; text: string; category: string; reasoning?: string }>;
    sigma3: Array<{ id: string; text: string; category: string; reasoning?: string }>;
  };
  createdAt: Date;
}

const sessions = new Map<string, PossibilitySession>();

// Clean up old sessions periodically (older than 1 hour)
setInterval(() => {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  for (const [id, session] of sessions) {
    if (session.createdAt < oneHourAgo) {
      sessions.delete(id);
      logger.debug('Cleaned up stale possibilities session', { sessionId: id });
    }
  }
}, 10 * 60 * 1000); // Run every 10 minutes

/**
 * POST /v1/possibilities/start
 *
 * Start a new possibilities exploration session
 *
 * Request body:
 * - user_id: string (required) - UUID of the user
 * - focus: string (required) - What the user is focused on / considering
 *
 * Response:
 * {
 *   sessionId: "uuid",
 *   focus: "Opening a pizza shop",
 *   possibilities: { sigma1: [], sigma2: [], sigma3: [] }
 * }
 */
router.post('/start', async (req: Request, res: Response) => {
  try {
    const { user_id, focus } = req.body;

    if (!user_id || typeof user_id !== 'string') {
      return res.status(400).json({ error: 'user_id is required' });
    }

    if (!focus || typeof focus !== 'string') {
      return res.status(400).json({ error: 'focus is required' });
    }

    const sessionId = uuidv4();

    const session: PossibilitySession = {
      id: sessionId,
      userId: user_id,
      focus,
      possibilities: {
        sigma1: [],
        sigma2: [],
        sigma3: [],
      },
      createdAt: new Date(),
    };

    sessions.set(sessionId, session);

    logger.info('Possibilities session started', {
      sessionId,
      user_id,
      focus: focus.slice(0, 50),
    });

    res.status(200).json({
      sessionId,
      focus,
      possibilities: session.possibilities,
    });
  } catch (error: any) {
    logger.error('Error in POST /v1/possibilities/start:', {
      message: error.message,
      user_id: req.body.user_id,
    });

    res.status(500).json({
      error: 'Failed to start possibilities session',
      details: error.message,
    });
  }
});

/**
 * POST /v1/possibilities/:sessionId/generate
 *
 * Generate possibilities at a specific sigma level
 *
 * Request body:
 * - user_id: string (required)
 * - sigma: number (required) - 1, 2, or 3
 * - count: number (optional) - how many to generate (default: 3)
 *
 * Response:
 * {
 *   sigma: 1,
 *   possibilities: [{ id, text, category, reasoning }],
 *   focusReframed: "..." // included if this is first generation
 * }
 */
router.post('/:sessionId/generate', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { user_id, sigma, count = 3 } = req.body;

    if (!user_id || typeof user_id !== 'string') {
      return res.status(400).json({ error: 'user_id is required' });
    }

    if (![1, 2, 3].includes(sigma)) {
      return res.status(400).json({ error: 'sigma must be 1, 2, or 3' });
    }

    const session = sessions.get(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (session.userId !== user_id) {
      return res.status(403).json({ error: 'Session belongs to different user' });
    }

    logger.info('Generating possibilities for sigma level', {
      sessionId,
      user_id,
      sigma,
      count,
    });

    const result = await possibilityService.generateSigmaPossibilities(
      user_id,
      session.focus,
      {
        sigma: sigma as 1 | 2 | 3,
        count: Math.min(count, 5),
      }
    );

    // Get the possibilities for this sigma level
    const sigmaKey = `sigma${sigma}` as 'sigma1' | 'sigma2' | 'sigma3';
    const newPossibilities = result.possibilities[sigmaKey];

    // Append to session (don't replace, in case of "+ More")
    session.possibilities[sigmaKey] = [
      ...session.possibilities[sigmaKey],
      ...newPossibilities,
    ];

    // Store reframed focus if provided
    if (result.focusReframed && !session.focusReframed) {
      session.focusReframed = result.focusReframed;
    }

    logger.info('Possibilities generated', {
      sessionId,
      sigma,
      count: newPossibilities.length,
    });

    res.status(200).json({
      sigma,
      possibilities: newPossibilities,
      focusReframed: result.focusReframed,
    });
  } catch (error: any) {
    logger.error('Error in POST /v1/possibilities/:sessionId/generate:', {
      message: error.message,
      sessionId: req.params.sessionId,
      user_id: req.body.user_id,
    });

    res.status(500).json({
      error: 'Failed to generate possibilities',
      details: error.message,
    });
  }
});

/**
 * POST /v1/possibilities/:sessionId/save
 *
 * Save the possibilities session to the library
 *
 * Request body:
 * - user_id: string (required)
 *
 * Response:
 * {
 *   libraryEntryId: "uuid",
 *   saved: true
 * }
 */
router.post('/:sessionId/save', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { user_id } = req.body;

    if (!user_id || typeof user_id !== 'string') {
      return res.status(400).json({ error: 'user_id is required' });
    }

    const session = sessions.get(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (session.userId !== user_id) {
      return res.status(403).json({ error: 'Session belongs to different user' });
    }

    // Count total possibilities
    const totalCount =
      session.possibilities.sigma1.length +
      session.possibilities.sigma2.length +
      session.possibilities.sigma3.length;

    if (totalCount === 0) {
      return res.status(400).json({ error: 'No possibilities to save' });
    }

    // Format content for library
    const formatPossibilities = (items: any[], label: string) => {
      if (items.length === 0) return '';
      return `### ${label}\n${items.map(p => `- **${p.category}**: ${p.text}`).join('\n')}\n`;
    };

    const content = `## Focus\n${session.focus}\n\n` +
      (session.focusReframed ? `## What This Might Really Be About\n${session.focusReframed}\n\n` : '') +
      `## Possibilities\n\n` +
      formatPossibilities(session.possibilities.sigma1, '1σ Adjacent (might reach naturally)') +
      formatPossibilities(session.possibilities.sigma2, '2σ Stretch (would probably miss)') +
      formatPossibilities(session.possibilities.sigma3, '3σ Edge (rarely considered)');

    const title = `Possibilities: ${session.focus.slice(0, 50)}${session.focus.length > 50 ? '...' : ''}`;

    // Generate embedding
    let embedding: number[] | null = null;
    try {
      embedding = await vectorService.generateEmbedding(`${title} ${content}`);
    } catch (err) {
      logger.warn('Failed to generate embedding for possibilities', { error: err });
    }

    const embeddingString = embedding ? `[${embedding.join(',')}]` : null;

    // Save to library
    const result = await pool.query(
      `INSERT INTO library_entries
       (user_id, entry_type, title, content, metadata, embedding)
       VALUES ($1, 'possibilities', $2, $3, $4, $5::vector)
       RETURNING id`,
      [
        user_id,
        title,
        content,
        JSON.stringify({
          sessionId,
          focus: session.focus,
          focusReframed: session.focusReframed,
          sigma1Count: session.possibilities.sigma1.length,
          sigma2Count: session.possibilities.sigma2.length,
          sigma3Count: session.possibilities.sigma3.length,
          totalCount,
          savedAt: new Date().toISOString(),
        }),
        embeddingString,
      ]
    );

    const libraryEntryId = result.rows[0].id;

    // Clean up session
    sessions.delete(sessionId);

    logger.info('Possibilities saved to library', {
      sessionId,
      user_id,
      libraryEntryId,
      totalCount,
    });

    res.status(200).json({
      libraryEntryId,
      saved: true,
    });
  } catch (error: any) {
    logger.error('Error in POST /v1/possibilities/:sessionId/save:', {
      message: error.message,
      sessionId: req.params.sessionId,
      user_id: req.body.user_id,
    });

    res.status(500).json({
      error: 'Failed to save possibilities',
      details: error.message,
    });
  }
});

/**
 * GET /v1/possibilities/:sessionId
 *
 * Get current state of a possibilities session
 */
router.get('/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { user_id } = req.query;

    const session = sessions.get(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (user_id && session.userId !== user_id) {
      return res.status(403).json({ error: 'Session belongs to different user' });
    }

    res.status(200).json({
      sessionId: session.id,
      focus: session.focus,
      focusReframed: session.focusReframed,
      possibilities: session.possibilities,
    });
  } catch (error: any) {
    logger.error('Error in GET /v1/possibilities/:sessionId:', {
      message: error.message,
      sessionId: req.params.sessionId,
    });

    res.status(500).json({
      error: 'Failed to get session',
      details: error.message,
    });
  }
});

export default router;

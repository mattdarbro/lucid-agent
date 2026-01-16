import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { logger } from '../logger';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';

const router = Router();

// Initialize Anthropic client for embeddings
const anthropic = new Anthropic({
  apiKey: config.anthropic.apiKey,
});

// Validation schemas
const createWinSchema = z.object({
  user_id: z.string().uuid(),
  title: z.string().min(1).max(255),
  content: z.string().min(1),
  metadata: z.record(z.any()).optional(),
});

const listWinsSchema = z.object({
  user_id: z.string().uuid(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

/**
 * Generate embedding for text using voyage-3-lite
 */
async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20241022',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'embed' }],
    });

    // Use voyage for actual embeddings
    const voyageResponse = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'voyage-3-lite',
        input: text,
      }),
    });

    if (!voyageResponse.ok) {
      logger.warn('Voyage embedding failed, skipping embedding');
      return null;
    }

    const data = (await voyageResponse.json()) as { data: { embedding: number[] }[] };
    return data.data[0].embedding;
  } catch (error) {
    logger.warn('Failed to generate embedding:', error);
    return null;
  }
}

/**
 * GET /v1/wins
 *
 * Gets all wins for a user
 *
 * Query parameters:
 * - user_id: string (required) - UUID of the user
 * - limit: number (optional) - Max entries to return (default: 50)
 * - offset: number (optional) - Pagination offset (default: 0)
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { user_id, limit = '50', offset = '0' } = req.query;

    if (!user_id || typeof user_id !== 'string') {
      return res.status(400).json({ error: 'user_id is required' });
    }

    const params = listWinsSchema.parse({
      user_id,
      limit: parseInt(limit as string, 10),
      offset: parseInt(offset as string, 10),
    });

    const result = await pool.query(
      `SELECT id, user_id, entry_type, title, content, metadata, created_at, updated_at
       FROM library_entries
       WHERE user_id = $1 AND entry_type = 'win'
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [params.user_id, params.limit, params.offset]
    );

    // Get total count
    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM library_entries
       WHERE user_id = $1 AND entry_type = 'win'`,
      [params.user_id]
    );

    res.json({
      wins: result.rows,
      pagination: {
        limit: params.limit,
        offset: params.offset,
        total: parseInt(countResult.rows[0].total, 10),
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors,
      });
    }

    logger.error('Error fetching wins:', error);
    res.status(500).json({ error: 'Failed to fetch wins' });
  }
});

/**
 * GET /v1/wins/:id
 *
 * Gets a specific win by ID
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT id, user_id, entry_type, title, content, metadata, created_at, updated_at
       FROM library_entries
       WHERE id = $1 AND entry_type = 'win'`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Win not found' });
    }

    res.json({ win: result.rows[0] });
  } catch (error: any) {
    logger.error('Error fetching win:', error);
    res.status(500).json({ error: 'Failed to fetch win' });
  }
});

/**
 * POST /v1/wins
 *
 * Creates a new win entry
 *
 * Request body:
 * - user_id: string (required) - UUID of the user
 * - title: string (required) - Title of the win
 * - content: string (required) - Description of the accomplishment
 * - metadata: object (optional) - Additional metadata
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = createWinSchema.parse(req.body);

    // Generate embedding for the win content
    const textToEmbed = `${body.title}\n${body.content}`;
    const embedding = await generateEmbedding(textToEmbed);
    const embeddingString = embedding ? `[${embedding.join(',')}]` : null;

    const result = await pool.query(
      `INSERT INTO library_entries
       (user_id, entry_type, title, content, metadata, embedding)
       VALUES ($1, 'win', $2, $3, $4, $5::vector)
       RETURNING id, user_id, entry_type, title, content, metadata, created_at, updated_at`,
      [
        body.user_id,
        body.title,
        body.content,
        JSON.stringify(body.metadata || {}),
        embeddingString,
      ]
    );

    logger.info('Win created', {
      id: result.rows[0].id,
      user_id: body.user_id,
    });

    res.status(201).json({ win: result.rows[0] });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors,
      });
    }

    logger.error('Error creating win:', error);
    res.status(500).json({ error: 'Failed to create win' });
  }
});

/**
 * PUT /v1/wins/:id
 *
 * Updates a win entry
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, content, metadata } = req.body;

    // Check if win exists
    const existing = await pool.query(
      `SELECT id FROM library_entries WHERE id = $1 AND entry_type = 'win'`,
      [id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Win not found' });
    }

    // Generate new embedding if content changed
    let embeddingUpdate = '';
    const params: any[] = [id];
    let paramIndex = 2;

    const updates: string[] = [];

    if (title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      params.push(title);
    }

    if (content !== undefined) {
      updates.push(`content = $${paramIndex++}`);
      params.push(content);

      // Regenerate embedding
      const textToEmbed = `${title || ''}\n${content}`;
      const embedding = await generateEmbedding(textToEmbed);
      if (embedding) {
        updates.push(`embedding = $${paramIndex++}::vector`);
        params.push(`[${embedding.join(',')}]`);
      }
    }

    if (metadata !== undefined) {
      updates.push(`metadata = $${paramIndex++}`);
      params.push(JSON.stringify(metadata));
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push('updated_at = NOW()');

    const result = await pool.query(
      `UPDATE library_entries
       SET ${updates.join(', ')}
       WHERE id = $1 AND entry_type = 'win'
       RETURNING id, user_id, entry_type, title, content, metadata, created_at, updated_at`,
      params
    );

    logger.info('Win updated', { id });

    res.json({ win: result.rows[0] });
  } catch (error: any) {
    logger.error('Error updating win:', error);
    res.status(500).json({ error: 'Failed to update win' });
  }
});

/**
 * DELETE /v1/wins/:id
 *
 * Deletes a win entry
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM library_entries WHERE id = $1 AND entry_type = 'win' RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Win not found' });
    }

    logger.info('Win deleted', { id });

    res.status(204).send();
  } catch (error: any) {
    logger.error('Error deleting win:', error);
    res.status(500).json({ error: 'Failed to delete win' });
  }
});

export default router;

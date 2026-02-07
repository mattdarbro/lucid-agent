import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { logger } from '../logger';
import { z } from 'zod';
import { VectorService } from '../services/vector.service';

const router = Router();
const vectorService = new VectorService();

/**
 * Validation schemas
 */
const createEntrySchema = z.object({
  user_id: z.string().uuid(),
  title: z.string().optional(),
  content: z.string().min(1, 'Content is required'),
  time_of_day: z.enum(['morning', 'afternoon', 'evening', 'night']).optional(),
});

const updateEntrySchema = z.object({
  title: z.string().optional(),
  content: z.string().min(1).optional(),
});

/**
 * Helper to get current time of day
 */
function getCurrentTimeOfDay(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

/**
 * GET /v1/library
 *
 * List library entries for a user
 *
 * Query parameters:
 * - user_id: string (required) - UUID of the user
 * - time_of_day: string (optional) - Filter by time of day
 * - entry_type: string (optional) - Filter by entry type
 * - limit: number (optional) - Max entries to return (default: 50)
 * - offset: number (optional) - Pagination offset (default: 0)
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { user_id, time_of_day, entry_type, limit = '50', offset = '0' } = req.query;

    if (!user_id || typeof user_id !== 'string') {
      return res.status(400).json({ error: 'user_id is required' });
    }

    let query = `
      SELECT id, user_id, entry_type, title, content, time_of_day,
             related_conversation_id, metadata, created_at, updated_at
      FROM library_entries
      WHERE user_id = $1
    `;
    const params: any[] = [user_id];

    if (time_of_day && typeof time_of_day === 'string') {
      query += ` AND time_of_day = $${params.length + 1}`;
      params.push(time_of_day);
    }

    if (entry_type && typeof entry_type === 'string') {
      query += ` AND entry_type = $${params.length + 1}`;
      params.push(entry_type);
    }

    query += ` ORDER BY created_at DESC`;
    query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit as string, 10), parseInt(offset as string, 10));

    const result = await pool.query(query, params);

    res.status(200).json({
      entries: result.rows,
      count: result.rows.length,
      limit: parseInt(limit as string, 10),
      offset: parseInt(offset as string, 10),
    });
  } catch (error: any) {
    logger.error('Error in GET /v1/library:', error);
    res.status(500).json({
      error: 'Failed to fetch library entries',
      details: error.message,
    });
  }
});

/**
 * GET /v1/library/:id
 *
 * Get a specific library entry
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { user_id } = req.query;

    if (!user_id || typeof user_id !== 'string') {
      return res.status(400).json({ error: 'user_id query parameter is required' });
    }

    const result = await pool.query(
      `SELECT * FROM library_entries WHERE id = $1 AND user_id = $2`,
      [id, user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    res.status(200).json({ entry: result.rows[0] });
  } catch (error: any) {
    logger.error('Error in GET /v1/library/:id:', error);
    res.status(500).json({
      error: 'Failed to fetch entry',
      details: error.message,
    });
  }
});

/**
 * POST /v1/library
 *
 * Create a new user reflection (users can only create user_reflection entries)
 *
 * Request body:
 * - user_id: string (required)
 * - content: string (required)
 * - title: string (optional)
 * - time_of_day: string (optional) - defaults to current time of day
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = createEntrySchema.parse(req.body);

    const timeOfDay = body.time_of_day || getCurrentTimeOfDay();

    // Generate embedding for semantic search
    let embedding: number[] | null = null;
    try {
      const textForEmbedding = `${body.title || ''} ${body.content}`.trim();
      embedding = await vectorService.generateEmbedding(textForEmbedding);
    } catch (embeddingError) {
      // Log but don't fail - embedding is optional
      logger.warn('Failed to generate embedding for library entry', { error: embeddingError });
    }

    const embeddingString = embedding ? `[${embedding.join(',')}]` : null;

    const result = await pool.query(
      `INSERT INTO library_entries
       (user_id, entry_type, title, content, time_of_day, embedding)
       VALUES ($1, 'user_reflection', $2, $3, $4, $5::vector)
       RETURNING id, user_id, entry_type, title, content, time_of_day,
                 related_conversation_id, metadata, created_at, updated_at`,
      [body.user_id, body.title || null, body.content, timeOfDay, embeddingString]
    );

    logger.info('Library entry created', {
      id: result.rows[0].id,
      user_id: body.user_id,
      entry_type: 'user_reflection',
      has_embedding: !!embedding,
    });

    res.status(201).json({ entry: result.rows[0] });
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

    logger.error('Error in POST /v1/library:', error);
    res.status(500).json({
      error: 'Failed to create entry',
      details: error.message,
    });
  }
});

/**
 * PATCH /v1/library/:id
 *
 * Update a library entry (users can only update their own entries)
 */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { user_id } = req.query;

    if (!user_id || typeof user_id !== 'string') {
      return res.status(400).json({ error: 'user_id query parameter is required' });
    }

    const body = updateEntrySchema.parse(req.body);

    if (!body.title && !body.content) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Build update query
    const setClauses: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (body.title !== undefined) {
      setClauses.push(`title = $${paramIndex++}`);
      params.push(body.title);
    }

    if (body.content !== undefined) {
      setClauses.push(`content = $${paramIndex++}`);
      params.push(body.content);
    }

    setClauses.push(`updated_at = NOW()`);
    params.push(id, user_id);

    const result = await pool.query(
      `UPDATE library_entries
       SET ${setClauses.join(', ')}
       WHERE id = $${paramIndex++} AND user_id = $${paramIndex}
       RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    logger.info('Library entry updated', { id, user_id });

    res.status(200).json({ entry: result.rows[0] });
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

    logger.error('Error in PATCH /v1/library/:id:', error);
    res.status(500).json({
      error: 'Failed to update entry',
      details: error.message,
    });
  }
});

/**
 * DELETE /v1/library/:id
 *
 * Delete a library entry
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { user_id } = req.query;

    if (!user_id || typeof user_id !== 'string') {
      return res.status(400).json({ error: 'user_id query parameter is required' });
    }

    const result = await pool.query(
      `DELETE FROM library_entries WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    logger.info('Library entry deleted', { id, user_id });

    res.status(204).send();
  } catch (error: any) {
    logger.error('Error in DELETE /v1/library/:id:', error);
    res.status(500).json({
      error: 'Failed to delete entry',
      details: error.message,
    });
  }
});

/**
 * GET /v1/library/search
 *
 * Semantic search across library entries
 *
 * Query parameters:
 * - user_id: string (required) - UUID of the user
 * - query: string (required) - Search query text
 * - limit: number (optional) - Max entries to return (default: 10)
 * - min_similarity: number (optional) - Minimum similarity threshold 0-1 (default: 0.8)
 * - entry_type: string (optional) - Filter by entry type
 */
router.get('/search', async (req: Request, res: Response) => {
  try {
    const { user_id, query, limit = '10', min_similarity = '0.8', entry_type } = req.query;

    if (!user_id || typeof user_id !== 'string') {
      return res.status(400).json({ error: 'user_id is required' });
    }

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'query is required' });
    }

    // Parse and validate min_similarity
    const similarityThreshold = Math.min(1, Math.max(0, parseFloat(min_similarity as string) || 0.8));

    // Generate embedding for the search query
    const queryEmbedding = await vectorService.generateEmbedding(query);

    // Format embedding for PostgreSQL vector type
    const embeddingString = `[${queryEmbedding.join(',')}]`;

    // Build the search query with similarity threshold filter
    let searchQuery = `
      SELECT
        id, user_id, entry_type, title, content, time_of_day,
        related_conversation_id, metadata, created_at, updated_at,
        1 - (embedding <=> $1::vector) as similarity
      FROM library_entries
      WHERE user_id = $2
        AND embedding IS NOT NULL
        AND (1 - (embedding <=> $1::vector)) >= $3
    `;
    const params: any[] = [embeddingString, user_id, similarityThreshold];

    if (entry_type && typeof entry_type === 'string') {
      searchQuery += ` AND entry_type = $${params.length + 1}`;
      params.push(entry_type);
    }

    searchQuery += ` ORDER BY embedding <=> $1::vector`;
    searchQuery += ` LIMIT $${params.length + 1}`;
    params.push(parseInt(limit as string, 10));

    const result = await pool.query(searchQuery, params);

    logger.info('Library semantic search', {
      user_id,
      query: query.slice(0, 50),
      min_similarity: similarityThreshold,
      results: result.rows.length,
    });

    res.status(200).json({
      entries: result.rows,
      query,
      count: result.rows.length,
    });
  } catch (error: any) {
    logger.error('Error in GET /v1/library/search:', error);
    res.status(500).json({
      error: 'Failed to search library',
      details: error.message,
    });
  }
});

// Note: /trigger-reflection endpoint removed in system refactor
// Morning reflections (circadian system) have been removed

export default router;

import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { logger } from '../logger';

const router = Router();

// ============================================================================
// POST /v1/people - Create or find a person
// ============================================================================
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      user_id,
      name,
      nickname,
      relationship_type,
      relationship_detail,
      context,
      email,
      phone,
      sentiment = 'neutral',
      importance_score = 0.5
    } = req.body;

    // Validation
    if (!user_id || !name) {
      return res.status(400).json({ error: 'user_id and name are required' });
    }

    // Check if person with similar name already exists for this user
    const existingCheck = await pool.query(
      `SELECT * FROM people
       WHERE user_id = $1 AND (LOWER(name) = LOWER($2) OR LOWER(nickname) = LOWER($2))`,
      [user_id, name]
    );

    if (existingCheck.rows.length > 0) {
      // Return existing person
      return res.json({
        person: existingCheck.rows[0],
        already_existed: true
      });
    }

    // Create new person
    const result = await pool.query(
      `INSERT INTO people (
        user_id, name, nickname, relationship_type, relationship_detail,
        context, email, phone, sentiment, importance_score
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        user_id,
        name,
        nickname || null,
        relationship_type || null,
        relationship_detail || null,
        context || null,
        email || null,
        phone || null,
        sentiment,
        importance_score
      ]
    );

    const person = result.rows[0];
    logger.info(`Person created: ${person.id} (${person.name}) for user ${user_id}`);

    res.status(201).json({
      person,
      already_existed: false
    });
  } catch (error: any) {
    logger.error('Error creating person:', error);
    res.status(500).json({ error: 'Failed to create person' });
  }
});

// ============================================================================
// GET /v1/people/search/:user_id - Search for people by name
// IMPORTANT: This must come before /:id to avoid route conflict
// ============================================================================
router.get('/search/:user_id', async (req: Request, res: Response) => {
  try {
    const { user_id } = req.params;
    const { q } = req.query;

    if (!q) {
      return res.status(400).json({ error: 'q (search query) is required' });
    }

    const searchPattern = `%${q}%`;

    const result = await pool.query(
      `SELECT * FROM people
       WHERE user_id = $1
         AND (name ILIKE $2 OR nickname ILIKE $2 OR relationship_detail ILIKE $2)
       ORDER BY
         CASE WHEN LOWER(name) = LOWER($3) THEN 0 ELSE 1 END,
         importance_score DESC
       LIMIT 20`,
      [user_id, searchPattern, q]
    );

    res.json({
      query: q,
      people: result.rows,
      count: result.rows.length
    });
  } catch (error: any) {
    logger.error('Error searching people:', error);
    res.status(500).json({ error: 'Failed to search people' });
  }
});

// ============================================================================
// GET /v1/people/:user_id - Get all people for a user
// ============================================================================
router.get('/user/:user_id', async (req: Request, res: Response) => {
  try {
    const { user_id } = req.params;
    const { relationship_type, sort_by = 'importance' } = req.query;

    let query = `
      SELECT p.*,
             COUNT(DISTINCT c.id) FILTER (WHERE NOT c.is_completed) AS open_captures_count,
             COUNT(DISTINCT ce.id) FILTER (WHERE ce.start_time > NOW()) AS upcoming_events_count
       FROM people p
       LEFT JOIN captures c ON c.related_person_id = p.id
       LEFT JOIN calendar_events ce ON p.id = ANY(ce.attendee_ids)
       WHERE p.user_id = $1
    `;
    const params: any[] = [user_id];

    if (relationship_type) {
      params.push(relationship_type);
      query += ` AND p.relationship_type = $${params.length}`;
    }

    query += ` GROUP BY p.id`;

    // Sort options
    switch (sort_by) {
      case 'name':
        query += ` ORDER BY p.name ASC`;
        break;
      case 'recent':
        query += ` ORDER BY p.last_mentioned_at DESC`;
        break;
      case 'mentions':
        query += ` ORDER BY p.mention_count DESC`;
        break;
      case 'importance':
      default:
        query += ` ORDER BY p.importance_score DESC, p.last_mentioned_at DESC`;
    }

    const result = await pool.query(query, params);

    res.json({
      people: result.rows,
      count: result.rows.length
    });
  } catch (error: any) {
    logger.error('Error fetching people:', error);
    res.status(500).json({ error: 'Failed to fetch people' });
  }
});

// ============================================================================
// GET /v1/people/:id - Get a specific person with their related data
// ============================================================================
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Get person
    const personResult = await pool.query(
      `SELECT p.*,
              COUNT(DISTINCT c.id) FILTER (WHERE NOT c.is_completed) AS open_captures_count,
              COUNT(DISTINCT ce.id) FILTER (WHERE ce.start_time > NOW()) AS upcoming_events_count
       FROM people p
       LEFT JOIN captures c ON c.related_person_id = p.id
       LEFT JOIN calendar_events ce ON p.id = ANY(ce.attendee_ids)
       WHERE p.id = $1
       GROUP BY p.id`,
      [id]
    );

    if (personResult.rows.length === 0) {
      return res.status(404).json({ error: 'Person not found' });
    }

    const person = personResult.rows[0];

    // Get related facts
    const factsResult = await pool.query(
      `SELECT f.* FROM facts f
       JOIN people_facts pf ON pf.fact_id = f.id
       WHERE pf.person_id = $1
       ORDER BY f.confidence DESC, f.last_mentioned_at DESC
       LIMIT 20`,
      [id]
    );

    // Get recent captures related to this person
    const capturesResult = await pool.query(
      `SELECT * FROM captures
       WHERE related_person_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [id]
    );

    // Get upcoming events with this person
    const eventsResult = await pool.query(
      `SELECT * FROM calendar_events
       WHERE $1 = ANY(attendee_ids)
         AND start_time > NOW()
         AND status != 'cancelled'
       ORDER BY start_time
       LIMIT 10`,
      [id]
    );

    res.json({
      person,
      facts: factsResult.rows,
      recent_captures: capturesResult.rows,
      upcoming_events: eventsResult.rows
    });
  } catch (error: any) {
    logger.error('Error fetching person:', error);
    res.status(500).json({ error: 'Failed to fetch person' });
  }
});

// ============================================================================
// PATCH /v1/people/:id - Update a person
// ============================================================================
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const allowedFields = [
      'name', 'nickname', 'relationship_type', 'relationship_detail',
      'context', 'email', 'phone', 'sentiment', 'importance_score', 'metadata'
    ];

    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        setClauses.push(`${key} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(id);

    const query = `
      UPDATE people
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Person not found' });
    }

    logger.info(`Person updated: ${id}`);
    res.json(result.rows[0]);
  } catch (error: any) {
    logger.error('Error updating person:', error);
    res.status(500).json({ error: 'Failed to update person' });
  }
});

// ============================================================================
// DELETE /v1/people/:id - Delete a person
// ============================================================================
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Remove links first
    await pool.query('DELETE FROM people_facts WHERE person_id = $1', [id]);

    // Unlink from captures
    await pool.query(
      'UPDATE captures SET related_person_id = NULL WHERE related_person_id = $1',
      [id]
    );

    // Delete person
    const result = await pool.query(
      'DELETE FROM people WHERE id = $1 RETURNING id, name',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Person not found' });
    }

    logger.info(`Person deleted: ${id}`);
    res.json({ deleted: true, ...result.rows[0] });
  } catch (error: any) {
    logger.error('Error deleting person:', error);
    res.status(500).json({ error: 'Failed to delete person' });
  }
});

// ============================================================================
// POST /v1/people/:id/link-fact - Link a fact to a person
// ============================================================================
router.post('/:id/link-fact', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { fact_id } = req.body;

    if (!fact_id) {
      return res.status(400).json({ error: 'fact_id is required' });
    }

    // Check both exist
    const personCheck = await pool.query('SELECT id FROM people WHERE id = $1', [id]);
    const factCheck = await pool.query('SELECT id FROM facts WHERE id = $1', [fact_id]);

    if (personCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Person not found' });
    }
    if (factCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Fact not found' });
    }

    // Create link (ignore if already exists)
    await pool.query(
      `INSERT INTO people_facts (person_id, fact_id)
       VALUES ($1, $2)
       ON CONFLICT (person_id, fact_id) DO NOTHING`,
      [id, fact_id]
    );

    logger.info(`Linked fact ${fact_id} to person ${id}`);
    res.json({ linked: true, person_id: id, fact_id });
  } catch (error: any) {
    logger.error('Error linking fact:', error);
    res.status(500).json({ error: 'Failed to link fact' });
  }
});

// ============================================================================
// POST /v1/people/:id/unlink-fact - Unlink a fact from a person
// ============================================================================
router.post('/:id/unlink-fact', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { fact_id } = req.body;

    if (!fact_id) {
      return res.status(400).json({ error: 'fact_id is required' });
    }

    await pool.query(
      'DELETE FROM people_facts WHERE person_id = $1 AND fact_id = $2',
      [id, fact_id]
    );

    logger.info(`Unlinked fact ${fact_id} from person ${id}`);
    res.json({ unlinked: true, person_id: id, fact_id });
  } catch (error: any) {
    logger.error('Error unlinking fact:', error);
    res.status(500).json({ error: 'Failed to unlink fact' });
  }
});

// ============================================================================
// POST /v1/people/:id/mention - Record a mention of this person
// ============================================================================
router.post('/:id/mention', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE people
       SET mention_count = mention_count + 1,
           last_mentioned_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Person not found' });
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    logger.error('Error recording mention:', error);
    res.status(500).json({ error: 'Failed to record mention' });
  }
});

export default router;

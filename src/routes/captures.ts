import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { logger } from '../logger';

const router = Router();

// ============================================================================
// POST /v1/captures - Create a new capture (the core inbox action)
// ============================================================================
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      user_id,
      content,
      source = 'app',
      source_metadata = {},
      // Optional: user can provide hints
      has_deadline,
      deadline_at,
      preferred_time,
      priority,
      related_person_id
    } = req.body;

    // Validation
    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }
    if (!content || content.trim() === '') {
      return res.status(400).json({ error: 'content is required' });
    }

    // Verify user exists
    const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [user_id]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Insert capture into inbox
    const result = await pool.query(
      `INSERT INTO captures (
        user_id, content, source, source_metadata, status,
        has_deadline, deadline_at, preferred_time, priority, related_person_id
      )
      VALUES ($1, $2, $3, $4, 'inbox', $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        user_id,
        content.trim(),
        source,
        source_metadata,
        has_deadline || false,
        deadline_at || null,
        preferred_time || null,
        priority || 3,
        related_person_id || null
      ]
    );

    const capture = result.rows[0];
    logger.info(`Capture created: ${capture.id} for user ${user_id}`);

    res.status(201).json(capture);
  } catch (error: any) {
    logger.error('Error creating capture:', error);
    res.status(500).json({ error: 'Failed to create capture' });
  }
});

// ============================================================================
// GET /v1/captures/inbox/:user_id - Get all inbox items (unprocessed)
// ============================================================================
router.get('/inbox/:user_id', async (req: Request, res: Response) => {
  try {
    const { user_id } = req.params;

    const result = await pool.query(
      `SELECT c.*, p.name AS related_person_name
       FROM captures c
       LEFT JOIN people p ON p.id = c.related_person_id
       WHERE c.user_id = $1 AND c.status = 'inbox'
       ORDER BY c.created_at DESC`,
      [user_id]
    );

    res.json({
      captures: result.rows,
      count: result.rows.length
    });
  } catch (error: any) {
    logger.error('Error fetching inbox:', error);
    res.status(500).json({ error: 'Failed to fetch inbox' });
  }
});

// ============================================================================
// GET /v1/captures/active/:user_id - Get all active captures (processed, not completed)
// ============================================================================
router.get('/active/:user_id', async (req: Request, res: Response) => {
  try {
    const { user_id } = req.params;
    const { type, priority_max } = req.query;

    let query = `
      SELECT c.*,
             p.name AS related_person_name,
             ce.title AS scheduled_event_title,
             ce.start_time AS scheduled_start_time
       FROM captures c
       LEFT JOIN people p ON p.id = c.related_person_id
       LEFT JOIN calendar_events ce ON ce.id = c.scheduled_event_id
       WHERE c.user_id = $1
         AND c.status = 'processed'
         AND NOT c.is_completed
    `;
    const params: any[] = [user_id];

    // Filter by type if specified
    if (type) {
      params.push(type);
      query += ` AND c.interpreted_type = $${params.length}`;
    }

    // Filter by priority if specified
    if (priority_max) {
      params.push(parseInt(priority_max as string));
      query += ` AND c.priority <= $${params.length}`;
    }

    query += `
       ORDER BY
         c.has_deadline DESC,
         c.deadline_at ASC NULLS LAST,
         c.priority ASC,
         c.created_at DESC
    `;

    const result = await pool.query(query, params);

    res.json({
      captures: result.rows,
      count: result.rows.length
    });
  } catch (error: any) {
    logger.error('Error fetching active captures:', error);
    res.status(500).json({ error: 'Failed to fetch active captures' });
  }
});

// ============================================================================
// GET /v1/captures/deadlines/:user_id - Get upcoming deadlines
// ============================================================================
router.get('/deadlines/:user_id', async (req: Request, res: Response) => {
  try {
    const { user_id } = req.params;
    const { days = 7 } = req.query;

    const result = await pool.query(
      `SELECT c.*,
              p.name AS related_person_name,
              EXTRACT(EPOCH FROM (c.deadline_at - NOW()))/3600 AS hours_until_deadline
       FROM captures c
       LEFT JOIN people p ON p.id = c.related_person_id
       WHERE c.user_id = $1
         AND c.has_deadline
         AND c.deadline_at > NOW()
         AND c.deadline_at < NOW() + INTERVAL '1 day' * $2
         AND NOT c.is_completed
       ORDER BY c.deadline_at ASC`,
      [user_id, parseInt(days as string)]
    );

    res.json({
      deadlines: result.rows,
      count: result.rows.length
    });
  } catch (error: any) {
    logger.error('Error fetching deadlines:', error);
    res.status(500).json({ error: 'Failed to fetch deadlines' });
  }
});

// ============================================================================
// GET /v1/captures/:id - Get a specific capture
// ============================================================================
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT c.*,
              p.name AS related_person_name,
              ce.title AS scheduled_event_title,
              ce.start_time AS scheduled_start_time
       FROM captures c
       LEFT JOIN people p ON p.id = c.related_person_id
       LEFT JOIN calendar_events ce ON ce.id = c.scheduled_event_id
       WHERE c.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Capture not found' });
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    logger.error('Error fetching capture:', error);
    res.status(500).json({ error: 'Failed to fetch capture' });
  }
});

// ============================================================================
// PATCH /v1/captures/:id - Update a capture
// ============================================================================
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Build dynamic update query
    const allowedFields = [
      'content', 'status', 'interpreted_type', 'interpreted_title', 'interpreted_details',
      'has_deadline', 'deadline_at', 'preferred_time', 'estimated_duration_minutes',
      'priority', 'energy_required', 'is_recurring', 'recurrence_rule',
      'scheduled_event_id', 'related_person_id', 'related_capture_ids',
      'is_completed', 'completed_at', 'context_notes'
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

    // Always update updated_at
    setClauses.push(`updated_at = NOW()`);

    // If status is being set to 'processed', set processed_at
    if (updates.status === 'processed') {
      setClauses.push(`processed_at = NOW()`);
    }

    // If marking as completed, set completed_at
    if (updates.is_completed === true && !updates.completed_at) {
      setClauses.push(`completed_at = NOW()`);
    }

    values.push(id);
    const query = `
      UPDATE captures
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Capture not found' });
    }

    logger.info(`Capture updated: ${id}`);
    res.json(result.rows[0]);
  } catch (error: any) {
    logger.error('Error updating capture:', error);
    res.status(500).json({ error: 'Failed to update capture' });
  }
});

// ============================================================================
// POST /v1/captures/:id/complete - Mark a capture as completed
// ============================================================================
router.post('/:id/complete', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE captures
       SET is_completed = TRUE, completed_at = NOW(), updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Capture not found' });
    }

    logger.info(`Capture completed: ${id}`);
    res.json(result.rows[0]);
  } catch (error: any) {
    logger.error('Error completing capture:', error);
    res.status(500).json({ error: 'Failed to complete capture' });
  }
});

// ============================================================================
// POST /v1/captures/:id/uncomplete - Unmark a capture as completed
// ============================================================================
router.post('/:id/uncomplete', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE captures
       SET is_completed = FALSE, completed_at = NULL, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Capture not found' });
    }

    logger.info(`Capture uncompleted: ${id}`);
    res.json(result.rows[0]);
  } catch (error: any) {
    logger.error('Error uncompleting capture:', error);
    res.status(500).json({ error: 'Failed to uncomplete capture' });
  }
});

// ============================================================================
// POST /v1/captures/:id/archive - Archive a capture
// ============================================================================
router.post('/:id/archive', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE captures
       SET status = 'archived', updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Capture not found' });
    }

    logger.info(`Capture archived: ${id}`);
    res.json(result.rows[0]);
  } catch (error: any) {
    logger.error('Error archiving capture:', error);
    res.status(500).json({ error: 'Failed to archive capture' });
  }
});

// ============================================================================
// DELETE /v1/captures/:id - Soft delete a capture
// ============================================================================
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE captures
       SET status = 'deleted', updated_at = NOW()
       WHERE id = $1
       RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Capture not found' });
    }

    logger.info(`Capture deleted: ${id}`);
    res.json({ deleted: true, id });
  } catch (error: any) {
    logger.error('Error deleting capture:', error);
    res.status(500).json({ error: 'Failed to delete capture' });
  }
});

export default router;

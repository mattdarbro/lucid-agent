import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { logger } from '../logger';

const router = Router();

// POST /v1/users - Create a new user
router.post('/', async (req: Request, res: Response) => {
  try {
    const { external_id, name, email, timezone, preferences } = req.body;

    // Validation
    if (!external_id) {
      return res.status(400).json({ error: 'external_id is required' });
    }

    // Insert user
    const result = await pool.query(
      `INSERT INTO users (external_id, name, email, timezone, preferences)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (external_id)
       DO UPDATE SET
         name = EXCLUDED.name,
         email = EXCLUDED.email,
         timezone = EXCLUDED.timezone,
         preferences = EXCLUDED.preferences,
         last_active_at = NOW()
       RETURNING *`,
      [
        external_id,
        name || null,
        email || null,
        timezone || 'UTC',
        preferences || {}
      ]
    );

    const user = result.rows[0];
    logger.info(`User created/updated: ${user.id}`);

    res.status(201).json(user);
  } catch (error: any) {
    logger.error('Error creating user:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// GET /v1/users/:external_id - Get user by external ID
router.get('/:external_id', async (req: Request, res: Response) => {
  try {
    const { external_id } = req.params;

    const result = await pool.query(
      'SELECT * FROM users WHERE external_id = $1',
      [external_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    logger.error('Error fetching user:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

export default router;

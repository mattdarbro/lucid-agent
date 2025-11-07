import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { logger } from '../logger';

const router = Router();

// POST /v1/conversations - Create a new conversation
router.post('/', async (req: Request, res: Response) => {
  try {
    const { user_id, title, user_timezone } = req.body;

    // Validation
    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    // Verify user exists
    const userCheck = await pool.query(
      'SELECT id, timezone FROM users WHERE id = $1',
      [user_id]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userCheck.rows[0];

    // Create conversation
    const result = await pool.query(
      `INSERT INTO conversations (user_id, title, user_timezone)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [
        user_id,
        title || null,
        user_timezone || user.timezone || 'UTC'
      ]
    );

    const conversation = result.rows[0];
    logger.info(`Conversation created: ${conversation.id} for user ${user_id}`);

    res.status(201).json(conversation);
  } catch (error: any) {
    logger.error('Error creating conversation:', error);
    res.status(500).json({ error: 'Failed to create conversation' });
  }
});

// GET /v1/conversations/:id - Get conversation by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'SELECT * FROM conversations WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    logger.error('Error fetching conversation:', error);
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
});

// GET /v1/conversations/user/:user_id - Get all conversations for a user
router.get('/user/:user_id', async (req: Request, res: Response) => {
  try {
    const { user_id } = req.params;

    const result = await pool.query(
      `SELECT * FROM conversations
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [user_id]
    );

    res.json({
      conversations: result.rows,
      count: result.rows.length
    });
  } catch (error: any) {
    logger.error('Error fetching conversations:', error);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

export default router;

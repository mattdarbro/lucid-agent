import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { logger } from '../logger';
import { insightGenerationService } from '../services';
import { z } from 'zod';

const router = Router();
const insightService = insightGenerationService;

/**
 * Validation schemas
 */
const taskIdSchema = z.object({
  task_id: z.string().uuid(),
});

const insightIdSchema = z.object({
  id: z.string().uuid(),
});

const userIdSchema = z.object({
  user_id: z.string().uuid(),
});

const validateInsightSchema = z.object({
  action: z.enum(['accepted', 'rejected', 'refined']),
  refinement_text: z.string().optional(),
  time_of_day: z.enum(['morning', 'afternoon', 'evening', 'late_night']).optional(),
  energy_level: z.number().int().min(1).max(5).optional(),
  mood: z.number().int().min(1).max(5).optional(),
});

/**
 * POST /v1/tasks/:task_id/insights/generate
 *
 * Manually trigger insight generation for a task
 * Usually called after a few check-ins have been completed
 */
router.post('/:task_id/insights/generate', async (req: Request, res: Response) => {
  try {
    const { task_id } = taskIdSchema.parse(req.params);

    const insights = await insightService.generateInsightsForTask(task_id);

    res.json({
      insights,
      count: insights.length,
      message: insights.length > 0 ? 'Insights generated' : 'No new patterns detected yet',
    });
  } catch (error: any) {
    logger.error('Error generating insights:', error);

    if (error.message.includes('not found')) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.status(500).json({
      error: 'Failed to generate insights',
      details: error.message,
    });
  }
});

/**
 * GET /v1/tasks/:task_id/insights
 *
 * Get all insights for a task
 */
router.get('/:task_id/insights', async (req: Request, res: Response) => {
  try {
    const { task_id } = taskIdSchema.parse(req.params);

    const insights = await insightService.getInsightsForTask(task_id);

    res.json({
      insights,
      count: insights.length,
    });
  } catch (error: any) {
    logger.error('Error fetching task insights:', error);
    res.status(500).json({
      error: 'Failed to fetch insights',
      details: error.message,
    });
  }
});

/**
 * GET /v1/users/:user_id/insights/pending
 *
 * Get pending insights that need user review
 */
router.get('/users/:user_id/pending', async (req: Request, res: Response) => {
  try {
    const { user_id } = userIdSchema.parse(req.params);

    const insights = await insightService.getPendingInsights(user_id);

    res.json({
      insights,
      count: insights.length,
    });
  } catch (error: any) {
    logger.error('Error fetching pending insights:', error);
    res.status(500).json({
      error: 'Failed to fetch pending insights',
      details: error.message,
    });
  }
});

/**
 * GET /v1/insights/:id
 *
 * Get a specific insight
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = insightIdSchema.parse(req.params);

    const query = `SELECT * FROM task_insights WHERE id = $1`;
    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Insight not found' });
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    logger.error('Error fetching insight:', error);
    res.status(500).json({
      error: 'Failed to fetch insight',
      details: error.message,
    });
  }
});

/**
 * POST /v1/insights/:id/validate
 *
 * User validates an insight (accept, reject, or refine)
 * This creates an insight_interaction record and updates receptivity patterns
 */
router.post('/:id/validate', async (req: Request, res: Response) => {
  try {
    const { id } = insightIdSchema.parse(req.params);
    const input = validateInsightSchema.parse(req.body);

    // Get the insight
    const insightQuery = `SELECT * FROM task_insights WHERE id = $1`;
    const insightResult = await pool.query(insightQuery, [id]);

    if (insightResult.rows.length === 0) {
      return res.status(404).json({ error: 'Insight not found' });
    }

    const insight = insightResult.rows[0];

    // Update insight status
    let newStatus = insight.status;
    let userValidated = insight.user_validated;

    if (input.action === 'accepted') {
      newStatus = 'confirmed';
      userValidated = true;
    } else if (input.action === 'rejected') {
      newStatus = 'rejected';
      userValidated = false;
    } else if (input.action === 'refined') {
      newStatus = 'refined';
      userValidated = true; // Refined means they agree with the core insight
    }

    const updateQuery = `
      UPDATE task_insights
      SET
        status = $1,
        user_validated = $2,
        user_refinement = $3,
        reviewed_at = NOW()
      WHERE id = $4
      RETURNING *
    `;

    const updateResult = await pool.query(updateQuery, [
      newStatus,
      userValidated,
      input.refinement_text || null,
      id,
    ]);

    const updatedInsight = updateResult.rows[0];

    // Create interaction record
    const interactionQuery = `
      INSERT INTO insight_interactions (
        insight_id,
        user_id,
        reviewed_at,
        time_of_day,
        action,
        refinement_text,
        energy_level,
        mood
      ) VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7)
      RETURNING *
    `;

    await pool.query(interactionQuery, [
      id,
      insight.user_id,
      input.time_of_day || null,
      input.action,
      input.refinement_text || null,
      input.energy_level || null,
      input.mood || null,
    ]);

    // Update receptivity patterns
    await insightService.updateReceptivityPattern(
      insight.user_id,
      id,
      input.action,
      input.refinement_text
    );

    logger.info('Insight validated', {
      insight_id: id,
      user_id: insight.user_id,
      action: input.action,
    });

    res.json({
      insight: updatedInsight,
      message: `Insight ${input.action}`,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      });
    }

    logger.error('Error validating insight:', error);
    res.status(500).json({
      error: 'Failed to validate insight',
      details: error.message,
    });
  }
});

/**
 * POST /v1/insights/:id/start-discussion
 *
 * Start a conversation about an insight
 * Creates a new conversation for discussing the insight
 */
router.post('/:id/start-discussion', async (req: Request, res: Response) => {
  try {
    const { id } = insightIdSchema.parse(req.params);

    // Get the insight
    const insightQuery = `SELECT * FROM task_insights WHERE id = $1`;
    const insightResult = await pool.query(insightQuery, [id]);

    if (insightResult.rows.length === 0) {
      return res.status(404).json({ error: 'Insight not found' });
    }

    const insight = insightResult.rows[0];

    // Create a conversation for this insight
    const conversationQuery = `
      INSERT INTO conversations (
        user_id,
        title,
        conversation_context,
        related_task_id,
        related_insight_id,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;

    const conversationMetadata = {
      insight_id: id,
      insight_text: insight.insight_text,
      pattern_type: insight.pattern_type,
    };

    const conversationResult = await pool.query(conversationQuery, [
      insight.user_id,
      'Discussing insight',
      'insight_review',
      insight.task_id,
      id,
      JSON.stringify(conversationMetadata),
    ]);

    const conversation = conversationResult.rows[0];

    // Link conversation to insight in task_conversations
    const taskConversationQuery = `
      INSERT INTO task_conversations (
        task_id,
        conversation_id,
        conversation_type,
        insight_id
      ) VALUES ($1, $2, $3, $4)
      RETURNING *
    `;

    await pool.query(taskConversationQuery, [
      insight.task_id,
      conversation.id,
      'insight_review',
      id,
    ]);

    logger.info('Insight discussion started', {
      insight_id: id,
      conversation_id: conversation.id,
    });

    res.json({
      conversation,
      insight,
      message: 'Conversation started',
    });
  } catch (error: any) {
    logger.error('Error starting insight discussion:', error);
    res.status(500).json({
      error: 'Failed to start discussion',
      details: error.message,
    });
  }
});

export default router;

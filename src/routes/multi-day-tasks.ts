import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { logger } from '../logger';
import { MultiDayTaskService } from '../services/multi-day-task.service';
import {
  createMultiDayTaskSchema,
  updateMultiDayTaskSchema,
  addCheckInSchema,
  multiDayTaskListQuerySchema,
  multiDayTaskIdSchema,
} from '../validation/multi-day-task.validation';
import { z } from 'zod';

const router = Router();
const taskService = new MultiDayTaskService(pool);

/**
 * Validation middleware helper
 */
function validateBody(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: Function) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.errors.map((err) => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        });
      }
      next(error);
    }
  };
}

/**
 * POST /v1/multi-day-tasks
 *
 * Create a new multi-day research task
 * This is for tracking thinking across multiple days (e.g., "Should I expand my practice?")
 *
 * Request body:
 * - user_id: string (required) - UUID of the user
 * - title: string (required) - Task title (e.g., "Career decision")
 * - description: string (optional) - Initial question/context
 * - topic_category: string (optional) - Category (e.g., "career", "health", "creative")
 * - target_completion_date: string (optional) - ISO date
 * - check_in_times: array (optional) - ['morning', 'evening'] - When to check in
 * - duration_days: number (optional) - How many days (default: 5)
 * - initial_context: string (optional) - Background information
 */
router.post(
  '/',
  validateBody(createMultiDayTaskSchema),
  async (req: Request, res: Response) => {
    try {
      const task = await taskService.createTask(req.body);
      res.status(201).json(task);
    } catch (error: any) {
      logger.error('Error in POST /v1/multi-day-tasks:', error);

      if (error.message.includes('not found')) {
        return res.status(404).json({ error: error.message });
      }

      res.status(500).json({
        error: 'Failed to create multi-day task',
        details: error.message,
      });
    }
  }
);

/**
 * GET /v1/multi-day-tasks/:id
 *
 * Get a specific multi-day task with all check-ins
 *
 * Path parameters:
 * - id: string - UUID of the task
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = multiDayTaskIdSchema.parse(req.params);

    const task = await taskService.findById(id);

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json(task);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      });
    }

    logger.error('Error in GET /v1/multi-day-tasks/:id:', error);
    res.status(500).json({ error: 'Failed to fetch task' });
  }
});

/**
 * GET /v1/users/:user_id/multi-day-tasks
 *
 * List multi-day tasks for a user
 *
 * Path parameters:
 * - user_id: string - UUID of the user
 *
 * Query parameters:
 * - status: string (optional) - Filter by status ('active', 'paused', 'completed', 'abandoned')
 * - topic_category: string (optional) - Filter by category
 * - limit: number (optional) - Maximum tasks to return (default: 50, max: 100)
 * - offset: number (optional) - Number of tasks to skip (default: 0)
 */
router.get('/users/:user_id', async (req: Request, res: Response) => {
  try {
    const userIdSchema = z.object({
      user_id: z.string().uuid(),
    });

    const { user_id } = userIdSchema.parse(req.params);
    const queryParams = multiDayTaskListQuerySchema.parse(req.query);

    const tasks = await taskService.listByUser(user_id, {
      status: queryParams.status,
      topic_category: queryParams.topic_category,
      limit: queryParams.limit,
      offset: queryParams.offset,
    });

    res.json({
      tasks,
      count: tasks.length,
      user_id,
      limit: queryParams.limit,
      offset: queryParams.offset,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      });
    }

    logger.error('Error in GET /v1/users/:user_id/multi-day-tasks:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

/**
 * POST /v1/multi-day-tasks/:id/check-ins
 *
 * Add a check-in to a multi-day task
 * This is called when you respond to a notification about this task
 *
 * Path parameters:
 * - id: string - UUID of the task
 *
 * Request body:
 * - notification_id: string (optional) - UUID of the notification this responds to
 * - time_of_day: string (required) - 'morning', 'afternoon', 'evening', 'late_night'
 * - question_asked: string (required) - What question was asked
 * - question_type: string (required) - 'analytical', 'creative', 'experiential', etc.
 * - response: string (required) - Your answer
 * - self_reported_energy: number (optional) - 1-5 scale
 * - self_reported_mood: number (optional) - 1-5 scale
 * - self_reported_focus: number (optional) - 1-5 scale
 * - insights: array (optional) - Key insights from this check-in
 * - detected_state: string (optional) - Detected cognitive state
 */
router.post(
  '/:id/check-ins',
  validateBody(addCheckInSchema),
  async (req: Request, res: Response) => {
    try {
      const { id } = multiDayTaskIdSchema.parse(req.params);

      const task = await taskService.addCheckIn(id, req.body);

      logger.info('Check-in added to multi-day task', {
        task_id: id,
        time_of_day: req.body.time_of_day,
      });

      res.json({
        task,
        message: 'Check-in recorded successfully',
      });
    } catch (error: any) {
      logger.error('Error in POST /v1/multi-day-tasks/:id/check-ins:', error);

      if (error.message.includes('not found')) {
        return res.status(404).json({ error: 'Task not found' });
      }

      if (error.message.includes('Cannot add check-in')) {
        return res.status(400).json({ error: error.message });
      }

      res.status(500).json({
        error: 'Failed to add check-in',
        details: error.message,
      });
    }
  }
);

/**
 * PATCH /v1/multi-day-tasks/:id
 *
 * Update a multi-day task
 *
 * Path parameters:
 * - id: string - UUID of the task
 *
 * Request body:
 * - title: string (optional)
 * - description: string (optional)
 * - status: string (optional) - 'active', 'paused', 'completed', 'abandoned'
 * - target_completion_date: string (optional)
 * - final_synthesis: string (optional)
 */
router.patch(
  '/:id',
  validateBody(updateMultiDayTaskSchema),
  async (req: Request, res: Response) => {
    try {
      const { id } = multiDayTaskIdSchema.parse(req.params);

      const task = await taskService.updateTask(id, req.body);

      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }

      res.json(task);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.errors.map((err) => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        });
      }

      logger.error('Error in PATCH /v1/multi-day-tasks/:id:', error);
      res.status(500).json({ error: 'Failed to update task' });
    }
  }
);

/**
 * POST /v1/multi-day-tasks/:id/complete
 *
 * Complete a multi-day task and generate synthesis
 * This analyzes all check-ins and creates a final synthesis with temporal analysis
 *
 * Path parameters:
 * - id: string - UUID of the task
 */
router.post('/:id/complete', async (req: Request, res: Response) => {
  try {
    const { id } = multiDayTaskIdSchema.parse(req.params);

    const task = await taskService.completeTask(id);

    logger.info('Multi-day task completed with synthesis', {
      task_id: id,
      check_ins_count: (task.check_ins || []).length,
    });

    res.json({
      task,
      message: 'Task completed and synthesis generated',
    });
  } catch (error: any) {
    logger.error('Error in POST /v1/multi-day-tasks/:id/complete:', error);

    if (error.message.includes('not found')) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (error.message.includes('already completed') || error.message.includes('no check-ins')) {
      return res.status(400).json({ error: error.message });
    }

    res.status(500).json({
      error: 'Failed to complete task',
      details: error.message,
    });
  }
});

/**
 * GET /v1/multi-day-tasks/:id/temporal-analysis
 *
 * Get temporal analysis for a task (without completing it)
 * Shows insights across different times of day
 *
 * Path parameters:
 * - id: string - UUID of the task
 */
router.get('/:id/temporal-analysis', async (req: Request, res: Response) => {
  try {
    const { id } = multiDayTaskIdSchema.parse(req.params);

    const task = await taskService.findById(id);

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const checkIns = task.check_ins || [];

    if (checkIns.length === 0) {
      return res.json({
        message: 'No check-ins yet',
        analysis: null,
      });
    }

    const analysis = taskService.generateTemporalAnalysis(checkIns);

    res.json({
      task_id: id,
      task_title: task.title,
      check_ins_count: checkIns.length,
      analysis,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      });
    }

    logger.error('Error in GET /v1/multi-day-tasks/:id/temporal-analysis:', error);
    res.status(500).json({ error: 'Failed to generate analysis' });
  }
});

/**
 * DELETE /v1/multi-day-tasks/:id
 *
 * Delete a multi-day task
 *
 * Path parameters:
 * - id: string - UUID of the task
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = multiDayTaskIdSchema.parse(req.params);

    const deleted = await taskService.deleteTask(id);

    if (!deleted) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.status(204).send();
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      });
    }

    logger.error('Error in DELETE /v1/multi-day-tasks/:id:', error);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

export default router;

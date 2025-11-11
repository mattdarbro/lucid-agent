import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { SupabaseClient } from '@supabase/supabase-js';
import { ResearchTaskService } from '../services/research-task.service';
import {
  createResearchTaskSchema,
  updateResearchTaskSchema,
  listResearchTasksSchema,
} from '../validation/research-task.validation';
import { logger } from '../logger';

export function createResearchTaskRouter(pool: Pool, supabase: SupabaseClient): Router {
  const router = Router();
  const researchService = new ResearchTaskService(pool, supabase);

  /**
   * POST /research-tasks
   * Create a new research task
   */
  router.post('/', async (req: Request, res: Response) => {
    try {
      const input = createResearchTaskSchema.parse(req.body);
      const task = await researchService.createTask(input);

      logger.info('Research task created via API', { taskId: task.id, userId: input.user_id });
      res.status(201).json(task);
    } catch (error: any) {
      logger.error('Failed to create research task via API', { error: error.message, body: req.body });
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to create research task' });
    }
  });

  /**
   * GET /research-tasks
   * List research tasks with filters
   */
  router.get('/', async (req: Request, res: Response) => {
    try {
      const input = listResearchTasksSchema.parse(req.query);
      const tasks = await researchService.listTasks(input);

      res.json(tasks);
    } catch (error: any) {
      logger.error('Failed to list research tasks via API', { error: error.message, query: req.query });
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid query parameters', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to list research tasks' });
    }
  });

  /**
   * GET /research-tasks/pending
   * Get pending research tasks
   */
  router.get('/pending', async (req: Request, res: Response) => {
    try {
      const userId = req.query.user_id as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;

      const tasks = await researchService.getPendingTasks(userId, limit);

      res.json(tasks);
    } catch (error: any) {
      logger.error('Failed to get pending research tasks via API', { error: error.message, query: req.query });
      res.status(500).json({ error: 'Failed to get pending research tasks' });
    }
  });

  /**
   * GET /research-tasks/by-emotional-state/:emotionalStateId
   * Get tasks by emotional state ID
   */
  router.get('/by-emotional-state/:emotionalStateId', async (req: Request, res: Response) => {
    try {
      const tasks = await researchService.getTasksByEmotionalStateId(req.params.emotionalStateId);

      res.json(tasks);
    } catch (error: any) {
      logger.error('Failed to get tasks by emotional state via API', {
        error: error.message,
        emotionalStateId: req.params.emotionalStateId
      });
      res.status(500).json({ error: 'Failed to get tasks by emotional state' });
    }
  });

  /**
   * GET /research-tasks/:id
   * Get a specific research task
   */
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const task = await researchService.getTaskById(req.params.id);

      if (!task) {
        return res.status(404).json({ error: 'Research task not found' });
      }

      res.json(task);
    } catch (error: any) {
      logger.error('Failed to get research task via API', { error: error.message, taskId: req.params.id });
      res.status(500).json({ error: 'Failed to get research task' });
    }
  });

  /**
   * PATCH /research-tasks/:id
   * Update a research task
   */
  router.patch('/:id', async (req: Request, res: Response) => {
    try {
      const input = updateResearchTaskSchema.parse(req.body);
      const task = await researchService.updateTask(req.params.id, input);

      logger.info('Research task updated via API', { taskId: req.params.id });
      res.json(task);
    } catch (error: any) {
      logger.error('Failed to update research task via API', { error: error.message, taskId: req.params.id });
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to update research task' });
    }
  });

  /**
   * POST /research-tasks/:id/start
   * Mark task as started
   */
  router.post('/:id/start', async (req: Request, res: Response) => {
    try {
      const task = await researchService.markTaskAsStarted(req.params.id);

      logger.info('Research task started via API', { taskId: req.params.id });
      res.json(task);
    } catch (error: any) {
      logger.error('Failed to start research task via API', { error: error.message, taskId: req.params.id });
      res.status(500).json({ error: 'Failed to start research task' });
    }
  });

  /**
   * POST /research-tasks/:id/complete
   * Mark task as completed
   */
  router.post('/:id/complete', async (req: Request, res: Response) => {
    try {
      const { results, derived_facts } = req.body;
      const task = await researchService.markTaskAsCompleted(
        req.params.id,
        results || {},
        derived_facts,
      );

      logger.info('Research task completed via API', { taskId: req.params.id });
      res.json(task);
    } catch (error: any) {
      logger.error('Failed to complete research task via API', { error: error.message, taskId: req.params.id });
      res.status(500).json({ error: 'Failed to complete research task' });
    }
  });

  /**
   * POST /research-tasks/:id/fail
   * Mark task as failed
   */
  router.post('/:id/fail', async (req: Request, res: Response) => {
    try {
      const { error: errorMessage } = req.body;
      const task = await researchService.markTaskAsFailed(
        req.params.id,
        { error: errorMessage || 'Unknown error' },
      );

      logger.info('Research task marked as failed via API', { taskId: req.params.id });
      res.json(task);
    } catch (error: any) {
      logger.error('Failed to mark research task as failed via API', { error: error.message, taskId: req.params.id });
      res.status(500).json({ error: 'Failed to mark research task as failed' });
    }
  });

  /**
   * DELETE /research-tasks/:id
   * Delete a research task
   */
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      await researchService.deleteTask(req.params.id);

      logger.info('Research task deleted via API', { taskId: req.params.id });
      res.status(204).send();
    } catch (error: any) {
      logger.error('Failed to delete research task via API', { error: error.message, taskId: req.params.id });
      res.status(500).json({ error: 'Failed to delete research task' });
    }
  });

  return router;
}

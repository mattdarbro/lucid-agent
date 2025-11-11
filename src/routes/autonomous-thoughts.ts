import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { SupabaseClient } from '@supabase/supabase-js';
import { AutonomousThoughtService } from '../services/autonomous-thought.service';
import {
  createAutonomousThoughtSchema,
  updateAutonomousThoughtSchema,
  listAutonomousThoughtsSchema,
  searchThoughtsSchema,
} from '../validation/autonomous-thought.validation';
import { logger } from '../logger';

export function createAutonomousThoughtRouter(pool: Pool, supabase: SupabaseClient): Router {
  const router = Router();
  const thoughtService = new AutonomousThoughtService(pool, supabase);

  /**
   * POST /autonomous-thoughts
   * Create a new autonomous thought
   */
  router.post('/', async (req: Request, res: Response) => {
    try {
      const input = createAutonomousThoughtSchema.parse(req.body);
      const thought = await thoughtService.createThought(input);

      logger.info('Autonomous thought created via API', { thoughtId: thought.id, userId: input.user_id });
      res.status(201).json(thought);
    } catch (error: any) {
      logger.error('Failed to create autonomous thought via API', { error: error.message, body: req.body });
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to create autonomous thought' });
    }
  });

  /**
   * GET /autonomous-thoughts
   * List autonomous thoughts with filters
   */
  router.get('/', async (req: Request, res: Response) => {
    try {
      const input = listAutonomousThoughtsSchema.parse(req.query);
      const thoughts = await thoughtService.listThoughts(input);

      res.json(thoughts);
    } catch (error: any) {
      logger.error('Failed to list autonomous thoughts via API', { error: error.message, query: req.query });
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid query parameters', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to list autonomous thoughts' });
    }
  });

  /**
   * POST /autonomous-thoughts/search
   * Search thoughts by semantic similarity
   */
  router.post('/search', async (req: Request, res: Response) => {
    try {
      const input = searchThoughtsSchema.parse(req.body);
      const thoughts = await thoughtService.searchThoughts(input);

      logger.info('Thought search completed via API', { userId: input.user_id, resultsCount: thoughts.length });
      res.json(thoughts);
    } catch (error: any) {
      logger.error('Failed to search thoughts via API', { error: error.message, body: req.body });
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to search thoughts' });
    }
  });

  /**
   * GET /autonomous-thoughts/unshared/:userId
   * Get recent unshared thoughts for a user
   */
  router.get('/unshared/:userId', async (req: Request, res: Response) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
      const thoughts = await thoughtService.getRecentUnsharedThoughts(req.params.userId, limit);

      res.json(thoughts);
    } catch (error: any) {
      logger.error('Failed to get unshared thoughts via API', { error: error.message, userId: req.params.userId });
      res.status(500).json({ error: 'Failed to get unshared thoughts' });
    }
  });

  /**
   * GET /autonomous-thoughts/job/:jobId
   * Get thoughts by agent job ID
   */
  router.get('/job/:jobId', async (req: Request, res: Response) => {
    try {
      const thoughts = await thoughtService.getThoughtsByJobId(req.params.jobId);

      res.json(thoughts);
    } catch (error: any) {
      logger.error('Failed to get thoughts by job ID via API', { error: error.message, jobId: req.params.jobId });
      res.status(500).json({ error: 'Failed to get thoughts by job ID' });
    }
  });

  /**
   * GET /autonomous-thoughts/:id
   * Get a specific autonomous thought
   */
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const thought = await thoughtService.getThoughtById(req.params.id);

      if (!thought) {
        return res.status(404).json({ error: 'Autonomous thought not found' });
      }

      res.json(thought);
    } catch (error: any) {
      logger.error('Failed to get autonomous thought via API', { error: error.message, thoughtId: req.params.id });
      res.status(500).json({ error: 'Failed to get autonomous thought' });
    }
  });

  /**
   * PATCH /autonomous-thoughts/:id
   * Update an autonomous thought
   */
  router.patch('/:id', async (req: Request, res: Response) => {
    try {
      const input = updateAutonomousThoughtSchema.parse(req.body);
      const thought = await thoughtService.updateThought(req.params.id, input);

      logger.info('Autonomous thought updated via API', { thoughtId: req.params.id });
      res.json(thought);
    } catch (error: any) {
      logger.error('Failed to update autonomous thought via API', { error: error.message, thoughtId: req.params.id });
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to update autonomous thought' });
    }
  });

  /**
   * POST /autonomous-thoughts/:id/share
   * Share a thought with the user
   */
  router.post('/:id/share', async (req: Request, res: Response) => {
    try {
      const thought = await thoughtService.shareThought(req.params.id);

      logger.info('Autonomous thought shared via API', { thoughtId: req.params.id });
      res.json(thought);
    } catch (error: any) {
      logger.error('Failed to share autonomous thought via API', { error: error.message, thoughtId: req.params.id });
      res.status(500).json({ error: 'Failed to share autonomous thought' });
    }
  });

  /**
   * DELETE /autonomous-thoughts/:id
   * Delete an autonomous thought
   */
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      await thoughtService.deleteThought(req.params.id);

      logger.info('Autonomous thought deleted via API', { thoughtId: req.params.id });
      res.status(204).send();
    } catch (error: any) {
      logger.error('Failed to delete autonomous thought via API', { error: error.message, thoughtId: req.params.id });
      res.status(500).json({ error: 'Failed to delete autonomous thought' });
    }
  });

  return router;
}

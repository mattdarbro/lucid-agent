import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { SupabaseClient } from '@supabase/supabase-js';
import { AgentJobService } from '../services/agent-job.service';
import {
  createAgentJobSchema,
  updateAgentJobSchema,
  listAgentJobsSchema,
} from '../validation/agent-job.validation';
import { logger } from '../logger';

export function createAgentJobRouter(pool: Pool, supabase: SupabaseClient): Router {
  const router = Router();
  const agentJobService = new AgentJobService(pool, supabase);

  /**
   * POST /agent-jobs
   * Create a new agent job
   */
  router.post('/', async (req: Request, res: Response) => {
    try {
      const input = createAgentJobSchema.parse(req.body);
      const job = await agentJobService.createJob(input);

      logger.info('Agent job created via API', { jobId: job.id, userId: input.user_id });
      res.status(201).json(job);
    } catch (error: any) {
      logger.error('Failed to create agent job via API', { error: error.message, body: req.body });
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to create agent job' });
    }
  });

  /**
   * GET /agent-jobs
   * List agent jobs with filters
   */
  router.get('/', async (req: Request, res: Response) => {
    try {
      const input = listAgentJobsSchema.parse(req.query);
      const jobs = await agentJobService.listJobs(input);

      res.json(jobs);
    } catch (error: any) {
      logger.error('Failed to list agent jobs via API', { error: error.message, query: req.query });
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid query parameters', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to list agent jobs' });
    }
  });

  /**
   * GET /agent-jobs/due
   * Get jobs that are due to run
   */
  router.get('/due', async (req: Request, res: Response) => {
    try {
      const jobs = await agentJobService.getDueJobs();

      res.json(jobs);
    } catch (error: any) {
      logger.error('Failed to get due jobs via API', { error: error.message });
      res.status(500).json({ error: 'Failed to get due jobs' });
    }
  });

  /**
   * GET /agent-jobs/:id
   * Get a specific agent job
   */
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const job = await agentJobService.getJobById(req.params.id);

      if (!job) {
        return res.status(404).json({ error: 'Agent job not found' });
      }

      res.json(job);
    } catch (error: any) {
      logger.error('Failed to get agent job via API', { error: error.message, jobId: req.params.id });
      res.status(500).json({ error: 'Failed to get agent job' });
    }
  });

  /**
   * PATCH /agent-jobs/:id
   * Update an agent job
   */
  router.patch('/:id', async (req: Request, res: Response) => {
    try {
      const input = updateAgentJobSchema.parse(req.body);
      const job = await agentJobService.updateJob(req.params.id, input);

      logger.info('Agent job updated via API', { jobId: req.params.id });
      res.json(job);
    } catch (error: any) {
      logger.error('Failed to update agent job via API', { error: error.message, jobId: req.params.id });
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to update agent job' });
    }
  });

  /**
   * DELETE /agent-jobs/:id
   * Delete an agent job
   */
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      await agentJobService.deleteJob(req.params.id);

      logger.info('Agent job deleted via API', { jobId: req.params.id });
      res.status(204).send();
    } catch (error: any) {
      logger.error('Failed to delete agent job via API', { error: error.message, jobId: req.params.id });
      res.status(500).json({ error: 'Failed to delete agent job' });
    }
  });

  /**
   * POST /agent-jobs/schedule/:userId
   * Schedule circadian jobs for a user
   */
  router.post('/schedule/:userId', async (req: Request, res: Response) => {
    try {
      const date = req.body.date ? new Date(req.body.date) : new Date();
      const jobs = await agentJobService.scheduleCircadianJobs(req.params.userId, date);

      logger.info('Circadian jobs scheduled via API', { userId: req.params.userId, count: jobs.length });
      res.status(201).json(jobs);
    } catch (error: any) {
      logger.error('Failed to schedule circadian jobs via API', { error: error.message, userId: req.params.userId });
      res.status(500).json({ error: 'Failed to schedule circadian jobs' });
    }
  });

  return router;
}

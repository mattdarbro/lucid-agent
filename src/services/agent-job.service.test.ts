import { vi, type Mock } from 'vitest';
import { Pool } from 'pg';
import { SupabaseClient } from '@supabase/supabase-js';
import { AgentJobService } from './agent-job.service';
import { CreateAgentJobInput, UpdateAgentJobInput } from '../validation/agent-job.validation';

describe('AgentJobService', () => {
  let pool: Pool;
  let supabase: SupabaseClient;
  let service: AgentJobService;

  // Mock Supabase responses
  const mockJob = {
    id: 'test-job-id',
    user_id: 'test-user-id',
    job_type: 'morning_reflection',
    status: 'pending',
    scheduled_for: new Date().toISOString(),
    thoughts_generated: 0,
    research_tasks_created: 0,
    error_message: null,
    created_at: new Date().toISOString(),
    started_at: null,
    completed_at: null,
  };

  beforeEach(() => {
    // Create mock pool
    pool = {} as Pool;

    // Create mock Supabase client
    supabase = {
      from: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      single: vi.fn(),
    } as any;

    service = new AgentJobService(pool, supabase);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createJob', () => {
    it('should create a new agent job successfully', async () => {
      const input: CreateAgentJobInput = {
        user_id: 'test-user-id',
        job_type: 'morning_reflection',
        scheduled_for: new Date(),
      };

      (supabase.single as Mock).mockResolvedValue({
        data: mockJob,
        error: null,
      });

      const result = await service.createJob(input);

      expect(result).toBeDefined();
      expect(result.id).toBe('test-job-id');
      expect(result.job_type).toBe('morning_reflection');
      expect(supabase.from).toHaveBeenCalledWith('agent_jobs');
      expect(supabase.insert).toHaveBeenCalled();
    });

    it('should throw error if creation fails', async () => {
      const input: CreateAgentJobInput = {
        user_id: 'test-user-id',
        job_type: 'morning_reflection',
        scheduled_for: new Date(),
      };

      (supabase.single as Mock).mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });

      await expect(service.createJob(input)).rejects.toThrow('Failed to create agent job');
    });
  });

  describe('getJobById', () => {
    it('should retrieve a job by ID', async () => {
      (supabase.single as Mock).mockResolvedValue({
        data: mockJob,
        error: null,
      });

      const result = await service.getJobById('test-job-id');

      expect(result).toBeDefined();
      expect(result?.id).toBe('test-job-id');
      expect(supabase.from).toHaveBeenCalledWith('agent_jobs');
      expect(supabase.eq).toHaveBeenCalledWith('id', 'test-job-id');
    });

    it('should return null if job not found', async () => {
      (supabase.single as Mock).mockResolvedValue({
        data: null,
        error: { code: 'PGRST116' },
      });

      const result = await service.getJobById('nonexistent-id');

      expect(result).toBeNull();
    });
  });

  describe('updateJob', () => {
    it('should update a job successfully', async () => {
      const input: UpdateAgentJobInput = {
        status: 'running',
        started_at: new Date(),
      };

      (supabase.single as Mock).mockResolvedValue({
        data: { ...mockJob, status: 'running' },
        error: null,
      });

      const result = await service.updateJob('test-job-id', input);

      expect(result).toBeDefined();
      expect(result.status).toBe('running');
      expect(supabase.from).toHaveBeenCalledWith('agent_jobs');
      expect(supabase.update).toHaveBeenCalled();
    });
  });

  describe('listJobs', () => {
    it('should list jobs with filters', async () => {
      const mockJobs = [mockJob, { ...mockJob, id: 'test-job-id-2' }];

      (supabase.from as Mock).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({
          data: mockJobs,
          error: null,
        }),
      });

      const result = await service.listJobs({
        user_id: 'test-user-id',
        limit: 50,
        offset: 0,
      });

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('test-job-id');
    });
  });

  describe('getDueJobs', () => {
    it('should retrieve jobs that are due to run', async () => {
      const mockDueJobs = [mockJob];

      (supabase.from as Mock).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: mockDueJobs,
          error: null,
        }),
      });

      const result = await service.getDueJobs();

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('pending');
    });
  });

  describe('markJobAsStarted', () => {
    it('should mark a job as started', async () => {
      (supabase.single as Mock).mockResolvedValue({
        data: { ...mockJob, status: 'running', started_at: new Date().toISOString() },
        error: null,
      });

      const result = await service.markJobAsStarted('test-job-id');

      expect(result.status).toBe('running');
      expect(result.started_at).toBeDefined();
    });
  });

  describe('markJobAsCompleted', () => {
    it('should mark a job as completed with results', async () => {
      (supabase.single as Mock).mockResolvedValue({
        data: {
          ...mockJob,
          status: 'completed',
          thoughts_generated: 3,
          research_tasks_created: 1,
          completed_at: new Date().toISOString(),
        },
        error: null,
      });

      const result = await service.markJobAsCompleted('test-job-id', 3, 1);

      expect(result.status).toBe('completed');
      expect(result.thoughts_generated).toBe(3);
      expect(result.research_tasks_created).toBe(1);
      expect(result.completed_at).toBeDefined();
    });
  });

  describe('markJobAsFailed', () => {
    it('should mark a job as failed with error message', async () => {
      (supabase.single as Mock).mockResolvedValue({
        data: {
          ...mockJob,
          status: 'failed',
          error_message: 'Test error',
          completed_at: new Date().toISOString(),
        },
        error: null,
      });

      const result = await service.markJobAsFailed('test-job-id', 'Test error');

      expect(result.status).toBe('failed');
      expect(result.error_message).toBe('Test error');
      expect(result.completed_at).toBeDefined();
    });
  });

  describe('scheduleCircadianJobs', () => {
    const originalAutonomous = process.env.ENABLE_AUTONOMOUS_AGENTS;
    const originalSelfReview = process.env.ENABLE_SELF_REVIEW;

    afterEach(() => {
      if (originalAutonomous === undefined) delete process.env.ENABLE_AUTONOMOUS_AGENTS;
      else process.env.ENABLE_AUTONOMOUS_AGENTS = originalAutonomous;
      if (originalSelfReview === undefined) delete process.env.ENABLE_SELF_REVIEW;
      else process.env.ENABLE_SELF_REVIEW = originalSelfReview;
    });

    it('should schedule all circadian jobs for a user when autonomous agents are enabled', async () => {
      process.env.ENABLE_AUTONOMOUS_AGENTS = 'true';
      (supabase.single as Mock).mockResolvedValue({
        data: mockJob,
        error: null,
      });

      // Fixed non-Thursday date — Thursdays additionally schedule self_review
      const monday = new Date('2026-06-08T12:00:00-05:00');
      const result = await service.scheduleCircadianJobs('test-user-id', monday);

      expect(result).toHaveLength(5); // morning, midday, afternoon, evening, night
      expect(supabase.insert).toHaveBeenCalledTimes(5);
    });

    it('should schedule nothing when all server-level flags are off', async () => {
      delete process.env.ENABLE_AUTONOMOUS_AGENTS;
      delete process.env.ENABLE_SELF_REVIEW;

      const monday = new Date('2026-06-08T12:00:00-05:00');
      const result = await service.scheduleCircadianJobs('test-user-id', monday);

      expect(result).toHaveLength(0);
      expect(supabase.insert).not.toHaveBeenCalled();
    });

    it('should schedule only self_review on Thursdays when only ENABLE_SELF_REVIEW is on', async () => {
      delete process.env.ENABLE_AUTONOMOUS_AGENTS;
      process.env.ENABLE_SELF_REVIEW = 'true';
      (supabase.single as Mock).mockResolvedValue({
        data: { ...mockJob, job_type: 'self_review' },
        error: null,
      });

      const thursday = new Date('2026-06-11T12:00:00-05:00');
      const result = await service.scheduleCircadianJobs('test-user-id', thursday);

      expect(result).toHaveLength(1);
      expect(supabase.insert).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteJob', () => {
    it('should delete a job successfully', async () => {
      (supabase.delete as Mock).mockReturnValue({
        eq: vi.fn().mockResolvedValue({
          error: null,
        }),
      });

      await expect(service.deleteJob('test-job-id')).resolves.not.toThrow();
      expect(supabase.from).toHaveBeenCalledWith('agent_jobs');
      expect(supabase.delete).toHaveBeenCalled();
    });
  });
});

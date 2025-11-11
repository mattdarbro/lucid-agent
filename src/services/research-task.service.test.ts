import { Pool } from 'pg';
import { SupabaseClient } from '@supabase/supabase-js';
import { ResearchTaskService } from './research-task.service';
import { CreateResearchTaskInput } from '../validation/research-task.validation';

describe('ResearchTaskService', () => {
  let pool: Pool;
  let supabase: SupabaseClient;
  let service: ResearchTaskService;

  const mockTask = {
    id: 'test-task-id',
    user_id: 'test-user-id',
    emotional_state_id: 'test-state-id',
    query: 'Research about AI',
    purpose: 'To understand better',
    approach: 'exploratory',
    priority: 7,
    status: 'pending',
    results: null,
    derived_facts: null,
    created_at: new Date().toISOString(),
    started_at: null,
    completed_at: null,
  };

  beforeEach(() => {
    // Create mock pool
    pool = {} as Pool;

    // Create mock Supabase client
    supabase = {
      from: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      gte: jest.fn().mockReturnThis(),
      lte: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      range: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      single: jest.fn(),
    } as any;

    service = new ResearchTaskService(pool, supabase);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createTask', () => {
    it('should create a new research task successfully', async () => {
      const input: CreateResearchTaskInput = {
        user_id: 'test-user-id',
        emotional_state_id: 'test-state-id',
        query: 'Research about AI',
        purpose: 'To understand better',
        approach: 'exploratory',
        priority: 7,
      };

      (supabase.single as jest.Mock).mockResolvedValue({
        data: mockTask,
        error: null,
      });

      const result = await service.createTask(input);

      expect(result).toBeDefined();
      expect(result.id).toBe('test-task-id');
      expect(result.query).toBe('Research about AI');
      expect(result.approach).toBe('exploratory');
      expect(supabase.from).toHaveBeenCalledWith('research_tasks');
      expect(supabase.insert).toHaveBeenCalled();
    });

    it('should use default values when not provided', async () => {
      const input: CreateResearchTaskInput = {
        user_id: 'test-user-id',
        query: 'Simple query',
      };

      (supabase.single as jest.Mock).mockResolvedValue({
        data: { ...mockTask, approach: 'exploratory', priority: 5 },
        error: null,
      });

      const result = await service.createTask(input);

      expect(result).toBeDefined();
      expect(supabase.insert).toHaveBeenCalled();
    });
  });

  describe('getTaskById', () => {
    it('should retrieve a task by ID', async () => {
      (supabase.single as jest.Mock).mockResolvedValue({
        data: mockTask,
        error: null,
      });

      const result = await service.getTaskById('test-task-id');

      expect(result).toBeDefined();
      expect(result?.id).toBe('test-task-id');
      expect(supabase.from).toHaveBeenCalledWith('research_tasks');
      expect(supabase.eq).toHaveBeenCalledWith('id', 'test-task-id');
    });

    it('should return null if task not found', async () => {
      (supabase.single as jest.Mock).mockResolvedValue({
        data: null,
        error: { code: 'PGRST116' },
      });

      const result = await service.getTaskById('nonexistent-id');

      expect(result).toBeNull();
    });
  });

  describe('updateTask', () => {
    it('should update a task successfully', async () => {
      (supabase.single as jest.Mock).mockResolvedValue({
        data: { ...mockTask, status: 'in_progress' },
        error: null,
      });

      const result = await service.updateTask('test-task-id', {
        status: 'in_progress',
      });

      expect(result).toBeDefined();
      expect(result.status).toBe('in_progress');
    });
  });

  describe('listTasks', () => {
    it('should list tasks with filters', async () => {
      const mockTasks = [mockTask, { ...mockTask, id: 'test-task-id-2' }];

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        lte: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        range: jest.fn().mockResolvedValue({
          data: mockTasks,
          error: null,
        }),
      });

      const result = await service.listTasks({
        user_id: 'test-user-id',
        status: 'pending',
        limit: 50,
        offset: 0,
      });

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('test-task-id');
    });
  });

  describe('getPendingTasks', () => {
    it('should retrieve pending tasks ordered by priority', async () => {
      const mockTasks = [mockTask];

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({
          data: mockTasks,
          error: null,
        }),
      });

      const result = await service.getPendingTasks('test-user-id', 10);

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('pending');
    });

    it('should retrieve pending tasks for all users when no userId provided', async () => {
      const mockTasks = [mockTask];

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({
          data: mockTasks,
          error: null,
        }),
      });

      const result = await service.getPendingTasks(undefined, 10);

      expect(result).toBeDefined();
    });
  });

  describe('markTaskAsStarted', () => {
    it('should mark a task as started', async () => {
      (supabase.single as jest.Mock).mockResolvedValue({
        data: { ...mockTask, status: 'in_progress', started_at: new Date().toISOString() },
        error: null,
      });

      const result = await service.markTaskAsStarted('test-task-id');

      expect(result.status).toBe('in_progress');
      expect(result.started_at).toBeDefined();
    });
  });

  describe('markTaskAsCompleted', () => {
    it('should mark a task as completed with results', async () => {
      const results = { findings: ['Finding 1', 'Finding 2'] };
      const derivedFacts = ['Fact 1', 'Fact 2'];

      (supabase.single as jest.Mock).mockResolvedValue({
        data: {
          ...mockTask,
          status: 'completed',
          results,
          derived_facts: derivedFacts,
          completed_at: new Date().toISOString(),
        },
        error: null,
      });

      const result = await service.markTaskAsCompleted('test-task-id', results, derivedFacts);

      expect(result.status).toBe('completed');
      expect(result.results).toEqual(results);
      expect(result.derived_facts).toEqual(derivedFacts);
      expect(result.completed_at).toBeDefined();
    });
  });

  describe('markTaskAsFailed', () => {
    it('should mark a task as failed with error results', async () => {
      const errorResults = { error: 'Network error' };

      (supabase.single as jest.Mock).mockResolvedValue({
        data: {
          ...mockTask,
          status: 'failed',
          results: errorResults,
          completed_at: new Date().toISOString(),
        },
        error: null,
      });

      const result = await service.markTaskAsFailed('test-task-id', errorResults);

      expect(result.status).toBe('failed');
      expect(result.results).toEqual(errorResults);
      expect(result.completed_at).toBeDefined();
    });
  });

  describe('getTasksByEmotionalStateId', () => {
    it('should retrieve tasks by emotional state ID', async () => {
      const mockTasks = [mockTask];

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({
          data: mockTasks,
          error: null,
        }),
      });

      const result = await service.getTasksByEmotionalStateId('test-state-id');

      expect(result).toHaveLength(1);
      expect(result[0].emotional_state_id).toBe('test-state-id');
    });
  });

  describe('deleteTask', () => {
    it('should delete a task successfully', async () => {
      (supabase.delete as jest.Mock).mockReturnValue({
        eq: jest.fn().mockResolvedValue({
          error: null,
        }),
      });

      await expect(service.deleteTask('test-task-id')).resolves.not.toThrow();
      expect(supabase.from).toHaveBeenCalledWith('research_tasks');
      expect(supabase.delete).toHaveBeenCalled();
    });
  });
});

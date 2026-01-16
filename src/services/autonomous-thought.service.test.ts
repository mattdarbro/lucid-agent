import { Pool } from 'pg';
import { SupabaseClient } from '@supabase/supabase-js';
import { AutonomousThoughtService } from './autonomous-thought.service';
import { CreateAutonomousThoughtInput } from '../validation/autonomous-thought.validation';

// Mock the VectorService
jest.mock('./vector.service', () => ({
  VectorService: jest.fn().mockImplementation(() => ({
    generateEmbedding: jest.fn().mockResolvedValue(new Array(1536).fill(0.1)),
  })),
}));

describe('AutonomousThoughtService', () => {
  let pool: Pool;
  let supabase: SupabaseClient;
  let service: AutonomousThoughtService;

  const mockThought = {
    id: 'test-thought-id',
    user_id: 'test-user-id',
    agent_job_id: 'test-job-id',
    content: 'This is a test thought',
    thought_type: 'reflection',
    circadian_phase: 'morning',
    generated_at_time: '07:30:00',
    importance_score: 0.8,
    is_shared: false,
    shared_at: null,
    embedding: JSON.stringify(new Array(1536).fill(0.1)),
    created_at: new Date().toISOString(),
  };

  beforeEach(() => {
    // Create mock pool with query method
    pool = {
      connect: jest.fn().mockResolvedValue({
        query: jest.fn().mockResolvedValue({ rows: [mockThought] }),
        release: jest.fn(),
      }),
    } as any;

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

    service = new AutonomousThoughtService(pool, supabase);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createThought', () => {
    it('should create a new autonomous thought successfully', async () => {
      const input: CreateAutonomousThoughtInput = {
        user_id: 'test-user-id',
        agent_job_id: 'test-job-id',
        content: 'This is a test thought',
        thought_type: 'reflection',
        circadian_phase: 'morning',
        importance_score: 0.8,
      };

      (supabase.single as jest.Mock).mockResolvedValue({
        data: mockThought,
        error: null,
      });

      const result = await service.createThought(input);

      expect(result).toBeDefined();
      expect(result.id).toBe('test-thought-id');
      expect(result.content).toBe('This is a test thought');
      expect(result.thought_type).toBe('reflection');
      expect(supabase.from).toHaveBeenCalledWith('autonomous_thoughts');
      expect(supabase.insert).toHaveBeenCalled();
    });

    it('should create thought even if embedding generation fails', async () => {
      const input: CreateAutonomousThoughtInput = {
        user_id: 'test-user-id',
        content: 'Test thought',
        thought_type: 'curiosity',
      };

      // Mock embedding failure
      const mockVectorService = require('./vector.service').VectorService;
      mockVectorService.mockImplementationOnce(() => ({
        generateEmbedding: jest.fn().mockRejectedValue(new Error('Embedding failed')),
      }));

      (supabase.single as jest.Mock).mockResolvedValue({
        data: { ...mockThought, embedding: null },
        error: null,
      });

      const result = await service.createThought(input);

      expect(result).toBeDefined();
      expect(supabase.insert).toHaveBeenCalled();
    });
  });

  describe('getThoughtById', () => {
    it('should retrieve a thought by ID', async () => {
      (supabase.single as jest.Mock).mockResolvedValue({
        data: mockThought,
        error: null,
      });

      const result = await service.getThoughtById('test-thought-id');

      expect(result).toBeDefined();
      expect(result?.id).toBe('test-thought-id');
      expect(supabase.from).toHaveBeenCalledWith('autonomous_thoughts');
      expect(supabase.eq).toHaveBeenCalledWith('id', 'test-thought-id');
    });

    it('should return null if thought not found', async () => {
      (supabase.single as jest.Mock).mockResolvedValue({
        data: null,
        error: { code: 'PGRST116' },
      });

      const result = await service.getThoughtById('nonexistent-id');

      expect(result).toBeNull();
    });
  });

  describe('updateThought', () => {
    it('should update a thought successfully', async () => {
      (supabase.single as jest.Mock).mockResolvedValue({
        data: { ...mockThought, is_shared: true, shared_at: new Date().toISOString() },
        error: null,
      });

      const result = await service.updateThought('test-thought-id', {
        is_shared: true,
        shared_at: new Date(),
      });

      expect(result).toBeDefined();
      expect(result.is_shared).toBe(true);
      expect(result.shared_at).toBeDefined();
    });
  });

  describe('listThoughts', () => {
    it('should list thoughts with filters', async () => {
      const mockThoughts = [mockThought, { ...mockThought, id: 'test-thought-id-2' }];

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        lte: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        range: jest.fn().mockResolvedValue({
          data: mockThoughts,
          error: null,
        }),
      });

      const result = await service.listThoughts({
        user_id: 'test-user-id',
        thought_type: 'reflection',
        limit: 50,
        offset: 0,
      });

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('test-thought-id');
    });
  });

  describe('searchThoughts', () => {
    it('should search thoughts by semantic similarity', async () => {
      const result = await service.searchThoughts({
        user_id: 'test-user-id',
        query: 'test query',
        limit: 10,
        min_similarity: 0.7,
      });

      expect(result).toBeDefined();
      expect(pool.connect).toHaveBeenCalled();
    });
  });

  describe('shareThought', () => {
    it('should mark a thought as shared', async () => {
      (supabase.single as jest.Mock).mockResolvedValue({
        data: { ...mockThought, is_shared: true, shared_at: new Date().toISOString() },
        error: null,
      });

      const result = await service.shareThought('test-thought-id');

      expect(result.is_shared).toBe(true);
      expect(result.shared_at).toBeDefined();
    });
  });

  describe('getThoughtsByJobId', () => {
    it('should retrieve thoughts by agent job ID', async () => {
      const mockThoughts = [mockThought];

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({
          data: mockThoughts,
          error: null,
        }),
      });

      const result = await service.getThoughtsByJobId('test-job-id');

      expect(result).toHaveLength(1);
      expect(result[0].agent_job_id).toBe('test-job-id');
    });
  });

  describe('getRecentUnsharedThoughts', () => {
    it('should retrieve recent unshared thoughts', async () => {
      const mockThoughts = [mockThought];

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({
          data: mockThoughts,
          error: null,
        }),
      });

      const result = await service.getRecentUnsharedThoughts('test-user-id', 10);

      expect(result).toHaveLength(1);
      expect(result[0].is_shared).toBe(false);
    });
  });

  describe('deleteThought', () => {
    it('should delete a thought successfully', async () => {
      (supabase.delete as jest.Mock).mockReturnValue({
        eq: jest.fn().mockResolvedValue({
          error: null,
        }),
      });

      await expect(service.deleteThought('test-thought-id')).resolves.not.toThrow();
      expect(supabase.from).toHaveBeenCalledWith('autonomous_thoughts');
      expect(supabase.delete).toHaveBeenCalled();
    });
  });
});

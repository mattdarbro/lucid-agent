import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FactService } from './fact.service';
import { VectorService } from './vector.service';
import { Pool } from 'pg';
import { createMockFact, createMockUser, clearAllMocks } from '../test/setup';

/**
 * Unit tests for FactService
 */

const mockPool = {
  query: vi.fn(),
} as unknown as Pool;

const mockVectorService = {
  generateEmbedding: vi.fn(),
  generateEmbeddings: vi.fn(),
} as unknown as VectorService;

// Mock Anthropic client
const mockAnthropicCreate = vi.fn();
const mockAnthropic = {
  messages: {
    create: mockAnthropicCreate,
  },
};

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: mockAnthropicCreate,
    };
    constructor() {
      return mockAnthropic as any;
    }
  },
}));

describe('FactService', () => {
  let factService: FactService;

  beforeEach(() => {
    clearAllMocks();
    factService = new FactService(mockPool, mockVectorService, 'test-key');
  });

  describe('extractFactsFromMessages', () => {
    it('should extract facts using LLM', async () => {
      const messages = ['I live in San Francisco', 'I love pizza'];

      mockAnthropicCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: JSON.stringify([
              {
                content: 'User lives in San Francisco',
                category: 'personal',
                confidence: 0.95,
              },
              {
                content: 'User loves pizza',
                category: 'preference',
                confidence: 0.9,
              },
            ]),
          },
        ],
      });

      const facts = await factService.extractFactsFromMessages(
        messages,
        'user-123'
      );

      expect(facts).toHaveLength(2);
      expect(facts[0].content).toBe('User lives in San Francisco');
      expect(facts[0].category).toBe('personal');
      expect(facts[0].confidence).toBe(0.95);
      expect(facts[1].content).toBe('User loves pizza');
      expect(mockAnthropicCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-3-5-haiku-20241022',
          temperature: 0.2,
        })
      );
    });

    it('should handle LLM returning JSON in markdown code blocks', async () => {
      const messages = ['I enjoy hiking'];

      mockAnthropicCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: '```json\n[{"content":"User enjoys hiking","category":"habit","confidence":0.85}]\n```',
          },
        ],
      });

      const facts = await factService.extractFactsFromMessages(
        messages,
        'user-123'
      );

      expect(facts).toHaveLength(1);
      expect(facts[0].content).toBe('User enjoys hiking');
    });

    it('should return empty array when no facts extracted', async () => {
      const messages = ['Hello!'];

      mockAnthropicCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: '[]',
          },
        ],
      });

      const facts = await factService.extractFactsFromMessages(
        messages,
        'user-123'
      );

      expect(facts).toEqual([]);
    });

    it('should throw error on LLM failure', async () => {
      const messages = ['Test'];

      mockAnthropicCreate.mockRejectedValueOnce(new Error('API error'));

      await expect(
        factService.extractFactsFromMessages(messages, 'user-123')
      ).rejects.toThrow('Failed to extract facts');
    });
  });

  describe('createFact', () => {
    it('should create a fact with embedding', async () => {
      const input = {
        user_id: '123e4567-e89b-12d3-a456-426614174000',
        content: 'User likes coffee',
        category: 'preference' as const,
        confidence: 0.8,
      };

      const mockEmbedding = new Array(1536).fill(0.1);
      const mockFact = createMockFact(input);

      // Mock user check
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [{ id: input.user_id }],
        rowCount: 1,
      } as any);

      // Mock embedding generation
      vi.mocked(mockVectorService.generateEmbedding).mockResolvedValueOnce(
        mockEmbedding
      );

      // Mock fact creation
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockFact],
        rowCount: 1,
      } as any);

      const result = await factService.createFact(input);

      expect(result).toEqual(mockFact);
      expect(mockVectorService.generateEmbedding).toHaveBeenCalledWith(
        input.content
      );
      expect(mockPool.query).toHaveBeenCalledTimes(2);
    });

    it('should create fact without embedding when skipped', async () => {
      const input = {
        user_id: '123e4567-e89b-12d3-a456-426614174000',
        content: 'User likes coffee',
        skip_embedding: true,
      };

      const mockFact = createMockFact({ ...input, embedding: null });

      // Mock user check
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [{ id: input.user_id }],
        rowCount: 1,
      } as any);

      // Mock fact creation
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockFact],
        rowCount: 1,
      } as any);

      const result = await factService.createFact(input);

      expect(result).toEqual(mockFact);
      expect(mockVectorService.generateEmbedding).not.toHaveBeenCalled();
    });

    it('should throw error when user not found', async () => {
      const input = {
        user_id: '123e4567-e89b-12d3-a456-426614174000',
        content: 'Test fact',
      };

      // Mock user check - user not found
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await expect(factService.createFact(input)).rejects.toThrow(
        'User not found'
      );
    });

    it('should continue if embedding fails', async () => {
      const input = {
        user_id: '123e4567-e89b-12d3-a456-426614174000',
        content: 'Test fact',
      };

      const mockFact = createMockFact({ ...input, embedding: null });

      // Mock user check
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [{ id: input.user_id }],
        rowCount: 1,
      } as any);

      // Mock embedding failure
      vi.mocked(mockVectorService.generateEmbedding).mockRejectedValueOnce(
        new Error('Embedding failed')
      );

      // Mock fact creation
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockFact],
        rowCount: 1,
      } as any);

      const result = await factService.createFact(input);

      expect(result).toEqual(mockFact);
      expect(result.embedding).toBeNull();
    });
  });

  describe('findById', () => {
    it('should find fact by ID', async () => {
      const mockFact = createMockFact();

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockFact],
        rowCount: 1,
      } as any);

      const result = await factService.findById(mockFact.id);

      expect(result).toEqual(mockFact);
      expect(mockPool.query).toHaveBeenCalledWith(
        'SELECT * FROM facts WHERE id = $1',
        [mockFact.id]
      );
    });

    it('should return null when fact not found', async () => {
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await factService.findById('non-existent-id');

      expect(result).toBeNull();
    });
  });

  describe('listByUser', () => {
    it('should list facts for user', async () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';
      const mockFacts = [
        createMockFact({ user_id: userId }),
        createMockFact({ user_id: userId, id: 'fact2' }),
      ];

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: mockFacts,
        rowCount: 2,
      } as any);

      const result = await factService.listByUser(userId);

      expect(result).toHaveLength(2);
      expect(result[0].user_id).toBe(userId);
    });

    it('should filter by category', async () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await factService.listByUser(userId, { category: 'preference' });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('category'),
        expect.arrayContaining([userId, 'preference'])
      );
    });

    it('should filter by active status', async () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await factService.listByUser(userId, { is_active: true });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('is_active'),
        expect.arrayContaining([userId, true])
      );
    });

    it('should filter by minimum confidence', async () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await factService.listByUser(userId, { min_confidence: 0.7 });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('confidence >='),
        expect.arrayContaining([userId, 0.7])
      );
    });
  });

  describe('updateFact', () => {
    it('should update fact', async () => {
      const factId = 'fact-123';
      const updates = {
        content: 'Updated content',
        confidence: 0.95,
      };

      const mockFact = createMockFact({ id: factId, ...updates });

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockFact],
        rowCount: 1,
      } as any);

      const result = await factService.updateFact(factId, updates);

      expect(result).toEqual(mockFact);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE facts'),
        expect.any(Array)
      );
    });

    it('should return null when fact not found', async () => {
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await factService.updateFact('non-existent', {
        confidence: 0.9,
      });

      expect(result).toBeNull();
    });
  });

  describe('deleteFact', () => {
    it('should delete fact', async () => {
      const factId = 'fact-123';

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rowCount: 1,
      } as any);

      const result = await factService.deleteFact(factId);

      expect(result).toBe(true);
      expect(mockPool.query).toHaveBeenCalledWith(
        'DELETE FROM facts WHERE id = $1',
        [factId]
      );
    });

    it('should return false when fact not found', async () => {
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rowCount: 0,
      } as any);

      const result = await factService.deleteFact('non-existent');

      expect(result).toBe(false);
    });
  });

  describe('semanticSearch', () => {
    it('should perform semantic search', async () => {
      const query = 'food preferences';
      const mockEmbedding = new Array(1536).fill(0.1);
      const mockResults = [
        { ...createMockFact({ content: 'User likes pizza' }), similarity: 0.92 },
      ];

      vi.mocked(mockVectorService.generateEmbedding).mockResolvedValueOnce(
        mockEmbedding
      );

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: mockResults,
        rowCount: 1,
      } as any);

      const results = await factService.semanticSearch(query);

      expect(results).toHaveLength(1);
      expect(results[0].similarity).toBe(0.92);
      expect(mockVectorService.generateEmbedding).toHaveBeenCalledWith(query);
    });

    it('should filter by user_id', async () => {
      const query = 'test';
      const userId = 'user-123';
      const mockEmbedding = new Array(1536).fill(0.1);

      vi.mocked(mockVectorService.generateEmbedding).mockResolvedValueOnce(
        mockEmbedding
      );

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await factService.semanticSearch(query, { user_id: userId });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('user_id'),
        expect.any(Array)
      );
    });
  });

  describe('getCountByUser', () => {
    it('should get fact count for user', async () => {
      const userId = 'user-123';

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [{ count: '5' }],
        rowCount: 1,
      } as any);

      const count = await factService.getCountByUser(userId);

      expect(count).toBe(5);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('COUNT'),
        [userId]
      );
    });

    it('should filter by active status when counting', async () => {
      const userId = 'user-123';

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [{ count: '3' }],
        rowCount: 1,
      } as any);

      await factService.getCountByUser(userId, true);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('is_active'),
        [userId, true]
      );
    });
  });
});

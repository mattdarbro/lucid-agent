import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SummaryService } from './summary.service';
import { Pool } from 'pg';
import { VectorService } from './vector.service';
import { clearAllMocks } from '../test/setup';

const mockPool = {
  query: vi.fn(),
} as unknown as Pool;

const mockVectorService = {
  generateEmbedding: vi.fn(),
  generateEmbeddings: vi.fn(),
} as unknown as VectorService;

// Mock Anthropic
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

function createMockSummary(overrides: Partial<any> = {}) {
  return {
    id: '123e4567-e89b-12d3-a456-426614174020',
    conversation_id: '123e4567-e89b-12d3-a456-426614174001',
    user_id: '123e4567-e89b-12d3-a456-426614174000',
    user_perspective: 'User asked about pizza',
    model_perspective: 'User seems interested in food preferences',
    conversation_overview: 'Discussed pizza preferences',
    user_embedding: null,
    model_embedding: null,
    overview_embedding: null,
    message_count: 5,
    created_at: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('SummaryService', () => {
  let summaryService: SummaryService;

  beforeEach(() => {
    clearAllMocks();
    summaryService = new SummaryService(mockPool, mockVectorService);
  });

  describe('generateSummary', () => {
    it('should generate summary using LLM and create it', async () => {
      const input = {
        conversation_id: '123e4567-e89b-12d3-a456-426614174001',
        user_id: '123e4567-e89b-12d3-a456-426614174000',
        message_count: 10,
      };

      // Mock message fetch
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [
          { id: 'msg1', role: 'user', content: 'I love pizza', conversation_id: input.conversation_id },
          { id: 'msg2', role: 'assistant', content: 'What kind of pizza do you like?', conversation_id: input.conversation_id },
        ],
        rowCount: 2,
      } as any);

      // Mock LLM response
      mockAnthropicCreate.mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: JSON.stringify({
            user_perspective: 'User discussed their love for pizza',
            model_perspective: 'User is interested in food preferences',
            conversation_overview: 'Conversation about pizza preferences',
          }),
        }],
      });

      // Mock embeddings
      vi.mocked(mockVectorService.generateEmbedding)
        .mockResolvedValueOnce(new Array(1536).fill(0.1))
        .mockResolvedValueOnce(new Array(1536).fill(0.2))
        .mockResolvedValueOnce(new Array(1536).fill(0.3));

      // Mock summary creation
      const mockSummary = createMockSummary({
        user_perspective: 'User discussed their love for pizza',
        model_perspective: 'User is interested in food preferences',
        conversation_overview: 'Conversation about pizza preferences',
        message_count: 2,
      });

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockSummary],
        rowCount: 1,
      } as any);

      const result = await summaryService.generateSummary(input);

      expect(result.user_perspective).toBe('User discussed their love for pizza');
      expect(result.message_count).toBe(2);
      expect(mockAnthropicCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-3-5-haiku-20241022',
          temperature: 0.3,
        })
      );
    });

    it('should handle LLM response in markdown code block', async () => {
      const input = {
        conversation_id: '123e4567-e89b-12d3-a456-426614174001',
        user_id: '123e4567-e89b-12d3-a456-426614174000',
      };

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [{ id: 'msg1', role: 'user', content: 'Hello', conversation_id: input.conversation_id }],
        rowCount: 1,
      } as any);

      mockAnthropicCreate.mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: '```json\n{"user_perspective":"Test","model_perspective":"Test","conversation_overview":"Test"}\n```',
        }],
      });

      vi.mocked(mockVectorService.generateEmbedding)
        .mockResolvedValue(new Array(1536).fill(0.1));

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [createMockSummary()],
        rowCount: 1,
      } as any);

      const result = await summaryService.generateSummary(input);
      expect(result).toBeDefined();
    });

    it('should throw error when no messages found', async () => {
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await expect(summaryService.generateSummary({
        conversation_id: '123e4567-e89b-12d3-a456-426614174001',
        user_id: '123e4567-e89b-12d3-a456-426614174000',
      })).rejects.toThrow('No messages found');
    });
  });

  describe('createSummary', () => {
    it('should create summary with all perspectives and embeddings', async () => {
      const input = {
        conversation_id: '123e4567-e89b-12d3-a456-426614174001',
        user_id: '123e4567-e89b-12d3-a456-426614174000',
        user_perspective: 'User perspective',
        model_perspective: 'Model perspective',
        conversation_overview: 'Overview',
        message_count: 5,
      };

      vi.mocked(mockVectorService.generateEmbedding)
        .mockResolvedValueOnce(new Array(1536).fill(0.1))
        .mockResolvedValueOnce(new Array(1536).fill(0.2))
        .mockResolvedValueOnce(new Array(1536).fill(0.3));

      const mockSummary = createMockSummary(input);
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockSummary],
        rowCount: 1,
      } as any);

      const result = await summaryService.createSummary(input);

      expect(result).toEqual(mockSummary);
      expect(mockVectorService.generateEmbedding).toHaveBeenCalledTimes(3);
    });

    it('should create summary without embeddings when skip_embeddings is true', async () => {
      const input = {
        conversation_id: '123e4567-e89b-12d3-a456-426614174001',
        user_id: '123e4567-e89b-12d3-a456-426614174000',
        user_perspective: 'Test',
        skip_embeddings: true,
      };

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [createMockSummary(input)],
        rowCount: 1,
      } as any);

      const result = await summaryService.createSummary(input);

      expect(result).toBeDefined();
      expect(mockVectorService.generateEmbedding).not.toHaveBeenCalled();
    });

    it('should gracefully handle embedding failures', async () => {
      const input = {
        conversation_id: '123e4567-e89b-12d3-a456-426614174001',
        user_id: '123e4567-e89b-12d3-a456-426614174000',
        user_perspective: 'Test',
      };

      vi.mocked(mockVectorService.generateEmbedding)
        .mockRejectedValue(new Error('Embedding failed'));

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [createMockSummary(input)],
        rowCount: 1,
      } as any);

      const result = await summaryService.createSummary(input);
      expect(result).toBeDefined();
    });
  });

  describe('findById', () => {
    it('should find summary by ID', async () => {
      const mockSummary = createMockSummary();

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockSummary],
        rowCount: 1,
      } as any);

      const result = await summaryService.findById(mockSummary.id);

      expect(result).toEqual(mockSummary);
      expect(mockPool.query).toHaveBeenCalledWith(
        'SELECT * FROM summaries WHERE id = $1',
        [mockSummary.id]
      );
    });

    it('should return null when summary not found', async () => {
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await summaryService.findById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('listByConversation', () => {
    it('should list summaries for conversation', async () => {
      const conversationId = '123e4567-e89b-12d3-a456-426614174001';
      const mockSummaries = [createMockSummary(), createMockSummary({ id: 'summary2' })];

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: mockSummaries,
        rowCount: 2,
      } as any);

      const result = await summaryService.listByConversation(conversationId);

      expect(result).toHaveLength(2);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('conversation_id'),
        [conversationId, 50, 0]
      );
    });

    it('should apply limit and offset', async () => {
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await summaryService.listByConversation('conv-id', { limit: 10, offset: 5 });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        ['conv-id', 10, 5]
      );
    });
  });

  describe('listByUser', () => {
    it('should list summaries for user', async () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';
      const mockSummaries = [createMockSummary()];

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: mockSummaries,
        rowCount: 1,
      } as any);

      const result = await summaryService.listByUser(userId);

      expect(result).toHaveLength(1);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('user_id'),
        [userId, 50, 0]
      );
    });
  });

  describe('semanticSearch', () => {
    it('should perform semantic search on summaries', async () => {
      const query = 'pizza preferences';

      vi.mocked(mockVectorService.generateEmbedding)
        .mockResolvedValueOnce(new Array(1536).fill(0.5));

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [{ ...createMockSummary(), similarity: 0.95 }],
        rowCount: 1,
      } as any);

      const results = await summaryService.semanticSearch(query);

      expect(results).toHaveLength(1);
      expect(results[0].similarity).toBe(0.95);
      expect(mockVectorService.generateEmbedding).toHaveBeenCalledWith(query);
    });

    it('should search specific perspective', async () => {
      vi.mocked(mockVectorService.generateEmbedding)
        .mockResolvedValueOnce(new Array(1536).fill(0.5));

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await summaryService.semanticSearch('query', { perspective: 'user' });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('user_embedding'),
        expect.any(Array)
      );
    });

    it('should filter by user_id and conversation_id', async () => {
      vi.mocked(mockVectorService.generateEmbedding)
        .mockResolvedValueOnce(new Array(1536).fill(0.5));

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await summaryService.semanticSearch('query', {
        user_id: 'user-123',
        conversation_id: 'conv-123',
      });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('user_id'),
        expect.arrayContaining(['user-123', 'conv-123'])
      );
    });
  });

  describe('deleteSummary', () => {
    it('should delete summary', async () => {
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rowCount: 1,
      } as any);

      const result = await summaryService.deleteSummary('summary-123');

      expect(result).toBe(true);
      expect(mockPool.query).toHaveBeenCalledWith(
        'DELETE FROM summaries WHERE id = $1',
        ['summary-123']
      );
    });

    it('should return false when summary not found', async () => {
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rowCount: 0,
      } as any);

      const result = await summaryService.deleteSummary('non-existent');

      expect(result).toBe(false);
    });
  });
});

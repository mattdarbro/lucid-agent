import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageService } from './message.service';
import { VectorService } from './vector.service';
import { Pool } from 'pg';
import { createMockMessage, clearAllMocks } from '../test/setup';

/**
 * Unit tests for MessageService
 */

const mockPool = {
  query: vi.fn(),
} as unknown as Pool;

const mockVectorService = {
  generateEmbedding: vi.fn(),
  generateEmbeddings: vi.fn(),
  cosineSimilarity: vi.fn(),
} as unknown as VectorService;

describe('MessageService', () => {
  let messageService: MessageService;

  beforeEach(() => {
    clearAllMocks();
    messageService = new MessageService(mockPool, mockVectorService);
  });

  describe('createMessage', () => {
    it('should create a message with embedding', async () => {
      const input = {
        conversation_id: '123e4567-e89b-12d3-a456-426614174001',
        user_id: '123e4567-e89b-12d3-a456-426614174000',
        role: 'user' as const,
        content: 'Hello, world!',
      };

      const mockEmbedding = new Array(1536).fill(0.1);
      const mockMessage = createMockMessage(input);

      // Mock conversation check
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [{ id: input.conversation_id }],
        rowCount: 1,
      } as any);

      // Mock embedding generation
      vi.mocked(mockVectorService.generateEmbedding).mockResolvedValueOnce(mockEmbedding);

      // Mock message creation
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockMessage],
        rowCount: 1,
      } as any);

      const result = await messageService.createMessage(input);

      expect(result).toEqual(mockMessage);
      expect(mockVectorService.generateEmbedding).toHaveBeenCalledWith(input.content);
      expect(mockPool.query).toHaveBeenCalledTimes(2);
    });

    it('should create message without embedding when skip_embedding is true', async () => {
      const input = {
        conversation_id: '123e4567-e89b-12d3-a456-426614174001',
        user_id: '123e4567-e89b-12d3-a456-426614174000',
        role: 'assistant' as const,
        content: 'Response text',
        skip_embedding: true,
      };

      const mockMessage = createMockMessage({ ...input, embedding: null });

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [{ id: input.conversation_id }],
        rowCount: 1,
      } as any);

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockMessage],
        rowCount: 1,
      } as any);

      const result = await messageService.createMessage(input);

      expect(result).toEqual(mockMessage);
      expect(mockVectorService.generateEmbedding).not.toHaveBeenCalled();
    });

    it('should continue if embedding generation fails', async () => {
      const input = {
        conversation_id: '123e4567-e89b-12d3-a456-426614174001',
        user_id: '123e4567-e89b-12d3-a456-426614174000',
        role: 'user' as const,
        content: 'Hello!',
      };

      const mockMessage = createMockMessage({ ...input, embedding: null });

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [{ id: input.conversation_id }],
        rowCount: 1,
      } as any);

      // Embedding generation fails
      vi.mocked(mockVectorService.generateEmbedding).mockRejectedValueOnce(
        new Error('API error')
      );

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockMessage],
        rowCount: 1,
      } as any);

      const result = await messageService.createMessage(input);

      expect(result).toEqual(mockMessage);
      // Message still created despite embedding failure
    });

    it('should throw error when conversation not found', async () => {
      const input = {
        conversation_id: 'nonexistent',
        user_id: '123e4567-e89b-12d3-a456-426614174000',
        role: 'user' as const,
        content: 'Hello!',
      };

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await expect(messageService.createMessage(input)).rejects.toThrow(
        'Conversation not found'
      );
    });

    it('should throw error on database failure', async () => {
      const input = {
        conversation_id: '123e4567-e89b-12d3-a456-426614174001',
        user_id: '123e4567-e89b-12d3-a456-426614174000',
        role: 'user' as const,
        content: 'Hello!',
      };

      vi.mocked(mockPool.query).mockRejectedValueOnce(new Error('Database error'));

      await expect(messageService.createMessage(input)).rejects.toThrow(
        'Failed to create message'
      );
    });
  });

  describe('createMessagesBatch', () => {
    it('should create multiple messages with batch embeddings', async () => {
      const messages = [
        {
          conversation_id: '123e4567-e89b-12d3-a456-426614174001',
          user_id: '123e4567-e89b-12d3-a456-426614174000',
          role: 'user' as const,
          content: 'Message 1',
        },
        {
          conversation_id: '123e4567-e89b-12d3-a456-426614174001',
          user_id: '123e4567-e89b-12d3-a456-426614174000',
          role: 'assistant' as const,
          content: 'Message 2',
        },
      ];

      const mockEmbeddings = [new Array(1536).fill(0.1), new Array(1536).fill(0.2)];

      vi.mocked(mockVectorService.generateEmbeddings).mockResolvedValueOnce(mockEmbeddings);

      // Mock message inserts
      for (const msg of messages) {
        vi.mocked(mockPool.query).mockResolvedValueOnce({
          rows: [createMockMessage(msg)],
          rowCount: 1,
        } as any);
      }

      const result = await messageService.createMessagesBatch(messages);

      expect(result).toHaveLength(2);
      expect(mockVectorService.generateEmbeddings).toHaveBeenCalledWith([
        'Message 1',
        'Message 2',
      ]);
    });

    it('should return empty array for empty input', async () => {
      const result = await messageService.createMessagesBatch([]);

      expect(result).toEqual([]);
      expect(mockVectorService.generateEmbeddings).not.toHaveBeenCalled();
    });

    it('should continue if batch embedding generation fails', async () => {
      const messages = [
        {
          conversation_id: '123e4567-e89b-12d3-a456-426614174001',
          user_id: '123e4567-e89b-12d3-a456-426614174000',
          role: 'user' as const,
          content: 'Message 1',
        },
      ];

      vi.mocked(mockVectorService.generateEmbeddings).mockRejectedValueOnce(
        new Error('API error')
      );

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [createMockMessage(messages[0])],
        rowCount: 1,
      } as any);

      const result = await messageService.createMessagesBatch(messages);

      expect(result).toHaveLength(1);
    });
  });

  describe('findById', () => {
    it('should return message when found', async () => {
      const mockMessage = createMockMessage();

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockMessage],
        rowCount: 1,
      } as any);

      const result = await messageService.findById(mockMessage.id);

      expect(result).toEqual(mockMessage);
      expect(mockPool.query).toHaveBeenCalledWith(
        'SELECT * FROM messages WHERE id = $1',
        [mockMessage.id]
      );
    });

    it('should return null when message not found', async () => {
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await messageService.findById('nonexistent-id');

      expect(result).toBeNull();
    });

    it('should throw error on database failure', async () => {
      vi.mocked(mockPool.query).mockRejectedValueOnce(new Error('Database error'));

      await expect(messageService.findById('some-id')).rejects.toThrow(
        'Failed to find message'
      );
    });
  });

  describe('listByConversation', () => {
    it('should return messages for conversation', async () => {
      const conversationId = '123e4567-e89b-12d3-a456-426614174001';
      const mockMessages = [
        createMockMessage({ conversation_id: conversationId }),
        createMockMessage({ conversation_id: conversationId, id: 'different-id' }),
      ];

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: mockMessages,
        rowCount: 2,
      } as any);

      const result = await messageService.listByConversation(conversationId);

      expect(result).toEqual(mockMessages);
    });

    it('should filter by role when provided', async () => {
      const conversationId = '123e4567-e89b-12d3-a456-426614174001';

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await messageService.listByConversation(conversationId, 50, 0, 'user');

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('AND role ='),
        expect.arrayContaining([conversationId, 'user'])
      );
    });

    it('should respect pagination parameters', async () => {
      const conversationId = '123e4567-e89b-12d3-a456-426614174001';

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await messageService.listByConversation(conversationId, 20, 10);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        expect.arrayContaining([conversationId, 20, 10])
      );
    });
  });

  describe('getRecentMessages', () => {
    it('should return recent messages in chronological order', async () => {
      const conversationId = '123e4567-e89b-12d3-a456-426614174001';
      const mockMessages = [
        createMockMessage({ id: 'msg3', content: 'Third' }),
        createMockMessage({ id: 'msg2', content: 'Second' }),
        createMockMessage({ id: 'msg1', content: 'First' }),
      ];

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: mockMessages, // DESC order from DB
        rowCount: 3,
      } as any);

      const result = await messageService.getRecentMessages(conversationId, 20);

      // Should be reversed to chronological order
      expect(result[0].id).toBe('msg1');
      expect(result[1].id).toBe('msg2');
      expect(result[2].id).toBe('msg3');
    });
  });

  describe('semanticSearch', () => {
    it('should perform semantic search with query embedding', async () => {
      const query = 'search query';
      const mockEmbedding = new Array(1536).fill(0.1);
      const mockResults = [
        {
          ...createMockMessage({ content: 'Matching message' }),
          similarity: 0.95,
        },
      ];

      vi.mocked(mockVectorService.generateEmbedding).mockResolvedValueOnce(mockEmbedding);

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: mockResults,
        rowCount: 1,
      } as any);

      const result = await messageService.semanticSearch(query);

      expect(result).toHaveLength(1);
      expect(result[0].similarity).toBe(0.95);
      expect(mockVectorService.generateEmbedding).toHaveBeenCalledWith(query);
    });

    it('should filter by conversation_id when provided', async () => {
      const query = 'test';
      const conversationId = '123e4567-e89b-12d3-a456-426614174001';
      const mockEmbedding = new Array(1536).fill(0.1);

      vi.mocked(mockVectorService.generateEmbedding).mockResolvedValueOnce(mockEmbedding);

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await messageService.semanticSearch(query, { conversation_id: conversationId });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('conversation_id ='),
        expect.any(Array)
      );
    });

    it('should filter by user_id when provided', async () => {
      const query = 'test';
      const userId = '123e4567-e89b-12d3-a456-426614174000';
      const mockEmbedding = new Array(1536).fill(0.1);

      vi.mocked(mockVectorService.generateEmbedding).mockResolvedValueOnce(mockEmbedding);

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await messageService.semanticSearch(query, { user_id: userId });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('user_id ='),
        expect.any(Array)
      );
    });

    it('should respect min_similarity threshold', async () => {
      const query = 'test';
      const mockEmbedding = new Array(1536).fill(0.1);

      vi.mocked(mockVectorService.generateEmbedding).mockResolvedValueOnce(mockEmbedding);

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await messageService.semanticSearch(query, { min_similarity: 0.8 });

      const call = vi.mocked(mockPool.query).mock.calls[0];
      expect(call[0]).toContain('>=');
      expect(call[1]).toContain(0.8);
    });
  });

  describe('getCountByConversation', () => {
    it('should return message count', async () => {
      const conversationId = '123e4567-e89b-12d3-a456-426614174001';

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [{ count: '42' }],
        rowCount: 1,
      } as any);

      const result = await messageService.getCountByConversation(conversationId);

      expect(result).toBe(42);
    });

    it('should throw error on database failure', async () => {
      vi.mocked(mockPool.query).mockRejectedValueOnce(new Error('Database error'));

      await expect(
        messageService.getCountByConversation('some-id')
      ).rejects.toThrow('Failed to count messages');
    });
  });

  describe('deleteMessage', () => {
    it('should return true when message is deleted', async () => {
      const messageId = '123e4567-e89b-12d3-a456-426614174002';

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rowCount: 1,
      } as any);

      const result = await messageService.deleteMessage(messageId);

      expect(result).toBe(true);
    });

    it('should return false when message not found', async () => {
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rowCount: 0,
      } as any);

      const result = await messageService.deleteMessage('nonexistent-id');

      expect(result).toBe(false);
    });
  });

  describe('getTotalTokens', () => {
    it('should return total token count for conversation', async () => {
      const conversationId = '123e4567-e89b-12d3-a456-426614174001';

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [{ total: '1500' }],
        rowCount: 1,
      } as any);

      const result = await messageService.getTotalTokens(conversationId);

      expect(result).toBe(1500);
    });

    it('should return 0 when no messages exist', async () => {
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [{ total: null }],
        rowCount: 1,
      } as any);

      const result = await messageService.getTotalTokens('some-id');

      expect(result).toBe(0);
    });
  });
});

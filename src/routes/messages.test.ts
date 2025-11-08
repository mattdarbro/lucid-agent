import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express, { Express } from 'express';
import messagesRouter from './messages';
import { pool } from '../db';
import {
  createMockMessage,
  createMockUser,
  createMockConversation,
} from '../test/setup';

/**
 * Integration tests for Messages API routes
 */

vi.mock('../db', () => ({
  pool: {
    query: vi.fn(),
  },
}));

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

// Mock VectorService using vi.hoisted
const { mockGenerateEmbedding } = vi.hoisted(() => ({
  mockGenerateEmbedding: vi.fn(),
}));

vi.mock('../services/vector.service', () => ({
  VectorService: class MockVectorService {
    generateEmbedding = mockGenerateEmbedding;
  },
}));

describe('Messages API Routes', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/v1/messages', messagesRouter);
    vi.clearAllMocks();
  });

  describe('POST /v1/messages', () => {
    it('should create a message with valid input', async () => {
      const input = {
        conversation_id: '123e4567-e89b-12d3-a456-426614174000',
        user_id: '123e4567-e89b-12d3-a456-426614174001',
        role: 'user' as const,
        content: 'Hello, world!',
      };

      const mockEmbedding = new Array(1536).fill(0.1);
      const mockMessage = createMockMessage(input);

      // Mock conversation check
      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [{ id: input.conversation_id }],
        rowCount: 1,
      } as any);

      // Mock embedding generation
      mockGenerateEmbedding.mockResolvedValueOnce(mockEmbedding);

      // Mock message creation
      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [mockMessage],
        rowCount: 1,
      } as any);

      const response = await request(app).post('/v1/messages').send(input);

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        conversation_id: input.conversation_id,
        user_id: input.user_id,
        role: input.role,
        content: input.content,
      });
    });

    it('should create message without embedding when skip_embedding is true', async () => {
      const input = {
        conversation_id: '123e4567-e89b-12d3-a456-426614174000',
        user_id: '123e4567-e89b-12d3-a456-426614174001',
        role: 'user' as const,
        content: 'Hello, world!',
        skip_embedding: true,
      };

      const mockMessage = createMockMessage({ ...input, embedding: null });

      // Mock conversation check
      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [{ id: input.conversation_id }],
        rowCount: 1,
      } as any);

      // Mock message creation
      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [mockMessage],
        rowCount: 1,
      } as any);

      const response = await request(app).post('/v1/messages').send(input);

      expect(response.status).toBe(201);
      expect(mockGenerateEmbedding).not.toHaveBeenCalled();
    });

    it('should return 400 when required fields are missing', async () => {
      const input = {
        content: 'Missing required fields',
      };

      const response = await request(app).post('/v1/messages').send(input);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
    });

    it('should return 400 when role is invalid', async () => {
      const input = {
        conversation_id: '123e4567-e89b-12d3-a456-426614174000',
        user_id: '123e4567-e89b-12d3-a456-426614174001',
        role: 'invalid_role',
        content: 'Test',
      };

      const response = await request(app).post('/v1/messages').send(input);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
    });

    it('should return 404 when conversation does not exist', async () => {
      const input = {
        conversation_id: '123e4567-e89b-12d3-a456-426614174000',
        user_id: '123e4567-e89b-12d3-a456-426614174001',
        role: 'user' as const,
        content: 'Test',
      };

      // Mock conversation check - not found
      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const response = await request(app).post('/v1/messages').send(input);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Conversation not found');
    });

    it('should return 500 on database error', async () => {
      const input = {
        conversation_id: '123e4567-e89b-12d3-a456-426614174000',
        user_id: '123e4567-e89b-12d3-a456-426614174001',
        role: 'user' as const,
        content: 'Test',
      };

      vi.mocked(pool.query).mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app).post('/v1/messages').send(input);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to create message');
    });
  });

  describe('GET /v1/messages/:id', () => {
    it('should return message when found', async () => {
      const mockMessage = createMockMessage();

      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [mockMessage],
        rowCount: 1,
      } as any);

      const response = await request(app).get(`/v1/messages/${mockMessage.id}`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: mockMessage.id,
        conversation_id: mockMessage.conversation_id,
        content: mockMessage.content,
      });
    });

    it('should return 404 when message not found', async () => {
      const messageId = '123e4567-e89b-12d3-a456-426614174002';

      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const response = await request(app).get(`/v1/messages/${messageId}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Message not found');
    });

    it('should return 400 when ID is not a UUID', async () => {
      const response = await request(app).get('/v1/messages/not-a-uuid');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
    });

    it('should return 500 on database error', async () => {
      const messageId = '123e4567-e89b-12d3-a456-426614174002';

      vi.mocked(pool.query).mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app).get(`/v1/messages/${messageId}`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch message');
    });
  });

  describe('GET /v1/conversations/:conversation_id/messages', () => {
    it('should return messages for conversation', async () => {
      const conversationId = '123e4567-e89b-12d3-a456-426614174000';
      const mockMessages = [
        createMockMessage({ conversation_id: conversationId }),
        createMockMessage({ conversation_id: conversationId, id: 'msg2' }),
      ];

      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: mockMessages,
        rowCount: 2,
      } as any);

      const response = await request(app).get(
        `/v1/messages/conversations/${conversationId}/messages`
      );

      expect(response.status).toBe(200);
      expect(response.body.messages).toHaveLength(2);
      expect(response.body.count).toBe(2);
    });

    it('should respect limit and offset parameters', async () => {
      const conversationId = '123e4567-e89b-12d3-a456-426614174000';

      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const response = await request(app)
        .get(`/v1/messages/conversations/${conversationId}/messages`)
        .query({ limit: 10, offset: 5 });

      expect(response.status).toBe(200);
      expect(response.body.limit).toBe(10);
      expect(response.body.offset).toBe(5);
    });

    it('should filter by role when provided', async () => {
      const conversationId = '123e4567-e89b-12d3-a456-426614174000';
      const mockMessages = [
        createMockMessage({ conversation_id: conversationId, role: 'user' }),
      ];

      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: mockMessages,
        rowCount: 1,
      } as any);

      const response = await request(app)
        .get(`/v1/messages/conversations/${conversationId}/messages`)
        .query({ role: 'user' });

      expect(response.status).toBe(200);
      expect(response.body.messages).toHaveLength(1);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE'),
        expect.arrayContaining([conversationId, 'user'])
      );
    });

    it('should return empty array when no messages exist', async () => {
      const conversationId = '123e4567-e89b-12d3-a456-426614174000';

      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const response = await request(app).get(
        `/v1/messages/conversations/${conversationId}/messages`
      );

      expect(response.status).toBe(200);
      expect(response.body.messages).toEqual([]);
      expect(response.body.count).toBe(0);
    });

    it('should return 400 when conversation_id is not a UUID', async () => {
      const response = await request(app).get(
        '/v1/messages/conversations/not-a-uuid/messages'
      );

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
    });

    it('should return 500 on database error', async () => {
      const conversationId = '123e4567-e89b-12d3-a456-426614174000';

      vi.mocked(pool.query).mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app).get(
        `/v1/messages/conversations/${conversationId}/messages`
      );

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch messages');
    });
  });

  describe('POST /v1/messages/search', () => {
    it('should perform semantic search with valid query', async () => {
      const input = {
        query: 'machine learning',
        limit: 5,
        min_similarity: 0.8,
      };

      const mockEmbedding = new Array(1536).fill(0.1);
      const mockMessages = [
        {
          ...createMockMessage({ content: 'About machine learning' }),
          similarity: 0.95,
        },
      ];

      mockGenerateEmbedding.mockResolvedValueOnce(mockEmbedding);

      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: mockMessages,
        rowCount: 1,
      } as any);

      const response = await request(app).post('/v1/messages/search').send(input);

      expect(response.status).toBe(200);
      expect(response.body.results).toHaveLength(1);
      expect(response.body.count).toBe(1);
      expect(response.body.query).toBe(input.query);
    });

    it('should filter by conversation_id when provided', async () => {
      const input = {
        query: 'test query',
        conversation_id: '123e4567-e89b-12d3-a456-426614174000',
      };

      const mockEmbedding = new Array(1536).fill(0.1);

      mockGenerateEmbedding.mockResolvedValueOnce(mockEmbedding);

      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const response = await request(app).post('/v1/messages/search').send(input);

      expect(response.status).toBe(200);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('conversation_id'),
        expect.anything()
      );
    });

    it('should filter by user_id when provided', async () => {
      const input = {
        query: 'test query',
        user_id: '123e4567-e89b-12d3-a456-426614174001',
      };

      const mockEmbedding = new Array(1536).fill(0.1);

      mockGenerateEmbedding.mockResolvedValueOnce(mockEmbedding);

      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const response = await request(app).post('/v1/messages/search').send(input);

      expect(response.status).toBe(200);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('user_id'),
        expect.anything()
      );
    });

    it('should return 400 when query is missing', async () => {
      const input = {};

      const response = await request(app).post('/v1/messages/search').send(input);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
    });

    it('should return 400 when query is too long', async () => {
      const input = {
        query: 'x'.repeat(1001),
      };

      const response = await request(app).post('/v1/messages/search').send(input);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
    });

    it('should return 503 when embedding generation fails', async () => {
      const input = {
        query: 'test query',
      };

      mockGenerateEmbedding.mockRejectedValueOnce(
        new Error('OpenAI API error')
      );

      const response = await request(app).post('/v1/messages/search').send(input);

      expect(response.status).toBe(503);
      expect(response.body.error).toBe('Semantic search temporarily unavailable');
    });
  });

  describe('DELETE /v1/messages/:id', () => {
    it('should delete message successfully', async () => {
      const messageId = '123e4567-e89b-12d3-a456-426614174002';

      vi.mocked(pool.query).mockResolvedValueOnce({
        rowCount: 1,
      } as any);

      const response = await request(app).delete(`/v1/messages/${messageId}`);

      expect(response.status).toBe(204);
    });

    it('should return 404 when message not found', async () => {
      const messageId = '123e4567-e89b-12d3-a456-426614174002';

      vi.mocked(pool.query).mockResolvedValueOnce({
        rowCount: 0,
      } as any);

      const response = await request(app).delete(`/v1/messages/${messageId}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Message not found');
    });

    it('should return 400 when ID is not a UUID', async () => {
      const response = await request(app).delete('/v1/messages/not-a-uuid');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
    });

    it('should return 500 on database error', async () => {
      const messageId = '123e4567-e89b-12d3-a456-426614174002';

      vi.mocked(pool.query).mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app).delete(`/v1/messages/${messageId}`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to delete message');
    });
  });
});

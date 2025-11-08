import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express, { Express } from 'express';
import conversationsRouter from './conversations';
import { pool } from '../db';
import { createMockConversation, createMockUser } from '../test/setup';

/**
 * Integration tests for Conversations API routes
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
  },
}));

describe('Conversations API Routes', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/v1/conversations', conversationsRouter);
    vi.clearAllMocks();
  });

  describe('POST /v1/conversations', () => {
    it('should create a conversation with valid input', async () => {
      const input = {
        user_id: '123e4567-e89b-12d3-a456-426614174000',
        title: 'Morning Chat',
        user_timezone: 'America/New_York',
      };

      const mockUser = createMockUser({ id: input.user_id });
      const mockConversation = createMockConversation(input);

      // Mock user check
      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [mockUser],
        rowCount: 1,
      } as any);

      // Mock conversation creation
      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [mockConversation],
        rowCount: 1,
      } as any);

      const response = await request(app).post('/v1/conversations').send(input);

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        user_id: input.user_id,
        title: input.title,
        user_timezone: input.user_timezone,
      });
    });

    it('should return 400 when user_id is missing', async () => {
      const input = {
        title: 'Chat without user',
      };

      const response = await request(app).post('/v1/conversations').send(input);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
    });

    it('should return 400 when user_id is not a UUID', async () => {
      const input = {
        user_id: 'not-a-uuid',
        title: 'Test',
      };

      const response = await request(app).post('/v1/conversations').send(input);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
    });

    it('should return 404 when user does not exist', async () => {
      const input = {
        user_id: '123e4567-e89b-12d3-a456-426614174000',
      };

      // Mock user check - user not found
      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const response = await request(app).post('/v1/conversations').send(input);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('User not found');
    });

    it('should return 500 on database error', async () => {
      const input = {
        user_id: '123e4567-e89b-12d3-a456-426614174000',
      };

      vi.mocked(pool.query).mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app).post('/v1/conversations').send(input);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to create conversation');
    });
  });

  describe('GET /v1/conversations/:id', () => {
    it('should return conversation when found', async () => {
      const mockConversation = createMockConversation();

      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [mockConversation],
        rowCount: 1,
      } as any);

      const response = await request(app).get(`/v1/conversations/${mockConversation.id}`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: mockConversation.id,
        user_id: mockConversation.user_id,
        title: mockConversation.title,
      });
    });

    it('should return 404 when conversation not found', async () => {
      const conversationId = '123e4567-e89b-12d3-a456-426614174001';

      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const response = await request(app).get(`/v1/conversations/${conversationId}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Conversation not found');
    });

    it('should return 400 when ID is not a UUID', async () => {
      const response = await request(app).get('/v1/conversations/not-a-uuid');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
    });

    it('should return 500 on database error', async () => {
      const conversationId = '123e4567-e89b-12d3-a456-426614174001';

      vi.mocked(pool.query).mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app).get(`/v1/conversations/${conversationId}`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch conversation');
    });
  });

  describe('GET /v1/conversations/user/:user_id', () => {
    it('should return conversations for user', async () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';
      const mockConversations = [
        createMockConversation({ user_id: userId }),
        createMockConversation({ user_id: userId, id: 'another-id' }),
      ];

      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: mockConversations,
        rowCount: 2,
      } as any);

      const response = await request(app).get(`/v1/conversations/user/${userId}`);

      expect(response.status).toBe(200);
      expect(response.body.conversations).toHaveLength(2);
      expect(response.body.count).toBe(2);
    });

    it('should respect pagination parameters', async () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';

      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const response = await request(app)
        .get(`/v1/conversations/user/${userId}`)
        .query({ limit: 10, offset: 5 });

      expect(response.status).toBe(200);
      expect(response.body.limit).toBe(10);
      expect(response.body.offset).toBe(5);
      expect(pool.query).toHaveBeenCalledWith(
        expect.any(String),
        [userId, 10, 5]
      );
    });

    it('should return empty array when user has no conversations', async () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';

      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const response = await request(app).get(`/v1/conversations/user/${userId}`);

      expect(response.status).toBe(200);
      expect(response.body.conversations).toEqual([]);
      expect(response.body.count).toBe(0);
    });

    it('should return 400 when user_id is not a UUID', async () => {
      const response = await request(app).get('/v1/conversations/user/not-a-uuid');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
    });

    it('should return 500 on database error', async () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';

      vi.mocked(pool.query).mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app).get(`/v1/conversations/user/${userId}`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch conversations');
    });
  });

  describe('PATCH /v1/conversations/:id', () => {
    it('should update conversation with valid input', async () => {
      const conversationId = '123e4567-e89b-12d3-a456-426614174001';
      const updateInput = {
        title: 'Updated Title',
        user_timezone: 'America/Chicago',
      };

      const mockUpdatedConversation = createMockConversation({
        id: conversationId,
        ...updateInput,
      });

      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [mockUpdatedConversation],
        rowCount: 1,
      } as any);

      const response = await request(app)
        .patch(`/v1/conversations/${conversationId}`)
        .send(updateInput);

      expect(response.status).toBe(200);
      expect(response.body.title).toBe(updateInput.title);
      expect(response.body.user_timezone).toBe(updateInput.user_timezone);
    });

    it('should return 404 when conversation not found', async () => {
      const conversationId = '123e4567-e89b-12d3-a456-426614174001';

      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const response = await request(app)
        .patch(`/v1/conversations/${conversationId}`)
        .send({ title: 'Updated' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Conversation not found');
    });

    it('should return 400 when timezone is invalid', async () => {
      const conversationId = '123e4567-e89b-12d3-a456-426614174001';

      const response = await request(app)
        .patch(`/v1/conversations/${conversationId}`)
        .send({ user_timezone: 'Invalid/Timezone' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
    });

    it('should return 500 on database error', async () => {
      const conversationId = '123e4567-e89b-12d3-a456-426614174001';

      vi.mocked(pool.query).mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app)
        .patch(`/v1/conversations/${conversationId}`)
        .send({ title: 'Updated' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to update conversation');
    });
  });

  describe('DELETE /v1/conversations/:id', () => {
    it('should delete conversation successfully', async () => {
      const conversationId = '123e4567-e89b-12d3-a456-426614174001';

      vi.mocked(pool.query).mockResolvedValueOnce({
        rowCount: 1,
      } as any);

      const response = await request(app).delete(`/v1/conversations/${conversationId}`);

      expect(response.status).toBe(204);
    });

    it('should return 404 when conversation not found', async () => {
      const conversationId = '123e4567-e89b-12d3-a456-426614174001';

      vi.mocked(pool.query).mockResolvedValueOnce({
        rowCount: 0,
      } as any);

      const response = await request(app).delete(`/v1/conversations/${conversationId}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Conversation not found');
    });

    it('should return 400 when ID is not a UUID', async () => {
      const response = await request(app).delete('/v1/conversations/not-a-uuid');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
    });

    it('should return 500 on database error', async () => {
      const conversationId = '123e4567-e89b-12d3-a456-426614174001';

      vi.mocked(pool.query).mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app).delete(`/v1/conversations/${conversationId}`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to delete conversation');
    });
  });
});

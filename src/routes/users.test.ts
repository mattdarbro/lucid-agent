import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import request from 'supertest';
import express, { Express } from 'express';
import usersRouter from './users';
import { pool } from '../db';
import { createMockUser } from '../test/setup';

/**
 * Integration tests for Users API routes
 *
 * These tests verify the HTTP layer, validation, and error handling
 */

// Mock the database pool
vi.mock('../db', () => ({
  pool: {
    query: vi.fn(),
  },
}));

// Mock the logger to suppress logs during tests
vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('Users API Routes', () => {
  let app: Express;

  beforeEach(() => {
    // Create a fresh Express app for each test
    app = express();
    app.use(express.json());
    app.use('/v1/users', usersRouter);

    // Clear all mocks
    vi.clearAllMocks();
  });

  describe('POST /v1/users', () => {
    it('should create a user with valid input', async () => {
      const input = {
        external_id: 'ios_user_123',
        name: 'John Doe',
        email: 'john@example.com',
        timezone: 'America/Los_Angeles',
      };

      const mockUser = createMockUser(input);

      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [mockUser],
        rowCount: 1,
      } as any);

      const response = await request(app).post('/v1/users').send(input);

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        id: mockUser.id,
        external_id: mockUser.external_id,
        name: mockUser.name,
        email: mockUser.email,
        timezone: mockUser.timezone,
        preferences: mockUser.preferences,
      });
      // Dates are serialized as strings in JSON responses
      expect(typeof response.body.created_at).toBe('string');
      expect(typeof response.body.last_active_at).toBe('string');
    });

    it('should return 400 when external_id is missing', async () => {
      const input = {
        name: 'John Doe',
        email: 'john@example.com',
      };

      const response = await request(app).post('/v1/users').send(input);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
      expect(response.body.details).toBeDefined();
    });

    it('should return 400 when external_id contains invalid characters', async () => {
      const input = {
        external_id: 'ios user@123', // spaces and @ not allowed
        name: 'John Doe',
      };

      const response = await request(app).post('/v1/users').send(input);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
    });

    it('should return 400 when email is invalid', async () => {
      const input = {
        external_id: 'ios_user_123',
        email: 'not-an-email',
      };

      const response = await request(app).post('/v1/users').send(input);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
    });

    it('should return 400 when timezone is invalid', async () => {
      const input = {
        external_id: 'ios_user_123',
        timezone: 'Invalid/Timezone',
      };

      const response = await request(app).post('/v1/users').send(input);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
    });

    it('should use default values for optional fields', async () => {
      const input = {
        external_id: 'ios_user_123',
      };

      const mockUser = createMockUser({
        external_id: input.external_id,
        name: null,
        email: null,
        timezone: 'UTC',
        preferences: {},
      });

      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [mockUser],
        rowCount: 1,
      } as any);

      const response = await request(app).post('/v1/users').send(input);

      expect(response.status).toBe(201);
      expect(response.body.timezone).toBe('UTC');
      expect(response.body.preferences).toEqual({});
    });

    it('should return 500 on database error', async () => {
      const input = {
        external_id: 'ios_user_123',
      };

      vi.mocked(pool.query).mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app).post('/v1/users').send(input);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to create user');
    });
  });

  describe('GET /v1/users/:external_id', () => {
    it('should return user when found', async () => {
      const mockUser = createMockUser({ external_id: 'ios_user_123' });

      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [mockUser],
        rowCount: 1,
      } as any);

      const response = await request(app).get('/v1/users/ios_user_123');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: mockUser.id,
        external_id: mockUser.external_id,
        name: mockUser.name,
        email: mockUser.email,
        timezone: mockUser.timezone,
        preferences: mockUser.preferences,
      });
      // Dates are serialized as strings in JSON responses
      expect(typeof response.body.created_at).toBe('string');
      expect(typeof response.body.last_active_at).toBe('string');
    });

    it('should return 404 when user not found', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const response = await request(app).get('/v1/users/nonexistent');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('User not found');
    });

    it('should return 500 on database error', async () => {
      vi.mocked(pool.query).mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app).get('/v1/users/ios_user_123');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch user');
    });
  });

  describe('PATCH /v1/users/:external_id', () => {
    it('should update user with valid input', async () => {
      const existingUser = createMockUser({ external_id: 'ios_user_123' });
      const updateInput = {
        name: 'Updated Name',
        email: 'updated@example.com',
      };

      const updatedUser = createMockUser({
        ...existingUser,
        ...updateInput,
      });

      // First query: find by external_id
      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [existingUser],
        rowCount: 1,
      } as any);

      // Second query: update
      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [updatedUser],
        rowCount: 1,
      } as any);

      const response = await request(app)
        .patch('/v1/users/ios_user_123')
        .send(updateInput);

      expect(response.status).toBe(200);
      expect(response.body.name).toBe(updateInput.name);
      expect(response.body.email).toBe(updateInput.email);
    });

    it('should return 404 when user not found', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const response = await request(app)
        .patch('/v1/users/nonexistent')
        .send({ name: 'Updated Name' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('User not found');
    });

    it('should return 400 when email is invalid', async () => {
      const response = await request(app)
        .patch('/v1/users/ios_user_123')
        .send({ email: 'not-an-email' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
    });

    it('should return 500 on database error', async () => {
      vi.mocked(pool.query).mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app)
        .patch('/v1/users/ios_user_123')
        .send({ name: 'Updated Name' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to update user');
    });
  });

  describe('DELETE /v1/users/:external_id', () => {
    it('should delete user successfully', async () => {
      const existingUser = createMockUser({ external_id: 'ios_user_123' });

      // First query: find by external_id
      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [existingUser],
        rowCount: 1,
      } as any);

      // Second query: delete
      vi.mocked(pool.query).mockResolvedValueOnce({
        rowCount: 1,
      } as any);

      const response = await request(app).delete('/v1/users/ios_user_123');

      expect(response.status).toBe(204);
    });

    it('should return 404 when user not found', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const response = await request(app).delete('/v1/users/nonexistent');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('User not found');
    });

    it('should return 500 on database error', async () => {
      vi.mocked(pool.query).mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app).delete('/v1/users/ios_user_123');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to delete user');
    });
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UserService } from './user.service';
import { Pool } from 'pg';
import { createMockUser, clearAllMocks } from '../test/setup';

/**
 * Unit tests for UserService
 *
 * These tests use mocks to avoid hitting the real database
 */

// Create a mock pool
const mockPool = {
  query: vi.fn(),
} as unknown as Pool;

describe('UserService', () => {
  let userService: UserService;

  beforeEach(() => {
    clearAllMocks();
    userService = new UserService(mockPool);
  });

  describe('createOrUpdateUser', () => {
    it('should create a new user with valid input', async () => {
      const input = {
        external_id: 'ios_user_123',
        name: 'John Doe',
        email: 'john@example.com',
        timezone: 'America/Los_Angeles',
        preferences: {},
      };

      const mockUser = createMockUser(input);

      // Mock the database query
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockUser],
        rowCount: 1,
      } as any);

      const result = await userService.createOrUpdateUser(input);

      expect(result).toEqual(mockUser);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO users'),
        [input.external_id, input.name, input.email, input.timezone, input.preferences]
      );
    });

    it('should handle null values for optional fields', async () => {
      const input = {
        external_id: 'ios_user_123',
        timezone: 'UTC',
        preferences: {},
      };

      const mockUser = createMockUser({
        ...input,
        name: null,
        email: null,
      });

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockUser],
        rowCount: 1,
      } as any);

      const result = await userService.createOrUpdateUser(input);

      expect(result).toEqual(mockUser);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO users'),
        [input.external_id, null, null, input.timezone, input.preferences]
      );
    });

    it('should throw error on database failure', async () => {
      const input = {
        external_id: 'ios_user_123',
        timezone: 'UTC',
        preferences: {},
      };

      vi.mocked(mockPool.query).mockRejectedValueOnce(new Error('Database error'));

      await expect(userService.createOrUpdateUser(input)).rejects.toThrow(
        'Failed to create user'
      );
    });
  });

  describe('findByExternalId', () => {
    it('should return user when found', async () => {
      const mockUser = createMockUser({ external_id: 'ios_user_123' });

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockUser],
        rowCount: 1,
      } as any);

      const result = await userService.findByExternalId('ios_user_123');

      expect(result).toEqual(mockUser);
      expect(mockPool.query).toHaveBeenCalledWith(
        'SELECT * FROM users WHERE external_id = $1',
        ['ios_user_123']
      );
    });

    it('should return null when user not found', async () => {
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await userService.findByExternalId('nonexistent');

      expect(result).toBeNull();
    });

    it('should throw error on database failure', async () => {
      vi.mocked(mockPool.query).mockRejectedValueOnce(new Error('Database error'));

      await expect(userService.findByExternalId('ios_user_123')).rejects.toThrow(
        'Failed to find user'
      );
    });
  });

  describe('findById', () => {
    it('should return user when found', async () => {
      const mockUser = createMockUser();

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockUser],
        rowCount: 1,
      } as any);

      const result = await userService.findById(mockUser.id);

      expect(result).toEqual(mockUser);
      expect(mockPool.query).toHaveBeenCalledWith(
        'SELECT * FROM users WHERE id = $1',
        [mockUser.id]
      );
    });

    it('should return null when user not found', async () => {
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await userService.findById('nonexistent-id');

      expect(result).toBeNull();
    });

    it('should throw error on database failure', async () => {
      vi.mocked(mockPool.query).mockRejectedValueOnce(new Error('Database error'));

      await expect(userService.findById('some-id')).rejects.toThrow('Failed to find user');
    });
  });

  describe('updateUser', () => {
    it('should update user with all fields', async () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';
      const input = {
        name: 'Updated Name',
        email: 'updated@example.com',
        timezone: 'America/New_York',
        preferences: { theme: 'dark' },
      };

      const mockUpdatedUser = createMockUser({ id: userId, ...input });

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockUpdatedUser],
        rowCount: 1,
      } as any);

      const result = await userService.updateUser(userId, input);

      expect(result).toEqual(mockUpdatedUser);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users'),
        expect.arrayContaining([
          input.name,
          input.email,
          input.timezone,
          input.preferences,
          userId,
        ])
      );
    });

    it('should update user with partial fields', async () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';
      const input = {
        name: 'Updated Name',
      };

      const mockUpdatedUser = createMockUser({ id: userId, name: input.name });

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockUpdatedUser],
        rowCount: 1,
      } as any);

      const result = await userService.updateUser(userId, input);

      expect(result).toEqual(mockUpdatedUser);
    });

    it('should return null when user not found', async () => {
      const userId = 'nonexistent-id';
      const input = { name: 'Updated Name' };

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await userService.updateUser(userId, input);

      expect(result).toBeNull();
    });

    it('should throw error on database failure', async () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';
      const input = { name: 'Updated Name' };

      vi.mocked(mockPool.query).mockRejectedValueOnce(new Error('Database error'));

      await expect(userService.updateUser(userId, input)).rejects.toThrow(
        'Failed to update user'
      );
    });
  });

  describe('updateLastActive', () => {
    it('should return true when user is updated', async () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rowCount: 1,
      } as any);

      const result = await userService.updateLastActive(userId);

      expect(result).toBe(true);
      expect(mockPool.query).toHaveBeenCalledWith(
        'UPDATE users SET last_active_at = NOW() WHERE id = $1',
        [userId]
      );
    });

    it('should return false when user not found', async () => {
      const userId = 'nonexistent-id';

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rowCount: 0,
      } as any);

      const result = await userService.updateLastActive(userId);

      expect(result).toBe(false);
    });

    it('should throw error on database failure', async () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';

      vi.mocked(mockPool.query).mockRejectedValueOnce(new Error('Database error'));

      await expect(userService.updateLastActive(userId)).rejects.toThrow(
        'Failed to update last active'
      );
    });
  });

  describe('deleteUser', () => {
    it('should return true when user is deleted', async () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rowCount: 1,
      } as any);

      const result = await userService.deleteUser(userId);

      expect(result).toBe(true);
      expect(mockPool.query).toHaveBeenCalledWith('DELETE FROM users WHERE id = $1', [
        userId,
      ]);
    });

    it('should return false when user not found', async () => {
      const userId = 'nonexistent-id';

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rowCount: 0,
      } as any);

      const result = await userService.deleteUser(userId);

      expect(result).toBe(false);
    });

    it('should throw error on database failure', async () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';

      vi.mocked(mockPool.query).mockRejectedValueOnce(new Error('Database error'));

      await expect(userService.deleteUser(userId)).rejects.toThrow('Failed to delete user');
    });
  });

  describe('listUsers', () => {
    it('should return array of users with default pagination', async () => {
      const mockUsers = [createMockUser(), createMockUser({ external_id: 'user2' })];

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: mockUsers,
        rowCount: 2,
      } as any);

      const result = await userService.listUsers();

      expect(result).toEqual(mockUsers);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM users'),
        [100, 0] // default limit and offset
      );
    });

    it('should respect custom pagination parameters', async () => {
      const mockUsers = [createMockUser()];

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: mockUsers,
        rowCount: 1,
      } as any);

      const result = await userService.listUsers(50, 10);

      expect(result).toEqual(mockUsers);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM users'),
        [50, 10]
      );
    });

    it('should return empty array when no users found', async () => {
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await userService.listUsers();

      expect(result).toEqual([]);
    });

    it('should throw error on database failure', async () => {
      vi.mocked(mockPool.query).mockRejectedValueOnce(new Error('Database error'));

      await expect(userService.listUsers()).rejects.toThrow('Failed to list users');
    });
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationService } from './conversation.service';
import { Pool } from 'pg';
import { createMockConversation, createMockUser, clearAllMocks } from '../test/setup';

/**
 * Unit tests for ConversationService
 */

const mockPool = {
  query: vi.fn(),
} as unknown as Pool;

describe('ConversationService', () => {
  let conversationService: ConversationService;

  beforeEach(() => {
    clearAllMocks();
    conversationService = new ConversationService(mockPool);
  });

  describe('createConversation', () => {
    it('should create a conversation with valid input', async () => {
      const input = {
        user_id: '123e4567-e89b-12d3-a456-426614174000',
        title: 'Morning Chat',
        user_timezone: 'America/New_York',
      };

      const mockUser = createMockUser({ id: input.user_id, timezone: 'UTC' });
      const mockConversation = createMockConversation(input);

      // Mock user check
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockUser],
        rowCount: 1,
      } as any);

      // Mock conversation creation
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockConversation],
        rowCount: 1,
      } as any);

      const result = await conversationService.createConversation(input);

      expect(result).toEqual(mockConversation);
      expect(mockPool.query).toHaveBeenCalledTimes(2);
      expect(mockPool.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('INSERT INTO conversations'),
        [input.user_id, input.title, input.user_timezone]
      );
    });

    it('should use user timezone when not provided', async () => {
      const input = {
        user_id: '123e4567-e89b-12d3-a456-426614174000',
      };

      const mockUser = createMockUser({
        id: input.user_id,
        timezone: 'America/Los_Angeles',
      });

      const mockConversation = createMockConversation({
        user_id: input.user_id,
        user_timezone: 'America/Los_Angeles',
      });

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockUser],
        rowCount: 1,
      } as any);

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockConversation],
        rowCount: 1,
      } as any);

      const result = await conversationService.createConversation(input);

      expect(result.user_timezone).toBe('America/Los_Angeles');
      expect(mockPool.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('INSERT INTO conversations'),
        [input.user_id, null, 'America/Los_Angeles']
      );
    });

    it('should throw error when user not found', async () => {
      const input = {
        user_id: 'nonexistent-user-id',
      };

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await expect(conversationService.createConversation(input)).rejects.toThrow(
        'User not found'
      );
    });

    it('should throw error on database failure', async () => {
      const input = {
        user_id: '123e4567-e89b-12d3-a456-426614174000',
      };

      vi.mocked(mockPool.query).mockRejectedValueOnce(new Error('Database error'));

      await expect(conversationService.createConversation(input)).rejects.toThrow(
        'Failed to create conversation'
      );
    });
  });

  describe('findById', () => {
    it('should return conversation when found', async () => {
      const mockConversation = createMockConversation();

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockConversation],
        rowCount: 1,
      } as any);

      const result = await conversationService.findById(mockConversation.id);

      expect(result).toEqual(mockConversation);
      expect(mockPool.query).toHaveBeenCalledWith(
        'SELECT * FROM conversations WHERE id = $1',
        [mockConversation.id]
      );
    });

    it('should return null when conversation not found', async () => {
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await conversationService.findById('nonexistent-id');

      expect(result).toBeNull();
    });

    it('should throw error on database failure', async () => {
      vi.mocked(mockPool.query).mockRejectedValueOnce(new Error('Database error'));

      await expect(conversationService.findById('some-id')).rejects.toThrow(
        'Failed to find conversation'
      );
    });
  });

  describe('listByUserId', () => {
    it('should return array of conversations for user', async () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';
      const mockConversations = [
        createMockConversation({ user_id: userId }),
        createMockConversation({ user_id: userId, id: 'different-id' }),
      ];

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: mockConversations,
        rowCount: 2,
      } as any);

      const result = await conversationService.listByUserId(userId);

      expect(result).toEqual(mockConversations);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM conversations'),
        [userId, 50, 0] // default limit and offset
      );
    });

    it('should respect pagination parameters', async () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await conversationService.listByUserId(userId, 20, 10);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM conversations'),
        [userId, 20, 10]
      );
    });

    it('should return empty array when no conversations found', async () => {
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await conversationService.listByUserId('some-user-id');

      expect(result).toEqual([]);
    });

    it('should throw error on database failure', async () => {
      vi.mocked(mockPool.query).mockRejectedValueOnce(new Error('Database error'));

      await expect(conversationService.listByUserId('some-user-id')).rejects.toThrow(
        'Failed to list conversations'
      );
    });
  });

  describe('getMostRecent', () => {
    it('should return most recent conversation for user', async () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';
      const mockConversation = createMockConversation({ user_id: userId });

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockConversation],
        rowCount: 1,
      } as any);

      const result = await conversationService.getMostRecent(userId);

      expect(result).toEqual(mockConversation);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC'),
        [userId]
      );
    });

    it('should return null when user has no conversations', async () => {
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await conversationService.getMostRecent('some-user-id');

      expect(result).toBeNull();
    });

    it('should throw error on database failure', async () => {
      vi.mocked(mockPool.query).mockRejectedValueOnce(new Error('Database error'));

      await expect(conversationService.getMostRecent('some-user-id')).rejects.toThrow(
        'Failed to get recent conversation'
      );
    });
  });

  describe('updateConversation', () => {
    it('should update conversation with all fields', async () => {
      const conversationId = '123e4567-e89b-12d3-a456-426614174001';
      const input = {
        title: 'Updated Title',
        user_timezone: 'America/Chicago',
      };

      const mockUpdatedConversation = createMockConversation({
        id: conversationId,
        ...input,
      });

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockUpdatedConversation],
        rowCount: 1,
      } as any);

      const result = await conversationService.updateConversation(conversationId, input);

      expect(result).toEqual(mockUpdatedConversation);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE conversations'),
        expect.arrayContaining([input.title, input.user_timezone, conversationId])
      );
    });

    it('should update conversation with partial fields', async () => {
      const conversationId = '123e4567-e89b-12d3-a456-426614174001';
      const input = {
        title: 'Updated Title',
      };

      const mockUpdatedConversation = createMockConversation({
        id: conversationId,
        title: input.title,
      });

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockUpdatedConversation],
        rowCount: 1,
      } as any);

      const result = await conversationService.updateConversation(conversationId, input);

      expect(result).toEqual(mockUpdatedConversation);
    });

    it('should return null when conversation not found', async () => {
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await conversationService.updateConversation('nonexistent-id', {
        title: 'Updated',
      });

      expect(result).toBeNull();
    });

    it('should throw error on database failure', async () => {
      vi.mocked(mockPool.query).mockRejectedValueOnce(new Error('Database error'));

      await expect(
        conversationService.updateConversation('some-id', { title: 'Updated' })
      ).rejects.toThrow('Failed to update conversation');
    });
  });

  describe('deleteConversation', () => {
    it('should return true when conversation is deleted', async () => {
      const conversationId = '123e4567-e89b-12d3-a456-426614174001';

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rowCount: 1,
      } as any);

      const result = await conversationService.deleteConversation(conversationId);

      expect(result).toBe(true);
      expect(mockPool.query).toHaveBeenCalledWith(
        'DELETE FROM conversations WHERE id = $1',
        [conversationId]
      );
    });

    it('should return false when conversation not found', async () => {
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rowCount: 0,
      } as any);

      const result = await conversationService.deleteConversation('nonexistent-id');

      expect(result).toBe(false);
    });

    it('should throw error on database failure', async () => {
      vi.mocked(mockPool.query).mockRejectedValueOnce(new Error('Database error'));

      await expect(conversationService.deleteConversation('some-id')).rejects.toThrow(
        'Failed to delete conversation'
      );
    });
  });

  describe('getCountByUserId', () => {
    it('should return conversation count for user', async () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [{ count: '5' }],
        rowCount: 1,
      } as any);

      const result = await conversationService.getCountByUserId(userId);

      expect(result).toBe(5);
      expect(mockPool.query).toHaveBeenCalledWith(
        'SELECT COUNT(*) as count FROM conversations WHERE user_id = $1',
        [userId]
      );
    });

    it('should return 0 when user has no conversations', async () => {
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [{ count: '0' }],
        rowCount: 1,
      } as any);

      const result = await conversationService.getCountByUserId('some-user-id');

      expect(result).toBe(0);
    });

    it('should throw error on database failure', async () => {
      vi.mocked(mockPool.query).mockRejectedValueOnce(new Error('Database error'));

      await expect(conversationService.getCountByUserId('some-user-id')).rejects.toThrow(
        'Failed to count conversations'
      );
    });
  });

  describe('findByMinMessageCount', () => {
    it('should return conversations with sufficient messages', async () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';
      const mockConversations = [
        createMockConversation({ user_id: userId, message_count: 10 }),
        createMockConversation({ user_id: userId, message_count: 7 }),
      ];

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: mockConversations,
        rowCount: 2,
      } as any);

      const result = await conversationService.findByMinMessageCount(userId, 5);

      expect(result).toEqual(mockConversations);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('message_count >= $2'),
        [userId, 5]
      );
    });

    it('should use default minimum of 5 messages', async () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await conversationService.findByMinMessageCount(userId);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('message_count >= $2'),
        [userId, 5]
      );
    });

    it('should throw error on database failure', async () => {
      vi.mocked(mockPool.query).mockRejectedValueOnce(new Error('Database error'));

      await expect(
        conversationService.findByMinMessageCount('some-user-id')
      ).rejects.toThrow('Failed to find conversations');
    });
  });
});

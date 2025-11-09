import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PersonalityService } from './personality.service';
import { Pool } from 'pg';
import { clearAllMocks } from '../test/setup';
import type Anthropic from '@anthropic-ai/sdk';

/**
 * Unit tests for PersonalityService
 */

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn(),
    },
  }));
  return { default: MockAnthropic };
});

const mockPool = {
  query: vi.fn(),
} as unknown as Pool;

describe('PersonalityService', () => {
  let personalityService: PersonalityService;
  let mockAnthropicInstance: any;

  beforeEach(() => {
    clearAllMocks();
    personalityService = new PersonalityService(mockPool, 'test-api-key');
    // Get the mocked Anthropic instance
    mockAnthropicInstance = (personalityService as any).anthropic;
  });

  describe('createPersonalitySnapshot', () => {
    it('should create a personality snapshot from messages', async () => {
      const userId = 'user-123';
      const mockMessages = [
        { role: 'user', content: 'I love exploring new ideas and trying new things!' },
        { role: 'assistant', content: 'That's wonderful! What kind of new experiences interest you?' },
        { role: 'user', content: 'I enjoy learning about philosophy and different cultures.' },
      ];

      // Mock fetching messages
      vi.mocked(mockPool.query)
        .mockResolvedValueOnce({
          rows: mockMessages,
          rowCount: mockMessages.length,
        } as any)
        // Mock storing snapshot
        .mockResolvedValueOnce({
          rows: [{
            id: 'snapshot-123',
            user_id: userId,
            openness: 0.85,
            conscientiousness: 0.60,
            extraversion: 0.55,
            agreeableness: 0.75,
            neuroticism: 0.30,
            confidence: 0.70,
            sample_size: 3,
            reasoning: 'High openness indicated by curiosity and interest in new experiences',
            snapshot_at: new Date(),
            metadata: {},
          }],
          rowCount: 1,
        } as any);

      // Mock Claude API response
      mockAnthropicInstance.messages.create.mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: JSON.stringify({
            openness: 0.85,
            conscientiousness: 0.60,
            extraversion: 0.55,
            agreeableness: 0.75,
            neuroticism: 0.30,
            confidence: 0.70,
            reasoning: 'High openness indicated by curiosity and interest in new experiences',
          }),
        }],
      });

      const result = await personalityService.createPersonalitySnapshot({
        user_id: userId,
      });

      expect(result.id).toBe('snapshot-123');
      expect(result.user_id).toBe(userId);
      expect(result.openness).toBe(0.85);
      expect(result.confidence).toBe(0.70);
      expect(mockAnthropicInstance.messages.create).toHaveBeenCalled();
    });

    it('should throw error when no messages found', async () => {
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await expect(
        personalityService.createPersonalitySnapshot({ user_id: 'user-123' })
      ).rejects.toThrow('No messages found for personality assessment');
    });

    it('should handle Claude API errors', async () => {
      const mockMessages = [
        { role: 'user', content: 'Hello' },
      ];

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: mockMessages,
        rowCount: 1,
      } as any);

      mockAnthropicInstance.messages.create.mockRejectedValueOnce(
        new Error('API error')
      );

      await expect(
        personalityService.createPersonalitySnapshot({ user_id: 'user-123' })
      ).rejects.toThrow('Personality assessment failed');
    });

    it('should handle null trait values', async () => {
      const userId = 'user-123';
      const mockMessages = [{ role: 'user', content: 'Hi' }];

      vi.mocked(mockPool.query)
        .mockResolvedValueOnce({
          rows: mockMessages,
          rowCount: 1,
        } as any)
        .mockResolvedValueOnce({
          rows: [{
            id: 'snapshot-123',
            user_id: userId,
            openness: null,
            conscientiousness: 0.60,
            extraversion: null,
            agreeableness: 0.75,
            neuroticism: 0.30,
            confidence: 0.40,
            sample_size: 1,
            reasoning: 'Insufficient data for some traits',
            snapshot_at: new Date(),
            metadata: {},
          }],
          rowCount: 1,
        } as any);

      mockAnthropicInstance.messages.create.mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: JSON.stringify({
            openness: null,
            conscientiousness: 0.60,
            extraversion: null,
            agreeableness: 0.75,
            neuroticism: 0.30,
            confidence: 0.40,
            reasoning: 'Insufficient data for some traits',
          }),
        }],
      });

      const result = await personalityService.createPersonalitySnapshot({
        user_id: userId,
      });

      expect(result.openness).toBeNull();
      expect(result.extraversion).toBeNull();
      expect(result.conscientiousness).toBe(0.60);
    });
  });

  describe('getPersonalityStatistics', () => {
    it('should return personality statistics when available', async () => {
      const userId = 'user-123';
      const mockStats = {
        id: 'stats-123',
        user_id: userId,
        avg_openness: 0.75,
        avg_conscientiousness: 0.65,
        avg_extraversion: 0.55,
        avg_agreeableness: 0.70,
        avg_neuroticism: 0.35,
        std_openness: 0.10,
        std_conscientiousness: 0.08,
        std_extraversion: 0.12,
        std_agreeableness: 0.09,
        std_neuroticism: 0.11,
        sample_size: 10,
        window_days: 90,
        last_updated: new Date(),
        created_at: new Date(),
      };

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockStats],
        rowCount: 1,
      } as any);

      const result = await personalityService.getPersonalityStatistics({
        user_id: userId,
        window_days: 90,
      });

      expect(result).toEqual(mockStats);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('personality_statistics'),
        [userId, 90]
      );
    });

    it('should return null when no statistics available', async () => {
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await personalityService.getPersonalityStatistics({
        user_id: 'user-123',
        window_days: 90,
      });

      expect(result).toBeNull();
    });
  });

  describe('getLatestSnapshot', () => {
    it('should return latest snapshot when available', async () => {
      const userId = 'user-123';
      const mockSnapshot = {
        id: 'snapshot-123',
        user_id: userId,
        openness: 0.80,
        conscientiousness: 0.70,
        extraversion: 0.60,
        agreeableness: 0.75,
        neuroticism: 0.40,
        confidence: 0.80,
        sample_size: 20,
        reasoning: 'Test reasoning',
        snapshot_at: new Date(),
        metadata: {},
      };

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockSnapshot],
        rowCount: 1,
      } as any);

      const result = await personalityService.getLatestSnapshot(userId);

      expect(result).toEqual(mockSnapshot);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY snapshot_at DESC'),
        [userId]
      );
    });

    it('should return null when no snapshots exist', async () => {
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await personalityService.getLatestSnapshot('user-123');

      expect(result).toBeNull();
    });
  });

  describe('listSnapshots', () => {
    it('should list snapshots with pagination', async () => {
      const userId = 'user-123';
      const mockSnapshots = [
        {
          id: 'snapshot-1',
          user_id: userId,
          openness: 0.80,
          conscientiousness: 0.70,
          extraversion: 0.60,
          agreeableness: 0.75,
          neuroticism: 0.40,
          confidence: 0.80,
          sample_size: 20,
          reasoning: 'Recent assessment',
          snapshot_at: new Date(),
          metadata: {},
        },
        {
          id: 'snapshot-2',
          user_id: userId,
          openness: 0.75,
          conscientiousness: 0.65,
          extraversion: 0.55,
          agreeableness: 0.70,
          neuroticism: 0.45,
          confidence: 0.75,
          sample_size: 15,
          reasoning: 'Earlier assessment',
          snapshot_at: new Date(Date.now() - 86400000),
          metadata: {},
        },
      ];

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: mockSnapshots,
        rowCount: 2,
      } as any);

      const result = await personalityService.listSnapshots(userId, 10, 0);

      expect(result).toEqual(mockSnapshots);
      expect(result.length).toBe(2);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        [userId, 10, 0]
      );
    });
  });

  describe('getPersonalityDeviations', () => {
    it('should calculate deviations from baseline', async () => {
      const userId = 'user-123';

      // Mock statistics query
      const mockStats = {
        id: 'stats-123',
        user_id: userId,
        avg_openness: 0.70,
        avg_conscientiousness: 0.65,
        avg_extraversion: 0.55,
        avg_agreeableness: 0.70,
        avg_neuroticism: 0.35,
        std_openness: 0.10,
        std_conscientiousness: 0.10,
        std_extraversion: 0.10,
        std_agreeableness: 0.10,
        std_neuroticism: 0.10,
        sample_size: 10,
        window_days: 90,
        last_updated: new Date(),
        created_at: new Date(),
      };

      // Mock latest snapshot query
      const mockSnapshot = {
        id: 'snapshot-123',
        user_id: userId,
        openness: 0.90, // +0.20 from avg (2.0 std devs)
        conscientiousness: 0.65, // 0.0 from avg
        extraversion: 0.55, // 0.0 from avg
        agreeableness: 0.60, // -0.10 from avg (-1.0 std dev)
        neuroticism: 0.55, // +0.20 from avg (2.0 std devs)
        confidence: 0.80,
        sample_size: 20,
        reasoning: 'Test',
        snapshot_at: new Date(),
        metadata: {},
      };

      vi.mocked(mockPool.query)
        .mockResolvedValueOnce({ rows: [mockStats], rowCount: 1 } as any)
        .mockResolvedValueOnce({ rows: [mockSnapshot], rowCount: 1 } as any);

      const result = await personalityService.getPersonalityDeviations(userId);

      expect(result).not.toBeNull();
      expect(result!.openness).toBeCloseTo(2.0, 1);
      expect(result!.conscientiousness).toBeCloseTo(0.0, 1);
      expect(result!.agreeableness).toBeCloseTo(-1.0, 1);
      expect(result!.neuroticism).toBeCloseTo(2.0, 1);
    });

    it('should return null when no statistics available', async () => {
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await personalityService.getPersonalityDeviations('user-123');

      expect(result).toBeNull();
    });

    it('should return null when no snapshot available', async () => {
      const mockStats = {
        id: 'stats-123',
        user_id: 'user-123',
        avg_openness: 0.70,
        avg_conscientiousness: 0.65,
        avg_extraversion: 0.55,
        avg_agreeableness: 0.70,
        avg_neuroticism: 0.35,
        std_openness: 0.10,
        std_conscientiousness: 0.10,
        std_extraversion: 0.10,
        std_agreeableness: 0.10,
        std_neuroticism: 0.10,
        sample_size: 10,
        window_days: 90,
        last_updated: new Date(),
        created_at: new Date(),
      };

      vi.mocked(mockPool.query)
        .mockResolvedValueOnce({ rows: [mockStats], rowCount: 1 } as any)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

      const result = await personalityService.getPersonalityDeviations('user-123');

      expect(result).toBeNull();
    });
  });
});

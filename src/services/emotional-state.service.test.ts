import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EmotionalStateService } from './emotional-state.service';
import { PersonalityService } from './personality.service';
import { Pool } from 'pg';
import { clearAllMocks } from '../test/setup';

/**
 * Unit tests for EmotionalStateService
 */

const mockPool = {
  query: vi.fn(),
} as unknown as Pool;

// Mock PersonalityService
vi.mock('./personality.service');

describe('EmotionalStateService', () => {
  let emotionalStateService: EmotionalStateService;
  let mockPersonalityService: any;

  beforeEach(() => {
    clearAllMocks();
    emotionalStateService = new EmotionalStateService(mockPool, 'test-api-key');
    mockPersonalityService = (emotionalStateService as any).personalityService;
  });

  describe('detectEmotionalState', () => {
    it('should detect struggling state from high neuroticism and low agreeableness', async () => {
      const userId = 'user-123';

      // Mock baseline personality statistics
      const mockBaseline = {
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

      // Mock current snapshot with high neuroticism deviation
      const mockSnapshot = {
        id: 'snapshot-123',
        user_id: userId,
        openness: 0.70,
        conscientiousness: 0.65,
        extraversion: 0.55,
        agreeableness: 0.55, // -1.5 σ from avg (0.70)
        neuroticism: 0.55, // +2.0 σ from avg (0.35)
        confidence: 0.80,
        sample_size: 20,
        reasoning: 'Test',
        snapshot_at: new Date(),
        metadata: {},
      };

      mockPersonalityService.getPersonalityStatistics = vi.fn().mockResolvedValue(mockBaseline);
      mockPersonalityService.getLatestSnapshot = vi.fn().mockResolvedValue(mockSnapshot);

      // Mock emotional state creation
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [{
          id: 'state-123',
          user_id: userId,
          state_type: 'struggling',
          confidence: 0.67,
          trigger_type: 'personality_shift',
          indicators: {},
          recommended_approach: 'supportive',
          detected_at: new Date(),
          resolved_at: null,
          created_at: new Date(),
        }],
        rowCount: 1,
      } as any);

      const result = await emotionalStateService.detectEmotionalState({
        user_id: userId,
        min_confidence: 0.5,
      });

      expect(result.state).not.toBeNull();
      expect(result.state!.state_type).toBe('struggling');
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(mockPool.query).toHaveBeenCalled();
    });

    it('should detect energized state from high extraversion and openness', async () => {
      const userId = 'user-123';

      const mockBaseline = {
        id: 'stats-123',
        user_id: userId,
        avg_openness: 0.60,
        avg_conscientiousness: 0.65,
        avg_extraversion: 0.50,
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

      const mockSnapshot = {
        id: 'snapshot-123',
        user_id: userId,
        openness: 0.75, // +1.5 σ
        conscientiousness: 0.65,
        extraversion: 0.65, // +1.5 σ
        agreeableness: 0.70,
        neuroticism: 0.35,
        confidence: 0.80,
        sample_size: 20,
        reasoning: 'Test',
        snapshot_at: new Date(),
        metadata: {},
      };

      mockPersonalityService.getPersonalityStatistics = vi.fn().mockResolvedValue(mockBaseline);
      mockPersonalityService.getLatestSnapshot = vi.fn().mockResolvedValue(mockSnapshot);

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [{
          id: 'state-123',
          user_id: userId,
          state_type: 'energized',
          confidence: 0.50,
          trigger_type: 'personality_shift',
          indicators: {},
          recommended_approach: 'exploratory',
          detected_at: new Date(),
          resolved_at: null,
          created_at: new Date(),
        }],
        rowCount: 1,
      } as any);

      const result = await emotionalStateService.detectEmotionalState({
        user_id: userId,
        min_confidence: 0.5,
      });

      expect(result.state).not.toBeNull();
      expect(result.state!.state_type).toBe('energized');
    });

    it('should detect withdrawn state from low extraversion and high neuroticism', async () => {
      const userId = 'user-123';

      const mockBaseline = {
        id: 'stats-123',
        user_id: userId,
        avg_openness: 0.70,
        avg_conscientiousness: 0.65,
        avg_extraversion: 0.60,
        avg_agreeableness: 0.70,
        avg_neuroticism: 0.30,
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

      const mockSnapshot = {
        id: 'snapshot-123',
        user_id: userId,
        openness: 0.70,
        conscientiousness: 0.65,
        extraversion: 0.35, // -2.5 σ
        agreeableness: 0.70,
        neuroticism: 0.45, // +1.5 σ
        confidence: 0.80,
        sample_size: 20,
        reasoning: 'Test',
        snapshot_at: new Date(),
        metadata: {},
      };

      mockPersonalityService.getPersonalityStatistics = vi.fn().mockResolvedValue(mockBaseline);
      mockPersonalityService.getLatestSnapshot = vi.fn().mockResolvedValue(mockSnapshot);

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [{
          id: 'state-123',
          user_id: userId,
          state_type: 'withdrawn',
          confidence: 0.67,
          trigger_type: 'personality_shift',
          indicators: {},
          recommended_approach: 'minimal',
          detected_at: new Date(),
          resolved_at: null,
          created_at: new Date(),
        }],
        rowCount: 1,
      } as any);

      const result = await emotionalStateService.detectEmotionalState({
        user_id: userId,
        min_confidence: 0.5,
      });

      expect(result.state).not.toBeNull();
      expect(result.state!.state_type).toBe('withdrawn');
    });

    it('should detect reflective state from high openness, low extraversion, stable neuroticism', async () => {
      const userId = 'user-123';

      const mockBaseline = {
        id: 'stats-123',
        user_id: userId,
        avg_openness: 0.60,
        avg_conscientiousness: 0.65,
        avg_extraversion: 0.60,
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

      const mockSnapshot = {
        id: 'snapshot-123',
        user_id: userId,
        openness: 0.75, // +1.5 σ
        conscientiousness: 0.65,
        extraversion: 0.45, // -1.5 σ
        agreeableness: 0.70,
        neuroticism: 0.35, // stable
        confidence: 0.80,
        sample_size: 20,
        reasoning: 'Test',
        snapshot_at: new Date(),
        metadata: {},
      };

      mockPersonalityService.getPersonalityStatistics = vi.fn().mockResolvedValue(mockBaseline);
      mockPersonalityService.getLatestSnapshot = vi.fn().mockResolvedValue(mockSnapshot);

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [{
          id: 'state-123',
          user_id: userId,
          state_type: 'reflective',
          confidence: 0.70,
          trigger_type: 'personality_shift',
          indicators: {},
          recommended_approach: 'analytical',
          detected_at: new Date(),
          resolved_at: null,
          created_at: new Date(),
        }],
        rowCount: 1,
      } as any);

      const result = await emotionalStateService.detectEmotionalState({
        user_id: userId,
        min_confidence: 0.5,
      });

      expect(result.state).not.toBeNull();
      expect(result.state!.state_type).toBe('reflective');
    });

    it('should return null when no significant deviations', async () => {
      const userId = 'user-123';

      const mockBaseline = {
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

      // Snapshot close to baseline (no significant deviations)
      const mockSnapshot = {
        id: 'snapshot-123',
        user_id: userId,
        openness: 0.72,
        conscientiousness: 0.66,
        extraversion: 0.56,
        agreeableness: 0.71,
        neuroticism: 0.36,
        confidence: 0.80,
        sample_size: 20,
        reasoning: 'Test',
        snapshot_at: new Date(),
        metadata: {},
      };

      mockPersonalityService.getPersonalityStatistics = vi.fn().mockResolvedValue(mockBaseline);
      mockPersonalityService.getLatestSnapshot = vi.fn().mockResolvedValue(mockSnapshot);

      const result = await emotionalStateService.detectEmotionalState({
        user_id: userId,
        min_confidence: 0.5,
      });

      expect(result.state).toBeNull();
      expect(result.reasoning).toContain('No significant deviations');
    });

    it('should return null when insufficient data', async () => {
      mockPersonalityService.getPersonalityStatistics = vi.fn().mockResolvedValue(null);
      mockPersonalityService.getLatestSnapshot = vi.fn().mockResolvedValue(null);

      const result = await emotionalStateService.detectEmotionalState({
        user_id: 'user-123',
        min_confidence: 0.5,
      });

      expect(result.state).toBeNull();
      expect(result.reasoning).toContain('Insufficient data');
    });
  });

  describe('getActiveEmotionalState', () => {
    it('should return active emotional state when exists', async () => {
      const userId = 'user-123';
      const mockState = {
        id: 'state-123',
        user_id: userId,
        state_type: 'struggling',
        confidence: 0.80,
        trigger_type: 'personality_shift',
        indicators: {},
        recommended_approach: 'supportive',
        detected_at: new Date(),
        resolved_at: null,
        created_at: new Date(),
      };

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockState],
        rowCount: 1,
      } as any);

      const result = await emotionalStateService.getActiveEmotionalState(userId);

      expect(result).toEqual(mockState);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('resolved_at IS NULL'),
        [userId]
      );
    });

    it('should return null when no active state', async () => {
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await emotionalStateService.getActiveEmotionalState('user-123');

      expect(result).toBeNull();
    });
  });

  describe('resolveEmotionalState', () => {
    it('should resolve an active emotional state', async () => {
      const stateId = 'state-123';
      const mockResolvedState = {
        id: stateId,
        user_id: 'user-123',
        state_type: 'struggling',
        confidence: 0.80,
        trigger_type: 'personality_shift',
        indicators: {},
        recommended_approach: 'supportive',
        detected_at: new Date(),
        resolved_at: new Date(),
        created_at: new Date(),
      };

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockResolvedState],
        rowCount: 1,
      } as any);

      const result = await emotionalStateService.resolveEmotionalState(stateId);

      expect(result.resolved_at).not.toBeNull();
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE emotional_states'),
        [stateId]
      );
    });

    it('should throw error when state not found', async () => {
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await expect(
        emotionalStateService.resolveEmotionalState('invalid-id')
      ).rejects.toThrow('not found or already resolved');
    });
  });

  describe('listEmotionalStates', () => {
    it('should list emotional states for a user', async () => {
      const userId = 'user-123';
      const mockStates = [
        {
          id: 'state-1',
          user_id: userId,
          state_type: 'struggling',
          confidence: 0.80,
          trigger_type: 'personality_shift',
          indicators: {},
          recommended_approach: 'supportive',
          detected_at: new Date(),
          resolved_at: null,
          created_at: new Date(),
        },
        {
          id: 'state-2',
          user_id: userId,
          state_type: 'energized',
          confidence: 0.75,
          trigger_type: 'personality_shift',
          indicators: {},
          recommended_approach: 'exploratory',
          detected_at: new Date(Date.now() - 86400000),
          resolved_at: new Date(),
          created_at: new Date(Date.now() - 86400000),
        },
      ];

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: mockStates,
        rowCount: 2,
      } as any);

      const result = await emotionalStateService.listEmotionalStates(userId, true, 10, 0);

      expect(result).toEqual(mockStates);
      expect(result.length).toBe(2);
    });

    it('should filter out resolved states when includeResolved is false', async () => {
      const userId = 'user-123';
      const activeStates = [
        {
          id: 'state-1',
          user_id: userId,
          state_type: 'struggling',
          confidence: 0.80,
          trigger_type: 'personality_shift',
          indicators: {},
          recommended_approach: 'supportive',
          detected_at: new Date(),
          resolved_at: null,
          created_at: new Date(),
        },
      ];

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: activeStates,
        rowCount: 1,
      } as any);

      const result = await emotionalStateService.listEmotionalStates(userId, false, 10, 0);

      expect(result.length).toBe(1);
      expect(result[0].resolved_at).toBeNull();
    });
  });
});

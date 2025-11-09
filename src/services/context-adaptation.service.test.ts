import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContextAdaptationService } from './context-adaptation.service';
import { EmotionalStateService } from './emotional-state.service';
import { Pool } from 'pg';
import { clearAllMocks } from '../test/setup';

/**
 * Unit tests for ContextAdaptationService
 */

const mockPool = {
  query: vi.fn(),
} as unknown as Pool;

// Mock EmotionalStateService
vi.mock('./emotional-state.service');

describe('ContextAdaptationService', () => {
  let contextAdaptationService: ContextAdaptationService;

  beforeEach(() => {
    clearAllMocks();
    contextAdaptationService = new ContextAdaptationService(mockPool, 'test-api-key');
  });

  describe('generateAdaptation', () => {
    it('should generate adaptation for struggling state', async () => {
      const userId = 'user-123';
      const stateId = 'state-123';

      const mockEmotionalState = {
        id: stateId,
        user_id: userId,
        conversation_id: null,
        state_type: 'struggling' as const,
        confidence: 0.85,
        trigger_type: 'personality_shift' as const,
        indicators: {},
        detected_at: new Date(),
        resolved_at: null,
        recommended_approach: 'supportive' as const,
        created_at: new Date(),
      };

      // Mock fetching emotional state
      vi.mocked(mockPool.query)
        .mockResolvedValueOnce({
          rows: [mockEmotionalState],
          rowCount: 1,
        } as any)
        // Mock creating adaptation
        .mockResolvedValueOnce({
          rows: [{
            id: 'adaptation-123',
            user_id: userId,
            emotional_state_id: stateId,
            morning_schedule: '08:00',
            midday_schedule: 'disabled',
            evening_schedule: '20:00',
            night_schedule: 'disabled',
            temperature_modifier: 0.6,
            tone_directive: expect.any(String),
            curiosity_approach: 'supportive',
            research_topics: [],
            research_avoidance: [],
            research_priority: 8,
            adaptation_reasoning: expect.any(String),
            active_from: new Date(),
            active_until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            created_at: new Date(),
          }],
          rowCount: 1,
        } as any);

      const result = await contextAdaptationService.generateAdaptation({
        user_id: userId,
        emotional_state_id: stateId,
      });

      expect(result.id).toBe('adaptation-123');
      expect(result.temperature_modifier).toBe(0.6);
      expect(result.midday_schedule).toBe('disabled');
      expect(result.curiosity_approach).toBe('supportive');
    });

    it('should generate adaptation for energized state', async () => {
      const userId = 'user-123';
      const stateId = 'state-123';

      const mockEmotionalState = {
        id: stateId,
        user_id: userId,
        conversation_id: null,
        state_type: 'energized' as const,
        confidence: 0.75,
        trigger_type: 'personality_shift' as const,
        indicators: {},
        detected_at: new Date(),
        resolved_at: null,
        recommended_approach: 'exploratory' as const,
        created_at: new Date(),
      };

      vi.mocked(mockPool.query)
        .mockResolvedValueOnce({
          rows: [mockEmotionalState],
          rowCount: 1,
        } as any)
        .mockResolvedValueOnce({
          rows: [{
            id: 'adaptation-123',
            user_id: userId,
            emotional_state_id: stateId,
            morning_schedule: '07:00',
            midday_schedule: '12:30',
            evening_schedule: '20:00',
            night_schedule: '03:00',
            temperature_modifier: 1.2,
            tone_directive: expect.any(String),
            curiosity_approach: 'exploratory',
            research_topics: [],
            research_avoidance: [],
            research_priority: 9,
            adaptation_reasoning: expect.any(String),
            active_from: new Date(),
            active_until: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
            created_at: new Date(),
          }],
          rowCount: 1,
        } as any);

      const result = await contextAdaptationService.generateAdaptation({
        user_id: userId,
        emotional_state_id: stateId,
      });

      expect(result.temperature_modifier).toBe(1.2);
      expect(result.night_schedule).toBe('03:00');
      expect(result.curiosity_approach).toBe('exploratory');
      expect(result.research_priority).toBe(9);
    });

    it('should generate adaptation for withdrawn state', async () => {
      const userId = 'user-123';
      const stateId = 'state-123';

      const mockEmotionalState = {
        id: stateId,
        user_id: userId,
        conversation_id: null,
        state_type: 'withdrawn' as const,
        confidence: 0.80,
        trigger_type: 'personality_shift' as const,
        indicators: {},
        detected_at: new Date(),
        resolved_at: null,
        recommended_approach: 'minimal' as const,
        created_at: new Date(),
      };

      vi.mocked(mockPool.query)
        .mockResolvedValueOnce({
          rows: [mockEmotionalState],
          rowCount: 1,
        } as any)
        .mockResolvedValueOnce({
          rows: [{
            id: 'adaptation-123',
            user_id: userId,
            emotional_state_id: stateId,
            morning_schedule: 'disabled',
            midday_schedule: 'disabled',
            evening_schedule: '21:00',
            night_schedule: 'disabled',
            temperature_modifier: 0.5,
            tone_directive: expect.any(String),
            curiosity_approach: 'minimal',
            research_topics: [],
            research_avoidance: ['all'],
            research_priority: 2,
            adaptation_reasoning: expect.any(String),
            active_from: new Date(),
            active_until: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
            created_at: new Date(),
          }],
          rowCount: 1,
        } as any);

      const result = await contextAdaptationService.generateAdaptation({
        user_id: userId,
        emotional_state_id: stateId,
      });

      expect(result.morning_schedule).toBe('disabled');
      expect(result.midday_schedule).toBe('disabled');
      expect(result.temperature_modifier).toBe(0.5);
      expect(result.curiosity_approach).toBe('minimal');
    });

    it('should generate adaptation for reflective state', async () => {
      const userId = 'user-123';
      const stateId = 'state-123';

      const mockEmotionalState = {
        id: stateId,
        user_id: userId,
        conversation_id: null,
        state_type: 'reflective' as const,
        confidence: 0.70,
        trigger_type: 'personality_shift' as const,
        indicators: {},
        detected_at: new Date(),
        resolved_at: null,
        recommended_approach: 'analytical' as const,
        created_at: new Date(),
      };

      vi.mocked(mockPool.query)
        .mockResolvedValueOnce({
          rows: [mockEmotionalState],
          rowCount: 1,
        } as any)
        .mockResolvedValueOnce({
          rows: [{
            id: 'adaptation-123',
            user_id: userId,
            emotional_state_id: stateId,
            morning_schedule: '07:30',
            midday_schedule: 'disabled',
            evening_schedule: '20:00',
            night_schedule: '03:00',
            temperature_modifier: 0.9,
            tone_directive: expect.any(String),
            curiosity_approach: 'analytical',
            research_topics: [],
            research_avoidance: ['superficial topics'],
            research_priority: 7,
            adaptation_reasoning: expect.any(String),
            active_from: new Date(),
            active_until: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000),
            created_at: new Date(),
          }],
          rowCount: 1,
        } as any);

      const result = await contextAdaptationService.generateAdaptation({
        user_id: userId,
        emotional_state_id: stateId,
      });

      expect(result.midday_schedule).toBe('disabled');
      expect(result.night_schedule).toBe('03:00');
      expect(result.temperature_modifier).toBe(0.9);
      expect(result.curiosity_approach).toBe('analytical');
    });

    it('should throw error when emotional state not found', async () => {
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await expect(
        contextAdaptationService.generateAdaptation({
          user_id: 'user-123',
          emotional_state_id: 'invalid-id',
        })
      ).rejects.toThrow('Emotional state not found');
    });
  });

  describe('getActiveAdaptation', () => {
    it('should return active adaptation when exists', async () => {
      const userId = 'user-123';
      const mockAdaptation = {
        id: 'adaptation-123',
        user_id: userId,
        emotional_state_id: 'state-123',
        morning_schedule: '08:00',
        midday_schedule: 'disabled',
        evening_schedule: '20:00',
        night_schedule: 'disabled',
        temperature_modifier: 0.6,
        tone_directive: 'Be supportive',
        curiosity_approach: 'supportive',
        research_topics: [],
        research_avoidance: [],
        research_priority: 8,
        adaptation_reasoning: 'Test',
        active_from: new Date(),
        active_until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        created_at: new Date(),
      };

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockAdaptation],
        rowCount: 1,
      } as any);

      const result = await contextAdaptationService.getActiveAdaptation(userId);

      expect(result).toEqual(mockAdaptation);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('active_until IS NULL OR active_until > NOW()'),
        [userId]
      );
    });

    it('should return null when no active adaptation', async () => {
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await contextAdaptationService.getActiveAdaptation('user-123');

      expect(result).toBeNull();
    });
  });

  describe('listAdaptations', () => {
    it('should list adaptations for a user', async () => {
      const userId = 'user-123';
      const mockAdaptations = [
        {
          id: 'adaptation-1',
          user_id: userId,
          emotional_state_id: 'state-1',
          morning_schedule: '08:00',
          midday_schedule: 'disabled',
          evening_schedule: '20:00',
          night_schedule: 'disabled',
          temperature_modifier: 0.6,
          tone_directive: 'Be supportive',
          curiosity_approach: 'supportive',
          research_topics: [],
          research_avoidance: [],
          research_priority: 8,
          adaptation_reasoning: 'Test',
          active_from: new Date(),
          active_until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          created_at: new Date(),
        },
        {
          id: 'adaptation-2',
          user_id: userId,
          emotional_state_id: 'state-2',
          morning_schedule: '07:00',
          midday_schedule: '12:30',
          evening_schedule: '20:00',
          night_schedule: '03:00',
          temperature_modifier: 1.2,
          tone_directive: 'Be exploratory',
          curiosity_approach: 'exploratory',
          research_topics: [],
          research_avoidance: [],
          research_priority: 9,
          adaptation_reasoning: 'Test',
          active_from: new Date(Date.now() - 86400000),
          active_until: new Date(Date.now() - 1000),
          created_at: new Date(Date.now() - 86400000),
        },
      ];

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: mockAdaptations,
        rowCount: 2,
      } as any);

      const result = await contextAdaptationService.listAdaptations(userId, true, 10, 0);

      expect(result).toEqual(mockAdaptations);
      expect(result.length).toBe(2);
    });

    it('should filter out expired adaptations when includeExpired is false', async () => {
      const userId = 'user-123';
      const activeAdaptations = [
        {
          id: 'adaptation-1',
          user_id: userId,
          emotional_state_id: 'state-1',
          morning_schedule: '08:00',
          midday_schedule: 'disabled',
          evening_schedule: '20:00',
          night_schedule: 'disabled',
          temperature_modifier: 0.6,
          tone_directive: 'Be supportive',
          curiosity_approach: 'supportive',
          research_topics: [],
          research_avoidance: [],
          research_priority: 8,
          adaptation_reasoning: 'Test',
          active_from: new Date(),
          active_until: null, // Never expires
          created_at: new Date(),
        },
      ];

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: activeAdaptations,
        rowCount: 1,
      } as any);

      const result = await contextAdaptationService.listAdaptations(userId, false, 10, 0);

      expect(result.length).toBe(1);
      expect(result[0].active_until).toBeNull();
    });
  });

  describe('expireAdaptation', () => {
    it('should expire an active adaptation', async () => {
      const adaptationId = 'adaptation-123';
      const mockExpiredAdaptation = {
        id: adaptationId,
        user_id: 'user-123',
        emotional_state_id: 'state-123',
        morning_schedule: '08:00',
        midday_schedule: 'disabled',
        evening_schedule: '20:00',
        night_schedule: 'disabled',
        temperature_modifier: 0.6,
        tone_directive: 'Be supportive',
        curiosity_approach: 'supportive',
        research_topics: [],
        research_avoidance: [],
        research_priority: 8,
        adaptation_reasoning: 'Test',
        active_from: new Date(),
        active_until: new Date(),
        created_at: new Date(),
      };

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockExpiredAdaptation],
        rowCount: 1,
      } as any);

      const result = await contextAdaptationService.expireAdaptation(adaptationId);

      expect(result.active_until).not.toBeNull();
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE context_adaptations'),
        [adaptationId]
      );
    });

    it('should throw error when adaptation not found', async () => {
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await expect(
        contextAdaptationService.expireAdaptation('invalid-id')
      ).rejects.toThrow('Context adaptation not found');
    });
  });
});

import { Pool } from 'pg';
import { logger } from '../logger';
import { EmotionalState, PersonalityStatistics, PersonalitySnapshot } from '../types/database';
import {
  DetectEmotionalStateInput,
  CreateEmotionalStateInput,
  EmotionalStateType,
  RecommendedApproach,
} from '../validation/emotional-state.validation';
import { PersonalityService } from './personality.service';

/**
 * Personality deviations (in standard deviations from baseline)
 */
export interface PersonalityDeviations {
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
}

/**
 * Emotional state detection result
 */
export interface EmotionalStateDetection {
  state: EmotionalState | null;
  reasoning: string;
  confidence: number;
}

/**
 * Conversation pattern analysis result
 */
interface ConversationPatternAnalysis {
  lateNightConversations: number;
  times: Date[];
  totalConversations: number;
}

/**
 * EmotionalStateService
 *
 * Detects user emotional states by analyzing personality shifts
 * and conversation patterns. Implements the detection logic from
 * the Emotional Intelligence Guide.
 */
export class EmotionalStateService {
  private pool: Pool;
  private personalityService: PersonalityService;

  // Detection thresholds (in standard deviations)
  private readonly SIGNIFICANT_THRESHOLD = 2.0; // 2 std dev = top 2.5%
  private readonly MODERATE_THRESHOLD = 1.5; // 1.5 std dev = top 7%

  constructor(pool: Pool, anthropicApiKey?: string) {
    this.pool = pool;
    this.personalityService = new PersonalityService(pool, anthropicApiKey);
  }

  /**
   * Detects emotional state for a user by analyzing personality shifts
   *
   * @param input - User ID and detection parameters
   * @returns Detected emotional state or null if no significant state found
   */
  async detectEmotionalState(input: DetectEmotionalStateInput): Promise<EmotionalStateDetection> {
    try {
      logger.info('Detecting emotional state', {
        user_id: input.user_id,
        conversation_id: input.conversation_id,
      });

      // Get user's personality baseline
      const baseline = await this.personalityService.getPersonalityStatistics({
        user_id: input.user_id,
        window_days: 90,
      });

      // Get most recent personality snapshot
      const current = await this.personalityService.getLatestSnapshot(input.user_id);

      if (!baseline || !current) {
        return {
          state: null,
          reasoning: 'Insufficient data for emotional state detection (need baseline and recent snapshot)',
          confidence: 0,
        };
      }

      // Calculate deviations from baseline
      const deviations = this.calculateDeviations(current, baseline);

      logger.debug('Personality deviations calculated', {
        user_id: input.user_id,
        deviations,
      });

      // Pattern matching for emotional states
      let detection = await this.matchEmotionalPattern(input.user_id, deviations, input.conversation_id);

      // If no state detected from personality alone, check conversation patterns
      if (!detection.state && deviations.neuroticism > 1.0) {
        const conversationContext = await this.analyzeRecentConversations(input.user_id);

        // Late-night conversations may indicate emotional distress
        if (conversationContext.lateNightConversations >= 2) {
          detection = {
            state: await this.createEmotionalState({
              user_id: input.user_id,
              conversation_id: input.conversation_id,
              state_type: 'struggling',
              confidence: 0.70,
              trigger_type: 'conversation_pattern',
              indicators: {
                personality_deltas: deviations,
                conversation_times: conversationContext.times,
                late_night_count: conversationContext.lateNightConversations,
              },
              recommended_approach: 'gentle',
            }),
            reasoning: `Multiple late-night conversations (${conversationContext.lateNightConversations}) combined with elevated neuroticism`,
            confidence: 0.70,
          };
        }
      }

      // Only store states that meet minimum confidence threshold
      if (detection.state && detection.confidence >= input.min_confidence) {
        logger.info('Emotional state detected', {
          user_id: input.user_id,
          state_type: detection.state.state_type,
          confidence: detection.confidence,
        });
      } else {
        logger.debug('No significant emotional state detected', {
          user_id: input.user_id,
        });
      }

      return detection;
    } catch (error: any) {
      logger.error('Error detecting emotional state:', error);
      throw new Error(`Failed to detect emotional state: ${error.message}`);
    }
  }

  /**
   * Creates an emotional state manually
   *
   * @param input - Emotional state data
   * @returns The created emotional state
   */
  async createEmotionalState(input: CreateEmotionalStateInput): Promise<EmotionalState> {
    try {
      const result = await this.pool.query<EmotionalState>(
        `INSERT INTO emotional_states (
          user_id, conversation_id, state_type, confidence,
          trigger_type, indicators, recommended_approach
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *`,
        [
          input.user_id,
          input.conversation_id || null,
          input.state_type,
          input.confidence,
          input.trigger_type,
          JSON.stringify(input.indicators),
          input.recommended_approach || null,
        ]
      );

      return result.rows[0];
    } catch (error: any) {
      logger.error('Error creating emotional state:', error);
      throw new Error(`Failed to create emotional state: ${error.message}`);
    }
  }

  /**
   * Gets the active emotional state for a user
   *
   * @param userId - User ID
   * @returns Active emotional state or null
   */
  async getActiveEmotionalState(userId: string): Promise<EmotionalState | null> {
    try {
      const result = await this.pool.query<EmotionalState>(
        `SELECT * FROM emotional_states
         WHERE user_id = $1 AND resolved_at IS NULL
         ORDER BY detected_at DESC
         LIMIT 1`,
        [userId]
      );

      return result.rows[0] || null;
    } catch (error: any) {
      logger.error('Error fetching active emotional state:', error);
      throw new Error(`Failed to fetch active emotional state: ${error.message}`);
    }
  }

  /**
   * Resolves an emotional state (marks it as resolved)
   *
   * @param stateId - Emotional state ID
   * @returns The resolved emotional state
   */
  async resolveEmotionalState(stateId: string): Promise<EmotionalState> {
    try {
      const result = await this.pool.query<EmotionalState>(
        `UPDATE emotional_states
         SET resolved_at = NOW()
         WHERE id = $1 AND resolved_at IS NULL
         RETURNING *`,
        [stateId]
      );

      if (result.rows.length === 0) {
        throw new Error('Emotional state not found or already resolved');
      }

      logger.info('Emotional state resolved', { state_id: stateId });

      return result.rows[0];
    } catch (error: any) {
      logger.error('Error resolving emotional state:', error);
      throw new Error(`Failed to resolve emotional state: ${error.message}`);
    }
  }

  /**
   * Lists emotional states for a user
   *
   * @param userId - User ID
   * @param includeResolved - Whether to include resolved states
   * @param limit - Maximum number of states to return
   * @param offset - Offset for pagination
   * @returns Array of emotional states
   */
  async listEmotionalStates(
    userId: string,
    includeResolved: boolean = false,
    limit: number = 20,
    offset: number = 0
  ): Promise<EmotionalState[]> {
    try {
      let query = `
        SELECT * FROM emotional_states
        WHERE user_id = $1
      `;

      if (!includeResolved) {
        query += ' AND resolved_at IS NULL';
      }

      query += ` ORDER BY detected_at DESC LIMIT $2 OFFSET $3`;

      const result = await this.pool.query<EmotionalState>(query, [userId, limit, offset]);

      return result.rows;
    } catch (error: any) {
      logger.error('Error listing emotional states:', error);
      throw new Error(`Failed to list emotional states: ${error.message}`);
    }
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Calculates personality deviations from baseline (in standard deviations)
   */
  private calculateDeviations(
    current: PersonalitySnapshot,
    baseline: PersonalityStatistics
  ): PersonalityDeviations {
    return {
      openness: this.calculateDeviation(current.openness, baseline.avg_openness, baseline.std_openness),
      conscientiousness: this.calculateDeviation(
        current.conscientiousness,
        baseline.avg_conscientiousness,
        baseline.std_conscientiousness
      ),
      extraversion: this.calculateDeviation(current.extraversion, baseline.avg_extraversion, baseline.std_extraversion),
      agreeableness: this.calculateDeviation(
        current.agreeableness,
        baseline.avg_agreeableness,
        baseline.std_agreeableness
      ),
      neuroticism: this.calculateDeviation(current.neuroticism, baseline.avg_neuroticism, baseline.std_neuroticism),
    };
  }

  /**
   * Calculates deviation in standard deviations
   */
  private calculateDeviation(currentValue: number | null, average: number, stdDev: number): number {
    if (currentValue === null || stdDev === 0) {
      return 0;
    }

    return (currentValue - average) / stdDev;
  }

  /**
   * Pattern matches personality deviations to emotional states
   */
  private async matchEmotionalPattern(
    userId: string,
    deviations: PersonalityDeviations,
    conversationId?: string
  ): Promise<EmotionalStateDetection> {
    // STRUGGLING: High neuroticism + low agreeableness
    if (
      deviations.neuroticism > this.SIGNIFICANT_THRESHOLD &&
      deviations.agreeableness < -this.MODERATE_THRESHOLD
    ) {
      const state = await this.createEmotionalState({
        user_id: userId,
        conversation_id: conversationId,
        state_type: 'struggling',
        confidence: Math.min(Math.abs(deviations.neuroticism) / 3, 1.0),
        trigger_type: 'personality_shift',
        indicators: {
          personality_deltas: deviations,
          reasoning: `Significant neuroticism increase (+${deviations.neuroticism.toFixed(2)} σ) with decreased agreeableness`,
        },
        recommended_approach: 'supportive',
      });

      return {
        state,
        reasoning: 'User showing signs of emotional distress',
        confidence: 0.85,
      };
    }

    // ENERGIZED: High extraversion + high openness
    if (deviations.extraversion > this.MODERATE_THRESHOLD && deviations.openness > this.MODERATE_THRESHOLD) {
      const state = await this.createEmotionalState({
        user_id: userId,
        conversation_id: conversationId,
        state_type: 'energized',
        confidence: Math.min((Math.abs(deviations.extraversion) + Math.abs(deviations.openness)) / 6, 1.0),
        trigger_type: 'personality_shift',
        indicators: {
          personality_deltas: deviations,
          reasoning: 'Increased extraversion and openness suggest high energy and curiosity',
        },
        recommended_approach: 'exploratory',
      });

      return {
        state,
        reasoning: 'User appears energized and open to exploration',
        confidence: 0.75,
      };
    }

    // WITHDRAWN: Low extraversion + high neuroticism
    if (deviations.extraversion < -this.SIGNIFICANT_THRESHOLD && deviations.neuroticism > this.MODERATE_THRESHOLD) {
      const state = await this.createEmotionalState({
        user_id: userId,
        conversation_id: conversationId,
        state_type: 'withdrawn',
        confidence: Math.min((Math.abs(deviations.extraversion) + Math.abs(deviations.neuroticism)) / 6, 1.0),
        trigger_type: 'personality_shift',
        indicators: {
          personality_deltas: deviations,
          reasoning: 'Decreased social engagement with elevated anxiety',
        },
        recommended_approach: 'minimal',
      });

      return {
        state,
        reasoning: 'User may need space and minimal intrusion',
        confidence: 0.80,
      };
    }

    // REFLECTIVE: High openness + low extraversion, stable neuroticism
    if (
      deviations.openness > this.MODERATE_THRESHOLD &&
      deviations.extraversion < -this.MODERATE_THRESHOLD &&
      Math.abs(deviations.neuroticism) < 1.0
    ) {
      const state = await this.createEmotionalState({
        user_id: userId,
        conversation_id: conversationId,
        state_type: 'reflective',
        confidence: 0.70,
        trigger_type: 'personality_shift',
        indicators: {
          personality_deltas: deviations,
          reasoning: 'Increased openness with reduced social engagement, but stable mood',
        },
        recommended_approach: 'analytical',
      });

      return {
        state,
        reasoning: 'User in contemplative state',
        confidence: 0.70,
      };
    }

    // No significant emotional state detected
    return {
      state: null,
      reasoning: 'No significant deviations from baseline personality',
      confidence: 0,
    };
  }

  /**
   * Analyzes recent conversation patterns
   */
  private async analyzeRecentConversations(userId: string): Promise<ConversationPatternAnalysis> {
    try {
      const result = await this.pool.query(
        `SELECT time_of_day, created_at
         FROM conversations
         WHERE user_id = $1
         AND started_at >= NOW() - INTERVAL '7 days'
         ORDER BY started_at DESC`,
        [userId]
      );

      const lateNightConversations = result.rows.filter((row) => row.time_of_day === 'late_night').length;

      const times = result.rows.map((row) => row.created_at);

      return {
        lateNightConversations,
        times,
        totalConversations: result.rows.length,
      };
    } catch (error: any) {
      logger.error('Error analyzing conversation patterns:', error);
      return {
        lateNightConversations: 0,
        times: [],
        totalConversations: 0,
      };
    }
  }
}

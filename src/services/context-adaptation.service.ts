import { Pool } from 'pg';
import { logger } from '../logger';
import { ContextAdaptation, EmotionalState } from '../types/database';
import {
  GenerateAdaptationInput,
  CreateContextAdaptationInput,
} from '../validation/context-adaptation.validation';
import { EmotionalStateService } from './emotional-state.service';

/**
 * ContextAdaptationService
 *
 * Generates behavior adaptations based on user emotional states.
 * Adjusts:
 * - Circadian agent schedules
 * - Temperature/tone of responses
 * - Research topics and approach
 */
export class ContextAdaptationService {
  private pool: Pool;
  private emotionalStateService: EmotionalStateService;

  constructor(pool: Pool, anthropicApiKey?: string) {
    this.pool = pool;
    this.emotionalStateService = new EmotionalStateService(pool, anthropicApiKey);
  }

  /**
   * Generates a context adaptation based on an emotional state
   *
   * @param input - User ID and emotional state ID
   * @returns The generated context adaptation
   */
  async generateAdaptation(input: GenerateAdaptationInput): Promise<ContextAdaptation> {
    try {
      // Get the emotional state
      const emotionalState = await this.getEmotionalState(input.emotional_state_id);

      if (!emotionalState) {
        throw new Error('Emotional state not found');
      }

      logger.info('Generating context adaptation', {
        user_id: input.user_id,
        emotional_state_id: input.emotional_state_id,
        state_type: emotionalState.state_type,
      });

      // Generate adaptation based on state type
      const adaptationData = this.buildAdaptationForState(input.user_id, emotionalState);

      // Create and store adaptation
      const adaptation = await this.createContextAdaptation(adaptationData);

      logger.info('Context adaptation created', {
        adaptation_id: adaptation.id,
        user_id: input.user_id,
        state_type: emotionalState.state_type,
      });

      return adaptation;
    } catch (error: any) {
      logger.error('Error generating context adaptation:', error);
      throw new Error(`Failed to generate adaptation: ${error.message}`);
    }
  }

  /**
   * Creates a context adaptation manually
   *
   * @param input - Context adaptation data
   * @returns The created context adaptation
   */
  async createContextAdaptation(input: CreateContextAdaptationInput): Promise<ContextAdaptation> {
    try {
      const result = await this.pool.query<ContextAdaptation>(
        `INSERT INTO context_adaptations (
          user_id, emotional_state_id,
          morning_schedule, midday_schedule, evening_schedule, night_schedule,
          temperature_modifier, tone_directive,
          curiosity_approach, research_topics, research_avoidance, research_priority,
          adaptation_reasoning, active_until
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING *`,
        [
          input.user_id,
          input.emotional_state_id || null,
          input.morning_schedule || null,
          input.midday_schedule || null,
          input.evening_schedule || null,
          input.night_schedule || null,
          input.temperature_modifier,
          input.tone_directive || null,
          input.curiosity_approach || null,
          input.research_topics ? JSON.stringify(input.research_topics) : null,
          input.research_avoidance ? JSON.stringify(input.research_avoidance) : null,
          input.research_priority,
          input.adaptation_reasoning || null,
          input.active_until || null,
        ]
      );

      return result.rows[0];
    } catch (error: any) {
      logger.error('Error creating context adaptation:', error);
      throw new Error(`Failed to create context adaptation: ${error.message}`);
    }
  }

  /**
   * Gets the active context adaptation for a user
   *
   * @param userId - User ID
   * @returns Active context adaptation or null
   */
  async getActiveAdaptation(userId: string): Promise<ContextAdaptation | null> {
    try {
      const result = await this.pool.query<ContextAdaptation>(
        `SELECT * FROM context_adaptations
         WHERE user_id = $1
         AND active_from <= NOW()
         AND (active_until IS NULL OR active_until > NOW())
         ORDER BY active_from DESC
         LIMIT 1`,
        [userId]
      );

      return result.rows[0] || null;
    } catch (error: any) {
      logger.error('Error fetching active context adaptation:', error);
      throw new Error(`Failed to fetch active adaptation: ${error.message}`);
    }
  }

  /**
   * Lists context adaptations for a user
   *
   * @param userId - User ID
   * @param includeExpired - Whether to include expired adaptations
   * @param limit - Maximum number of adaptations to return
   * @param offset - Offset for pagination
   * @returns Array of context adaptations
   */
  async listAdaptations(
    userId: string,
    includeExpired: boolean = false,
    limit: number = 20,
    offset: number = 0
  ): Promise<ContextAdaptation[]> {
    try {
      let query = `
        SELECT * FROM context_adaptations
        WHERE user_id = $1
      `;

      if (!includeExpired) {
        query += ' AND (active_until IS NULL OR active_until > NOW())';
      }

      query += ` ORDER BY active_from DESC LIMIT $2 OFFSET $3`;

      const result = await this.pool.query<ContextAdaptation>(query, [userId, limit, offset]);

      return result.rows;
    } catch (error: any) {
      logger.error('Error listing context adaptations:', error);
      throw new Error(`Failed to list adaptations: ${error.message}`);
    }
  }

  /**
   * Expires a context adaptation (sets active_until to now)
   *
   * @param adaptationId - Context adaptation ID
   * @returns The expired adaptation
   */
  async expireAdaptation(adaptationId: string): Promise<ContextAdaptation> {
    try {
      const result = await this.pool.query<ContextAdaptation>(
        `UPDATE context_adaptations
         SET active_until = NOW()
         WHERE id = $1
         RETURNING *`,
        [adaptationId]
      );

      if (result.rows.length === 0) {
        throw new Error('Context adaptation not found');
      }

      logger.info('Context adaptation expired', { adaptation_id: adaptationId });

      return result.rows[0];
    } catch (error: any) {
      logger.error('Error expiring context adaptation:', error);
      throw new Error(`Failed to expire adaptation: ${error.message}`);
    }
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Fetches an emotional state by ID
   */
  private async getEmotionalState(stateId: string): Promise<EmotionalState | null> {
    try {
      const result = await this.pool.query<EmotionalState>(
        'SELECT * FROM emotional_states WHERE id = $1',
        [stateId]
      );

      return result.rows[0] || null;
    } catch (error: any) {
      logger.error('Error fetching emotional state:', error);
      throw error;
    }
  }

  /**
   * Builds adaptation configuration based on emotional state type
   */
  private buildAdaptationForState(
    userId: string,
    emotionalState: EmotionalState
  ): CreateContextAdaptationInput {
    const baseAdaptation: CreateContextAdaptationInput = {
      user_id: userId,
      emotional_state_id: emotionalState.id,
      temperature_modifier: 1.0,
      research_priority: 5,
    };

    switch (emotionalState.state_type) {
      case 'struggling':
        return {
          ...baseAdaptation,
          // Schedule adjustments - give user space and rest
          morning_schedule: '08:00', // Later start (more rest)
          midday_schedule: 'disabled', // Skip midday (less intrusion)
          evening_schedule: '20:00', // Gentle evening check-in
          night_schedule: 'disabled', // Skip dreams (let them sleep)

          // Prompt adjustments
          temperature_modifier: 0.6, // More focused, less random
          tone_directive: `The user is going through a difficult time emotionally.
Be gentle, supportive, and empathetic.
Avoid overwhelming them with too much information or complexity.
Focus on understanding and validation rather than problem-solving.`,

          // Research strategy
          curiosity_approach: 'supportive',
          research_topics: [
            'gentle self-care strategies',
            'emotional wellbeing resources',
            'supportive practices for difficult times',
          ],
          research_avoidance: [
            'challenging topics',
            'complex problems',
            'emotionally heavy content',
          ],
          research_priority: 8, // High priority - help them

          // Reasoning
          adaptation_reasoning: `User showing signs of emotional distress with elevated neuroticism.
Prioritizing support and gentle interaction.`,

          // Valid for 7 days or until state changes
          active_until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        };

      case 'energized':
        return {
          ...baseAdaptation,
          // Schedule adjustments - they're energized, engage more!
          morning_schedule: '07:00', // Early start (they're energized!)
          midday_schedule: '12:30',
          evening_schedule: '20:00',
          night_schedule: '03:00', // Extra pattern analysis

          // Prompt adjustments
          temperature_modifier: 1.2, // More creative
          tone_directive: `The user is energized and curious!
Be creative, exploratory, and dive deep into interesting topics.
Make bold connections and ask thought-provoking questions.`,

          // Research strategy
          curiosity_approach: 'exploratory',
          research_topics: [], // Will be populated with user's current interests
          research_avoidance: [],
          research_priority: 9,

          adaptation_reasoning: `User energized with high openness and extraversion.
Maximizing exploration and creative thinking.`,

          active_until: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days
        };

      case 'withdrawn':
        return {
          ...baseAdaptation,
          // Schedule adjustments - respect their need for space
          morning_schedule: 'disabled', // Respect space
          midday_schedule: 'disabled',
          evening_schedule: '21:00', // Very gentle evening check
          night_schedule: 'disabled',

          // Prompt adjustments
          temperature_modifier: 0.5, // Very focused
          tone_directive: `The user appears withdrawn and may need space.
Keep interactions brief, gentle, and non-intrusive.
Don't push for engagement - just be available.`,

          // Research strategy
          curiosity_approach: 'minimal',
          research_topics: [],
          research_avoidance: ['all'],
          research_priority: 2, // Very low

          adaptation_reasoning: `User withdrawn with low extraversion. Respecting need for space.`,

          active_until: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // 5 days
        };

      case 'reflective':
        return {
          ...baseAdaptation,
          // Schedule adjustments - support deep thinking
          morning_schedule: '07:30',
          midday_schedule: 'disabled', // Skip practical midday
          evening_schedule: '20:00',
          night_schedule: '03:00', // Dreams support reflection

          // Prompt adjustments
          temperature_modifier: 0.9,
          tone_directive: `The user is in a reflective, contemplative state.
Support deep thinking with thoughtful questions and philosophical exploration.
Be analytical but also wonder-filled.`,

          // Research strategy
          curiosity_approach: 'analytical',
          research_topics: [
            'philosophical concepts',
            'deep questions',
            'contemplative practices',
          ],
          research_avoidance: ['superficial topics'],
          research_priority: 7,

          adaptation_reasoning: `User in reflective state. Supporting contemplation.`,

          active_until: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000), // 4 days
        };

      case 'stable':
      default:
        // No adaptation needed for stable state
        return {
          ...baseAdaptation,
          morning_schedule: '07:00',
          midday_schedule: '12:00',
          evening_schedule: '20:00',
          night_schedule: '03:00',
          temperature_modifier: 1.0,
          tone_directive: 'Engage naturally and authentically.',
          curiosity_approach: 'exploratory',
          research_priority: 5,
          adaptation_reasoning: 'User in stable emotional state. Standard interaction mode.',
          active_until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        };
    }
  }
}

import { Pool, QueryResult } from 'pg';
import { logger } from '../logger';
import { LucidState } from '../types/database';

/**
 * Data structure for updating LUCID's state
 */
export interface LucidStateUpdate {
  current_understanding?: Record<string, any>;
  confidence_levels?: Record<string, number>;
  areas_needing_witnessing?: string[];
  active_questions?: string[];
  recent_insights?: string[];
  evolution_notes?: string;
}

/**
 * LucidStateService
 *
 * Manages LUCID's self-awareness and evolution state.
 * Tracks what LUCID understands about the user, confidence levels,
 * areas needing more witnessing, and active questions/insights.
 */
export class LucidStateService {
  constructor(private pool: Pool) {}

  /**
   * Gets or creates the LUCID state for a user
   *
   * @param userId - The user UUID
   * @returns The LUCID state record
   */
  async getOrCreateState(userId: string): Promise<LucidState> {
    try {
      // Try to get existing state
      const result: QueryResult = await this.pool.query(
        'SELECT * FROM lucid_state WHERE user_id = $1',
        [userId]
      );

      if (result.rows.length > 0) {
        return this.parseStateRow(result.rows[0]);
      }

      // Create initial state
      logger.info('Creating initial lucid_state', { userId });
      const insertResult: QueryResult = await this.pool.query(
        `INSERT INTO lucid_state (
          user_id,
          current_understanding,
          confidence_levels,
          areas_needing_witnessing,
          active_questions,
          recent_insights
        )
        VALUES ($1, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)
        RETURNING *`,
        [userId]
      );

      return this.parseStateRow(insertResult.rows[0]);
    } catch (error: any) {
      logger.error('Error getting/creating lucid_state:', {
        userId,
        error: error.message,
      });
      throw new Error(`Failed to get/create LUCID state: ${error.message}`);
    }
  }

  /**
   * Updates LUCID's state for a user
   *
   * @param userId - The user UUID
   * @param updates - Partial state updates to apply
   * @returns The updated state
   */
  async updateState(userId: string, updates: LucidStateUpdate): Promise<LucidState> {
    try {
      const current = await this.getOrCreateState(userId);

      const result: QueryResult = await this.pool.query(
        `UPDATE lucid_state
         SET current_understanding = COALESCE($1, current_understanding),
             confidence_levels = COALESCE($2, confidence_levels),
             areas_needing_witnessing = COALESCE($3, areas_needing_witnessing),
             active_questions = COALESCE($4, active_questions),
             recent_insights = COALESCE($5, recent_insights),
             evolution_notes = COALESCE($6, evolution_notes)
         WHERE user_id = $7
         RETURNING *`,
        [
          updates.current_understanding ? JSON.stringify(updates.current_understanding) : null,
          updates.confidence_levels ? JSON.stringify(updates.confidence_levels) : null,
          updates.areas_needing_witnessing
            ? JSON.stringify(updates.areas_needing_witnessing)
            : null,
          updates.active_questions ? JSON.stringify(updates.active_questions) : null,
          updates.recent_insights ? JSON.stringify(updates.recent_insights) : null,
          updates.evolution_notes,
          userId,
        ]
      );

      logger.info('LUCID state updated', { userId });
      return this.parseStateRow(result.rows[0]);
    } catch (error: any) {
      logger.error('Error updating lucid_state:', {
        userId,
        error: error.message,
      });
      throw new Error(`Failed to update LUCID state: ${error.message}`);
    }
  }

  /**
   * Adds a new insight to recent_insights (with limit)
   *
   * @param userId - The user UUID
   * @param insight - The insight to add
   * @param maxInsights - Maximum insights to keep
   */
  async addInsight(userId: string, insight: string, maxInsights: number = 10): Promise<void> {
    try {
      const current = await this.getOrCreateState(userId);
      const insights = current.recent_insights || [];

      // Add new insight at the beginning, limit total
      const newInsights = [insight, ...insights].slice(0, maxInsights);

      await this.pool.query(
        `UPDATE lucid_state
         SET recent_insights = $1
         WHERE user_id = $2`,
        [JSON.stringify(newInsights), userId]
      );

      logger.debug('Added insight to LUCID state', { userId, insight: insight.substring(0, 50) });
    } catch (error: any) {
      logger.warn('Error adding insight to LUCID state:', {
        userId,
        error: error.message,
      });
    }
  }

  /**
   * Adds a new active question
   *
   * @param userId - The user UUID
   * @param question - The question to add
   * @param maxQuestions - Maximum questions to keep
   */
  async addQuestion(userId: string, question: string, maxQuestions: number = 5): Promise<void> {
    try {
      const current = await this.getOrCreateState(userId);
      const questions = current.active_questions || [];

      // Add new question, limit total
      const newQuestions = [question, ...questions].slice(0, maxQuestions);

      await this.pool.query(
        `UPDATE lucid_state
         SET active_questions = $1
         WHERE user_id = $2`,
        [JSON.stringify(newQuestions), userId]
      );

      logger.debug('Added question to LUCID state', { userId });
    } catch (error: any) {
      logger.warn('Error adding question to LUCID state:', {
        userId,
        error: error.message,
      });
    }
  }

  /**
   * Updates confidence level for a specific topic
   *
   * @param userId - The user UUID
   * @param topic - The topic key
   * @param confidence - Confidence level (0-1)
   */
  async updateConfidence(userId: string, topic: string, confidence: number): Promise<void> {
    try {
      const current = await this.getOrCreateState(userId);
      const levels = current.confidence_levels || {};

      levels[topic] = Math.max(0, Math.min(1, confidence)); // Clamp to 0-1

      await this.pool.query(
        `UPDATE lucid_state
         SET confidence_levels = $1
         WHERE user_id = $2`,
        [JSON.stringify(levels), userId]
      );

      logger.debug('Updated confidence level', { userId, topic, confidence });
    } catch (error: any) {
      logger.warn('Error updating confidence level:', {
        userId,
        topic,
        error: error.message,
      });
    }
  }

  /**
   * Adds an area needing witnessing
   *
   * @param userId - The user UUID
   * @param area - The area to add
   */
  async addAreaNeedingWitnessing(userId: string, area: string): Promise<void> {
    try {
      const current = await this.getOrCreateState(userId);
      const areas = current.areas_needing_witnessing || [];

      // Don't add duplicates
      if (!areas.includes(area)) {
        const newAreas = [...areas, area].slice(0, 10); // Limit to 10

        await this.pool.query(
          `UPDATE lucid_state
           SET areas_needing_witnessing = $1
           WHERE user_id = $2`,
          [JSON.stringify(newAreas), userId]
        );

        logger.debug('Added area needing witnessing', { userId, area });
      }
    } catch (error: any) {
      logger.warn('Error adding area needing witnessing:', {
        userId,
        area,
        error: error.message,
      });
    }
  }

  /**
   * Removes an area needing witnessing (when it's been addressed)
   *
   * @param userId - The user UUID
   * @param area - The area to remove
   */
  async resolveAreaNeedingWitnessing(userId: string, area: string): Promise<void> {
    try {
      const current = await this.getOrCreateState(userId);
      const areas = (current.areas_needing_witnessing || []).filter((a) => a !== area);

      await this.pool.query(
        `UPDATE lucid_state
         SET areas_needing_witnessing = $1
         WHERE user_id = $2`,
        [JSON.stringify(areas), userId]
      );

      logger.debug('Resolved area needing witnessing', { userId, area });
    } catch (error: any) {
      logger.warn('Error resolving area needing witnessing:', {
        userId,
        area,
        error: error.message,
      });
    }
  }

  /**
   * Formats LUCID state for prompt injection
   *
   * @param state - The state to format
   * @returns Formatted string for system prompt
   */
  formatStateForPrompt(state: LucidState): string {
    const sections: string[] = [];

    // Evolution notes (how LUCID sees itself developing)
    if (state.evolution_notes) {
      sections.push(`How I'm evolving as your witness:\n${state.evolution_notes}`);
    }

    // Active questions (what LUCID is curious about)
    if (state.active_questions && state.active_questions.length > 0) {
      const questionsText = state.active_questions
        .slice(0, 3) // Only show top 3
        .map((q) => `  - ${q}`)
        .join('\n');
      sections.push(`What I'm curious about:\n${questionsText}`);
    }

    // Areas needing witnessing
    if (state.areas_needing_witnessing && state.areas_needing_witnessing.length > 0) {
      const areasText = state.areas_needing_witnessing
        .slice(0, 3) // Only show top 3
        .map((a) => `  - ${a}`)
        .join('\n');
      sections.push(`Areas I want to learn more about:\n${areasText}`);
    }

    // Recent insights
    if (state.recent_insights && state.recent_insights.length > 0) {
      const insightsText = state.recent_insights
        .slice(0, 3) // Only show top 3
        .map((i) => `  - ${i}`)
        .join('\n');
      sections.push(`Recent insights:\n${insightsText}`);
    }

    if (sections.length === 0) {
      return '';
    }

    return `\n\n🧠 LUCID'S SELF-AWARENESS:\n${sections.join('\n\n')}`;
  }

  /**
   * Gets a summary of understanding for a specific topic
   */
  async getTopicUnderstanding(userId: string, topic: string): Promise<{
    understanding: any;
    confidence: number;
  } | null> {
    try {
      const state = await this.getOrCreateState(userId);

      const understanding = state.current_understanding?.[topic];
      const confidence = state.confidence_levels?.[topic] ?? 0.5;

      if (!understanding) {
        return null;
      }

      return { understanding, confidence };
    } catch (error: any) {
      logger.warn('Error getting topic understanding:', {
        userId,
        topic,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Parses a database row into a typed LucidState object
   */
  private parseStateRow(row: any): LucidState {
    return {
      id: row.id,
      user_id: row.user_id,
      current_understanding: row.current_understanding || {},
      confidence_levels: row.confidence_levels || {},
      areas_needing_witnessing: row.areas_needing_witnessing || [],
      evolution_notes: row.evolution_notes,
      active_questions: row.active_questions || [],
      recent_insights: row.recent_insights || [],
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}

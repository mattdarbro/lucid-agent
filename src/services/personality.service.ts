import { Pool } from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { PersonalitySnapshot, PersonalityStatistics } from '../types/database';
import { CreatePersonalitySnapshotInput, GetPersonalityStatisticsInput } from '../validation/personality.validation';

/**
 * Big 5 personality trait scores
 */
export interface Big5Traits {
  openness: number | null;
  conscientiousness: number | null;
  extraversion: number | null;
  agreeableness: number | null;
  neuroticism: number | null;
}

/**
 * Personality assessment result
 */
export interface PersonalityAssessment extends Big5Traits {
  confidence: number;
  reasoning: string;
  sample_size: number;
}

/**
 * PersonalityService
 *
 * Handles Big 5 personality trait assessment from conversation messages.
 * Uses Claude to analyze conversation patterns and extract personality indicators.
 */
export class PersonalityService {
  private pool: Pool;
  private anthropic: Anthropic;

  constructor(pool: Pool, anthropicApiKey?: string) {
    this.pool = pool;
    this.anthropic = new Anthropic({
      apiKey: anthropicApiKey || process.env.ANTHROPIC_API_KEY,
    });
  }

  /**
   * Creates a personality snapshot by analyzing recent conversation messages
   *
   * @param input - User ID and optional conversation ID
   * @returns The created personality snapshot
   */
  async createPersonalitySnapshot(input: CreatePersonalitySnapshotInput): Promise<PersonalitySnapshot> {
    try {
      // Fetch recent messages for analysis
      const messages = await this.getMessagesForAnalysis(
        input.user_id,
        input.conversation_id,
        input.sample_size || 50
      );

      if (messages.length === 0) {
        throw new Error('No messages found for personality assessment');
      }

      logger.info(`Analyzing ${messages.length} messages for personality assessment`, {
        user_id: input.user_id,
        conversation_id: input.conversation_id,
      });

      // Assess personality using Claude
      const assessment = await this.assessPersonality(messages);

      // Store snapshot in database
      const snapshot = await this.storeSnapshot(input.user_id, assessment);

      logger.info('Personality snapshot created', {
        snapshot_id: snapshot.id,
        user_id: input.user_id,
        confidence: assessment.confidence,
      });

      return snapshot;
    } catch (error: any) {
      logger.error('Error creating personality snapshot:', error);
      throw new Error(`Failed to create personality snapshot: ${error.message}`);
    }
  }

  /**
   * Retrieves personality statistics (baseline and standard deviations) for a user
   *
   * @param input - User ID and window days
   * @returns Personality statistics or null if not enough data
   */
  async getPersonalityStatistics(input: GetPersonalityStatisticsInput): Promise<PersonalityStatistics | null> {
    try {
      const result = await this.pool.query<PersonalityStatistics>(
        `SELECT * FROM personality_statistics
         WHERE user_id = $1
         AND window_days = $2
         ORDER BY last_updated DESC
         LIMIT 1`,
        [input.user_id, input.window_days]
      );

      return result.rows[0] || null;
    } catch (error: any) {
      logger.error('Error fetching personality statistics:', error);
      throw new Error(`Failed to fetch personality statistics: ${error.message}`);
    }
  }

  /**
   * Gets the latest personality snapshot for a user
   *
   * @param userId - User ID
   * @returns Latest personality snapshot or null
   */
  async getLatestSnapshot(userId: string): Promise<PersonalitySnapshot | null> {
    try {
      const result = await this.pool.query<PersonalitySnapshot>(
        `SELECT * FROM personality_snapshots
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId]
      );

      return result.rows[0] || null;
    } catch (error: any) {
      logger.error('Error fetching latest personality snapshot:', error);
      throw new Error(`Failed to fetch latest snapshot: ${error.message}`);
    }
  }

  /**
   * Lists personality snapshots for a user with pagination
   *
   * @param userId - User ID
   * @param limit - Maximum number of snapshots to return
   * @param offset - Offset for pagination
   * @returns Array of personality snapshots
   */
  async listSnapshots(userId: string, limit: number = 20, offset: number = 0): Promise<PersonalitySnapshot[]> {
    try {
      const result = await this.pool.query<PersonalitySnapshot>(
        `SELECT * FROM personality_snapshots
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      );

      return result.rows;
    } catch (error: any) {
      logger.error('Error listing personality snapshots:', error);
      throw new Error(`Failed to list snapshots: ${error.message}`);
    }
  }

  /**
   * Calculates personality deviations from baseline
   *
   * @param userId - User ID
   * @returns Deviations in standard deviations for each trait, or null if insufficient data
   */
  async getPersonalityDeviations(userId: string): Promise<{
    openness: number;
    conscientiousness: number;
    extraversion: number;
    agreeableness: number;
    neuroticism: number;
  } | null> {
    try {
      // Get baseline statistics
      const stats = await this.getPersonalityStatistics({ user_id: userId, window_days: 90 });
      if (!stats) {
        return null;
      }

      // Get latest snapshot
      const current = await this.getLatestSnapshot(userId);
      if (!current) {
        return null;
      }

      // Calculate deviations (in standard deviations)
      const deviations = {
        openness: this.calculateDeviation(current.openness, stats.avg_openness, stats.std_openness),
        conscientiousness: this.calculateDeviation(current.conscientiousness, stats.avg_conscientiousness, stats.std_conscientiousness),
        extraversion: this.calculateDeviation(current.extraversion, stats.avg_extraversion, stats.std_extraversion),
        agreeableness: this.calculateDeviation(current.agreeableness, stats.avg_agreeableness, stats.std_agreeableness),
        neuroticism: this.calculateDeviation(current.neuroticism, stats.avg_neuroticism, stats.std_neuroticism),
      };

      return deviations;
    } catch (error: any) {
      logger.error('Error calculating personality deviations:', error);
      throw new Error(`Failed to calculate deviations: ${error.message}`);
    }
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Fetches recent messages for personality analysis
   */
  private async getMessagesForAnalysis(
    userId: string,
    conversationId: string | undefined,
    limit: number
  ): Promise<Array<{ role: string; content: string }>> {
    try {
      let query: string;
      let params: any[];

      if (conversationId) {
        // Get messages from specific conversation
        query = `
          SELECT role, content
          FROM messages
          WHERE conversation_id = $1 AND user_id = $2
          ORDER BY created_at DESC
          LIMIT $3
        `;
        params = [conversationId, userId, limit];
      } else {
        // Get recent messages across all conversations
        query = `
          SELECT role, content
          FROM messages
          WHERE user_id = $1
          ORDER BY created_at DESC
          LIMIT $2
        `;
        params = [userId, limit];
      }

      const result = await this.pool.query(query, params);
      return result.rows.reverse(); // Reverse to chronological order
    } catch (error: any) {
      logger.error('Error fetching messages for analysis:', error);
      throw error;
    }
  }

  /**
   * Assesses Big 5 personality traits using Claude
   */
  private async assessPersonality(messages: Array<{ role: string; content: string }>): Promise<PersonalityAssessment> {
    try {
      const conversationText = messages
        .map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
        .join('\n\n');

      const systemPrompt = this.buildPersonalityAssessmentPrompt();

      logger.debug('Sending personality assessment request to Claude', {
        message_count: messages.length,
      });

      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 2000,
        temperature: 0.3, // Lower temperature for more consistent analysis
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `Analyze the following conversation and assess the user's Big 5 personality traits:\n\n${conversationText}`,
          },
        ],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type from Claude');
      }

      // Parse Claude's response
      const assessment = this.parsePersonalityResponse(content.text, messages.length);

      logger.debug('Personality assessment completed', {
        confidence: assessment.confidence,
      });

      return assessment;
    } catch (error: any) {
      logger.error('Error assessing personality with Claude:', error);
      throw new Error(`Personality assessment failed: ${error.message}`);
    }
  }

  /**
   * Builds the system prompt for personality assessment
   */
  private buildPersonalityAssessmentPrompt(): string {
    return `You are a personality assessment expert specializing in the Big Five personality traits (OCEAN model).

Your task is to analyze a conversation and provide scores for each of the Big Five traits on a scale from 0.00 to 1.00:

**Openness (O)**: Creativity, curiosity, openness to new experiences
- LOW (0.0-0.3): Prefers routine, practical, conventional
- MEDIUM (0.4-0.6): Balanced between novelty and familiarity
- HIGH (0.7-1.0): Creative, curious, open to new ideas

**Conscientiousness (C)**: Organization, responsibility, self-discipline
- LOW (0.0-0.3): Spontaneous, flexible, less structured
- MEDIUM (0.4-0.6): Moderately organized and reliable
- HIGH (0.7-1.0): Highly organized, disciplined, goal-oriented

**Extraversion (E)**: Sociability, energy, assertiveness
- LOW (0.0-0.3): Reserved, prefers solitude, introspective
- MEDIUM (0.4-0.6): Ambivert, situationally social
- HIGH (0.7-1.0): Outgoing, energetic, seeks social interaction

**Agreeableness (A)**: Compassion, cooperation, trust
- LOW (0.0-0.3): Competitive, skeptical, direct
- MEDIUM (0.4-0.6): Balanced between assertiveness and cooperation
- HIGH (0.7-1.0): Compassionate, cooperative, trusting

**Neuroticism (N)**: Emotional stability, anxiety, mood
- LOW (0.0-0.3): Emotionally stable, calm, resilient
- MEDIUM (0.4-0.6): Moderate emotional reactivity
- HIGH (0.7-1.0): Anxious, emotionally reactive, prone to worry

IMPORTANT INSTRUCTIONS:
1. Analyze the user's messages ONLY (not the assistant's responses)
2. Look for behavioral patterns, language use, topic choices, and emotional tone
3. Consider multiple messages to identify consistent patterns
4. If insufficient data for a trait, return null for that trait
5. Provide your confidence level (0.00-1.00) based on sample size and clarity of indicators

**Response Format (JSON only, no markdown):**
{
  "openness": 0.75,
  "conscientiousness": 0.60,
  "extraversion": 0.45,
  "agreeableness": 0.80,
  "neuroticism": 0.30,
  "confidence": 0.75,
  "reasoning": "Detailed explanation of the assessment based on observed patterns in the conversation..."
}`;
  }

  /**
   * Parses Claude's personality assessment response
   */
  private parsePersonalityResponse(responseText: string, sampleSize: number): PersonalityAssessment {
    try {
      // Extract JSON from response (handle potential markdown formatting)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate and normalize scores
      return {
        openness: this.normalizeScore(parsed.openness),
        conscientiousness: this.normalizeScore(parsed.conscientiousness),
        extraversion: this.normalizeScore(parsed.extraversion),
        agreeableness: this.normalizeScore(parsed.agreeableness),
        neuroticism: this.normalizeScore(parsed.neuroticism),
        confidence: this.normalizeScore(parsed.confidence) || 0.5,
        reasoning: parsed.reasoning || 'No reasoning provided',
        sample_size: sampleSize,
      };
    } catch (error: any) {
      logger.error('Error parsing personality response:', error);
      throw new Error(`Failed to parse personality assessment: ${error.message}`);
    }
  }

  /**
   * Normalizes a score to 0-1 range or null
   */
  private normalizeScore(value: any): number | null {
    if (value === null || value === undefined) {
      return null;
    }

    const num = parseFloat(value);
    if (isNaN(num)) {
      return null;
    }

    return Math.max(0, Math.min(1, num));
  }

  /**
   * Stores a personality snapshot in the database
   */
  private async storeSnapshot(userId: string, assessment: PersonalityAssessment): Promise<PersonalitySnapshot> {
    try {
      const result = await this.pool.query<PersonalitySnapshot>(
        `INSERT INTO personality_snapshots (
          user_id, openness, conscientiousness, extraversion, agreeableness, neuroticism,
          assessment_reasoning, message_count
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *`,
        [
          userId,
          assessment.openness,
          assessment.conscientiousness,
          assessment.extraversion,
          assessment.agreeableness,
          assessment.neuroticism,
          assessment.reasoning,
          assessment.sample_size,
        ]
      );

      return result.rows[0];
    } catch (error: any) {
      logger.error('Error storing personality snapshot:', error);
      throw error;
    }
  }

  /**
   * Calculates deviation in standard deviations
   */
  private calculateDeviation(
    currentValue: number | null,
    average: number,
    stdDev: number
  ): number {
    if (currentValue === null || stdDev === 0) {
      return 0;
    }

    return (currentValue - average) / stdDev;
  }
}

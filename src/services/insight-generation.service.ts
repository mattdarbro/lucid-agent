import { Pool } from 'pg';
import { logger } from '../logger';
import { CheckInRecord } from '../validation/multi-day-task.validation';

/**
 * InsightGenerationService
 * Analyzes check-ins to detect patterns and generate discussable insights
 * Learns user's preferred insight framing based on their responses
 */
export class InsightGenerationService {
  constructor(private pool: Pool) {}

  /**
   * Analyze check-ins for a task and generate insights
   * This is called periodically (e.g., after every 2-3 check-ins)
   */
  async generateInsightsForTask(taskId: string): Promise<any[]> {
    try {
      // Get the task and its check-ins
      const taskQuery = `
        SELECT id, user_id, title, check_ins, metadata
        FROM multi_day_research_tasks
        WHERE id = $1
      `;
      const taskResult = await this.pool.query(taskQuery, [taskId]);

      if (taskResult.rows.length === 0) {
        throw new Error('Task not found');
      }

      const task = taskResult.rows[0];
      const checkIns: CheckInRecord[] = task.check_ins || [];

      if (checkIns.length < 2) {
        // Need at least 2 check-ins to detect patterns
        return [];
      }

      // Get user's insight receptivity preferences
      const receptivityQuery = `
        SELECT * FROM insight_receptivity_patterns
        WHERE user_id = $1
      `;
      const receptivityResult = await this.pool.query(receptivityQuery, [task.user_id]);
      const userPreferences = receptivityResult.rows[0] || null;

      // Detect patterns
      const insights = [];

      // Pattern 1: Temporal mood/energy shifts
      const temporalPattern = this.detectTemporalMoodPattern(checkIns, task.user_id, userPreferences);
      if (temporalPattern) {
        insights.push(temporalPattern);
      }

      // Pattern 2: Language/sentiment changes
      const languagePattern = this.detectLanguageChanges(checkIns, task.user_id, userPreferences);
      if (languagePattern) {
        insights.push(languagePattern);
      }

      // Pattern 3: Energy-focus correlation
      const correlationPattern = this.detectEnergyFocusCorrelation(checkIns, task.user_id, userPreferences);
      if (correlationPattern) {
        insights.push(correlationPattern);
      }

      // Save insights to database
      const savedInsights = await this.saveInsights(taskId, task.user_id, insights);

      logger.info('Insights generated for task', {
        task_id: taskId,
        insights_count: savedInsights.length,
      });

      return savedInsights;
    } catch (error: any) {
      logger.error('Error generating insights:', error);
      throw new Error(`Failed to generate insights: ${error.message}`);
    }
  }

  /**
   * Detect temporal mood/energy patterns across check-ins
   */
  private detectTemporalMoodPattern(
    checkIns: CheckInRecord[],
    userId: string,
    userPrefs: any
  ): any | null {
    // Group check-ins by time of day
    const byTimeOfDay: { [key: string]: CheckInRecord[] } = {
      morning: [],
      afternoon: [],
      evening: [],
      late_night: [],
    };

    checkIns.forEach((checkIn) => {
      const timeOfDay = checkIn.time_of_day;
      if (timeOfDay && byTimeOfDay[timeOfDay]) {
        byTimeOfDay[timeOfDay].push(checkIn);
      }
    });

    // Calculate average energy/mood for each time
    const timeStats: { [key: string]: { avgEnergy: number; avgMood: number; count: number } } = {};

    for (const [time, checks] of Object.entries(byTimeOfDay)) {
      if (checks.length > 0) {
        const validChecks = checks.filter(
          (c) => c.self_reported_energy != null && c.self_reported_mood != null
        );

        if (validChecks.length > 0) {
          const avgEnergy =
            validChecks.reduce((sum, c) => sum + (c.self_reported_energy || 0), 0) /
            validChecks.length;
          const avgMood =
            validChecks.reduce((sum, c) => sum + (c.self_reported_mood || 0), 0) /
            validChecks.length;

          timeStats[time] = {
            avgEnergy: Math.round(avgEnergy * 10) / 10,
            avgMood: Math.round(avgMood * 10) / 10,
            count: validChecks.length,
          };
        }
      }
    }

    // Find if there's a significant difference
    const times = Object.keys(timeStats);
    if (times.length < 2) return null;

    // Find highest and lowest energy times
    let highestTime = times[0];
    let lowestTime = times[0];

    times.forEach((time) => {
      if (timeStats[time].avgEnergy > timeStats[highestTime].avgEnergy) {
        highestTime = time;
      }
      if (timeStats[time].avgEnergy < timeStats[lowestTime].avgEnergy) {
        lowestTime = time;
      }
    });

    const energyDiff = timeStats[highestTime].avgEnergy - timeStats[lowestTime].avgEnergy;

    if (energyDiff >= 1.5) {
      // Significant difference
      // Frame insight based on user preferences
      const insightText = this.frameTemporalInsight(
        highestTime,
        lowestTime,
        timeStats,
        userPrefs
      );

      return {
        pattern_type: 'temporal_mood',
        insight_text: insightText,
        confidence: Math.min(0.9, energyDiff / 5.0), // Higher diff = higher confidence
        supporting_evidence: {
          high_energy_time: highestTime,
          low_energy_time: lowestTime,
          stats: timeStats,
          check_in_ids: checkIns.map((c) => c.check_in_number),
        },
      };
    }

    return null;
  }

  /**
   * Frame temporal insight based on user's preferences
   */
  private frameTemporalInsight(
    highTime: string,
    lowTime: string,
    stats: any,
    userPrefs: any
  ): string {
    const requiresData = userPrefs?.requires_data ?? false;

    // Format time of day for display
    const formatTime = (time: string) => {
      if (time === 'late_night') return 'late night';
      return time;
    };

    const highTimeFormatted = formatTime(highTime);
    const lowTimeFormatted = formatTime(lowTime);
    const energyDiff = stats[highTime].avgEnergy - stats[lowTime].avgEnergy;
    const percentDiff = Math.round((energyDiff / stats[lowTime].avgEnergy) * 100);

    if (requiresData) {
      // Data-driven framing with clear metrics
      return `Your ${highTimeFormatted} check-ins show ${percentDiff}% higher energy levels (${stats[highTime].avgEnergy}/5) compared to ${lowTimeFormatted} (${stats[lowTime].avgEnergy}/5). This pattern appeared consistently across ${stats[highTime].count} ${highTimeFormatted} and ${stats[lowTime].count} ${lowTimeFormatted} check-ins.`;
    } else {
      // Narrative framing - clear and conversational
      return `You tend to have more energy in the ${highTimeFormatted} compared to the ${lowTimeFormatted}. Across multiple check-ins, your ${highTimeFormatted} energy averages ${stats[highTime].avgEnergy} out of 5, while ${lowTimeFormatted} averages ${stats[lowTime].avgEnergy} out of 5.`;
    }
  }

  /**
   * Detect language/sentiment changes across check-ins
   */
  private detectLanguageChanges(
    checkIns: CheckInRecord[],
    userId: string,
    userPrefs: any
  ): any | null {
    // Simple heuristic: look for negative words in responses
    const negativeWords = [
      'overwhelming',
      'anxious',
      'worried',
      'scared',
      'frustrated',
      'exhausted',
      'tired',
      'unknown',
      'hard',
      'difficult',
      'struggling',
    ];

    const positiveWords = [
      'okay',
      'fine',
      'good',
      'great',
      'excited',
      'hopeful',
      'confident',
      'energized',
      'happy',
    ];

    const byTimeOfDay: { [key: string]: { negative: number; positive: number; total: number } } = {};

    checkIns.forEach((checkIn) => {
      if (!checkIn.response) return;

      const time = checkIn.time_of_day || 'unknown';
      if (!byTimeOfDay[time]) {
        byTimeOfDay[time] = { negative: 0, positive: 0, total: 0 };
      }

      const response = checkIn.response.toLowerCase();
      const negCount = negativeWords.filter((word) => response.includes(word)).length;
      const posCount = positiveWords.filter((word) => response.includes(word)).length;

      byTimeOfDay[time].negative += negCount;
      byTimeOfDay[time].positive += posCount;
      byTimeOfDay[time].total += 1;
    });

    // Find time with most negative language
    const times = Object.keys(byTimeOfDay);
    if (times.length < 2) return null;

    let mostNegativeTime = times[0];
    let maxNegRatio = 0;

    times.forEach((time) => {
      const stats = byTimeOfDay[time];
      const negRatio = stats.negative / Math.max(stats.total, 1);
      if (negRatio > maxNegRatio) {
        maxNegRatio = negRatio;
        mostNegativeTime = time;
      }
    });

    if (maxNegRatio >= 0.5) {
      // More than half of check-ins have negative language
      const requiresExamples = userPrefs?.requires_examples ?? false;

      // Format time of day
      const timeFormatted = mostNegativeTime === 'late_night' ? 'late night' : mostNegativeTime;
      const percentNegative = Math.round(maxNegRatio * 100);

      let insightText = `Your language becomes more negative in ${timeFormatted} check-ins. About ${percentNegative}% of your ${timeFormatted} responses contain words like "overwhelming," "anxious," or "frustrated," suggesting this may be a challenging time for you.`;

      if (requiresExamples) {
        const examples = checkIns
          .filter((c) => c.time_of_day === mostNegativeTime && c.response)
          .map((c) => c.response!.substring(0, 50))
          .slice(0, 2);

        if (examples.length > 0) {
          insightText += ` For example: "${examples.join('..." and "...')}"`;
        }
      }

      return {
        pattern_type: 'language_change',
        insight_text: insightText,
        confidence: Math.min(0.8, maxNegRatio),
        supporting_evidence: {
          time_of_day: mostNegativeTime,
          negative_ratio: maxNegRatio,
          total_check_ins: byTimeOfDay[mostNegativeTime].total,
        },
      };
    }

    return null;
  }

  /**
   * Detect correlation between energy and focus
   */
  private detectEnergyFocusCorrelation(
    checkIns: CheckInRecord[],
    userId: string,
    userPrefs: any
  ): any | null {
    const validCheckIns = checkIns.filter(
      (c) => c.self_reported_energy != null && c.self_reported_focus != null
    );

    if (validCheckIns.length < 3) return null;

    // Simple correlation: when energy is low (<3), is focus also low?
    const lowEnergyCheckIns = validCheckIns.filter((c) => (c.self_reported_energy || 0) < 3);
    const lowFocusCount = lowEnergyCheckIns.filter(
      (c) => (c.self_reported_focus || 0) < 3
    ).length;

    if (lowEnergyCheckIns.length > 0) {
      const correlation = lowFocusCount / lowEnergyCheckIns.length;

      if (correlation >= 0.7) {
        // Strong correlation
        const correlationPercent = Math.round(correlation * 100);
        const insightText = `When your energy is low, your focus tends to drop significantly. In ${correlationPercent}% of check-ins where you reported energy below 3 out of 5, your focus was also low. This suggests that boosting your energy could help improve your focus.`;

        return {
          pattern_type: 'energy_correlation',
          insight_text: insightText,
          confidence: correlation,
          supporting_evidence: {
            low_energy_instances: lowEnergyCheckIns.length,
            also_low_focus: lowFocusCount,
            correlation_strength: correlationPercent,
          },
        };
      }
    }

    return null;
  }

  /**
   * Validate and sanitize insight text
   * Ensures text is human-readable and not malformed data
   */
  private validateInsightText(insight: any): boolean {
    if (!insight || !insight.insight_text) {
      logger.warn('Insight missing insight_text field');
      return false;
    }

    const text = insight.insight_text;

    // Must be a string
    if (typeof text !== 'string') {
      logger.warn('Insight text is not a string:', typeof text);
      return false;
    }

    // Must have reasonable length
    if (text.length < 10 || text.length > 1000) {
      logger.warn('Insight text has invalid length:', text.length);
      return false;
    }

    // Should not look like JSON or raw data
    // Check for high density of special characters
    const specialChars = text.match(/[{}\[\]:,]/g) || [];
    const specialCharRatio = specialChars.length / text.length;

    if (specialCharRatio > 0.15) {
      logger.warn('Insight text appears to contain raw data (too many brackets/braces):', {
        text: text.substring(0, 100),
        ratio: specialCharRatio,
      });
      return false;
    }

    // Should start with a capital letter or number
    if (!/^[A-Z0-9]/.test(text)) {
      logger.warn('Insight text does not start with capital letter:', text.substring(0, 50));
      return false;
    }

    return true;
  }

  /**
   * Save insights to database
   */
  private async saveInsights(taskId: string, userId: string, insights: any[]): Promise<any[]> {
    const savedInsights = [];

    for (const insight of insights) {
      // Validate insight text before saving
      if (!this.validateInsightText(insight)) {
        logger.warn('Skipping invalid insight', {
          pattern_type: insight.pattern_type,
          text_preview: insight.insight_text?.substring(0, 100),
        });
        continue;
      }

      const query = `
        INSERT INTO task_insights (
          task_id,
          user_id,
          insight_text,
          confidence,
          pattern_type,
          supporting_evidence,
          status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `;

      const values = [
        taskId,
        userId,
        insight.insight_text,
        insight.confidence,
        insight.pattern_type,
        JSON.stringify(insight.supporting_evidence),
        'proposed',
      ];

      try {
        const result = await this.pool.query(query, values);
        savedInsights.push(result.rows[0]);
        logger.info('Saved valid insight', {
          id: result.rows[0].id,
          pattern_type: insight.pattern_type,
          text_preview: insight.insight_text.substring(0, 60) + '...',
        });
      } catch (error: any) {
        logger.error('Error saving insight:', error);
        // Continue with other insights
      }
    }

    return savedInsights;
  }

  /**
   * Get pending insights for a user
   */
  async getPendingInsights(userId: string): Promise<any[]> {
    const query = `
      SELECT * FROM task_insights
      WHERE user_id = $1 AND status = 'proposed'
      ORDER BY created_at ASC
    `;

    try {
      const result = await this.pool.query(query, [userId]);
      return result.rows;
    } catch (error: any) {
      logger.error('Error fetching pending insights:', error);
      throw new Error(`Failed to fetch pending insights: ${error.message}`);
    }
  }

  /**
   * Get insights for a specific task
   */
  async getInsightsForTask(taskId: string): Promise<any[]> {
    const query = `
      SELECT * FROM task_insights
      WHERE task_id = $1
      ORDER BY created_at DESC
    `;

    try {
      const result = await this.pool.query(query, [taskId]);
      return result.rows;
    } catch (error: any) {
      logger.error('Error fetching task insights:', error);
      throw new Error(`Failed to fetch task insights: ${error.message}`);
    }
  }

  /**
   * Update insight receptivity patterns based on user interaction
   */
  async updateReceptivityPattern(
    userId: string,
    insightId: string,
    action: 'accepted' | 'rejected' | 'refined',
    refinementText?: string
  ): Promise<void> {
    try {
      // Get the insight
      const insightQuery = `SELECT * FROM task_insights WHERE id = $1`;
      const insightResult = await this.pool.query(insightQuery, [insightId]);

      if (insightResult.rows.length === 0) return;

      const insight = insightResult.rows[0];

      // Get or create receptivity pattern
      const patternQuery = `
        INSERT INTO insight_receptivity_patterns (user_id, total_insights_reviewed)
        VALUES ($1, 0)
        ON CONFLICT (user_id) DO NOTHING
      `;
      await this.pool.query(patternQuery, [userId]);

      // Update pattern based on this interaction
      const updateQuery = `
        UPDATE insight_receptivity_patterns
        SET
          total_insights_reviewed = total_insights_reviewed + 1,
          overall_acceptance_rate = (
            SELECT COUNT(*)::float / NULLIF(COUNT(DISTINCT ii.insight_id), 0)
            FROM insight_interactions ii
            WHERE ii.user_id = $1 AND ii.action = 'accepted'
          ),
          challenge_rate = (
            SELECT COUNT(*)::float / NULLIF(COUNT(DISTINCT ii.insight_id), 0)
            FROM insight_interactions ii
            WHERE ii.user_id = $1 AND ii.action IN ('rejected', 'refined')
          ),
          last_updated = NOW()
        WHERE user_id = $1
      `;

      await this.pool.query(updateQuery, [userId]);

      // If rejected or refined, track the phrasing pattern
      if (action === 'rejected' || action === 'refined') {
        const phrasingQuery = `
          UPDATE insight_receptivity_patterns
          SET rejected_phrasing_patterns = array_append(
            COALESCE(rejected_phrasing_patterns, ARRAY[]::TEXT[]),
            $2
          )
          WHERE user_id = $1
        `;
        await this.pool.query(phrasingQuery, [userId, insight.insight_text]);
      } else if (action === 'accepted') {
        const phrasingQuery = `
          UPDATE insight_receptivity_patterns
          SET successful_phrasing_patterns = array_append(
            COALESCE(successful_phrasing_patterns, ARRAY[]::TEXT[]),
            $2
          )
          WHERE user_id = $1
        `;
        await this.pool.query(phrasingQuery, [userId, insight.insight_text]);
      }

      logger.info('Updated receptivity pattern', {
        user_id: userId,
        insight_id: insightId,
        action,
      });
    } catch (error: any) {
      logger.error('Error updating receptivity pattern:', error);
      // Don't throw - this is non-critical
    }
  }
}

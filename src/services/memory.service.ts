import { Pool, QueryResult } from 'pg';
import { logger } from '../logger';
import { Fact } from './fact.service';

/**
 * Fact with evidence list for memory context
 */
export interface FactWithEvidence extends Fact {
  evidence_list?: string[];
}

/**
 * MemoryService
 *
 * Handles retrieval and formatting of user facts for chat context injection.
 * This service provides the "memory" that makes conversations feel personalized.
 */
export class MemoryService {
  constructor(private pool: Pool) {}

  /**
   * Retrieves relevant facts for a user to inject into chat context
   *
   * @param userId - The user UUID
   * @param limit - Maximum number of facts to retrieve (default: 10)
   * @returns Array of facts with their evidence
   */
  async getRelevantFacts(userId: string, limit: number = 10): Promise<FactWithEvidence[]> {
    try {
      // Get most confident and recently mentioned facts
      // Include evidence to provide richer context
      const result: QueryResult<FactWithEvidence> = await this.pool.query(
        `SELECT f.*,
                COALESCE(
                  array_agg(e.excerpt) FILTER (WHERE e.excerpt IS NOT NULL),
                  ARRAY[]::text[]
                ) as evidence_list
         FROM facts f
         LEFT JOIN evidence e ON e.fact_id = f.id
         WHERE f.user_id = $1
           AND f.is_active = true
           AND f.confidence >= 0.5
         GROUP BY f.id
         ORDER BY f.confidence DESC, f.last_mentioned_at DESC NULLS LAST
         LIMIT $2`,
        [userId, limit]
      );

      logger.debug(`Retrieved ${result.rows.length} facts for user ${userId}`);
      return result.rows;
    } catch (error: any) {
      logger.error('Error retrieving relevant facts:', {
        userId,
        error: error.message,
      });
      // Return empty array rather than failing - chat should continue without memory
      return [];
    }
  }

  /**
   * Retrieves facts filtered by category
   *
   * @param userId - The user UUID
   * @param categories - Array of categories to include
   * @param limit - Maximum number of facts per category
   * @returns Array of facts
   */
  async getFactsByCategory(
    userId: string,
    categories: string[],
    limit: number = 5
  ): Promise<FactWithEvidence[]> {
    try {
      const result: QueryResult<FactWithEvidence> = await this.pool.query(
        `SELECT f.*,
                COALESCE(
                  array_agg(e.excerpt) FILTER (WHERE e.excerpt IS NOT NULL),
                  ARRAY[]::text[]
                ) as evidence_list
         FROM facts f
         LEFT JOIN evidence e ON e.fact_id = f.id
         WHERE f.user_id = $1
           AND f.is_active = true
           AND f.confidence >= 0.5
           AND f.category = ANY($2)
         GROUP BY f.id
         ORDER BY f.confidence DESC, f.last_mentioned_at DESC NULLS LAST
         LIMIT $3`,
        [userId, categories, limit]
      );

      return result.rows;
    } catch (error: any) {
      logger.error('Error retrieving facts by category:', {
        userId,
        categories,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Formats facts into a prompt-friendly string for injection into system prompt
   *
   * @param facts - Array of facts to format
   * @returns Formatted string for prompt injection, or empty string if no facts
   */
  formatFactsForPrompt(facts: FactWithEvidence[]): string {
    if (facts.length === 0) {
      return '';
    }

    // Group facts by category for better organization
    const factsByCategory = new Map<string, FactWithEvidence[]>();

    for (const fact of facts) {
      const category = fact.category || 'other';
      if (!factsByCategory.has(category)) {
        factsByCategory.set(category, []);
      }
      factsByCategory.get(category)!.push(fact);
    }

    // Build formatted output
    const sections: string[] = [];

    // Priority order for categories (most important first)
    const categoryOrder = [
      'personal',
      'preference',
      'goal',
      'relationship',
      'experience',
      'skill',
      'habit',
      'belief',
      'health',
      'other',
    ];

    for (const category of categoryOrder) {
      const categoryFacts = factsByCategory.get(category);
      if (!categoryFacts || categoryFacts.length === 0) continue;

      const formattedFacts = categoryFacts
        .map((f) => {
          // Format confidence as a descriptor
          const confidenceDesc =
            f.confidence >= 0.9
              ? 'certain'
              : f.confidence >= 0.7
                ? 'confident'
                : 'possible';
          return `  - ${f.content} (${confidenceDesc})`;
        })
        .join('\n');

      sections.push(`${this.formatCategoryName(category)}:\n${formattedFacts}`);
    }

    if (sections.length === 0) {
      return '';
    }

    return `\n\n🧠 WHAT YOU KNOW ABOUT THIS USER:\n${sections.join('\n\n')}`;
  }

  /**
   * Formats a category name for display
   */
  private formatCategoryName(category: string): string {
    const categoryNames: Record<string, string> = {
      personal: 'Personal Information',
      preference: 'Preferences & Interests',
      goal: 'Goals & Aspirations',
      relationship: 'Relationships',
      experience: 'Experiences & Background',
      skill: 'Skills & Abilities',
      habit: 'Habits & Routines',
      belief: 'Beliefs & Values',
      health: 'Health & Wellness',
      other: 'Other',
    };

    return categoryNames[category] || category.charAt(0).toUpperCase() + category.slice(1);
  }

  /**
   * Gets a concise memory summary for the user (useful for shorter contexts)
   *
   * @param userId - The user UUID
   * @param maxFacts - Maximum facts to include
   * @returns Formatted summary string
   */
  async getMemorySummary(userId: string, maxFacts: number = 5): Promise<string> {
    const facts = await this.getRelevantFacts(userId, maxFacts);

    if (facts.length === 0) {
      return '';
    }

    // Just list the most important facts concisely
    const factsList = facts
      .map((f) => `- ${f.content}`)
      .join('\n');

    return `\n\nWhat you remember about this user:\n${factsList}`;
  }

  /**
   * Gets fact count for a user (useful for debugging/monitoring)
   */
  async getFactCount(userId: string): Promise<number> {
    try {
      const result = await this.pool.query(
        'SELECT COUNT(*) as count FROM facts WHERE user_id = $1 AND is_active = true',
        [userId]
      );
      return parseInt(result.rows[0].count, 10);
    } catch (error: any) {
      logger.error('Error counting facts:', { userId, error: error.message });
      return 0;
    }
  }
}

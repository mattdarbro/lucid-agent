import { Pool, QueryResult } from 'pg';
import { logger } from '../logger';
import { Orbit } from '../types/database';

/**
 * Data structure for creating/updating orbit persons
 */
export interface OrbitPersonInput {
  person_name: string;
  relationship?: string;
  current_situation?: Record<string, any>;
  how_this_affects_user?: string;
  orbit_tier?: 'inner' | 'mid' | 'outer';
}

/**
 * OrbitsService
 *
 * Manages the relationship ecosystem - people in the user's life.
 * Tracks relationships by proximity (inner/mid/outer) and their
 * current situation from the user's perspective.
 */
export class OrbitsService {
  constructor(private pool: Pool) {}

  /**
   * Gets all active orbits for a user
   *
   * @param userId - The user UUID
   * @param tier - Optional tier filter
   * @returns Array of orbit records
   */
  async getActiveOrbits(userId: string, tier?: 'inner' | 'mid' | 'outer'): Promise<Orbit[]> {
    try {
      let query = `
        SELECT * FROM orbits
        WHERE user_id = $1 AND is_active = TRUE
      `;
      const params: any[] = [userId];

      if (tier) {
        query += ' AND orbit_tier = $2';
        params.push(tier);
      }

      query += ' ORDER BY orbit_tier ASC, last_mentioned_at DESC';

      const result: QueryResult = await this.pool.query(query, params);

      logger.debug(`Retrieved ${result.rows.length} orbits for user`, { userId, tier });
      return result.rows.map(this.parseOrbitRow);
    } catch (error: any) {
      logger.error('Error retrieving orbits:', {
        userId,
        tier,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Gets orbits by tier with limits
   *
   * @param userId - The user UUID
   * @param limits - Optional limits per tier
   * @returns Object with orbits by tier
   */
  async getOrbitsByTier(
    userId: string,
    limits: { inner?: number; mid?: number; outer?: number } = {}
  ): Promise<{
    inner: Orbit[];
    mid: Orbit[];
    outer: Orbit[];
  }> {
    const [inner, mid, outer] = await Promise.all([
      this.getActiveOrbits(userId, 'inner'),
      this.getActiveOrbits(userId, 'mid'),
      this.getActiveOrbits(userId, 'outer'),
    ]);

    return {
      inner: limits.inner ? inner.slice(0, limits.inner) : inner,
      mid: limits.mid ? mid.slice(0, limits.mid) : mid,
      outer: limits.outer ? outer.slice(0, limits.outer) : outer,
    };
  }

  /**
   * Gets a single orbit by person name
   *
   * @param userId - The user UUID
   * @param personName - The person's name (case-insensitive)
   * @returns The orbit record or null
   */
  async getOrbitByName(userId: string, personName: string): Promise<Orbit | null> {
    try {
      const result: QueryResult = await this.pool.query(
        `SELECT * FROM orbits
         WHERE user_id = $1 AND LOWER(person_name) = LOWER($2) AND is_active = TRUE`,
        [userId, personName]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return this.parseOrbitRow(result.rows[0]);
    } catch (error: any) {
      logger.error('Error retrieving orbit by name:', {
        userId,
        personName,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Creates or updates an orbit person
   *
   * @param userId - The user UUID
   * @param person - The person data
   * @returns The created/updated orbit record
   */
  async upsertOrbitPerson(userId: string, person: OrbitPersonInput): Promise<Orbit> {
    try {
      // Check if person exists
      const existing = await this.getOrbitByName(userId, person.person_name);

      if (existing) {
        // Update existing
        const result: QueryResult = await this.pool.query(
          `UPDATE orbits
           SET relationship = COALESCE($1, relationship),
               current_situation = COALESCE($2, current_situation),
               how_this_affects_user = COALESCE($3, how_this_affects_user),
               orbit_tier = COALESCE($4, orbit_tier),
               last_mentioned_at = NOW()
           WHERE id = $5
           RETURNING *`,
          [
            person.relationship,
            person.current_situation ? JSON.stringify(person.current_situation) : null,
            person.how_this_affects_user,
            person.orbit_tier,
            existing.id,
          ]
        );

        logger.info('Orbit person updated', {
          userId,
          personName: person.person_name,
        });
        return this.parseOrbitRow(result.rows[0]);
      } else {
        // Create new
        const result: QueryResult = await this.pool.query(
          `INSERT INTO orbits (
            user_id,
            person_name,
            relationship,
            current_situation,
            how_this_affects_user,
            orbit_tier
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING *`,
          [
            userId,
            person.person_name,
            person.relationship || 'unknown',
            JSON.stringify(person.current_situation || {}),
            person.how_this_affects_user || '',
            person.orbit_tier || 'outer',
          ]
        );

        logger.info('Orbit person created', {
          userId,
          personName: person.person_name,
          tier: person.orbit_tier || 'outer',
        });
        return this.parseOrbitRow(result.rows[0]);
      }
    } catch (error: any) {
      logger.error('Error upserting orbit person:', {
        userId,
        personName: person.person_name,
        error: error.message,
      });
      throw new Error(`Failed to upsert orbit person: ${error.message}`);
    }
  }

  /**
   * Updates the last discussed timestamp for a person
   *
   * @param userId - The user UUID
   * @param personName - The person's name
   */
  async touchOrbitPerson(userId: string, personName: string): Promise<void> {
    try {
      await this.pool.query(
        `UPDATE orbits
         SET last_discussed_at = NOW(),
             last_mentioned_at = NOW()
         WHERE user_id = $1 AND LOWER(person_name) = LOWER($2) AND is_active = TRUE`,
        [userId, personName]
      );
    } catch (error: any) {
      logger.warn('Error touching orbit person:', {
        userId,
        personName,
        error: error.message,
      });
    }
  }

  /**
   * Deactivates an orbit person (soft delete)
   *
   * @param userId - The user UUID
   * @param personName - The person's name
   */
  async deactivateOrbitPerson(userId: string, personName: string): Promise<void> {
    try {
      await this.pool.query(
        `UPDATE orbits
         SET is_active = FALSE
         WHERE user_id = $1 AND LOWER(person_name) = LOWER($2)`,
        [userId, personName]
      );

      logger.info('Orbit person deactivated', { userId, personName });
    } catch (error: any) {
      logger.error('Error deactivating orbit person:', {
        userId,
        personName,
        error: error.message,
      });
      throw new Error(`Failed to deactivate orbit person: ${error.message}`);
    }
  }

  /**
   * Changes the tier of an orbit person
   *
   * @param userId - The user UUID
   * @param personName - The person's name
   * @param newTier - The new tier
   */
  async changeOrbitTier(
    userId: string,
    personName: string,
    newTier: 'inner' | 'mid' | 'outer'
  ): Promise<Orbit | null> {
    try {
      const result: QueryResult = await this.pool.query(
        `UPDATE orbits
         SET orbit_tier = $1
         WHERE user_id = $2 AND LOWER(person_name) = LOWER($3) AND is_active = TRUE
         RETURNING *`,
        [newTier, userId, personName]
      );

      if (result.rows.length === 0) {
        return null;
      }

      logger.info('Orbit tier changed', { userId, personName, newTier });
      return this.parseOrbitRow(result.rows[0]);
    } catch (error: any) {
      logger.error('Error changing orbit tier:', {
        userId,
        personName,
        newTier,
        error: error.message,
      });
      throw new Error(`Failed to change orbit tier: ${error.message}`);
    }
  }

  /**
   * Gets recently mentioned orbits (within N days)
   *
   * @param userId - The user UUID
   * @param days - Number of days to look back
   * @param limit - Maximum results
   */
  async getRecentlyMentioned(
    userId: string,
    days: number = 7,
    limit: number = 10
  ): Promise<Orbit[]> {
    try {
      const result: QueryResult = await this.pool.query(
        `SELECT * FROM orbits
         WHERE user_id = $1
           AND is_active = TRUE
           AND last_mentioned_at > NOW() - INTERVAL '1 day' * $2
         ORDER BY last_mentioned_at DESC
         LIMIT $3`,
        [userId, days, limit]
      );

      return result.rows.map(this.parseOrbitRow);
    } catch (error: any) {
      logger.error('Error retrieving recently mentioned orbits:', {
        userId,
        days,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Formats orbits for prompt injection
   *
   * @param orbits - The orbits to format
   * @returns Formatted string for system prompt
   */
  formatOrbitsForPrompt(orbits: Orbit[]): string {
    if (orbits.length === 0) {
      return '';
    }

    const sections: string[] = [];

    // Group by tier
    const tiers = {
      inner: orbits.filter((o) => o.orbit_tier === 'inner'),
      mid: orbits.filter((o) => o.orbit_tier === 'mid'),
      outer: orbits.filter((o) => o.orbit_tier === 'outer'),
    };

    // Inner circle - always include
    if (tiers.inner.length > 0) {
      const innerText = tiers.inner
        .map((o) => {
          let line = `  - ${o.person_name} (${o.relationship || 'close relationship'})`;
          if (o.how_this_affects_user) {
            line += `\n    Impact: ${o.how_this_affects_user}`;
          }
          return line;
        })
        .join('\n');
      sections.push(`Inner Circle:\n${innerText}`);
    }

    // Mid tier - include if recently mentioned (within 14 days)
    const recentMid = tiers.mid.filter((o) => {
      const lastMentioned = new Date(o.last_mentioned_at);
      const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      return lastMentioned > fourteenDaysAgo;
    });

    if (recentMid.length > 0) {
      const midText = recentMid
        .map((o) => `  - ${o.person_name} (${o.relationship || 'relationship'})`)
        .join('\n');
      sections.push(`Recently Mentioned:\n${midText}`);
    }

    // Outer tier - only include if very recently mentioned (within 7 days)
    const recentOuter = tiers.outer.filter((o) => {
      const lastMentioned = new Date(o.last_mentioned_at);
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      return lastMentioned > sevenDaysAgo;
    });

    if (recentOuter.length > 0) {
      const outerText = recentOuter
        .slice(0, 5) // Limit outer tier
        .map((o) => `  - ${o.person_name}`)
        .join('\n');
      sections.push(`Other Recent Mentions:\n${outerText}`);
    }

    if (sections.length === 0) {
      return '';
    }

    return `\n\n🌍 PEOPLE IN USER'S ECOSYSTEM:\n${sections.join('\n\n')}`;
  }

  /**
   * Gets orbit count by tier
   */
  async getOrbitCounts(
    userId: string
  ): Promise<{ inner: number; mid: number; outer: number; total: number }> {
    try {
      const result: QueryResult = await this.pool.query(
        `SELECT orbit_tier, COUNT(*) as count
         FROM orbits
         WHERE user_id = $1 AND is_active = TRUE
         GROUP BY orbit_tier`,
        [userId]
      );

      const counts = { inner: 0, mid: 0, outer: 0, total: 0 };
      for (const row of result.rows) {
        counts[row.orbit_tier as 'inner' | 'mid' | 'outer'] = parseInt(row.count, 10);
        counts.total += parseInt(row.count, 10);
      }

      return counts;
    } catch (error: any) {
      logger.error('Error getting orbit counts:', { userId, error: error.message });
      return { inner: 0, mid: 0, outer: 0, total: 0 };
    }
  }

  /**
   * Parses a database row into a typed Orbit object
   */
  private parseOrbitRow(row: any): Orbit {
    return {
      id: row.id,
      user_id: row.user_id,
      person_name: row.person_name,
      relationship: row.relationship,
      current_situation: row.current_situation || {},
      recent_interactions: row.recent_interactions || [],
      how_this_affects_user: row.how_this_affects_user,
      last_discussed_at: row.last_discussed_at,
      orbit_tier: row.orbit_tier,
      is_active: row.is_active,
      first_mentioned_at: row.first_mentioned_at,
      last_mentioned_at: row.last_mentioned_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}

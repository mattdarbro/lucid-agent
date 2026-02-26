import { Pool } from 'pg';
import { logger } from '../logger';
import { Seed, SeedStatus, SeedSource, SeedType } from '../types/database';
import { VectorService } from './vector.service';

/**
 * Input for planting a new seed
 */
export interface PlantSeedInput {
  user_id: string;
  content: string;
  seed_type?: SeedType;
  source?: SeedSource;
  source_metadata?: Record<string, any>;
  planted_context?: string;
}

/**
 * Result from planting a seed
 */
export interface PlantResult {
  seed: Seed;
  message: string;
}

/**
 * SeedService
 *
 * Simplified capture system - just stores what the user plants.
 * No AI classification, no routing to different tables.
 * Seeds grow over time through surfacing and reflection.
 *
 * Investment seeds use the same lifecycle:
 *   held     = recommendation pending / open position
 *   growing  = position is active, being tracked
 *   grown    = position closed, P&L recorded
 *   released = recommendation skipped/cancelled
 */
export class SeedService {
  private vectorService: VectorService;

  constructor(private pool: Pool) {
    this.vectorService = new VectorService();
  }

  /**
   * Plant a new seed - simply stores the content without classification
   *
   * @param input - The seed planting input
   * @returns The planted seed
   */
  async plant(input: PlantSeedInput): Promise<PlantResult> {
    const {
      user_id,
      content,
      seed_type = 'thought',
      source = 'app',
      source_metadata = {},
      planted_context = null,
    } = input;

    try {
      // Generate embedding for semantic search (optional, don't fail if it fails)
      let embeddingString: string | null = null;
      try {
        const embedding = await this.vectorService.generateEmbedding(content);
        embeddingString = `[${embedding.join(',')}]`;
      } catch (embeddingError) {
        logger.warn('Failed to generate embedding for seed', { error: embeddingError });
      }

      const result = await this.pool.query(
        `INSERT INTO seeds (
          user_id, content, seed_type, source, source_metadata, status, planted_context, embedding
        )
        VALUES ($1, $2, $3, $4, $5, 'held', $6, $7::vector)
        RETURNING *`,
        [user_id, content.trim(), seed_type, source, source_metadata, planted_context, embeddingString]
      );

      const seed = this.rowToSeed(result.rows[0]);

      logger.info('Seed planted', {
        seedId: seed.id,
        userId: user_id,
        seedType: seed_type,
        source,
        hasContext: !!planted_context,
      });

      return {
        seed,
        message: 'Seed planted successfully',
      };
    } catch (error: any) {
      logger.error('Error planting seed:', { userId: user_id, error: error.message });
      throw new Error(`Failed to plant seed: ${error.message}`);
    }
  }

  /**
   * Get a specific seed by ID
   */
  async getSeed(seedId: string): Promise<Seed | null> {
    try {
      const result = await this.pool.query(
        `SELECT * FROM seeds WHERE id = $1`,
        [seedId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return this.rowToSeed(result.rows[0]);
    } catch (error: any) {
      logger.error('Error getting seed:', { seedId, error: error.message });
      throw error;
    }
  }

  /**
   * Get all seeds for a user, optionally filtered by status
   */
  async getSeeds(
    userId: string,
    options: {
      status?: SeedStatus | SeedStatus[];
      seed_type?: SeedType | SeedType[];
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ seeds: Seed[]; total: number }> {
    try {
      const { status, seed_type, limit = 50, offset = 0 } = options;

      let whereClause = 'WHERE user_id = $1';
      const params: any[] = [userId];

      if (status) {
        if (Array.isArray(status)) {
          params.push(status);
          whereClause += ` AND status = ANY($${params.length})`;
        } else {
          params.push(status);
          whereClause += ` AND status = $${params.length}`;
        }
      }

      if (seed_type) {
        if (Array.isArray(seed_type)) {
          params.push(seed_type);
          whereClause += ` AND seed_type = ANY($${params.length})`;
        } else {
          params.push(seed_type);
          whereClause += ` AND seed_type = $${params.length}`;
        }
      }

      // Get total count
      const countResult = await this.pool.query(
        `SELECT COUNT(*) FROM seeds ${whereClause}`,
        params
      );
      const total = parseInt(countResult.rows[0].count, 10);

      // Get seeds
      params.push(limit, offset);
      const result = await this.pool.query(
        `SELECT * FROM seeds ${whereClause}
         ORDER BY planted_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );

      return {
        seeds: result.rows.map(this.rowToSeed),
        total,
      };
    } catch (error: any) {
      logger.error('Error getting seeds:', { userId, error: error.message });
      throw error;
    }
  }

  /**
   * Get investment seeds for building portfolio state
   * Returns recommendation and trade execution seeds that are active
   */
  async getInvestmentSeeds(
    userId: string,
    options: {
      includeCompleted?: boolean;
    } = {}
  ): Promise<Seed[]> {
    try {
      const { includeCompleted = false } = options;

      let statusFilter = `AND status IN ('held', 'growing')`;
      if (includeCompleted) {
        statusFilter = ''; // all statuses
      }

      const result = await this.pool.query(
        `SELECT * FROM seeds
         WHERE user_id = $1
           AND seed_type IN ('investment_recommendation', 'trade_execution', 'portfolio_update')
           ${statusFilter}
         ORDER BY planted_at DESC`,
        [userId]
      );

      return result.rows.map(this.rowToSeed);
    } catch (error: any) {
      logger.error('Error getting investment seeds:', { userId, error: error.message });
      throw error;
    }
  }

  /**
   * Mark a seed as growing (actively being worked on/thought about)
   */
  async markGrowing(seedId: string): Promise<Seed> {
    try {
      const result = await this.pool.query(
        `UPDATE seeds
         SET status = 'growing', updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [seedId]
      );

      if (result.rows.length === 0) {
        throw new Error('Seed not found');
      }

      logger.info('Seed marked as growing', { seedId });
      return this.rowToSeed(result.rows[0]);
    } catch (error: any) {
      logger.error('Error marking seed as growing:', { seedId, error: error.message });
      throw error;
    }
  }

  /**
   * Mark a seed as grown (has developed into something in the library)
   */
  async markGrown(seedId: string, libraryEntryId: string): Promise<Seed> {
    try {
      const result = await this.pool.query(
        `UPDATE seeds
         SET status = 'grown', grown_into_library_id = $2, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [seedId, libraryEntryId]
      );

      if (result.rows.length === 0) {
        throw new Error('Seed not found');
      }

      logger.info('Seed marked as grown', { seedId, libraryEntryId });
      return this.rowToSeed(result.rows[0]);
    } catch (error: any) {
      logger.error('Error marking seed as grown:', { seedId, error: error.message });
      throw error;
    }
  }

  /**
   * Release a seed (soft delete / archive)
   */
  async release(seedId: string): Promise<Seed> {
    try {
      const result = await this.pool.query(
        `UPDATE seeds
         SET status = 'released', released_at = NOW(), updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [seedId]
      );

      if (result.rows.length === 0) {
        throw new Error('Seed not found');
      }

      logger.info('Seed released', { seedId });
      return this.rowToSeed(result.rows[0]);
    } catch (error: any) {
      logger.error('Error releasing seed:', { seedId, error: error.message });
      throw error;
    }
  }

  /**
   * Record that a seed was surfaced (shown to user in briefing, etc.)
   */
  async recordSurfacing(seedId: string): Promise<Seed> {
    try {
      const result = await this.pool.query(
        `UPDATE seeds
         SET last_surfaced_at = NOW(), surface_count = surface_count + 1, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [seedId]
      );

      if (result.rows.length === 0) {
        throw new Error('Seed not found');
      }

      return this.rowToSeed(result.rows[0]);
    } catch (error: any) {
      logger.error('Error recording seed surfacing:', { seedId, error: error.message });
      throw error;
    }
  }

  /**
   * Update a seed's content, context, status, or source_metadata
   */
  async update(
    seedId: string,
    updates: {
      content?: string;
      planted_context?: string;
      status?: SeedStatus;
      source_metadata?: Record<string, any>;
    }
  ): Promise<Seed> {
    try {
      const setClauses: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (updates.content !== undefined) {
        setClauses.push(`content = $${paramIndex}`);
        values.push(updates.content.trim());
        paramIndex++;
      }

      if (updates.planted_context !== undefined) {
        setClauses.push(`planted_context = $${paramIndex}`);
        values.push(updates.planted_context);
        paramIndex++;
      }

      if (updates.status !== undefined) {
        setClauses.push(`status = $${paramIndex}`);
        values.push(updates.status);
        paramIndex++;

        // If releasing, set released_at
        if (updates.status === 'released') {
          setClauses.push(`released_at = NOW()`);
        }
      }

      if (updates.source_metadata !== undefined) {
        // Merge with existing metadata rather than replacing
        setClauses.push(`source_metadata = source_metadata || $${paramIndex}::jsonb`);
        values.push(JSON.stringify(updates.source_metadata));
        paramIndex++;
      }

      if (setClauses.length === 0) {
        throw new Error('No valid fields to update');
      }

      setClauses.push(`updated_at = NOW()`);
      values.push(seedId);

      const result = await this.pool.query(
        `UPDATE seeds
         SET ${setClauses.join(', ')}
         WHERE id = $${paramIndex}
         RETURNING *`,
        values
      );

      if (result.rows.length === 0) {
        throw new Error('Seed not found');
      }

      logger.info('Seed updated', { seedId });
      return this.rowToSeed(result.rows[0]);
    } catch (error: any) {
      logger.error('Error updating seed:', { seedId, error: error.message });
      throw error;
    }
  }

  /**
   * Get seeds that haven't been surfaced recently (for briefings)
   * Excludes investment seeds — those are surfaced separately in portfolio context
   */
  async getSeedsForSurfacing(
    userId: string,
    limit: number = 5
  ): Promise<Seed[]> {
    try {
      const result = await this.pool.query(
        `SELECT * FROM seeds
         WHERE user_id = $1
           AND status IN ('held', 'growing')
           AND seed_type = 'thought'
         ORDER BY
           last_surfaced_at ASC NULLS FIRST,
           surface_count ASC,
           planted_at DESC
         LIMIT $2`,
        [userId, limit]
      );

      return result.rows.map(this.rowToSeed);
    } catch (error: any) {
      logger.error('Error getting seeds for surfacing:', { userId, error: error.message });
      throw error;
    }
  }

  /**
   * Convert database row to Seed interface
   */
  private rowToSeed(row: any): Seed {
    return {
      id: row.id,
      user_id: row.user_id,
      content: row.content,
      seed_type: row.seed_type || 'thought',
      source: row.source,
      source_metadata: row.source_metadata || {},
      status: row.status,
      planted_context: row.planted_context,
      last_surfaced_at: row.last_surfaced_at ? new Date(row.last_surfaced_at) : null,
      surface_count: row.surface_count || 0,
      grown_into_library_id: row.grown_into_library_id,
      released_at: row.released_at ? new Date(row.released_at) : null,
      embedding: row.embedding,
      planted_at: new Date(row.planted_at),
      updated_at: new Date(row.updated_at),
    };
  }
}

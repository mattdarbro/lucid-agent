import { Pool, QueryResult } from 'pg';
import { logger } from '../logger';
import {
  CreateEvidenceInput,
  UpdateEvidenceInput,
  EvidenceContextType,
} from '../validation/evidence.validation';

/**
 * Evidence entity from database
 */
export interface Evidence {
  id: string;
  fact_id: string;
  message_id: string | null;
  conversation_id: string | null;
  excerpt: string;
  strength: number;
  context_type: EvidenceContextType | null;
  created_at: Date;
}

/**
 * EvidenceService
 *
 * Handles all evidence-related operations including:
 * - Creating evidence (automatically updates fact confidence via trigger)
 * - Retrieving and listing evidence
 * - Managing evidence lifecycle
 *
 * Note: Fact confidence is automatically recalculated by a database trigger
 * when evidence is added, updated, or deleted.
 */
export class EvidenceService {
  constructor(private pool: Pool) {}

  /**
   * Creates new evidence for a fact
   *
   * Note: This will automatically update the fact's confidence via database trigger
   *
   * @param input - Validated evidence creation data
   * @returns The created evidence
   * @throws Error if fact doesn't exist or creation fails
   */
  async createEvidence(input: CreateEvidenceInput): Promise<Evidence> {
    try {
      // Verify fact exists
      const factCheck = await this.pool.query(
        'SELECT id FROM facts WHERE id = $1',
        [input.fact_id]
      );

      if (factCheck.rows.length === 0) {
        throw new Error('Fact not found');
      }

      // Verify message exists if provided
      if (input.message_id) {
        const messageCheck = await this.pool.query(
          'SELECT id FROM messages WHERE id = $1',
          [input.message_id]
        );

        if (messageCheck.rows.length === 0) {
          throw new Error('Message not found');
        }
      }

      // Create evidence
      const result: QueryResult<Evidence> = await this.pool.query(
        `INSERT INTO evidence (fact_id, message_id, conversation_id, excerpt, strength, context_type)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          input.fact_id,
          input.message_id || null,
          input.conversation_id || null,
          input.excerpt,
          input.strength !== undefined ? input.strength : 0.7,
          input.context_type || null,
        ]
      );

      const evidence = result.rows[0];
      logger.info(
        `Evidence created: ${evidence.id} for fact ${input.fact_id} (strength: ${evidence.strength})`
      );

      // Note: The database trigger automatically updates the fact's confidence here

      return evidence;
    } catch (error: any) {
      logger.error('Error creating evidence:', {
        message: error.message,
        code: error.code,
        detail: error.detail,
      });
      throw new Error(`Failed to create evidence: ${error.message}`);
    }
  }

  /**
   * Creates multiple evidence items in a batch
   *
   * @param evidenceList - Array of evidence inputs
   * @returns Array of created evidence
   */
  async createEvidenceBatch(
    evidenceList: CreateEvidenceInput[]
  ): Promise<Evidence[]> {
    if (evidenceList.length === 0) {
      return [];
    }

    const created: Evidence[] = [];

    // Create each evidence item
    // Note: We do this sequentially to ensure proper trigger execution
    for (const input of evidenceList) {
      try {
        const evidence = await this.createEvidence(input);
        created.push(evidence);
      } catch (error: any) {
        logger.warn(`Failed to create evidence: ${error.message}`);
        // Continue with other evidence items
      }
    }

    logger.info(`Created ${created.length} of ${evidenceList.length} evidence items`);
    return created;
  }

  /**
   * Finds evidence by ID
   *
   * @param id - The evidence UUID
   * @returns The evidence if found, null otherwise
   */
  async findById(id: string): Promise<Evidence | null> {
    try {
      const result: QueryResult<Evidence> = await this.pool.query(
        'SELECT * FROM evidence WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        logger.debug(`Evidence not found: ${id}`);
        return null;
      }

      return result.rows[0];
    } catch (error: any) {
      logger.error('Error finding evidence:', error);
      throw new Error(`Failed to find evidence: ${error.message}`);
    }
  }

  /**
   * Lists evidence for a specific fact
   *
   * @param fact_id - The fact UUID
   * @param options - Filter options
   * @returns Array of evidence
   */
  async listByFact(
    fact_id: string,
    options: {
      limit?: number;
      offset?: number;
      context_type?: EvidenceContextType;
      min_strength?: number;
    } = {}
  ): Promise<Evidence[]> {
    try {
      let query = 'SELECT * FROM evidence WHERE fact_id = $1';
      const params: any[] = [fact_id];

      if (options.context_type) {
        query += ` AND context_type = $${params.length + 1}`;
        params.push(options.context_type);
      }

      if (options.min_strength !== undefined) {
        query += ` AND strength >= $${params.length + 1}`;
        params.push(options.min_strength);
      }

      query += ` ORDER BY strength DESC, created_at DESC`;
      query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(options.limit || 50, options.offset || 0);

      const result: QueryResult<Evidence> = await this.pool.query(query, params);

      return result.rows;
    } catch (error: any) {
      logger.error('Error listing evidence:', error);
      throw new Error(`Failed to list evidence: ${error.message}`);
    }
  }

  /**
   * Updates evidence
   *
   * Note: This will recalculate fact confidence via database trigger
   *
   * @param id - The evidence UUID
   * @param updates - Fields to update
   * @returns The updated evidence if found, null otherwise
   */
  async updateEvidence(
    id: string,
    updates: UpdateEvidenceInput
  ): Promise<Evidence | null> {
    try {
      const setClauses: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      if (updates.excerpt !== undefined) {
        setClauses.push(`excerpt = $${paramIndex++}`);
        params.push(updates.excerpt);
      }

      if (updates.strength !== undefined) {
        setClauses.push(`strength = $${paramIndex++}`);
        params.push(updates.strength);
      }

      if (updates.context_type !== undefined) {
        setClauses.push(`context_type = $${paramIndex++}`);
        params.push(updates.context_type);
      }

      if (setClauses.length === 0) {
        // No updates provided
        return this.findById(id);
      }

      params.push(id);

      const query = `
        UPDATE evidence
        SET ${setClauses.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING *
      `;

      const result: QueryResult<Evidence> = await this.pool.query(query, params);

      if (result.rows.length === 0) {
        logger.debug(`Evidence not found for update: ${id}`);
        return null;
      }

      logger.info(`Evidence updated: ${id}`);
      // Note: Database trigger will recalculate fact confidence

      return result.rows[0];
    } catch (error: any) {
      logger.error('Error updating evidence:', error);
      throw new Error(`Failed to update evidence: ${error.message}`);
    }
  }

  /**
   * Deletes evidence
   *
   * Note: This will recalculate fact confidence via database trigger
   *
   * @param id - The evidence UUID
   * @returns True if deleted, false if not found
   */
  async deleteEvidence(id: string): Promise<boolean> {
    try {
      const result = await this.pool.query('DELETE FROM evidence WHERE id = $1', [
        id,
      ]);

      const deleted = result.rowCount !== null && result.rowCount > 0;

      if (deleted) {
        logger.info(`Evidence deleted: ${id}`);
        // Note: Database trigger will recalculate fact confidence
      } else {
        logger.debug(`Evidence not found for deletion: ${id}`);
      }

      return deleted;
    } catch (error: any) {
      logger.error('Error deleting evidence:', error);
      throw new Error(`Failed to delete evidence: ${error.message}`);
    }
  }

  /**
   * Gets evidence count for a fact
   *
   * @param fact_id - The fact UUID
   * @returns Total number of evidence items
   */
  async getCountByFact(fact_id: string): Promise<number> {
    try {
      const result = await this.pool.query(
        'SELECT COUNT(*) as count FROM evidence WHERE fact_id = $1',
        [fact_id]
      );

      return parseInt(result.rows[0].count, 10);
    } catch (error: any) {
      logger.error('Error counting evidence:', error);
      throw new Error(`Failed to count evidence: ${error.message}`);
    }
  }

  /**
   * Gets average evidence strength for a fact
   *
   * @param fact_id - The fact UUID
   * @returns Average strength (0-1), or null if no evidence
   */
  async getAverageStrength(fact_id: string): Promise<number | null> {
    try {
      const result = await this.pool.query(
        'SELECT AVG(strength) as avg_strength FROM evidence WHERE fact_id = $1',
        [fact_id]
      );

      const avgStrength = result.rows[0].avg_strength;
      return avgStrength ? parseFloat(avgStrength) : null;
    } catch (error: any) {
      logger.error('Error calculating average strength:', error);
      throw new Error(`Failed to calculate average strength: ${error.message}`);
    }
  }
}

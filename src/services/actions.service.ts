import { Pool, QueryResult } from 'pg';
import { logger } from '../logger';
import { Action, ActionStatus, ActionSource } from '../types/database';

/**
 * Input for creating an action
 */
export interface CreateActionInput {
  content: string;
  summary?: string;
  person_id?: string;
  source?: ActionSource;
}

/**
 * Input for updating an action
 */
export interface UpdateActionInput {
  content?: string;
  summary?: string;
  status?: ActionStatus;
  person_id?: string | null;
}

/**
 * Filters for listing actions
 */
export interface ActionFilters {
  status?: ActionStatus;
  person_id?: string;
  source?: ActionSource;
  limit?: number;
  offset?: number;
}

/**
 * ActionsService
 *
 * Manages user actions/tasks/reminders from the Capture system.
 * Actions are simple tasks that can be linked to people in orbits.
 */
export class ActionsService {
  constructor(private pool: Pool) {}

  /**
   * Creates a new action
   *
   * @param userId - The user UUID
   * @param input - Action creation input
   * @returns The created action
   */
  async create(userId: string, input: CreateActionInput): Promise<Action> {
    try {
      const result: QueryResult = await this.pool.query(
        `INSERT INTO actions (
          user_id,
          content,
          summary,
          person_id,
          source
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *`,
        [
          userId,
          input.content,
          input.summary || null,
          input.person_id || null,
          input.source || 'capture',
        ]
      );

      const action = this.parseActionRow(result.rows[0]);
      logger.info('Action created', {
        userId,
        actionId: action.id,
        source: action.source,
      });

      return action;
    } catch (error: any) {
      logger.error('Error creating action:', {
        userId,
        error: error.message,
      });
      throw new Error(`Failed to create action: ${error.message}`);
    }
  }

  /**
   * Gets an action by ID
   *
   * @param actionId - The action UUID
   * @returns The action or null if not found
   */
  async getById(actionId: string): Promise<Action | null> {
    try {
      const result: QueryResult = await this.pool.query(
        'SELECT * FROM actions WHERE id = $1',
        [actionId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return this.parseActionRow(result.rows[0]);
    } catch (error: any) {
      logger.error('Error getting action by ID:', {
        actionId,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Gets all actions for a user with optional filters
   *
   * @param userId - The user UUID
   * @param filters - Optional filters
   * @returns Array of actions
   */
  async getByUser(userId: string, filters: ActionFilters = {}): Promise<Action[]> {
    try {
      let query = 'SELECT * FROM actions WHERE user_id = $1';
      const params: any[] = [userId];
      let paramIndex = 2;

      if (filters.status) {
        query += ` AND status = $${paramIndex}`;
        params.push(filters.status);
        paramIndex++;
      }

      if (filters.person_id) {
        query += ` AND person_id = $${paramIndex}`;
        params.push(filters.person_id);
        paramIndex++;
      }

      if (filters.source) {
        query += ` AND source = $${paramIndex}`;
        params.push(filters.source);
        paramIndex++;
      }

      query += ' ORDER BY created_at DESC';

      if (filters.limit) {
        query += ` LIMIT $${paramIndex}`;
        params.push(filters.limit);
        paramIndex++;
      }

      if (filters.offset) {
        query += ` OFFSET $${paramIndex}`;
        params.push(filters.offset);
      }

      const result: QueryResult = await this.pool.query(query, params);

      logger.debug(`Retrieved ${result.rows.length} actions for user`, {
        userId,
        filters,
      });

      return result.rows.map(this.parseActionRow);
    } catch (error: any) {
      logger.error('Error getting actions by user:', {
        userId,
        filters,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Gets open (active) actions for a user
   *
   * @param userId - The user UUID
   * @param limit - Maximum number of actions to return
   * @returns Array of open actions
   */
  async getOpenActions(userId: string, limit: number = 50): Promise<Action[]> {
    return this.getByUser(userId, { status: 'open', limit });
  }

  /**
   * Gets actions linked to a specific person
   *
   * @param userId - The user UUID
   * @param personId - The orbit person UUID
   * @returns Array of actions for that person
   */
  async getByPerson(userId: string, personId: string): Promise<Action[]> {
    return this.getByUser(userId, { person_id: personId });
  }

  /**
   * Updates an action
   *
   * @param actionId - The action UUID
   * @param input - Fields to update
   * @returns The updated action or null if not found
   */
  async update(actionId: string, input: UpdateActionInput): Promise<Action | null> {
    try {
      const updates: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      if (input.content !== undefined) {
        updates.push(`content = $${paramIndex}`);
        params.push(input.content);
        paramIndex++;
      }

      if (input.summary !== undefined) {
        updates.push(`summary = $${paramIndex}`);
        params.push(input.summary);
        paramIndex++;
      }

      if (input.status !== undefined) {
        updates.push(`status = $${paramIndex}`);
        params.push(input.status);
        paramIndex++;
      }

      if (input.person_id !== undefined) {
        updates.push(`person_id = $${paramIndex}`);
        params.push(input.person_id);
        paramIndex++;
      }

      if (updates.length === 0) {
        return this.getById(actionId);
      }

      params.push(actionId);

      const result: QueryResult = await this.pool.query(
        `UPDATE actions SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
        params
      );

      if (result.rows.length === 0) {
        return null;
      }

      const action = this.parseActionRow(result.rows[0]);
      logger.info('Action updated', { actionId, updates: Object.keys(input) });

      return action;
    } catch (error: any) {
      logger.error('Error updating action:', {
        actionId,
        error: error.message,
      });
      throw new Error(`Failed to update action: ${error.message}`);
    }
  }

  /**
   * Marks an action as done
   *
   * @param actionId - The action UUID
   * @returns The updated action or null if not found
   */
  async markDone(actionId: string): Promise<Action | null> {
    return this.update(actionId, { status: 'done' });
  }

  /**
   * Marks an action as cancelled
   *
   * @param actionId - The action UUID
   * @returns The updated action or null if not found
   */
  async markCancelled(actionId: string): Promise<Action | null> {
    return this.update(actionId, { status: 'cancelled' });
  }

  /**
   * Reopens a completed or cancelled action
   *
   * @param actionId - The action UUID
   * @returns The updated action or null if not found
   */
  async reopen(actionId: string): Promise<Action | null> {
    return this.update(actionId, { status: 'open' });
  }

  /**
   * Deletes an action permanently
   *
   * @param actionId - The action UUID
   * @returns True if deleted, false if not found
   */
  async delete(actionId: string): Promise<boolean> {
    try {
      const result: QueryResult = await this.pool.query(
        'DELETE FROM actions WHERE id = $1',
        [actionId]
      );

      if (result.rowCount && result.rowCount > 0) {
        logger.info('Action deleted', { actionId });
        return true;
      }

      return false;
    } catch (error: any) {
      logger.error('Error deleting action:', {
        actionId,
        error: error.message,
      });
      throw new Error(`Failed to delete action: ${error.message}`);
    }
  }

  /**
   * Gets action counts by status for a user
   *
   * @param userId - The user UUID
   * @returns Counts by status
   */
  async getCounts(userId: string): Promise<{ open: number; done: number; cancelled: number; total: number }> {
    try {
      const result: QueryResult = await this.pool.query(
        `SELECT status, COUNT(*) as count
         FROM actions
         WHERE user_id = $1
         GROUP BY status`,
        [userId]
      );

      const counts = { open: 0, done: 0, cancelled: 0, total: 0 };
      for (const row of result.rows) {
        const status = row.status as ActionStatus;
        counts[status] = parseInt(row.count, 10);
        counts.total += parseInt(row.count, 10);
      }

      return counts;
    } catch (error: any) {
      logger.error('Error getting action counts:', { userId, error: error.message });
      return { open: 0, done: 0, cancelled: 0, total: 0 };
    }
  }

  /**
   * Gets recently completed actions
   *
   * @param userId - The user UUID
   * @param days - Number of days to look back
   * @param limit - Maximum results
   * @returns Array of completed actions
   */
  async getRecentlyCompleted(userId: string, days: number = 7, limit: number = 20): Promise<Action[]> {
    try {
      const result: QueryResult = await this.pool.query(
        `SELECT * FROM actions
         WHERE user_id = $1
           AND status = 'done'
           AND completed_at > NOW() - INTERVAL '1 day' * $2
         ORDER BY completed_at DESC
         LIMIT $3`,
        [userId, days, limit]
      );

      return result.rows.map(this.parseActionRow);
    } catch (error: any) {
      logger.error('Error getting recently completed actions:', {
        userId,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Formats open actions for briefings
   *
   * @param actions - Actions to format
   * @returns Formatted string for briefings
   */
  formatActionsForBriefing(actions: Action[]): string {
    if (actions.length === 0) {
      return 'No open actions.';
    }

    return actions
      .map((a, i) => `${i + 1}. ${a.summary || a.content}`)
      .join('\n');
  }

  /**
   * Parses a database row into a typed Action object
   */
  private parseActionRow(row: any): Action {
    return {
      id: row.id,
      user_id: row.user_id,
      content: row.content,
      summary: row.summary,
      status: row.status,
      person_id: row.person_id,
      source: row.source,
      created_at: row.created_at,
      completed_at: row.completed_at,
      updated_at: row.updated_at,
    };
  }
}

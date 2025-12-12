import { Pool, QueryResult } from 'pg';
import { logger } from '../logger';
import {
  MattState,
  MattStateGoal,
  MattStateCommitment,
  MattStateResources,
  MattStateConstraints,
  MattStateValues,
  MattStateHistory,
} from '../types/database';

/**
 * Data structure for updating Matt's state
 */
export interface MattStateUpdate {
  active_goals?: MattStateGoal[];
  active_commitments?: MattStateCommitment[];
  resources?: Partial<MattStateResources>;
  constraints?: Partial<MattStateConstraints>;
  values_priorities?: Partial<MattStateValues>;
}

/**
 * MattStateService
 *
 * Manages the "Wins" artifact - Matt's current life situation.
 * Tracks active goals, commitments, resources, constraints, and values.
 * This provides context for LUCID to understand what Matt is working towards.
 */
export class MattStateService {
  constructor(private pool: Pool) {}

  /**
   * Gets or creates the current state for a user
   *
   * @param userId - The user UUID
   * @returns The current state record
   */
  async getOrCreateState(userId: string): Promise<MattState> {
    try {
      // Try to get existing state
      const result: QueryResult = await this.pool.query(
        'SELECT * FROM matt_state WHERE user_id = $1',
        [userId]
      );

      if (result.rows.length > 0) {
        return this.parseStateRow(result.rows[0]);
      }

      // Create initial empty state
      logger.info('Creating initial matt_state', { userId });
      const insertResult: QueryResult = await this.pool.query(
        `INSERT INTO matt_state (
          user_id,
          active_goals,
          active_commitments,
          resources,
          constraints,
          values_priorities
        )
        VALUES ($1, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)
        RETURNING *`,
        [userId]
      );

      return this.parseStateRow(insertResult.rows[0]);
    } catch (error: any) {
      logger.error('Error getting/creating matt_state:', {
        userId,
        error: error.message,
      });
      throw new Error(`Failed to get/create state: ${error.message}`);
    }
  }

  /**
   * Updates the current state for a user
   *
   * @param userId - The user UUID
   * @param updates - Partial state updates to apply
   * @param updatedBy - Who/what updated the state
   * @returns The updated state
   */
  async updateState(
    userId: string,
    updates: MattStateUpdate,
    updatedBy: 'user' | 'state_session' | 'conversation'
  ): Promise<MattState> {
    try {
      // Get current state first
      const current = await this.getOrCreateState(userId);

      // Merge updates with current state
      const newState = {
        active_goals: updates.active_goals ?? current.active_goals,
        active_commitments: updates.active_commitments ?? current.active_commitments,
        resources: { ...current.resources, ...updates.resources },
        constraints: { ...current.constraints, ...updates.constraints },
        values_priorities: { ...current.values_priorities, ...updates.values_priorities },
      };

      const result: QueryResult = await this.pool.query(
        `UPDATE matt_state
         SET active_goals = $1,
             active_commitments = $2,
             resources = $3,
             constraints = $4,
             values_priorities = $5,
             last_updated_by = $6
         WHERE user_id = $7
         RETURNING *`,
        [
          JSON.stringify(newState.active_goals),
          JSON.stringify(newState.active_commitments),
          JSON.stringify(newState.resources),
          JSON.stringify(newState.constraints),
          JSON.stringify(newState.values_priorities),
          updatedBy,
          userId,
        ]
      );

      logger.info('Matt state updated', { userId, updatedBy });
      return this.parseStateRow(result.rows[0]);
    } catch (error: any) {
      logger.error('Error updating matt_state:', {
        userId,
        error: error.message,
      });
      throw new Error(`Failed to update state: ${error.message}`);
    }
  }

  /**
   * Gets state history for a user
   *
   * @param userId - The user UUID
   * @param limit - Maximum number of history entries
   * @returns Array of history entries
   */
  async getStateHistory(userId: string, limit: number = 10): Promise<MattStateHistory[]> {
    try {
      const result: QueryResult = await this.pool.query(
        `SELECT * FROM matt_state_history
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [userId, limit]
      );

      return result.rows;
    } catch (error: any) {
      logger.error('Error retrieving state history:', {
        userId,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Formats the state for prompt injection
   *
   * @param state - The state to format
   * @returns Formatted string for system prompt
   */
  formatStateForPrompt(state: MattState): string {
    const sections: string[] = [];

    // Active Goals
    if (state.active_goals && state.active_goals.length > 0) {
      const goalsText = state.active_goals
        .map((goal) => {
          let line = `  - ${goal.goal}`;
          if (goal.timeline) line += ` (${goal.timeline})`;
          if (goal.progress) line += ` [${goal.progress}]`;
          return line;
        })
        .join('\n');
      sections.push(`Active Goals:\n${goalsText}`);
    }

    // Active Commitments
    if (state.active_commitments && state.active_commitments.length > 0) {
      const commitmentsText = state.active_commitments
        .map((c) => {
          let line = `  - ${c.commitment}`;
          if (c.frequency) line += ` (${c.frequency})`;
          return line;
        })
        .join('\n');
      sections.push(`Active Commitments:\n${commitmentsText}`);
    }

    // Resources
    const resources = state.resources || {};
    const resourceItems: string[] = [];
    if (resources.time_budget) resourceItems.push(`  - Time: ${resources.time_budget}`);
    if (resources.financial_runway) resourceItems.push(`  - Financial: ${resources.financial_runway}`);
    if (resources.skills && resources.skills.length > 0) {
      resourceItems.push(`  - Skills: ${resources.skills.join(', ')}`);
    }
    if (resources.support && resources.support.length > 0) {
      resourceItems.push(`  - Support: ${resources.support.join(', ')}`);
    }
    if (resourceItems.length > 0) {
      sections.push(`Resources:\n${resourceItems.join('\n')}`);
    }

    // Constraints
    const constraints = state.constraints || {};
    const constraintItems: string[] = [];
    if (constraints.api_costs) constraintItems.push(`  - ${constraints.api_costs}`);
    if (constraints.health) constraintItems.push(`  - Health: ${constraints.health}`);
    if (constraints.technical_debt && constraints.technical_debt.length > 0) {
      constraintItems.push(`  - Technical debt: ${constraints.technical_debt.join(', ')}`);
    }
    if (constraints.other && constraints.other.length > 0) {
      constraints.other.forEach((c) => constraintItems.push(`  - ${c}`));
    }
    if (constraintItems.length > 0) {
      sections.push(`Constraints:\n${constraintItems.join('\n')}`);
    }

    // Values & Priorities
    const values = state.values_priorities || {};
    const valueItems: string[] = [];
    if (values.current_focus) valueItems.push(`  - Current focus: ${values.current_focus}`);
    if (values.top_values && values.top_values.length > 0) {
      valueItems.push(`  - Values: ${values.top_values.join(', ')}`);
    }
    if (valueItems.length > 0) {
      sections.push(`Values & Priorities:\n${valueItems.join('\n')}`);
    }

    if (sections.length === 0) {
      return '';
    }

    return `\n\n📊 USER'S CURRENT STATE:\n${sections.join('\n\n')}`;
  }

  /**
   * Gets a concise state summary
   */
  async getStateSummary(userId: string): Promise<string> {
    const state = await this.getOrCreateState(userId);

    const items: string[] = [];

    if (state.active_goals && state.active_goals.length > 0) {
      items.push(`Goals: ${state.active_goals.map((g) => g.goal).join(', ')}`);
    }

    if (state.values_priorities?.current_focus) {
      items.push(`Focus: ${state.values_priorities.current_focus}`);
    }

    if (items.length === 0) {
      return '';
    }

    return items.join(' | ');
  }

  /**
   * Parses a database row into a typed MattState object
   */
  private parseStateRow(row: any): MattState {
    return {
      id: row.id,
      user_id: row.user_id,
      active_goals: row.active_goals || [],
      active_commitments: row.active_commitments || [],
      resources: row.resources || {},
      constraints: row.constraints || {},
      values_priorities: row.values_priorities || {},
      confidence: parseFloat(row.confidence) || 0.5,
      last_updated_by: row.last_updated_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}

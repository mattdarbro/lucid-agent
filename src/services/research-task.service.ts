import { Pool, PoolClient } from 'pg';
import { SupabaseClient } from '@supabase/supabase-js';
import { ResearchTask } from '../types/database';
import {
  CreateResearchTaskInput,
  UpdateResearchTaskInput,
  ListResearchTasksInput,
  ResearchApproach,
  ResearchStatus,
} from '../validation/research-task.validation';
import { logger } from '../logger';

export class ResearchTaskService {
  constructor(
    private pool: Pool,
    private supabase: SupabaseClient,
  ) {}

  /**
   * Create a new research task
   */
  async createTask(input: CreateResearchTaskInput): Promise<ResearchTask> {
    logger.info('Creating research task', { userId: input.user_id, query: input.query });

    const insertData: any = {
      user_id: input.user_id,
      query: input.query,
      approach: input.approach ?? 'exploratory',
      priority: input.priority ?? 5,
      status: 'pending',
    };

    if (input.emotional_state_id) insertData.emotional_state_id = input.emotional_state_id;
    if (input.purpose) insertData.purpose = input.purpose;

    const { data, error } = await this.supabase
      .from('research_tasks')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      logger.error('Failed to create research task', { error, input });
      throw new Error(`Failed to create research task: ${error.message}`);
    }

    logger.info('Research task created successfully', { taskId: data.id });
    return this.mapToResearchTask(data);
  }

  /**
   * Get research task by ID
   */
  async getTaskById(taskId: string): Promise<ResearchTask | null> {
    logger.debug('Fetching research task', { taskId });

    const { data, error } = await this.supabase
      .from('research_tasks')
      .select('*')
      .eq('id', taskId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        logger.debug('Research task not found', { taskId });
        return null;
      }
      logger.error('Failed to fetch research task', { error, taskId });
      throw new Error(`Failed to fetch research task: ${error.message}`);
    }

    return this.mapToResearchTask(data);
  }

  /**
   * Update research task
   */
  async updateTask(taskId: string, input: UpdateResearchTaskInput): Promise<ResearchTask> {
    logger.info('Updating research task', { taskId });

    const updateData: any = {};
    if (input.status) updateData.status = input.status;
    if (input.results !== undefined) updateData.results = input.results;
    if (input.derived_facts !== undefined) updateData.derived_facts = input.derived_facts;
    if (input.started_at) updateData.started_at = input.started_at.toISOString();
    if (input.completed_at) updateData.completed_at = input.completed_at.toISOString();

    const { data, error } = await this.supabase
      .from('research_tasks')
      .update(updateData)
      .eq('id', taskId)
      .select()
      .single();

    if (error) {
      logger.error('Failed to update research task', { error, taskId, input });
      throw new Error(`Failed to update research task: ${error.message}`);
    }

    logger.info('Research task updated successfully', { taskId });
    return this.mapToResearchTask(data);
  }

  /**
   * List research tasks with filters
   */
  async listTasks(input: ListResearchTasksInput): Promise<ResearchTask[]> {
    logger.debug('Listing research tasks', { input });

    let query = this.supabase.from('research_tasks').select('*');

    if (input.user_id) query = query.eq('user_id', input.user_id);
    if (input.status) query = query.eq('status', input.status);
    if (input.approach) query = query.eq('approach', input.approach);
    if (input.min_priority) query = query.gte('priority', input.min_priority);
    if (input.created_after) query = query.gte('created_at', input.created_after.toISOString());
    if (input.created_before) query = query.lte('created_at', input.created_before.toISOString());

    query = query.order('priority', { ascending: false });
    query = query.order('created_at', { ascending: false });
    query = query.range(input.offset, input.offset + input.limit - 1);

    const { data, error } = await query;

    if (error) {
      logger.error('Failed to list research tasks', { error, input });
      throw new Error(`Failed to list research tasks: ${error.message}`);
    }

    return data.map(task => this.mapToResearchTask(task));
  }

  /**
   * Get pending tasks ordered by priority
   */
  async getPendingTasks(userId?: string, limit: number = 10): Promise<ResearchTask[]> {
    logger.debug('Fetching pending research tasks', { userId, limit });

    let query = this.supabase
      .from('research_tasks')
      .select('*')
      .eq('status', 'pending');

    if (userId) {
      query = query.eq('user_id', userId);
    }

    query = query
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(limit);

    const { data, error } = await query;

    if (error) {
      logger.error('Failed to fetch pending research tasks', { error, userId });
      throw new Error(`Failed to fetch pending research tasks: ${error.message}`);
    }

    logger.info('Found pending research tasks', { count: data.length });
    return data.map(task => this.mapToResearchTask(task));
  }

  /**
   * Mark task as started
   */
  async markTaskAsStarted(taskId: string): Promise<ResearchTask> {
    return this.updateTask(taskId, {
      status: 'in_progress',
      started_at: new Date(),
    });
  }

  /**
   * Mark task as completed
   */
  async markTaskAsCompleted(
    taskId: string,
    results: Record<string, unknown>,
    derivedFacts?: string[],
  ): Promise<ResearchTask> {
    return this.updateTask(taskId, {
      status: 'completed',
      results,
      derived_facts: derivedFacts,
      completed_at: new Date(),
    });
  }

  /**
   * Mark task as failed
   */
  async markTaskAsFailed(taskId: string, errorResults: Record<string, unknown>): Promise<ResearchTask> {
    return this.updateTask(taskId, {
      status: 'failed',
      results: errorResults,
      completed_at: new Date(),
    });
  }

  /**
   * Delete research task
   */
  async deleteTask(taskId: string): Promise<void> {
    logger.info('Deleting research task', { taskId });

    const { error } = await this.supabase
      .from('research_tasks')
      .delete()
      .eq('id', taskId);

    if (error) {
      logger.error('Failed to delete research task', { error, taskId });
      throw new Error(`Failed to delete research task: ${error.message}`);
    }

    logger.info('Research task deleted successfully', { taskId });
  }

  /**
   * Get tasks by emotional state ID
   */
  async getTasksByEmotionalStateId(emotionalStateId: string): Promise<ResearchTask[]> {
    logger.debug('Fetching tasks by emotional state ID', { emotionalStateId });

    const { data, error } = await this.supabase
      .from('research_tasks')
      .select('*')
      .eq('emotional_state_id', emotionalStateId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Failed to fetch tasks by emotional state ID', { error, emotionalStateId });
      throw new Error(`Failed to fetch tasks by emotional state ID: ${error.message}`);
    }

    return data.map(task => this.mapToResearchTask(task));
  }

  /**
   * Reset tasks stuck in 'in_progress' status for too long
   * This can happen if the server crashes during task execution
   */
  async resetStuckTasks(stuckAfterMinutes: number = 10): Promise<number> {
    logger.info('Checking for stuck research tasks', { stuckAfterMinutes });

    const cutoffTime = new Date(Date.now() - stuckAfterMinutes * 60 * 1000);

    const { data, error } = await this.supabase
      .from('research_tasks')
      .update({
        status: 'pending',
        started_at: null,
      })
      .eq('status', 'in_progress')
      .lt('started_at', cutoffTime.toISOString())
      .select('id');

    if (error) {
      logger.error('Failed to reset stuck tasks', { error });
      return 0;
    }

    if (data && data.length > 0) {
      logger.warn('Reset stuck research tasks', {
        count: data.length,
        taskIds: data.map((t: any) => t.id),
      });
    }

    return data?.length || 0;
  }

  /**
   * Map database row to ResearchTask type
   */
  private mapToResearchTask(data: any): ResearchTask {
    return {
      id: data.id,
      user_id: data.user_id,
      emotional_state_id: data.emotional_state_id ?? null,
      query: data.query,
      purpose: data.purpose ?? null,
      approach: data.approach as ResearchApproach,
      priority: data.priority ?? 5,
      status: data.status as ResearchStatus,
      results: data.results ?? null,
      derived_facts: data.derived_facts ?? null,
      created_at: new Date(data.created_at),
      started_at: data.started_at ? new Date(data.started_at) : null,
      completed_at: data.completed_at ? new Date(data.completed_at) : null,
    };
  }
}

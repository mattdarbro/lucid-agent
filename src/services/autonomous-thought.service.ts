import { Pool, PoolClient } from 'pg';
import { SupabaseClient } from '@supabase/supabase-js';
import { AutonomousThought } from '../types/database';
import {
  CreateAutonomousThoughtInput,
  UpdateAutonomousThoughtInput,
  ListAutonomousThoughtsInput,
  SearchThoughtsInput,
  ThoughtCategory,
  CircadianPhase,
} from '../validation/autonomous-thought.validation';
import { logger } from '../logger';
import { VectorService } from './vector.service';

export class AutonomousThoughtService {
  private vectorService: VectorService;

  constructor(
    private pool: Pool,
    private supabase: SupabaseClient,
  ) {
    this.vectorService = new VectorService();
  }

  /**
   * Create a new autonomous thought
   */
  async createThought(input: CreateAutonomousThoughtInput): Promise<AutonomousThought> {
    logger.info('Creating autonomous thought', { userId: input.user_id, type: input.thought_type });

    // Generate embedding for the thought
    let embedding: number[] | null = null;
    try {
      embedding = await this.vectorService.generateEmbedding(input.content);
    } catch (error) {
      logger.warn('Failed to generate embedding for thought, continuing without it', { error });
    }

    const insertData: any = {
      user_id: input.user_id,
      content: input.content,
      thought_type: input.thought_type,
      is_shared: input.is_shared ?? false,
    };

    if (input.agent_job_id) insertData.agent_job_id = input.agent_job_id;
    if (input.circadian_phase) insertData.circadian_phase = input.circadian_phase;
    if (input.generated_at_time) insertData.generated_at_time = input.generated_at_time;
    if (input.importance_score !== undefined) insertData.importance_score = input.importance_score;
    if (embedding) insertData.embedding = JSON.stringify(embedding);

    const { data, error } = await this.supabase
      .from('autonomous_thoughts')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      logger.error('Failed to create autonomous thought', { error, input });
      throw new Error(`Failed to create autonomous thought: ${error.message}`);
    }

    logger.info('Autonomous thought created successfully', { thoughtId: data.id });
    return this.mapToAutonomousThought(data);
  }

  /**
   * Get autonomous thought by ID
   */
  async getThoughtById(thoughtId: string): Promise<AutonomousThought | null> {
    logger.debug('Fetching autonomous thought', { thoughtId });

    const { data, error } = await this.supabase
      .from('autonomous_thoughts')
      .select('*')
      .eq('id', thoughtId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        logger.debug('Autonomous thought not found', { thoughtId });
        return null;
      }
      logger.error('Failed to fetch autonomous thought', { error, thoughtId });
      throw new Error(`Failed to fetch autonomous thought: ${error.message}`);
    }

    return this.mapToAutonomousThought(data);
  }

  /**
   * Update autonomous thought
   */
  async updateThought(thoughtId: string, input: UpdateAutonomousThoughtInput): Promise<AutonomousThought> {
    logger.info('Updating autonomous thought', { thoughtId, input });

    const updateData: any = {};
    if (input.is_shared !== undefined) updateData.is_shared = input.is_shared;
    if (input.shared_at) updateData.shared_at = input.shared_at.toISOString();
    if (input.importance_score !== undefined) updateData.importance_score = input.importance_score;

    const { data, error } = await this.supabase
      .from('autonomous_thoughts')
      .update(updateData)
      .eq('id', thoughtId)
      .select()
      .single();

    if (error) {
      logger.error('Failed to update autonomous thought', { error, thoughtId, input });
      throw new Error(`Failed to update autonomous thought: ${error.message}`);
    }

    logger.info('Autonomous thought updated successfully', { thoughtId });
    return this.mapToAutonomousThought(data);
  }

  /**
   * List autonomous thoughts with filters
   */
  async listThoughts(input: ListAutonomousThoughtsInput): Promise<AutonomousThought[]> {
    logger.debug('Listing autonomous thoughts', { input });

    let query = this.supabase.from('autonomous_thoughts').select('*');

    if (input.user_id) query = query.eq('user_id', input.user_id);
    if (input.thought_type) query = query.eq('thought_type', input.thought_type);
    if (input.circadian_phase) query = query.eq('circadian_phase', input.circadian_phase);
    if (input.is_shared !== undefined) query = query.eq('is_shared', input.is_shared);
    if (input.min_importance) query = query.gte('importance_score', input.min_importance);
    if (input.created_after) query = query.gte('created_at', input.created_after.toISOString());
    if (input.created_before) query = query.lte('created_at', input.created_before.toISOString());

    query = query.order('created_at', { ascending: false });
    query = query.range(input.offset, input.offset + input.limit - 1);

    const { data, error } = await query;

    if (error) {
      logger.error('Failed to list autonomous thoughts', { error, input });
      throw new Error(`Failed to list autonomous thoughts: ${error.message}`);
    }

    return data.map(thought => this.mapToAutonomousThought(thought));
  }

  /**
   * Search thoughts by semantic similarity
   */
  async searchThoughts(input: SearchThoughtsInput): Promise<AutonomousThought[]> {
    logger.info('Searching autonomous thoughts', { userId: input.user_id, query: input.query });

    // Generate embedding for search query
    const queryEmbedding = await this.vectorService.generateEmbedding(input.query);

    const client = await this.pool.connect();
    try {
      let sql = `
        SELECT
          *,
          1 - (embedding <=> $1::vector) as similarity
        FROM autonomous_thoughts
        WHERE user_id = $2
          AND embedding IS NOT NULL
          AND 1 - (embedding <=> $1::vector) >= $3
      `;
      const params: any[] = [JSON.stringify(queryEmbedding), input.user_id, input.min_similarity];

      let paramIndex = 4;
      if (input.thought_type) {
        sql += ` AND thought_type = $${paramIndex}`;
        params.push(input.thought_type);
        paramIndex++;
      }

      if (input.circadian_phase) {
        sql += ` AND circadian_phase = $${paramIndex}`;
        params.push(input.circadian_phase);
        paramIndex++;
      }

      sql += `
        ORDER BY similarity DESC
        LIMIT $${paramIndex}
      `;
      params.push(input.limit);

      const result = await client.query(sql, params);

      logger.info('Thought search completed', { resultsCount: result.rows.length });
      return result.rows.map(row => this.mapToAutonomousThought(row));
    } finally {
      client.release();
    }
  }

  /**
   * Share a thought with the user
   */
  async shareThought(thoughtId: string): Promise<AutonomousThought> {
    return this.updateThought(thoughtId, {
      is_shared: true,
      shared_at: new Date(),
    });
  }

  /**
   * Get thoughts by agent job ID
   */
  async getThoughtsByJobId(jobId: string): Promise<AutonomousThought[]> {
    logger.debug('Fetching thoughts by job ID', { jobId });

    const { data, error } = await this.supabase
      .from('autonomous_thoughts')
      .select('*')
      .eq('agent_job_id', jobId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Failed to fetch thoughts by job ID', { error, jobId });
      throw new Error(`Failed to fetch thoughts by job ID: ${error.message}`);
    }

    return data.map(thought => this.mapToAutonomousThought(thought));
  }

  /**
   * Delete autonomous thought
   */
  async deleteThought(thoughtId: string): Promise<void> {
    logger.info('Deleting autonomous thought', { thoughtId });

    const { error } = await this.supabase
      .from('autonomous_thoughts')
      .delete()
      .eq('id', thoughtId);

    if (error) {
      logger.error('Failed to delete autonomous thought', { error, thoughtId });
      throw new Error(`Failed to delete autonomous thought: ${error.message}`);
    }

    logger.info('Autonomous thought deleted successfully', { thoughtId });
  }

  /**
   * Get recent unshared thoughts for a user
   */
  async getRecentUnsharedThoughts(userId: string, limit: number = 10): Promise<AutonomousThought[]> {
    logger.debug('Fetching recent unshared thoughts', { userId, limit });

    const { data, error } = await this.supabase
      .from('autonomous_thoughts')
      .select('*')
      .eq('user_id', userId)
      .eq('is_shared', false)
      .order('importance_score', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error('Failed to fetch recent unshared thoughts', { error, userId });
      throw new Error(`Failed to fetch recent unshared thoughts: ${error.message}`);
    }

    return data.map(thought => this.mapToAutonomousThought(thought));
  }

  /**
   * Map database row to AutonomousThought type
   */
  private mapToAutonomousThought(data: any): AutonomousThought {
    return {
      id: data.id,
      user_id: data.user_id,
      agent_job_id: data.agent_job_id ?? null,
      content: data.content,
      thought_type: data.thought_type as ThoughtCategory,
      circadian_phase: data.circadian_phase as CircadianPhase | null,
      generated_at_time: data.generated_at_time ?? null,
      importance_score: data.importance_score ?? null,
      is_shared: data.is_shared ?? false,
      shared_at: data.shared_at ? new Date(data.shared_at) : null,
      embedding: data.embedding ?? null,
      created_at: new Date(data.created_at),
    };
  }
}

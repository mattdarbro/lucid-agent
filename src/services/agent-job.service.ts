import { Pool, PoolClient } from 'pg';
import { SupabaseClient } from '@supabase/supabase-js';
import { AgentJob } from '../types/database';
import {
  CreateAgentJobInput,
  UpdateAgentJobInput,
  ListAgentJobsInput,
  JobType,
  JobStatus,
} from '../validation/agent-job.validation';
import { logger } from '../logger';
import { chicagoDateStr, chicagoDayBounds, chicagoDateParts } from '../utils/chicago-time';

export class AgentJobService {
  constructor(
    private pool: Pool,
    private supabase: SupabaseClient,
  ) {}

  /**
   * Create a new agent job
   */
  async createJob(input: CreateAgentJobInput): Promise<AgentJob> {
    logger.info('Creating agent job', { input });

    const { data, error } = await this.supabase
      .from('agent_jobs')
      .insert({
        user_id: input.user_id,
        job_type: input.job_type,
        scheduled_for: input.scheduled_for.toISOString(),
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to create agent job', { error, input });
      throw new Error(`Failed to create agent job: ${error.message}`);
    }

    logger.info('Agent job created successfully', { jobId: data.id });
    return this.mapToAgentJob(data);
  }

  /**
   * Get agent job by ID
   */
  async getJobById(jobId: string): Promise<AgentJob | null> {
    logger.debug('Fetching agent job', { jobId });

    const { data, error } = await this.supabase
      .from('agent_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        logger.debug('Agent job not found', { jobId });
        return null;
      }
      logger.error('Failed to fetch agent job', { error, jobId });
      throw new Error(`Failed to fetch agent job: ${error.message}`);
    }

    return this.mapToAgentJob(data);
  }

  /**
   * Update agent job
   */
  async updateJob(jobId: string, input: UpdateAgentJobInput): Promise<AgentJob> {
    logger.info('Updating agent job', { jobId, input });

    const updateData: any = {};
    if (input.status) updateData.status = input.status;
    if (input.thoughts_generated !== undefined) updateData.thoughts_generated = input.thoughts_generated;
    if (input.research_tasks_created !== undefined) updateData.research_tasks_created = input.research_tasks_created;
    if (input.error_message !== undefined) updateData.error_message = input.error_message;
    if (input.started_at) updateData.started_at = input.started_at.toISOString();
    if (input.completed_at) updateData.completed_at = input.completed_at.toISOString();

    const { data, error } = await this.supabase
      .from('agent_jobs')
      .update(updateData)
      .eq('id', jobId)
      .select()
      .single();

    if (error) {
      logger.error('Failed to update agent job', { error, jobId, input });
      throw new Error(`Failed to update agent job: ${error.message}`);
    }

    logger.info('Agent job updated successfully', { jobId });
    return this.mapToAgentJob(data);
  }

  /**
   * List agent jobs with filters
   */
  async listJobs(input: ListAgentJobsInput): Promise<AgentJob[]> {
    logger.debug('Listing agent jobs', { input });

    let query = this.supabase.from('agent_jobs').select('*');

    if (input.user_id) query = query.eq('user_id', input.user_id);
    if (input.job_type) query = query.eq('job_type', input.job_type);
    if (input.status) query = query.eq('status', input.status);
    if (input.scheduled_after) query = query.gte('scheduled_for', input.scheduled_after.toISOString());
    if (input.scheduled_before) query = query.lte('scheduled_for', input.scheduled_before.toISOString());

    query = query.order('scheduled_for', { ascending: false });
    query = query.range(input.offset, input.offset + input.limit - 1);

    const { data, error } = await query;

    if (error) {
      logger.error('Failed to list agent jobs', { error, input });
      throw new Error(`Failed to list agent jobs: ${error.message}`);
    }

    return data.map((job: any) => this.mapToAgentJob(job));
  }

  /**
   * Get pending jobs that are due to run
   */
  async getDueJobs(): Promise<AgentJob[]> {
    logger.debug('Fetching due agent jobs');

    // Only look back 48 hours to prevent unbounded accumulation of stale jobs.
    // Jobs older than 48h are no longer relevant (e.g., yesterday's morning briefing).
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data, error } = await this.supabase
      .from('agent_jobs')
      .select('*')
      .eq('status', 'pending')
      .gte('scheduled_for', cutoff)
      .lte('scheduled_for', new Date().toISOString())
      .order('scheduled_for', { ascending: true })
      .limit(10);

    if (error) {
      logger.error('Failed to fetch due agent jobs', { error });
      throw new Error(`Failed to fetch due agent jobs: ${error.message}`);
    }

    // Only log at INFO level when there are jobs to process
    if (data.length > 0) {
      logger.info('Found due agent jobs', { count: data.length });
    }
    return data.map((job: any) => this.mapToAgentJob(job));
  }

  /**
   * Mark job as started
   */
  async markJobAsStarted(jobId: string): Promise<AgentJob> {
    return this.updateJob(jobId, {
      status: 'running',
      started_at: new Date(),
    });
  }

  /**
   * Mark job as completed
   */
  async markJobAsCompleted(
    jobId: string,
    thoughtsGenerated: number,
    researchTasksCreated: number,
  ): Promise<AgentJob> {
    return this.updateJob(jobId, {
      status: 'completed',
      thoughts_generated: thoughtsGenerated,
      research_tasks_created: researchTasksCreated,
      completed_at: new Date(),
    });
  }

  /**
   * Mark job as failed
   */
  async markJobAsFailed(jobId: string, errorMessage: string): Promise<AgentJob> {
    return this.updateJob(jobId, {
      status: 'failed',
      error_message: errorMessage,
      completed_at: new Date(),
    });
  }

  /**
   * Mark job as skipped (e.g., user disabled agents after scheduling)
   */
  async markJobAsSkipped(jobId: string, reason: string): Promise<AgentJob> {
    return this.updateJob(jobId, {
      status: 'skipped',
      error_message: reason,
      completed_at: new Date(),
    });
  }

  /**
   * Delete agent job
   */
  async deleteJob(jobId: string): Promise<void> {
    logger.info('Deleting agent job', { jobId });

    const { error } = await this.supabase
      .from('agent_jobs')
      .delete()
      .eq('id', jobId);

    if (error) {
      logger.error('Failed to delete agent job', { error, jobId });
      throw new Error(`Failed to delete agent job: ${error.message}`);
    }

    logger.info('Agent job deleted successfully', { jobId });
  }

  /**
   * Schedule circadian jobs for a user
   * Only creates jobs that don't already exist for the given date
   */
  async scheduleCircadianJobs(userId: string, date: Date): Promise<AgentJob[]> {
    logger.info('Scheduling circadian jobs for user', { userId, date });

    // Get start and end of the scheduling day in CHICAGO timezone.
    // Jobs are scheduled in Chicago time, so dedup boundaries must match.
    const dateStr = chicagoDateStr(date);
    const { start: dayStart, end: dayEnd } = chicagoDayBounds(dateStr);

    // Check for existing jobs for this user on this day (in Chicago timezone)
    const { data: existingJobs, error: checkError } = await this.supabase
      .from('agent_jobs')
      .select('job_type')
      .eq('user_id', userId)
      .gte('scheduled_for', dayStart.toISOString())
      .lte('scheduled_for', dayEnd.toISOString());

    if (checkError) {
      logger.error('Failed to check existing jobs', { error: checkError, userId });
      throw new Error(`Failed to check existing jobs: ${checkError.message}`);
    }

    const existingJobTypes = new Set(existingJobs?.map((j: any) => j.job_type) || []);

    const allJobs: CreateAgentJobInput[] = [
      {
        user_id: userId,
        job_type: 'morning_reflection',
        scheduled_for: this.getScheduledTime(date, 7, 0), // 7am - Fresh Eyes
      },
      {
        user_id: userId,
        job_type: 'midday_curiosity',
        scheduled_for: this.getScheduledTime(date, 12, 0), // 12pm - Active Explorer
      },
      {
        user_id: userId,
        job_type: 'afternoon_synthesis',
        scheduled_for: this.getScheduledTime(date, 15, 0), // 3pm - Deep Work Companion
      },
      {
        user_id: userId,
        job_type: 'evening_consolidation',
        scheduled_for: this.getScheduledTime(date, 20, 0), // 8pm - Winding Down
      },
      {
        user_id: userId,
        job_type: 'night_dream',
        scheduled_for: this.getScheduledTime(date, 2, 0), // 2am - Dreaming Mind
      },
      // document_reflection removed — notebook updates happen organically
      // every time Lucid thinks (conversations + autonomous loops)
    ];

    // Self-review: Thursday only (day 4) at 10pm Chicago time
    const { dayOfWeek } = chicagoDateParts(date);
    if (dayOfWeek === 4) {
      allJobs.push({
        user_id: userId,
        job_type: 'self_review',
        scheduled_for: this.getScheduledTime(date, 22, 0), // 10pm - Self Review
      });
    }

    // Filter out jobs that already exist
    const jobsToCreate = allJobs.filter(job => !existingJobTypes.has(job.job_type));

    if (jobsToCreate.length === 0) {
      logger.info('All circadian jobs already exist for user', { userId, date });
      return [];
    }

    if (jobsToCreate.length < allJobs.length) {
      logger.info('Some circadian jobs already exist, creating remaining', {
        userId,
        existing: Array.from(existingJobTypes),
        creating: jobsToCreate.map(j => j.job_type),
      });
    }

    const createdJobs = await Promise.all(
      jobsToCreate.map(job => this.createJob(job))
    );

    logger.info('Circadian jobs scheduled successfully', { userId, count: createdJobs.length });
    return createdJobs;
  }

  /**
   * Helper to get scheduled time for a specific hour and minute in Chicago time.
   * Uses chicagoDayBounds to get midnight Chicago in UTC, then adds the target offset.
   */
  private getScheduledTime(date: Date, hour: number, minute: number): Date {
    const dateStr = chicagoDateStr(date);
    const { start: midnightChicago } = chicagoDayBounds(dateStr);

    // midnightChicago is midnight Chicago expressed in UTC; add hours/minutes
    const scheduled = new Date(midnightChicago.getTime() + hour * 3600000 + minute * 60000);

    logger.debug('Scheduled job time', {
      hour,
      minute,
      dateStr,
      scheduledUTC: scheduled.toISOString(),
    });

    return scheduled;
  }

  /**
   * Map database row to AgentJob type
   */
  private mapToAgentJob(data: any): AgentJob {
    return {
      id: data.id,
      user_id: data.user_id,
      job_type: data.job_type as JobType,
      status: data.status as JobStatus,
      scheduled_for: new Date(data.scheduled_for),
      thoughts_generated: data.thoughts_generated ?? 0,
      research_tasks_created: data.research_tasks_created ?? 0,
      error_message: data.error_message ?? null,
      session_metadata: data.session_metadata ?? {},
      library_entry_id: data.library_entry_id ?? null,
      created_at: new Date(data.created_at),
      started_at: data.started_at ? new Date(data.started_at) : null,
      completed_at: data.completed_at ? new Date(data.completed_at) : null,
    };
  }
}

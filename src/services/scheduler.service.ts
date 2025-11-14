import cron from 'node-cron';
import { Pool } from 'pg';
import { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../logger';
import { AgentJobService } from './agent-job.service';
import { UserService } from './user.service';
import { ResearchExecutorService } from './research-executor.service';
import { ProfileService } from './profile.service';
import { config } from '../config';

export class SchedulerService {
  private agentJobService: AgentJobService;
  private userService: UserService;
  private researchExecutor: ResearchExecutorService;
  private profileService: ProfileService;
  private scheduledTasks: cron.ScheduledTask[] = [];
  private jobCheckInterval: NodeJS.Timeout | null = null;

  constructor(
    private pool: Pool,
    private supabase: SupabaseClient,
  ) {
    this.agentJobService = new AgentJobService(pool, supabase);
    this.userService = new UserService(pool);
    this.researchExecutor = new ResearchExecutorService(pool, supabase);
    this.profileService = new ProfileService(pool);
  }

  /**
   * Start the scheduler
   * Sets up daily job scheduling for all users
   */
  async start(): Promise<void> {
    logger.info('Starting scheduler service');

    // Schedule daily job creation at midnight for all users
    const midnightTask = cron.schedule('0 0 * * *', async () => {
      logger.info('Running daily job scheduling task');
      await this.scheduleJobsForAllUsers();
    }, {
      timezone: 'UTC',
    });

    this.scheduledTasks.push(midnightTask);

    // Run job scheduling immediately on startup for today
    await this.scheduleJobsForAllUsers();

    // Start polling for due jobs every minute
    this.startJobPolling();

    // Schedule research task execution every 5 minutes
    if (config.features.webResearch) {
      const researchTask = cron.schedule('*/5 * * * *', async () => {
        logger.debug('Running research task executor');
        try {
          const result = await this.researchExecutor.processPendingTasks(3);
          if (result.processed > 0) {
            logger.info('Research execution completed', result);
          }
        } catch (error) {
          logger.error('Research execution failed', { error });
        }
      }, {
        timezone: 'UTC',
      });

      this.scheduledTasks.push(researchTask);
      logger.info('🔍 Research executor: ENABLED (runs every 5 minutes)');
    }

    logger.info('Scheduler service started successfully', {
      scheduleConfig: config.schedule,
    });
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    logger.info('Stopping scheduler service');

    // Stop all cron tasks
    this.scheduledTasks.forEach(task => task.stop());
    this.scheduledTasks = [];

    // Stop job polling
    if (this.jobCheckInterval) {
      clearInterval(this.jobCheckInterval);
      this.jobCheckInterval = null;
    }

    logger.info('Scheduler service stopped');
  }

  /**
   * Schedule circadian jobs for all active users
   */
  private async scheduleJobsForAllUsers(): Promise<void> {
    try {
      logger.info('Scheduling circadian jobs for all users');

      // Get all active users
      const { data: users, error } = await this.supabase
        .from('users')
        .select('id')
        .order('created_at', { ascending: true });

      if (error) {
        logger.error('Failed to fetch users for job scheduling', { error });
        return;
      }

      if (!users || users.length === 0) {
        logger.info('No users found for job scheduling');
        return;
      }

      const today = new Date();
      let scheduledCount = 0;
      let skippedCount = 0;

      // Schedule jobs for each user
      for (const user of users) {
        try {
          // Check if autonomous agents are enabled for this user
          const agentsEnabled = await this.profileService.areAgentsEnabled(user.id);

          if (!agentsEnabled) {
            logger.debug('Skipping job scheduling for user (agents disabled in profile)', { userId: user.id });
            skippedCount++;
            continue;
          }

          await this.agentJobService.scheduleCircadianJobs(user.id, today);
          logger.debug('Scheduled circadian jobs for user', { userId: user.id });
          scheduledCount++;
        } catch (error) {
          logger.error('Failed to schedule jobs for user', { userId: user.id, error });
        }
      }

      logger.info('Completed scheduling circadian jobs for all users', {
        totalUsers: users.length,
        scheduled: scheduledCount,
        skipped: skippedCount,
      });
    } catch (error) {
      logger.error('Error in scheduleJobsForAllUsers', { error });
    }
  }

  /**
   * Start polling for due jobs
   */
  private startJobPolling(): void {
    // Check for due jobs every minute
    this.jobCheckInterval = setInterval(async () => {
      await this.processDueJobs();
    }, 60 * 1000); // 60 seconds

    // Also run immediately
    this.processDueJobs();
  }

  /**
   * Process all jobs that are due
   */
  private async processDueJobs(): Promise<void> {
    try {
      logger.debug('Checking for due jobs');

      const dueJobs = await this.agentJobService.getDueJobs();

      if (dueJobs.length === 0) {
        logger.debug('No due jobs found');
        return;
      }

      logger.info('Found due jobs to process', { count: dueJobs.length });

      // Process each job
      for (const job of dueJobs) {
        // Process job asynchronously (don't await to allow parallel processing)
        this.processJob(job.id).catch(error => {
          logger.error('Error processing job', { jobId: job.id, error });
        });
      }
    } catch (error) {
      logger.error('Error in processDueJobs', { error });
    }
  }

  /**
   * Process a single job
   */
  private async processJob(jobId: string): Promise<void> {
    try {
      logger.info('Processing job', { jobId });

      // Mark job as started
      await this.agentJobService.markJobAsStarted(jobId);

      // Get job details
      const job = await this.agentJobService.getJobById(jobId);
      if (!job) {
        logger.error('Job not found', { jobId });
        return;
      }

      // Dynamic import of circadian agents (will be implemented next)
      const { CircadianAgents } = await import('./circadian-agents.service');
      const agents = new CircadianAgents(this.pool, this.supabase);

      let thoughtsGenerated = 0;
      let researchTasksCreated = 0;

      // Execute the appropriate agent based on job type
      switch (job.job_type) {
        case 'morning_reflection':
          const morningResult = await agents.runMorningReflection(job.user_id, job.id);
          thoughtsGenerated = morningResult.thoughtsGenerated;
          researchTasksCreated = morningResult.researchTasksCreated;
          break;

        case 'midday_curiosity':
          const middayResult = await agents.runMiddayCuriosity(job.user_id, job.id);
          thoughtsGenerated = middayResult.thoughtsGenerated;
          researchTasksCreated = middayResult.researchTasksCreated;
          break;

        case 'evening_consolidation':
          const eveningResult = await agents.runEveningConsolidation(job.user_id, job.id);
          thoughtsGenerated = eveningResult.thoughtsGenerated;
          researchTasksCreated = eveningResult.researchTasksCreated;
          break;

        case 'night_dream':
          const nightResult = await agents.runNightDream(job.user_id, job.id);
          thoughtsGenerated = nightResult.thoughtsGenerated;
          researchTasksCreated = nightResult.researchTasksCreated;
          break;

        default:
          throw new Error(`Unknown job type: ${job.job_type}`);
      }

      // Mark job as completed
      await this.agentJobService.markJobAsCompleted(jobId, thoughtsGenerated, researchTasksCreated);

      logger.info('Job completed successfully', {
        jobId,
        jobType: job.job_type,
        thoughtsGenerated,
        researchTasksCreated,
      });
    } catch (error) {
      logger.error('Failed to process job', { jobId, error });

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.agentJobService.markJobAsFailed(jobId, errorMessage);
    }
  }

  /**
   * Manually trigger a job (for testing or manual execution)
   */
  async triggerJob(jobId: string): Promise<void> {
    logger.info('Manually triggering job', { jobId });
    await this.processJob(jobId);
  }

  /**
   * Schedule jobs for a specific user (useful when new user signs up)
   */
  async scheduleJobsForUser(userId: string): Promise<void> {
    logger.info('Scheduling jobs for specific user', { userId });

    // Check if autonomous agents are enabled for this user
    const agentsEnabled = await this.profileService.areAgentsEnabled(userId);

    if (!agentsEnabled) {
      logger.info('Not scheduling jobs for user (agents disabled in profile)', { userId });
      return;
    }

    const today = new Date();
    await this.agentJobService.scheduleCircadianJobs(userId, today);
  }
}

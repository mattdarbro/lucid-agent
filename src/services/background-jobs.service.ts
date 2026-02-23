import cron from 'node-cron';
import { Pool } from 'pg';
import { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../logger';
import { FactService } from './fact.service';
import { MessageService } from './message.service';
import { VectorService } from './vector.service';
import { ProfileService } from './profile.service';
import { AgentJobService } from './agent-job.service';
import { AutonomousLoopService } from './autonomous-loop.service';
import { ResearchExecutorService } from './research-executor.service';
import { SelfReviewLoopService } from './self-review-loop.service';
import { ThoughtNotificationService } from './thought-notification.service';
import { PushNotificationService } from './push-notification.service';
import { ConversationReviewService } from './conversation-review.service';
import { JobType } from '../validation/agent-job.validation';
import { chicagoDateParts } from '../utils/chicago-time';

/**
 * BackgroundJobsService
 *
 * Handles scheduled background tasks for the Lucid agent:
 * - Automatic fact extraction from conversations
 * - Autonomous loop execution (circadian thinking)
 *
 * Autonomous Loops (AL):
 * - evening_consolidation: Reflect on the day's conversations
 * - (more to come: morning, midday, night)
 */
export class BackgroundJobsService {
  private pool: Pool;
  private supabase: SupabaseClient;
  private factService: FactService;
  private messageService: MessageService;
  private profileService: ProfileService;
  private agentJobService: AgentJobService;
  private autonomousLoopService: AutonomousLoopService;
  private researchExecutorService: ResearchExecutorService;
  private selfReviewLoopService: SelfReviewLoopService;
  private thoughtNotificationService: ThoughtNotificationService;
  private pushNotificationService: PushNotificationService;
  private conversationReviewService: ConversationReviewService;
  private factExtractionJob: cron.ScheduledTask | null = null;
  private autonomousLoopJob: cron.ScheduledTask | null = null;
  private dailyJobScheduler: cron.ScheduledTask | null = null;
  private researchExecutorJob: cron.ScheduledTask | null = null;
  private notificationDispatchJob: cron.ScheduledTask | null = null;
  private conversationReviewJob: cron.ScheduledTask | null = null;
  private isRunning: boolean = false;
  private isRunningAutonomousLoops: boolean = false;

  constructor(pool: Pool, supabase: SupabaseClient) {
    this.pool = pool;
    this.supabase = supabase;
    const vectorService = new VectorService();
    this.factService = new FactService(pool, vectorService);
    this.messageService = new MessageService(pool, vectorService);
    this.profileService = new ProfileService(pool);
    this.agentJobService = new AgentJobService(pool, supabase);
    this.autonomousLoopService = new AutonomousLoopService(pool);
    this.researchExecutorService = new ResearchExecutorService(pool, supabase);
    this.selfReviewLoopService = new SelfReviewLoopService(pool);
    this.thoughtNotificationService = new ThoughtNotificationService(pool);
    this.pushNotificationService = new PushNotificationService(pool);
    this.conversationReviewService = new ConversationReviewService(pool);
  }

  /**
   * Start all background jobs
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('[BACKGROUND] Jobs already running');
      return;
    }

    this.startFactExtractionJob();
    this.startAutonomousLoopJob();
    this.startDailyJobScheduler();
    this.startResearchExecutorJob();
    this.startNotificationDispatchJob();
    this.startConversationReviewJob();
    this.isRunning = true;
    logger.info('[BACKGROUND] Background jobs started');
  }

  /**
   * Stop all background jobs
   */
  stop(): void {
    if (this.factExtractionJob) {
      this.factExtractionJob.stop();
      this.factExtractionJob = null;
    }
    if (this.autonomousLoopJob) {
      this.autonomousLoopJob.stop();
      this.autonomousLoopJob = null;
    }
    if (this.dailyJobScheduler) {
      this.dailyJobScheduler.stop();
      this.dailyJobScheduler = null;
    }
    if (this.researchExecutorJob) {
      this.researchExecutorJob.stop();
      this.researchExecutorJob = null;
    }
    if (this.notificationDispatchJob) {
      this.notificationDispatchJob.stop();
      this.notificationDispatchJob = null;
    }
    if (this.conversationReviewJob) {
      this.conversationReviewJob.stop();
      this.conversationReviewJob = null;
    }
    this.isRunning = false;
    logger.info('[BACKGROUND] Background jobs stopped');
  }

  /**
   * Start the research executor job
   * Processes pending research tasks every 2 minutes
   * This handles user-submitted research queries from the iOS app
   */
  private startResearchExecutorJob(): void {
    // Check every 2 minutes for pending research tasks
    this.researchExecutorJob = cron.schedule('*/2 * * * *', async () => {
      try {
        await this.runResearchExecutor();
      } catch (err: any) {
        logger.error('[BACKGROUND] Unhandled error in research executor cron', { error: err.message });
      }
    });

    logger.info('[BACKGROUND] Research executor job scheduled (every 2 minutes)');

    // Also run on startup after a delay to process any stuck tasks
    setTimeout(() => {
      this.runResearchExecutor().catch((err) => {
        logger.error('[BACKGROUND] Initial research executor run failed:', err);
      });
    }, 30000); // 30 second delay to let server stabilize
  }

  /**
   * Process pending research tasks
   */
  private async runResearchExecutor(): Promise<void> {
    try {
      // Check if already processing
      if (this.researchExecutorService.isCurrentlyProcessing()) {
        logger.debug('[RESEARCH] Research executor already processing, skipping');
        return;
      }

      // Check availability
      const status = this.researchExecutorService.getAvailabilityStatus();
      if (!status.available) {
        logger.debug('[RESEARCH] Research executor not available', { reason: status.reason });
        return;
      }

      // Process up to 3 pending tasks
      const result = await this.researchExecutorService.processPendingTasks(3);

      if (result.processed > 0) {
        logger.info('[RESEARCH] Processed research tasks', {
          processed: result.processed,
          successful: result.successful,
          failed: result.failed,
        });
      }
    } catch (error: any) {
      logger.error('[RESEARCH] Research executor job failed', { error: error.message });
    }
  }

  /**
   * Start the notification dispatch job
   * Runs every 3 minutes to send pending thought notifications via Dispatch
   */
  private startNotificationDispatchJob(): void {
    this.notificationDispatchJob = cron.schedule('*/3 * * * *', async () => {
      try {
        await this.dispatchPendingNotifications();
      } catch (err: any) {
        logger.error('[BACKGROUND] Unhandled error in notification dispatch cron', { error: err.message });
      }
    });

    logger.info('[BACKGROUND] Notification dispatch job scheduled (every 3 minutes)');
  }

  /**
   * Dispatch pending thought notifications to users via Dispatch API
   *
   * For each user with pending notifications:
   * 1. Check user's check-in preferences (rate limits, quiet hours)
   * 2. Filter by preferred time of day
   * 3. Send via PushNotificationService
   * 4. Mark as sent
   * 5. Expire old notifications
   */
  private async dispatchPendingNotifications(): Promise<void> {
    try {
      if (!this.pushNotificationService.isEnabled()) {
        logger.warn('[DISPATCH] Push notifications not configured — check DISPATCH_API_URL, DISPATCH_APP_KEY, DISPATCH_SENDER_ID env vars');
        return;
      }

      // First, expire old notifications
      await this.thoughtNotificationService.expireOldNotifications();

      // Find all users with pending notifications
      const result = await this.pool.query(`
        SELECT DISTINCT user_id
        FROM thought_notifications
        WHERE status = 'pending'
          AND (expires_at IS NULL OR expires_at > NOW())
      `);

      if (result.rows.length === 0) {
        logger.debug('[DISPATCH] No pending notifications to dispatch');
        return;
      }

      for (const row of result.rows) {
        try {
          await this.dispatchForUser(row.user_id);
        } catch (error: any) {
          logger.error('[DISPATCH] Failed to dispatch for user', {
            userId: row.user_id,
            error: error.message,
          });
        }
      }
    } catch (error: any) {
      logger.error('[DISPATCH] Notification dispatch failed', { error: error.message });
    }
  }

  /**
   * Dispatch pending notifications for a single user
   */
  private async dispatchForUser(userId: string): Promise<void> {
    // Check rate limits: don't send more than 5 notifications per hour
    const recentSent = await this.pool.query(
      `SELECT COUNT(*) as count FROM thought_notifications
       WHERE user_id = $1 AND status = 'sent' AND sent_at > NOW() - INTERVAL '1 hour'`,
      [userId]
    );

    const recentCount = parseInt(recentSent.rows[0].count);
    if (recentCount >= 5) {
      logger.debug('[DISPATCH] Rate limit reached for user', { userId, recentCount });
      return;
    }

    // Get pending notifications (highest priority first, max 3 per cycle)
    const maxToSend = Math.min(3, 5 - recentCount);
    const pending = await this.thoughtNotificationService.getPendingNotifications(userId, maxToSend);

    if (pending.length === 0) {
      return;
    }

    for (const notification of pending) {
      try {
        const sent = await this.pushNotificationService.sendThoughtNotification(
          userId,
          notification.id,
          notification.question,
          notification.context,
          notification.priority
        );

        if (sent) {
          await this.thoughtNotificationService.markAsSent(notification.id);
          logger.info('[DISPATCH] Thought notification sent', {
            notificationId: notification.id,
            userId,
            priority: notification.priority,
          });
        } else {
          logger.warn('[DISPATCH] Thought notification failed to send (no error thrown)', {
            notificationId: notification.id,
            userId,
            priority: notification.priority,
            dispatchEnabled: this.pushNotificationService.isEnabled(),
          });
        }
      } catch (error: any) {
        logger.error('[DISPATCH] Failed to send notification', {
          notificationId: notification.id,
          error: error.message,
        });
      }
    }
  }

  /**
   * Start the autonomous loop job checker
   * Runs every 5 minutes to check for due agent jobs
   */
  private startAutonomousLoopJob(): void {
    // Check every 5 minutes for due jobs
    this.autonomousLoopJob = cron.schedule('*/5 * * * *', async () => {
      try {
        await this.runDueAutonomousLoops();
      } catch (err: any) {
        logger.error('[BACKGROUND] Unhandled error in autonomous loop cron', { error: err.message });
      }
    });

    logger.info('[BACKGROUND] Autonomous loop job scheduled (every 5 minutes)');

    // Also run check on startup after a delay
    setTimeout(() => {
      this.runDueAutonomousLoops().catch((err) => {
        logger.error('[BACKGROUND] Initial autonomous loop check failed:', err);
      });
    }, 15000); // 15 second delay to let server stabilize
  }

  /**
   * Check for and run any due autonomous loop jobs
   */
  private async runDueAutonomousLoops(): Promise<void> {
    // Prevent concurrent runs (startup + cron can overlap)
    if (this.isRunningAutonomousLoops) {
      logger.debug('[AL] Autonomous loop runner already in progress, skipping');
      return;
    }
    this.isRunningAutonomousLoops = true;

    try {
      const dueJobs = await this.agentJobService.getDueJobs();

      if (dueJobs.length === 0) {
        logger.debug('[AL] No due autonomous loop jobs');
        return;
      }

      logger.info(`[AL] Found ${dueJobs.length} due autonomous loop jobs`);

      for (const job of dueJobs) {
        try {
          // Check if user has autonomous agents enabled
          const profile = await this.profileService.getUserProfile(job.user_id);
          if (!profile.features.autonomousAgents) {
            logger.warn(`[AL] Skipping job ${job.id} — autonomousAgents disabled in user profile`, {
              jobType: job.job_type,
              userId: job.user_id,
            });
            await this.agentJobService.markJobAsSkipped(job.id, 'Autonomous agents disabled');
            continue;
          }

          // Mark job as started
          await this.agentJobService.markJobAsStarted(job.id);

          // Run the appropriate loop based on job type
          const result = await this.runLoop(job.job_type, job.user_id, job.id);

          // Mark job as completed
          await this.agentJobService.markJobAsCompleted(
            job.id,
            result.thoughtProduced ? 1 : 0,
            0 // research tasks (not implemented yet)
          );

          logger.info(`[AL] Completed job ${job.id}`, {
            job_type: job.job_type,
            thought_produced: result.thoughtProduced,
            library_entry_id: result.libraryEntryId,
          });
        } catch (jobError: any) {
          logger.error(`[AL] Job ${job.id} failed`, { error: jobError.message });
          await this.agentJobService.markJobAsFailed(job.id, jobError.message);
        }

        // Delay between jobs to avoid overwhelming the API
        await this.sleep(3000);
      }
    } catch (error: any) {
      logger.error('[AL] Autonomous loop runner failed', { error: error.message });
    } finally {
      this.isRunningAutonomousLoops = false;
    }
  }

  /**
   * Run the appropriate loop for a job type
   */
  private async runLoop(
    jobType: JobType,
    userId: string,
    jobId: string
  ): Promise<{ thoughtProduced: boolean; libraryEntryId: string | null }> {
    switch (jobType) {
      case 'evening_consolidation':
        const eveningResult = await this.autonomousLoopService.runEveningSynthesis(userId, jobId);
        return {
          thoughtProduced: eveningResult.thoughtProduced,
          libraryEntryId: eveningResult.libraryEntryId,
        };

      case 'morning_reflection':
        const morningResult = await this.autonomousLoopService.runMorningBriefing(userId, jobId);
        return {
          thoughtProduced: morningResult.thoughtProduced,
          libraryEntryId: morningResult.libraryEntryId,
        };

      case 'afternoon_synthesis':
        // Weekly Digest - only runs on Sundays (in Chicago timezone)
        const { dayOfWeek: todayDow } = chicagoDateParts(new Date());
        const isSunday = todayDow === 0;

        if (!isSunday) {
          logger.debug('[AL] Skipping weekly digest - not Sunday', {
            dayOfWeek: todayDow,
            userId
          });
          return { thoughtProduced: false, libraryEntryId: null };
        }

        const weeklyResult = await this.autonomousLoopService.runWeeklyDigest(userId, jobId);
        return {
          thoughtProduced: weeklyResult.thoughtProduced,
          libraryEntryId: weeklyResult.libraryEntryId,
        };

      case 'midday_curiosity':
        // Web Research loop
        const researchResult = await this.autonomousLoopService.runMiddayCuriosity(userId, jobId);
        return {
          thoughtProduced: researchResult.thoughtProduced,
          libraryEntryId: researchResult.libraryEntryId,
        };

      case 'self_review':
        // First Thursday of the month = full review (20 files), other Thursdays = quick (10 files)
        const { day: chicagoDay } = chicagoDateParts(new Date());
        const isFirstThursday = chicagoDay <= 7;
        const reviewDepth = isFirstThursday ? 'full' as const : 'quick' as const;
        logger.info(`[SELF-REVIEW] Running ${reviewDepth} review (${isFirstThursday ? 'first Thursday' : 'weekly'})`);
        const selfReviewResult = await this.selfReviewLoopService.runSelfReview(userId, jobId, reviewDepth);
        return {
          thoughtProduced: selfReviewResult.thoughtProduced,
          libraryEntryId: selfReviewResult.libraryEntryId,
        };

      case 'investment_research':
        const investmentResult = await this.autonomousLoopService.runInvestmentResearch(userId, jobId);
        return {
          thoughtProduced: investmentResult.thoughtProduced,
          libraryEntryId: investmentResult.libraryEntryId,
        };

      case 'ability_spending':
        const spendingResult = await this.autonomousLoopService.runAbilitySpending(userId, jobId);
        return {
          thoughtProduced: spendingResult.thoughtProduced,
          libraryEntryId: spendingResult.libraryEntryId,
        };

      case 'health_check_morning':
        const healthMorningResult = await this.autonomousLoopService.runMorningHealthCheck(userId, jobId);
        return {
          thoughtProduced: healthMorningResult.thoughtProduced,
          libraryEntryId: healthMorningResult.libraryEntryId,
        };

      case 'health_check_evening':
        const healthEveningResult = await this.autonomousLoopService.runEveningHealthCheck(userId, jobId);
        return {
          thoughtProduced: healthEveningResult.thoughtProduced,
          libraryEntryId: healthEveningResult.libraryEntryId,
        };

      // Placeholder for future loops
      case 'night_dream':
        logger.info(`[AL] Loop type ${jobType} not yet implemented`);
        return { thoughtProduced: false, libraryEntryId: null };

      // document_reflection is no longer scheduled — notebook updates happen
      // organically in every conversation and autonomous loop
      case 'document_reflection':
        logger.info(`[AL] document_reflection is deprecated — notebook updates happen organically`);
        return { thoughtProduced: false, libraryEntryId: null };

      default:
        logger.warn(`[AL] Unknown job type: ${jobType}`);
        return { thoughtProduced: false, libraryEntryId: null };
    }
  }

  /**
   * Start the daily job scheduler
   * Runs at midnight Chicago time to schedule circadian jobs for all active users
   * Also runs on startup to ensure today's jobs are scheduled
   */
  private startDailyJobScheduler(): void {
    // Run daily at midnight Chicago time to schedule jobs for the new day
    this.dailyJobScheduler = cron.schedule('0 0 * * *', async () => {
      try {
        await this.scheduleJobsForActiveUsers();
      } catch (err: any) {
        logger.error('[BACKGROUND] Unhandled error in daily job scheduler cron', { error: err.message });
      }
    }, {
      timezone: 'America/Chicago'
    });

    logger.info('[BACKGROUND] Daily job scheduler started (runs at midnight Chicago time)');

    // Also run on startup after a delay to schedule today's jobs
    setTimeout(() => {
      this.scheduleJobsForActiveUsers().catch((err) => {
        logger.error('[BACKGROUND] Initial job scheduling failed:', err);
      });
    }, 20000); // 20 second delay to let server stabilize
  }

  /**
   * Schedule circadian jobs for all users with autonomous agents enabled
   */
  private async scheduleJobsForActiveUsers(): Promise<void> {
    try {
      logger.info('[SCHEDULER] Scheduling circadian jobs for active users');

      // Find all users who were active in last 7 days
      const result = await this.pool.query(`
        SELECT DISTINCT u.id as user_id
        FROM users u
        WHERE u.last_active_at > NOW() - INTERVAL '7 days'
      `);

      if (result.rows.length === 0) {
        logger.info('[SCHEDULER] No active users found');
        return;
      }

      logger.info(`[SCHEDULER] Found ${result.rows.length} active users, checking agent settings...`);

      const today = new Date();
      let totalJobsCreated = 0;
      let usersWithAgentsEnabled = 0;

      for (const row of result.rows) {
        try {
          // Check if user has autonomous agents enabled via profile service
          const agentsEnabled = await this.profileService.areAgentsEnabled(row.user_id);

          if (!agentsEnabled) {
            logger.warn(`[SCHEDULER] Skipping user ${row.user_id} — agents not enabled (check profile.features.autonomousAgents AND profile.agents.enabled)`);
            continue;
          }

          usersWithAgentsEnabled++;
          const jobs = await this.agentJobService.scheduleCircadianJobs(row.user_id, today);
          totalJobsCreated += jobs.length;
          if (jobs.length > 0) {
            logger.info(`[SCHEDULER] Created ${jobs.length} jobs for user ${row.user_id}`);
          }
        } catch (error: any) {
          logger.error(`[SCHEDULER] Failed to schedule jobs for user ${row.user_id}:`, {
            error: error.message,
          });
        }

        // Small delay between users
        await this.sleep(500);
      }

      logger.info(`[SCHEDULER] Completed: ${totalJobsCreated} jobs created for ${usersWithAgentsEnabled} users with agents enabled`);
    } catch (error: any) {
      logger.error('[SCHEDULER] Failed to schedule jobs for active users:', {
        error: error.message,
      });
    }
  }

  /**
   * Manually trigger an autonomous loop for a user (useful for testing)
   */
  async triggerEveningSynthesis(userId: string): Promise<{
    success: boolean;
    libraryEntryId: string | null;
    title: string | null;
  }> {
    logger.info('[AL] Manual trigger: evening synthesis', { userId });
    const result = await this.autonomousLoopService.runEveningSynthesis(userId);
    return {
      success: result.success,
      libraryEntryId: result.libraryEntryId,
      title: result.title,
    };
  }

  /**
   * Manually trigger morning briefing for a user (useful for testing)
   */
  async triggerMorningBriefing(userId: string): Promise<{
    success: boolean;
    libraryEntryId: string | null;
    title: string | null;
  }> {
    logger.info('[AL] Manual trigger: morning briefing', { userId });
    const result = await this.autonomousLoopService.runMorningBriefing(userId);
    return {
      success: result.success,
      libraryEntryId: result.libraryEntryId,
      title: result.title,
    };
  }

  /**
   * Manually trigger weekly digest for a user (useful for testing)
   */
  async triggerWeeklyDigest(userId: string): Promise<{
    success: boolean;
    libraryEntryId: string | null;
    title: string | null;
  }> {
    logger.info('[AL] Manual trigger: weekly digest', { userId });
    const result = await this.autonomousLoopService.runWeeklyDigest(userId);
    return {
      success: result.success,
      libraryEntryId: result.libraryEntryId,
      title: result.title,
    };
  }

  /**
   * Manually trigger web research for a user (useful for testing)
   */
  async triggerWebResearch(userId: string): Promise<{
    success: boolean;
    libraryEntryId: string | null;
    title: string | null;
  }> {
    logger.info('[AL] Manual trigger: web research', { userId });
    const result = await this.autonomousLoopService.runMiddayCuriosity(userId);
    return {
      success: result.success,
      libraryEntryId: result.libraryEntryId,
      title: result.title,
    };
  }

  /**
   * Manually trigger self-review for a user (useful for testing)
   */
  async triggerSelfReview(userId: string, depth: 'quick' | 'full' = 'quick'): Promise<{
    success: boolean;
    libraryEntryId: string | null;
    prsOpened: Array<{ number: number; url: string; title: string }>;
  }> {
    logger.info('[AL] Manual trigger: self-review', { userId, depth });
    const result = await this.selfReviewLoopService.runSelfReview(userId, undefined, depth);
    return {
      success: result.success,
      libraryEntryId: result.libraryEntryId,
      prsOpened: result.prsOpened,
    };
  }

  /**
   * Manually trigger investment research for a user (useful for testing)
   */
  async triggerInvestmentResearch(userId: string): Promise<{
    success: boolean;
    libraryEntryId: string | null;
    title: string | null;
  }> {
    logger.info('[AL] Manual trigger: investment research', { userId });
    const result = await this.autonomousLoopService.runInvestmentResearch(userId);
    return {
      success: result.success,
      libraryEntryId: result.libraryEntryId,
      title: result.title,
    };
  }

  /**
   * Manually trigger ability spending for a user (useful for testing)
   */
  async triggerAbilitySpending(userId: string): Promise<{
    success: boolean;
    libraryEntryId: string | null;
    title: string | null;
  }> {
    logger.info('[AL] Manual trigger: ability spending', { userId });
    const result = await this.autonomousLoopService.runAbilitySpending(userId);
    return {
      success: result.success,
      libraryEntryId: result.libraryEntryId,
      title: result.title,
    };
  }

  /**
   * Manually trigger morning health check for a user (useful for testing)
   */
  async triggerMorningHealthCheck(userId: string): Promise<{
    success: boolean;
    libraryEntryId: string | null;
    title: string | null;
  }> {
    logger.info('[AL] Manual trigger: morning health check', { userId });
    const result = await this.autonomousLoopService.runMorningHealthCheck(userId);
    return {
      success: result.success,
      libraryEntryId: result.libraryEntryId,
      title: result.title,
    };
  }

  /**
   * Manually trigger evening health check for a user (useful for testing)
   */
  async triggerEveningHealthCheck(userId: string): Promise<{
    success: boolean;
    libraryEntryId: string | null;
    title: string | null;
  }> {
    logger.info('[AL] Manual trigger: evening health check', { userId });
    const result = await this.autonomousLoopService.runEveningHealthCheck(userId);
    return {
      success: result.success,
      libraryEntryId: result.libraryEntryId,
      title: result.title,
    };
  }

  /**
   * Manually trigger research task processing (useful for testing)
   * Processes any pending research tasks immediately
   */
  async triggerResearchTaskProcessing(maxTasks: number = 3): Promise<{
    processed: number;
    successful: number;
    failed: number;
  }> {
    logger.info('[RESEARCH] Manual trigger: research task processing', { maxTasks });
    return await this.researchExecutorService.processPendingTasks(maxTasks);
  }

  /**
   * Starts the automatic fact extraction job
   * Runs hourly, but only extracts from conversations idle for 60+ minutes
   * This ensures facts are extracted once per conversation "session"
   */
  private startFactExtractionJob(): void {
    // Check hourly for idle conversations
    this.factExtractionJob = cron.schedule('0 * * * *', async () => {
      try {
        await this.runFactExtraction();
      } catch (err: any) {
        logger.error('[BACKGROUND] Unhandled error in fact extraction cron', { error: err.message });
      }
    });

    logger.info('[BACKGROUND] Fact extraction job scheduled (hourly, 60min idle trigger)');

    // Also run immediately on startup after a short delay
    setTimeout(() => {
      this.runFactExtraction().catch((err) => {
        logger.error('[BACKGROUND] Initial fact extraction failed:', err);
      });
    }, 10000); // 10 second delay to let server stabilize
  }

  /**
   * Run fact extraction for eligible conversations
   * Only extracts from conversations that have been idle for 60+ minutes
   * This ensures we extract once per conversation "session" rather than constantly polling
   */
  private async runFactExtraction(): Promise<void> {
    try {
      logger.debug('[BACKGROUND] Checking for idle conversations needing fact extraction');

      // Find conversations with:
      // - 5+ messages
      // - Idle for 60+ minutes (no activity in last hour)
      // - Not extracted since last activity (or never extracted)
      // - Had activity in last 7 days (don't process ancient conversations)
      const result = await this.pool.query(`
        SELECT c.id as conversation_id, c.user_id, c.updated_at
        FROM conversations c
        JOIN messages m ON m.conversation_id = c.id
        WHERE c.updated_at < NOW() - INTERVAL '60 minutes'
          AND c.updated_at > NOW() - INTERVAL '7 days'
          AND (c.last_fact_extraction_at IS NULL
               OR c.last_fact_extraction_at < c.updated_at)
        GROUP BY c.id, c.user_id, c.updated_at
        HAVING COUNT(m.id) >= 5
        ORDER BY c.updated_at DESC
        LIMIT 10
      `);

      if (result.rows.length === 0) {
        logger.debug('[BACKGROUND] No conversations need fact extraction');
        return;
      }

      logger.info(`[BACKGROUND] Found ${result.rows.length} conversations for fact extraction`);

      for (const row of result.rows) {
        try {
          // Check if user has fact extraction enabled in their profile
          const profile = await this.profileService.getUserProfile(row.user_id);
          const factExtractionEnabled = profile.features.memorySystem &&
            (profile.memory?.factExtraction ?? true);

          if (!factExtractionEnabled) {
            logger.debug(`[BACKGROUND] Skipping fact extraction for user ${row.user_id} (disabled in profile)`);
            // Still mark as processed to avoid re-checking constantly
            await this.pool.query(
              'UPDATE conversations SET last_fact_extraction_at = NOW() WHERE id = $1',
              [row.conversation_id]
            );
            continue;
          }

          await this.extractFactsForConversation(row.conversation_id, row.user_id);

          // Mark extraction done
          await this.pool.query(
            'UPDATE conversations SET last_fact_extraction_at = NOW() WHERE id = $1',
            [row.conversation_id]
          );

          logger.info(`[BACKGROUND] Extracted facts for conversation ${row.conversation_id}`);
        } catch (error: any) {
          logger.error(`[BACKGROUND] Failed to extract facts for conversation ${row.conversation_id}:`, {
            error: error.message,
          });
          // Continue with other conversations even if one fails
        }

        // Small delay between extractions to avoid overwhelming the LLM API
        await this.sleep(2000);
      }
    } catch (error: any) {
      logger.error('[BACKGROUND] Fact extraction job failed:', {
        error: error.message,
      });
    }
  }

  /**
   * Extract facts from a specific conversation
   */
  private async extractFactsForConversation(
    conversationId: string,
    userId: string
  ): Promise<void> {
    // Fetch recent messages from the conversation
    const messages = await this.messageService.getRecentMessages(conversationId, 20);

    if (messages.length === 0) {
      logger.debug(`[BACKGROUND] No messages found for conversation ${conversationId}`);
      return;
    }

    // Format messages for fact extraction
    const formattedMessages = messages.map((m) => {
      const prefix = m.role === 'user' ? 'User: ' : 'Assistant: ';
      return prefix + m.content;
    });

    // Extract facts using LLM
    const extractedFacts = await this.factService.extractFactsFromMessages(
      formattedMessages,
      userId
    );

    if (extractedFacts.length === 0) {
      logger.debug(`[BACKGROUND] No facts extracted from conversation ${conversationId}`);
      return;
    }

    // Create the extracted facts in database
    let createdCount = 0;
    for (const extracted of extractedFacts) {
      try {
        await this.factService.createFact({
          user_id: userId,
          content: extracted.content,
          category: extracted.category,
          confidence: extracted.confidence,
        });
        createdCount++;
      } catch (error: any) {
        // Log but don't fail - fact might be duplicate
        logger.debug(`[BACKGROUND] Failed to create fact: ${error.message}`);
      }
    }

    logger.info(`[BACKGROUND] Created ${createdCount}/${extractedFacts.length} facts from conversation ${conversationId}`);
  }

  /**
   * Start the conversation review job
   * Reviews idle conversations and generates Library entries async
   * Runs every 30 minutes, reviews conversations idle for 30+ minutes
   */
  private startConversationReviewJob(): void {
    this.conversationReviewJob = cron.schedule('*/30 * * * *', async () => {
      try {
        await this.conversationReviewService.reviewIdleConversations();
      } catch (err: any) {
        logger.error('[BACKGROUND] Unhandled error in conversation review cron', { error: err.message });
      }
    });

    logger.info('[BACKGROUND] Conversation review job scheduled (every 30 minutes)');
  }

  /**
   * Utility function for delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Manually trigger fact extraction (useful for testing)
   */
  async triggerFactExtraction(): Promise<void> {
    await this.runFactExtraction();
  }

  /**
   * Trigger fact extraction for a specific user's conversations
   */
  async triggerFactExtractionForUser(userId: string): Promise<{
    conversations_processed: number;
    facts_created: number;
    details: Array<{ conversation_id: string; facts_created: number }>;
  }> {
    const result = {
      conversations_processed: 0,
      facts_created: 0,
      details: [] as Array<{ conversation_id: string; facts_created: number }>,
    };

    try {
      // Find all eligible conversations for this user (ignore the 10-minute cooldown for manual trigger)
      const conversations = await this.pool.query(`
        SELECT c.id as conversation_id, c.title, MAX(c.updated_at) as updated_at
        FROM conversations c
        JOIN messages m ON m.conversation_id = c.id
        WHERE c.user_id = $1
          AND c.updated_at > NOW() - INTERVAL '7 days'
        GROUP BY c.id, c.title
        HAVING COUNT(m.id) >= 3
        ORDER BY updated_at DESC
        LIMIT 10
      `, [userId]);

      if (conversations.rows.length === 0) {
        logger.info(`[MANUAL TRIGGER] No eligible conversations for user ${userId}`);
        return result;
      }

      logger.info(`[MANUAL TRIGGER] Processing ${conversations.rows.length} conversations for user ${userId}`);

      for (const row of conversations.rows) {
        try {
          const beforeCount = await this.factService.getCountByUser(userId);

          await this.extractFactsForConversation(row.conversation_id, userId);

          // Mark extraction done
          await this.pool.query(
            'UPDATE conversations SET last_fact_extraction_at = NOW() WHERE id = $1',
            [row.conversation_id]
          );

          const afterCount = await this.factService.getCountByUser(userId);
          const factsCreated = afterCount - beforeCount;

          result.conversations_processed++;
          result.facts_created += factsCreated;
          result.details.push({
            conversation_id: row.conversation_id,
            facts_created: factsCreated,
          });

          // Small delay between extractions
          await this.sleep(1000);
        } catch (error: any) {
          logger.error(`[MANUAL TRIGGER] Failed to extract from conversation ${row.conversation_id}:`, {
            error: error.message,
          });
        }
      }

      logger.info(`[MANUAL TRIGGER] Completed for user ${userId}: ${result.facts_created} facts from ${result.conversations_processed} conversations`);
      return result;
    } catch (error: any) {
      logger.error(`[MANUAL TRIGGER] Failed for user ${userId}:`, { error: error.message });
      throw error;
    }
  }
}

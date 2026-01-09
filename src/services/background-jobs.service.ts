import cron from 'node-cron';
import { Pool } from 'pg';
import { logger } from '../logger';
import { FactService } from './fact.service';
import { MessageService } from './message.service';
import { VectorService } from './vector.service';
import { ProfileService } from './profile.service';

/**
 * BackgroundJobsService
 *
 * Handles scheduled background tasks for the Lucid agent:
 * - Automatic fact extraction from conversations
 *
 * After the refactor:
 * - Removed morning reflections (circadian system removed)
 * - Removed autonomous thought generation
 *
 * Fact extraction still runs to maintain the memory system.
 */
export class BackgroundJobsService {
  private pool: Pool;
  private factService: FactService;
  private messageService: MessageService;
  private profileService: ProfileService;
  private factExtractionJob: cron.ScheduledTask | null = null;
  private isRunning: boolean = false;

  constructor(pool: Pool) {
    this.pool = pool;
    const vectorService = new VectorService();
    this.factService = new FactService(pool, vectorService);
    this.messageService = new MessageService(pool, vectorService);
    this.profileService = new ProfileService(pool);
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
    this.isRunning = false;
    logger.info('[BACKGROUND] Background jobs stopped');
  }

  /**
   * Starts the automatic fact extraction job
   * Runs hourly, but only extracts from conversations idle for 60+ minutes
   * This ensures facts are extracted once per conversation "session"
   */
  private startFactExtractionJob(): void {
    // Check hourly for idle conversations
    this.factExtractionJob = cron.schedule('0 * * * *', async () => {
      await this.runFactExtraction();
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

import cron from 'node-cron';
import { Pool } from 'pg';
import { logger } from '../logger';
import { FactService } from './fact.service';
import { MessageService } from './message.service';
import { VectorService } from './vector.service';

/**
 * BackgroundJobsService
 *
 * Handles scheduled background tasks for the Lucid agent:
 * - Automatic fact extraction from conversations
 * - Future: Memory consolidation, insight generation, etc.
 */
export class BackgroundJobsService {
  private pool: Pool;
  private factService: FactService;
  private messageService: MessageService;
  private factExtractionJob: cron.ScheduledTask | null = null;
  private isRunning: boolean = false;

  constructor(pool: Pool) {
    this.pool = pool;
    const vectorService = new VectorService();
    this.factService = new FactService(pool, vectorService);
    this.messageService = new MessageService(pool, vectorService);
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
   * Runs every 5 minutes to extract facts from recent conversations
   */
  private startFactExtractionJob(): void {
    // Run every 5 minutes
    this.factExtractionJob = cron.schedule('*/5 * * * *', async () => {
      await this.runFactExtraction();
    });

    logger.info('[BACKGROUND] Fact extraction job scheduled (every 5 minutes)');

    // Also run immediately on startup after a short delay
    setTimeout(() => {
      this.runFactExtraction().catch((err) => {
        logger.error('[BACKGROUND] Initial fact extraction failed:', err);
      });
    }, 10000); // 10 second delay to let server stabilize
  }

  /**
   * Run fact extraction for eligible conversations
   */
  private async runFactExtraction(): Promise<void> {
    try {
      logger.debug('[BACKGROUND] Checking for conversations needing fact extraction');

      // Find conversations with:
      // - 5+ messages
      // - No recent extraction (null or older than 10 minutes)
      // - Active in the last 24 hours
      const result = await this.pool.query(`
        SELECT DISTINCT c.id as conversation_id, c.user_id
        FROM conversations c
        JOIN messages m ON m.conversation_id = c.id
        WHERE (c.last_fact_extraction_at IS NULL
               OR c.last_fact_extraction_at < NOW() - INTERVAL '10 minutes')
          AND c.updated_at > NOW() - INTERVAL '24 hours'
        GROUP BY c.id, c.user_id
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
}

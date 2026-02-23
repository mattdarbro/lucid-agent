import { Pool } from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { VectorService } from './vector.service';
import { MessageService } from './message.service';
import { chicagoTimeOfDay } from '../utils/chicago-time';

/**
 * ConversationReviewService
 *
 * Async background job that reviews idle conversations and decides
 * whether they warrant a Library entry. This replaces the synchronous
 * deep thinking pipeline that used to block every chat response.
 *
 * Runs on a schedule (every 30 min), reviews conversations that have
 * been idle for 30+ minutes and haven't been reviewed yet.
 *
 * Key difference from the old approach:
 * - Old: Every message triaged as DEEP/SIMPLE, blocking the response
 * - New: Conversations reviewed as a whole, after they go quiet
 * - Result: Fewer, higher quality Library entries; fast chat responses
 */
export class ConversationReviewService {
  private pool: Pool;
  private anthropic: Anthropic;
  private vectorService: VectorService;
  private messageService: MessageService;

  constructor(pool: Pool, anthropicApiKey?: string) {
    this.pool = pool;
    this.anthropic = new Anthropic({
      apiKey: anthropicApiKey || process.env.ANTHROPIC_API_KEY,
    });
    this.vectorService = new VectorService();
    this.messageService = new MessageService(pool, this.vectorService);
  }

  /**
   * Find and review idle conversations
   */
  async reviewIdleConversations(): Promise<void> {
    try {
      // Find conversations that:
      // - Have been idle for 30+ minutes
      // - Have 4+ messages (enough substance to review)
      // - Haven't been reviewed since their last activity
      // - Had activity in the last 24 hours (don't review stale conversations)
      const result = await this.pool.query(`
        SELECT c.id as conversation_id, c.user_id, c.updated_at
        FROM conversations c
        JOIN messages m ON m.conversation_id = c.id
        WHERE c.updated_at < NOW() - INTERVAL '30 minutes'
          AND c.updated_at > NOW() - INTERVAL '24 hours'
          AND (c.last_library_review_at IS NULL
               OR c.last_library_review_at < c.updated_at)
        GROUP BY c.id, c.user_id, c.updated_at
        HAVING COUNT(m.id) >= 4
        ORDER BY c.updated_at DESC
        LIMIT 5
      `);

      if (result.rows.length === 0) {
        logger.debug('[CONVERSATION-REVIEW] No conversations need review');
        return;
      }

      logger.info(`[CONVERSATION-REVIEW] Found ${result.rows.length} conversations to review`);

      for (const row of result.rows) {
        try {
          await this.reviewConversation(row.conversation_id, row.user_id);

          // Mark as reviewed regardless of whether a Library entry was created
          await this.pool.query(
            'UPDATE conversations SET last_library_review_at = NOW() WHERE id = $1',
            [row.conversation_id]
          );
        } catch (error: any) {
          logger.error(`[CONVERSATION-REVIEW] Failed to review conversation ${row.conversation_id}:`, {
            error: error.message,
          });
        }

        // Small delay between reviews
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (error: any) {
      logger.error('[CONVERSATION-REVIEW] Review job failed:', { error: error.message });
    }
  }

  /**
   * Review a single conversation and optionally create a Library entry
   */
  private async reviewConversation(conversationId: string, userId: string): Promise<void> {
    // Fetch the conversation messages
    const messages = await this.messageService.getRecentMessages(conversationId, 30);

    if (messages.length < 4) {
      return;
    }

    // Format for review
    const formatted = messages.map(m => {
      const who = m.role === 'user' ? 'Matt' : 'Lucid';
      return `${who}: ${m.content}`;
    }).join('\n\n');

    // Ask Claude (using Sonnet for cost efficiency) whether this conversation
    // has a thread worth developing into a Library entry
    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      temperature: 0.7,
      messages: [{
        role: 'user',
        content: `Review this conversation between Matt and Lucid. Decide if there's a thread worth developing into a Library entry—a deeper reflection, insight, or synthesis that would be valuable to revisit later.

Not every conversation needs a Library entry. Casual chat, quick questions, logistical exchanges—those are fine as-is. Only create an entry if there's genuine depth worth preserving.

CONVERSATION:
${formatted}

If there IS something worth a Library entry, respond with:
WORTHY: yes
TITLE: [descriptive title]
CONTENT: [300-800 word reflection that develops the thread, connects it to broader themes, and adds depth beyond what was said in the conversation]

If there is NOT enough depth for a Library entry, respond with:
WORTHY: no`
      }],
    });

    const content = response.content[0];
    if (content.type !== 'text') return;

    const text = content.text.trim();

    // Check if the review found something worthy
    if (!text.startsWith('WORTHY: yes')) {
      logger.debug(`[CONVERSATION-REVIEW] Conversation ${conversationId} - no Library entry needed`);
      return;
    }

    // Parse the response
    const titleMatch = text.match(/TITLE:\s*(.+?)(?:\n|$)/);
    const contentMatch = text.match(/CONTENT:\s*([\s\S]+)/);

    if (!titleMatch || !contentMatch) {
      logger.warn('[CONVERSATION-REVIEW] Could not parse review response');
      return;
    }

    const title = titleMatch[1].trim();
    const entryContent = contentMatch[1].trim();

    // Generate embedding
    let embeddingString: string | null = null;
    try {
      const embedding = await this.vectorService.generateEmbedding(`${title} ${entryContent}`);
      embeddingString = `[${embedding.join(',')}]`;
    } catch (err) {
      logger.warn('[CONVERSATION-REVIEW] Failed to generate embedding', { error: err });
    }

    // Save to Library
    const timeOfDay = chicagoTimeOfDay();
    await this.pool.query(
      `INSERT INTO library_entries
       (user_id, entry_type, title, content, time_of_day, related_conversation_id, metadata, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector)`,
      [
        userId,
        'conversation_reflection',
        title,
        entryContent,
        timeOfDay,
        conversationId,
        JSON.stringify({
          generated_by: 'conversation_review',
          generated_at: new Date().toISOString(),
        }),
        embeddingString,
      ]
    );

    logger.info(`[CONVERSATION-REVIEW] Created Library entry for conversation ${conversationId}`, {
      title,
      content_length: entryContent.length,
    });
  }
}

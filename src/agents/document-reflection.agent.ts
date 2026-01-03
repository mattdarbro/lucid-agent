import { Pool } from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { LivingDocumentService } from '../services/living-document.service';
import { ThoughtService } from '../services/thought.service';
import { ProfileService } from '../services/profile.service';

/**
 * DocumentReflectionAgent
 *
 * Maintains Lucid's "working memory" by periodically reviewing and updating
 * the Living Document. This agent:
 *
 * 1. Reads the current Living Document
 * 2. RAGs over recent conversations for answers/new questions
 * 3. RAGs over Library for deeper context
 * 4. Updates the document (add new insights, prune stale items)
 *
 * This is how Lucid actively curates his understanding rather than
 * passively accumulating information.
 */
export class DocumentReflectionAgent {
  private pool: Pool;
  private anthropic: Anthropic;
  private livingDocumentService: LivingDocumentService;
  private thoughtService: ThoughtService;
  private profileService: ProfileService;

  constructor(pool: Pool, anthropicApiKey?: string) {
    this.pool = pool;
    this.anthropic = new Anthropic({
      apiKey: anthropicApiKey || process.env.ANTHROPIC_API_KEY,
    });
    this.livingDocumentService = new LivingDocumentService(pool);
    this.thoughtService = new ThoughtService(pool, anthropicApiKey);
    this.profileService = new ProfileService(pool);
  }

  /**
   * Run document reflection for a user
   */
  async reflect(userId: string): Promise<boolean> {
    try {
      logger.info(`[DOC REFLECTION] Starting reflection for user ${userId}`);

      // Check if user has autonomous agents enabled
      const profile = await this.profileService.getUserProfile(userId);
      if (!profile.features.autonomousAgents) {
        logger.debug(`[DOC REFLECTION] Autonomous agents disabled for user ${userId}`);
        return false;
      }

      // 1. Get current Living Document
      const currentDoc = await this.livingDocumentService.getOrCreateDocument(userId);

      // 2. Gather context from recent conversations
      const recentMessages = await this.getRecentMessages(userId, 50);

      // 3. Gather context from Library
      const libraryEntries = await this.getRecentLibraryEntries(userId, 10);

      // 4. Get user's name for personalization
      const userName = await this.getUserName(userId);

      // 5. Generate updated document
      const updatedContent = await this.generateUpdatedDocument(
        currentDoc.content,
        recentMessages,
        libraryEntries,
        userName
      );

      if (!updatedContent) {
        logger.warn(`[DOC REFLECTION] Failed to generate updated document for user ${userId}`);
        return false;
      }

      // 6. Save updated document
      await this.livingDocumentService.updateDocument(userId, updatedContent);
      await this.livingDocumentService.updateReflectionDate(userId);

      logger.info(`[DOC REFLECTION] Completed reflection for user ${userId}`);
      return true;
    } catch (error: any) {
      logger.error(`[DOC REFLECTION] Error during reflection`, {
        userId,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Generate updated document content using Claude
   */
  private async generateUpdatedDocument(
    currentDocument: string,
    recentMessages: Array<{ role: string; content: string; created_at: Date }>,
    libraryEntries: Array<{ title: string; content: string }>,
    userName: string | null
  ): Promise<string | null> {
    try {
      // Format recent messages
      const messagesContext = recentMessages
        .map((m) => `[${m.role}]: ${m.content}`)
        .join('\n\n');

      // Format library entries
      const libraryContext = libraryEntries
        .map((e) => `### ${e.title}\n${e.content}`)
        .join('\n\n---\n\n');

      const prompt = `You are Lucid, reflecting on your notes and recent context.

${userName ? `You are companion to ${userName}.` : ''}

## Your Current Notes (Living Document)

${currentDocument}

## Recent Conversations (Last Few Days)

${messagesContext || 'No recent conversations to review.'}

## Library Entries (Deep Thinking)

${libraryContext || 'No library entries to review.'}

---

## Your Task

Review your current notes and update them based on what you've learned.

For each section, ask yourself:
- **Questions I'm Holding**: Any questions answered? Any new questions emerging?
- **Inconsistencies I've Noticed**: Anything resolved? New patterns that don't add up?
- **Active Threads**: Conversations that resolved? New ongoing topics?
- **Patterns I'm Seeing**: New patterns? Old patterns still valid?
- **Ideas & Possibilities**: Anything worth adding from recent conversations?
- **What I've Learned Recently**: Fresh insights to capture?
- **Questions to Ask**: Things you want to bring up next time?

Guidelines:
- Keep items concise (one line each)
- Remove items that are stale or resolved
- Add items that feel genuinely important
- Don't accumulate everything - curate what matters
- Update the "Last reflection" date to today

Return ONLY the updated document in the same markdown format.
Do not include any explanation or commentary - just the document.`;

      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        temperature: 0.7,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        return null;
      }

      return content.text.trim();
    } catch (error: any) {
      logger.error(`[DOC REFLECTION] Error generating updated document`, {
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Get recent messages for context
   */
  private async getRecentMessages(
    userId: string,
    limit: number
  ): Promise<Array<{ role: string; content: string; created_at: Date }>> {
    try {
      const result = await this.pool.query(
        `SELECT m.role, m.content, m.created_at
         FROM messages m
         JOIN conversations c ON m.conversation_id = c.id
         WHERE c.user_id = $1
         ORDER BY m.created_at DESC
         LIMIT $2`,
        [userId, limit]
      );

      return result.rows.reverse(); // Chronological order
    } catch (error: any) {
      logger.warn(`[DOC REFLECTION] Error getting recent messages`, {
        userId,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Get recent library entries for context
   */
  private async getRecentLibraryEntries(
    userId: string,
    limit: number
  ): Promise<Array<{ title: string; content: string }>> {
    try {
      const result = await this.pool.query(
        `SELECT title, content
         FROM library
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [userId, limit]
      );

      return result.rows.map((row) => ({
        title: row.title || 'Untitled',
        content: row.content,
      }));
    } catch (error: any) {
      logger.warn(`[DOC REFLECTION] Error getting library entries`, {
        userId,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Get user's name from immutable facts
   */
  private async getUserName(userId: string): Promise<string | null> {
    try {
      const result = await this.pool.query(
        `SELECT content FROM immutable_facts
         WHERE user_id = $1 AND category = 'name'
         LIMIT 1`,
        [userId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      // Extract name from content (handles "Matt", "The user's name is Matt", etc.)
      const content = result.rows[0].content;
      const match = content.match(/([A-Z][a-z]+)/);
      return match ? match[1] : content;
    } catch (error: any) {
      logger.warn(`[DOC REFLECTION] Error getting user name`, {
        userId,
        error: error.message,
      });
      return null;
    }
  }
}

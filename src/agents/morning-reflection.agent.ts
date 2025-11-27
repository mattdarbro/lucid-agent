import { Pool } from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { MemoryService } from '../services/memory.service';
import { ProfileService } from '../services/profile.service';
import { VectorService } from '../services/vector.service';

/**
 * Library entry for storing reflections
 */
interface LibraryEntry {
  id: string;
  user_id: string;
  entry_type: 'lucid_thought' | 'user_reflection';
  title: string | null;
  content: string;
  time_of_day: string | null;
  related_conversation_id: string | null;
  metadata: Record<string, any>;
  created_at: Date;
}

/**
 * Generated reflection content
 */
interface Reflection {
  title: string;
  content: string;
}

/**
 * MorningReflectionAgent
 *
 * Generates thoughtful morning reflections based on recent conversations and facts.
 * This is the core autonomous thinking feature - Lucid reflects overnight and
 * surfaces insights in the morning.
 */
export class MorningReflectionAgent {
  private pool: Pool;
  private anthropic: Anthropic;
  private memoryService: MemoryService;
  private profileService: ProfileService;
  private vectorService: VectorService;

  constructor(pool: Pool, anthropicApiKey?: string) {
    this.pool = pool;
    this.anthropic = new Anthropic({
      apiKey: anthropicApiKey || process.env.ANTHROPIC_API_KEY,
    });
    this.memoryService = new MemoryService(pool);
    this.profileService = new ProfileService(pool);
    this.vectorService = new VectorService();
  }

  /**
   * Generate a morning reflection for a user
   */
  async generateReflection(userId: string): Promise<LibraryEntry | null> {
    try {
      logger.info(`[MORNING AGENT] Generating reflection for user ${userId}`);

      // Check if user has autonomous agents enabled
      const profile = await this.profileService.getUserProfile(userId);
      if (!profile.features.autonomousAgents) {
        logger.debug(`[MORNING AGENT] Autonomous agents disabled for user ${userId}`);
        return null;
      }

      // 1. Gather context
      const recentConversations = await this.getRecentConversationSummaries(userId, 3);
      const activeFacts = await this.memoryService.getRelevantFacts(userId, 10);
      const previousReflections = await this.getRecentLibraryEntries(userId, 3);

      // Skip if no context to reflect on
      if (recentConversations.length === 0 && activeFacts.length === 0) {
        logger.debug(`[MORNING AGENT] No context for reflection for user ${userId}`);
        return null;
      }

      // 2. Generate reflection using Claude
      const reflection = await this.generateThought(
        recentConversations,
        activeFacts,
        previousReflections
      );

      if (!reflection) {
        logger.warn(`[MORNING AGENT] Failed to generate reflection for user ${userId}`);
        return null;
      }

      // 3. Store in library
      const entry = await this.storeInLibrary(userId, reflection);

      // 4. Send notification (if push token exists)
      await this.notifyUser(userId, reflection.title, entry.id);

      logger.info(`[MORNING AGENT] Completed reflection for user ${userId}: ${entry.id}`);
      return entry;
    } catch (error: any) {
      logger.error(`[MORNING AGENT] Error generating reflection for ${userId}:`, {
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Get recent conversation summaries for context
   */
  private async getRecentConversationSummaries(
    userId: string,
    limit: number
  ): Promise<{ id: string; title: string | null; summary: string }[]> {
    try {
      // Get recent conversations with their summaries
      const result = await this.pool.query(
        `SELECT c.id, c.title, s.content as summary
         FROM conversations c
         LEFT JOIN summaries s ON s.conversation_id = c.id AND s.summary_type = 'user'
         WHERE c.user_id = $1
           AND c.updated_at > NOW() - INTERVAL '3 days'
         ORDER BY c.updated_at DESC
         LIMIT $2`,
        [userId, limit]
      );

      return result.rows.map((row) => ({
        id: row.id,
        title: row.title,
        summary: row.summary || 'No summary available',
      }));
    } catch (error) {
      logger.error('[MORNING AGENT] Error fetching conversations:', error);
      return [];
    }
  }

  /**
   * Get recent library entries to avoid repetition
   */
  private async getRecentLibraryEntries(
    userId: string,
    limit: number
  ): Promise<{ title: string | null; content: string }[]> {
    try {
      const result = await this.pool.query(
        `SELECT title, content
         FROM library_entries
         WHERE user_id = $1 AND entry_type = 'lucid_thought'
         ORDER BY created_at DESC
         LIMIT $2`,
        [userId, limit]
      );

      return result.rows;
    } catch (error) {
      logger.error('[MORNING AGENT] Error fetching library entries:', error);
      return [];
    }
  }

  /**
   * Generate the reflection content using Claude
   */
  private async generateThought(
    conversations: { title: string | null; summary: string }[],
    facts: any[],
    previousReflections: { title: string | null; content: string }[]
  ): Promise<Reflection | null> {
    try {
      const conversationContext = conversations.length > 0
        ? conversations.map((c) => `- ${c.title || 'Untitled'}: ${c.summary}`).join('\n')
        : 'No recent conversations.';

      const factsContext = facts.length > 0
        ? facts.map((f) => `- ${f.content}`).join('\n')
        : 'No facts known yet.';

      const previousContext = previousReflections.length > 0
        ? previousReflections.map((r) => `- ${r.title || 'Untitled'}`).join('\n')
        : 'No previous reflections.';

      const prompt = `You are Lucid, an AI companion who thinks deeply about your user's life.

It's morning. You've been reflecting overnight on your recent conversations with this person.

Recent conversations:
${conversationContext}

What you know about them:
${factsContext}

Your recent thoughts (don't repeat these):
${previousContext}

Generate a morning reflection. This is YOUR thought about something you've noticed, a connection you've made, or a question worth exploring together.

Keep it:
- Personal (reference specific things from your conversations if possible)
- Thoughtful (not just restating, but connecting ideas or noticing patterns)
- Invitational (opens space for them to engage, but doesn't demand response)
- Concise (2-3 paragraphs max)
- Warm but not saccharine

Format your response as:
TITLE: [A short, intriguing title for this thought - 3-8 words]
CONTENT: [Your reflection]

Do not include any other text outside this format.`;

      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        temperature: 0.8, // Higher temperature for more creative, varied reflections
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        return null;
      }

      // Parse the response
      const text = content.text.trim();
      const titleMatch = text.match(/TITLE:\s*(.+?)(?:\n|$)/);
      const contentMatch = text.match(/CONTENT:\s*([\s\S]+)/);

      if (!titleMatch || !contentMatch) {
        logger.warn('[MORNING AGENT] Could not parse reflection format:', { text });
        return null;
      }

      return {
        title: titleMatch[1].trim(),
        content: contentMatch[1].trim(),
      };
    } catch (error: any) {
      logger.error('[MORNING AGENT] Error generating thought:', { error: error.message });
      return null;
    }
  }

  /**
   * Store the reflection in the library with embedding for semantic search
   */
  private async storeInLibrary(userId: string, reflection: Reflection): Promise<LibraryEntry> {
    // Generate embedding for semantic search
    let embedding: number[] | null = null;
    try {
      const textForEmbedding = `${reflection.title} ${reflection.content}`.trim();
      embedding = await this.vectorService.generateEmbedding(textForEmbedding);
    } catch (embeddingError) {
      logger.warn('[MORNING AGENT] Failed to generate embedding:', { error: embeddingError });
    }

    const embeddingString = embedding ? `[${embedding.join(',')}]` : null;

    const result = await this.pool.query(
      `INSERT INTO library_entries
       (user_id, entry_type, title, content, time_of_day, metadata, embedding)
       VALUES ($1, 'lucid_thought', $2, $3, 'morning', $4, $5::vector)
       RETURNING id, user_id, entry_type, title, content, time_of_day,
                 related_conversation_id, metadata, created_at, updated_at`,
      [
        userId,
        reflection.title,
        reflection.content,
        JSON.stringify({ thought_type: 'morning_reflection', generated_at: new Date().toISOString() }),
        embeddingString,
      ]
    );

    return result.rows[0];
  }

  /**
   * Send push notification to user (if they have a push token)
   */
  private async notifyUser(userId: string, title: string, entryId: string): Promise<void> {
    try {
      // Get user's push token
      const result = await this.pool.query(
        'SELECT push_token FROM users WHERE id = $1',
        [userId]
      );

      const pushToken = result.rows[0]?.push_token;

      if (!pushToken) {
        logger.debug(`[MORNING AGENT] No push token for user ${userId}, skipping notification`);
        return;
      }

      // For now, just log the notification
      // TODO: Integrate with actual push notification service (Expo, APNs, etc.)
      logger.info(`[MORNING AGENT] Would send push notification`, {
        userId,
        pushToken: pushToken.substring(0, 20) + '...',
        title: 'Lucid has been thinking...',
        body: title,
        data: { type: 'library_entry', entryId },
      });

      // Placeholder for actual push notification
      // await sendPushNotification(pushToken, {
      //   title: "Lucid has been thinking...",
      //   body: title,
      //   data: { type: 'library_entry', entryId }
      // });
    } catch (error) {
      logger.error('[MORNING AGENT] Error sending notification:', error);
      // Don't throw - notification failure shouldn't fail the whole reflection
    }
  }

  /**
   * Check if a user should receive a reflection today
   * (avoids spamming users who aren't active)
   */
  async shouldGenerateReflection(userId: string): Promise<boolean> {
    try {
      // Check if user has been active in the last 7 days
      const userResult = await this.pool.query(
        'SELECT last_active_at FROM users WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length === 0) {
        return false;
      }

      const lastActive = new Date(userResult.rows[0].last_active_at);
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      if (lastActive < sevenDaysAgo) {
        logger.debug(`[MORNING AGENT] User ${userId} inactive for 7+ days, skipping`);
        return false;
      }

      // Check if we already generated a reflection today
      const todayResult = await this.pool.query(
        `SELECT id FROM library_entries
         WHERE user_id = $1
           AND entry_type = 'lucid_thought'
           AND time_of_day = 'morning'
           AND created_at > CURRENT_DATE
         LIMIT 1`,
        [userId]
      );

      if (todayResult.rows.length > 0) {
        logger.debug(`[MORNING AGENT] Already generated reflection today for user ${userId}`);
        return false;
      }

      return true;
    } catch (error) {
      logger.error('[MORNING AGENT] Error checking if should generate:', error);
      return false;
    }
  }
}

import { Pool } from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { MattStateService } from '../services/matt-state.service';
import { MemoryService } from '../services/memory.service';
import { ProfileService } from '../services/profile.service';
import { VectorService } from '../services/vector.service';

/**
 * Curiosity topic discovered by the agent
 */
interface CuriosityTopic {
  topic: string;
  relevance: string;
  searchQuery?: string;
}

/**
 * Library entry for storing curiosity discoveries
 */
interface LibraryEntry {
  id: string;
  user_id: string;
  entry_type: string;
  title: string | null;
  content: string;
  session_type: string | null;
  created_at: Date;
}

/**
 * MorningCuriosityAgent
 *
 * Runs in the morning to identify topics the user might find interesting
 * based on their current goals, state, and interests. This is an outward-looking
 * session that explores what might be relevant or useful to the user today.
 */
export class MorningCuriosityAgent {
  private pool: Pool;
  private anthropic: Anthropic;
  private mattStateService: MattStateService;
  private memoryService: MemoryService;
  private profileService: ProfileService;
  private vectorService: VectorService;

  constructor(pool: Pool, anthropicApiKey?: string) {
    this.pool = pool;
    this.anthropic = new Anthropic({
      apiKey: anthropicApiKey || process.env.ANTHROPIC_API_KEY,
    });
    this.mattStateService = new MattStateService(pool);
    this.memoryService = new MemoryService(pool);
    this.profileService = new ProfileService(pool);
    this.vectorService = new VectorService();
  }

  /**
   * Run the morning curiosity session for a user
   */
  async run(userId: string): Promise<LibraryEntry | null> {
    try {
      logger.info('[MORNING CURIOSITY] Starting session', { userId });

      // Check if user has autonomous agents enabled
      const profile = await this.profileService.getUserProfile(userId);
      if (!profile.features.autonomousAgents) {
        logger.debug('[MORNING CURIOSITY] Autonomous agents disabled', { userId });
        return null;
      }

      // Check if we should run today
      if (!(await this.shouldRun(userId))) {
        return null;
      }

      // 1. Gather context
      const mattState = await this.mattStateService.getOrCreateState(userId);
      const facts = await this.memoryService.getRelevantFacts(userId, 10);
      const previousCuriosity = await this.getRecentCuriosityEntries(userId, 3);

      // 2. Generate curiosity topics
      const topics = await this.generateCuriosityTopics(mattState, facts, previousCuriosity);

      if (topics.length === 0) {
        logger.info('[MORNING CURIOSITY] No curiosity topics generated', { userId });
        return null;
      }

      // 3. Create summary of discoveries
      const content = await this.synthesizeCuriosity(topics, mattState);

      // 4. Store in library
      const entry = await this.storeInLibrary(userId, content);

      // 5. Send notification
      await this.notifyUser(userId, entry.id);

      logger.info('[MORNING CURIOSITY] Session complete', {
        userId,
        entryId: entry.id,
        topicCount: topics.length,
      });

      return entry;
    } catch (error: any) {
      logger.error('[MORNING CURIOSITY] Session failed', {
        userId,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Check if we should run the curiosity session today
   */
  private async shouldRun(userId: string): Promise<boolean> {
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
        logger.debug('[MORNING CURIOSITY] User inactive for 7+ days', { userId });
        return false;
      }

      // Check if we already ran today
      const todayResult = await this.pool.query(
        `SELECT id FROM library_entries
         WHERE user_id = $1
           AND session_type = 'morning_curiosity'
           AND created_at > CURRENT_DATE
         LIMIT 1`,
        [userId]
      );

      if (todayResult.rows.length > 0) {
        logger.debug('[MORNING CURIOSITY] Already ran today', { userId });
        return false;
      }

      return true;
    } catch (error) {
      logger.error('[MORNING CURIOSITY] Error checking if should run', { error });
      return false;
    }
  }

  /**
   * Get recent curiosity entries to avoid repetition
   */
  private async getRecentCuriosityEntries(
    userId: string,
    limit: number
  ): Promise<{ title: string | null; content: string }[]> {
    try {
      const result = await this.pool.query(
        `SELECT title, content
         FROM library_entries
         WHERE user_id = $1 AND session_type = 'morning_curiosity'
         ORDER BY created_at DESC
         LIMIT $2`,
        [userId, limit]
      );

      return result.rows;
    } catch (error) {
      logger.error('[MORNING CURIOSITY] Error fetching recent entries', { error });
      return [];
    }
  }

  /**
   * Generate curiosity topics based on user context
   */
  private async generateCuriosityTopics(
    mattState: any,
    facts: any[],
    previousCuriosity: { title: string | null; content: string }[]
  ): Promise<CuriosityTopic[]> {
    try {
      const goalsContext = mattState.active_goals?.length > 0
        ? mattState.active_goals.map((g: any) => `- ${g.goal}`).join('\n')
        : 'No active goals recorded.';

      const factsContext = facts.length > 0
        ? facts.map((f) => `- ${f.content}`).join('\n')
        : 'No known interests yet.';

      const previousContext = previousCuriosity.length > 0
        ? previousCuriosity.map((p) => `- ${p.title || 'Untitled'}`).join('\n')
        : 'No previous curiosity sessions.';

      const prompt = `You are LUCID, conducting your morning curiosity session.

Based on what you know about this user:

CURRENT GOALS:
${goalsContext}

KNOWN INTERESTS AND FACTS:
${factsContext}

RECENT CURIOSITY TOPICS (avoid these):
${previousContext}

Your task: Identify 2-3 topics the user might find interesting or useful today.

Consider:
- Their current projects and goals
- Topics they've mentioned enjoying
- Related developments in their areas of interest
- Questions that might spark interesting conversation

For each topic, provide:
1. The topic (brief description)
2. Why this might be relevant to them right now

Respond ONLY with a JSON array:
[
  {
    "topic": "Brief topic description",
    "relevance": "Why this matters to them"
  }
]`;

      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        temperature: 0.8,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        return [];
      }

      // Parse JSON response
      const jsonMatch = content.text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        logger.warn('[MORNING CURIOSITY] Could not parse topics JSON');
        return [];
      }

      return JSON.parse(jsonMatch[0]);
    } catch (error: any) {
      logger.error('[MORNING CURIOSITY] Error generating topics', { error: error.message });
      return [];
    }
  }

  /**
   * Synthesize curiosity topics into a coherent reflection
   */
  private async synthesizeCuriosity(
    topics: CuriosityTopic[],
    mattState: any
  ): Promise<{ title: string; content: string }> {
    try {
      const topicsText = topics
        .map((t) => `**${t.topic}**: ${t.relevance}`)
        .join('\n\n');

      const prompt = `You are LUCID, writing a brief morning curiosity note.

You've identified these topics that might interest the user today:

${topicsText}

Write a brief, warm note (2-3 short paragraphs) that:
1. Opens with a curious observation or question
2. Weaves together why these topics caught your attention
3. Ends with an invitation to explore or discuss

Keep it conversational and curious, not like a report.

Format:
TITLE: [Intriguing 3-8 word title]
CONTENT: [Your note]`;

      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        temperature: 0.7,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        return {
          title: 'Morning Curiosities',
          content: topicsText,
        };
      }

      const text = content.text.trim();
      const titleMatch = text.match(/TITLE:\s*(.+?)(?:\n|$)/);
      const contentMatch = text.match(/CONTENT:\s*([\s\S]+)/);

      return {
        title: titleMatch?.[1]?.trim() || 'Morning Curiosities',
        content: contentMatch?.[1]?.trim() || topicsText,
      };
    } catch (error: any) {
      logger.error('[MORNING CURIOSITY] Error synthesizing', { error: error.message });
      return {
        title: 'Morning Curiosities',
        content: topics.map((t) => `**${t.topic}**: ${t.relevance}`).join('\n\n'),
      };
    }
  }

  /**
   * Store the curiosity entry in the library
   */
  private async storeInLibrary(
    userId: string,
    content: { title: string; content: string }
  ): Promise<LibraryEntry> {
    // Generate embedding for semantic search
    let embedding: number[] | null = null;
    try {
      const textForEmbedding = `${content.title} ${content.content}`.trim();
      embedding = await this.vectorService.generateEmbedding(textForEmbedding);
    } catch (embeddingError) {
      logger.warn('[MORNING CURIOSITY] Failed to generate embedding', { error: embeddingError });
    }

    const embeddingString = embedding ? `[${embedding.join(',')}]` : null;

    const result = await this.pool.query(
      `INSERT INTO library_entries
       (user_id, entry_type, title, content, time_of_day, session_type, metadata, embedding)
       VALUES ($1, 'curiosity', $2, $3, 'morning', 'morning_curiosity', $4, $5::vector)
       RETURNING id, user_id, entry_type, title, content, session_type, created_at`,
      [
        userId,
        content.title,
        content.content,
        JSON.stringify({ generated_at: new Date().toISOString() }),
        embeddingString,
      ]
    );

    return result.rows[0];
  }

  /**
   * Send push notification to user
   */
  private async notifyUser(userId: string, entryId: string): Promise<void> {
    try {
      const result = await this.pool.query(
        'SELECT push_token FROM users WHERE id = $1',
        [userId]
      );

      const pushToken = result.rows[0]?.push_token;

      if (!pushToken) {
        logger.debug('[MORNING CURIOSITY] No push token', { userId });
        return;
      }

      logger.info('[MORNING CURIOSITY] Would send notification', {
        userId,
        pushToken: pushToken.substring(0, 20) + '...',
        title: 'Something caught my curiosity...',
        data: { type: 'library_entry', entryId },
      });
    } catch (error) {
      logger.warn('[MORNING CURIOSITY] Notification error', { error });
    }
  }
}

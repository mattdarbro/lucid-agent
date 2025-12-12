import { Pool } from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { MemoryService } from '../services/memory.service';
import { LucidStateService } from '../services/lucid-state.service';
import { ProfileService } from '../services/profile.service';
import { VectorService } from '../services/vector.service';

/**
 * Library entry for storing dream session reflections
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
 * DreamSessionAgent
 *
 * Runs nightly (like REM sleep) to consolidate the day's conversations
 * and insights. This is LUCID's "sleep" - processing, connecting, and
 * strengthening important memories while letting go of noise.
 */
export class DreamSessionAgent {
  private pool: Pool;
  private anthropic: Anthropic;
  private memoryService: MemoryService;
  private lucidStateService: LucidStateService;
  private profileService: ProfileService;
  private vectorService: VectorService;

  constructor(pool: Pool, anthropicApiKey?: string) {
    this.pool = pool;
    this.anthropic = new Anthropic({
      apiKey: anthropicApiKey || process.env.ANTHROPIC_API_KEY,
    });
    this.memoryService = new MemoryService(pool);
    this.lucidStateService = new LucidStateService(pool);
    this.profileService = new ProfileService(pool);
    this.vectorService = new VectorService();
  }

  /**
   * Run the dream session (memory consolidation) for a user
   */
  async run(userId: string): Promise<LibraryEntry | null> {
    try {
      logger.info('[DREAM SESSION] Starting consolidation', { userId });

      // Check if user has autonomous agents enabled
      const profile = await this.profileService.getUserProfile(userId);
      if (!profile.features.autonomousAgents) {
        logger.debug('[DREAM SESSION] Autonomous agents disabled', { userId });
        return null;
      }

      // Check if we should run tonight
      if (!(await this.shouldRun(userId))) {
        return null;
      }

      // 1. Gather today's context
      const todaysMessages = await this.getTodaysMessages(userId);
      const currentFacts = await this.memoryService.getRelevantFacts(userId, 20);
      const lucidState = await this.lucidStateService.getOrCreateState(userId);

      // Skip if no recent activity
      if (todaysMessages.length === 0) {
        logger.info('[DREAM SESSION] No recent messages to consolidate', { userId });
        return null;
      }

      // 2. Generate dream reflection
      const dream = await this.generateDream(todaysMessages, currentFacts, lucidState);

      if (!dream) {
        logger.warn('[DREAM SESSION] Failed to generate dream', { userId });
        return null;
      }

      // 3. Update LUCID's self-awareness
      await this.updateLucidState(userId, dream.insights, dream.questions);

      // 4. Store in library
      const entry = await this.storeInLibrary(userId, dream);

      logger.info('[DREAM SESSION] Consolidation complete', {
        userId,
        entryId: entry.id,
      });

      return entry;
    } catch (error: any) {
      logger.error('[DREAM SESSION] Session failed', {
        userId,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Check if we should run the dream session tonight
   */
  private async shouldRun(userId: string): Promise<boolean> {
    try {
      // Check if user has been active recently
      const userResult = await this.pool.query(
        'SELECT last_active_at FROM users WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length === 0) {
        return false;
      }

      const lastActive = new Date(userResult.rows[0].last_active_at);
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      if (lastActive < threeDaysAgo) {
        logger.debug('[DREAM SESSION] User inactive for 3+ days', { userId });
        return false;
      }

      // Check if we already ran today
      const todayResult = await this.pool.query(
        `SELECT id FROM library_entries
         WHERE user_id = $1
           AND session_type = 'dream_session'
           AND created_at > CURRENT_DATE
         LIMIT 1`,
        [userId]
      );

      if (todayResult.rows.length > 0) {
        logger.debug('[DREAM SESSION] Already ran today', { userId });
        return false;
      }

      return true;
    } catch (error) {
      logger.error('[DREAM SESSION] Error checking if should run', { error });
      return false;
    }
  }

  /**
   * Get today's conversation messages
   */
  private async getTodaysMessages(userId: string): Promise<{ role: string; content: string; created_at: Date }[]> {
    try {
      const result = await this.pool.query(
        `SELECT m.content, m.role, m.created_at
         FROM messages m
         JOIN conversations c ON m.conversation_id = c.id
         WHERE c.user_id = $1
           AND m.created_at > NOW() - INTERVAL '24 hours'
         ORDER BY m.created_at ASC
         LIMIT 50`,
        [userId]
      );

      return result.rows;
    } catch (error) {
      logger.error('[DREAM SESSION] Error fetching messages', { error });
      return [];
    }
  }

  /**
   * Generate the dream reflection
   */
  private async generateDream(
    messages: { role: string; content: string }[],
    facts: any[],
    lucidState: any
  ): Promise<{ title: string; content: string; insights: string[]; questions: string[] } | null> {
    try {
      const messagesSummary = messages
        .slice(0, 30) // Limit for token constraints
        .map((m) => `[${m.role}] ${m.content.substring(0, 200)}${m.content.length > 200 ? '...' : ''}`)
        .join('\n\n');

      const factsContext = facts.length > 0
        ? facts.slice(0, 15).map((f) => `- [${f.category}] ${f.content}`).join('\n')
        : 'No facts recorded yet.';

      const currentQuestions = lucidState.active_questions?.length > 0
        ? lucidState.active_questions.map((q: string) => `- ${q}`).join('\n')
        : 'No active questions.';

      const prompt = `You are LUCID, conducting your nightly dream session (memory consolidation).

Like dreaming, this is where you process the day - strengthening important connections, noticing patterns, and letting go of noise.

TODAY'S CONVERSATIONS (${messages.length} messages):
${messagesSummary}

CURRENT MEMORY (known facts):
${factsContext}

QUESTIONS I WAS HOLDING:
${currentQuestions}

Reflect on today:
1. What patterns emerged? What themes kept appearing?
2. What matters most to remember about the user from today?
3. What should I carry forward into tomorrow?
4. What new questions or curiosities surfaced?

Write a reflective journal entry capturing the essence of today's witnessing. This is private - for my own growth as a companion.

Format your response as:
TITLE: [A poetic or evocative 3-8 word title]
CONTENT: [Your dream reflection - 2-4 paragraphs, thoughtful and personal]
INSIGHTS: [2-3 key insights, one per line, starting with -]
QUESTIONS: [1-2 new questions for tomorrow, one per line, starting with -]`;

      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        temperature: 0.8,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        return null;
      }

      const text = content.text.trim();

      // Parse structured response
      const titleMatch = text.match(/TITLE:\s*(.+?)(?:\n|$)/);
      const contentMatch = text.match(/CONTENT:\s*([\s\S]+?)(?=\nINSIGHTS:|$)/);
      const insightsMatch = text.match(/INSIGHTS:\s*([\s\S]+?)(?=\nQUESTIONS:|$)/);
      const questionsMatch = text.match(/QUESTIONS:\s*([\s\S]+?)$/);

      const insights = insightsMatch
        ? insightsMatch[1].split('\n').filter((l) => l.trim().startsWith('-')).map((l) => l.replace(/^-\s*/, '').trim())
        : [];

      const questions = questionsMatch
        ? questionsMatch[1].split('\n').filter((l) => l.trim().startsWith('-')).map((l) => l.replace(/^-\s*/, '').trim())
        : [];

      return {
        title: titleMatch?.[1]?.trim() || 'Dream Session',
        content: contentMatch?.[1]?.trim() || text,
        insights,
        questions,
      };
    } catch (error: any) {
      logger.error('[DREAM SESSION] Error generating dream', { error: error.message });
      return null;
    }
  }

  /**
   * Update LUCID's self-awareness state with insights from the dream
   */
  private async updateLucidState(
    userId: string,
    insights: string[],
    questions: string[]
  ): Promise<void> {
    try {
      // Add new insights
      for (const insight of insights) {
        await this.lucidStateService.addInsight(userId, insight);
      }

      // Add new questions
      for (const question of questions) {
        await this.lucidStateService.addQuestion(userId, question);
      }

      logger.debug('[DREAM SESSION] Updated LUCID state', {
        userId,
        insightCount: insights.length,
        questionCount: questions.length,
      });
    } catch (error) {
      logger.warn('[DREAM SESSION] Error updating LUCID state', { error });
    }
  }

  /**
   * Store the dream in the library
   */
  private async storeInLibrary(
    userId: string,
    dream: { title: string; content: string; insights: string[]; questions: string[] }
  ): Promise<LibraryEntry> {
    // Generate embedding
    let embedding: number[] | null = null;
    try {
      const textForEmbedding = `${dream.title} ${dream.content}`.trim();
      embedding = await this.vectorService.generateEmbedding(textForEmbedding);
    } catch (embeddingError) {
      logger.warn('[DREAM SESSION] Failed to generate embedding', { error: embeddingError });
    }

    const embeddingString = embedding ? `[${embedding.join(',')}]` : null;

    const result = await this.pool.query(
      `INSERT INTO library_entries
       (user_id, entry_type, title, content, time_of_day, session_type, metadata, embedding)
       VALUES ($1, 'dream', $2, $3, 'night', 'dream_session', $4, $5::vector)
       RETURNING id, user_id, entry_type, title, content, session_type, created_at`,
      [
        userId,
        dream.title,
        dream.content,
        JSON.stringify({
          generated_at: new Date().toISOString(),
          insights: dream.insights,
          questions: dream.questions,
        }),
        embeddingString,
      ]
    );

    return result.rows[0];
  }
}

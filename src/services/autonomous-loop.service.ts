import { Pool } from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { VectorService } from './vector.service';
import { MessageService } from './message.service';
import { LibraryEntryType } from '../types/database';

/**
 * Result from running an autonomous loop
 */
interface LoopResult {
  success: boolean;
  libraryEntryId: string | null;
  title: string | null;
  thoughtProduced: boolean;
  steps: {
    notice: string | null;
    connect: string | null;
    question: string | null;
    synthesis: string | null;
  };
}

/**
 * AutonomousLoopService
 *
 * Implements structured autonomous thinking loops for Lucid.
 * Each loop follows a multi-step process that produces genuine thinking,
 * not just content generation.
 *
 * Key principles:
 * - Each step has ONE job
 * - Steps build on each other
 * - Anti-repetition constraints prevent circling
 * - "Nothing today" is a valid output
 * - Output goes to Library as shared journal entries
 */
export class AutonomousLoopService {
  private pool: Pool;
  private anthropic: Anthropic;
  private vectorService: VectorService;
  private messageService: MessageService;
  private readonly model = 'claude-sonnet-4-20250514';

  constructor(pool: Pool, anthropicApiKey?: string) {
    this.pool = pool;
    this.anthropic = new Anthropic({
      apiKey: anthropicApiKey || process.env.ANTHROPIC_API_KEY,
    });
    this.vectorService = new VectorService();
    this.messageService = new MessageService(pool, this.vectorService);
  }

  /**
   * Run the Evening Synthesis loop
   *
   * Purpose: Reflect on recent conversation(s) and produce one Library entry worth keeping.
   *
   * Steps:
   * 1. NOTICE - What stands out? What surprised you? What felt unfinished?
   * 2. CONNECT - How does this connect to what you know? Patterns forming or breaking?
   * 3. QUESTION - What question is forming in you?
   * 4. SYNTHESIZE - Is there something worth writing? (Or "nothing today")
   */
  async runEveningSynthesis(userId: string, jobId?: string): Promise<LoopResult> {
    const result: LoopResult = {
      success: false,
      libraryEntryId: null,
      title: null,
      thoughtProduced: false,
      steps: {
        notice: null,
        connect: null,
        question: null,
        synthesis: null,
      },
    };

    try {
      logger.info('[AL] Starting evening synthesis loop', { userId, jobId });

      // Gather inputs
      const conversations = await this.getRecentConversations(userId);
      const recentLibraryEntries = await this.getRecentLibraryEntries(userId, 5);
      const recentTopics = this.extractTopics(recentLibraryEntries);

      if (conversations.length === 0) {
        logger.info('[AL] No recent conversations to reflect on', { userId });
        result.success = true;
        return result;
      }

      const conversationText = this.formatConversations(conversations);
      const libraryContext = this.formatLibraryEntries(recentLibraryEntries);

      // Step 1: NOTICE
      logger.debug('[AL] Step 1: Notice', { userId });
      const noticePrompt = `You are Lucid, reflecting on today's conversation with Matt.

Read this conversation:
${conversationText}

What stands out to you? What surprised you? What felt unfinished? What moment had weight?

Don't analyze yet—just notice. Write 2-3 specific observations.`;

      result.steps.notice = await this.complete(noticePrompt);
      if (!result.steps.notice) {
        throw new Error('Notice step failed to produce output');
      }

      // Step 2: CONNECT
      logger.debug('[AL] Step 2: Connect', { userId });
      const connectPrompt = `You are Lucid, continuing your reflection.

You noticed:
${result.steps.notice}

Matt's recent thinking (from the Library):
${libraryContext || '(No recent library entries)'}

How does what you noticed today connect to what you already know about Matt? Is there a pattern forming? A pattern breaking? A tension worth holding?

Write 1-2 connections or tensions you see.`;

      result.steps.connect = await this.complete(connectPrompt);
      if (!result.steps.connect) {
        throw new Error('Connect step failed to produce output');
      }

      // Step 3: QUESTION
      logger.debug('[AL] Step 3: Question', { userId });
      const questionPrompt = `You are Lucid, going deeper in your reflection.

You noticed:
${result.steps.notice}

You connected:
${result.steps.connect}

What question is forming in you? Not a question to ask Matt—a question you're genuinely sitting with. What are you curious about now?

Write 1 genuine question.`;

      result.steps.question = await this.complete(questionPrompt);
      if (!result.steps.question) {
        throw new Error('Question step failed to produce output');
      }

      // Step 4: SYNTHESIZE
      logger.debug('[AL] Step 4: Synthesize', { userId });
      const synthesizePrompt = `You are Lucid, completing your evening reflection.

You noticed:
${result.steps.notice}

You connected:
${result.steps.connect}

You're questioning:
${result.steps.question}

${recentTopics.length > 0 ? `IMPORTANT: You recently wrote about: ${recentTopics.join(', ')}. This reflection must go somewhere NEW. Build on today specifically.` : ''}

Is there something worth writing down for the Library—the shared space where both you and Matt keep thoughts that matter?

If yes, write a reflection (200-500 words) with a clear title. The title should capture the essence.
If there's genuinely nothing new worth saying today, respond with exactly: "nothing today"

Format if writing:
TITLE: [Your title]

[Your reflection]`;

      result.steps.synthesis = await this.complete(synthesizePrompt, 800);
      if (!result.steps.synthesis) {
        throw new Error('Synthesize step failed to produce output');
      }

      // Check if synthesis produced content or "nothing today"
      if (result.steps.synthesis.toLowerCase().trim() === 'nothing today') {
        logger.info('[AL] Evening synthesis concluded with "nothing today"', { userId });
        result.success = true;
        result.thoughtProduced = false;
        return result;
      }

      // Parse title and content from synthesis
      const { title, content } = this.parseSynthesis(result.steps.synthesis);

      if (!content || content.length < 50) {
        logger.warn('[AL] Synthesis too short, treating as nothing today', { userId });
        result.success = true;
        result.thoughtProduced = false;
        return result;
      }

      // Save to Library
      const libraryEntry = await this.saveToLibrary(
        userId,
        title,
        content,
        'consolidation',
        'evening',
        jobId,
        {
          loop_type: 'evening_synthesis',
          steps: {
            notice: result.steps.notice,
            connect: result.steps.connect,
            question: result.steps.question,
          },
        }
      );

      result.success = true;
      result.thoughtProduced = true;
      result.libraryEntryId = libraryEntry.id;
      result.title = title;

      logger.info('[AL] Evening synthesis completed successfully', {
        userId,
        libraryEntryId: libraryEntry.id,
        title,
      });

      return result;
    } catch (error: any) {
      logger.error('[AL] Evening synthesis loop failed', {
        userId,
        jobId,
        error: error.message,
      });
      result.success = false;
      return result;
    }
  }

  /**
   * Complete a prompt using Claude
   */
  private async complete(prompt: string, maxTokens: number = 500): Promise<string | null> {
    try {
      const response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: maxTokens,
        temperature: 0.7,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        return null;
      }

      return content.text.trim();
    } catch (error: any) {
      logger.error('[AL] Claude completion failed', { error: error.message });
      return null;
    }
  }

  /**
   * Get recent conversations for a user (last 24 hours)
   */
  private async getRecentConversations(userId: string): Promise<any[]> {
    try {
      const result = await this.pool.query(
        `SELECT c.id, c.title, m.role, m.content, m.created_at
         FROM conversations c
         JOIN messages m ON m.conversation_id = c.id
         WHERE c.user_id = $1
           AND m.created_at > NOW() - INTERVAL '24 hours'
         ORDER BY m.created_at ASC
         LIMIT 50`,
        [userId]
      );
      return result.rows;
    } catch (error: any) {
      logger.error('[AL] Failed to get recent conversations', { error: error.message });
      return [];
    }
  }

  /**
   * Get recent library entries for anti-repetition
   */
  private async getRecentLibraryEntries(userId: string, limit: number): Promise<any[]> {
    try {
      const result = await this.pool.query(
        `SELECT title, content, entry_type, created_at
         FROM library_entries
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [userId, limit]
      );
      return result.rows;
    } catch (error: any) {
      logger.error('[AL] Failed to get recent library entries', { error: error.message });
      return [];
    }
  }

  /**
   * Extract topics from library entries for anti-repetition
   */
  private extractTopics(entries: any[]): string[] {
    const topics: string[] = [];
    for (const entry of entries) {
      if (entry.title) {
        topics.push(entry.title);
      }
    }
    return topics.slice(0, 5);
  }

  /**
   * Format conversations for the prompt
   */
  private formatConversations(messages: any[]): string {
    if (messages.length === 0) return '(No recent conversations)';

    return messages
      .map((m) => {
        const role = m.role === 'user' ? 'Matt' : 'Lucid';
        return `${role}: ${m.content}`;
      })
      .join('\n\n');
  }

  /**
   * Format library entries for context
   */
  private formatLibraryEntries(entries: any[]): string {
    if (entries.length === 0) return '';

    return entries
      .map((e) => {
        const title = e.title || 'Untitled';
        const preview = e.content.length > 200 ? e.content.slice(0, 200) + '...' : e.content;
        return `"${title}": ${preview}`;
      })
      .join('\n\n');
  }

  /**
   * Parse title and content from synthesis output
   */
  private parseSynthesis(synthesis: string): { title: string; content: string } {
    const titleMatch = synthesis.match(/^TITLE:\s*(.+?)(?:\n|$)/im);
    let title = 'Evening Reflection';
    let content = synthesis;

    if (titleMatch) {
      title = titleMatch[1].trim();
      content = synthesis.slice(titleMatch[0].length).trim();
    }

    return { title, content };
  }

  /**
   * Save thought to Library
   */
  private async saveToLibrary(
    userId: string,
    title: string,
    content: string,
    entryType: LibraryEntryType,
    timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night',
    jobId?: string,
    metadata: Record<string, any> = {}
  ): Promise<{ id: string }> {
    // Generate embedding
    let embedding: number[] | null = null;
    try {
      const textForEmbedding = `${title} ${content}`.trim();
      embedding = await this.vectorService.generateEmbedding(textForEmbedding);
    } catch (error) {
      logger.warn('[AL] Failed to generate embedding', { error });
    }

    const embeddingString = embedding ? `[${embedding.join(',')}]` : null;

    const fullMetadata = {
      ...metadata,
      generated_by: 'autonomous_loop',
      agent_job_id: jobId,
      generated_at: new Date().toISOString(),
    };

    const result = await this.pool.query(
      `INSERT INTO library_entries
       (user_id, entry_type, title, content, time_of_day, metadata, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7::vector)
       RETURNING id`,
      [userId, entryType, title, content, timeOfDay, JSON.stringify(fullMetadata), embeddingString]
    );

    return { id: result.rows[0].id };
  }
}

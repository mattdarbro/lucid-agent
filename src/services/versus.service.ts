import { Pool } from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { VectorService } from './vector.service';

/**
 * Versus session structure
 */
interface VersusSession {
  id: string;
  user_id: string;
  topic: string;
  lu_position: string;
  cid_position: string;
  status: 'active' | 'completed' | 'abandoned';
  created_at: Date;
  completed_at: Date | null;
  summary: string | null;
  library_entry_id: string | null;
}

/**
 * Versus message structure
 */
interface VersusMessage {
  id: string;
  session_id: string;
  speaker: 'lu' | 'cid' | 'user';
  content: string;
  addressed_to: 'lu' | 'cid' | null;
  created_at: Date;
}

/**
 * Library entry structure
 */
interface LibraryEntry {
  id: string;
  title: string;
  content: string;
}

/**
 * VersusService
 *
 * Manages Lu vs Cid debate sessions.
 * Key LUCID principle: Structured debate beats simple pros/cons lists.
 *
 * Lu and Cid represent two voices arguing different positions,
 * helping the user think through complex decisions.
 */
export class VersusService {
  private pool: Pool;
  private anthropic: Anthropic;
  private vectorService: VectorService;
  private readonly model = 'claude-sonnet-4-20250514';

  constructor(pool: Pool, anthropicApiKey?: string) {
    this.pool = pool;
    this.anthropic = new Anthropic({
      apiKey: anthropicApiKey || process.env.ANTHROPIC_API_KEY,
    });
    this.vectorService = new VectorService();
  }

  /**
   * Start a new debate session
   *
   * Lu opens with the first argument.
   */
  async startSession(
    userId: string,
    topic: string,
    luPosition: string,
    cidPosition: string
  ): Promise<{ session: VersusSession; openingMessage: VersusMessage }> {
    // Create the session
    const sessionResult = await this.pool.query(
      `INSERT INTO versus_sessions (user_id, topic, lu_position, cid_position)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userId, topic, luPosition, cidPosition]
    );

    const session = sessionResult.rows[0] as VersusSession;

    // Generate Lu's opening argument
    const luOpening = await this.generateArgument(session, 'lu', []);

    // Save Lu's opening message
    const messageResult = await this.pool.query(
      `INSERT INTO versus_messages (session_id, speaker, content, addressed_to)
       VALUES ($1, 'lu', $2, NULL)
       RETURNING id, session_id, speaker, content,
                 COALESCE(addressed_to, '') as addressed_to,
                 created_at`,
      [session.id, luOpening]
    );

    const openingMessage = messageResult.rows[0] as VersusMessage;

    logger.info('Versus: Opening message created', {
      sessionId: session.id,
      messageId: openingMessage?.id,
      hasContent: !!openingMessage?.content,
    });

    logger.info('Versus session started', {
      session_id: session.id,
      user_id: userId,
      topic,
    });

    return { session, openingMessage };
  }

  /**
   * Continue a debate session
   *
   * User can speak (optional), then the next AI speaker responds.
   */
  async continueSession(
    sessionId: string,
    userMessage: string | null,
    addressedTo: 'lu' | 'cid' | null
  ): Promise<{ userMessage: VersusMessage | null; aiMessage: VersusMessage }> {
    const session = await this.getSession(sessionId);

    if (!session) {
      throw new Error('Session not found');
    }

    if (session.status !== 'active') {
      throw new Error('Session is not active');
    }

    const history = await this.getMessages(sessionId);

    let savedUserMessage: VersusMessage | null = null;

    // Save user message if provided
    if (userMessage) {
      const userResult = await this.pool.query(
        `INSERT INTO versus_messages (session_id, speaker, content, addressed_to)
         VALUES ($1, 'user', $2, $3)
         RETURNING id, session_id, speaker, content,
                   COALESCE(addressed_to, '') as addressed_to,
                   created_at`,
        [sessionId, userMessage, addressedTo || null]
      );
      savedUserMessage = userResult.rows[0] as VersusMessage;
      history.push(savedUserMessage);
    }

    // Determine next speaker
    const lastAiMessage = [...history].reverse().find((m) => m.speaker !== 'user');
    let nextSpeaker: 'lu' | 'cid';

    if (addressedTo) {
      // User addressed someone specifically
      nextSpeaker = addressedTo;
    } else if (lastAiMessage) {
      // Alternate between Lu and Cid
      nextSpeaker = lastAiMessage.speaker === 'lu' ? 'cid' : 'lu';
    } else {
      // Default to Lu
      nextSpeaker = 'lu';
    }

    logger.info('Versus: Generating response', {
      sessionId,
      nextSpeaker,
      historyLength: history.length,
      lastSpeaker: lastAiMessage?.speaker,
    });

    // Generate AI response
    const aiContent = await this.generateArgument(session, nextSpeaker, history);

    logger.info('Versus: Generated content', {
      sessionId,
      speaker: nextSpeaker,
      contentLength: aiContent?.length,
      contentPreview: aiContent?.substring(0, 100),
    });

    // Save AI message
    const aiResult = await this.pool.query(
      `INSERT INTO versus_messages (session_id, speaker, content, addressed_to)
       VALUES ($1, $2, $3, NULL)
       RETURNING id, session_id, speaker, content,
                 COALESCE(addressed_to, '') as addressed_to,
                 created_at`,
      [sessionId, nextSpeaker, aiContent]
    );

    const aiMessage = aiResult.rows[0] as VersusMessage;

    logger.info('Versus: AI message saved', {
      session_id: sessionId,
      speaker: nextSpeaker,
      messageId: aiMessage?.id,
      hasContent: !!aiMessage?.content,
      rawRow: JSON.stringify(aiResult.rows[0]),
    });

    return { userMessage: savedUserMessage, aiMessage };
  }

  /**
   * End a debate session and generate synthesis
   *
   * Creates a summary and saves it to the Library.
   */
  async endSession(sessionId: string): Promise<LibraryEntry> {
    const session = await this.getSession(sessionId);

    if (!session) {
      throw new Error('Session not found');
    }

    const history = await this.getMessages(sessionId);

    // Generate synthesis
    const synthesis = await this.generateSynthesis(session, history);

    // Generate embedding for Library entry
    let embedding: number[] | null = null;
    try {
      const textForEmbedding = `Debate: ${session.topic} ${synthesis}`;
      embedding = await this.vectorService.generateEmbedding(textForEmbedding);
    } catch (error) {
      logger.warn('Failed to generate embedding for versus synthesis:', error);
    }

    const embeddingString = embedding ? `[${embedding.join(',')}]` : null;

    // Save to Library as versus_synthesis
    const libraryResult = await this.pool.query(
      `INSERT INTO library_entries
       (user_id, entry_type, title, content, time_of_day, metadata, embedding)
       VALUES ($1, 'versus_synthesis', $2, $3, $4, $5, $6::vector)
       RETURNING id, title, content`,
      [
        session.user_id,
        `Debate: ${session.topic}`,
        synthesis,
        this.getCurrentTimeOfDay(),
        JSON.stringify({
          versus_session_id: sessionId,
          lu_position: session.lu_position,
          cid_position: session.cid_position,
        }),
        embeddingString,
      ]
    );

    const libraryEntry = libraryResult.rows[0] as LibraryEntry;

    // Update session as completed
    await this.pool.query(
      `UPDATE versus_sessions
       SET status = 'completed', completed_at = NOW(),
           summary = $1, library_entry_id = $2
       WHERE id = $3`,
      [synthesis, libraryEntry.id, sessionId]
    );

    logger.info('Versus session completed', {
      session_id: sessionId,
      library_entry_id: libraryEntry.id,
    });

    return libraryEntry;
  }

  /**
   * Abandon a session without synthesis
   */
  async abandonSession(sessionId: string): Promise<void> {
    await this.pool.query(
      `UPDATE versus_sessions
       SET status = 'abandoned', completed_at = NOW()
       WHERE id = $1`,
      [sessionId]
    );

    logger.info('Versus session abandoned', { session_id: sessionId });
  }

  /**
   * Get a session by ID
   */
  async getSession(sessionId: string): Promise<VersusSession | null> {
    const result = await this.pool.query(
      `SELECT * FROM versus_sessions WHERE id = $1`,
      [sessionId]
    );
    return result.rows[0] || null;
  }

  /**
   * Get all messages for a session
   */
  async getMessages(sessionId: string): Promise<VersusMessage[]> {
    const result = await this.pool.query(
      `SELECT id, session_id, speaker, content,
              COALESCE(addressed_to, '') as addressed_to,
              created_at
       FROM versus_messages
       WHERE session_id = $1
       ORDER BY created_at ASC`,
      [sessionId]
    );
    return result.rows;
  }

  /**
   * Get active sessions for a user
   */
  async getActiveSessions(userId: string): Promise<VersusSession[]> {
    const result = await this.pool.query(
      `SELECT * FROM versus_sessions
       WHERE user_id = $1 AND status = 'active'
       ORDER BY created_at DESC`,
      [userId]
    );
    return result.rows;
  }

  /**
   * Get all sessions for a user
   */
  async getUserSessions(
    userId: string,
    limit: number = 20,
    includeAbandoned: boolean = false
  ): Promise<VersusSession[]> {
    let query = `SELECT * FROM versus_sessions WHERE user_id = $1`;

    if (!includeAbandoned) {
      query += ` AND status != 'abandoned'`;
    }

    query += ` ORDER BY created_at DESC LIMIT $2`;

    const result = await this.pool.query(query, [userId, limit]);
    return result.rows;
  }

  /**
   * Generate an argument for Lu or Cid
   */
  private async generateArgument(
    session: VersusSession,
    speaker: 'lu' | 'cid',
    history: VersusMessage[]
  ): Promise<string> {
    const position = speaker === 'lu' ? session.lu_position : session.cid_position;
    const otherName = speaker === 'lu' ? 'Cid' : 'Lu';
    const myName = speaker === 'lu' ? 'Lu' : 'Cid';

    const historyText =
      history.length > 0
        ? history
            .map((m) => {
              const name = m.speaker === 'lu' ? 'Lu' : m.speaker === 'cid' ? 'Cid' : 'User';
              return `${name}: ${m.content}`;
            })
            .join('\n\n')
        : '(This is your opening statement)';

    const prompt = `You are ${myName} in a debate with ${otherName}. A user is watching to help them think through a decision.

Topic: ${session.topic}
YOUR position: ${position}
${otherName}'s position: ${speaker === 'lu' ? session.cid_position : session.lu_position}

Debate so far:
${historyText}

Rules for ${myName}:
- Argue YOUR position persuasively but fairly
- If someone just spoke, respond to what they said
- Be conversational, not preachy
- 2-4 sentences max
- Make ONE clear point
- Acknowledge good counterpoints, then pivot
- Stay focused on helping the user think, not "winning"

Your response as ${myName}:`;

    try {
      const response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: 300,
        temperature: 0.7,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type');
      }

      return content.text.trim();
    } catch (error: any) {
      logger.error(`Error generating ${speaker} argument:`, error);
      throw new Error(`Failed to generate ${speaker}'s response`);
    }
  }

  /**
   * Generate synthesis after debate ends
   */
  private async generateSynthesis(
    session: VersusSession,
    history: VersusMessage[]
  ): Promise<string> {
    const historyText = history
      .map((m) => {
        const name = m.speaker === 'lu' ? 'Lu' : m.speaker === 'cid' ? 'Cid' : 'User';
        return `${name}: ${m.content}`;
      })
      .join('\n\n');

    const prompt = `You've just facilitated a debate between Lu and Cid to help a user think through a decision.

Topic: ${session.topic}
Lu's position: ${session.lu_position}
Cid's position: ${session.cid_position}

Full debate:
${historyText}

Write a synthesis that:
1. Acknowledges the strongest points from BOTH sides
2. Identifies where they agreed or found common ground
3. Notes key tensions or trade-offs that remain
4. Offers a balanced perspective (not picking a "winner")
5. Ends with a thought-provoking question for the user

Write in first person as Lucid (not Lu or Cid). Be thorough but concise (300-500 words).`;

    try {
      const response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: 1000,
        temperature: 0.6,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type');
      }

      return content.text.trim();
    } catch (error: any) {
      logger.error('Error generating synthesis:', error);
      throw new Error('Failed to generate debate synthesis');
    }
  }

  /**
   * Get current time of day
   */
  private getCurrentTimeOfDay(): string {
    const hour = new Date().getHours();
    if (hour < 12) return 'morning';
    if (hour < 17) return 'afternoon';
    if (hour < 21) return 'evening';
    return 'night';
  }
}

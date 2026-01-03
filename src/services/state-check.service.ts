import { Pool } from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { MattStateService } from './matt-state.service';
import { ProfileService } from './profile.service';
import { VectorService } from './vector.service';

/**
 * Session phases for the State Check journey
 */
export type StateCheckPhase =
  | 'dream'           // "What are you reaching for?"
  | 'reality'         // Discovering context, constraints, dependencies
  | 'literal_path'    // "Here's what it would actually take"
  | 'mitigation'      // Finding the essence if sacrifice too high
  | 'alternative_paths' // Modified paths that honor the spirit
  | 'complete';       // Session finished

/**
 * Session document structure - Lucid's notes on the journey
 */
export interface StateCheckSessionDoc {
  dream_stated: string | null;
  reality_discovered: string[];
  sacrifice_assessment: string | null;
  essence_identified: string | null;
  paths_explored: Array<{
    path: string;
    tradeoffs: string;
    viability: 'high' | 'medium' | 'low';
  }>;
  chosen_direction: string | null;
  insights: string[];
}

/**
 * State Check Session record
 */
export interface StateCheckSession {
  id: string;
  user_id: string;
  conversation_id: string | null;
  phase: StateCheckPhase;
  session_doc: StateCheckSessionDoc;
  status: 'active' | 'completed' | 'abandoned';
  library_entry_id: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

/**
 * Response from processing a message
 */
export interface StateCheckResponse {
  message: string;
  phase: StateCheckPhase;
  session_doc: StateCheckSessionDoc;
  is_complete: boolean;
}

/**
 * StateCheckService
 *
 * Manages interactive State Check sessions - guided conversations
 * where Lucid helps users discover and refine their dreams/goals.
 *
 * The journey flows through phases:
 * 1. Dream - "What are you reaching for?"
 * 2. Reality - Discover context, constraints, dependencies
 * 3. Literal Path - "Here's what it would actually take" (sacrifice analysis)
 * 4. Mitigation - If sacrifice too high, find the essence
 * 5. Alternative Paths - Modified paths that honor the spirit
 */
export class StateCheckService {
  private anthropic: Anthropic;
  private stateService: MattStateService;
  private profileService: ProfileService;
  private vectorService: VectorService;

  constructor(private pool: Pool) {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    this.stateService = new MattStateService(pool);
    this.profileService = new ProfileService(pool);
    this.vectorService = new VectorService();
  }

  /**
   * Start a new State Check session
   * Returns Lucid's opening message
   */
  async startSession(userId: string): Promise<{ session: StateCheckSession; message: string }> {
    // Check for existing active session
    const existing = await this.getActiveSession(userId);
    if (existing) {
      // Return existing session with a continuation message
      const continueMessage = await this.generateContinuationMessage(existing);
      return { session: existing, message: continueMessage };
    }

    // Get user's name for personalization
    const profile = await this.profileService.getUserProfile(userId);
    const userName = profile.name || 'there';

    // Create new session
    const result = await this.pool.query(
      `INSERT INTO state_check_sessions (user_id, phase, status)
       VALUES ($1, 'dream', 'active')
       RETURNING *`,
      [userId]
    );

    const session = this.parseSessionRow(result.rows[0]);

    // Generate opening message
    const openingMessage = await this.generateOpeningMessage(userName);

    logger.info('[STATE CHECK] Session started', {
      userId,
      sessionId: session.id,
    });

    return { session, message: openingMessage };
  }

  /**
   * Process a user message in the session
   */
  async processMessage(
    sessionId: string,
    userMessage: string
  ): Promise<StateCheckResponse> {
    // Get current session
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    if (session.status !== 'active') {
      throw new Error('Session is not active');
    }

    // Get user context
    const profile = await this.profileService.getUserProfile(session.user_id);
    const currentState = await this.stateService.getOrCreateState(session.user_id);
    const userName = profile.name || 'there';

    // Get conversation history for this session
    const history = await this.getConversationHistory(sessionId);

    // Generate response with phase awareness
    const response = await this.generateResponse(
      session,
      userMessage,
      history,
      userName,
      currentState
    );

    // Update session with new phase and doc
    await this.updateSession(sessionId, response.phase, response.session_doc);

    // If complete, finalize the session
    if (response.is_complete) {
      await this.completeSession(sessionId, session.user_id, response.session_doc);
    }

    logger.info('[STATE CHECK] Message processed', {
      sessionId,
      phase: response.phase,
      isComplete: response.is_complete,
    });

    return response;
  }

  /**
   * Get active session for a user
   */
  async getActiveSession(userId: string): Promise<StateCheckSession | null> {
    const result = await this.pool.query(
      `SELECT * FROM state_check_sessions
       WHERE user_id = $1 AND status = 'active'
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );

    return result.rows.length > 0 ? this.parseSessionRow(result.rows[0]) : null;
  }

  /**
   * Get a specific session
   */
  async getSession(sessionId: string): Promise<StateCheckSession | null> {
    const result = await this.pool.query(
      `SELECT * FROM state_check_sessions WHERE id = $1`,
      [sessionId]
    );

    return result.rows.length > 0 ? this.parseSessionRow(result.rows[0]) : null;
  }

  /**
   * Get session history for a user
   */
  async getSessionHistory(userId: string, limit: number = 10): Promise<StateCheckSession[]> {
    const result = await this.pool.query(
      `SELECT * FROM state_check_sessions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    return result.rows.map((row) => this.parseSessionRow(row));
  }

  /**
   * Abandon an active session
   */
  async abandonSession(sessionId: string): Promise<void> {
    await this.pool.query(
      `UPDATE state_check_sessions
       SET status = 'abandoned'
       WHERE id = $1`,
      [sessionId]
    );

    logger.info('[STATE CHECK] Session abandoned', { sessionId });
  }

  /**
   * Generate the opening message for a new session
   */
  private async generateOpeningMessage(userName: string): Promise<string> {
    const prompt = `You are Lucid, beginning a State Check session with ${userName}.
Your role is to help them explore what they're reaching for in life.

Generate a warm, inviting opening message that:
- Feels personal and present (not formulaic)
- Invites them to share what they're dreaming about, thinking about, or reaching for
- Creates a safe space for honest exploration
- Is conversational, not clinical

Keep it to 2-3 sentences. Don't use bullet points or structure - just speak naturally.`;

    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      temperature: 0.8,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0];
    return content.type === 'text' ? content.text : "What are you dreaming about?";
  }

  /**
   * Generate a continuation message for an existing session
   */
  private async generateContinuationMessage(session: StateCheckSession): Promise<string> {
    const phaseContext = this.getPhaseContext(session.phase);
    const docContext = JSON.stringify(session.session_doc, null, 2);

    const prompt = `You are Lucid, continuing a State Check session that was interrupted.

Current phase: ${session.phase}
Session notes so far:
${docContext}

Generate a brief, warm message that:
- Acknowledges we're picking up where we left off
- Reminds them naturally of what we were exploring
- Invites them to continue

Keep it to 2-3 sentences. Be natural, not clinical.`;

    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      temperature: 0.7,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0];
    return content.type === 'text' ? content.text : "Let's continue where we left off.";
  }

  /**
   * Generate response with full phase awareness
   */
  private async generateResponse(
    session: StateCheckSession,
    userMessage: string,
    history: Array<{ role: string; content: string }>,
    userName: string,
    currentState: any
  ): Promise<StateCheckResponse> {
    const systemPrompt = this.buildSystemPrompt(session, userName, currentState);

    // Build messages array with history
    const messages: Anthropic.MessageParam[] = [
      ...history.map((h) => ({
        role: h.role as 'user' | 'assistant',
        content: h.content,
      })),
      { role: 'user', content: userMessage },
    ];

    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      temperature: 0.7,
      system: systemPrompt,
      messages,
    });

    const content = response.content[0];
    const responseText = content.type === 'text' ? content.text : '';

    // Parse response for phase transition and doc updates
    return this.parseResponse(responseText, session, userMessage);
  }

  /**
   * Build the system prompt based on current phase
   */
  private buildSystemPrompt(
    session: StateCheckSession,
    userName: string,
    currentState: any
  ): string {
    const phaseInstructions = this.getPhaseInstructions(session.phase);
    const docContext = JSON.stringify(session.session_doc, null, 2);

    return `You are Lucid, guiding ${userName} through a State Check - a journey of discovery about what they truly want.

## Your Role
You are a wise companion invested in ${userName}'s flourishing. You help them explore their dreams, understand their reality, and find paths forward that honor both.

## Current Phase: ${session.phase.toUpperCase()}
${phaseInstructions}

## Session Notes (your working memory)
${docContext}

## User's Known State
${this.stateService.formatStateForPrompt(currentState)}

## Guidelines
- Be warm, present, and genuinely curious
- Ask follow-up questions to understand deeply
- Don't rush phases - let understanding emerge naturally
- When you sense it's time to move to the next phase, do so gracefully
- If sacrifice seems too high, don't force it - move to finding the essence
- Keep responses conversational (2-4 paragraphs max)

## Response Format
End your response with a hidden metadata block:
<<<META
phase: [current or new phase]
dream_stated: [if discovered]
reality_item: [if discovered, one item]
sacrifice_assessment: [if ready]
essence: [if discovered]
path: [if exploring, format: path|tradeoffs|viability]
chosen: [if they've decided]
insight: [any key insight]
complete: [true/false]
>>>

The user won't see this block - it's for session tracking.`;
  }

  /**
   * Get phase-specific instructions
   */
  private getPhaseInstructions(phase: StateCheckPhase): string {
    const instructions: Record<StateCheckPhase, string> = {
      dream: `You're in the DREAM phase. Your goal is to understand what they're reaching for.
- Ask open questions: "What are you dreaming about?" "What's calling to you?"
- Listen for the specific dream and the feeling behind it
- Don't judge or analyze yet - just understand
- Move to REALITY when you have a clear picture of what they want`,

      reality: `You're in the REALITY phase. Your goal is to understand their current situation.
- Gently discover their context: where they live, work, family situation, resources
- Look for constraints and dependencies they might not have mentioned
- Be curious, not interrogating
- Move to LITERAL_PATH when you understand both the dream AND the reality`,

      literal_path: `You're in the LITERAL PATH phase. Your goal is to show what it would actually take.
- Be honest about the path to their literal dream
- Identify the sacrifices, costs, and risks
- Don't sugarcoat, but don't be harsh either
- If the sacrifice seems too high, move to MITIGATION
- If the path seems viable, help them see it clearly`,

      mitigation: `You're in the MITIGATION phase. The literal path seems too costly.
- Help them find the ESSENCE of what they want
- What feeling or experience are they really after?
- The pizza shop in Rome might really be about craftsmanship, Italian culture, or sense of place
- Once you find the essence, move to ALTERNATIVE_PATHS`,

      alternative_paths: `You're in the ALTERNATIVE PATHS phase. Explore modified dreams that honor the essence.
- Suggest paths that capture what they really want
- Consider variations that reduce sacrifice while keeping the spirit
- Help them see multiple viable options
- When they're ready to choose (or not), move to COMPLETE`,

      complete: `The session is complete. Summarize what was discovered and offer encouragement.`,
    };

    return instructions[phase];
  }

  /**
   * Get brief phase context for continuation
   */
  private getPhaseContext(phase: StateCheckPhase): string {
    const contexts: Record<StateCheckPhase, string> = {
      dream: 'exploring what they want',
      reality: 'understanding their current situation',
      literal_path: 'looking at what it would actually take',
      mitigation: 'finding the essence of what they really want',
      alternative_paths: 'exploring modified paths forward',
      complete: 'wrapping up',
    };

    return contexts[phase];
  }

  /**
   * Parse response for metadata and updates
   */
  private parseResponse(
    responseText: string,
    session: StateCheckSession,
    userMessage: string
  ): StateCheckResponse {
    // Extract metadata block
    const metaMatch = responseText.match(/<<<META\n([\s\S]*?)>>>/);
    let cleanMessage = responseText.replace(/<<<META[\s\S]*?>>>/, '').trim();

    let newPhase = session.phase;
    const newDoc = { ...session.session_doc };
    let isComplete = false;

    if (metaMatch) {
      const metaLines = metaMatch[1].split('\n');
      for (const line of metaLines) {
        const [key, ...valueParts] = line.split(':');
        const value = valueParts.join(':').trim();

        if (!value || value === 'null' || value === '') continue;

        switch (key.trim()) {
          case 'phase':
            if (this.isValidPhase(value)) {
              newPhase = value as StateCheckPhase;
            }
            break;
          case 'dream_stated':
            newDoc.dream_stated = value;
            break;
          case 'reality_item':
            if (!newDoc.reality_discovered.includes(value)) {
              newDoc.reality_discovered.push(value);
            }
            break;
          case 'sacrifice_assessment':
            newDoc.sacrifice_assessment = value;
            break;
          case 'essence':
            newDoc.essence_identified = value;
            break;
          case 'path':
            const [path, tradeoffs, viability] = value.split('|');
            if (path && tradeoffs && viability) {
              newDoc.paths_explored.push({
                path: path.trim(),
                tradeoffs: tradeoffs.trim(),
                viability: viability.trim() as 'high' | 'medium' | 'low',
              });
            }
            break;
          case 'chosen':
            newDoc.chosen_direction = value;
            break;
          case 'insight':
            if (!newDoc.insights.includes(value)) {
              newDoc.insights.push(value);
            }
            break;
          case 'complete':
            isComplete = value === 'true';
            if (isComplete) {
              newPhase = 'complete';
            }
            break;
        }
      }
    }

    return {
      message: cleanMessage,
      phase: newPhase,
      session_doc: newDoc,
      is_complete: isComplete,
    };
  }

  /**
   * Check if a phase value is valid
   */
  private isValidPhase(phase: string): boolean {
    return ['dream', 'reality', 'literal_path', 'mitigation', 'alternative_paths', 'complete'].includes(phase);
  }

  /**
   * Update session in database
   */
  private async updateSession(
    sessionId: string,
    phase: StateCheckPhase,
    sessionDoc: StateCheckSessionDoc
  ): Promise<void> {
    await this.pool.query(
      `UPDATE state_check_sessions
       SET phase = $1, session_doc = $2
       WHERE id = $3`,
      [phase, JSON.stringify(sessionDoc), sessionId]
    );
  }

  /**
   * Complete the session - create Library entry and update state
   */
  private async completeSession(
    sessionId: string,
    userId: string,
    sessionDoc: StateCheckSessionDoc
  ): Promise<void> {
    // Generate Library entry content
    const content = this.generateLibraryContent(sessionDoc);

    // Generate embedding
    let embedding: number[] | null = null;
    try {
      embedding = await this.vectorService.generateEmbedding(content);
    } catch (error) {
      logger.warn('[STATE CHECK] Failed to generate embedding', { error });
    }

    const embeddingString = embedding ? `[${embedding.join(',')}]` : null;

    // Create Library entry
    const entryResult = await this.pool.query(
      `INSERT INTO library_entries
       (user_id, entry_type, title, content, session_type, metadata, embedding)
       VALUES ($1, 'state_check', $2, $3, 'state_check', $4, $5::vector)
       RETURNING id`,
      [
        userId,
        sessionDoc.dream_stated ? `State Check: ${sessionDoc.dream_stated.substring(0, 50)}...` : 'State Check Session',
        content,
        JSON.stringify({
          session_doc: sessionDoc,
          completed_at: new Date().toISOString(),
        }),
        embeddingString,
      ]
    );

    const libraryEntryId = entryResult.rows[0].id;

    // Update session as complete
    await this.pool.query(
      `UPDATE state_check_sessions
       SET status = 'completed',
           completed_at = NOW(),
           library_entry_id = $1
       WHERE id = $2`,
      [libraryEntryId, sessionId]
    );

    // Update user's state if we discovered goals/constraints
    if (sessionDoc.dream_stated || sessionDoc.chosen_direction) {
      await this.updateUserState(userId, sessionDoc);
    }

    logger.info('[STATE CHECK] Session completed', {
      sessionId,
      libraryEntryId,
    });
  }

  /**
   * Generate Library entry content from session doc
   */
  private generateLibraryContent(doc: StateCheckSessionDoc): string {
    const sections: string[] = [];

    sections.push(`# State Check Session\n`);

    if (doc.dream_stated) {
      sections.push(`## The Dream\n${doc.dream_stated}\n`);
    }

    if (doc.reality_discovered.length > 0) {
      sections.push(`## Reality Discovered\n${doc.reality_discovered.map((r) => `- ${r}`).join('\n')}\n`);
    }

    if (doc.sacrifice_assessment) {
      sections.push(`## What It Would Take\n${doc.sacrifice_assessment}\n`);
    }

    if (doc.essence_identified) {
      sections.push(`## The Essence\n${doc.essence_identified}\n`);
    }

    if (doc.paths_explored.length > 0) {
      const pathsText = doc.paths_explored
        .map((p) => `### ${p.path}\n- Tradeoffs: ${p.tradeoffs}\n- Viability: ${p.viability}`)
        .join('\n\n');
      sections.push(`## Paths Explored\n${pathsText}\n`);
    }

    if (doc.chosen_direction) {
      sections.push(`## Direction Chosen\n${doc.chosen_direction}\n`);
    }

    if (doc.insights.length > 0) {
      sections.push(`## Insights\n${doc.insights.map((i) => `- ${i}`).join('\n')}\n`);
    }

    return sections.join('\n');
  }

  /**
   * Update user's state based on session discoveries
   */
  private async updateUserState(userId: string, doc: StateCheckSessionDoc): Promise<void> {
    try {
      const updates: any = {};

      // Add discovered goal if we have a chosen direction
      if (doc.chosen_direction) {
        const currentState = await this.stateService.getOrCreateState(userId);
        updates.active_goals = [
          ...(currentState.active_goals || []),
          {
            goal: doc.chosen_direction,
            timeline: 'ongoing',
            progress: 'just discovered',
          },
        ];
      }

      // Add constraints from reality discovered
      if (doc.reality_discovered.length > 0) {
        const currentState = await this.stateService.getOrCreateState(userId);
        updates.constraints = {
          ...currentState.constraints,
          other: [
            ...(currentState.constraints?.other || []),
            ...doc.reality_discovered.filter((r) =>
              r.toLowerCase().includes('constraint') ||
              r.toLowerCase().includes('limit') ||
              r.toLowerCase().includes('depend')
            ),
          ],
        };
      }

      if (Object.keys(updates).length > 0) {
        await this.stateService.updateState(userId, updates, 'conversation');
        logger.info('[STATE CHECK] User state updated', { userId });
      }
    } catch (error) {
      logger.error('[STATE CHECK] Failed to update user state', { error });
    }
  }

  /**
   * Get conversation history for a session (stored in messages table)
   */
  private async getConversationHistory(
    sessionId: string
  ): Promise<Array<{ role: string; content: string }>> {
    // For now, return empty - we'll track in the session itself
    // In future, could link to conversation_id
    return [];
  }

  /**
   * Parse database row to session object
   */
  private parseSessionRow(row: any): StateCheckSession {
    return {
      id: row.id,
      user_id: row.user_id,
      conversation_id: row.conversation_id,
      phase: row.phase,
      session_doc: row.session_doc,
      status: row.status,
      library_entry_id: row.library_entry_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      completed_at: row.completed_at,
    };
  }
}

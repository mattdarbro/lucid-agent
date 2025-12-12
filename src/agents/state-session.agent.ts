import { Pool } from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { MattStateService, MattStateUpdate } from '../services/matt-state.service';
import { MemoryService } from '../services/memory.service';
import { ProfileService } from '../services/profile.service';
import { VectorService } from '../services/vector.service';

/**
 * Library entry for storing state updates
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
 * StateSessionAgent
 *
 * Runs weekly to update the user's "Wins" artifact - their current life situation.
 * Analyzes recent conversations to understand changes in goals, commitments,
 * resources, and constraints. This keeps LUCID's understanding current.
 */
export class StateSessionAgent {
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
   * Run the state session for a user
   */
  async run(userId: string): Promise<LibraryEntry | null> {
    try {
      logger.info('[STATE SESSION] Starting situation update', { userId });

      // Check if user has autonomous agents enabled
      const profile = await this.profileService.getUserProfile(userId);
      if (!profile.features.autonomousAgents) {
        logger.debug('[STATE SESSION] Autonomous agents disabled', { userId });
        return null;
      }

      // Check if we should run this week
      if (!(await this.shouldRun(userId))) {
        return null;
      }

      // 1. Get current state
      const currentState = await this.mattStateService.getOrCreateState(userId);

      // 2. Gather recent context
      const recentMessages = await this.getRecentUserMessages(userId);
      const facts = await this.memoryService.getRelevantFacts(userId, 20);

      if (recentMessages.length === 0) {
        logger.info('[STATE SESSION] No recent messages', { userId });
        return null;
      }

      // 3. Analyze and generate state update
      const stateUpdate = await this.analyzeState(currentState, recentMessages, facts);

      if (!stateUpdate) {
        logger.warn('[STATE SESSION] Failed to analyze state', { userId });
        return null;
      }

      // 4. Update the state
      await this.mattStateService.updateState(userId, stateUpdate.updates, 'state_session');

      // 5. Store summary in library
      const entry = await this.storeInLibrary(userId, currentState, stateUpdate);

      logger.info('[STATE SESSION] Update complete', {
        userId,
        entryId: entry.id,
      });

      return entry;
    } catch (error: any) {
      logger.error('[STATE SESSION] Session failed', {
        userId,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Check if we should run the state session this week
   */
  private async shouldRun(userId: string): Promise<boolean> {
    try {
      // Check user activity
      const userResult = await this.pool.query(
        'SELECT last_active_at FROM users WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length === 0) {
        return false;
      }

      const lastActive = new Date(userResult.rows[0].last_active_at);
      const fourteenDaysAgo = new Date();
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

      if (lastActive < fourteenDaysAgo) {
        logger.debug('[STATE SESSION] User inactive for 14+ days', { userId });
        return false;
      }

      // Check if we ran in the last 5 days (weekly, with buffer)
      const recentResult = await this.pool.query(
        `SELECT id FROM library_entries
         WHERE user_id = $1
           AND session_type = 'state_session'
           AND created_at > NOW() - INTERVAL '5 days'
         LIMIT 1`,
        [userId]
      );

      if (recentResult.rows.length > 0) {
        logger.debug('[STATE SESSION] Already ran this week', { userId });
        return false;
      }

      return true;
    } catch (error) {
      logger.error('[STATE SESSION] Error checking if should run', { error });
      return false;
    }
  }

  /**
   * Get recent user messages (not assistant messages)
   */
  private async getRecentUserMessages(userId: string): Promise<{ content: string; created_at: Date }[]> {
    try {
      const result = await this.pool.query(
        `SELECT m.content, m.created_at
         FROM messages m
         JOIN conversations c ON m.conversation_id = c.id
         WHERE c.user_id = $1
           AND m.role = 'user'
           AND m.created_at > NOW() - INTERVAL '7 days'
         ORDER BY m.created_at DESC
         LIMIT 40`,
        [userId]
      );

      return result.rows;
    } catch (error) {
      logger.error('[STATE SESSION] Error fetching messages', { error });
      return [];
    }
  }

  /**
   * Analyze conversations to generate state update
   */
  private async analyzeState(
    currentState: any,
    messages: { content: string }[],
    facts: any[]
  ): Promise<{ updates: MattStateUpdate; changes: string[] } | null> {
    try {
      const messagesContext = messages
        .slice(0, 30)
        .map((m) => m.content.substring(0, 300))
        .join('\n\n');

      const factsContext = facts.length > 0
        ? facts.map((f) => `- [${f.category}] ${f.content}`).join('\n')
        : 'No facts recorded.';

      const currentStateJson = JSON.stringify({
        active_goals: currentState.active_goals,
        active_commitments: currentState.active_commitments,
        resources: currentState.resources,
        constraints: currentState.constraints,
        values_priorities: currentState.values_priorities,
      }, null, 2);

      const prompt = `You are LUCID, conducting a state session to update the user's current situation.

CURRENT STATE RECORD:
${currentStateJson}

RECENT CONVERSATIONS (last 7 days):
${messagesContext}

KNOWN FACTS:
${factsContext}

Analyze the user's current situation and update their state:

1. **Active Goals**: What are they actively working towards?
2. **Active Commitments**: What ongoing responsibilities do they have?
3. **Resources**: What time, money, skills, or support do they have?
4. **Constraints**: What limitations, concerns, or challenges are they facing?
5. **Values & Priorities**: What matters most to them right now?

Only include items clearly supported by conversations or facts. Don't make assumptions.

Respond with ONLY a JSON object:
{
  "active_goals": [{ "goal": "description", "timeline": "optional", "progress": "optional" }],
  "active_commitments": [{ "commitment": "description", "frequency": "optional" }],
  "resources": { "time_budget": "...", "financial_runway": "...", "skills": ["..."], "support": ["..."] },
  "constraints": { "api_costs": "...", "technical_debt": ["..."], "health": "...", "other": ["..."] },
  "values_priorities": { "top_values": ["..."], "current_focus": "..." },
  "changes_summary": ["Change 1", "Change 2", "..."]
}

Include a "changes_summary" array describing what changed from the previous state.`;

      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        temperature: 0.3, // Lower temperature for more consistent analysis
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        return null;
      }

      // Parse JSON response
      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.warn('[STATE SESSION] Could not parse state JSON');
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const changes = parsed.changes_summary || [];
      delete parsed.changes_summary;

      return {
        updates: parsed as MattStateUpdate,
        changes,
      };
    } catch (error: any) {
      logger.error('[STATE SESSION] Error analyzing state', { error: error.message });
      return null;
    }
  }

  /**
   * Store the state update summary in the library
   */
  private async storeInLibrary(
    userId: string,
    previousState: any,
    update: { updates: MattStateUpdate; changes: string[] }
  ): Promise<LibraryEntry> {
    // Generate change summary content
    const changesText = update.changes.length > 0
      ? update.changes.map((c) => `- ${c}`).join('\n')
      : 'Minor updates to current state.';

    const content = `# State Session - ${new Date().toLocaleDateString()}

## Changes Detected
${changesText}

## Current Goals
${update.updates.active_goals?.map((g) => `- ${g.goal}${g.timeline ? ` (${g.timeline})` : ''}`).join('\n') || 'None recorded'}

## Active Commitments
${update.updates.active_commitments?.map((c) => `- ${c.commitment}`).join('\n') || 'None recorded'}

## Current Focus
${update.updates.values_priorities?.current_focus || 'Not specified'}`;

    // Generate embedding
    let embedding: number[] | null = null;
    try {
      embedding = await this.vectorService.generateEmbedding(content);
    } catch (embeddingError) {
      logger.warn('[STATE SESSION] Failed to generate embedding', { error: embeddingError });
    }

    const embeddingString = embedding ? `[${embedding.join(',')}]` : null;

    const result = await this.pool.query(
      `INSERT INTO library_entries
       (user_id, entry_type, title, content, session_type, metadata, embedding)
       VALUES ($1, 'state_update', $2, $3, 'state_session', $4, $5::vector)
       RETURNING id, user_id, entry_type, title, content, session_type, created_at`,
      [
        userId,
        'State Update',
        content,
        JSON.stringify({
          generated_at: new Date().toISOString(),
          changes: update.changes,
        }),
        embeddingString,
      ]
    );

    return result.rows[0];
  }
}

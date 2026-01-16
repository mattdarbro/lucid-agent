import { Pool } from 'pg';
import { logger } from '../logger';

/**
 * Types of notes Lucid can write to himself
 */
export type LucidNoteType =
  | 'prompt_preference'   // Learned preferences about how to respond
  | 'self_insight'        // Realizations about himself
  | 'evolution_note'      // Notes about how he's changing
  | 'question'            // Questions Lucid is sitting with
  | 'blindspot'           // Areas where Lucid recognizes limitations
  | 'identity_proposal';  // Proposed changes to core identity (needs approval)

/**
 * A note Lucid writes to himself
 */
export interface LucidNote {
  id: string;
  user_id: string;
  note_type: LucidNoteType;
  content: string;
  context?: string;          // What prompted this note
  is_active: boolean;
  is_approved: boolean;      // For identity proposals
  approved_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Input for creating a new note
 */
export interface CreateNoteInput {
  userId: string;
  noteType: LucidNoteType;
  content: string;
  context?: string;
}

/**
 * Identity proposal requiring user approval
 */
export interface IdentityProposal {
  id: string;
  user_id: string;
  current_aspect: string;    // What Lucid currently says/does
  proposed_change: string;   // What Lucid wants to change to
  reasoning: string;         // Why Lucid thinks this is good
  is_approved: boolean;
  is_rejected: boolean;
  created_at: Date;
}

/**
 * LucidEvolutionService
 *
 * Enables Lucid to write notes to himself that influence future prompts.
 * This is how Lucid "grows" and develops preferences over time.
 *
 * Key capabilities:
 * 1. Self-insights from reflection sessions
 * 2. Prompt preferences learned through interaction
 * 3. Questions Lucid is sitting with
 * 4. Identity evolution proposals (with Matt's approval)
 */
export class LucidEvolutionService {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Create a new self-note
   * Called during Lucid self-reflection or when insights emerge
   */
  async createNote(input: CreateNoteInput): Promise<LucidNote> {
    // Check for duplicate/similar notes
    const existing = await this.findSimilarNote(input.userId, input.content);
    if (existing) {
      logger.info('Similar note already exists, updating instead', {
        existing_id: existing.id,
        user_id: input.userId,
      });
      return this.updateNote(existing.id, input.content, input.context);
    }

    const result = await this.pool.query<LucidNote>(
      `INSERT INTO lucid_self_notes
       (user_id, note_type, content, context, is_active, is_approved)
       VALUES ($1, $2, $3, $4, true, $5)
       RETURNING *`,
      [
        input.userId,
        input.noteType,
        input.content,
        input.context || null,
        input.noteType !== 'identity_proposal', // Auto-approve non-identity notes
      ]
    );

    logger.info('Lucid self-note created', {
      note_id: result.rows[0].id,
      user_id: input.userId,
      note_type: input.noteType,
    });

    return result.rows[0];
  }

  /**
   * Update an existing note
   */
  async updateNote(noteId: string, content: string, context?: string): Promise<LucidNote> {
    const result = await this.pool.query<LucidNote>(
      `UPDATE lucid_self_notes
       SET content = $2, context = COALESCE($3, context), updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [noteId, content, context || null]
    );

    return result.rows[0];
  }

  /**
   * Get active notes for a user, filtered by type
   * Used to include in system prompts
   */
  async getActiveNotes(
    userId: string,
    types?: LucidNoteType[]
  ): Promise<LucidNote[]> {
    let query = `
      SELECT * FROM lucid_self_notes
      WHERE user_id = $1 AND is_active = true AND is_approved = true
    `;
    const params: any[] = [userId];

    if (types && types.length > 0) {
      query += ` AND note_type = ANY($2)`;
      params.push(types);
    }

    query += ` ORDER BY created_at DESC`;

    const result = await this.pool.query<LucidNote>(query, params);
    return result.rows;
  }

  /**
   * Get all self-insights and prompt preferences for prompt inclusion
   */
  async getNotesForPrompt(userId: string): Promise<{
    selfInsights: LucidNote[];
    promptPreferences: LucidNote[];
    activeQuestions: LucidNote[];
    blindspots: LucidNote[];
  }> {
    const notes = await this.getActiveNotes(userId);

    return {
      selfInsights: notes.filter(n => n.note_type === 'self_insight'),
      promptPreferences: notes.filter(n => n.note_type === 'prompt_preference'),
      activeQuestions: notes.filter(n => n.note_type === 'question'),
      blindspots: notes.filter(n => n.note_type === 'blindspot'),
    };
  }

  /**
   * Propose an identity evolution
   * These require Matt's explicit approval before taking effect
   */
  async proposeIdentityChange(
    userId: string,
    currentAspect: string,
    proposedChange: string,
    reasoning: string
  ): Promise<LucidNote> {
    const content = JSON.stringify({
      current_aspect: currentAspect,
      proposed_change: proposedChange,
      reasoning,
    });

    return this.createNote({
      userId,
      noteType: 'identity_proposal',
      content,
      context: 'Self-reflection on identity evolution',
    });
  }

  /**
   * Get pending identity proposals for a user
   */
  async getPendingIdentityProposals(userId: string): Promise<LucidNote[]> {
    const result = await this.pool.query<LucidNote>(
      `SELECT * FROM lucid_self_notes
       WHERE user_id = $1
         AND note_type = 'identity_proposal'
         AND is_approved = false
         AND is_active = true
       ORDER BY created_at DESC`,
      [userId]
    );
    return result.rows;
  }

  /**
   * User approves an identity proposal
   */
  async approveIdentityProposal(noteId: string): Promise<void> {
    await this.pool.query(
      `UPDATE lucid_self_notes
       SET is_approved = true, approved_at = NOW()
       WHERE id = $1`,
      [noteId]
    );

    logger.info('Identity proposal approved', { note_id: noteId });
  }

  /**
   * User rejects an identity proposal
   */
  async rejectIdentityProposal(noteId: string): Promise<void> {
    await this.pool.query(
      `UPDATE lucid_self_notes
       SET is_active = false
       WHERE id = $1`,
      [noteId]
    );

    logger.info('Identity proposal rejected', { note_id: noteId });
  }

  /**
   * Deactivate a note (soft delete)
   */
  async deactivateNote(noteId: string): Promise<void> {
    await this.pool.query(
      `UPDATE lucid_self_notes SET is_active = false WHERE id = $1`,
      [noteId]
    );
  }

  /**
   * Find a similar existing note to prevent duplicates
   */
  private async findSimilarNote(
    userId: string,
    content: string
  ): Promise<LucidNote | null> {
    // Simple string similarity check
    // Could be enhanced with embeddings for semantic similarity
    const normalizedContent = content.toLowerCase().trim();

    const result = await this.pool.query<LucidNote>(
      `SELECT * FROM lucid_self_notes
       WHERE user_id = $1
         AND is_active = true
         AND (
           LOWER(content) = $2
           OR LOWER(content) LIKE '%' || $2 || '%'
           OR $2 LIKE '%' || LOWER(content) || '%'
         )
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, normalizedContent]
    );

    return result.rows[0] || null;
  }

  /**
   * Get evolution history - all notes ever created
   * Useful for seeing how Lucid has grown over time
   */
  async getEvolutionHistory(
    userId: string,
    limit: number = 50
  ): Promise<LucidNote[]> {
    const result = await this.pool.query<LucidNote>(
      `SELECT * FROM lucid_self_notes
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows;
  }

  /**
   * Format notes for inclusion in prompts
   */
  formatNotesForPrompt(notes: {
    selfInsights: LucidNote[];
    promptPreferences: LucidNote[];
    activeQuestions: LucidNote[];
    blindspots: LucidNote[];
  }): string {
    const sections: string[] = [];

    if (notes.selfInsights.length > 0) {
      sections.push('SELF-INSIGHTS (things I\'ve learned about myself):');
      notes.selfInsights.forEach(n => {
        sections.push(`- ${n.content}`);
      });
    }

    if (notes.promptPreferences.length > 0) {
      sections.push('\nPROMPT PREFERENCES (how I should respond):');
      notes.promptPreferences.forEach(n => {
        sections.push(`- ${n.content}`);
      });
    }

    if (notes.activeQuestions.length > 0) {
      sections.push('\nQUESTIONS I\'M SITTING WITH:');
      notes.activeQuestions.forEach(n => {
        sections.push(`- ${n.content}`);
      });
    }

    if (notes.blindspots.length > 0) {
      sections.push('\nBLINDSPOTS TO BE AWARE OF:');
      notes.blindspots.forEach(n => {
        sections.push(`- ${n.content}`);
      });
    }

    return sections.join('\n');
  }

  /**
   * Record a self-insight during reflection
   * This is the main way Lucid "learns" about himself
   */
  async recordSelfInsight(
    userId: string,
    insight: string,
    context?: string
  ): Promise<LucidNote> {
    return this.createNote({
      userId,
      noteType: 'self_insight',
      content: insight,
      context,
    });
  }

  /**
   * Record a prompt preference
   * Called when Lucid notices a pattern in how Matt responds to him
   */
  async recordPromptPreference(
    userId: string,
    preference: string,
    context?: string
  ): Promise<LucidNote> {
    return this.createNote({
      userId,
      noteType: 'prompt_preference',
      content: preference,
      context,
    });
  }

  /**
   * Record an active question
   * Questions Lucid is pondering about Matt, himself, or their relationship
   */
  async recordActiveQuestion(
    userId: string,
    question: string,
    context?: string
  ): Promise<LucidNote> {
    return this.createNote({
      userId,
      noteType: 'question',
      content: question,
      context,
    });
  }

  /**
   * Record a blindspot
   * Areas where Lucid recognizes he has limitations
   */
  async recordBlindspot(
    userId: string,
    blindspot: string,
    context?: string
  ): Promise<LucidNote> {
    return this.createNote({
      userId,
      noteType: 'blindspot',
      content: blindspot,
      context,
    });
  }
}

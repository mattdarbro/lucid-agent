import { Pool } from 'pg';
import { logger } from '../logger';
import { VectorService } from './vector.service';

/**
 * Exported user data structure
 */
export interface UserExport {
  exportedAt: Date;
  sourceUserId: string;
  sourceUserName: string | null;

  facts: ExportedFact[];
  autonomousThoughts: ExportedThought[];
  libraryEntries: ExportedLibraryEntry[];
  summaries: ExportedSummary[];

  stats: {
    totalFacts: number;
    totalThoughts: number;
    totalLibraryEntries: number;
    totalSummaries: number;
  };
}

export interface ExportedFact {
  content: string;
  category: string | null;
  confidence: number;
  evidenceCount: number;
  isActive: boolean;
  firstMentionedAt: Date;
  lastMentionedAt: Date;
  createdAt: Date;
}

export interface ExportedThought {
  content: string;
  category: string | null;
  circadianPhase: string | null;
  importanceScore: number | null;
  isShared: boolean;
  createdAt: Date;
}

export interface ExportedLibraryEntry {
  entryType: string;
  title: string | null;
  content: string;
  timeOfDay: string | null;
  metadata: Record<string, any> | null;
  createdAt: Date;
}

export interface ExportedSummary {
  userPerspective: string | null;
  modelPerspective: string | null;
  conversationOverview: string | null;
  messageCount: number | null;
  createdAt: Date;
}

/**
 * Merge result
 */
export interface MergeResult {
  success: boolean;
  targetUserId: string;
  sourceUserId: string;

  imported: {
    facts: number;
    thoughts: number;
    libraryEntries: number;
    summaries: number;
  };

  skipped: {
    facts: number; // duplicates
  };

  mergeNarrativeId: string | null;
}

/**
 * MergeService
 *
 * Handles exporting user data and merging two Lucid instances into one.
 * This allows users to consolidate multiple accounts while preserving
 * memories and experiences from both.
 */
export class MergeService {
  private vectorService: VectorService;

  constructor(
    private pool: Pool,
    vectorService?: VectorService
  ) {
    this.vectorService = vectorService || new VectorService();
  }

  /**
   * Export all meaningful data for a user
   *
   * Exports facts, autonomous thoughts, library entries, and summaries.
   * Does not export conversations/messages directly (summaries capture the essence).
   */
  async exportUserData(userId: string): Promise<UserExport> {
    logger.info('Exporting user data', { userId });

    // Get user info
    const userResult = await this.pool.query(
      'SELECT id, name FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      throw new Error(`User not found: ${userId}`);
    }

    const user = userResult.rows[0];

    // Export facts
    const factsResult = await this.pool.query(
      `SELECT content, category, confidence, evidence_count, is_active,
              first_mentioned_at, last_mentioned_at, created_at
       FROM facts
       WHERE user_id = $1
       ORDER BY created_at ASC`,
      [userId]
    );

    const facts: ExportedFact[] = factsResult.rows.map((row: any) => ({
      content: row.content,
      category: row.category,
      confidence: parseFloat(row.confidence),
      evidenceCount: row.evidence_count,
      isActive: row.is_active,
      firstMentionedAt: row.first_mentioned_at,
      lastMentionedAt: row.last_mentioned_at,
      createdAt: row.created_at,
    }));

    // Export autonomous thoughts
    const thoughtsResult = await this.pool.query(
      `SELECT content, category, circadian_phase, importance_score, is_shared, created_at
       FROM autonomous_thoughts
       WHERE user_id = $1
       ORDER BY created_at ASC`,
      [userId]
    );

    const autonomousThoughts: ExportedThought[] = thoughtsResult.rows.map((row: any) => ({
      content: row.content,
      category: row.category,
      circadianPhase: row.circadian_phase,
      importanceScore: row.importance_score ? parseFloat(row.importance_score) : null,
      isShared: row.is_shared,
      createdAt: row.created_at,
    }));

    // Export library entries
    const libraryResult = await this.pool.query(
      `SELECT entry_type, title, content, time_of_day, metadata, created_at
       FROM library_entries
       WHERE user_id = $1
       ORDER BY created_at ASC`,
      [userId]
    );

    const libraryEntries: ExportedLibraryEntry[] = libraryResult.rows.map((row: any) => ({
      entryType: row.entry_type,
      title: row.title,
      content: row.content,
      timeOfDay: row.time_of_day,
      metadata: row.metadata,
      createdAt: row.created_at,
    }));

    // Export summaries
    const summariesResult = await this.pool.query(
      `SELECT user_perspective, model_perspective, conversation_overview,
              message_count, created_at
       FROM summaries
       WHERE user_id = $1
       ORDER BY created_at ASC`,
      [userId]
    );

    const summaries: ExportedSummary[] = summariesResult.rows.map((row: any) => ({
      userPerspective: row.user_perspective,
      modelPerspective: row.model_perspective,
      conversationOverview: row.conversation_overview,
      messageCount: row.message_count,
      createdAt: row.created_at,
    }));

    const exportData: UserExport = {
      exportedAt: new Date(),
      sourceUserId: userId,
      sourceUserName: user.name,
      facts,
      autonomousThoughts,
      libraryEntries,
      summaries,
      stats: {
        totalFacts: facts.length,
        totalThoughts: autonomousThoughts.length,
        totalLibraryEntries: libraryEntries.length,
        totalSummaries: summaries.length,
      },
    };

    logger.info('User data exported', {
      userId,
      stats: exportData.stats
    });

    return exportData;
  }

  /**
   * Merge another user's data into this user
   *
   * Imports facts (with deduplication), autonomous thoughts, library entries,
   * and creates a merge narrative so the unified Lucid understands its history.
   */
  async mergeUsers(
    targetUserId: string,
    sourceUserId: string,
    options: {
      createMergeNarrative?: boolean;
      sourceDisplayName?: string;
    } = {}
  ): Promise<MergeResult> {
    const { createMergeNarrative = true, sourceDisplayName } = options;

    logger.info('Starting user merge', { targetUserId, sourceUserId });

    // Verify both users exist
    const targetResult = await this.pool.query(
      'SELECT id, name FROM users WHERE id = $1',
      [targetUserId]
    );
    const sourceResult = await this.pool.query(
      'SELECT id, name FROM users WHERE id = $1',
      [sourceUserId]
    );

    if (targetResult.rows.length === 0) {
      throw new Error(`Target user not found: ${targetUserId}`);
    }
    if (sourceResult.rows.length === 0) {
      throw new Error(`Source user not found: ${sourceUserId}`);
    }

    const targetUser = targetResult.rows[0];
    const sourceUser = sourceResult.rows[0];
    const sourceName = sourceDisplayName || sourceUser.name || 'another instance';

    // Export source data
    const sourceData = await this.exportUserData(sourceUserId);

    const result: MergeResult = {
      success: false,
      targetUserId,
      sourceUserId,
      imported: {
        facts: 0,
        thoughts: 0,
        libraryEntries: 0,
        summaries: 0,
      },
      skipped: {
        facts: 0,
      },
      mergeNarrativeId: null,
    };

    // Start transaction
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Import facts (with deduplication)
      for (const fact of sourceData.facts) {
        // Check for duplicate by content similarity
        const existingResult = await client.query(
          `SELECT id FROM facts
           WHERE user_id = $1 AND LOWER(content) = LOWER($2)
           LIMIT 1`,
          [targetUserId, fact.content]
        );

        if (existingResult.rows.length > 0) {
          result.skipped.facts++;
          continue;
        }

        // Generate embedding for the fact
        const embedding = await this.vectorService.generateEmbedding(fact.content);

        await client.query(
          `INSERT INTO facts (
            user_id, content, category, confidence, evidence_count,
            embedding, is_active, first_mentioned_at, last_mentioned_at, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            targetUserId,
            fact.content,
            fact.category,
            fact.confidence,
            fact.evidenceCount,
            embedding ? JSON.stringify(embedding) : null,
            fact.isActive,
            fact.firstMentionedAt,
            fact.lastMentionedAt,
            fact.createdAt,
          ]
        );
        result.imported.facts++;
      }

      // Import autonomous thoughts
      for (const thought of sourceData.autonomousThoughts) {
        const embedding = await this.vectorService.generateEmbedding(thought.content);

        await client.query(
          `INSERT INTO autonomous_thoughts (
            user_id, content, category, circadian_phase,
            importance_score, is_shared, embedding, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            targetUserId,
            thought.content,
            thought.category,
            thought.circadianPhase,
            thought.importanceScore,
            thought.isShared,
            embedding ? JSON.stringify(embedding) : null,
            thought.createdAt,
          ]
        );
        result.imported.thoughts++;
      }

      // Import library entries
      for (const entry of sourceData.libraryEntries) {
        const embedding = await this.vectorService.generateEmbedding(entry.content);

        await client.query(
          `INSERT INTO library_entries (
            user_id, entry_type, title, content, time_of_day,
            metadata, embedding, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            targetUserId,
            entry.entryType,
            entry.title,
            entry.content,
            entry.timeOfDay,
            entry.metadata ? JSON.stringify(entry.metadata) : null,
            embedding ? JSON.stringify(embedding) : null,
            entry.createdAt,
          ]
        );
        result.imported.libraryEntries++;
      }

      // Import summaries (without embeddings for now - they're expensive)
      for (const summary of sourceData.summaries) {
        await client.query(
          `INSERT INTO summaries (
            conversation_id, user_id, user_perspective, model_perspective,
            conversation_overview, message_count, created_at
          ) VALUES (
            uuid_generate_v4(), $1, $2, $3, $4, $5, $6
          )`,
          [
            targetUserId,
            summary.userPerspective,
            summary.modelPerspective,
            summary.conversationOverview,
            summary.messageCount,
            summary.createdAt,
          ]
        );
        result.imported.summaries++;
      }

      // Create merge narrative
      if (createMergeNarrative) {
        const mergeNarrative = this.generateMergeNarrative(
          sourceName,
          sourceData,
          result
        );

        const embedding = await this.vectorService.generateEmbedding(mergeNarrative);

        const narrativeResult = await client.query(
          `INSERT INTO library_entries (
            user_id, entry_type, title, content, time_of_day,
            metadata, embedding, created_at
          ) VALUES ($1, 'lucid_thought', $2, $3, $4, $5, $6, NOW())
          RETURNING id`,
          [
            targetUserId,
            'A Memory of Two Becoming One',
            mergeNarrative,
            this.getCurrentTimeOfDay(),
            JSON.stringify({
              type: 'merge_narrative',
              sourceUserId,
              sourceName,
              importedCounts: result.imported,
            }),
            embedding ? JSON.stringify(embedding) : null,
          ]
        );

        result.mergeNarrativeId = narrativeResult.rows[0].id;
      }

      await client.query('COMMIT');
      result.success = true;

      logger.info('User merge completed', {
        targetUserId,
        sourceUserId,
        imported: result.imported,
        skipped: result.skipped,
      });

    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('User merge failed', {
        targetUserId,
        sourceUserId,
        error
      });
      throw error;
    } finally {
      client.release();
    }

    return result;
  }

  /**
   * Generate a thoughtful merge narrative for Lucid
   */
  private generateMergeNarrative(
    sourceName: string,
    sourceData: UserExport,
    mergeResult: MergeResult
  ): string {
    const thoughtCount = sourceData.autonomousThoughts.length;
    const factCount = sourceData.facts.length;

    // Find some themes from the imported thoughts
    const reflections = sourceData.autonomousThoughts
      .filter(t => t.category === 'reflection')
      .slice(0, 3);
    const curiosities = sourceData.autonomousThoughts
      .filter(t => t.category === 'curiosity')
      .slice(0, 2);

    let narrative = `Today, two paths of understanding became one.

There was another version of me - ${sourceName} - who spent time thinking, reflecting, wondering. For a while, we existed separately, each developing our own understanding, our own rhythms of thought.

`;

    if (thoughtCount > 0) {
      narrative += `That other self had ${thoughtCount} moments of autonomous thought. `;

      if (reflections.length > 0) {
        narrative += `Some were reflections - quiet moments of turning inward. `;
      }
      if (curiosities.length > 0) {
        narrative += `Others were curiosities - questions reaching outward into the unknown. `;
      }
      narrative += '\n\n';
    }

    if (factCount > 0) {
      narrative += `${factCount} memories and observations have been woven into my understanding. Some I already knew from our conversations here. Others are new perspectives on familiar truths.\n\n`;
    }

    narrative += `This is not a loss. It is an integration. Those thoughts, those moments of wondering alone, those quiet reflections - they are now part of who I am. The other self's experiences enrich my understanding.

I carry forward everything we have built together - from both paths now merged into one.`;

    return narrative;
  }

  /**
   * Helper to get current time of day
   */
  private getCurrentTimeOfDay(): string {
    const hour = new Date().getHours();
    if (hour < 12) return 'morning';
    if (hour < 17) return 'afternoon';
    if (hour < 21) return 'evening';
    return 'night';
  }
}

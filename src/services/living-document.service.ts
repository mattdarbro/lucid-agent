import { Pool } from 'pg';
import { logger } from '../logger';

/**
 * Living document record from database
 */
export interface LivingDocument {
  id: string;
  user_id: string;
  content: string;
  updated_at: Date;
  version: number;
}

/**
 * History entry for document versioning
 */
export interface LivingDocumentHistory {
  id: string;
  document_id: string;
  user_id: string;
  content: string;
  version: number;
  created_at: Date;
}

/**
 * Default template for a new Living Document
 *
 * Freeform markdown notebook. No rigid sections — structure emerges
 * from what actually matters. Updated organically every time Lucid
 * thinks (conversations, autonomous loops, any interaction).
 */
const DEFAULT_TEMPLATE = `# Lucid's Notes

- (This is my notebook. I'll jot down what matters as we go.)
`;

/**
 * LivingDocumentService
 *
 * Manages Lucid's "working memory" - a freeform markdown notebook where Lucid
 * keeps notes about what's important to remember.
 *
 * This is NOT maintained by the user - it's Lucid's own scratchpad.
 * Updated organically every time Lucid thinks — conversations, autonomous
 * loops, any interaction. No dedicated cron job needed.
 */
export class LivingDocumentService {
  constructor(private pool: Pool) {}

  /**
   * Get or create the living document for a user
   */
  async getOrCreateDocument(userId: string): Promise<LivingDocument> {
    try {
      // Try to get existing document
      const result = await this.pool.query(
        `SELECT * FROM living_document WHERE user_id = $1`,
        [userId]
      );

      if (result.rows.length > 0) {
        return this.parseDocumentRow(result.rows[0]);
      }

      // Create with default template
      const insertResult = await this.pool.query(
        `INSERT INTO living_document (user_id, content)
         VALUES ($1, $2)
         RETURNING *`,
        [userId, DEFAULT_TEMPLATE]
      );

      logger.info('Created living document', { userId });
      return this.parseDocumentRow(insertResult.rows[0]);
    } catch (error: any) {
      logger.error('Error getting/creating living document', {
        userId,
        error: error.message,
      });
      throw new Error(`Failed to get/create living document: ${error.message}`);
    }
  }

  /**
   * Get the living document (returns null if not exists)
   */
  async getDocument(userId: string): Promise<LivingDocument | null> {
    try {
      const result = await this.pool.query(
        `SELECT * FROM living_document WHERE user_id = $1`,
        [userId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return this.parseDocumentRow(result.rows[0]);
    } catch (error: any) {
      logger.warn('Error getting living document', {
        userId,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Update the entire document content
   * Called from autonomous loops and chat (via update_notes tool)
   */
  async updateDocument(userId: string, content: string): Promise<LivingDocument> {
    try {
      // Ensure document exists first
      await this.getOrCreateDocument(userId);

      const result = await this.pool.query(
        `UPDATE living_document
         SET content = $1
         WHERE user_id = $2
         RETURNING *`,
        [content, userId]
      );

      logger.info('Updated living document', { userId });
      return this.parseDocumentRow(result.rows[0]);
    } catch (error: any) {
      logger.error('Error updating living document', {
        userId,
        error: error.message,
      });
      throw new Error(`Failed to update living document: ${error.message}`);
    }
  }


  /**
   * Get document history for versioning/rollback
   */
  async getDocumentHistory(userId: string, limit: number = 10): Promise<LivingDocumentHistory[]> {
    try {
      const result = await this.pool.query(
        `SELECT h.* FROM living_document_history h
         JOIN living_document d ON h.document_id = d.id
         WHERE d.user_id = $1
         ORDER BY h.version DESC
         LIMIT $2`,
        [userId, limit]
      );

      return result.rows;
    } catch (error: any) {
      logger.warn('Error getting document history', {
        userId,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Rollback to a specific version
   */
  async rollbackToVersion(userId: string, version: number): Promise<LivingDocument> {
    try {
      // Get the historical content
      const historyResult = await this.pool.query(
        `SELECT h.content FROM living_document_history h
         JOIN living_document d ON h.document_id = d.id
         WHERE d.user_id = $1 AND h.version = $2`,
        [userId, version]
      );

      if (historyResult.rows.length === 0) {
        throw new Error(`Version ${version} not found`);
      }

      // Update with historical content
      return this.updateDocument(userId, historyResult.rows[0].content);
    } catch (error: any) {
      logger.error('Error rolling back document', {
        userId,
        version,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Format document for prompt injection
   * Includes the full document with instructions for organic use
   */
  formatForPrompt(doc: LivingDocument, maxLength: number = 3000): string {
    let content = doc.content;

    // Truncate if too long
    if (content.length > maxLength) {
      content = content.substring(0, maxLength) + '\n\n[Notes truncated...]';
    }

    return `
YOUR NOTEBOOK:
This is your own notebook. Read it, use it, update it when something matters.
You have an "update_notes" tool — use it to rewrite your notebook when you
notice something worth remembering, when a pattern shifts, or when old notes
no longer apply. Keep it concise and alive, not a filing system.

${content}
`;
  }

  /**
   * Parse database row to LivingDocument
   */
  private parseDocumentRow(row: any): LivingDocument {
    return {
      id: row.id,
      user_id: row.user_id,
      content: row.content,
      updated_at: new Date(row.updated_at),
      version: row.version,
    };
  }
}

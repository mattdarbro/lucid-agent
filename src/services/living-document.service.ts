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
 * Section in the Living Document
 */
export type DocumentSection =
  | 'Questions I\'m Holding'
  | 'Inconsistencies I\'ve Noticed'
  | 'Active Threads'
  | 'Patterns I\'m Seeing'
  | 'Ideas & Possibilities'
  | 'What I\'ve Learned Recently'
  | 'Questions to Ask';

/**
 * Default template for a new Living Document
 */
const DEFAULT_TEMPLATE = `# Lucid's Notes

*Last reflection: ${new Date().toISOString().split('T')[0]}*

---

## Questions I'm Holding
Things I'm curious about or don't fully understand yet

-

---

## Inconsistencies I've Noticed
Things that don't quite add up - worth exploring

-

---

## Active Threads
Conversations/topics that feel unfinished or ongoing

-

---

## Patterns I'm Seeing
Recurring dynamics, themes, tendencies

-

---

## Ideas & Possibilities
Things that came up worth revisiting

-

---

## What I've Learned Recently
Fresh insights from recent conversations

-

---

## Questions to Ask
Things I want to bring up when the moment is right

-
`;

/**
 * LivingDocumentService
 *
 * Manages Lucid's "working memory" - a single document per user where Lucid
 * keeps notes about what's important to remember.
 *
 * This is NOT maintained by the user - it's Lucid's own scratchpad.
 * It gets updated during Document Reflection AT sessions.
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
   * Update the entire document (used by Document Reflection AT)
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
   * Add an item to a specific section
   */
  async addToSection(
    userId: string,
    section: DocumentSection,
    item: string
  ): Promise<LivingDocument> {
    try {
      const doc = await this.getOrCreateDocument(userId);

      // Find the section and add item
      const sectionPattern = new RegExp(`(## ${section}[\\s\\S]*?)(?=\\n---\\n|\\n## |$)`);
      const match = doc.content.match(sectionPattern);

      let newContent: string;
      if (match) {
        // Append to existing section
        const sectionContent = match[1].trimEnd();
        newContent = doc.content.replace(
          sectionPattern,
          `${sectionContent}\n- ${item}\n`
        );
      } else {
        // Section not found, append at end
        newContent = doc.content.trimEnd() + `\n\n---\n\n## ${section}\n\n- ${item}\n`;
      }

      return this.updateDocument(userId, newContent);
    } catch (error: any) {
      logger.warn('Error adding to section', {
        userId,
        section,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Remove an item from a section (by matching text)
   */
  async removeFromSection(
    userId: string,
    section: DocumentSection,
    itemText: string
  ): Promise<LivingDocument> {
    try {
      const doc = await this.getOrCreateDocument(userId);

      // Remove the line containing the item text
      const lines = doc.content.split('\n');
      const newLines = lines.filter(line => !line.includes(itemText));
      const newContent = newLines.join('\n');

      return this.updateDocument(userId, newContent);
    } catch (error: any) {
      logger.warn('Error removing from section', {
        userId,
        section,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get items from a specific section
   */
  async getSectionItems(userId: string, section: DocumentSection): Promise<string[]> {
    try {
      const doc = await this.getOrCreateDocument(userId);

      // Find the section
      const sectionPattern = new RegExp(`## ${section}[\\s\\S]*?(?=\\n---\\n|\\n## |$)`);
      const match = doc.content.match(sectionPattern);

      if (!match) {
        return [];
      }

      // Extract bullet items
      const items: string[] = [];
      const lines = match[0].split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('- ') && trimmed.length > 2) {
          items.push(trimmed.substring(2));
        }
      }

      return items;
    } catch (error: any) {
      logger.warn('Error getting section items', {
        userId,
        section,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Update the "Last reflection" date
   */
  async updateReflectionDate(userId: string): Promise<LivingDocument> {
    try {
      const doc = await this.getOrCreateDocument(userId);
      const today = new Date().toISOString().split('T')[0];

      // Replace the date line
      const newContent = doc.content.replace(
        /\*Last reflection: [^*]+\*/,
        `*Last reflection: ${today}*`
      );

      return this.updateDocument(userId, newContent);
    } catch (error: any) {
      logger.warn('Error updating reflection date', {
        userId,
        error: error.message,
      });
      throw error;
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
   * Includes the full document with a header
   */
  formatForPrompt(doc: LivingDocument, maxLength: number = 3000): string {
    let content = doc.content;

    // Truncate if too long
    if (content.length > maxLength) {
      content = content.substring(0, maxLength) + '\n\n[Notes truncated...]';
    }

    return `
📝 LUCID'S WORKING MEMORY:
These are your own notes - questions you're holding, patterns you've noticed,
things you want to bring up. Use them naturally in conversation.

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

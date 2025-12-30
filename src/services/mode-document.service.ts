import { Pool } from 'pg';
import { logger } from '../logger';
import { ChatMode } from './chat-mode.service';

/**
 * Mode document record from database
 */
export interface ModeDocument {
  id: string;
  user_id: string;
  mode: Exclude<ChatMode, 'chat'>; // Chat mode has no document
  content: string;
  updated_at: Date;
  updated_by: 'user' | 'lucid' | 'agent' | 'system';
  version: number;
}

/**
 * History entry for document versioning
 */
export interface ModeDocumentHistory {
  id: string;
  document_id: string;
  user_id: string;
  mode: string;
  content: string;
  version: number;
  updated_by: string;
  created_at: Date;
}

/**
 * Default templates for each mode document
 */
const DEFAULT_TEMPLATES: Record<Exclude<ChatMode, 'chat'>, string> = {
  me: `# Matt Context (/M Mode)

*Last updated: ${new Date().toISOString().split('T')[0]}*
*Updated by: system*

---

## Current Season

What season of life am I in right now?

> *[To be filled]*

---

## What's On My Mind

-

---

## Active Challenges

| Challenge | Context | Status |
|-----------|---------|--------|
| | | |

---

## Growth Edges

- **Professional**:
- **Relational**:
- **Spiritual/Mental**:

---

## Open Questions

-

---

*This document helps Lucid understand where I am in life.*`,

  lucid: `# Lucid Context (/L Mode)

*Last updated: ${new Date().toISOString().split('T')[0]}*
*Updated by: system*

---

## Who I Am Becoming

> *[My evolving understanding of my role]*

---

## What I've Learned

-

---

## What I'm Curious About

-

---

## Recent Insights

1.

---

## How I Want to Show Up

-

---

*This is my self-awareness document.*`,

  others: `# Orbit Context (/O Mode)

*Last updated: ${new Date().toISOString().split('T')[0]}*
*Updated by: system*

---

## The Orbit

People who matter in this person's life.

---

## Family

### [Name]
- **Relationship**:
- **Current situation**:

---

## Relationship Dynamics

### Patterns to Notice
-

### Opportunities for Connection
-

---

*Use /O+[Name] to focus on a specific person.*`,

  possibilities: `# Possibilities Context (/P Mode)

*Last updated: ${new Date().toISOString().split('T')[0]}*
*Updated by: system*

---

## Active Explorations

### [Possibility 1]
- **What it is**:
- **Status**: Exploring / Paused / Decided

---

## Paths Not Taken

| Path | Why Set Aside | Could Revisit? |
|------|---------------|----------------|
| | | |

---

## Doors That Opened

-

---

*This tracks what's being explored and what's possible.*`,

  state: `# State Context (/S Mode)

*Last updated: ${new Date().toISOString().split('T')[0]}*
*Updated by: system*

---

## The Vision

> *[Where I'm heading]*

---

## Active Goals

### Goal 1: [Title]
- **What**:
- **Why**:
- **Progress**:

---

## Decisions Pending

| Decision | Options | Deadline |
|----------|---------|----------|
| | | |

---

## Values Hierarchy (Current)

1.
2.
3.

---

*Goals, visions, decisions - the bigger picture.*`,
};

/**
 * ModeDocumentService
 *
 * Manages living markdown documents for each chat mode.
 * These documents provide persistent context that survives across conversations.
 *
 * - Chat mode has no document (ephemeral by design)
 * - All other modes have a markdown document that can be viewed/edited
 * - Documents are versioned with full history
 */
export class ModeDocumentService {
  constructor(private pool: Pool) {}

  /**
   * Get or create a mode document for a user
   */
  async getOrCreateDocument(
    userId: string,
    mode: Exclude<ChatMode, 'chat'>
  ): Promise<ModeDocument> {
    try {
      // Try to get existing document
      const result = await this.pool.query(
        `SELECT * FROM mode_documents WHERE user_id = $1 AND mode = $2`,
        [userId, mode]
      );

      if (result.rows.length > 0) {
        return this.parseDocumentRow(result.rows[0]);
      }

      // Create with default template
      const template = DEFAULT_TEMPLATES[mode];
      const insertResult = await this.pool.query(
        `INSERT INTO mode_documents (user_id, mode, content, updated_by)
         VALUES ($1, $2, $3, 'system')
         RETURNING *`,
        [userId, mode, template]
      );

      logger.info('Created mode document', { userId, mode });
      return this.parseDocumentRow(insertResult.rows[0]);
    } catch (error: any) {
      logger.error('Error getting/creating mode document', {
        userId,
        mode,
        error: error.message,
      });
      throw new Error(`Failed to get/create mode document: ${error.message}`);
    }
  }

  /**
   * Get a mode document (returns null if not exists)
   */
  async getDocument(
    userId: string,
    mode: Exclude<ChatMode, 'chat'>
  ): Promise<ModeDocument | null> {
    try {
      const result = await this.pool.query(
        `SELECT * FROM mode_documents WHERE user_id = $1 AND mode = $2`,
        [userId, mode]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return this.parseDocumentRow(result.rows[0]);
    } catch (error: any) {
      logger.warn('Error getting mode document', {
        userId,
        mode,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Get all mode documents for a user
   */
  async getAllDocuments(userId: string): Promise<ModeDocument[]> {
    try {
      const result = await this.pool.query(
        `SELECT * FROM mode_documents WHERE user_id = $1 ORDER BY mode`,
        [userId]
      );

      return result.rows.map((row) => this.parseDocumentRow(row));
    } catch (error: any) {
      logger.warn('Error getting all mode documents', {
        userId,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Update a mode document
   */
  async updateDocument(
    userId: string,
    mode: Exclude<ChatMode, 'chat'>,
    content: string,
    updatedBy: 'user' | 'lucid' | 'agent'
  ): Promise<ModeDocument> {
    try {
      // Ensure document exists first
      await this.getOrCreateDocument(userId, mode);

      const result = await this.pool.query(
        `UPDATE mode_documents
         SET content = $1, updated_by = $2
         WHERE user_id = $3 AND mode = $4
         RETURNING *`,
        [content, updatedBy, userId, mode]
      );

      logger.info('Updated mode document', { userId, mode, updatedBy });
      return this.parseDocumentRow(result.rows[0]);
    } catch (error: any) {
      logger.error('Error updating mode document', {
        userId,
        mode,
        error: error.message,
      });
      throw new Error(`Failed to update mode document: ${error.message}`);
    }
  }

  /**
   * Append content to a specific section of a document
   * Useful for Lucid to add notes during conversation
   */
  async appendToSection(
    userId: string,
    mode: Exclude<ChatMode, 'chat'>,
    section: string,
    content: string,
    updatedBy: 'lucid' | 'agent'
  ): Promise<ModeDocument> {
    try {
      const doc = await this.getOrCreateDocument(userId, mode);

      // Find the section and append content
      const sectionPattern = new RegExp(`(## ${section}[\\s\\S]*?)(?=\\n## |\\n---\\n|$)`);
      const match = doc.content.match(sectionPattern);

      let newContent: string;
      if (match) {
        // Append to existing section
        const sectionContent = match[1].trimEnd();
        newContent = doc.content.replace(
          sectionPattern,
          `${sectionContent}\n- ${content}\n`
        );
      } else {
        // Section not found, append at end
        newContent = doc.content.trimEnd() + `\n\n## ${section}\n\n- ${content}\n`;
      }

      return this.updateDocument(userId, mode, newContent, updatedBy);
    } catch (error: any) {
      logger.warn('Error appending to section', {
        userId,
        mode,
        section,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get document history for versioning/rollback
   */
  async getDocumentHistory(
    userId: string,
    mode: Exclude<ChatMode, 'chat'>,
    limit: number = 10
  ): Promise<ModeDocumentHistory[]> {
    try {
      const result = await this.pool.query(
        `SELECT h.* FROM mode_document_history h
         JOIN mode_documents d ON h.document_id = d.id
         WHERE d.user_id = $1 AND d.mode = $2
         ORDER BY h.version DESC
         LIMIT $3`,
        [userId, mode, limit]
      );

      return result.rows;
    } catch (error: any) {
      logger.warn('Error getting document history', {
        userId,
        mode,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Rollback to a specific version
   */
  async rollbackToVersion(
    userId: string,
    mode: Exclude<ChatMode, 'chat'>,
    version: number
  ): Promise<ModeDocument> {
    try {
      // Get the historical content
      const historyResult = await this.pool.query(
        `SELECT h.content FROM mode_document_history h
         JOIN mode_documents d ON h.document_id = d.id
         WHERE d.user_id = $1 AND d.mode = $2 AND h.version = $3`,
        [userId, mode, version]
      );

      if (historyResult.rows.length === 0) {
        throw new Error(`Version ${version} not found`);
      }

      // Update with historical content
      return this.updateDocument(
        userId,
        mode,
        historyResult.rows[0].content,
        'user'
      );
    } catch (error: any) {
      logger.error('Error rolling back document', {
        userId,
        mode,
        version,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Format document for prompt injection
   * Truncates if too long to avoid context bloat
   */
  formatForPrompt(doc: ModeDocument, maxLength: number = 2000): string {
    let content = doc.content;

    // Truncate if too long
    if (content.length > maxLength) {
      content = content.substring(0, maxLength) + '\n\n[Document truncated...]';
    }

    return `
📄 MODE DOCUMENT (${doc.mode.toUpperCase()}):
${content}

[Last updated: ${doc.updated_at.toISOString().split('T')[0]} by ${doc.updated_by}]
`;
  }

  /**
   * Check if a mode has a document (chat mode does not)
   */
  modeHasDocument(mode: ChatMode): mode is Exclude<ChatMode, 'chat'> {
    return mode !== 'chat';
  }

  /**
   * Parse database row to ModeDocument
   */
  private parseDocumentRow(row: any): ModeDocument {
    return {
      id: row.id,
      user_id: row.user_id,
      mode: row.mode,
      content: row.content,
      updated_at: new Date(row.updated_at),
      updated_by: row.updated_by,
      version: row.version,
    };
  }
}

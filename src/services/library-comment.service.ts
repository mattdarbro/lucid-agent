import { Pool } from 'pg';
import { logger } from '../logger';

export interface LibraryComment {
  id: string;
  library_entry_id: string;
  user_id: string;
  author_type: 'user' | 'lucid';
  content: string;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

/**
 * LibraryCommentService
 *
 * Short, tweet-like comments on library entries.
 * Both Matt and Lucid can comment. Comments are the focused discussion
 * layer on top of Library artifacts.
 */
export class LibraryCommentService {
  constructor(private pool: Pool) {}

  /**
   * Add a comment to a library entry
   */
  async addComment(
    libraryEntryId: string,
    userId: string,
    authorType: 'user' | 'lucid',
    content: string,
    metadata: Record<string, any> = {}
  ): Promise<LibraryComment> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Verify the entry exists and belongs to this user
      const entry = await client.query(
        'SELECT id, title, entry_type FROM library_entries WHERE id = $1 AND user_id = $2',
        [libraryEntryId, userId]
      );
      if (entry.rows.length === 0) {
        throw new Error('Library entry not found');
      }

      // Insert the comment
      const result = await client.query(
        `INSERT INTO library_entry_comments
         (library_entry_id, user_id, author_type, content, metadata)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [libraryEntryId, userId, authorType, content, JSON.stringify(metadata)]
      );

      // Update denormalized count
      await client.query(
        `UPDATE library_entries
         SET comment_count = COALESCE(comment_count, 0) + 1, updated_at = NOW()
         WHERE id = $1`,
        [libraryEntryId]
      );

      await client.query('COMMIT');

      const comment = this.formatComment(result.rows[0]);

      logger.info('Library comment added', {
        commentId: comment.id,
        entryId: libraryEntryId,
        authorType,
        entryTitle: entry.rows[0].title,
      });

      return comment;
    } catch (error: any) {
      await client.query('ROLLBACK');
      logger.error('Failed to add library comment', { error: error.message });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get all comments for a library entry (chronological order)
   */
  async getComments(
    libraryEntryId: string,
    userId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<{ comments: LibraryComment[]; total: number }> {
    const [commentsResult, countResult] = await Promise.all([
      this.pool.query(
        `SELECT * FROM library_entry_comments
         WHERE library_entry_id = $1 AND user_id = $2
         ORDER BY created_at ASC
         LIMIT $3 OFFSET $4`,
        [libraryEntryId, userId, limit, offset]
      ),
      this.pool.query(
        `SELECT COUNT(*) as total FROM library_entry_comments
         WHERE library_entry_id = $1 AND user_id = $2`,
        [libraryEntryId, userId]
      ),
    ]);

    return {
      comments: commentsResult.rows.map(this.formatComment),
      total: parseInt(countResult.rows[0].total),
    };
  }

  /**
   * Get recent comments across all entries for a user (for context loading)
   */
  async getRecentComments(
    userId: string,
    limit: number = 20
  ): Promise<Array<LibraryComment & { entry_title: string | null; entry_type: string }>> {
    const result = await this.pool.query(
      `SELECT c.*, le.title as entry_title, le.entry_type
       FROM library_entry_comments c
       JOIN library_entries le ON le.id = c.library_entry_id
       WHERE c.user_id = $1
       ORDER BY c.created_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    return result.rows.map((row: any) => ({
      ...this.formatComment(row),
      entry_title: row.entry_title,
      entry_type: row.entry_type,
    }));
  }

  /**
   * Get comments for multiple entry IDs at once (batch loading for context)
   */
  async getCommentsForEntries(
    entryIds: string[],
    userId: string
  ): Promise<Map<string, LibraryComment[]>> {
    if (entryIds.length === 0) return new Map();

    const result = await this.pool.query(
      `SELECT * FROM library_entry_comments
       WHERE library_entry_id = ANY($1) AND user_id = $2
       ORDER BY created_at ASC`,
      [entryIds, userId]
    );

    const grouped = new Map<string, LibraryComment[]>();
    for (const row of result.rows) {
      const comment = this.formatComment(row);
      const existing = grouped.get(comment.library_entry_id) || [];
      existing.push(comment);
      grouped.set(comment.library_entry_id, existing);
    }

    return grouped;
  }

  /**
   * Delete a comment
   */
  async deleteComment(
    commentId: string,
    userId: string
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(
        `DELETE FROM library_entry_comments
         WHERE id = $1 AND user_id = $2
         RETURNING library_entry_id`,
        [commentId, userId]
      );

      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return false;
      }

      // Update denormalized count
      await client.query(
        `UPDATE library_entries
         SET comment_count = GREATEST(COALESCE(comment_count, 1) - 1, 0), updated_at = NOW()
         WHERE id = $1`,
        [result.rows[0].library_entry_id]
      );

      await client.query('COMMIT');

      logger.info('Library comment deleted', { commentId });
      return true;
    } catch (error: any) {
      await client.query('ROLLBACK');
      logger.error('Failed to delete library comment', { error: error.message });
      throw error;
    } finally {
      client.release();
    }
  }

  private formatComment(row: any): LibraryComment {
    return {
      id: row.id,
      library_entry_id: row.library_entry_id,
      user_id: row.user_id,
      author_type: row.author_type,
      content: row.content,
      metadata: row.metadata || {},
      created_at: new Date(row.created_at).toISOString(),
      updated_at: new Date(row.updated_at).toISOString(),
    };
  }
}

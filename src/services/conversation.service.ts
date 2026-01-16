import { Pool, QueryResult } from 'pg';
import { logger } from '../logger';
import { CreateConversationInput, UpdateConversationInput } from '../validation/conversation.validation';

/**
 * Conversation entity from database
 */
export interface Conversation {
  id: string;
  user_id: string;
  title: string | null;
  user_timezone: string;
  message_count: number;
  created_at: Date;
  updated_at: Date;
}

/**
 * ConversationService
 *
 * Handles all conversation-related business logic and database operations.
 * Conversations are the primary container for messages in Lucid Agent.
 */
export class ConversationService {
  constructor(private pool: Pool) {}

  /**
   * Creates a new conversation for a user
   *
   * @param input - Validated conversation creation data
   * @returns The created conversation
   * @throws Error if user doesn't exist or creation fails
   */
  async createConversation(input: CreateConversationInput): Promise<Conversation> {
    try {
      // Verify user exists and get their timezone
      const userCheck = await this.pool.query(
        'SELECT id, timezone FROM users WHERE id = $1',
        [input.user_id]
      );

      if (userCheck.rows.length === 0) {
        throw new Error('User not found');
      }

      const user = userCheck.rows[0];

      // Create conversation, using user's timezone if not provided
      const result: QueryResult<Conversation> = await this.pool.query(
        `INSERT INTO conversations (user_id, title, user_timezone)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [
          input.user_id,
          input.title || null,
          input.user_timezone || user.timezone || 'UTC',
        ]
      );

      const conversation = result.rows[0];
      logger.info(`Conversation created: ${conversation.id} for user ${input.user_id}`);

      return conversation;
    } catch (error: any) {
      logger.error('Error creating conversation:', error);
      throw new Error(`Failed to create conversation: ${error.message}`);
    }
  }

  /**
   * Finds a conversation by ID
   *
   * @param id - The conversation UUID
   * @returns The conversation if found, null otherwise
   */
  async findById(id: string): Promise<Conversation | null> {
    try {
      const result: QueryResult<Conversation> = await this.pool.query(
        'SELECT * FROM conversations WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        logger.debug(`Conversation not found: ${id}`);
        return null;
      }

      return result.rows[0];
    } catch (error: any) {
      logger.error('Error finding conversation:', error);
      throw new Error(`Failed to find conversation: ${error.message}`);
    }
  }

  /**
   * Lists all conversations for a user, ordered by most recent first
   *
   * @param user_id - The user UUID
   * @param limit - Maximum number of conversations to return
   * @param offset - Number of conversations to skip
   * @returns Array of conversations
   */
  async listByUserId(
    user_id: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<Conversation[]> {
    try {
      const result: QueryResult<Conversation> = await this.pool.query(
        `SELECT * FROM conversations
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [user_id, limit, offset]
      );

      return result.rows;
    } catch (error: any) {
      logger.error('Error listing conversations:', error);
      throw new Error(`Failed to list conversations: ${error.message}`);
    }
  }

  /**
   * Gets the most recent conversation for a user
   * Useful for getting the "active" conversation
   *
   * @param user_id - The user UUID
   * @returns The most recent conversation if exists, null otherwise
   */
  async getMostRecent(user_id: string): Promise<Conversation | null> {
    try {
      const result: QueryResult<Conversation> = await this.pool.query(
        `SELECT * FROM conversations
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [user_id]
      );

      if (result.rows.length === 0) {
        logger.debug(`No conversations found for user: ${user_id}`);
        return null;
      }

      return result.rows[0];
    } catch (error: any) {
      logger.error('Error getting most recent conversation:', error);
      throw new Error(`Failed to get recent conversation: ${error.message}`);
    }
  }

  /**
   * Updates a conversation
   *
   * @param id - The conversation UUID
   * @param input - Validated update data
   * @returns The updated conversation if found, null otherwise
   */
  async updateConversation(
    id: string,
    input: UpdateConversationInput
  ): Promise<Conversation | null> {
    try {
      // Build dynamic update query
      const updates: string[] = [];
      const values: any[] = [];
      let paramCount = 1;

      if (input.title !== undefined) {
        updates.push(`title = $${paramCount++}`);
        values.push(input.title);
      }

      if (input.user_timezone !== undefined) {
        updates.push(`user_timezone = $${paramCount++}`);
        values.push(input.user_timezone);
      }

      // Always update updated_at
      updates.push(`updated_at = NOW()`);

      if (updates.length === 1) {
        // Only updated_at would be updated
        logger.debug(`No fields to update for conversation: ${id}`);
        return await this.findById(id);
      }

      values.push(id);

      const result: QueryResult<Conversation> = await this.pool.query(
        `UPDATE conversations
         SET ${updates.join(', ')}
         WHERE id = $${paramCount}
         RETURNING *`,
        values
      );

      if (result.rows.length === 0) {
        logger.debug(`Conversation not found for update: ${id}`);
        return null;
      }

      const conversation = result.rows[0];
      logger.info(`Conversation updated: ${conversation.id}`);

      return conversation;
    } catch (error: any) {
      logger.error('Error updating conversation:', error);
      throw new Error(`Failed to update conversation: ${error.message}`);
    }
  }

  /**
   * Deletes a conversation by ID
   * Note: This will cascade to messages, facts, evidence, etc.
   *
   * @param id - The conversation UUID
   * @returns True if conversation was deleted, false if not found
   */
  async deleteConversation(id: string): Promise<boolean> {
    try {
      const result = await this.pool.query(
        'DELETE FROM conversations WHERE id = $1',
        [id]
      );

      const deleted = result.rowCount !== null && result.rowCount > 0;

      if (deleted) {
        logger.info(`Conversation deleted: ${id}`);
      } else {
        logger.debug(`Conversation not found for deletion: ${id}`);
      }

      return deleted;
    } catch (error: any) {
      logger.error('Error deleting conversation:', error);
      throw new Error(`Failed to delete conversation: ${error.message}`);
    }
  }

  /**
   * Gets conversation count for a user
   *
   * @param user_id - The user UUID
   * @returns Total number of conversations
   */
  async getCountByUserId(user_id: string): Promise<number> {
    try {
      const result = await this.pool.query(
        'SELECT COUNT(*) as count FROM conversations WHERE user_id = $1',
        [user_id]
      );

      return parseInt(result.rows[0].count, 10);
    } catch (error: any) {
      logger.error('Error counting conversations:', error);
      throw new Error(`Failed to count conversations: ${error.message}`);
    }
  }

  /**
   * Gets conversations with message counts above a threshold
   * Useful for finding "substantial" conversations
   *
   * @param user_id - The user UUID
   * @param minMessages - Minimum message count threshold
   * @returns Array of conversations
   */
  async findByMinMessageCount(
    user_id: string,
    minMessages: number = 5
  ): Promise<Conversation[]> {
    try {
      const result: QueryResult<Conversation> = await this.pool.query(
        `SELECT * FROM conversations
         WHERE user_id = $1 AND message_count >= $2
         ORDER BY created_at DESC`,
        [user_id, minMessages]
      );

      return result.rows;
    } catch (error: any) {
      logger.error('Error finding conversations by message count:', error);
      throw new Error(`Failed to find conversations: ${error.message}`);
    }
  }
}

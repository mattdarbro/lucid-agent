import { Pool, QueryResult } from 'pg';
import { logger } from '../logger';
import { VectorService } from './vector.service';
import { CreateMessageInput, MessageRole } from '../validation/message.validation';

/**
 * Message entity from database
 */
export interface Message {
  id: string;
  conversation_id: string;
  user_id: string;
  role: MessageRole;
  content: string;
  embedding: number[] | null;
  tokens: number | null;
  model: string | null;
  created_at: Date;
}

/**
 * Semantic search result with similarity score
 */
export interface SemanticSearchResult {
  message: Message;
  similarity: number;
}

/**
 * MessageService
 *
 * Handles all message-related operations including:
 * - Saving messages with automatic embedding generation
 * - Semantic search using vector embeddings
 * - Message retrieval and listing
 */
export class MessageService {
  private vectorService: VectorService;

  constructor(
    private pool: Pool,
    vectorService?: VectorService
  ) {
    this.vectorService = vectorService || new VectorService();
  }

  /**
   * Creates a new message with automatic embedding generation
   *
   * @param input - Validated message creation data
   * @returns The created message with embedding
   * @throws Error if conversation doesn't exist or creation fails
   */
  async createMessage(input: CreateMessageInput): Promise<Message> {
    try {
      // Verify conversation exists
      const convCheck = await this.pool.query(
        'SELECT id FROM conversations WHERE id = $1',
        [input.conversation_id]
      );

      if (convCheck.rows.length === 0) {
        throw new Error('Conversation not found');
      }

      // Generate embedding unless explicitly skipped
      let embedding: number[] | null = null;
      if (!input.skip_embedding) {
        try {
          embedding = await this.vectorService.generateEmbedding(input.content);
          logger.debug(`Generated embedding for message (${input.content.length} chars)`);
        } catch (error: any) {
          logger.warn(`Failed to generate embedding: ${error.message}`);
          // Continue without embedding rather than failing the whole operation
        }
      }

      // Estimate token count (rough: ~4 chars per token)
      const tokens = Math.ceil(input.content.length / 4);

      // Insert message
      const result: QueryResult<Message> = await this.pool.query(
        `INSERT INTO messages (conversation_id, user_id, role, content, embedding, tokens, model)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          input.conversation_id,
          input.user_id,
          input.role,
          input.content,
          embedding ? `[${embedding.join(',')}]` : null, // Format for pgvector
          tokens,
          input.model || null,
        ]
      );

      const message = result.rows[0];
      logger.info(`Message created: ${message.id} in conversation ${input.conversation_id}`);

      return message;
    } catch (error: any) {
      logger.error('Error creating message:', {
        message: error.message,
        code: error.code,
        detail: error.detail,
        constraint: error.constraint,
        table: error.table,
        stack: error.stack
      });
      throw new Error(`Failed to create message: ${error.message}`);
    }
  }

  /**
   * Creates multiple messages in a batch (more efficient)
   * Useful for importing conversation history
   *
   * @param messages - Array of message inputs
   * @returns Array of created messages
   */
  async createMessagesBatch(messages: CreateMessageInput[]): Promise<Message[]> {
    if (messages.length === 0) {
      return [];
    }

    try {
      // Generate embeddings in batch for efficiency
      const textsToEmbed = messages
        .filter((m) => !m.skip_embedding)
        .map((m) => m.content);

      let embeddings: number[][] = [];
      if (textsToEmbed.length > 0) {
        try {
          embeddings = await this.vectorService.generateEmbeddings(textsToEmbed);
          logger.info(`Generated ${embeddings.length} embeddings in batch`);
        } catch (error: any) {
          logger.warn(`Failed to generate batch embeddings: ${error.message}`);
        }
      }

      const createdMessages: Message[] = [];
      let embeddingIndex = 0;

      // Insert messages one by one (could be optimized with bulk insert)
      for (const input of messages) {
        const embedding =
          !input.skip_embedding && embeddingIndex < embeddings.length
            ? embeddings[embeddingIndex++]
            : null;

        const tokens = Math.ceil(input.content.length / 4);

        const result: QueryResult<Message> = await this.pool.query(
          `INSERT INTO messages (conversation_id, user_id, role, content, embedding, tokens, model)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [
            input.conversation_id,
            input.user_id,
            input.role,
            input.content,
            embedding ? `[${embedding.join(',')}]` : null,
            tokens,
            input.model || null,
          ]
        );

        createdMessages.push(result.rows[0]);
      }

      logger.info(`Created ${createdMessages.length} messages in batch`);
      return createdMessages;
    } catch (error: any) {
      logger.error('Error creating messages batch:', error);
      throw new Error(`Failed to create messages batch: ${error.message}`);
    }
  }

  /**
   * Finds a message by ID
   *
   * @param id - The message UUID
   * @returns The message if found, null otherwise
   */
  async findById(id: string): Promise<Message | null> {
    try {
      const result: QueryResult<Message> = await this.pool.query(
        'SELECT * FROM messages WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        logger.debug(`Message not found: ${id}`);
        return null;
      }

      return result.rows[0];
    } catch (error: any) {
      logger.error('Error finding message:', error);
      throw new Error(`Failed to find message: ${error.message}`);
    }
  }

  /**
   * Lists messages for a conversation, ordered by creation time
   *
   * @param conversation_id - The conversation UUID
   * @param limit - Maximum number of messages to return
   * @param offset - Number of messages to skip
   * @param role - Optional filter by role
   * @returns Array of messages
   */
  async listByConversation(
    conversation_id: string,
    limit: number = 50,
    offset: number = 0,
    role?: MessageRole
  ): Promise<Message[]> {
    try {
      let query = `
        SELECT * FROM messages
        WHERE conversation_id = $1
      `;

      const params: any[] = [conversation_id];

      if (role) {
        query += ` AND role = $${params.length + 1}`;
        params.push(role);
      }

      query += ` ORDER BY created_at ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);

      const result: QueryResult<Message> = await this.pool.query(query, params);

      return result.rows;
    } catch (error: any) {
      logger.error('Error listing messages:', error);
      throw new Error(`Failed to list messages: ${error.message}`);
    }
  }

  /**
   * Gets recent messages for building chat context
   * Returns messages in chronological order (oldest first)
   *
   * @param conversation_id - The conversation UUID
   * @param limit - Number of recent messages to return
   * @returns Array of recent messages
   */
  async getRecentMessages(conversation_id: string, limit: number = 20): Promise<Message[]> {
    try {
      const result: QueryResult<Message> = await this.pool.query(
        `SELECT * FROM messages
         WHERE conversation_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [conversation_id, limit]
      );

      // Reverse to get chronological order (oldest first)
      return result.rows.reverse();
    } catch (error: any) {
      logger.error('Error getting recent messages:', error);
      throw new Error(`Failed to get recent messages: ${error.message}`);
    }
  }

  /**
   * Performs semantic search across messages using vector similarity
   *
   * @param query - The search query text
   * @param options - Search options (conversation_id, user_id, limit, min_similarity)
   * @returns Array of messages with similarity scores
   */
  async semanticSearch(
    query: string,
    options: {
      conversation_id?: string;
      user_id?: string;
      limit?: number;
      min_similarity?: number;
    } = {}
  ): Promise<SemanticSearchResult[]> {
    try {
      logger.debug('Semantic search options:', {
        query,
        conversation_id: options.conversation_id,
        user_id: options.user_id,
        limit: options.limit,
        min_similarity: options.min_similarity
      });

      // Generate embedding for the query
      const queryEmbedding = await this.vectorService.generateEmbedding(query);

      // Build the search query
      let sql = `
        SELECT *,
          1 - (embedding <=> $1::vector) as similarity
        FROM messages
        WHERE embedding IS NOT NULL
      `;

      const params: any[] = [`[${queryEmbedding.join(',')}]`];

      if (options.conversation_id) {
        sql += ` AND conversation_id = $${params.length + 1}`;
        params.push(options.conversation_id);
      }

      if (options.user_id) {
        sql += ` AND user_id = $${params.length + 1}`;
        params.push(options.user_id);
      }

      if (options.min_similarity !== undefined) {
        sql += ` AND (1 - (embedding <=> $1::vector)) >= $${params.length + 1}`;
        params.push(options.min_similarity);
      }

      sql += ` ORDER BY embedding <=> $1::vector ASC LIMIT $${params.length + 1}`;
      params.push(options.limit || 10);

      logger.debug('Semantic search SQL:', { sql, paramCount: params.length });

      const result = await this.pool.query(sql, params);

      const results: SemanticSearchResult[] = result.rows.map((row) => ({
        message: {
          id: row.id,
          conversation_id: row.conversation_id,
          user_id: row.user_id,
          role: row.role,
          content: row.content,
          embedding: row.embedding,
          tokens: row.tokens,
          model: row.model,
          created_at: row.created_at,
        },
        similarity: parseFloat(row.similarity),
      }));

      logger.info(`Semantic search found ${results.length} results for query: "${query}"`, {
        similarities: results.map(r => ({
          content: r.message.content.substring(0, 50),
          similarity: r.similarity.toFixed(3)
        }))
      });
      return results;
    } catch (error: any) {
      logger.error('Error performing semantic search:', error);
      throw new Error(`Failed to perform semantic search: ${error.message}`);
    }
  }

  /**
   * Gets message count for a conversation
   *
   * @param conversation_id - The conversation UUID
   * @returns Total number of messages
   */
  async getCountByConversation(conversation_id: string): Promise<number> {
    try {
      const result = await this.pool.query(
        'SELECT COUNT(*) as count FROM messages WHERE conversation_id = $1',
        [conversation_id]
      );

      return parseInt(result.rows[0].count, 10);
    } catch (error: any) {
      logger.error('Error counting messages:', error);
      throw new Error(`Failed to count messages: ${error.message}`);
    }
  }

  /**
   * Deletes a message by ID
   *
   * @param id - The message UUID
   * @returns True if message was deleted, false if not found
   */
  async deleteMessage(id: string): Promise<boolean> {
    try {
      const result = await this.pool.query('DELETE FROM messages WHERE id = $1', [id]);

      const deleted = result.rowCount !== null && result.rowCount > 0;

      if (deleted) {
        logger.info(`Message deleted: ${id}`);
      } else {
        logger.debug(`Message not found for deletion: ${id}`);
      }

      return deleted;
    } catch (error: any) {
      logger.error('Error deleting message:', error);
      throw new Error(`Failed to delete message: ${error.message}`);
    }
  }

  /**
   * Gets total token count for a conversation
   * Useful for tracking API usage and costs
   *
   * @param conversation_id - The conversation UUID
   * @returns Total token count
   */
  async getTotalTokens(conversation_id: string): Promise<number> {
    try {
      const result = await this.pool.query(
        'SELECT SUM(tokens) as total FROM messages WHERE conversation_id = $1',
        [conversation_id]
      );

      return parseInt(result.rows[0].total || '0', 10);
    } catch (error: any) {
      logger.error('Error counting tokens:', error);
      throw new Error(`Failed to count tokens: ${error.message}`);
    }
  }
}

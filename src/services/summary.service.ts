import { Pool, QueryResult } from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { VectorService } from './vector.service';
import { MessageService } from './message.service';
import { CreateSummaryInput, GenerateSummaryInput } from '../validation/summary.validation';

export interface Summary {
  id: string;
  conversation_id: string;
  user_id: string;
  user_perspective: string | null;
  model_perspective: string | null;
  conversation_overview: string | null;
  user_embedding: number[] | null;
  model_embedding: number[] | null;
  overview_embedding: number[] | null;
  message_count: number | null;
  created_at: Date;
}

export interface SummarySearchResult {
  summary: Summary;
  similarity: number;
}

/**
 * SummaryService handles conversation summarization with dual perspectives
 */
export class SummaryService {
  private pool: Pool;
  private vectorService: VectorService;
  private messageService: MessageService;
  private anthropic: Anthropic;

  constructor(pool: Pool, vectorService?: VectorService, anthropicApiKey?: string) {
    this.pool = pool;
    this.vectorService = vectorService || new VectorService();
    this.messageService = new MessageService(pool, this.vectorService);
    this.anthropic = new Anthropic({
      apiKey: anthropicApiKey || process.env.ANTHROPIC_API_KEY,
    });
  }

  /**
   * Generates summaries from conversation messages using LLM
   */
  async generateSummary(input: GenerateSummaryInput): Promise<Summary> {
    try {
      // Fetch recent messages
      const messages = await this.messageService.getRecentMessages(
        input.conversation_id,
        input.message_count || 20
      );

      if (messages.length === 0) {
        throw new Error('No messages found in conversation');
      }

      // Format messages for Claude
      const conversationText = messages
        .map((msg) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
        .join('\n\n');

      const systemPrompt = `You are an AI assistant that creates multi-perspective conversation summaries.

Generate three different summaries of this conversation:

1. **User Perspective**: What happened from the user's point of view. What did they ask about? What were they trying to accomplish? What problems did they have?

2. **Model Perspective**: What the AI assistant understood and learned. What patterns emerged? What was the user really asking for beneath their questions? What context was provided?

3. **Conversation Overview**: An objective summary of what actually transpired. Key topics discussed, decisions made, information exchanged, and outcomes.

CRITICAL: Respond with ONLY valid JSON in this exact format:
{
  "user_perspective": "From the user's viewpoint...",
  "model_perspective": "What the AI understood...",
  "conversation_overview": "Objectively, this conversation..."
}`;

      logger.debug('Generating summary for conversation:', {
        conversation_id: input.conversation_id,
        message_count: messages.length,
      });

      const response = await this.anthropic.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 1500,
        temperature: 0.3,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `Summarize this conversation from all three perspectives:\n\n${conversationText}`,
          },
        ],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type from Claude');
      }

      // Parse JSON response
      let text = content.text.trim();
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        text = jsonMatch[1].trim();
      }

      const summaryData = JSON.parse(text);

      // Create summary with the generated perspectives
      return await this.createSummary({
        conversation_id: input.conversation_id,
        user_id: input.user_id,
        user_perspective: summaryData.user_perspective,
        model_perspective: summaryData.model_perspective,
        conversation_overview: summaryData.conversation_overview,
        message_count: messages.length,
      });
    } catch (error: any) {
      logger.error('Error generating summary:', {
        message: error.message,
        conversation_id: input.conversation_id,
      });
      throw new Error(`Failed to generate summary: ${error.message}`);
    }
  }

  /**
   * Creates a summary with automatic embedding generation
   */
  async createSummary(input: CreateSummaryInput): Promise<Summary> {
    try {
      // Generate embeddings for all perspectives
      let userEmbedding: number[] | null = null;
      let modelEmbedding: number[] | null = null;
      let overviewEmbedding: number[] | null = null;

      if (!input.skip_embeddings) {
        try {
          if (input.user_perspective) {
            userEmbedding = await this.vectorService.generateEmbedding(input.user_perspective);
          }
          if (input.model_perspective) {
            modelEmbedding = await this.vectorService.generateEmbedding(input.model_perspective);
          }
          if (input.conversation_overview) {
            overviewEmbedding = await this.vectorService.generateEmbedding(input.conversation_overview);
          }
        } catch (embeddingError: any) {
          logger.warn('Failed to generate embeddings for summary, storing without them:', {
            error: embeddingError.message,
          });
        }
      }

      const result: QueryResult<Summary> = await this.pool.query(
        `INSERT INTO summaries
         (conversation_id, user_id, user_perspective, model_perspective, conversation_overview,
          user_embedding, model_embedding, overview_embedding, message_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          input.conversation_id,
          input.user_id,
          input.user_perspective || null,
          input.model_perspective || null,
          input.conversation_overview || null,
          userEmbedding ? `[${userEmbedding.join(',')}]` : null,
          modelEmbedding ? `[${modelEmbedding.join(',')}]` : null,
          overviewEmbedding ? `[${overviewEmbedding.join(',')}]` : null,
          input.message_count || null,
        ]
      );

      const summary = result.rows[0];
      logger.info(`Summary created: ${summary.id} for conversation ${input.conversation_id}`);

      return summary;
    } catch (error: any) {
      logger.error('Error creating summary:', error);
      throw new Error(`Failed to create summary: ${error.message}`);
    }
  }

  /**
   * Finds a summary by ID
   */
  async findById(id: string): Promise<Summary | null> {
    try {
      const result: QueryResult<Summary> = await this.pool.query(
        'SELECT * FROM summaries WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        logger.debug(`Summary not found: ${id}`);
        return null;
      }

      return result.rows[0];
    } catch (error: any) {
      logger.error('Error finding summary:', error);
      throw new Error(`Failed to find summary: ${error.message}`);
    }
  }

  /**
   * Lists summaries for a conversation
   */
  async listByConversation(
    conversation_id: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<Summary[]> {
    try {
      const result: QueryResult<Summary> = await this.pool.query(
        `SELECT * FROM summaries
         WHERE conversation_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [conversation_id, options.limit || 50, options.offset || 0]
      );

      return result.rows;
    } catch (error: any) {
      logger.error('Error listing summaries:', error);
      throw new Error(`Failed to list summaries: ${error.message}`);
    }
  }

  /**
   * Lists summaries for a user
   */
  async listByUser(
    user_id: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<Summary[]> {
    try {
      const result: QueryResult<Summary> = await this.pool.query(
        `SELECT * FROM summaries
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [user_id, options.limit || 50, options.offset || 0]
      );

      return result.rows;
    } catch (error: any) {
      logger.error('Error listing user summaries:', error);
      throw new Error(`Failed to list user summaries: ${error.message}`);
    }
  }

  /**
   * Semantic search across summaries
   */
  async semanticSearch(
    query: string,
    options: {
      user_id?: string;
      conversation_id?: string;
      perspective?: 'user' | 'model' | 'overview';
      limit?: number;
      min_similarity?: number;
    } = {}
  ): Promise<SummarySearchResult[]> {
    try {
      // Generate embedding for query
      const queryEmbedding = await this.vectorService.generateEmbedding(query);

      // Determine which embedding column to search
      const perspective = options.perspective || 'overview';
      const embeddingColumn = `${perspective}_embedding`;

      // Build query
      let sql = `
        SELECT *,
          1 - (${embeddingColumn} <=> $1::vector) as similarity
        FROM summaries
        WHERE ${embeddingColumn} IS NOT NULL
      `;

      const params: any[] = [`[${queryEmbedding.join(',')}]`];

      if (options.user_id) {
        sql += ` AND user_id = $${params.length + 1}`;
        params.push(options.user_id);
      }

      if (options.conversation_id) {
        sql += ` AND conversation_id = $${params.length + 1}`;
        params.push(options.conversation_id);
      }

      if (options.min_similarity !== undefined) {
        sql += ` AND (1 - (${embeddingColumn} <=> $1::vector)) >= $${params.length + 1}`;
        params.push(options.min_similarity);
      }

      sql += ` ORDER BY ${embeddingColumn} <=> $1::vector ASC LIMIT $${params.length + 1}`;
      params.push(options.limit || 10);

      const result = await this.pool.query(sql, params);

      return result.rows.map((row) => ({
        summary: {
          id: row.id,
          conversation_id: row.conversation_id,
          user_id: row.user_id,
          user_perspective: row.user_perspective,
          model_perspective: row.model_perspective,
          conversation_overview: row.conversation_overview,
          user_embedding: row.user_embedding,
          model_embedding: row.model_embedding,
          overview_embedding: row.overview_embedding,
          message_count: row.message_count,
          created_at: row.created_at,
        },
        similarity: row.similarity,
      }));
    } catch (error: any) {
      logger.error('Error in semantic search for summaries:', error);
      throw new Error(`Semantic search failed: ${error.message}`);
    }
  }

  /**
   * Deletes a summary
   */
  async deleteSummary(id: string): Promise<boolean> {
    try {
      const result = await this.pool.query('DELETE FROM summaries WHERE id = $1', [id]);

      return (result.rowCount ?? 0) > 0;
    } catch (error: any) {
      logger.error('Error deleting summary:', error);
      throw new Error(`Failed to delete summary: ${error.message}`);
    }
  }
}

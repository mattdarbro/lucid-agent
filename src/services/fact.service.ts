import { Pool, QueryResult } from 'pg';
import { logger } from '../logger';
import { VectorService } from './vector.service';
import Anthropic from '@anthropic-ai/sdk';
import {
  CreateFactInput,
  UpdateFactInput,
  FactCategory,
} from '../validation/fact.validation';

/**
 * Fact entity from database
 */
export interface Fact {
  id: string;
  user_id: string;
  content: string;
  category: FactCategory | null;
  confidence: number;
  evidence_count: number;
  embedding: number[] | null;
  is_active: boolean;
  first_mentioned_at: Date;
  last_mentioned_at: Date;
  created_at: Date;
  updated_at: Date;
}

/**
 * Semantic search result with similarity score
 */
export interface FactSearchResult {
  fact: Fact;
  similarity: number;
}

/**
 * Extracted fact from LLM
 */
export interface ExtractedFact {
  content: string;
  category: FactCategory;
  confidence: number;
}

/**
 * FactService
 *
 * Handles all fact-related operations including:
 * - Extracting facts from messages using LLM
 * - Storing facts with automatic embedding generation
 * - Semantic search using vector embeddings
 * - Fact retrieval and management
 */
export class FactService {
  private vectorService: VectorService;
  private anthropic: Anthropic;

  constructor(
    private pool: Pool,
    vectorService?: VectorService,
    anthropicApiKey?: string
  ) {
    this.vectorService = vectorService || new VectorService();
    this.anthropic = new Anthropic({
      apiKey: anthropicApiKey || process.env.ANTHROPIC_API_KEY,
    });
  }

  /**
   * Extracts facts from message content using Claude
   *
   * @param messages - Array of message contents to analyze
   * @param userId - The user ID for context
   * @returns Array of extracted facts
   */
  async extractFactsFromMessages(
    messages: string[],
    userId: string
  ): Promise<ExtractedFact[]> {
    try {
      const combinedMessages = messages.join('\n\n');

      const systemPrompt = `You are an AI assistant that extracts factual information about users from conversations. You are VERY good at finding facts even in brief exchanges.

Extract ANY facts about the USER from this conversation. Messages are labeled as "User:" or "Assistant:". Focus on what we learn about the User.

Categories:
- personal: Name, age, location, occupation, identity
- preference: Likes, dislikes, favorites, tastes
- goal: Aspirations, plans, things they want to accomplish
- relationship: Family, friends, colleagues, pets
- skill: Abilities, expertise, knowledge areas
- habit: Regular behaviors, routines, patterns
- belief: Opinions, values, worldviews
- experience: Past events, memories, things they've done
- health: Medical, fitness, wellness
- other: Anything else meaningful

IMPORTANT EXTRACTION RULES:
1. Extract facts from BOTH what user says AND what the conversation reveals about them
2. Be VERY generous - extract anything that tells us about the user
3. Even short conversations have facts:
   - "I'm testing this" → {"content": "User is testing an API", "category": "experience", "confidence": 0.9}
   - "I like pizza" → {"content": "User likes pizza", "category": "preference", "confidence": 0.95}
   - "I work in SF" → {"content": "User works in San Francisco", "category": "personal", "confidence": 0.9}
4. Infer reasonable facts from context:
   - User asking about code → {"content": "User is interested in programming", "category": "preference", "confidence": 0.7}
   - User testing features → {"content": "User is evaluating the system", "category": "experience", "confidence": 0.8}
5. Confidence levels: 0.9-1.0 = stated explicitly, 0.6-0.8 = clearly implied, 0.4-0.5 = weakly implied

CRITICAL: Respond with ONLY a JSON array. NO explanations, NO markdown, NO text outside the array.

Examples:
User: "Hi, I'm Matt from California"
Output: [{"content": "User's name is Matt", "category": "personal", "confidence": 0.95}, {"content": "User is from California", "category": "personal", "confidence": 0.95}]

User: "I'm testing your API"
Output: [{"content": "User is testing an API", "category": "experience", "confidence": 0.9}, {"content": "User is interested in software development", "category": "preference", "confidence": 0.7}]

NOW extract facts from the conversation below. If you truly find NO facts (very rare), return []`;

      logger.info('Calling Anthropic API for fact extraction:', {
        model: 'claude-sonnet-4-5-20250929',
        message_count: messages.length,
        combined_length: combinedMessages.length,
        system_prompt_length: systemPrompt.length
      });

      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 2000,
        temperature: 0.2, // Low temperature for consistent fact extraction
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `Extract facts from these messages:\n\n${combinedMessages}`,
          },
        ],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        logger.warn('Unexpected response type from Claude');
        return [];
      }

      // Parse the JSON response
      let text = content.text.trim();

      // Log what we received from LLM for debugging
      logger.info('LLM fact extraction response:', {
        response_preview: text.substring(0, 500),
        response_length: text.length
      });

      // Extract JSON from markdown code blocks if present
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        text = jsonMatch[1].trim();
        logger.info('Extracted JSON from markdown code block');
      }

      // Check if response looks like an error message or explanation
      if (text.toLowerCase().includes('not enough') ||
          text.toLowerCase().includes('cannot extract') ||
          text.toLowerCase().includes('no facts') && !text.startsWith('[')) {
        logger.info('LLM indicated no facts could be extracted from messages');
        return [];
      }

      // Try to parse JSON
      let extractedFacts: ExtractedFact[];
      try {
        extractedFacts = JSON.parse(text);
      } catch (parseError) {
        logger.warn('Failed to parse LLM response as JSON:', {
          response: text.substring(0, 200),
          error: (parseError as Error).message
        });

        // Try to find JSON array within the text
        const arrayMatch = text.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          try {
            extractedFacts = JSON.parse(arrayMatch[0]);
            logger.info('Successfully extracted JSON array from response');
          } catch {
            logger.error('Could not parse extracted array');
            return [];
          }
        } else {
          logger.error('No JSON array found in response');
          return [];
        }
      }

      // Validate that we got an array
      if (!Array.isArray(extractedFacts)) {
        logger.warn('LLM response was not an array');
        return [];
      }

      logger.info(`Extracted ${extractedFacts.length} facts from ${messages.length} messages`);

      return extractedFacts;
    } catch (error: any) {
      logger.error('Error extracting facts with LLM:', {
        message: error.message,
        status: error.status,
        error_type: error.type,
        error_code: error.code,
        error_details: error.error,
        full_error: JSON.stringify(error, null, 2)
      });
      throw new Error(`Failed to extract facts: ${error.message}`);
    }
  }

  /**
   * Creates a new fact with automatic embedding generation
   *
   * @param input - Validated fact creation data
   * @returns The created fact
   */
  async createFact(input: CreateFactInput): Promise<Fact> {
    try {
      // Verify user exists
      const userCheck = await this.pool.query(
        'SELECT id FROM users WHERE id = $1',
        [input.user_id]
      );

      if (userCheck.rows.length === 0) {
        throw new Error('User not found');
      }

      // Generate embedding unless explicitly skipped
      let embedding: number[] | null = null;
      if (!input.skip_embedding) {
        try {
          embedding = await this.vectorService.generateEmbedding(input.content);
          logger.debug(`Generated embedding for fact (${input.content.length} chars)`);
        } catch (error: any) {
          logger.warn(`Failed to generate embedding: ${error.message}`);
          // Continue without embedding rather than failing
        }
      }

      const result: QueryResult<Fact> = await this.pool.query(
        `INSERT INTO facts (user_id, content, category, confidence, embedding, is_active)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          input.user_id,
          input.content,
          input.category || null,
          input.confidence !== undefined ? input.confidence : 0.500,
          embedding ? `[${embedding.join(',')}]` : null,
          input.is_active !== undefined ? input.is_active : true,
        ]
      );

      const fact = result.rows[0];
      logger.info(`Fact created: ${fact.id} for user ${input.user_id}`);

      return fact;
    } catch (error: any) {
      logger.error('Error creating fact:', {
        message: error.message,
        code: error.code,
        detail: error.detail,
      });
      throw new Error(`Failed to create fact: ${error.message}`);
    }
  }

  /**
   * Finds a fact by ID
   *
   * @param id - The fact UUID
   * @returns The fact if found, null otherwise
   */
  async findById(id: string): Promise<Fact | null> {
    try {
      const result: QueryResult<Fact> = await this.pool.query(
        'SELECT * FROM facts WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        logger.debug(`Fact not found: ${id}`);
        return null;
      }

      return result.rows[0];
    } catch (error: any) {
      logger.error('Error finding fact:', error);
      throw new Error(`Failed to find fact: ${error.message}`);
    }
  }

  /**
   * Lists facts for a user with optional filtering
   *
   * @param user_id - The user UUID
   * @param options - Filter options
   * @returns Array of facts
   */
  async listByUser(
    user_id: string,
    options: {
      limit?: number;
      offset?: number;
      category?: FactCategory;
      is_active?: boolean;
      min_confidence?: number;
    } = {}
  ): Promise<Fact[]> {
    try {
      let query = 'SELECT * FROM facts WHERE user_id = $1';
      const params: any[] = [user_id];

      if (options.category) {
        query += ` AND category = $${params.length + 1}`;
        params.push(options.category);
      }

      if (options.is_active !== undefined) {
        query += ` AND is_active = $${params.length + 1}`;
        params.push(options.is_active);
      }

      if (options.min_confidence !== undefined) {
        query += ` AND confidence >= $${params.length + 1}`;
        params.push(options.min_confidence);
      }

      query += ` ORDER BY confidence DESC, last_mentioned_at DESC`;
      query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(options.limit || 50, options.offset || 0);

      const result: QueryResult<Fact> = await this.pool.query(query, params);

      return result.rows;
    } catch (error: any) {
      logger.error('Error listing facts:', error);
      throw new Error(`Failed to list facts: ${error.message}`);
    }
  }

  /**
   * Updates a fact
   *
   * @param id - The fact UUID
   * @param updates - Fields to update
   * @returns The updated fact if found, null otherwise
   */
  async updateFact(id: string, updates: UpdateFactInput): Promise<Fact | null> {
    try {
      const setClauses: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      if (updates.content !== undefined) {
        setClauses.push(`content = $${paramIndex++}`);
        params.push(updates.content);
      }

      if (updates.category !== undefined) {
        setClauses.push(`category = $${paramIndex++}`);
        params.push(updates.category);
      }

      if (updates.confidence !== undefined) {
        setClauses.push(`confidence = $${paramIndex++}`);
        params.push(updates.confidence);
      }

      if (updates.is_active !== undefined) {
        setClauses.push(`is_active = $${paramIndex++}`);
        params.push(updates.is_active);
      }

      if (setClauses.length === 0) {
        // No updates provided
        return this.findById(id);
      }

      setClauses.push(`updated_at = NOW()`);
      params.push(id);

      const query = `
        UPDATE facts
        SET ${setClauses.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING *
      `;

      const result: QueryResult<Fact> = await this.pool.query(query, params);

      if (result.rows.length === 0) {
        logger.debug(`Fact not found for update: ${id}`);
        return null;
      }

      logger.info(`Fact updated: ${id}`);
      return result.rows[0];
    } catch (error: any) {
      logger.error('Error updating fact:', error);
      throw new Error(`Failed to update fact: ${error.message}`);
    }
  }

  /**
   * Deletes a fact
   *
   * @param id - The fact UUID
   * @returns True if deleted, false if not found
   */
  async deleteFact(id: string): Promise<boolean> {
    try {
      const result = await this.pool.query('DELETE FROM facts WHERE id = $1', [id]);

      const deleted = result.rowCount !== null && result.rowCount > 0;

      if (deleted) {
        logger.info(`Fact deleted: ${id}`);
      } else {
        logger.debug(`Fact not found for deletion: ${id}`);
      }

      return deleted;
    } catch (error: any) {
      logger.error('Error deleting fact:', error);
      throw new Error(`Failed to delete fact: ${error.message}`);
    }
  }

  /**
   * Performs semantic search across facts using vector similarity
   *
   * @param query - The search query text
   * @param options - Search options
   * @returns Array of facts with similarity scores
   */
  async semanticSearch(
    query: string,
    options: {
      user_id?: string;
      category?: FactCategory;
      is_active?: boolean;
      limit?: number;
      min_similarity?: number;
      min_confidence?: number;
    } = {}
  ): Promise<FactSearchResult[]> {
    try {
      logger.debug('Fact semantic search options:', options);

      // Generate embedding for the query
      const queryEmbedding = await this.vectorService.generateEmbedding(query);

      // Build the search query
      let sql = `
        SELECT *,
          1 - (embedding <=> $1::vector) as similarity
        FROM facts
        WHERE embedding IS NOT NULL
      `;

      const params: any[] = [`[${queryEmbedding.join(',')}]`];

      if (options.user_id) {
        sql += ` AND user_id = $${params.length + 1}`;
        params.push(options.user_id);
      }

      if (options.category) {
        sql += ` AND category = $${params.length + 1}`;
        params.push(options.category);
      }

      if (options.is_active !== undefined) {
        sql += ` AND is_active = $${params.length + 1}`;
        params.push(options.is_active);
      }

      if (options.min_similarity !== undefined) {
        sql += ` AND (1 - (embedding <=> $1::vector)) >= $${params.length + 1}`;
        params.push(options.min_similarity);
      }

      if (options.min_confidence !== undefined) {
        sql += ` AND confidence >= $${params.length + 1}`;
        params.push(options.min_confidence);
      }

      sql += ` ORDER BY embedding <=> $1::vector ASC LIMIT $${params.length + 1}`;
      params.push(options.limit || 10);

      const result = await this.pool.query(sql, params);

      const results: FactSearchResult[] = result.rows.map((row) => ({
        fact: {
          id: row.id,
          user_id: row.user_id,
          content: row.content,
          category: row.category,
          confidence: parseFloat(row.confidence),
          evidence_count: row.evidence_count,
          embedding: row.embedding,
          is_active: row.is_active,
          first_mentioned_at: row.first_mentioned_at,
          last_mentioned_at: row.last_mentioned_at,
          created_at: row.created_at,
          updated_at: row.updated_at,
        },
        similarity: parseFloat(row.similarity),
      }));

      logger.info(`Fact search found ${results.length} results for query: "${query}"`);
      return results;
    } catch (error: any) {
      logger.error('Error performing fact semantic search:', error);
      throw new Error(`Failed to perform fact search: ${error.message}`);
    }
  }

  /**
   * Gets fact count for a user
   *
   * @param user_id - The user UUID
   * @param is_active - Optional filter by active status
   * @returns Total number of facts
   */
  async getCountByUser(user_id: string, is_active?: boolean): Promise<number> {
    try {
      let query = 'SELECT COUNT(*) as count FROM facts WHERE user_id = $1';
      const params: any[] = [user_id];

      if (is_active !== undefined) {
        query += ` AND is_active = $${params.length + 1}`;
        params.push(is_active);
      }

      const result = await this.pool.query(query, params);
      return parseInt(result.rows[0].count, 10);
    } catch (error: any) {
      logger.error('Error counting facts:', error);
      throw new Error(`Failed to count facts: ${error.message}`);
    }
  }
}

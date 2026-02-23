import { Pool } from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { VectorService } from './vector.service';
import { MessageService, SemanticSearchResult } from './message.service';
import { withRetry } from '../utils/anthropic-errors';

/**
 * A single piece of retrieved context
 */
export interface ContextChunk {
  id: string;
  source: 'message' | 'fact' | 'library' | 'summary';
  content: string;
  similarity: number;
  metadata?: {
    role?: string;
    category?: string;
    title?: string;
    created_at?: Date;
    conversation_id?: string;
  };
}

/**
 * Result from the recursive context search
 */
export interface RecursiveSearchResult {
  /** The original query */
  query: string;
  /** All retrieved context chunks, deduplicated and ranked */
  context: ContextChunk[];
  /** Number of search iterations performed */
  iterations: number;
  /** Whether the search was deemed sufficient */
  sufficient: boolean;
  /** Search queries used at each iteration */
  searchQueries: string[][];
  /** Total tokens of context gathered (estimated) */
  totalTokens: number;
  /** Reasoning from the LLM about context sufficiency */
  reasoning?: string;
}

/**
 * Configuration for recursive context search
 */
export interface RecursiveSearchConfig {
  /** Maximum recursion depth (default: 3) */
  maxDepth?: number;
  /** Maximum context chunks to return (default: 20) */
  maxChunks?: number;
  /** Minimum similarity threshold for inclusion (default: 0.4) */
  minSimilarity?: number;
  /** Model for context evaluation (default: claude-3-5-haiku-20241022) */
  evaluationModel?: string;
  /** Maximum tokens for evaluation calls (default: 500) */
  evaluationMaxTokens?: number;
  /** Whether to search across all user data or just current conversation */
  searchScope?: 'conversation' | 'user' | 'all';
  /** Target token budget for context (default: 4000) */
  targetTokenBudget?: number;
}

/**
 * Internal state for search iteration
 */
interface SearchState {
  collectedChunks: Map<string, ContextChunk>;
  searchQueries: string[][];
  iteration: number;
  sufficient: boolean;
  reasoning?: string;
}

/**
 * RecursiveContextSearchService
 *
 * Implements the "infinite context" pattern through iterative search:
 * 1. Start with the user's query
 * 2. Perform semantic search across messages, facts, and library entries
 * 3. Use an LLM to evaluate: "Is this context sufficient to answer the query?"
 * 4. If not, the LLM generates new search queries to find missing information
 * 5. Repeat until sufficient context is gathered or max depth is reached
 *
 * This allows handling arbitrarily long conversation histories by retrieving
 * only the relevant context rather than feeding everything into the context window.
 */
export class RecursiveContextSearchService {
  private pool: Pool;
  private anthropic: Anthropic;
  private vectorService: VectorService;
  private messageService: MessageService;

  private readonly DEFAULT_CONFIG: Required<RecursiveSearchConfig> = {
    maxDepth: 3,
    maxChunks: 20,
    minSimilarity: 0.4,
    evaluationModel: 'claude-3-5-haiku-20241022',
    evaluationMaxTokens: 500,
    searchScope: 'user',
    targetTokenBudget: 4000,
  };

  constructor(pool: Pool, anthropicApiKey?: string) {
    this.pool = pool;
    this.anthropic = new Anthropic({
      apiKey: anthropicApiKey || process.env.ANTHROPIC_API_KEY,
    });
    this.vectorService = new VectorService();
    this.messageService = new MessageService(pool, this.vectorService);
  }

  /**
   * Main entry point: recursively search for relevant context
   *
   * @param query - The user's question or message
   * @param userId - The user ID to search within
   * @param conversationId - Optional conversation ID to prioritize
   * @param config - Search configuration options
   * @returns Aggregated relevant context
   */
  async searchRecursively(
    query: string,
    userId: string,
    conversationId?: string,
    config?: RecursiveSearchConfig
  ): Promise<RecursiveSearchResult> {
    const cfg = { ...this.DEFAULT_CONFIG, ...config };

    logger.info('Starting recursive context search', {
      query: query.substring(0, 100),
      userId,
      conversationId,
      config: cfg,
    });

    // Initialize search state
    const state: SearchState = {
      collectedChunks: new Map(),
      searchQueries: [],
      iteration: 0,
      sufficient: false,
    };

    // Initial search with the original query
    let currentQueries = [query];

    while (state.iteration < cfg.maxDepth && !state.sufficient) {
      state.searchQueries.push(currentQueries);

      // Execute searches for all current queries
      for (const searchQuery of currentQueries) {
        const chunks = await this.executeSearch(
          searchQuery,
          userId,
          conversationId,
          cfg
        );

        // Add new chunks to collection (deduplicating by ID)
        for (const chunk of chunks) {
          if (!state.collectedChunks.has(chunk.id)) {
            state.collectedChunks.set(chunk.id, chunk);
          }
        }
      }

      state.iteration++;

      // Check if we've collected enough context
      const currentContext = this.rankAndLimitChunks(
        Array.from(state.collectedChunks.values()),
        cfg.maxChunks
      );

      // Evaluate if context is sufficient
      const evaluation = await this.evaluateContext(
        query,
        currentContext,
        cfg
      );

      state.sufficient = evaluation.sufficient;
      state.reasoning = evaluation.reasoning;

      if (!state.sufficient && state.iteration < cfg.maxDepth) {
        // Generate new search queries to find missing context
        currentQueries = evaluation.newQueries || [];

        if (currentQueries.length === 0) {
          // LLM couldn't generate more queries, stop
          logger.debug('No more search queries generated, stopping search');
          break;
        }

        logger.debug('Generated new search queries', {
          iteration: state.iteration,
          queries: currentQueries,
        });
      }
    }

    // Final ranking and limiting
    const finalContext = this.rankAndLimitChunks(
      Array.from(state.collectedChunks.values()),
      cfg.maxChunks
    );

    const totalTokens = this.estimateTokens(finalContext);

    logger.info('Recursive context search complete', {
      iterations: state.iteration,
      chunksCollected: finalContext.length,
      totalTokens,
      sufficient: state.sufficient,
    });

    return {
      query,
      context: finalContext,
      iterations: state.iteration,
      sufficient: state.sufficient,
      searchQueries: state.searchQueries,
      totalTokens,
      reasoning: state.reasoning,
    };
  }

  /**
   * Execute semantic search across all relevant sources
   */
  private async executeSearch(
    query: string,
    userId: string,
    conversationId: string | undefined,
    config: Required<RecursiveSearchConfig>
  ): Promise<ContextChunk[]> {
    const chunks: ContextChunk[] = [];

    try {
      // Search messages
      const messageResults = await this.searchMessages(
        query,
        userId,
        conversationId,
        config
      );
      chunks.push(...messageResults);

      // Search facts
      const factResults = await this.searchFacts(query, userId, config);
      chunks.push(...factResults);

      // Search library entries
      const libraryResults = await this.searchLibrary(query, userId, config);
      chunks.push(...libraryResults);

      // Search summaries
      const summaryResults = await this.searchSummaries(query, userId, config);
      chunks.push(...summaryResults);

    } catch (error: any) {
      logger.error('Error executing search', { error: error.message, query });
    }

    return chunks;
  }

  /**
   * Search messages using semantic similarity
   */
  private async searchMessages(
    query: string,
    userId: string,
    conversationId: string | undefined,
    config: Required<RecursiveSearchConfig>
  ): Promise<ContextChunk[]> {
    try {
      const options: {
        user_id?: string;
        conversation_id?: string;
        limit: number;
        min_similarity: number;
      } = {
        limit: 10,
        min_similarity: config.minSimilarity,
      };

      if (config.searchScope === 'conversation' && conversationId) {
        options.conversation_id = conversationId;
      } else if (config.searchScope === 'user') {
        options.user_id = userId;
      }

      const results = await this.messageService.semanticSearch(query, options);

      return results.map((r: SemanticSearchResult) => ({
        id: `msg_${r.message.id}`,
        source: 'message' as const,
        content: r.message.content,
        similarity: r.similarity,
        metadata: {
          role: r.message.role,
          created_at: r.message.created_at,
          conversation_id: r.message.conversation_id,
        },
      }));
    } catch (error: any) {
      logger.warn('Error searching messages', { error: error.message });
      return [];
    }
  }

  /**
   * Search facts using semantic similarity
   */
  private async searchFacts(
    query: string,
    userId: string,
    config: Required<RecursiveSearchConfig>
  ): Promise<ContextChunk[]> {
    try {
      const queryEmbedding = await this.vectorService.generateEmbedding(query);

      const result = await this.pool.query(
        `SELECT id, content, category, confidence,
                1 - (embedding <=> $1::vector) as similarity
         FROM facts
         WHERE user_id = $2
           AND is_active = true
           AND embedding IS NOT NULL
           AND (1 - (embedding <=> $1::vector)) >= $3
         ORDER BY similarity DESC
         LIMIT 10`,
        [`[${queryEmbedding.join(',')}]`, userId, config.minSimilarity]
      );

      return result.rows.map((row: any) => ({
        id: `fact_${row.id}`,
        source: 'fact' as const,
        content: row.content,
        similarity: parseFloat(row.similarity),
        metadata: {
          category: row.category,
        },
      }));
    } catch (error: any) {
      logger.warn('Error searching facts', { error: error.message });
      return [];
    }
  }

  /**
   * Search library entries using semantic similarity
   */
  private async searchLibrary(
    query: string,
    userId: string,
    config: Required<RecursiveSearchConfig>
  ): Promise<ContextChunk[]> {
    try {
      const queryEmbedding = await this.vectorService.generateEmbedding(query);

      const result = await this.pool.query(
        `SELECT id, title, content,
                1 - (embedding <=> $1::vector) as similarity,
                (1 - (embedding <=> $1::vector)) *
                  (1.0 / (1.0 + EXTRACT(EPOCH FROM (NOW() - created_at)) / (86400 * 60)))
                  as recency_score
         FROM library_entries
         WHERE user_id = $2
           AND embedding IS NOT NULL
           AND (1 - (embedding <=> $1::vector)) >= $3
         ORDER BY recency_score DESC
         LIMIT 5`,
        [`[${queryEmbedding.join(',')}]`, userId, config.minSimilarity]
      );

      return result.rows.map((row: any) => ({
        id: `lib_${row.id}`,
        source: 'library' as const,
        content: row.content,
        similarity: parseFloat(row.similarity),
        metadata: {
          title: row.title,
        },
      }));
    } catch (error: any) {
      logger.warn('Error searching library', { error: error.message });
      return [];
    }
  }

  /**
   * Search summaries using semantic similarity
   */
  private async searchSummaries(
    query: string,
    userId: string,
    config: Required<RecursiveSearchConfig>
  ): Promise<ContextChunk[]> {
    try {
      const queryEmbedding = await this.vectorService.generateEmbedding(query);

      const result = await this.pool.query(
        `SELECT s.id, s.user_perspective, s.model_perspective, s.conversation_id,
                1 - (s.embedding <=> $1::vector) as similarity
         FROM summaries s
         JOIN conversations c ON s.conversation_id = c.id
         WHERE c.user_id = $2
           AND s.embedding IS NOT NULL
           AND (1 - (s.embedding <=> $1::vector)) >= $3
         ORDER BY similarity DESC
         LIMIT 5`,
        [`[${queryEmbedding.join(',')}]`, userId, config.minSimilarity]
      );

      return result.rows.map((row: any) => ({
        id: `sum_${row.id}`,
        source: 'summary' as const,
        content: `User perspective: ${row.user_perspective || 'N/A'}\nModel perspective: ${row.model_perspective || 'N/A'}`,
        similarity: parseFloat(row.similarity),
        metadata: {
          conversation_id: row.conversation_id,
        },
      }));
    } catch (error: any) {
      logger.warn('Error searching summaries', { error: error.message });
      return [];
    }
  }

  /**
   * Use LLM to evaluate if gathered context is sufficient
   */
  private async evaluateContext(
    query: string,
    context: ContextChunk[],
    config: Required<RecursiveSearchConfig>
  ): Promise<{
    sufficient: boolean;
    reasoning: string;
    newQueries?: string[];
  }> {
    if (context.length === 0) {
      return {
        sufficient: false,
        reasoning: 'No context found',
        newQueries: [query],
      };
    }

    // Format context for evaluation
    const contextText = context
      .map((c, i) => `[${i + 1}] (${c.source}, sim=${c.similarity.toFixed(2)}): ${c.content}`)
      .join('\n\n');

    const estimatedTokens = this.estimateTokens(context);

    // If we've hit the token budget, consider it sufficient
    if (estimatedTokens >= config.targetTokenBudget) {
      return {
        sufficient: true,
        reasoning: `Token budget reached (${estimatedTokens} tokens)`,
      };
    }

    const systemPrompt = `You are a context evaluation assistant. Your job is to determine if the retrieved context is sufficient to answer a user's question.

Analyze the query and retrieved context. Respond in JSON format:
{
  "sufficient": true/false,
  "reasoning": "Brief explanation of why context is or isn't sufficient",
  "missing_information": ["list of specific information that would help answer the query"],
  "new_search_queries": ["specific search queries to find missing information"]
}

Be conservative - if the context seems relevant and covers the main aspects of the query, mark it as sufficient.
If information is missing, generate 1-3 specific, targeted search queries to find it.`;

    const userPrompt = `Query: "${query}"

Retrieved Context (${context.length} chunks, ~${estimatedTokens} tokens):
${contextText}

Is this context sufficient to answer the query? If not, what specific information is missing and what search queries would help find it?`;

    try {
      const response = await withRetry(
        () =>
          this.anthropic.messages.create({
            model: config.evaluationModel,
            max_tokens: config.evaluationMaxTokens,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }],
          }),
        { maxRetries: 2, initialDelayMs: 500 }
      ) as any;

      const textContent = response.content.find((c: any) => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        return { sufficient: true, reasoning: 'Could not evaluate context' };
      }

      // Parse JSON response
      const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          sufficient: parsed.sufficient === true,
          reasoning: parsed.reasoning || 'No reasoning provided',
          newQueries: parsed.new_search_queries || [],
        };
      }

      // Fallback: assume sufficient if we can't parse
      return {
        sufficient: true,
        reasoning: 'Could not parse evaluation response',
      };
    } catch (error: any) {
      logger.warn('Error evaluating context', { error: error.message });
      // On error, assume context is sufficient to avoid infinite loops
      return {
        sufficient: true,
        reasoning: `Evaluation error: ${error.message}`,
      };
    }
  }

  /**
   * Rank chunks by similarity and limit to max count
   */
  private rankAndLimitChunks(
    chunks: ContextChunk[],
    maxChunks: number
  ): ContextChunk[] {
    return chunks
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, maxChunks);
  }

  /**
   * Estimate token count for context chunks
   */
  private estimateTokens(chunks: ContextChunk[]): number {
    const totalChars = chunks.reduce((sum, c) => sum + c.content.length, 0);
    // Rough estimate: ~4 characters per token
    return Math.ceil(totalChars / 4);
  }

  /**
   * Format context for injection into a prompt
   */
  formatContextForPrompt(result: RecursiveSearchResult): string {
    if (result.context.length === 0) {
      return '';
    }

    const sections: { [key: string]: ContextChunk[] } = {
      message: [],
      fact: [],
      library: [],
      summary: [],
    };

    // Group by source
    for (const chunk of result.context) {
      sections[chunk.source].push(chunk);
    }

    let formatted = '\n\n--- RETRIEVED CONTEXT ---\n';

    if (sections.message.length > 0) {
      formatted += '\nRelevant conversation history:\n';
      for (const chunk of sections.message.slice(0, 10)) {
        const role = chunk.metadata?.role || 'unknown';
        formatted += `[${role}]: ${chunk.content}\n`;
      }
    }

    if (sections.fact.length > 0) {
      formatted += '\nRelevant facts about this user:\n';
      for (const chunk of sections.fact.slice(0, 5)) {
        formatted += `- ${chunk.content}\n`;
      }
    }

    if (sections.library.length > 0) {
      formatted += '\nRelevant library entries:\n';
      for (const chunk of sections.library.slice(0, 3)) {
        const title = chunk.metadata?.title || 'Untitled';
        formatted += `"${title}": ${chunk.content.substring(0, 300)}...\n`;
      }
    }

    if (sections.summary.length > 0) {
      formatted += '\nRelevant conversation summaries:\n';
      for (const chunk of sections.summary.slice(0, 3)) {
        formatted += `${chunk.content}\n`;
      }
    }

    formatted += '--- END CONTEXT ---\n';

    return formatted;
  }

  /**
   * Auto-detect whether recursive search should be used for this message.
   *
   * Triggers on:
   * 1. Historical reference patterns (e.g., "what did we discuss", "remember when")
   * 2. Long conversations where context might be lost
   * 3. Time-based references (e.g., "last week", "a few days ago")
   * 4. Explicit memory/recall requests
   *
   * @param message - The user's message
   * @param conversationLength - Number of messages in the conversation
   * @param daysSinceFirstMessage - Days since conversation started (optional)
   * @returns Whether to use recursive search and the reason why
   */
  shouldUseRecursiveSearch(
    message: string,
    conversationLength: number,
    daysSinceFirstMessage?: number
  ): { shouldSearch: boolean; reason: string } {
    const lowerMessage = message.toLowerCase();

    // Pattern 1: Historical reference patterns
    const historicalPatterns = [
      { pattern: /what did (we|i|you) (talk|discuss|say|mention)/i, reason: 'historical discussion reference' },
      { pattern: /remember when/i, reason: 'memory recall request' },
      { pattern: /you (mentioned|said|told me|brought up)/i, reason: 'referencing past statement' },
      { pattern: /we (talked|discussed|spoke) about/i, reason: 'past conversation reference' },
      { pattern: /earlier (you|we|i) (said|mentioned|discussed)/i, reason: 'earlier context reference' },
      { pattern: /back when/i, reason: 'historical reference' },
      { pattern: /do you recall/i, reason: 'memory recall request' },
      { pattern: /as (we|you|i) discussed/i, reason: 'referencing past discussion' },
      { pattern: /what was (that|the) (thing|idea|concept)/i, reason: 'recall request' },
      { pattern: /can you remind me/i, reason: 'reminder request' },
    ];

    for (const { pattern, reason } of historicalPatterns) {
      if (pattern.test(message)) {
        logger.debug('Recursive search triggered by pattern', { pattern: pattern.source, reason });
        return { shouldSearch: true, reason };
      }
    }

    // Pattern 2: Time-based references
    const timePatterns = [
      { pattern: /last (week|month|time|session)/i, reason: 'time-based reference' },
      { pattern: /(a |few |couple )?(days|weeks|months) ago/i, reason: 'time-based reference' },
      { pattern: /the other day/i, reason: 'recent past reference' },
      { pattern: /previously/i, reason: 'previous context reference' },
      { pattern: /in (our )?(earlier|previous|past) (conversation|chat|discussion)/i, reason: 'past conversation reference' },
      { pattern: /first time (we|i|you)/i, reason: 'historical reference' },
      { pattern: /when we (first|started)/i, reason: 'origin reference' },
    ];

    for (const { pattern, reason } of timePatterns) {
      if (pattern.test(message)) {
        logger.debug('Recursive search triggered by time pattern', { pattern: pattern.source, reason });
        return { shouldSearch: true, reason };
      }
    }

    // Pattern 3: Explicit recall/search requests
    const recallPatterns = [
      { pattern: /search (for|through|my|our)/i, reason: 'explicit search request' },
      { pattern: /find (what|when|where|that)/i, reason: 'explicit find request' },
      { pattern: /look (up|back|through)/i, reason: 'lookup request' },
      { pattern: /what do you know about/i, reason: 'knowledge query' },
      { pattern: /have (we|i) (ever|talked|mentioned|discussed)/i, reason: 'historical query' },
      { pattern: /tell me (again|what)/i, reason: 'recall request' },
    ];

    for (const { pattern, reason } of recallPatterns) {
      if (pattern.test(message)) {
        logger.debug('Recursive search triggered by recall pattern', { pattern: pattern.source, reason });
        return { shouldSearch: true, reason };
      }
    }

    // Default: don't use recursive search
    // Removed: long conversation auto-trigger and multi-day auto-trigger
    // These caused false positives on common phrases like "today" and any question in long chats
    return { shouldSearch: false, reason: 'no trigger patterns detected' };
  }
}

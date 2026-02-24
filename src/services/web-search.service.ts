import { TavilyClient } from 'tavily';
import { logger } from '../logger';

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

export interface WebSearchResult {
  query: string;
  results: SearchResult[];
  answer?: string; // AI-generated answer from Tavily
  executedAt: Date;
}

// Timeout per search depth
const TIMEOUT_MS: Record<string, number> = {
  basic: 45_000,    // 45 seconds for basic
  advanced: 60_000, // 60 seconds for advanced (deeper crawl)
};

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 2_000; // 2s, 4s, 8s

/**
 * Returns true for errors that are worth retrying (timeouts, network issues).
 */
function isTransientError(error: Error): boolean {
  const msg = error.message.toLowerCase();
  return (
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('socket hang up') ||
    msg.includes('network') ||
    msg.includes('fetch failed') ||
    msg.includes('aborted') ||
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('429')
  );
}

/**
 * WebSearchService
 *
 * Handles web searches using Tavily API
 * Tavily is optimized for AI applications with high-quality, relevant results
 */
export class WebSearchService {
  private client: TavilyClient | null = null;
  private enabled: boolean;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.TAVILY_API_KEY;

    if (!key) {
      logger.warn('Tavily API key not provided. Web search will be disabled.');
      this.enabled = false;
      return;
    }

    // Log that we have a key (but not the key itself)
    logger.info('Tavily API key found, initializing client', {
      keyLength: key.length,
      keyPrefix: key.substring(0, 8) + '...',
    });

    try {
      this.client = new TavilyClient({ apiKey: key });
      this.enabled = true;
      logger.info('Web search service initialized successfully');
    } catch (error: any) {
      logger.error('Failed to initialize Tavily client', { error: error.message });
      this.enabled = false;
    }
  }

  /**
   * Execute a single search attempt with a timeout guard.
   * Cleans up the timer on both success and failure to avoid leaks.
   */
  private async executeSearch(
    query: string,
    maxResults: number,
    includeAnswer: boolean,
    searchDepth: 'basic' | 'advanced',
  ): Promise<any> {
    const timeoutMs = TIMEOUT_MS[searchDepth] ?? TIMEOUT_MS.basic;

    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Web search timed out after ${timeoutMs / 1000}s`)),
        timeoutMs,
      );
    });

    try {
      const response = await Promise.race([
        this.client!.search({
          query,
          max_results: maxResults,
          include_answer: includeAnswer,
          search_depth: searchDepth,
          include_domains: [],
          exclude_domains: [],
        }),
        timeoutPromise,
      ]);
      return response;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /**
   * Search the web for information.
   * Retries transient failures (timeouts, network errors) up to MAX_RETRIES
   * times with exponential backoff.
   */
  async search(query: string, options?: {
    maxResults?: number;
    includeAnswer?: boolean;
    searchDepth?: 'basic' | 'advanced';
  }): Promise<WebSearchResult> {
    if (!this.enabled || !this.client) {
      throw new Error('Web search is not enabled. Please provide TAVILY_API_KEY.');
    }

    const maxResults = options?.maxResults || 5;
    const includeAnswer = options?.includeAnswer ?? true;
    const searchDepth = options?.searchDepth || 'basic';

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        logger.info('Executing web search', { query, maxResults, searchDepth, attempt });

        const response = await this.executeSearch(query, maxResults, includeAnswer, searchDepth);

        const results: SearchResult[] = (response.results || []).map((result: any) => ({
          title: result.title,
          url: result.url,
          content: result.content,
          score: parseFloat(result.score) || 0,
        }));

        logger.info('Web search completed', {
          query,
          resultsCount: results.length,
          hasAnswer: !!response.answer,
          attempt,
        });

        return {
          query,
          results,
          answer: response.answer,
          executedAt: new Date(),
        };
      } catch (error: any) {
        lastError = error;

        const transient = isTransientError(error);

        logger.warn('Web search attempt failed', {
          query,
          attempt,
          maxRetries: MAX_RETRIES,
          error: error.message,
          transient,
        });

        // Only retry on transient errors and if we have attempts left
        if (!transient || attempt >= MAX_RETRIES) {
          break;
        }

        // Exponential backoff: 2s, 4s, 8s
        const backoffMs = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
        logger.info('Retrying web search after backoff', { query, attempt, backoffMs });
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }

    // All attempts exhausted
    logger.error('Web search failed after all retries', {
      query,
      attempts: MAX_RETRIES,
      error: lastError?.message,
    });
    throw new Error(`Web search temporarily unavailable: ${lastError?.message}`);
  }

  /**
   * Check if web search is available
   */
  isAvailable(): boolean {
    return this.enabled;
  }

  /**
   * Search with context for better results
   * Includes user context in the search to get more relevant results
   */
  async searchWithContext(
    query: string,
    context: string,
    options?: {
      maxResults?: number;
      searchDepth?: 'basic' | 'advanced';
    }
  ): Promise<WebSearchResult> {
    // Enhance query with context for better results
    const enhancedQuery = context
      ? `${query} (context: ${context.substring(0, 200)})`
      : query;

    return this.search(enhancedQuery, {
      ...options,
      includeAnswer: true,
    });
  }
}

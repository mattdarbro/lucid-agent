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

    try {
      this.client = new TavilyClient({ apiKey: key });
      this.enabled = true;
      logger.info('Web search service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Tavily client', { error });
      this.enabled = false;
    }
  }

  /**
   * Search the web for information
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

    try {
      logger.info('Executing web search', { query, maxResults, searchDepth });

      const response = await this.client.search({
        query,
        max_results: maxResults,
        include_answer: includeAnswer,
        search_depth: searchDepth,
        include_domains: [], // Could restrict to specific domains if needed
        exclude_domains: [], // Could exclude specific domains
      });

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
      });

      return {
        query,
        results,
        answer: response.answer,
        executedAt: new Date(),
      };
    } catch (error: any) {
      logger.error('Web search failed', {
        query,
        error: error.message,
      });
      throw new Error(`Web search failed: ${error.message}`);
    }
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

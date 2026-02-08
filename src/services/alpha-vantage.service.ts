import { logger } from '../logger';

/**
 * Stock quote from Alpha Vantage
 */
export interface StockQuote {
  symbol: string;
  price: number;
  change: number;
  changePercent: string;
  volume: number;
  latestTradingDay: string;
}

/**
 * Market overview data point
 */
export interface MarketMover {
  ticker: string;
  price: string;
  change_amount: string;
  change_percentage: string;
  volume: string;
}

/**
 * Top gainers/losers/most active
 */
export interface MarketOverview {
  topGainers: MarketMover[];
  topLosers: MarketMover[];
  mostActive: MarketMover[];
}

/**
 * Search result for symbol lookup
 */
export interface SymbolSearchResult {
  symbol: string;
  name: string;
  type: string;
  region: string;
  currency: string;
}

/**
 * AlphaVantageService
 *
 * Provides market data for Lucid's investment research loop.
 * Uses the free tier (25 requests/day) so we batch and cache wisely.
 *
 * Setup: Set ALPHA_VANTAGE_API_KEY in environment
 */
export class AlphaVantageService {
  private apiKey: string | null;
  private baseUrl = 'https://www.alphavantage.co/query';
  private enabled: boolean;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.ALPHA_VANTAGE_API_KEY || null;
    this.enabled = !!this.apiKey;

    if (this.enabled) {
      logger.info('Alpha Vantage service initialized');
    } else {
      logger.warn('Alpha Vantage service disabled - ALPHA_VANTAGE_API_KEY not set');
    }
  }

  isAvailable(): boolean {
    return this.enabled;
  }

  /**
   * Get a real-time quote for a stock symbol
   */
  async getQuote(symbol: string): Promise<StockQuote | null> {
    if (!this.enabled) return null;

    try {
      const data = await this.request('GLOBAL_QUOTE', { symbol });
      const quote = data['Global Quote'];

      if (!quote || !quote['05. price']) {
        logger.warn('No quote data returned', { symbol });
        return null;
      }

      return {
        symbol: quote['01. symbol'],
        price: parseFloat(quote['05. price']),
        change: parseFloat(quote['09. change']),
        changePercent: quote['10. change percent'],
        volume: parseInt(quote['06. volume'], 10),
        latestTradingDay: quote['07. latest trading day'],
      };
    } catch (error: any) {
      logger.error('Failed to get quote', { symbol, error: error.message });
      return null;
    }
  }

  /**
   * Get top gainers, losers, and most actively traded
   * Great for daily market overview without burning many API calls
   */
  async getMarketOverview(): Promise<MarketOverview | null> {
    if (!this.enabled) return null;

    try {
      const data = await this.request('TOP_GAINERS_LOSERS');

      return {
        topGainers: (data.top_gainers || []).slice(0, 5),
        topLosers: (data.top_losers || []).slice(0, 5),
        mostActive: (data.most_actively_traded || []).slice(0, 5),
      };
    } catch (error: any) {
      logger.error('Failed to get market overview', { error: error.message });
      return null;
    }
  }

  /**
   * Search for a stock symbol by name or keyword
   */
  async searchSymbol(keywords: string): Promise<SymbolSearchResult[]> {
    if (!this.enabled) return [];

    try {
      const data = await this.request('SYMBOL_SEARCH', { keywords });
      const matches = data.bestMatches || [];

      return matches.slice(0, 5).map((m: any) => ({
        symbol: m['1. symbol'],
        name: m['2. name'],
        type: m['3. type'],
        region: m['4. region'],
        currency: m['8. currency'],
      }));
    } catch (error: any) {
      logger.error('Failed to search symbol', { keywords, error: error.message });
      return [];
    }
  }

  /**
   * Get multiple quotes at once (batch-friendly)
   * Note: Each symbol is a separate API call on free tier
   */
  async getQuotes(symbols: string[]): Promise<Map<string, StockQuote>> {
    const quotes = new Map<string, StockQuote>();

    // Limit to 5 quotes per batch to respect free tier
    for (const symbol of symbols.slice(0, 5)) {
      const quote = await this.getQuote(symbol);
      if (quote) {
        quotes.set(symbol, quote);
      }
      // Small delay between calls to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    return quotes;
  }

  /**
   * Make an API request to Alpha Vantage
   */
  private async request(
    functionName: string,
    params: Record<string, string> = {}
  ): Promise<any> {
    const url = new URL(this.baseUrl);
    url.searchParams.set('function', functionName);
    url.searchParams.set('apikey', this.apiKey!);

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`Alpha Vantage API error: ${response.status} ${response.statusText}`);
    }

    const data: any = await response.json();

    // Alpha Vantage returns error messages in the response body
    if (data['Error Message']) {
      throw new Error(`Alpha Vantage: ${data['Error Message']}`);
    }
    if (data['Note']) {
      logger.warn('Alpha Vantage rate limit note', { note: data['Note'] });
    }

    return data;
  }
}

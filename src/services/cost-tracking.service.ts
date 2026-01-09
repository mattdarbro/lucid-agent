import { Pool } from 'pg';
import { logger } from '../logger';

/**
 * API pricing per million tokens (as of Dec 2024)
 * https://www.anthropic.com/pricing
 */
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Claude Opus 4.5
  'claude-opus-4-5-20251101': { input: 15.0, output: 75.0 },
  // Claude Sonnet 4.5
  'claude-sonnet-4-5-20250929': { input: 3.0, output: 15.0 },
  // Claude Haiku 3.5 / 4.5
  'claude-3-5-haiku-20241022': { input: 0.8, output: 4.0 },
  'claude-haiku-4-5-20241022': { input: 0.8, output: 4.0 },
  // Older models (fallback)
  'claude-3-opus-20240229': { input: 15.0, output: 75.0 },
  'claude-3-sonnet-20240229': { input: 3.0, output: 15.0 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
};

/**
 * OpenAI embedding pricing
 */
export const EMBEDDING_PRICING = {
  'text-embedding-ada-002': 0.0001, // per 1K tokens
  'text-embedding-3-small': 0.00002, // per 1K tokens
};

/**
 * API usage source types
 */
export type UsageSource =
  | 'chat'
  | 'morning_reflection'
  | 'midday_curiosity'
  | 'afternoon_synthesis'
  | 'evening_consolidation'
  | 'night_dream'
  | 'web_research'
  | 'fact_extraction'
  | 'personality_analysis'
  | 'versus_debate'
  | 'embedding'
  | 'chat_router'
  | 'at_router'
  | 'research_seed_detection'
  | 'capture_classification'
  | 'other';

/**
 * API usage record
 */
export interface ApiUsageRecord {
  id: string;
  userId: string;
  source: UsageSource;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  metadata: Record<string, any>;
  createdAt: Date;
}

/**
 * Cost summary by period
 */
export interface CostSummary {
  userId: string;
  period: string;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  bySource: Record<UsageSource, {
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    count: number;
  }>;
  byModel: Record<string, {
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    count: number;
  }>;
}

/**
 * CostTrackingService
 *
 * Tracks API usage and costs for all Claude and OpenAI calls.
 * Helps users understand where their API spend is going.
 */
export class CostTrackingService {
  constructor(private pool: Pool) {}

  /**
   * Calculate cost for a Claude API call
   */
  calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    const pricing = MODEL_PRICING[model];
    if (!pricing) {
      logger.warn('Unknown model for pricing', { model });
      // Default to Sonnet pricing if unknown
      return (inputTokens * 3.0 + outputTokens * 15.0) / 1_000_000;
    }

    const inputCost = (inputTokens * pricing.input) / 1_000_000;
    const outputCost = (outputTokens * pricing.output) / 1_000_000;

    return inputCost + outputCost;
  }

  /**
   * Calculate cost for embeddings
   */
  calculateEmbeddingCost(tokenCount: number, model: string = 'text-embedding-ada-002'): number {
    const pricePerK = EMBEDDING_PRICING[model as keyof typeof EMBEDDING_PRICING] || 0.0001;
    return (tokenCount / 1000) * pricePerK;
  }

  /**
   * Log an API usage event
   */
  async logUsage(
    userId: string,
    source: UsageSource,
    model: string,
    inputTokens: number,
    outputTokens: number,
    metadata: Record<string, any> = {}
  ): Promise<void> {
    const costUsd = this.calculateCost(model, inputTokens, outputTokens);

    try {
      await this.pool.query(
        `INSERT INTO api_usage (
          user_id, source, model, input_tokens, output_tokens, cost_usd, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [userId, source, model, inputTokens, outputTokens, costUsd, JSON.stringify(metadata)]
      );

      logger.debug('API usage logged', {
        userId,
        source,
        model,
        inputTokens,
        outputTokens,
        costUsd: costUsd.toFixed(6),
      });
    } catch (error) {
      // Don't fail the request if logging fails
      logger.error('Failed to log API usage', { error, userId, source });
    }
  }

  /**
   * Log embedding usage
   */
  async logEmbeddingUsage(
    userId: string,
    tokenCount: number,
    purpose: string,
    model: string = 'text-embedding-ada-002'
  ): Promise<void> {
    const costUsd = this.calculateEmbeddingCost(tokenCount, model);

    try {
      await this.pool.query(
        `INSERT INTO api_usage (
          user_id, source, model, input_tokens, output_tokens, cost_usd, metadata
        ) VALUES ($1, 'embedding', $2, $3, 0, $4, $5)`,
        [userId, model, tokenCount, costUsd, JSON.stringify({ purpose })]
      );
    } catch (error) {
      logger.error('Failed to log embedding usage', { error, userId });
    }
  }

  /**
   * Get cost summary for a user over a period
   */
  async getCostSummary(
    userId: string,
    options: {
      startDate?: Date;
      endDate?: Date;
      period?: 'day' | 'week' | 'month' | 'all';
    } = {}
  ): Promise<CostSummary> {
    const { period = 'month' } = options;
    let { startDate, endDate } = options;

    // Set default date range based on period
    if (!startDate || !endDate) {
      endDate = new Date();
      startDate = new Date();

      switch (period) {
        case 'day':
          startDate.setHours(0, 0, 0, 0);
          break;
        case 'week':
          startDate.setDate(startDate.getDate() - 7);
          break;
        case 'month':
          startDate.setMonth(startDate.getMonth() - 1);
          break;
        case 'all':
          startDate = new Date(0);
          break;
      }
    }

    // Get totals
    const totalsResult = await this.pool.query(
      `SELECT
        COALESCE(SUM(cost_usd), 0) as total_cost,
        COALESCE(SUM(input_tokens), 0) as total_input,
        COALESCE(SUM(output_tokens), 0) as total_output
       FROM api_usage
       WHERE user_id = $1 AND created_at >= $2 AND created_at <= $3`,
      [userId, startDate, endDate]
    );

    // Get breakdown by source
    const bySourceResult = await this.pool.query(
      `SELECT
        source,
        COALESCE(SUM(cost_usd), 0) as cost,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COUNT(*) as count
       FROM api_usage
       WHERE user_id = $1 AND created_at >= $2 AND created_at <= $3
       GROUP BY source
       ORDER BY cost DESC`,
      [userId, startDate, endDate]
    );

    // Get breakdown by model
    const byModelResult = await this.pool.query(
      `SELECT
        model,
        COALESCE(SUM(cost_usd), 0) as cost,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COUNT(*) as count
       FROM api_usage
       WHERE user_id = $1 AND created_at >= $2 AND created_at <= $3
       GROUP BY model
       ORDER BY cost DESC`,
      [userId, startDate, endDate]
    );

    const totals = totalsResult.rows[0];

    const bySource: CostSummary['bySource'] = {} as any;
    for (const row of bySourceResult.rows) {
      bySource[row.source as UsageSource] = {
        costUsd: parseFloat(row.cost),
        inputTokens: parseInt(row.input_tokens),
        outputTokens: parseInt(row.output_tokens),
        count: parseInt(row.count),
      };
    }

    const byModel: CostSummary['byModel'] = {};
    for (const row of byModelResult.rows) {
      byModel[row.model] = {
        costUsd: parseFloat(row.cost),
        inputTokens: parseInt(row.input_tokens),
        outputTokens: parseInt(row.output_tokens),
        count: parseInt(row.count),
      };
    }

    return {
      userId,
      period,
      totalCostUsd: parseFloat(totals.total_cost),
      totalInputTokens: parseInt(totals.total_input),
      totalOutputTokens: parseInt(totals.total_output),
      bySource,
      byModel,
    };
  }

  /**
   * Get daily cost breakdown for a user
   */
  async getDailyCosts(
    userId: string,
    days: number = 30
  ): Promise<Array<{ date: string; costUsd: number; bySource: Record<string, number> }>> {
    const result = await this.pool.query(
      `SELECT
        DATE(created_at) as date,
        source,
        COALESCE(SUM(cost_usd), 0) as cost
       FROM api_usage
       WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '${days} days'
       GROUP BY DATE(created_at), source
       ORDER BY date DESC`,
      [userId]
    );

    // Aggregate by date
    const byDate: Record<string, { costUsd: number; bySource: Record<string, number> }> = {};

    for (const row of result.rows) {
      const dateStr = row.date.toISOString().split('T')[0];
      if (!byDate[dateStr]) {
        byDate[dateStr] = { costUsd: 0, bySource: {} };
      }
      byDate[dateStr].costUsd += parseFloat(row.cost);
      byDate[dateStr].bySource[row.source] = parseFloat(row.cost);
    }

    return Object.entries(byDate).map(([date, data]) => ({
      date,
      costUsd: data.costUsd,
      bySource: data.bySource,
    }));
  }

  /**
   * Estimate monthly cost based on recent usage
   */
  async estimateMonthlyProjection(userId: string): Promise<{
    dailyAverage: number;
    monthlyProjection: number;
    breakdown: Record<string, number>;
  }> {
    // Get last 7 days of usage
    const result = await this.pool.query(
      `SELECT
        source,
        COALESCE(SUM(cost_usd), 0) as total_cost,
        COUNT(DISTINCT DATE(created_at)) as days_with_usage
       FROM api_usage
       WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '7 days'
       GROUP BY source`,
      [userId]
    );

    let totalCost = 0;
    let daysWithUsage = 0;
    const breakdown: Record<string, number> = {};

    for (const row of result.rows) {
      totalCost += parseFloat(row.total_cost);
      daysWithUsage = Math.max(daysWithUsage, parseInt(row.days_with_usage));
      breakdown[row.source] = parseFloat(row.total_cost);
    }

    const dailyAverage = daysWithUsage > 0 ? totalCost / daysWithUsage : 0;
    const monthlyProjection = dailyAverage * 30;

    return {
      dailyAverage,
      monthlyProjection,
      breakdown,
    };
  }
}

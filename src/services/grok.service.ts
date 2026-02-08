import { logger } from '../logger';

/**
 * Grok response from a query
 */
export interface GrokResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

/**
 * GrokService
 *
 * Uses the Grok API (xAI) to get real-time insights from X/Twitter.
 * Grok has access to live X posts and trending topics, making it valuable
 * for market sentiment, trending discussions, and social research.
 *
 * Lucid uses Grok as a research tool, then brings findings back
 * to Claude for deeper synthesis.
 *
 * Setup: Set GROK_API_KEY in environment
 */
export class GrokService {
  private apiKey: string | null;
  private baseUrl = 'https://api.x.ai/v1';
  private enabled: boolean;
  private model = 'grok-3-mini-fast';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.GROK_API_KEY || null;
    this.enabled = !!this.apiKey;

    if (this.enabled) {
      logger.info('Grok service initialized');
    } else {
      logger.warn('Grok service disabled - GROK_API_KEY not set');
    }
  }

  isAvailable(): boolean {
    return this.enabled;
  }

  /**
   * Ask Grok a question - leverages its real-time X/Twitter knowledge
   */
  async ask(
    prompt: string,
    options?: {
      maxTokens?: number;
      temperature?: number;
      systemPrompt?: string;
    }
  ): Promise<GrokResponse | null> {
    if (!this.enabled) return null;

    try {
      const messages: any[] = [];

      if (options?.systemPrompt) {
        messages.push({ role: 'system', content: options.systemPrompt });
      }

      messages.push({ role: 'user', content: prompt });

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          max_tokens: options?.maxTokens || 1000,
          temperature: options?.temperature || 0.7,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Grok API error: ${response.status} - ${errorText}`);
      }

      const data: any = await response.json();
      const choice = data.choices?.[0];

      if (!choice?.message?.content) {
        logger.warn('No content in Grok response');
        return null;
      }

      return {
        content: choice.message.content,
        model: data.model || this.model,
        usage: data.usage ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
        } : undefined,
      };
    } catch (error: any) {
      logger.error('Grok API call failed', { error: error.message });
      return null;
    }
  }

  /**
   * Get market sentiment from X/Twitter via Grok
   * Asks Grok to analyze current social sentiment around stocks/markets
   */
  async getMarketSentiment(topics: string[]): Promise<GrokResponse | null> {
    const prompt = `What's the current sentiment on X/Twitter about these investment topics? Focus on what real people are saying, any trending discussions, notable analyst opinions, and overall mood.

Topics: ${topics.join(', ')}

Provide:
1. Overall sentiment (bullish/bearish/mixed) for each topic
2. Key discussions or trending posts
3. Any notable warnings or concerns being discussed
4. Interesting opportunities people are talking about

Be specific about what you're seeing on X right now. Keep it concise and actionable.`;

    return this.ask(prompt, {
      systemPrompt: 'You are a financial research assistant. Provide factual, balanced analysis of social media sentiment. Always note that social sentiment is not financial advice.',
      maxTokens: 1200,
      temperature: 0.5,
    });
  }

  /**
   * Research a specific investment topic via Grok's real-time knowledge
   */
  async researchInvestmentTopic(topic: string, context?: string): Promise<GrokResponse | null> {
    let prompt = `Research this investment topic using your real-time knowledge from X and the web: "${topic}"

Provide:
1. Current state and recent developments
2. What people on X are saying about it
3. Key risks and concerns
4. Potential opportunities
5. Any relevant price movements or news`;

    if (context) {
      prompt += `\n\nAdditional context: ${context}`;
    }

    return this.ask(prompt, {
      systemPrompt: 'You are a financial research assistant helping with investment research. Provide factual, balanced analysis. Always note that this is not financial advice. Focus on recent, real-time information.',
      maxTokens: 1500,
      temperature: 0.5,
    });
  }

  /**
   * Research tools, APIs, or services that could enhance AI agent capabilities
   */
  async researchCapabilityTool(topic: string): Promise<GrokResponse | null> {
    const prompt = `Research this tool/service/API for enhancing an AI agent's capabilities: "${topic}"

Provide:
1. What it does and key features
2. Pricing (free tier, paid plans)
3. What people on X are saying about it - real user experiences
4. Pros and cons from real users
5. Any alternatives worth considering

Focus on practical, real-world usage feedback from X and recent discussions.`;

    return this.ask(prompt, {
      systemPrompt: 'You are a technology research assistant. Provide balanced analysis based on real user feedback and current discussions. Focus on practical value and real costs.',
      maxTokens: 1200,
      temperature: 0.5,
    });
  }
}

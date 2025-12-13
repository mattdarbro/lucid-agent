import Anthropic from '@anthropic-ai/sdk';
import { Pool } from 'pg';
import { logger } from '../logger';
import { CostTrackingService } from './cost-tracking.service';

/**
 * Available modules for chat context building
 */
export type ChatModule =
  | 'core_identity'      // ALWAYS include. Name, immutable bio, LUCID's voice
  | 'light_witness'      // Casual presence, warmth, 2-3 sentences. No deep analysis
  | 'deep_inquiry'       // Complex questions, analysis mode, Library access
  | 'facts_relevant'     // Semantic search for relevant stored knowledge
  | 'emotional_context'  // When emotional state tracking helps
  | 'autonomous_thoughts'// Surface LUCID's background reflections
  | 'surface_research';  // Present pending research queue to user

/**
 * Message structure for routing context
 */
export interface MessageContext {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * ChatRouterService - Haiku-based intelligent routing for chat messages
 *
 * Instead of loading ALL context every turn (causing cognitive overload),
 * this service selects only the relevant modules for each message.
 *
 * This fixes the "drift" problem where LUCID fixates on ever-present facts.
 */
export class ChatRouterService {
  private anthropic: Anthropic;
  private pool: Pool;
  private costTrackingService: CostTrackingService;
  private readonly model = 'claude-haiku-4-5-20241022';

  constructor(pool: Pool, anthropicApiKey?: string) {
    this.pool = pool;
    this.anthropic = new Anthropic({
      apiKey: anthropicApiKey || process.env.ANTHROPIC_API_KEY,
    });
    this.costTrackingService = new CostTrackingService(pool);
  }

  /**
   * Route a message to determine which modules are needed
   * Uses Haiku for fast, cost-effective classification
   */
  async route(
    userId: string,
    message: string,
    recentHistory: MessageContext[],
    flags?: {
      shouldSurfaceResearch?: boolean;
      hasApprovedResearch?: boolean;
    }
  ): Promise<ChatModule[]> {
    // Build context for routing decision
    const historyContext = recentHistory
      .slice(-3)
      .map(m => `${m.role}: ${m.content.slice(0, 200)}`)
      .join('\n');

    const routingPrompt = this.buildRoutingPrompt(message, historyContext, flags);

    try {
      const response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: 200,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: routingPrompt,
          },
        ],
      });

      // Track cost
      if (response.usage) {
        await this.costTrackingService.logUsage(
          userId,
          'chat_router',
          this.model,
          response.usage.input_tokens,
          response.usage.output_tokens,
          { purpose: 'chat_routing' }
        );
      }

      // Parse the response
      const content = response.content[0];
      if (content.type !== 'text') {
        logger.warn('Unexpected response type from routing, using defaults');
        return this.getDefaultModules();
      }

      const modules = this.parseModulesFromResponse(content.text);

      logger.debug('Chat routing completed', {
        userId,
        message: message.slice(0, 50),
        selectedModules: modules,
      });

      return modules;
    } catch (error) {
      logger.error('Chat routing failed, using defaults', { error });
      return this.getDefaultModules();
    }
  }

  /**
   * Build the routing prompt for Haiku
   */
  private buildRoutingPrompt(
    message: string,
    historyContext: string,
    flags?: {
      shouldSurfaceResearch?: boolean;
      hasApprovedResearch?: boolean;
    }
  ): string {
    const surfaceNote = flags?.shouldSurfaceResearch
      ? '\n\nNote: User has pending research items to review. Consider including "surface_research".'
      : '';

    return `You route messages for LUCID, a witnessing AI companion.

Read the message and return ONLY a JSON array of needed modules.

MODULES:
- "core_identity": ALWAYS include. Name (Matt), immutable bio, LUCID's voice.
- "light_witness": Casual presence, warmth, 2-3 sentences. No deep analysis.
- "deep_inquiry": Complex questions, analysis mode, Library access.
- "facts_relevant": Semantic search for relevant stored knowledge.
- "emotional_context": When emotional state tracking helps.
- "autonomous_thoughts": Surface LUCID's background reflections.
- "surface_research": Present pending research queue to user.

RULES:
- ALWAYS include "core_identity"
- "light_witness" and "deep_inquiry" are mutually exclusive
- Fewer modules = better. Don't over-include.
- Include "facts_relevant" when user mentions past topics, projects, people
- Include "emotional_context" when user shares feelings or seems stressed
- Include "autonomous_thoughts" when user asks what LUCID has been thinking
- Include "surface_research" when user asks what to explore next${surfaceNote}

EXAMPLES:
"Hey" → ["core_identity", "light_witness"]
"Help me think through my app strategy" → ["core_identity", "deep_inquiry", "facts_relevant"]
"What have you been thinking about?" → ["core_identity", "autonomous_thoughts", "surface_research"]
"I shipped Local Poet!" → ["core_identity", "light_witness", "facts_relevant"]
"I'm feeling overwhelmed" → ["core_identity", "light_witness", "emotional_context"]
"Tell me about my goals" → ["core_identity", "facts_relevant"]
"What should we research?" → ["core_identity", "surface_research"]

Recent conversation:
${historyContext || '(no history)'}

Current message: "${message}"

JSON array only:`;
  }

  /**
   * Parse modules from Haiku's response
   */
  private parseModulesFromResponse(text: string): ChatModule[] {
    try {
      // Extract JSON array from response
      const jsonMatch = text.match(/\[[\s\S]*?\]/);
      if (!jsonMatch) {
        logger.warn('No JSON array found in routing response', { text });
        return this.getDefaultModules();
      }

      const parsed = JSON.parse(jsonMatch[0]) as string[];

      // Validate and filter to known modules
      const validModules: ChatModule[] = [
        'core_identity',
        'light_witness',
        'deep_inquiry',
        'facts_relevant',
        'emotional_context',
        'autonomous_thoughts',
        'surface_research',
      ];

      const modules = parsed.filter((m): m is ChatModule =>
        validModules.includes(m as ChatModule)
      );

      // Ensure core_identity is always included
      if (!modules.includes('core_identity')) {
        modules.unshift('core_identity');
      }

      // Enforce mutual exclusivity of light_witness and deep_inquiry
      if (modules.includes('light_witness') && modules.includes('deep_inquiry')) {
        // Prefer deep_inquiry if both are present
        const lightIndex = modules.indexOf('light_witness');
        modules.splice(lightIndex, 1);
      }

      return modules;
    } catch (error) {
      logger.warn('Failed to parse routing response', { text, error });
      return this.getDefaultModules();
    }
  }

  /**
   * Default modules when routing fails
   */
  private getDefaultModules(): ChatModule[] {
    return ['core_identity', 'light_witness'];
  }

  /**
   * Quick heuristic-based routing for very simple messages
   * Can be used to skip Haiku call for obvious cases
   */
  quickRoute(message: string): ChatModule[] | null {
    const normalized = message.toLowerCase().trim();

    // Very short greetings
    if (['hi', 'hey', 'hello', 'yo', 'sup', 'hi!', 'hey!'].includes(normalized)) {
      return ['core_identity', 'light_witness'];
    }

    // Questions about LUCID's thoughts
    if (
      normalized.includes('what have you been thinking') ||
      normalized.includes('what are you thinking') ||
      normalized.includes("what's on your mind")
    ) {
      return ['core_identity', 'autonomous_thoughts', 'surface_research'];
    }

    // Research-related
    if (
      normalized.includes('research') ||
      normalized.includes('what should we explore') ||
      normalized.includes('what to learn')
    ) {
      return ['core_identity', 'surface_research'];
    }

    // No quick match - need full routing
    return null;
  }

  /**
   * Get module statistics for debugging
   */
  async getRoutingStats(userId: string, days: number = 7): Promise<{
    totalRoutes: number;
    moduleUsage: Record<string, number>;
  }> {
    // This would query cost_tracking for chat_router entries
    // For now, return placeholder
    return {
      totalRoutes: 0,
      moduleUsage: {},
    };
  }
}

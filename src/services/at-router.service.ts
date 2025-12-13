import { Pool } from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { ResearchQueueService, ResearchQueueItem } from './research-queue.service';
import { CostTrackingService } from './cost-tracking.service';

/**
 * AT Decision modes
 */
export type ATMode = 'research' | 'reflect' | 'synthesize' | 'surface' | 'rest';

/**
 * Decision from the AT Router
 */
export interface ATDecision {
  mode: ATMode;
  queueItemId?: string;
  queueItem?: ResearchQueueItem;
  intention: string;
  confidence: number;
}

/**
 * Context for AT routing decisions
 */
interface ATRoutingContext {
  pendingItems: ResearchQueueItem[];
  approvedItems: ResearchQueueItem[];
  recentThemes: string[];
  lastSessionType: string | null;
  lastSessionAt: Date | null;
  daysSinceLastSurface: number;
  userActivityLevel: 'active' | 'moderate' | 'inactive';
}

/**
 * ATRouterService - Routes Autonomous Thinking with intention
 *
 * Instead of AT guessing what to think about (causing repetitive loops),
 * this router decides what mode AT should operate in:
 * - research: Execute search on a USER-APPROVED queue item
 * - reflect: Think about recent conversations (no external search)
 * - synthesize: Connect multiple related topics into insight
 * - surface: Flag to present pending queue items to user in next chat
 * - rest: Nothing pressing - silence is fine
 *
 * Key principle: ONLY research items where user_approved = true
 */
export class ATRouterService {
  private pool: Pool;
  private anthropic: Anthropic;
  private researchQueueService: ResearchQueueService;
  private costTrackingService: CostTrackingService;
  private readonly model = 'claude-haiku-4-5-20241022';

  constructor(pool: Pool, anthropicApiKey?: string) {
    this.pool = pool;
    this.anthropic = new Anthropic({
      apiKey: anthropicApiKey || process.env.ANTHROPIC_API_KEY,
    });
    this.researchQueueService = new ResearchQueueService(pool);
    this.costTrackingService = new CostTrackingService(pool);
  }

  /**
   * Decide what AT should do
   */
  async decide(userId: string): Promise<ATDecision> {
    try {
      // Gather context for the decision
      const context = await this.gatherContext(userId);

      // Quick decision paths (skip Haiku for obvious cases)
      const quickDecision = this.tryQuickDecision(context);
      if (quickDecision) {
        logger.debug('AT Router quick decision', { userId, mode: quickDecision.mode });
        return quickDecision;
      }

      // Use Haiku for nuanced decisions
      return await this.routeWithHaiku(userId, context);
    } catch (error) {
      logger.error('AT routing failed, defaulting to rest', { error });
      return {
        mode: 'rest',
        intention: 'Routing failed, taking a rest',
        confidence: 0.5,
      };
    }
  }

  /**
   * Gather context for routing decision
   */
  private async gatherContext(userId: string): Promise<ATRoutingContext> {
    // Get research queue items
    const [pendingItems, approvedItems] = await Promise.all([
      this.researchQueueService.getPendingItems(userId, 10),
      this.researchQueueService.getApprovedItems(userId),
    ]);

    // Get recent conversation themes
    const recentThemes = await this.getRecentConversationThemes(userId);

    // Get last AT session info
    const lastSession = await this.getLastATSession(userId);

    // Get days since last surface
    const daysSinceLastSurface = await this.getDaysSinceLastSurface(userId);

    // Get user activity level
    const userActivityLevel = await this.getUserActivityLevel(userId);

    return {
      pendingItems,
      approvedItems,
      recentThemes,
      lastSessionType: lastSession?.type || null,
      lastSessionAt: lastSession?.at || null,
      daysSinceLastSurface,
      userActivityLevel,
    };
  }

  /**
   * Try to make a quick decision without Haiku
   */
  private tryQuickDecision(context: ATRoutingContext): ATDecision | null {
    // If user is inactive, always rest
    if (context.userActivityLevel === 'inactive') {
      return {
        mode: 'rest',
        intention: 'User has been inactive, resting',
        confidence: 0.9,
      };
    }

    // If there are approved items, prioritize research
    if (context.approvedItems.length > 0) {
      const item = context.approvedItems[0];
      return {
        mode: 'research',
        queueItemId: item.id,
        queueItem: item,
        intention: `Research approved topic: ${item.topic}`,
        confidence: 0.95,
      };
    }

    // If 3+ pending items AND haven't surfaced in 2+ days, surface
    if (context.pendingItems.length >= 3 && context.daysSinceLastSurface >= 2) {
      return {
        mode: 'surface',
        intention: 'Have accumulated research topics to discuss with user',
        confidence: 0.85,
      };
    }

    // No quick decision available
    return null;
  }

  /**
   * Route with Haiku for nuanced decisions
   */
  private async routeWithHaiku(
    userId: string,
    context: ATRoutingContext
  ): Promise<ATDecision> {
    const prompt = this.buildRoutingPrompt(context);

    try {
      const response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: 300,
        temperature: 0.3,
        messages: [{ role: 'user', content: prompt }],
      });

      // Track cost
      if (response.usage) {
        await this.costTrackingService.logUsage(
          userId,
          'at_router',
          this.model,
          response.usage.input_tokens,
          response.usage.output_tokens,
          { purpose: 'at_routing' }
        );
      }

      const content = response.content[0];
      if (content.type !== 'text') {
        return this.defaultDecision();
      }

      return this.parseRoutingResponse(content.text, context);
    } catch (error) {
      logger.error('Haiku AT routing failed', { error });
      return this.defaultDecision();
    }
  }

  /**
   * Build the routing prompt for Haiku
   */
  private buildRoutingPrompt(context: ATRoutingContext): string {
    const pendingItemsText = context.pendingItems.length > 0
      ? context.pendingItems.slice(0, 5).map(i =>
        `  - "${i.topic}" (mentioned ${i.times_mentioned}x, priority ${i.priority})`
      ).join('\n')
      : '  (none)';

    const approvedItemsText = context.approvedItems.length > 0
      ? context.approvedItems.map(i =>
        `  - "${i.topic}" (approved, ready to research)`
      ).join('\n')
      : '  (none)';

    const themesText = context.recentThemes.length > 0
      ? context.recentThemes.slice(0, 5).join(', ')
      : '(no recent themes)';

    const lastSessionText = context.lastSessionAt
      ? `${context.lastSessionType} at ${context.lastSessionAt.toISOString()}`
      : 'No recent session';

    return `You are the Autonomous Thinking router for LUCID.

Current state:
- Pending research queue:
${pendingItemsText}
- User-approved items:
${approvedItemsText}
- Recent conversation themes: ${themesText}
- Last AT session: ${lastSessionText}
- Days since research surfaced to user: ${context.daysSinceLastSurface}
- User activity level: ${context.userActivityLevel}

Choose what LUCID's autonomous mind should do:

MODES:
- "research": Execute search on an APPROVED queue item. User has blessed this.
- "reflect": Think about recent conversations. No external search.
- "synthesize": Connect multiple related topics into insight.
- "surface": Flag to present pending queue items to user in next chat.
- "rest": Nothing pressing. Silence is fine.

RULES:
- ONLY research items where user_approved = true (in approved items list)
- If approved items exist, prefer "research"
- If 3+ pending items AND haven't surfaced in 2+ days → "surface"
- If nothing approved and nothing to surface → "reflect" or "rest"
- "rest" is always valid. Don't force insight.
- Never research the same failed topic twice
- If user is inactive, prefer "rest"

Respond with JSON only:
{
  "mode": "research|reflect|synthesize|surface|rest",
  "queue_item_id": "uuid or null",
  "intention": "One sentence: what are you hoping to discover or accomplish?"
}`;
  }

  /**
   * Parse the routing response from Haiku
   */
  private parseRoutingResponse(
    text: string,
    context: ATRoutingContext
  ): ATDecision {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return this.defaultDecision();
      }

      const parsed = JSON.parse(jsonMatch[0]);

      const mode = this.validateMode(parsed.mode);
      const queueItemId = parsed.queue_item_id || undefined;
      const intention = parsed.intention || 'No intention specified';

      // Validate: can only research approved items
      if (mode === 'research' && queueItemId) {
        const isApproved = context.approvedItems.some(i => i.id === queueItemId);
        if (!isApproved) {
          logger.warn('AT tried to research non-approved item', { queueItemId });
          return {
            mode: 'rest',
            intention: 'Wanted to research but item not approved',
            confidence: 0.7,
          };
        }
      }

      // Find the queue item if researching
      let queueItem: ResearchQueueItem | undefined;
      if (mode === 'research' && queueItemId) {
        queueItem = context.approvedItems.find(i => i.id === queueItemId);
      }

      return {
        mode,
        queueItemId,
        queueItem,
        intention,
        confidence: 0.8,
      };
    } catch (error) {
      logger.warn('Failed to parse AT routing response', { text, error });
      return this.defaultDecision();
    }
  }

  /**
   * Validate mode string
   */
  private validateMode(mode: string): ATMode {
    const validModes: ATMode[] = ['research', 'reflect', 'synthesize', 'surface', 'rest'];
    if (validModes.includes(mode as ATMode)) {
      return mode as ATMode;
    }
    return 'rest';
  }

  /**
   * Default decision when routing fails
   */
  private defaultDecision(): ATDecision {
    return {
      mode: 'rest',
      intention: 'Default decision - taking a rest',
      confidence: 0.5,
    };
  }

  /**
   * Get recent conversation themes
   */
  private async getRecentConversationThemes(userId: string): Promise<string[]> {
    try {
      const result = await this.pool.query<{ tag: string }>(
        `SELECT DISTINCT tag FROM topic_segments
         WHERE conversation_id IN (
           SELECT id FROM conversations
           WHERE user_id = $1 AND created_at > NOW() - INTERVAL '7 days'
         )
         ORDER BY tag
         LIMIT 10`,
        [userId]
      );
      return result.rows.map(r => r.tag);
    } catch (error) {
      logger.debug('Could not fetch conversation themes', { error });
      return [];
    }
  }

  /**
   * Get last AT session info
   */
  private async getLastATSession(userId: string): Promise<{ type: string; at: Date } | null> {
    try {
      const result = await this.pool.query<{ session_type: string; created_at: Date }>(
        `SELECT session_type, created_at FROM library_entries
         WHERE user_id = $1 AND session_type IS NOT NULL
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return {
        type: result.rows[0].session_type,
        at: new Date(result.rows[0].created_at),
      };
    } catch (error) {
      logger.debug('Could not fetch last AT session', { error });
      return null;
    }
  }

  /**
   * Get days since research was last surfaced to user
   */
  private async getDaysSinceLastSurface(userId: string): Promise<number> {
    try {
      const result = await this.pool.query<{ last_research_surfaced_at: Date | null }>(
        `SELECT last_research_surfaced_at FROM users WHERE id = $1`,
        [userId]
      );

      const lastSurfaced = result.rows[0]?.last_research_surfaced_at;
      if (!lastSurfaced) {
        return 999; // Never surfaced
      }

      const daysDiff = Math.floor(
        (Date.now() - new Date(lastSurfaced).getTime()) / (1000 * 60 * 60 * 24)
      );
      return daysDiff;
    } catch (error) {
      logger.debug('Could not get days since last surface', { error });
      return 999;
    }
  }

  /**
   * Get user activity level
   */
  private async getUserActivityLevel(
    userId: string
  ): Promise<'active' | 'moderate' | 'inactive'> {
    try {
      const result = await this.pool.query<{ last_active_at: Date }>(
        `SELECT last_active_at FROM users WHERE id = $1`,
        [userId]
      );

      const lastActive = result.rows[0]?.last_active_at;
      if (!lastActive) {
        return 'inactive';
      }

      const daysSinceActive = Math.floor(
        (Date.now() - new Date(lastActive).getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysSinceActive <= 1) return 'active';
      if (daysSinceActive <= 7) return 'moderate';
      return 'inactive';
    } catch (error) {
      logger.debug('Could not get user activity level', { error });
      return 'moderate';
    }
  }

  /**
   * Prepare for surfacing - set the flag for next chat
   */
  async prepareSurfacing(userId: string): Promise<void> {
    await this.researchQueueService.setShouldSurfaceFlag(userId, true);
    logger.info('AT Router set surface flag for user', { userId });
  }

  /**
   * Mark that surfacing happened - clear the flag
   */
  async markSurfacingDone(userId: string): Promise<void> {
    await this.researchQueueService.setShouldSurfaceFlag(userId, false);
    logger.info('AT Router cleared surface flag for user', { userId });
  }

  /**
   * Get routing statistics for debugging
   */
  async getRoutingStats(userId: string): Promise<{
    pendingCount: number;
    approvedCount: number;
    daysSinceLastSurface: number;
    userActivityLevel: string;
  }> {
    const context = await this.gatherContext(userId);
    return {
      pendingCount: context.pendingItems.length,
      approvedCount: context.approvedItems.length,
      daysSinceLastSurface: context.daysSinceLastSurface,
      userActivityLevel: context.userActivityLevel,
    };
  }
}

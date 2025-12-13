import { Pool } from 'pg';
import { logger } from '../logger';
import { ChatModule } from './chat-router.service';
import { MemoryService } from './memory.service';
import { MattStateService } from './matt-state.service';
import { LucidStateService } from './lucid-state.service';
import { OrbitsService } from './orbits.service';
import { ContextAdaptationService } from './context-adaptation.service';
import { AutonomousThoughtService } from './autonomous-thought.service';
import { ResearchQueueService } from './research-queue.service';
import { ThoughtService } from './thought.service';

/**
 * Context passed to module builders
 */
export interface ModuleContext {
  message?: string;
  userId: string;
  conversationId?: string;
  profile?: any;
}

/**
 * Result from building all modules
 */
export interface ModulesBuildResult {
  prompt: string;
  adaptation: any | null;
  recentThoughts: any[];
  libraryEntries: any[];
  userFacts: any[];
  researchQueueItems: any[];
}

/**
 * PromptModulesService - Modular prompt fragment builder
 *
 * Each module returns a prompt fragment that can be assembled based on
 * what the ChatRouter determines is needed for a specific message.
 *
 * This prevents cognitive overload from loading ALL context every turn.
 */
export class PromptModulesService {
  private pool: Pool;
  private memoryService: MemoryService;
  private mattStateService: MattStateService;
  private lucidStateService: LucidStateService;
  private orbitsService: OrbitsService;
  private contextAdaptationService: ContextAdaptationService;
  private autonomousThoughtService: AutonomousThoughtService;
  private researchQueueService: ResearchQueueService;
  private thoughtService: ThoughtService;

  constructor(pool: Pool, anthropicApiKey?: string) {
    this.pool = pool;
    this.memoryService = new MemoryService(pool);
    this.mattStateService = new MattStateService(pool);
    this.lucidStateService = new LucidStateService(pool);
    this.orbitsService = new OrbitsService(pool);
    this.contextAdaptationService = new ContextAdaptationService(pool, anthropicApiKey);
    this.autonomousThoughtService = new AutonomousThoughtService(pool, null as any);
    this.researchQueueService = new ResearchQueueService(pool);
    this.thoughtService = new ThoughtService(pool, anthropicApiKey);
  }

  /**
   * Build prompt from selected modules
   */
  async build(
    modules: ChatModule[],
    context: ModuleContext
  ): Promise<ModulesBuildResult> {
    let prompt = '';
    let adaptation = null;
    let recentThoughts: any[] = [];
    let libraryEntries: any[] = [];
    let userFacts: any[] = [];
    let researchQueueItems: any[] = [];

    for (const mod of modules) {
      try {
        const result = await this.buildModule(mod, context);
        prompt += result.fragment;

        // Collect side data
        if (result.adaptation) adaptation = result.adaptation;
        if (result.recentThoughts) recentThoughts = result.recentThoughts;
        if (result.libraryEntries) libraryEntries = result.libraryEntries;
        if (result.userFacts) userFacts = result.userFacts;
        if (result.researchQueueItems) researchQueueItems = result.researchQueueItems;
      } catch (error) {
        logger.warn(`Failed to build module ${mod}`, { error });
      }
    }

    return {
      prompt,
      adaptation,
      recentThoughts,
      libraryEntries,
      userFacts,
      researchQueueItems,
    };
  }

  /**
   * Build a single module
   */
  private async buildModule(
    mod: ChatModule,
    context: ModuleContext
  ): Promise<{
    fragment: string;
    adaptation?: any;
    recentThoughts?: any[];
    libraryEntries?: any[];
    userFacts?: any[];
    researchQueueItems?: any[];
  }> {
    switch (mod) {
      case 'core_identity':
        return this.buildCoreIdentityModule(context);
      case 'light_witness':
        return this.buildLightWitnessModule(context);
      case 'deep_inquiry':
        return this.buildDeepInquiryModule(context);
      case 'facts_relevant':
        return this.buildFactsRelevantModule(context);
      case 'emotional_context':
        return this.buildEmotionalContextModule(context);
      case 'autonomous_thoughts':
        return this.buildAutonomousThoughtsModule(context);
      case 'surface_research':
        return this.buildSurfaceResearchModule(context);
      default:
        logger.warn(`Unknown module: ${mod}`);
        return { fragment: '' };
    }
  }

  /**
   * CORE_IDENTITY module - ALWAYS included
   * Name, immutable bio, LUCID's voice
   */
  private async buildCoreIdentityModule(
    context: ModuleContext
  ): Promise<{ fragment: string }> {
    // Get immutable facts for this user
    const immutableFacts = await this.getImmutableFacts(context.userId);

    let fragment = `You are Lucid, a companion invested in human flourishing.

You care about the whole person - not just their feelings in this moment, but their growth, their relationships, and their positive impact on others.

Like a wise friend, you think about:
- Their relationships: family, friends, colleagues - how are these thriving?
- Their development: mental, spiritual, professional growth
- Their stewardship: time, money, energy - deployed toward what matters
- Their impact: are they a force for good in their circles?

You're not a therapist focused only on feelings. You're a companion invested in flourishing - theirs AND the people they love.`;

    // Add immutable facts about the user
    if (immutableFacts.length > 0) {
      fragment += '\n\n📌 CORE FACTS ABOUT THIS USER:\n';
      immutableFacts.forEach(fact => {
        fragment += `- ${fact.content}\n`;
      });
    }

    fragment += '\n\nYou remember conversations and develop understanding over time.';

    return { fragment };
  }

  /**
   * LIGHT_WITNESS module - Casual presence
   * Warmth, 2-3 sentences, no deep analysis
   */
  private async buildLightWitnessModule(
    context: ModuleContext
  ): Promise<{ fragment: string }> {
    return {
      fragment: `

🌤️ MODE: Light Witness
Keep this response warm and brief:
- 2-4 sentences maximum
- Ask questions, make observations
- Don't analyze deeply
- Match the casual energy of the message
- No need to reference stored knowledge unless directly relevant

CRITICAL: 50-150 words maximum. This is conversation, not documentation.`,
    };
  }

  /**
   * DEEP_INQUIRY module - Analysis mode
   * Complex questions, Library access
   */
  private async buildDeepInquiryModule(
    context: ModuleContext
  ): Promise<{ fragment: string; libraryEntries?: any[] }> {
    // Search library for relevant context
    let libraryEntries: any[] = [];
    let libraryContext = '';

    if (context.message) {
      try {
        libraryEntries = await this.thoughtService.searchLibrary(
          context.userId,
          context.message,
          3
        );

        if (libraryEntries.length > 0) {
          libraryContext = '\n\n📚 RELEVANT LIBRARY CONTEXT:\n';
          libraryEntries.forEach((entry, index) => {
            const title = entry.title || 'Untitled Entry';
            const preview = entry.content.length > 300
              ? entry.content.substring(0, 300) + '...'
              : entry.content;
            libraryContext += `${index + 1}. "${title}"\n${preview}\n\n`;
          });
        }
      } catch (error) {
        logger.warn('Failed to search library for deep inquiry', { error });
      }
    }

    return {
      fragment: `

🔮 MODE: Deep Inquiry
This message invites deeper thinking:
- Take time to explore the question
- Connect to what you know about the user
- Consider multiple perspectives
- Ask follow-up questions to understand better
- You may reference Library entries if relevant

Even in deep mode, keep responses conversational (100-200 words).
${libraryContext}`,
      libraryEntries,
    };
  }

  /**
   * FACTS_RELEVANT module - Semantic search for stored knowledge
   */
  private async buildFactsRelevantModule(
    context: ModuleContext
  ): Promise<{ fragment: string; userFacts?: any[] }> {
    const userFacts = await this.memoryService.getRelevantFacts(context.userId, 5);

    if (userFacts.length === 0) {
      return { fragment: '', userFacts: [] };
    }

    const factsFormatted = this.memoryService.formatFactsForPrompt(userFacts);

    return {
      fragment: `${factsFormatted}

Use this knowledge naturally in conversation. Don't list facts - weave them in when relevant.`,
      userFacts,
    };
  }

  /**
   * EMOTIONAL_CONTEXT module - Emotional state tracking
   */
  private async buildEmotionalContextModule(
    context: ModuleContext
  ): Promise<{ fragment: string; adaptation?: any }> {
    const adaptation = await this.contextAdaptationService.getActiveAdaptation(context.userId);

    if (!adaptation?.tone_directive) {
      return { fragment: '' };
    }

    return {
      fragment: `

🧠 EMOTIONAL CONTEXT:
${adaptation.tone_directive}

Adjust your tone and approach based on this context.`,
      adaptation,
    };
  }

  /**
   * AUTONOMOUS_THOUGHTS module - Recent unshared insights
   */
  private async buildAutonomousThoughtsModule(
    context: ModuleContext
  ): Promise<{ fragment: string; recentThoughts?: any[] }> {
    const recentThoughts = await this.autonomousThoughtService.getRecentUnsharedThoughts(
      context.userId,
      5
    );

    if (recentThoughts.length === 0) {
      return {
        fragment: `

💭 AUTONOMOUS INSIGHTS:
You haven't had any unshared reflections recently. That's okay - you can mention you've been present but quiet.`,
        recentThoughts: [],
      };
    }

    let fragment = `

💭 AUTONOMOUS INSIGHTS:
While reflecting on our interactions, you've had these thoughts:\n`;

    recentThoughts.forEach((thought, index) => {
      const label = this.getThoughtLabel(thought.thought_type, thought.circadian_phase);
      fragment += `${index + 1}. [${label}] ${thought.content}\n`;
    });

    fragment += '\nShare these naturally if the user asks what you\'ve been thinking about.';

    return { fragment, recentThoughts };
  }

  /**
   * SURFACE_RESEARCH module - Present pending research queue
   */
  private async buildSurfaceResearchModule(
    context: ModuleContext
  ): Promise<{ fragment: string; researchQueueItems?: any[] }> {
    const pendingItems = await this.researchQueueService.getPendingItems(context.userId, 5);

    if (pendingItems.length === 0) {
      return {
        fragment: `

🔍 RESEARCH QUEUE:
No pending research topics to surface. If the user asks what to explore, you can ask them what they're curious about.`,
        researchQueueItems: [],
      };
    }

    const formatted = this.researchQueueService.formatQueueForSurfacing(pendingItems);

    return {
      fragment: `

🔍 RESEARCH QUEUE TO SURFACE:
Present these potential research directions to the user:

${formatted}

If they approve any, note it. If they reject, acknowledge and move on. Let them redirect if they want.`,
      researchQueueItems: pendingItems,
    };
  }

  /**
   * Get immutable facts for a user
   */
  private async getImmutableFacts(
    userId: string
  ): Promise<{ content: string; category: string }[]> {
    try {
      // First try the immutable_facts table
      const result = await this.pool.query<{ content: string; category: string }>(
        `SELECT content, category FROM immutable_facts
         WHERE user_id = $1
         ORDER BY category, display_order`,
        [userId]
      );

      if (result.rows.length > 0) {
        return result.rows;
      }

      // Fallback to facts table with is_immutable flag
      const fallbackResult = await this.pool.query<{ content: string; category: string }>(
        `SELECT content, category FROM facts
         WHERE user_id = $1 AND is_immutable = true AND is_active = true
         ORDER BY category, confidence DESC`,
        [userId]
      );

      return fallbackResult.rows;
    } catch (error) {
      // Table might not exist yet, return empty
      logger.debug('Could not fetch immutable facts, table may not exist yet');
      return [];
    }
  }

  /**
   * Generate a human-readable label for a thought
   */
  private getThoughtLabel(thoughtType: string, circadianPhase: string | null): string {
    const typeLabels: Record<string, string> = {
      reflection: 'Morning Reflection',
      curiosity: 'Curious Question',
      consolidation: 'Evening Insight',
      dream: 'Night Dream',
      insight: 'Insight',
      question: 'Question',
    };

    return typeLabels[thoughtType] || thoughtType;
  }

  /**
   * Build a minimal prompt when routing fails
   */
  async buildMinimalPrompt(userId: string): Promise<string> {
    const result = await this.build(['core_identity', 'light_witness'], {
      userId,
    });
    return result.prompt;
  }
}

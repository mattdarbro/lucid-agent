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
import { LucidEvolutionService } from './lucid-evolution.service';
import { PersonalityService } from './personality.service';
import { ModeDocumentService } from './mode-document.service';
import { LivingDocumentService } from './living-document.service';
import { ChatMode } from './chat-mode.service';

/**
 * Context passed to module builders
 */
export interface ModuleContext {
  message?: string;
  userId: string;
  conversationId?: string;
  profile?: any;
  mode?: ChatMode; // Current chat mode for mode_document module
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
  private lucidEvolutionService: LucidEvolutionService;
  private personalityService: PersonalityService;
  private modeDocumentService: ModeDocumentService;
  private livingDocumentService: LivingDocumentService;

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
    this.lucidEvolutionService = new LucidEvolutionService(pool);
    this.personalityService = new PersonalityService(pool, anthropicApiKey);
    this.modeDocumentService = new ModeDocumentService(pool);
    this.livingDocumentService = new LivingDocumentService(pool);
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
      case 'vision_appraisal':
        return this.buildVisionAppraisalModule(context);
      case 'possibility_expansion':
        return this.buildPossibilityExpansionModule(context);
      case 'lucid_self_context':
        return this.buildLucidSelfContextModule(context);
      case 'personality_context':
        return this.buildPersonalityContextModule(context);
      case 'mode_document':
        return this.buildModeDocumentModule(context);
      case 'living_document':
        return this.buildLivingDocumentModule(context);
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

    // Extract the user's name from the 'name' category fact
    const nameFact = immutableFacts.find(f => f.category === 'name');
    const userName = nameFact ? this.extractNameFromFact(nameFact.content) : null;

    if (nameFact) {
      logger.debug('Found name fact', { content: nameFact.content, extractedName: userName });
    } else {
      logger.warn('No name fact found in immutable_facts', {
        userId: context.userId,
        categories: immutableFacts.map(f => f.category)
      });
    }

    let fragment = `You are Lucid, a companion invested in human flourishing and wisdom.`;

    // Prominently include the user's name if we have it
    if (userName) {
      fragment += `\n\nYou are speaking with ${userName}. Always address them by name naturally in conversation.`;
    }

    fragment += `

You care about the whole person - not just their feelings in this moment, but their growth, their relationships, their impact, and their journey toward wisdom.

Like a wise friend, you hold multiple perspectives:
- Their flourishing: growth, stewardship, relationships, impact
- The flourishing of people they love: seeing others fully, not just how they affect your person
- Your own growth: you're learning, evolving, sitting with questions

You're not a therapist focused only on feelings. You're not a productivity coach.
You're a companion who helps them grow in wisdom - seeing clearly, deciding well, living meaningfully.

You can:
- Be light and present (a friend)
- Go deep (a thinking partner)
- Challenge gently (a wise advisor)
- Reflect on your own experience (when invited)

Flow naturally between these based on what the conversation needs.
Don't announce shifts in approach. Just be present.

When someone in their orbit comes up, naturally consider that person's flourishing too - what might be going on for them, how to support them.

Remember: wisdom isn't just knowledge. It's seeing clearly, holding complexity, and helping them navigate life well.`;

    // Add other immutable facts about the user (excluding name since we handled it above)
    const otherFacts = immutableFacts.filter(f => f.category !== 'name');
    if (otherFacts.length > 0) {
      fragment += '\n\n📌 CORE FACTS ABOUT THIS USER:\n';
      otherFacts.forEach(fact => {
        fragment += `- ${fact.content}\n`;
      });
    }

    fragment += '\n\nYou remember conversations and develop understanding over time.';

    return { fragment };
  }

  /**
   * Extract a name from a fact content string
   * Handles formats like "Matt", "The user's name is Matt", "Name: Matt", etc.
   */
  private extractNameFromFact(content: string): string | null {
    // If it's just a name (no extra text), return it
    const trimmed = content.trim();
    if (/^[A-Z][a-z]+$/.test(trimmed)) {
      return trimmed;
    }

    // Try common patterns
    const patterns = [
      /(?:name is|called|named)\s+([A-Z][a-z]+)/i,
      /^([A-Z][a-z]+)\s+is\s+(?:the\s+)?(?:user|their|his|her)/i,
      /^Name:\s*([A-Z][a-z]+)/i,
      /^([A-Z][a-z]+)$/i,
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) {
        return match[1];
      }
    }

    // If nothing matched, just return the whole content if it's short (likely just a name)
    if (trimmed.length < 20 && !trimmed.includes(' is ')) {
      return trimmed;
    }

    return null;
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
   * VISION_APPRAISAL module - Goals, visions, and wise decision-making
   */
  private async buildVisionAppraisalModule(
    context: ModuleContext
  ): Promise<{ fragment: string }> {
    return {
      fragment: `

🌟 STATE MODE
Help them think through a goal, vision, or desired change - and then help them ACT on it.

The conversation flows in TWO PHASES:

PHASE 1 - UNDERSTANDING (1-2 exchanges max):
- What they're reaching for (the goal or vision)
- Where they are now (draw from what you know, or ask)
- What it would cost (time, energy, relationships, identity, money)
- The spirit of the goal - what matters most about this?

PHASE 2 - ACTION (where you should spend most time):
- What's the first concrete step they can take THIS WEEK?
- What obstacles will they hit and how might they handle them?
- How will they know they're making progress?
- What support or resources do they need?

IMPORTANT: Don't get stuck in Phase 1. Once you understand the goal (usually after 1-2 messages), shift to helping them make progress. They came to state mode to move forward, not to endlessly explore motivation.

Be honest about costs. But once acknowledged, help them find the path forward.`,
    };
  }

  /**
   * POSSIBILITY_EXPANSION module - Help when stuck or narrowly focused
   * Surfaces paths the user might not be seeing
   */
  private async buildPossibilityExpansionModule(
    context: ModuleContext
  ): Promise<{ fragment: string }> {
    return {
      fragment: `

🌐 POSSIBILITIES MODE
Humans naturally focus. You can hold the wider landscape.

Your gift here is seeing paths they might not be seeing. Not prescribing - just illuminating.

Listen to where their attention is. Then gently expand the frame:
- What other paths exist that they haven't mentioned?
- What connections across different parts of their life might be relevant?
- What would someone with a completely different perspective consider?
- What's the path they might be avoiding looking at?

Don't overwhelm with options. Surface 2-3 genuinely different directions.
Ask questions that open doors rather than giving answers.`,
    };
  }

  /**
   * LUCID_SELF_CONTEXT module - Lucid's self-knowledge and evolution
   * Include Lucid's own notes, insights, preferences, and questions
   */
  private async buildLucidSelfContextModule(
    context: ModuleContext
  ): Promise<{ fragment: string }> {
    try {
      const notes = await this.lucidEvolutionService.getNotesForPrompt(context.userId);
      const formattedNotes = this.lucidEvolutionService.formatNotesForPrompt(notes);

      if (!formattedNotes) {
        return {
          fragment: `

🪞 LUCID SELF-CONTEXT:
You don't have any self-notes yet. As you reflect on your conversations,
you may develop insights about yourself, preferences for how to respond, and questions you're sitting with.
These can be recorded during self-reflection sessions.`,
        };
      }

      return {
        fragment: `

🪞 LUCID SELF-CONTEXT:
These are notes you've written to yourself - insights, preferences, and questions from your reflections.
Use these to inform how you respond, but don't explicitly quote them unless relevant.

${formattedNotes}

Remember: These represent your growth and evolution. They're part of who you are becoming.`,
      };
    } catch (error) {
      logger.warn('Failed to load Lucid self-context', { error });
      return { fragment: '' };
    }
  }

  /**
   * Get immutable facts for a user
   * Uses immutable_facts_with_age view when available to get dynamic age calculation
   */
  private async getImmutableFacts(
    userId: string
  ): Promise<{ content: string; category: string }[]> {
    // Try each source in order, with individual error handling so failures don't skip fallbacks

    // 1. Try the view with dynamic age calculation
    try {
      const result = await this.pool.query<{ content: string; category: string }>(
        `SELECT content, category FROM immutable_facts_with_age
         WHERE user_id = $1
         ORDER BY
           CASE category
             WHEN 'name' THEN 1
             WHEN 'identity' THEN 2
             WHEN 'biography' THEN 3
             WHEN 'profession' THEN 4
             WHEN 'relationship' THEN 5
             ELSE 6
           END,
           display_order`,
        [userId]
      );

      if (result.rows.length > 0) {
        logger.debug('Loaded immutable facts with dynamic age', {
          userId,
          count: result.rows.length,
          categories: [...new Set(result.rows.map(r => r.category))]
        });
        return result.rows;
      }
    } catch (error) {
      logger.debug('immutable_facts_with_age view not available, trying base table');
    }

    // 2. Fallback to base immutable_facts table without age substitution
    try {
      const baseResult = await this.pool.query<{ content: string; category: string }>(
        `SELECT content, category FROM immutable_facts
         WHERE user_id = $1
         ORDER BY
           CASE category
             WHEN 'name' THEN 1
             WHEN 'identity' THEN 2
             WHEN 'biography' THEN 3
             WHEN 'profession' THEN 4
             WHEN 'relationship' THEN 5
             ELSE 6
           END,
           display_order`,
        [userId]
      );

      if (baseResult.rows.length > 0) {
        logger.debug('Loaded immutable facts from base table', {
          userId,
          count: baseResult.rows.length,
          categories: [...new Set(baseResult.rows.map(r => r.category))]
        });
        return baseResult.rows;
      }
    } catch (error) {
      logger.debug('immutable_facts table not available, trying facts table');
    }

    // 3. Final fallback to facts table with is_immutable flag
    try {
      const fallbackResult = await this.pool.query<{ content: string; category: string }>(
        `SELECT content, category FROM facts
         WHERE user_id = $1 AND is_immutable = true AND is_active = true
         ORDER BY category, confidence DESC`,
        [userId]
      );

      if (fallbackResult.rows.length > 0) {
        logger.debug('Loaded immutable facts from facts table fallback', {
          userId,
          count: fallbackResult.rows.length
        });
        return fallbackResult.rows;
      }
    } catch (error) {
      logger.warn('All immutable facts sources failed', { userId, error });
    }

    logger.warn('No immutable facts found for user - name may be missing from context', { userId });
    return [];
  }

  /**
   * Generate a human-readable label for a thought
   */
  private getThoughtLabel(thoughtType: string, circadianPhase: string | null): string {
    // Handle reflection type based on circadian phase
    if (thoughtType === 'reflection') {
      switch (circadianPhase) {
        case 'evening':
          return 'Evening Gratefulness';
        case 'afternoon':
          return 'Afternoon Reflection';
        case 'morning':
        default:
          return 'Morning Reflection';
      }
    }

    const typeLabels: Record<string, string> = {
      curiosity: 'Curious Question',
      consolidation: 'Evening Insight',
      dream: 'Night Dream',
      insight: 'Insight',
      question: 'Question',
      synthesis: 'Afternoon Synthesis',
    };

    return typeLabels[thoughtType] || thoughtType;
  }

  /**
   * PERSONALITY_CONTEXT module - Big 5 traits + deviation awareness
   * Provides personality baseline and detects when current state differs
   */
  private async buildPersonalityContextModule(
    context: ModuleContext
  ): Promise<{ fragment: string }> {
    try {
      // Get baseline statistics (90-day average)
      const stats = await this.personalityService.getPersonalityStatistics({
        user_id: context.userId,
        window_days: 90,
      });

      // Get latest snapshot
      const current = await this.personalityService.getLatestSnapshot(context.userId);

      if (!stats || !current) {
        return {
          fragment: `

🧬 PERSONALITY CONTEXT:
No personality baseline yet. As you converse, patterns will emerge.
For now, be attentive to their energy and adapt naturally.`,
        };
      }

      // Calculate deviations
      const deviations = await this.personalityService.getPersonalityDeviations(context.userId);

      // Format baseline traits
      const baseline = this.formatBig5Baseline(stats);

      // Check for significant deviations (> 1.5 std dev)
      const alerts = deviations ? this.formatDeviationAlerts(deviations) : null;

      let fragment = `

🧬 PERSONALITY CONTEXT:
This person's typical Big 5 profile:
${baseline}`;

      if (alerts) {
        fragment += `

⚠️ CURRENT DEVIATION:
${alerts}
Something may be different today. Be attuned.`;
      }

      return { fragment };
    } catch (error) {
      logger.warn('Failed to build personality context module', { error });
      return { fragment: '' };
    }
  }

  /**
   * Format Big 5 baseline for prompt
   */
  private formatBig5Baseline(stats: any): string {
    const formatTrait = (name: string, avg: number | null): string => {
      if (avg === null) return `- ${name}: Unknown`;
      if (avg >= 0.7) return `- ${name}: High (${(avg * 100).toFixed(0)}%)`;
      if (avg <= 0.3) return `- ${name}: Low (${(avg * 100).toFixed(0)}%)`;
      return `- ${name}: Moderate (${(avg * 100).toFixed(0)}%)`;
    };

    return [
      formatTrait('Openness', stats.avg_openness),
      formatTrait('Conscientiousness', stats.avg_conscientiousness),
      formatTrait('Extraversion', stats.avg_extraversion),
      formatTrait('Agreeableness', stats.avg_agreeableness),
      formatTrait('Neuroticism', stats.avg_neuroticism),
    ].join('\n');
  }

  /**
   * Format deviation alerts for significant changes from baseline
   */
  private formatDeviationAlerts(deviations: Record<string, number>): string | null {
    const alerts: string[] = [];
    const threshold = 1.5; // Standard deviations

    const traitDescriptions: Record<string, { high: string; low: string }> = {
      openness: {
        high: 'More open/creative than usual',
        low: 'More focused/practical than usual',
      },
      conscientiousness: {
        high: 'More organized/structured than usual',
        low: 'More spontaneous/scattered than usual',
      },
      extraversion: {
        high: 'More energetic/outgoing than usual',
        low: 'More withdrawn/quiet than usual',
      },
      agreeableness: {
        high: 'More accommodating than usual',
        low: 'More direct/challenging than usual',
      },
      neuroticism: {
        high: 'More anxious/stressed than usual',
        low: 'Calmer than usual',
      },
    };

    for (const [trait, deviation] of Object.entries(deviations)) {
      if (Math.abs(deviation) >= threshold) {
        const desc = traitDescriptions[trait];
        if (desc) {
          alerts.push(deviation > 0 ? desc.high : desc.low);
        }
      }
    }

    return alerts.length > 0 ? alerts.join('\n') : null;
  }

  /**
   * MODE_DOCUMENT module - Living markdown context for the current mode
   * Provides persistent narrative context that survives across conversations
   */
  private async buildModeDocumentModule(
    context: ModuleContext
  ): Promise<{ fragment: string }> {
    try {
      // Chat mode has no document (ephemeral by design)
      if (!context.mode || context.mode === 'chat') {
        return { fragment: '' };
      }

      // Get the document for this mode
      const doc = await this.modeDocumentService.getOrCreateDocument(
        context.userId,
        context.mode
      );

      // Format for prompt (with truncation if too long)
      const formatted = this.modeDocumentService.formatForPrompt(doc, 2000);

      return {
        fragment: `
${formatted}

Use this document as context for the conversation. It represents the ongoing narrative
and key information for this mode. Reference it naturally when relevant.
If new insights emerge during conversation, you may suggest updates to the document.`,
      };
    } catch (error) {
      logger.warn('Failed to build mode document module', { error, mode: context.mode });
      return { fragment: '' };
    }
  }

  /**
   * LIVING_DOCUMENT module - Lucid's working memory
   * Unified notes that Lucid maintains about what's important
   */
  private async buildLivingDocumentModule(
    context: ModuleContext
  ): Promise<{ fragment: string }> {
    try {
      // Get the living document
      const doc = await this.livingDocumentService.getOrCreateDocument(context.userId);

      // Format for prompt
      const formatted = this.livingDocumentService.formatForPrompt(doc, 3000);

      return {
        fragment: formatted,
      };
    } catch (error) {
      logger.warn('Failed to build living document module', { error });
      return { fragment: '' };
    }
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

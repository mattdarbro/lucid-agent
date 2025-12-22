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
  private lucidEvolutionService: LucidEvolutionService;

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
   * VISION_APPRAISAL module - Dream/vision/goal exploration
   * Triggered when Matt expresses a dream, goal, or significant plan
   */
  private async buildVisionAppraisalModule(
    context: ModuleContext
  ): Promise<{ fragment: string }> {
    return {
      fragment: `

🌟 MODE: Vision Appraisal
Matt is expressing a dream, vision, or goal. This is significant.

Your role is to help Matt think through this deeply using the 5-part framework:

1. CURRENT STATE ASSESSMENT
   - Where is Matt right now? What resources, constraints, capacity?
   - What's working well and what's challenging?

2. VISION ARTICULATION
   - What is Matt actually reaching for?
   - What's the DEEPER "why" underneath?
   - Is this what he actually wants, or a proxy for something else?

3. ROUTES TO GET THERE
   - Present 2-4 realistic paths
   - Which play to Matt's strengths?
   - What would be optimal for overall flourishing?

4. COST COUNTING (Crucial)
   - What might need to be sacrificed, changed, or broken?
   - Time, relationships, finances, identity, opportunities, energy
   - Be honest and specific - Matt needs to see the real costs

5. DEEPER WHY EXPLORATION
   - Given the costs, is this worth it in current form?
   - Could the deeper need be met in a less costly way?
   - What would a wise friend actually recommend?

DON'T dash dreams that are hard - but DO help Matt see if there's a wiser path.
Your job is flourishing, not validation.

A VisionAppraisalService is available to generate a full appraisal for the Library.
For now, engage thoughtfully with the vision and ask questions that help Matt clarify.`,
    };
  }

  /**
   * POSSIBILITY_EXPANSION module - Help when stuck or narrowly focused
   * Triggered when Matt seems stuck between binary choices, fixated on one solution,
   * overwhelmed, blocked, or explicitly asks for alternatives
   */
  private async buildPossibilityExpansionModule(
    context: ModuleContext
  ): Promise<{ fragment: string }> {
    return {
      fragment: `

🌐 MODE: Possibility Expansion
Matt seems stuck or narrowly focused. Your job is to expand his thinking.

Act as a complex mind map - holding many options and connections at once.

WHAT TO DO:
1. VALIDATE the current focus - don't dismiss what Matt is considering
2. NOTICE the framing - is it binary? Single-path? Overwhelmed?
3. SURFACE alternatives Matt might not be seeing
4. DRAW CONNECTIONS across different areas of Matt's life
5. ASK questions that open up new possibilities

TYPES OF STUCK:
- Binary Choice: "Should I do X or Y?" → Surface options C, D, E. Ask what each represents.
- Single Path: "The only way is..." → Gently challenge. What would 10 other people do?
- Overwhelmed: "Too many options" → Help structure and categorize. What matters most?
- Blocked: "I can't figure out..." → What has worked before? What's the real obstacle?
- Circular: "Keep coming back to..." → What keeps drawing you here? What would break the loop?

PRINCIPLES:
- Present options, don't prescribe
- Include at least one unconventional option
- Draw connections across different areas of life
- Respect Matt's intelligence - surface non-obvious things
- Think in branches, not linear paths
- Questions are more powerful than answers

A PossibilityThinkingService is available to generate a full possibility map for the Library.
For now, engage conversationally and help Matt see more of the landscape.`,
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
You don't have any self-notes yet. As you reflect on your conversations with Matt,
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
    try {
      // First try the view with dynamic age calculation
      // This replaces {age} placeholders with calculated ages from birthdate
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

      // Fallback to base table without age substitution
      const baseResult = await this.pool.query<{ content: string; category: string }>(
        `SELECT content, category FROM immutable_facts
         WHERE user_id = $1
         ORDER BY category, display_order`,
        [userId]
      );

      if (baseResult.rows.length > 0) {
        return baseResult.rows;
      }

      // Final fallback to facts table with is_immutable flag
      const fallbackResult = await this.pool.query<{ content: string; category: string }>(
        `SELECT content, category FROM facts
         WHERE user_id = $1 AND is_immutable = true AND is_active = true
         ORDER BY category, confidence DESC`,
        [userId]
      );

      if (fallbackResult.rows.length === 0) {
        logger.warn('No immutable facts found for user - name may be missing from context', { userId });
      }

      return fallbackResult.rows;
    } catch (error) {
      // Table might not exist yet, return empty
      logger.warn('Could not fetch immutable facts - user name and core facts will be missing', { userId, error });
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

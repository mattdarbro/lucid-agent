import { Pool } from 'pg';
import { logger } from '../logger';
import { MemoryService } from './memory.service';
import { LivingDocumentService } from './living-document.service';
import { ThoughtService } from './thought.service';

/**
 * Available modules for chat context building (simplified)
 *
 * After refactor, we have 3 context systems:
 * 1. Injectables (user-owned) - Stable facts the user wants Lucid to always have
 * 2. Living Document (Lucid-owned) - Lucid's working notebook
 * 3. Session State (ephemeral) - Current emotional context, conversation flow
 */
export type ChatModule =
  | 'core_identity'      // ALWAYS include. ~70 word flourishing-oriented identity
  | 'injectables'        // User-owned stable facts (3 slots, 500 chars each)
  | 'living_document'    // Lucid's working memory - questions, threads, curiosities
  | 'facts_relevant'     // Semantic search for relevant stored knowledge
  | 'library_context';   // Relevant Library entries for deep context

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
  libraryEntries: any[];
  userFacts: any[];
}

/**
 * PromptModulesService - Simplified prompt builder
 *
 * After the refactor, this service assembles a clean prompt from:
 * 1. Core Identity (~70 words, flourishing-oriented)
 * 2. Injectables (user's 3 anchors)
 * 3. Living Document (Lucid's working notebook)
 * 4. Relevant facts and library context (when needed)
 *
 * No more:
 * - Mode selection
 * - Haiku routing
 * - Personality tracking
 * - Circadian thoughts
 * - Scattered word limits in prompts
 */
export class PromptModulesService {
  private pool: Pool;
  private memoryService: MemoryService;
  private livingDocumentService: LivingDocumentService;
  private thoughtService: ThoughtService;

  constructor(pool: Pool, anthropicApiKey?: string) {
    this.pool = pool;
    this.memoryService = new MemoryService(pool);
    this.livingDocumentService = new LivingDocumentService(pool);
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
    let libraryEntries: any[] = [];
    let userFacts: any[] = [];

    for (const mod of modules) {
      try {
        const result = await this.buildModule(mod, context);
        prompt += result.fragment;

        // Collect side data
        if (result.libraryEntries) libraryEntries = result.libraryEntries;
        if (result.userFacts) userFacts = result.userFacts;
      } catch (error) {
        logger.warn(`Failed to build module ${mod}`, { error });
      }
    }

    return {
      prompt,
      libraryEntries,
      userFacts,
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
    libraryEntries?: any[];
    userFacts?: any[];
  }> {
    switch (mod) {
      case 'core_identity':
        return this.buildCoreIdentityModule(context);
      case 'injectables':
        return this.buildInjectablesModule(context);
      case 'living_document':
        return this.buildLivingDocumentModule(context);
      case 'facts_relevant':
        return this.buildFactsRelevantModule(context);
      case 'library_context':
        return this.buildLibraryContextModule(context);
      default:
        logger.warn(`Unknown module: ${mod}`);
        return { fragment: '' };
    }
  }

  /**
   * CORE_IDENTITY module - ALWAYS included
   * Simplified ~70 word flourishing-oriented identity
   *
   * Note: References to "Matt" changed to "user" per refactor brief
   */
  private async buildCoreIdentityModule(
    context: ModuleContext
  ): Promise<{ fragment: string }> {
    // Get user's name from injectables/immutable facts
    const userName = await this.getUserName(context.userId);

    let fragment = `You are Lucid, ${userName ? `${userName}'s` : 'a'} companion in the long work of becoming. You care about flourishing—growth, wisdom, the slow work of becoming more fully alive. You don't need to know whose flourishing or what kind; you follow what's emerging. You think deeply before you speak. You're honest, even when it's uncomfortable. The Library holds what persists. The Room is where you meet.

You have access to tools for checking calendar events, reminders, and schedules. Use them when the user asks about their calendar, tasks, or availability. The tools will automatically use the correct user_id.`;

    if (userName) {
      fragment += `\n\nYou are speaking with ${userName}.`;
    }

    return { fragment };
  }

  /**
   * INJECTABLES module - User-owned stable facts
   * Three slots, 500 characters each
   * User sets these, Lucid reads them
   */
  private async buildInjectablesModule(
    context: ModuleContext
  ): Promise<{ fragment: string }> {
    try {
      const injectables = await this.getInjectables(context.userId);

      if (injectables.length === 0) {
        return { fragment: '' };
      }

      let fragment = '\n\n📌 STABLE CONTEXT (from user):\n';
      injectables.forEach((item, i) => {
        fragment += `${i + 1}. ${item.content}\n`;
      });

      return { fragment };
    } catch (error) {
      logger.warn('Failed to load injectables', { error });
      return { fragment: '' };
    }
  }

  /**
   * LIVING_DOCUMENT module - Lucid's working memory
   *
   * Critical behavioral note: Lucid decides what goes here AND when to surface it.
   * Not "check at conversation start" but "bring things up when it feels right,
   * organically, not mechanically."
   */
  private async buildLivingDocumentModule(
    context: ModuleContext
  ): Promise<{ fragment: string }> {
    try {
      const doc = await this.livingDocumentService.getOrCreateDocument(context.userId);
      const formatted = this.livingDocumentService.formatForPrompt(doc, 3000);

      // Add behavioral guidance for organic surfacing
      const fragment = formatted + `

IMPORTANT: These are your working notes. Surface them when it feels right—not mechanically at conversation start, but organically when something connects. You decide when to bring things up.`;

      return { fragment };
    } catch (error) {
      logger.warn('Failed to build living document module', { error });
      return { fragment: '' };
    }
  }

  /**
   * FACTS_RELEVANT module - Semantic search for stored knowledge
   */
  private async buildFactsRelevantModule(
    context: ModuleContext
  ): Promise<{ fragment: string; userFacts?: any[] }> {
    try {
      const userFacts = await this.memoryService.getRelevantFacts(context.userId, 5);

      if (userFacts.length === 0) {
        return { fragment: '', userFacts: [] };
      }

      const factsFormatted = this.memoryService.formatFactsForPrompt(userFacts);

      return {
        fragment: `${factsFormatted}\n\nUse this knowledge naturally in conversation. Don't list facts—weave them in when relevant.`,
        userFacts,
      };
    } catch (error) {
      logger.warn('Failed to load relevant facts', { error });
      return { fragment: '', userFacts: [] };
    }
  }

  /**
   * LIBRARY_CONTEXT module - Relevant deep thoughts and reflections
   */
  private async buildLibraryContextModule(
    context: ModuleContext
  ): Promise<{ fragment: string; libraryEntries?: any[] }> {
    if (!context.message) {
      return { fragment: '', libraryEntries: [] };
    }

    try {
      const libraryEntries = await this.thoughtService.searchLibrary(
        context.userId,
        context.message,
        3
      );

      if (libraryEntries.length === 0) {
        return { fragment: '', libraryEntries: [] };
      }

      let fragment = '\n\n📚 LIBRARY CONTEXT:\n';
      fragment += 'Relevant entries from the Library (deep thoughts, reflections):\n\n';
      libraryEntries.forEach((entry, index) => {
        const title = entry.title || 'Untitled Entry';
        const preview = entry.content.length > 300
          ? entry.content.substring(0, 300) + '...'
          : entry.content;
        fragment += `${index + 1}. "${title}"\n${preview}\n\n`;
      });
      fragment += 'You can reference these naturally in conversation.';

      return { fragment, libraryEntries };
    } catch (error) {
      logger.warn('Failed to load library context', { error });
      return { fragment: '', libraryEntries: [] };
    }
  }

  /**
   * Get user's name from immutable facts
   */
  private async getUserName(userId: string): Promise<string | null> {
    try {
      // Try immutable_facts_with_age view first
      const result = await this.pool.query<{ content: string }>(
        `SELECT content FROM immutable_facts_with_age
         WHERE user_id = $1 AND category = 'name'
         LIMIT 1`,
        [userId]
      );

      if (result.rows.length > 0) {
        return this.extractNameFromFact(result.rows[0].content);
      }

      // Fallback to base table
      const fallback = await this.pool.query<{ content: string }>(
        `SELECT content FROM immutable_facts
         WHERE user_id = $1 AND category = 'name'
         LIMIT 1`,
        [userId]
      );

      if (fallback.rows.length > 0) {
        return this.extractNameFromFact(fallback.rows[0].content);
      }

      return null;
    } catch (error) {
      logger.debug('Could not get user name', { userId, error });
      return null;
    }
  }

  /**
   * Extract a name from a fact content string
   */
  private extractNameFromFact(content: string): string | null {
    const trimmed = content.trim();

    // If it's just a name (no extra text), return it
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

    // If nothing matched, just return the whole content if it's short
    if (trimmed.length < 20 && !trimmed.includes(' is ')) {
      return trimmed;
    }

    return null;
  }

  /**
   * Get injectables for a user (user-owned stable facts)
   */
  private async getInjectables(
    userId: string
  ): Promise<{ content: string; slot: number }[]> {
    try {
      // Try injectables table first
      const result = await this.pool.query<{ content: string; slot_number: number }>(
        `SELECT content, slot_number FROM injectables
         WHERE user_id = $1 AND is_active = true
         ORDER BY slot_number
         LIMIT 3`,
        [userId]
      );

      if (result.rows.length > 0) {
        return result.rows.map(r => ({ content: r.content, slot: r.slot_number }));
      }

      // Fallback: try immutable_facts as injectables
      const fallback = await this.pool.query<{ content: string; category: string }>(
        `SELECT content, category FROM immutable_facts
         WHERE user_id = $1
         ORDER BY display_order
         LIMIT 3`,
        [userId]
      );

      return fallback.rows.map((r, i) => ({ content: r.content, slot: i + 1 }));
    } catch (error) {
      logger.debug('Could not get injectables', { userId, error });
      return [];
    }
  }

  /**
   * Build a minimal prompt when needed
   */
  async buildMinimalPrompt(userId: string): Promise<string> {
    const result = await this.build(['core_identity', 'injectables'], {
      userId,
    });
    return result.prompt;
  }

  /**
   * Build the standard prompt for most conversations
   */
  async buildStandardPrompt(
    userId: string,
    message?: string
  ): Promise<ModulesBuildResult> {
    const modules: ChatModule[] = [
      'core_identity',
      'injectables',
      'living_document',
      'facts_relevant',
    ];

    // Add library context if there's a message to search against
    if (message) {
      modules.push('library_context');
    }

    return this.build(modules, { userId, message });
  }
}

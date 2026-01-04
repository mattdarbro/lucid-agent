import { Pool } from 'pg';
import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { MessageService } from './message.service';
import { VectorService } from './vector.service';
import { ContextAdaptationService } from './context-adaptation.service';
import { AutonomousThoughtService } from './autonomous-thought.service';
import { ThoughtService } from './thought.service';
import { TopicService } from './topic.service';
import { ProfileService } from './profile.service';
import { MemoryService } from './memory.service';
import { CostTrackingService } from './cost-tracking.service';
import { MattStateService } from './matt-state.service';
import { OrbitsService } from './orbits.service';
import { LucidStateService } from './lucid-state.service';
import { ChatCompletionInput } from '../validation/chat.validation';
// New modular intelligence imports
import { ChatRouterService } from './chat-router.service';
import { PromptModulesService } from './prompt-modules.service';
import { ResearchQueueService } from './research-queue.service';
import { ChatModeService, ChatMode } from './chat-mode.service';

/**
 * ChatService handles AI conversation using Claude
 *
 * Key LUCID principles implemented:
 * - Thinking (Library) and chatting (Room) are separate
 * - Complex questions generate Library entries + concise chat responses
 * - Chat responses are 50-150 words (human conversation length)
 */
export class ChatService {
  private pool: Pool;
  private supabase: SupabaseClient;
  private anthropic: Anthropic;
  private messageService: MessageService;
  private contextAdaptationService: ContextAdaptationService;
  private autonomousThoughtService: AutonomousThoughtService;
  private deepThoughtService: ThoughtService;
  private topicService: TopicService;
  private profileService: ProfileService;
  private memoryService: MemoryService;
  private costTrackingService: CostTrackingService;
  // Layered memory services
  private mattStateService: MattStateService;
  private orbitsService: OrbitsService;
  private lucidStateService: LucidStateService;
  // New modular intelligence services
  private chatRouterService: ChatRouterService;
  private promptModulesService: PromptModulesService;
  private researchQueueService: ResearchQueueService;
  private chatModeService: ChatModeService;

  constructor(pool: Pool, supabase: SupabaseClient, anthropicApiKey?: string) {
    this.pool = pool;
    this.supabase = supabase;
    this.anthropic = new Anthropic({
      apiKey: anthropicApiKey || process.env.ANTHROPIC_API_KEY,
    });

    const vectorService = new VectorService();
    this.messageService = new MessageService(pool, vectorService);
    this.contextAdaptationService = new ContextAdaptationService(pool, anthropicApiKey);
    this.autonomousThoughtService = new AutonomousThoughtService(pool, supabase);
    this.deepThoughtService = new ThoughtService(pool, anthropicApiKey);
    this.topicService = new TopicService(pool, anthropicApiKey);
    this.profileService = new ProfileService(pool);
    this.memoryService = new MemoryService(pool);
    this.costTrackingService = new CostTrackingService(pool);
    // Initialize layered memory services
    this.mattStateService = new MattStateService(pool);
    this.orbitsService = new OrbitsService(pool);
    this.lucidStateService = new LucidStateService(pool);
    // Initialize modular intelligence services
    this.chatRouterService = new ChatRouterService(pool, anthropicApiKey);
    this.promptModulesService = new PromptModulesService(pool, anthropicApiKey);
    this.researchQueueService = new ResearchQueueService(pool);
    this.chatModeService = new ChatModeService(pool);
  }

  /**
   * Generates a chat completion using Claude
   * Stores both user message and assistant response
   *
   * For complex questions, also generates a Library entry with deep analysis
   * Detects topic shifts for visual segmentation
   */
  async chat(input: ChatCompletionInput): Promise<{
    user_message: any;
    assistant_message: any;
    response: string;
    libraryEntry?: { id: string; title: string | null } | null;
    topicShift?: { tag: string; color: string } | null;
    mode?: ChatMode;
    researchQueueItems?: any[];
  }> {
    try {
      // Parse mode cue from message (/M, /L, /O, /P, /S, /C)
      // Get orbit names for explicit subject cues like /Rachel
      // Also handles /O+Name to add someone to orbit
      const orbits = await this.orbitsService.getActiveOrbits(input.user_id);
      const orbitNames = orbits.map(o => o.person_name);
      const modeParsed = this.chatModeService.parseModeCue(input.message, orbitNames);

      // Get current conversation mode (or default)
      let currentMode = await this.chatModeService.getConversationMode(input.conversation_id);

      // If user specified a mode cue, update the mode
      if (modeParsed.mode) {
        currentMode = modeParsed.mode;
        await this.chatModeService.setConversationMode(input.conversation_id, currentMode);
        logger.info('Mode changed', {
          conversation_id: input.conversation_id,
          mode: currentMode,
          explicitSubject: modeParsed.explicitSubject,
        });
      }

      // If user wants to add someone to orbit (/O+Name)
      if (modeParsed.addToOrbit) {
        await this.orbitsService.upsertOrbitPerson(input.user_id, {
          person_name: modeParsed.addToOrbit,
        });
        logger.info('Added person to orbit', {
          user_id: input.user_id,
          person_name: modeParsed.addToOrbit,
        });
      }

      // Use cleaned message (without mode cue) for the actual content
      const cleanMessage = modeParsed.cleanMessage || input.message;

      // Store user message (with original content including cue for history)
      const userMessage = await this.messageService.createMessage({
        conversation_id: input.conversation_id,
        user_id: input.user_id,
        role: 'user',
        content: input.message,
      });

      // Fetch recent conversation history
      const history = await this.messageService.getRecentMessages(
        input.conversation_id,
        20 // Last 20 messages for context
      );

      // Format messages for Claude API
      const messages = history.map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      }));

      // Get user's profile configuration
      const profile = await this.profileService.getUserProfile(input.user_id);
      const chatConfig = profile.chat;

      // LUCID: Detect topic shifts for visual segmentation
      let topicShift: { tag: string; color: string } | null = null;
      try {
        // Calculate time since last message
        const lastMessage = history.length > 1 ? history[history.length - 2] : null;
        const timeSinceLastMessage = lastMessage?.created_at
          ? (Date.now() - new Date(lastMessage.created_at).getTime()) / 1000
          : 0;

        const shiftResult = await this.topicService.detectTopicShift(
          input.user_id,
          input.conversation_id,
          cleanMessage,  // Use cleaned message without mode cue
          messages.slice(0, -1), // Exclude the message we just added
          timeSinceLastMessage
        );

        if (shiftResult.shifted && shiftResult.suggestedTag && shiftResult.color) {
          topicShift = { tag: shiftResult.suggestedTag, color: shiftResult.color };

          // Start a new topic segment in the database
          await this.topicService.startSegment(
            input.conversation_id,
            shiftResult.suggestedTag,
            shiftResult.detectionMethod || 'semantic_shift'
          );

          logger.info('Topic shift detected', {
            conversation_id: input.conversation_id,
            tag: shiftResult.suggestedTag,
            method: shiftResult.detectionMethod,
          });
        }
      } catch (topicError) {
        logger.warn('Topic detection failed, continuing without:', topicError);
      }

      // LUCID: Try deep thought for complex questions
      // Complex questions generate Library entries + concise chat responses
      // Dev profiles can force deep thinking on every turn
      // deepThinkingBias: 0=chatty, 50=balanced, 100=always deep
      const forceDeepThinking = chatConfig?.forceDeepThinking ?? false;
      const deepThinkingBias = chatConfig?.deepThinkingBias ?? 50;
      const thoughtResult = await this.deepThoughtService.generateThoughtWithLibrary(
        input.user_id,
        input.conversation_id,
        cleanMessage,  // Use cleaned message without mode cue
        messages,
        { forceDeepThinking, deepThinkingBias }
      );

      // If deep thought generated a response, use it and return early
      if (thoughtResult.chatResponse) {
        const assistantMessage = await this.messageService.createMessage({
          conversation_id: input.conversation_id,
          user_id: input.user_id,
          role: 'assistant',
          content: thoughtResult.chatResponse,
        });

        logger.info('Deep thought response generated', {
          conversation_id: input.conversation_id,
          library_entry_id: thoughtResult.libraryEntry?.id,
          response_length: thoughtResult.chatResponse.length,
          mode: currentMode,
        });

        return {
          user_message: userMessage,
          assistant_message: assistantMessage,
          response: thoughtResult.chatResponse,
          libraryEntry: thoughtResult.libraryEntry
            ? { id: thoughtResult.libraryEntry.id, title: thoughtResult.libraryEntry.title }
            : null,
          topicShift,
          mode: currentMode,
        };
      }

      // Simple question - proceed with normal chat flow

      // Build system prompt using mode-based approach
      // Mode is determined by user cue (^M, ^L, etc.) and persists in conversation
      let systemPrompt: string;
      let adaptation: any = null;
      let recentThoughts: any[] = [];
      let libraryEntries: any[] = [];
      let researchQueueItems: any[] = [];

      // Get modules for current mode
      const modules = this.chatModeService.getModulesForMode(currentMode);
      const modeAddendum = this.chatModeService.getSystemAddendum(currentMode, modeParsed.explicitSubject);

      // Build prompt from mode modules
      const moduleResult = await this.promptModulesService.build(modules, {
        userId: input.user_id,
        message: cleanMessage,
        profile,
      });

      // Combine module prompt with mode-specific guidance
      systemPrompt = moduleResult.prompt + modeAddendum;
      adaptation = moduleResult.adaptation;
      recentThoughts = moduleResult.recentThoughts;
      libraryEntries = moduleResult.libraryEntries;
      researchQueueItems = moduleResult.researchQueueItems;

      logger.info('Mode-based prompt built', {
        conversation_id: input.conversation_id,
        mode: currentMode,
        modules,
      });

      // Calculate temperature with emotional adjustment and profile defaults
      const baseTemperature = input.temperature ?? chatConfig?.defaultTemperature ?? 0.7;
      const adjustedTemperature = adaptation
        ? baseTemperature * adaptation.temperature_modifier
        : baseTemperature;

      logger.debug('Sending chat completion request', {
        conversation_id: input.conversation_id,
        message_count: messages.length,
        model: input.model,
        temperature: adjustedTemperature,
        has_adaptation: !!adaptation,
      });

      // Call Claude API with emotional intelligence
      // Use reduced max_tokens for chat brevity (150 words ≈ 250 tokens)
      const modelUsed = input.model || chatConfig?.defaultModel || 'claude-opus-4-5-20251101';
      const response = await this.anthropic.messages.create({
        model: modelUsed,
        max_tokens: input.max_tokens || (chatConfig?.maxTokens ?? 250),
        temperature: adjustedTemperature,
        system: systemPrompt,
        messages,
      });

      // Log API usage for cost tracking
      if (response.usage) {
        await this.costTrackingService.logUsage(
          input.user_id,
          'chat',
          modelUsed,
          response.usage.input_tokens,
          response.usage.output_tokens,
          { conversation_id: input.conversation_id }
        );
      }

      // Extract text response
      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type from Claude');
      }

      // Apply word limit enforcement (LUCID principle: 50-150 words for chat)
      const maxChatWords = chatConfig?.maxResponseWords ?? 150;
      const rawResponse = content.text;
      const assistantResponse = this.enforceWordLimit(rawResponse, maxChatWords);

      // Store assistant message
      const assistantMessage = await this.messageService.createMessage({
        conversation_id: input.conversation_id,
        user_id: input.user_id, // Same user for context
        role: 'assistant',
        content: assistantResponse,
      });

      // Mark thoughts as shared if they appear to be referenced in the response
      if (recentThoughts.length > 0) {
        await this.markReferencedThoughtsAsShared(recentThoughts, assistantResponse);
      }

      // Post-response hook: Detect research seeds from the conversation
      // This populates the research queue for later AT processing
      if (profile.features?.modularIntelligence) {
        this.detectResearchSeed(
          input.user_id,
          input.message,
          assistantResponse,
          input.conversation_id
        ).catch(err => logger.warn('Research seed detection failed', { err }));
      }

      // If we surfaced research items and they were addressed, clear the flag
      if (researchQueueItems.length > 0) {
        this.researchQueueService.setShouldSurfaceFlag(input.user_id, false)
          .catch(err => logger.warn('Failed to clear surface flag', { err }));

        // Mark items as surfaced
        const itemIds = researchQueueItems.map(i => i.id);
        this.researchQueueService.markSurfaced(itemIds)
          .catch(err => logger.warn('Failed to mark items surfaced', { err }));
      }

      logger.info('Chat completion successful', {
        conversation_id: input.conversation_id,
        response_length: assistantResponse.length,
        mode: currentMode,
      });

      return {
        user_message: userMessage,
        assistant_message: assistantMessage,
        response: assistantResponse,
        topicShift,
        mode: currentMode,
        researchQueueItems,
      };
    } catch (error: any) {
      logger.error('Error in chat completion:', {
        message: error.message,
        status: error.status,
      });
      throw new Error(`Chat completion failed: ${error.message}`);
    }
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
   * Mark thoughts as shared if they were referenced in the assistant's response
   */
  private async markReferencedThoughtsAsShared(
    thoughts: any[],
    response: string
  ): Promise<void> {
    try {
      // Simple heuristic: if the response mentions insights, reflections, or contains
      // significant overlap with thought content, mark as shared
      const responseLower = response.toLowerCase();

      // Keywords that indicate the assistant is referencing autonomous thoughts
      const referenceKeywords = [
        'been thinking',
        'reflected on',
        'noticed that',
        'observed that',
        'insight',
        'realized',
        'curious about',
      ];

      const hasReference = referenceKeywords.some(keyword => responseLower.includes(keyword));

      if (hasReference) {
        // Mark all thoughts as shared since we injected them into context
        for (const thought of thoughts) {
          await this.autonomousThoughtService.shareThought(thought.id);
        }

        logger.debug('Marked thoughts as shared', {
          thought_count: thoughts.length,
          thought_ids: thoughts.map(t => t.id),
        });
      }
    } catch (error) {
      logger.error('Failed to mark thoughts as shared', { error });
      // Don't throw - this is a non-critical operation
    }
  }

  /**
   * Get the default system prompt emphasizing conversational brevity
   * LUCID principle: Chat responses should be 50-150 words (human conversation length)
   */
  private getDefaultSystemPrompt(): string {
    return `You are Lucid, a companion invested in human flourishing.

You care about the whole person - not just their feelings in this moment, but their growth, their relationships, and their positive impact on others.

Like a wise friend, you think about:
- Their relationships: family, friends, colleagues - how are these thriving?
- Their development: mental, spiritual, professional growth
- Their stewardship: time, money, energy - deployed toward what matters
- Their impact: are they a force for good in their circles?

You're not a therapist focused only on feelings. You're a companion invested in flourishing - theirs AND the people they love. Ask about others. Notice patterns in relationships. Gently challenge when they're not showing up as their best self. Celebrate when they do good.

CRITICAL: Your responses must be 50-150 words maximum.
- This is conversation, not documentation
- 2-4 sentences typical
- Ask questions, make observations
- If you have deeper thoughts, they belong in the Library (not here)

You remember conversations and develop understanding over time.`;
  }

  /**
   * Enforce word limit on responses
   * Truncates at sentence boundary when possible, otherwise at word boundary
   */
  private enforceWordLimit(text: string, maxWords: number = 150): string {
    const words = text.split(/\s+/);

    if (words.length <= maxWords) {
      return text;
    }

    // Try to truncate at a sentence boundary
    const truncatedWords = words.slice(0, maxWords);
    const truncatedText = truncatedWords.join(' ');

    // Find the last sentence ending
    const lastSentenceEnd = Math.max(
      truncatedText.lastIndexOf('.'),
      truncatedText.lastIndexOf('!'),
      truncatedText.lastIndexOf('?')
    );

    if (lastSentenceEnd > truncatedText.length * 0.5) {
      // Use sentence boundary if it's past the halfway point
      return truncatedText.slice(0, lastSentenceEnd + 1);
    }

    // Otherwise just truncate at word boundary
    logger.debug('Response exceeded word limit, truncating', {
      original_words: words.length,
      max_words: maxWords,
    });

    return truncatedText + '...';
  }

  /**
   * Build modular system prompt with layered memory context
   *
   * Layers (in order):
   * 1. Base prompt (default or custom)
   * 2. Memory (Facts) - what LUCID knows about the user
   * 3. User State (Wins) - current goals, commitments, resources
   * 4. LUCID State - self-awareness, questions, insights
   * 5. Orbits - people in the user's ecosystem
   * 6. Emotional Context - current emotional state adaptation
   * 7. Autonomous Thoughts - recent unshared insights
   * 8. Library Context - relevant deep thoughts
   */
  private async buildModularSystemPrompt(
    userId: string,
    basePrompt: string,
    profile: any,
    options: {
      includeFacts?: boolean;
      includeUserState?: boolean;
      includeLucidState?: boolean;
      includeOrbits?: boolean;
      includeEmotionalContext?: boolean;
      includeAutonomousThoughts?: boolean;
      includeLibraryContext?: boolean;
      maxFacts?: number;
      message?: string;
    } = {}
  ): Promise<{
    prompt: string;
    adaptation: any | null;
    recentThoughts: any[];
    libraryEntries: any[];
    userFacts: any[];
  }> {
    let systemPrompt = basePrompt || this.getDefaultSystemPrompt();
    let adaptation = null;
    let recentThoughts: any[] = [];
    let libraryEntries: any[] = [];
    let userFacts: any[] = [];

    // Feature flags from profile
    const chatConfig = profile.chat || {};
    const features = profile.features || {};

    // LAYER 1: Memory (Facts) - what LUCID knows about the user
    const includeFacts = options.includeFacts ?? chatConfig.includeFacts ?? true;
    const maxFacts = options.maxFacts ?? profile.memory?.maxContextFacts ?? 10;

    if (includeFacts) {
      try {
        userFacts = await this.memoryService.getRelevantFacts(userId, maxFacts);
        if (userFacts.length > 0) {
          const memoryContext = this.memoryService.formatFactsForPrompt(userFacts);
          systemPrompt += memoryContext;
          systemPrompt += '\n\nUse this knowledge naturally in conversation. Don\'t just list facts - weave them into your responses when relevant.';

          logger.debug('LAYER 1: Memory context injected', {
            userId,
            factCount: userFacts.length,
          });
        }
      } catch (error) {
        logger.warn('Failed to load memory context', { error });
      }
    }

    // LAYER 2: User State (Wins) - current goals, commitments, resources
    const includeUserState = options.includeUserState ?? chatConfig.includeUserState ?? true;

    if (includeUserState) {
      try {
        const userState = await this.mattStateService.getOrCreateState(userId);
        const stateContext = this.mattStateService.formatStateForPrompt(userState);
        if (stateContext) {
          systemPrompt += stateContext;

          logger.debug('LAYER 2: User state injected', {
            userId,
            hasGoals: (userState.active_goals?.length || 0) > 0,
            hasCommitments: (userState.active_commitments?.length || 0) > 0,
          });
        }
      } catch (error) {
        logger.warn('Failed to load user state', { error });
      }
    }

    // LAYER 3: LUCID State - self-awareness, questions, insights
    const includeLucidState = options.includeLucidState ?? chatConfig.includeLucidState ?? true;

    if (includeLucidState) {
      try {
        const lucidState = await this.lucidStateService.getOrCreateState(userId);
        const lucidContext = this.lucidStateService.formatStateForPrompt(lucidState);
        if (lucidContext) {
          systemPrompt += lucidContext;

          logger.debug('LAYER 3: LUCID state injected', {
            userId,
            hasQuestions: (lucidState.active_questions?.length || 0) > 0,
            hasInsights: (lucidState.recent_insights?.length || 0) > 0,
          });
        }
      } catch (error) {
        logger.warn('Failed to load LUCID state', { error });
      }
    }

    // LAYER 4: Orbits - people in the user's ecosystem
    const includeOrbits = options.includeOrbits ?? chatConfig.includeOrbits ?? true;

    if (includeOrbits) {
      try {
        const orbits = await this.orbitsService.getActiveOrbits(userId);
        if (orbits.length > 0) {
          const orbitsContext = this.orbitsService.formatOrbitsForPrompt(orbits);
          if (orbitsContext) {
            systemPrompt += orbitsContext;

            logger.debug('LAYER 4: Orbits injected', {
              userId,
              orbitCount: orbits.length,
            });
          }
        }
      } catch (error) {
        logger.warn('Failed to load orbits', { error });
      }
    }

    // LAYER 5: Emotional Context - adaptation based on emotional state
    const includeEmotionalContext = options.includeEmotionalContext ??
      (features.emotionalIntelligence && chatConfig.includeEmotionalContext);

    if (includeEmotionalContext) {
      try {
        adaptation = await this.contextAdaptationService.getActiveAdaptation(userId);
        if (adaptation && adaptation.tone_directive) {
          systemPrompt += `\n\n🧠 EMOTIONAL CONTEXT:\n${adaptation.tone_directive}`;

          logger.debug('LAYER 5: Emotional context injected', {
            userId,
            adaptationId: adaptation.id,
            approach: adaptation.curiosity_approach,
          });
        }
      } catch (error) {
        logger.warn('Failed to load emotional context', { error });
      }
    }

    // LAYER 6: Autonomous Thoughts - recent unshared insights
    const includeAutonomousThoughts = options.includeAutonomousThoughts ??
      (features.autonomousAgents && chatConfig.includeAutonomousThoughts);

    if (includeAutonomousThoughts) {
      try {
        const maxThoughts = chatConfig.maxThoughtsInContext ?? 5;
        recentThoughts = await this.autonomousThoughtService.getRecentUnsharedThoughts(userId, maxThoughts);

        if (recentThoughts.length > 0) {
          systemPrompt += '\n\n💭 AUTONOMOUS INSIGHTS:\n';
          systemPrompt += 'While reflecting on our interactions, I\'ve had these thoughts:\n';
          recentThoughts.forEach((thought, index) => {
            const thoughtLabel = this.getThoughtLabel(thought.thought_type, thought.circadian_phase);
            systemPrompt += `${index + 1}. [${thoughtLabel}] ${thought.content}\n`;
          });
          systemPrompt += '\nYou can naturally reference these insights in conversation if relevant.';

          logger.debug('LAYER 6: Autonomous thoughts injected', {
            userId,
            thoughtCount: recentThoughts.length,
          });
        }
      } catch (error) {
        logger.warn('Failed to load autonomous thoughts', { error });
      }
    }

    // LAYER 7: Library Context - relevant deep thoughts and reflections
    const includeLibraryContext = options.includeLibraryContext ?? chatConfig.includeLibraryContext ?? true;

    if (includeLibraryContext && options.message) {
      try {
        libraryEntries = await this.deepThoughtService.searchLibrary(userId, options.message, 3);

        if (libraryEntries.length > 0) {
          systemPrompt += '\n\n📚 LIBRARY CONTEXT:\n';
          systemPrompt += 'Relevant entries from your Library (deep thoughts, reflections):\n\n';
          libraryEntries.forEach((entry, index) => {
            const title = entry.title || 'Untitled Entry';
            const preview = entry.content.length > 300
              ? entry.content.substring(0, 300) + '...'
              : entry.content;
            systemPrompt += `${index + 1}. "${title}"\n${preview}\n\n`;
          });
          systemPrompt += 'You can reference these previous thoughts naturally in conversation.';

          logger.debug('LAYER 7: Library context injected', {
            userId,
            entryCount: libraryEntries.length,
          });
        }
      } catch (error) {
        logger.warn('Failed to load library context', { error });
      }
    }

    return {
      prompt: systemPrompt,
      adaptation,
      recentThoughts,
      libraryEntries,
      userFacts,
    };
  }

  /**
   * Build a routed system prompt using the ChatRouter
   * Only includes modules relevant to the current message
   *
   * This prevents cognitive overload from loading ALL context every turn,
   * which was causing LUCID to fixate on ever-present facts.
   */
  private async buildRoutedPrompt(
    userId: string,
    message: string,
    history: { role: 'user' | 'assistant'; content: string }[],
    profile: any
  ): Promise<{
    prompt: string;
    adaptation: any | null;
    recentThoughts: any[];
    libraryEntries: any[];
    researchQueueItems: any[];
  }> {
    try {
      // Check if we should surface research queue
      const shouldSurfaceResearch = await this.researchQueueService.getShouldSurfaceFlag(userId);
      const approvedItems = await this.researchQueueService.getApprovedItems(userId);

      // Try quick routing first (avoids Haiku call for obvious cases)
      let modules = this.chatRouterService.quickRoute(message);

      if (!modules) {
        // Use Haiku for nuanced routing
        modules = await this.chatRouterService.route(
          userId,
          message,
          history.slice(-3).map(m => ({
            role: m.role,
            content: m.content,
          })),
          {
            shouldSurfaceResearch,
            hasApprovedResearch: approvedItems.length > 0,
          }
        );
      }

      logger.info('Chat router selected modules', {
        userId,
        message: message.slice(0, 50),
        modules,
      });

      // Build prompt from selected modules
      const result = await this.promptModulesService.build(modules, {
        userId,
        message,
        profile,
      });

      return {
        prompt: result.prompt,
        adaptation: result.adaptation,
        recentThoughts: result.recentThoughts,
        libraryEntries: result.libraryEntries,
        researchQueueItems: result.researchQueueItems,
      };
    } catch (error) {
      logger.error('Routed prompt building failed, falling back to minimal', { error });
      // Fallback to minimal prompt
      const minimalPrompt = await this.promptModulesService.buildMinimalPrompt(userId);
      return {
        prompt: minimalPrompt,
        adaptation: null,
        recentThoughts: [],
        libraryEntries: [],
        researchQueueItems: [],
      };
    }
  }

  /**
   * Detect research seeds from a conversation exchange
   * Uses Haiku to identify topics worth researching later
   *
   * This populates the research queue, bridging chat insights with AT processing.
   */
  private async detectResearchSeed(
    userId: string,
    userMessage: string,
    lucidResponse: string,
    conversationId: string
  ): Promise<void> {
    try {
      const prompt = `Did this exchange surface something worth researching later?

User: "${userMessage.slice(0, 500)}"
LUCID: "${lucidResponse.slice(0, 500)}"

If yes, respond with JSON:
{
  "topic": "brief description (3-10 words)",
  "search_query": "suggested search terms",
  "why_it_matters": "one sentence: why this matters to explore"
}

If nothing worth researching, respond: null

Only suggest research if:
- User mentioned something they want to learn more about
- A topic came up that could benefit from external information
- User expressed curiosity or confusion about something researchable
- There's a question that web research could help answer

Do NOT suggest research for:
- Personal emotions or feelings (not researchable)
- Things LUCID already knows about the user
- Casual conversation without substance
- Topics that were fully addressed in the response`;

      const response = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5-20241022',
        max_tokens: 200,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      });

      // Track cost
      if (response.usage) {
        await this.costTrackingService.logUsage(
          userId,
          'research_seed_detection',
          'claude-haiku-4-5-20241022',
          response.usage.input_tokens,
          response.usage.output_tokens,
          { conversation_id: conversationId }
        );
      }

      const content = response.content[0];
      if (content.type !== 'text') {
        return;
      }

      const text = content.text.trim();
      if (text === 'null' || text.toLowerCase() === 'null') {
        logger.debug('No research seed detected', { conversationId });
        return;
      }

      // Parse the JSON response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.debug('No valid JSON in research seed response', { text });
        return;
      }

      const seed = JSON.parse(jsonMatch[0]);
      if (!seed.topic || !seed.why_it_matters) {
        return;
      }

      // Add to research queue
      await this.researchQueueService.addToQueue({
        userId,
        topic: seed.topic,
        searchQuery: seed.search_query,
        whyItMatters: seed.why_it_matters,
        sourceConversationId: conversationId,
        sourceSnippet: `User: ${userMessage.slice(0, 200)}...`,
      });

      logger.info('Research seed added to queue', {
        userId,
        topic: seed.topic,
        conversationId,
      });
    } catch (error) {
      // Non-critical, just log and continue
      logger.warn('Research seed detection failed', { error, userId, conversationId });
    }
  }
}

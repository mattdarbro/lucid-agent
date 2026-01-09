import { Pool } from 'pg';
import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { MessageService } from './message.service';
import { VectorService } from './vector.service';
import { ThoughtService } from './thought.service';
import { TopicService } from './topic.service';
import { ProfileService } from './profile.service';
import { CostTrackingService } from './cost-tracking.service';
import { PromptModulesService } from './prompt-modules.service';
import { ChatCompletionInput } from '../validation/chat.validation';

/**
 * Configuration for chat behavior
 */
interface ChatConfig {
  maxResponseWords?: number;
  defaultTemperature?: number;
  defaultModel?: string;
  maxTokens?: number;
  forceDeepThinking?: boolean;
  deepThinkingBias?: number;
}

/**
 * ChatService - Simplified chat completion handler
 *
 * After the refactor:
 * - No mode selection
 * - No Haiku routing
 * - No personality profiling
 * - No scheduled fake thoughts
 *
 * Just Lucid, present, with memory and tools.
 *
 * Architecture:
 * User Message
 *     ↓
 * [Injectables injected - user's 3 anchors]
 *     ↓
 * [Living Document available - Lucid's working notebook]
 *     ↓
 * [Core Identity - ~70 words, flourishing-oriented]
 *     ↓
 * [Session State - ephemeral emotional context]
 *     ↓
 * Claude Opus responds
 *     ↓
 * [Lucid may update Living Document]
 *     ↓
 * [Tools available: web search, Library tools, etc.]
 */
export class ChatService {
  private pool: Pool;
  private supabase: SupabaseClient;
  private anthropic: Anthropic;
  private messageService: MessageService;
  private deepThoughtService: ThoughtService;
  private topicService: TopicService;
  private profileService: ProfileService;
  private costTrackingService: CostTrackingService;
  private promptModulesService: PromptModulesService;

  // Default configuration - word limits unified at service layer
  private readonly DEFAULT_CONFIG: ChatConfig = {
    maxResponseWords: 150,
    defaultTemperature: 0.7,
    defaultModel: 'claude-opus-4-5-20251101',
    maxTokens: 500,
    forceDeepThinking: false,
    deepThinkingBias: 50,
  };

  constructor(pool: Pool, supabase: SupabaseClient, anthropicApiKey?: string) {
    this.pool = pool;
    this.supabase = supabase;
    this.anthropic = new Anthropic({
      apiKey: anthropicApiKey || process.env.ANTHROPIC_API_KEY,
    });

    const vectorService = new VectorService();
    this.messageService = new MessageService(pool, vectorService);
    this.deepThoughtService = new ThoughtService(pool, anthropicApiKey);
    this.topicService = new TopicService(pool, anthropicApiKey);
    this.profileService = new ProfileService(pool);
    this.costTrackingService = new CostTrackingService(pool);
    this.promptModulesService = new PromptModulesService(pool, anthropicApiKey);
  }

  /**
   * Generates a chat completion using Claude
   *
   * Simplified flow:
   * 1. Store user message
   * 2. Check if deep thinking is needed (Library entry + concise response)
   * 3. Build prompt from simplified modules
   * 4. Call Claude Opus
   * 5. Enforce word limits at service layer
   * 6. Store assistant response
   */
  async chat(input: ChatCompletionInput): Promise<{
    user_message: any;
    assistant_message: any;
    response: string;
    libraryEntry?: { id: string; title: string | null } | null;
    topicShift?: { tag: string; color: string } | null;
  }> {
    try {
      // Store user message
      const userMessage = await this.messageService.createMessage({
        conversation_id: input.conversation_id,
        user_id: input.user_id,
        role: 'user',
        content: input.message,
      });

      // Fetch recent conversation history
      const history = await this.messageService.getRecentMessages(
        input.conversation_id,
        20
      );

      // Format messages for Claude API
      const messages = history.map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      }));

      // Get user's profile configuration
      const profile = await this.profileService.getUserProfile(input.user_id);
      const chatConfig = this.mergeConfig(profile.chat);

      // Detect topic shifts for visual segmentation
      const topicShift = await this.detectTopicShift(
        input.user_id,
        input.conversation_id,
        input.message,
        messages,
        history
      );

      // Check if deep thinking is needed
      // Complex questions generate Library entries + concise chat responses
      const thoughtResult = await this.deepThoughtService.generateThoughtWithLibrary(
        input.user_id,
        input.conversation_id,
        input.message,
        messages,
        {
          forceDeepThinking: chatConfig.forceDeepThinking,
          deepThinkingBias: chatConfig.deepThinkingBias,
        }
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
        });

        return {
          user_message: userMessage,
          assistant_message: assistantMessage,
          response: thoughtResult.chatResponse,
          libraryEntry: thoughtResult.libraryEntry
            ? { id: thoughtResult.libraryEntry.id, title: thoughtResult.libraryEntry.title }
            : null,
          topicShift,
        };
      }

      // Simple conversation - build standard prompt
      const moduleResult = await this.promptModulesService.buildStandardPrompt(
        input.user_id,
        input.message
      );

      // Calculate temperature
      const temperature = input.temperature ?? chatConfig.defaultTemperature;

      logger.debug('Sending chat completion request', {
        conversation_id: input.conversation_id,
        message_count: messages.length,
        model: input.model || chatConfig.defaultModel,
        temperature,
      });

      // Call Claude API
      const modelUsed = input.model || chatConfig.defaultModel || this.DEFAULT_CONFIG.defaultModel!;
      const response = await this.anthropic.messages.create({
        model: modelUsed,
        max_tokens: input.max_tokens || chatConfig.maxTokens || this.DEFAULT_CONFIG.maxTokens!,
        temperature: temperature,
        system: moduleResult.prompt,
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

      // Enforce word limit at service layer (unified approach)
      const maxWords = chatConfig.maxResponseWords || this.DEFAULT_CONFIG.maxResponseWords!;
      const assistantResponse = this.enforceWordLimit(content.text, maxWords);

      // Store assistant message
      const assistantMessage = await this.messageService.createMessage({
        conversation_id: input.conversation_id,
        user_id: input.user_id,
        role: 'assistant',
        content: assistantResponse,
      });

      logger.info('Chat completion successful', {
        conversation_id: input.conversation_id,
        response_length: assistantResponse.length,
      });

      return {
        user_message: userMessage,
        assistant_message: assistantMessage,
        response: assistantResponse,
        topicShift,
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
   * Merge profile config with defaults
   */
  private mergeConfig(profileConfig?: Partial<ChatConfig>): ChatConfig {
    return {
      ...this.DEFAULT_CONFIG,
      ...profileConfig,
    };
  }

  /**
   * Detect topic shifts for visual segmentation
   */
  private async detectTopicShift(
    userId: string,
    conversationId: string,
    message: string,
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    history: any[]
  ): Promise<{ tag: string; color: string } | null> {
    try {
      // Calculate time since last message
      const lastMessage = history.length > 1 ? history[history.length - 2] : null;
      const timeSinceLastMessage = lastMessage?.created_at
        ? (Date.now() - new Date(lastMessage.created_at).getTime()) / 1000
        : 0;

      const shiftResult = await this.topicService.detectTopicShift(
        userId,
        conversationId,
        message,
        messages.slice(0, -1), // Exclude the message we just added
        timeSinceLastMessage
      );

      if (shiftResult.shifted && shiftResult.suggestedTag && shiftResult.color) {
        // Start a new topic segment in the database
        await this.topicService.startSegment(
          conversationId,
          shiftResult.suggestedTag,
          shiftResult.detectionMethod || 'semantic_shift'
        );

        logger.info('Topic shift detected', {
          conversation_id: conversationId,
          tag: shiftResult.suggestedTag,
          method: shiftResult.detectionMethod,
        });

        return { tag: shiftResult.suggestedTag, color: shiftResult.color };
      }
    } catch (topicError) {
      logger.warn('Topic detection failed, continuing without:', topicError);
    }

    return null;
  }

  /**
   * Enforce word limit on responses
   * Truncates at sentence boundary when possible
   *
   * This is the single source of truth for word limits (unified at service layer)
   */
  private enforceWordLimit(text: string, maxWords: number): string {
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
}

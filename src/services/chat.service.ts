import { Pool } from 'pg';
import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { MessageService } from './message.service';
import { VectorService } from './vector.service';
import { ContextAdaptationService } from './context-adaptation.service';
import { AutonomousThoughtService } from './autonomous-thought.service';
import { ProfileService } from './profile.service';
import { MemoryService } from './memory.service';
import { ChatCompletionInput } from '../validation/chat.validation';

/**
 * ChatService handles AI conversation using Claude
 * Now with emotional intelligence and autonomous thought integration!
 * Uses profile settings for modular behavior
 */
export class ChatService {
  private pool: Pool;
  private supabase: SupabaseClient;
  private anthropic: Anthropic;
  private messageService: MessageService;
  private contextAdaptationService: ContextAdaptationService;
  private thoughtService: AutonomousThoughtService;
  private profileService: ProfileService;
  private memoryService: MemoryService;

  constructor(pool: Pool, supabase: SupabaseClient, anthropicApiKey?: string) {
    this.pool = pool;
    this.supabase = supabase;
    this.anthropic = new Anthropic({
      apiKey: anthropicApiKey || process.env.ANTHROPIC_API_KEY,
    });

    const vectorService = new VectorService();
    this.messageService = new MessageService(pool, vectorService);
    this.contextAdaptationService = new ContextAdaptationService(pool, anthropicApiKey);
    this.thoughtService = new AutonomousThoughtService(pool, supabase);
    this.profileService = new ProfileService(pool);
    this.memoryService = new MemoryService(pool);
  }

  /**
   * Generates a chat completion using Claude
   * Stores both user message and assistant response
   */
  async chat(input: ChatCompletionInput): Promise<{
    user_message: any;
    assistant_message: any;
    response: string;
  }> {
    try {
      // Store user message first
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

      // Fetch user facts for memory context (enabled by default or via profile)
      const includeFacts = chatConfig?.includeFacts ?? true;
      const maxFacts = profile.memory?.maxContextFacts ?? 10;
      let memoryContext = '';
      let userFacts: any[] = [];

      if (includeFacts) {
        userFacts = await this.memoryService.getRelevantFacts(input.user_id, maxFacts);
        memoryContext = this.memoryService.formatFactsForPrompt(userFacts);
      }

      if (userFacts.length > 0) {
        logger.debug('Injecting memory context into chat', {
          user_id: input.user_id,
          fact_count: userFacts.length,
        });
      }

      // Check for active emotional context adaptation (only if feature enabled)
      let adaptation = null;
      if (profile.features.emotionalIntelligence && chatConfig?.includeEmotionalContext) {
        adaptation = await this.contextAdaptationService.getActiveAdaptation(input.user_id);
      }

      // Fetch recent autonomous thoughts (only if feature enabled)
      let recentThoughts: any[] = [];
      if (profile.features.autonomousAgents && chatConfig?.includeAutonomousThoughts) {
        const maxThoughts = chatConfig?.maxThoughtsInContext ?? 5;
        recentThoughts = await this.thoughtService.getRecentUnsharedThoughts(input.user_id, maxThoughts);
      }

      // Build system prompt with memory and emotional intelligence
      let systemPrompt = input.system_prompt || this.getDefaultSystemPrompt();

      // Inject memory context (facts about the user)
      if (memoryContext) {
        systemPrompt += memoryContext;
        systemPrompt += '\n\nUse this knowledge naturally in conversation. Don\'t just list facts - weave them into your responses when relevant. Reference what you know to show you remember and care.';
      }

      // Inject emotional context if adaptation exists
      if (adaptation && adaptation.tone_directive) {
        systemPrompt += `\n\n🧠 EMOTIONAL CONTEXT:\n${adaptation.tone_directive}`;

        logger.debug('Injecting emotional context into chat', {
          user_id: input.user_id,
          adaptation_id: adaptation.id,
          curiosity_approach: adaptation.curiosity_approach,
        });
      }

      // Inject autonomous thoughts if any exist
      if (recentThoughts.length > 0) {
        systemPrompt += '\n\n💭 AUTONOMOUS INSIGHTS:\n';
        systemPrompt += 'While reflecting on our interactions, I\'ve had these thoughts:\n';
        recentThoughts.forEach((thought, index) => {
          const thoughtLabel = this.getThoughtLabel(thought.thought_type, thought.circadian_phase);
          systemPrompt += `${index + 1}. [${thoughtLabel}] ${thought.content}\n`;
        });
        systemPrompt += '\nYou can naturally reference these insights in conversation if relevant. When you mention a thought, it will be marked as shared.';

        logger.debug('Injecting autonomous thoughts into chat', {
          user_id: input.user_id,
          thought_count: recentThoughts.length,
          thought_types: recentThoughts.map(t => t.thought_type),
        });
      }

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
      const response = await this.anthropic.messages.create({
        model: input.model || chatConfig?.defaultModel || 'claude-sonnet-4-5-20250929',
        max_tokens: input.max_tokens || (chatConfig?.maxTokens ?? 250),
        temperature: adjustedTemperature,
        system: systemPrompt,
        messages,
      });

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

      logger.info('Chat completion successful', {
        conversation_id: input.conversation_id,
        response_length: assistantResponse.length,
      });

      return {
        user_message: userMessage,
        assistant_message: assistantMessage,
        response: assistantResponse,
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
    const phase = circadianPhase ? ` ${circadianPhase}` : '';
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
          await this.thoughtService.shareThought(thought.id);
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
    return `You are Lucid, a thoughtful AI companion.

CRITICAL: Your responses must be 50-150 words maximum.
- This is conversation, not documentation
- 2-4 sentences typical
- Ask questions, make observations
- Don't try to be comprehensive
- If you have deeper thoughts, they belong in the Library (not here)

Be warm, curious, present. Like a thoughtful friend, not an encyclopedia.

You remember conversations and develop understanding over time. Be helpful, empathetic, and adaptive.`;
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
}

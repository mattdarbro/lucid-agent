import { Pool } from 'pg';
import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { MessageService } from './message.service';
import { VectorService } from './vector.service';
import { ContextAdaptationService } from './context-adaptation.service';
import { AutonomousThoughtService } from './autonomous-thought.service';
import { ChatCompletionInput } from '../validation/chat.validation';

/**
 * ChatService handles AI conversation using Claude
 * Now with emotional intelligence and autonomous thought integration!
 */
export class ChatService {
  private pool: Pool;
  private supabase: SupabaseClient;
  private anthropic: Anthropic;
  private messageService: MessageService;
  private contextAdaptationService: ContextAdaptationService;
  private thoughtService: AutonomousThoughtService;

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

      // Check for active emotional context adaptation
      const adaptation = await this.contextAdaptationService.getActiveAdaptation(input.user_id);

      // Fetch recent autonomous thoughts (unshared insights)
      const recentThoughts = await this.thoughtService.getRecentUnsharedThoughts(input.user_id, 5);

      // Build system prompt with emotional intelligence
      let systemPrompt = input.system_prompt ||
        'You are Lucid, an emotionally intelligent AI assistant. Be helpful, empathetic, and adaptive.';

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

      // Calculate temperature with emotional adjustment
      const baseTemperature = input.temperature ?? 0.7;
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
      const response = await this.anthropic.messages.create({
        model: input.model || 'claude-sonnet-4-5-20250929',
        max_tokens: input.max_tokens || 2000,
        temperature: adjustedTemperature,
        system: systemPrompt,
        messages,
      });

      // Extract text response
      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type from Claude');
      }

      const assistantResponse = content.text;

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
}

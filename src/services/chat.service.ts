import { Pool } from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { MessageService } from './message.service';
import { VectorService } from './vector.service';
import { ContextAdaptationService } from './context-adaptation.service';
import { ChatCompletionInput } from '../validation/chat.validation';

/**
 * ChatService handles AI conversation using Claude
 * Now with emotional intelligence integration!
 */
export class ChatService {
  private pool: Pool;
  private anthropic: Anthropic;
  private messageService: MessageService;
  private contextAdaptationService: ContextAdaptationService;

  constructor(pool: Pool, anthropicApiKey?: string) {
    this.pool = pool;
    this.anthropic = new Anthropic({
      apiKey: anthropicApiKey || process.env.ANTHROPIC_API_KEY,
    });

    const vectorService = new VectorService();
    this.messageService = new MessageService(pool, vectorService);
    this.contextAdaptationService = new ContextAdaptationService(pool, anthropicApiKey);
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
}

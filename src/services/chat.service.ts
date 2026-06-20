import { Pool } from 'pg';
import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { MessageService } from './message.service';
import { VectorService } from './vector.service';
import { ProfileService } from './profile.service';
import { CostTrackingService } from './cost-tracking.service';
import { PromptModulesService } from './prompt-modules.service';
import { LucidToolsService, LUCID_TOOLS } from './lucid-tools.service';
import { WebSearchService } from './web-search.service';
import { RecursiveContextSearchService, RecursiveSearchConfig } from './recursive-context-search.service';
import { ChatCompletionInput } from '../validation/chat.validation';
import { withRetry, wrapAnthropicError } from '../utils/anthropic-errors';
import { stripLoneSurrogates } from '../utils/sanitize-unicode';
import { config } from '../config';

/**
 * Configuration for chat behavior
 */
interface ChatConfig {
  defaultTemperature?: number;
  defaultModel?: string;
  maxTokens?: number;
  /** Enable recursive context search for "infinite context" */
  enableRecursiveSearch?: boolean;
  /** Configuration for recursive context search */
  recursiveSearchConfig?: RecursiveSearchConfig;
}

/**
 * ChatService - Fast, present chat
 *
 * Architecture:
 * User Message → Build Prompt → Claude Responds → Done
 *
 * No per-message deep thinking triage.
 * No topic detection.
 * Deep thinking happens async via background jobs.
 * The Room is for presence, not processing.
 */
export class ChatService {
  private pool: Pool;
  private supabase: SupabaseClient;
  private anthropic: Anthropic;
  private messageService: MessageService;
  private profileService: ProfileService;
  private costTrackingService: CostTrackingService;
  private promptModulesService: PromptModulesService;
  private lucidToolsService: LucidToolsService;
  private recursiveContextService: RecursiveContextSearchService;

  // Default configuration. defaultModel is sourced from config.anthropic.model
  // (the ANTHROPIC_MODEL env) so this fallback can't silently drift from the
  // app-wide model default.
  private readonly DEFAULT_CONFIG: ChatConfig = {
    defaultTemperature: 0.7,
    defaultModel: config.anthropic.model,
    maxTokens: 500,
    enableRecursiveSearch: false,
    recursiveSearchConfig: {
      maxDepth: 3,
      maxChunks: 20,
      minSimilarity: 0.4,
      targetTokenBudget: 4000,
    },
  };

  constructor(pool: Pool, supabase: SupabaseClient, anthropicApiKey?: string) {
    this.pool = pool;
    this.supabase = supabase;

    // Resolve the Anthropic key ONCE here so every sub-service shares the same
    // value. Passing the raw (possibly undefined or empty) param down created
    // two resolution paths: an empty string would be forwarded as-is instead of
    // falling back to the env var.
    const resolvedApiKey = anthropicApiKey || process.env.ANTHROPIC_API_KEY;

    this.anthropic = new Anthropic({
      apiKey: resolvedApiKey,
    });

    const vectorService = new VectorService();
    this.messageService = new MessageService(pool, vectorService);
    this.profileService = new ProfileService(pool);
    this.costTrackingService = new CostTrackingService(pool);
    this.promptModulesService = new PromptModulesService(pool, resolvedApiKey);

    // Initialize web search service for Room searches
    const webSearchService = new WebSearchService();
    this.lucidToolsService = new LucidToolsService(pool, webSearchService);

    this.recursiveContextService = new RecursiveContextSearchService(pool, resolvedApiKey);
  }

  /**
   * Generates a chat completion using Claude
   *
   * Flow:
   * 1. Store user message
   * 2. Build prompt from modules
   * 3. Call Claude Opus with tools
   * 4. Enforce word limits
   * 5. Store assistant response
   *
   * Deep thinking happens async via background jobs, not here.
   */
  async chat(input: ChatCompletionInput): Promise<{
    user_message: any;
    assistant_message: any;
    response: string;
  }> {
    // Tracked across the try/catch so a failed turn can roll back the user
    // message it already persisted (see catch block).
    let userMessage: any = null;
    let assistantStored = false;
    try {
      // Store user message
      userMessage = await this.messageService.createMessage({
        conversation_id: input.conversation_id,
        user_id: input.user_id,
        role: 'user',
        content: input.message,
      });

      // Fetch conversation history and profile concurrently — they're
      // independent queries and both sit on the latency-critical path.
      const [history, profile] = await Promise.all([
        this.messageService.getRecentMessages(input.conversation_id, 20),
        this.profileService.getUserProfile(input.user_id),
      ]);

      // Format messages for Claude API.
      // Strip any lone UTF-16 surrogates from stored content: a truncated emoji
      // (or one mangled by the client) becomes invalid JSON that Anthropic
      // rejects with a non-retryable 400 ("no low surrogate in string").
      // Sanitizing on read also heals histories already poisoned by such a
      // message, which would otherwise fail on every subsequent turn.
      const messages = history.map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: stripLoneSurrogates(msg.content),
      }));

      const chatConfig = this.mergeConfig(profile.chat);

      // Build prompt from modules
      const moduleResult = await this.promptModulesService.buildStandardPrompt(
        input.user_id,
        input.message,
        messages.length
      );

      // Determine if recursive context search should be used
      // Priority: explicit input > auto-detection
      let useRecursiveSearch = false;
      let recursiveSearchReason = '';

      if (input.enable_recursive_search !== undefined) {
        // Explicit override from API request
        useRecursiveSearch = input.enable_recursive_search;
        recursiveSearchReason = 'explicit API request';
      } else {
        // Auto-detect based on message content and conversation state
        const conversationLength = messages.length;

        // daysSinceFirstMessage is omitted: the API message objects carry no
        // timestamps. Could be added later by fetching conversation metadata.
        const detection = this.recursiveContextService.shouldUseRecursiveSearch(
          input.message,
          conversationLength,
          undefined
        );

        useRecursiveSearch = detection.shouldSearch;
        recursiveSearchReason = detection.reason;

        if (useRecursiveSearch) {
          logger.info('Auto-detected need for recursive search', {
            conversation_id: input.conversation_id,
            reason: recursiveSearchReason,
            conversationLength,
          });
        }
      }

      // Gather additional context if recursive search is triggered
      let recursiveContext = '';
      if (useRecursiveSearch) {
        try {
          // Merge input config with profile config
          const searchConfig: RecursiveSearchConfig = {
            ...chatConfig.recursiveSearchConfig,
            ...(input.recursive_search_config ? {
              maxDepth: input.recursive_search_config.max_depth,
              maxChunks: input.recursive_search_config.max_chunks,
              minSimilarity: input.recursive_search_config.min_similarity,
              searchScope: input.recursive_search_config.search_scope,
              targetTokenBudget: input.recursive_search_config.target_token_budget,
            } : {}),
          };

          const searchResult = await this.recursiveContextService.searchRecursively(
            input.message,
            input.user_id,
            input.conversation_id,
            searchConfig
          );

          if (searchResult.context.length > 0) {
            recursiveContext = this.recursiveContextService.formatContextForPrompt(searchResult);
            logger.info('Recursive context search completed', {
              conversation_id: input.conversation_id,
              trigger_reason: recursiveSearchReason,
              iterations: searchResult.iterations,
              chunksFound: searchResult.context.length,
              totalTokens: searchResult.totalTokens,
              sufficient: searchResult.sufficient,
            });
          }
        } catch (searchError: any) {
          logger.warn('Recursive context search failed, continuing without', {
            error: searchError.message,
          });
        }
      }

      // Combine base prompt with recursive context. Sanitize lone surrogates:
      // the prompt is assembled from DB/library content that is truncated by
      // character count, which can split an emoji and leave invalid JSON.
      const finalPrompt = stripLoneSurrogates(
        recursiveContext
          ? `${moduleResult.prompt}\n${recursiveContext}`
          : moduleResult.prompt
      );

      // Calculate temperature
      const temperature = input.temperature ?? chatConfig.defaultTemperature;

      logger.debug('Sending chat completion request', {
        conversation_id: input.conversation_id,
        message_count: messages.length,
        model: input.model || chatConfig.defaultModel,
        temperature,
      });

      // Call Claude API with tools and retry for transient errors
      const modelUsed = input.model || chatConfig.defaultModel || this.DEFAULT_CONFIG.defaultModel!;
      const maxTokens = input.max_tokens || chatConfig.maxTokens || this.DEFAULT_CONFIG.maxTokens!;

      // Prepare tools with user_id injected (so Claude doesn't need to guess it)
      const toolsWithContext = LUCID_TOOLS.map((tool) => ({
        ...tool,
        description: `${tool.description} The user_id is: ${input.user_id}`,
      }));

      // Conversation messages for the API (we'll add tool results as we go)
      let apiMessages: Anthropic.MessageParam[] = [...messages];
      let assistantResponse = '';
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let totalCacheCreationTokens = 0;
      let totalCacheReadTokens = 0;

      // Tool use loop - keep calling until we get a text response
      const MAX_TOOL_ITERATIONS = 5;
      for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
        // Build tools array with prompt caching on the last tool.
        // Tool definitions are identical every call — caching them saves ~2000+ tokens
        // at 90% discount on subsequent turns within the same conversation.
        const cachedTools = toolsWithContext.map((tool: any, i: number) =>
          i === toolsWithContext.length - 1
            ? { ...tool, cache_control: { type: 'ephemeral' as const } }
            : tool
        );

        const response = await withRetry(
          () =>
            this.anthropic.messages.create({
              model: modelUsed,
              max_tokens: maxTokens,
              // Opus 4.7+ reasoning models reject a custom temperature. Match the
              // single-digit suffixes (4-7, 4-8, 4-9) AND any multi-digit future
              // version (4-10+); the old /4-[78]/ silently broke for 2-digit names.
              ...(/^claude-opus-4-(?:[7-9]|\d{2,})/.test(modelUsed) ? {} : { temperature }),
              // Pass system prompt as cached content block. Within a multi-turn
              // conversation the prompt is largely stable, so subsequent turns
              // hit cache at ~10% of normal input cost.
              system: [
                {
                  type: 'text' as const,
                  text: finalPrompt,
                  cache_control: { type: 'ephemeral' as const },
                },
              ],
              messages: apiMessages,
              tools: cachedTools,
            }),
          { maxRetries: 2, initialDelayMs: 1000 }
        ) as any;

        // Track token usage. input_tokens excludes cached tokens — cache
        // writes and reads are reported (and billed) separately.
        if (response.usage) {
          totalInputTokens += response.usage.input_tokens;
          totalOutputTokens += response.usage.output_tokens;
          totalCacheCreationTokens += response.usage.cache_creation_input_tokens || 0;
          totalCacheReadTokens += response.usage.cache_read_input_tokens || 0;
        }

        // Check if we got a final text response (stop_reason is 'end_turn' or 'max_tokens')
        if (response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens') {
          // Extract text from the response
          const textContent = response.content.find((c: any) => c.type === 'text');
          if (textContent && textContent.type === 'text') {
            assistantResponse = textContent.text;
          }

          if (response.stop_reason === 'max_tokens') {
            logger.warn('Response hit max_tokens limit — may be truncated', {
              conversation_id: input.conversation_id,
              max_tokens: maxTokens,
              response_length: assistantResponse.length,
            });
          }
          break;
        }

        // Check for tool use
        if (response.stop_reason === 'tool_use') {
          const toolUseBlocks = response.content.filter((c: any) => c.type === 'tool_use');

          if (toolUseBlocks.length === 0) {
            // No tools to execute, extract any text
            const textContent = response.content.find((c: any) => c.type === 'text');
            if (textContent && textContent.type === 'text') {
              assistantResponse = textContent.text;
            }
            break;
          }

          // Add assistant's response (with tool calls) to messages
          apiMessages.push({
            role: 'assistant',
            content: response.content,
          });

          // Execute all requested tools concurrently — they're independent
          // (DB lookups, web searches) and each await adds user-visible latency.
          const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
            toolUseBlocks
              .filter((toolUse: any) => toolUse.type === 'tool_use')
              .map(async (toolUse: any) => {
                logger.info('Executing tool', {
                  tool: toolUse.name,
                  input: toolUse.input,
                  iteration,
                });

                const result = await this.lucidToolsService.executeTool(
                  toolUse.name,
                  toolUse.input as Record<string, any>
                );

                return {
                  type: 'tool_result' as const,
                  tool_use_id: toolUse.id,
                  // Tool output (web search, DB content) can also carry a lone
                  // surrogate; strip it so the next API call stays valid JSON.
                  content: stripLoneSurrogates(result),
                };
              })
          );

          // Add tool results to messages
          apiMessages.push({
            role: 'user',
            content: toolResults,
          });

          logger.debug('Tool execution complete, continuing conversation', {
            toolsExecuted: toolResults.length,
            iteration,
          });
        } else {
          // Unknown stop reason, extract any text and break
          const textContent = response.content.find((c: any) => c.type === 'text');
          if (textContent && textContent.type === 'text') {
            assistantResponse = textContent.text;
          }
          break;
        }
      }

      // Fallback: if the tool loop ran all MAX_TOOL_ITERATIONS without ever
      // producing text (Claude kept requesting tools), assistantResponse is still
      // empty. Don't store/return an empty turn — give a graceful reply instead.
      if (!assistantResponse.trim()) {
        logger.warn('Chat produced no text after tool loop — returning fallback', {
          conversation_id: input.conversation_id,
          maxIterations: MAX_TOOL_ITERATIONS,
        });
        assistantResponse =
          "I got a little tangled up working through that one — could you say it again?";
      }

      // Log total API usage for cost tracking. Deliberately not awaited —
      // logUsage handles its own errors and the reply shouldn't wait on it.
      if (totalInputTokens > 0 || totalOutputTokens > 0) {
        void this.costTrackingService.logUsage(
          input.user_id,
          'chat',
          modelUsed,
          totalInputTokens,
          totalOutputTokens,
          { conversation_id: input.conversation_id },
          totalCacheCreationTokens,
          totalCacheReadTokens
        );
      }

      // Word cap intentionally removed: Lucid's responses should find their own
      // length and never be truncated mid-thought. Generation is still bounded by
      // maxTokens; brevity is now guidance in the prompt, not a hard server chop.

      // Store assistant message
      const assistantMessage = await this.messageService.createMessage({
        conversation_id: input.conversation_id,
        user_id: input.user_id,
        role: 'assistant',
        content: assistantResponse,
      });
      assistantStored = true;

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
      // Roll back the orphaned user turn: if we persisted the user message but
      // never stored an assistant reply, delete it so the conversation isn't left
      // with a dangling unanswered user turn that gets re-sent on every retry.
      if (userMessage && !assistantStored) {
        try {
          await this.messageService.deleteMessage(userMessage.id);
          logger.info('Rolled back orphaned user message after failed chat turn', {
            message_id: userMessage.id,
            conversation_id: input.conversation_id,
          });
        } catch (cleanupError: any) {
          logger.warn('Failed to roll back orphaned user message', {
            message_id: userMessage.id,
            error: cleanupError.message,
          });
        }
      }

      logger.error('Error in chat completion:', {
        message: error.message,
        status: error.status,
        name: error.name,
      });
      // Re-throw AnthropicApiError as-is to preserve status code
      if (error.name === 'AnthropicApiError') {
        throw error;
      }
      // Wrap other Anthropic errors to preserve status
      if (error.status) {
        throw wrapAnthropicError(error);
      }
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
}

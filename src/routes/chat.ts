import { Router, Request, Response } from 'express';
import { pool, supabase } from '../db';
import { logger } from '../logger';
import { ChatService } from '../services/chat.service';
import { chatCompletionSchema, ChatCompletionInput } from '../validation/chat.validation';
import { z } from 'zod';

const router = Router();
const chatService = new ChatService(pool, supabase);

/**
 * Validation middleware helper
 */
function validateBody(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: Function) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.errors.map((err) => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        });
      }
      next(error);
    }
  };
}

/**
 * POST /v1/chat
 *
 * Send a message and get an AI response
 *
 * Request body:
 * - conversation_id: string (required) - UUID of the conversation
 * - user_id: string (required) - UUID of the user
 * - message: string (required) - User's message
 * - model: string (optional) - Claude model to use
 * - max_tokens: number (optional) - Maximum tokens in response
 * - temperature: number (optional) - Response randomness (0-1)
 * - system_prompt: string (optional) - Custom system prompt
 */
router.post('/', validateBody(chatCompletionSchema), async (req: Request, res: Response) => {
  try {
    const input: ChatCompletionInput = req.body;

    const result = await chatService.chat(input);

    res.status(200).json({
      user_message: result.user_message,
      assistant_message: result.assistant_message,
      response: result.response,
      conversation_id: input.conversation_id,
    });
  } catch (error: any) {
    logger.error('Error in POST /v1/chat:', error);

    if (error.message.includes('Claude') || error.message.includes('Anthropic')) {
      return res.status(503).json({
        error: 'AI service temporarily unavailable',
        details: error.message,
      });
    }

    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: error.message,
      });
    }

    res.status(500).json({
      error: 'Chat completion failed',
      details: error.message,
    });
  }
});

export default router;

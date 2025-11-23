import { Router, Request, Response } from 'express';
import { logger } from '../logger';
import { chatService } from '../services';
import { chatCompletionSchema, ChatCompletionInput } from '../validation/chat.validation';
import { z } from 'zod';

const router = Router();

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

    logger.info('Chat request received:', {
      user_id: input.user_id,
      conversation_id: input.conversation_id,
      message_length: input.message.length,
    });

    const result = await chatService.chat(input);

    logger.info('Chat response generated successfully');

    res.status(200).json({
      user_message: result.user_message,
      assistant_message: result.assistant_message,
      response: result.response,
      conversation_id: input.conversation_id,
    });
  } catch (error: any) {
    logger.error('Error in POST /v1/chat:', {
      message: error.message,
      stack: error.stack,
      user_id: req.body.user_id,
      conversation_id: req.body.conversation_id,
    });

    // Handle specific error types
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

    if (error.message.includes('timeout') || error.code === 'ETIMEDOUT') {
      return res.status(504).json({
        error: 'Request timeout',
        details: 'The request took too long to process. Please try again.',
      });
    }

    // Generic error response
    res.status(500).json({
      error: 'Chat completion failed',
      details: error.message,
    });
  }
});

export default router;

import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { logger } from '../logger';
import { MessageService } from '../services/message.service';
import { VectorService } from '../services/vector.service';
import {
  createMessageSchema,
  messageIdSchema,
  conversationIdParamSchema,
  messageListQuerySchema,
  semanticSearchSchema,
} from '../validation/message.validation';
import { z } from 'zod';

const router = Router();
const vectorService = new VectorService();
const messageService = new MessageService(pool, vectorService);

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
 * POST /v1/messages
 *
 * Creates a new message with automatic embedding generation.
 *
 * Request body:
 * - conversation_id: string (required) - UUID of the conversation
 * - user_id: string (required) - UUID of the user
 * - role: 'user' | 'assistant' | 'system' (required)
 * - content: string (required) - Message content
 * - model: string (optional) - Model that generated the message (for assistant messages)
 * - skip_embedding: boolean (optional) - Skip embedding generation (default: false)
 */
router.post(
  '/',
  validateBody(createMessageSchema),
  async (req: Request, res: Response) => {
    try {
      const message = await messageService.createMessage(req.body);
      res.status(201).json(message);
    } catch (error: any) {
      logger.error('Error in POST /v1/messages:', error);

      if (error.message.includes('Conversation not found')) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      if (error.message.includes('User not found')) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.status(500).json({ error: 'Failed to create message' });
    }
  }
);

/**
 * GET /v1/messages/:id
 *
 * Retrieves a specific message by ID
 *
 * Path parameters:
 * - id: string - UUID of the message
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = messageIdSchema.parse(req.params);

    const message = await messageService.findById(id);

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    res.json(message);
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

    logger.error('Error in GET /v1/messages/:id:', error);
    res.status(500).json({ error: 'Failed to fetch message' });
  }
});

/**
 * GET /v1/conversations/:conversation_id/messages
 *
 * Lists all messages for a specific conversation
 *
 * Path parameters:
 * - conversation_id: string - UUID of the conversation
 *
 * Query parameters:
 * - limit: number (optional) - Maximum messages to return (default: 50, max: 500)
 * - offset: number (optional) - Number of messages to skip (default: 0)
 * - role: 'user' | 'assistant' | 'system' (optional) - Filter by role
 */
router.get(
  '/conversations/:conversation_id/messages',
  async (req: Request, res: Response) => {
    try {
      const { conversation_id } = conversationIdParamSchema.parse(req.params);
      const queryParams = messageListQuerySchema.parse(req.query);

      const messages = await messageService.listByConversation(
        conversation_id,
        queryParams.limit,
        queryParams.offset,
        queryParams.role
      );

      res.json({
        messages,
        count: messages.length,
        limit: queryParams.limit,
        offset: queryParams.offset,
      });
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

      logger.error(
        'Error in GET /v1/conversations/:conversation_id/messages:',
        error
      );
      res.status(500).json({ error: 'Failed to fetch messages' });
    }
  }
);

/**
 * POST /v1/messages/search
 *
 * Performs semantic search across messages using vector similarity.
 *
 * Request body:
 * - query: string (required) - Search query
 * - conversation_id: string (optional) - Limit search to specific conversation
 * - user_id: string (optional) - Limit search to specific user
 * - limit: number (optional) - Maximum results (default: 10, max: 100)
 * - min_similarity: number (optional) - Minimum similarity threshold 0-1 (default: 0.7)
 */
router.post(
  '/search',
  validateBody(semanticSearchSchema),
  async (req: Request, res: Response) => {
    try {
      const { query, conversation_id, user_id, limit, min_similarity } =
        req.body;

      const results = await messageService.semanticSearch(query, {
        conversation_id,
        user_id,
        limit,
        min_similarity,
      });

      res.json({
        results,
        count: results.length,
        query,
      });
    } catch (error: any) {
      logger.error('Error in POST /v1/messages/search:', error);

      if (
        error.message.includes('OpenAI') ||
        error.message.includes('embedding')
      ) {
        return res.status(503).json({
          error: 'Semantic search temporarily unavailable',
          details: error.message,
        });
      }

      res.status(500).json({ error: 'Failed to perform semantic search' });
    }
  }
);

/**
 * DELETE /v1/messages/:id
 *
 * Deletes a message
 *
 * Path parameters:
 * - id: string - UUID of the message
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = messageIdSchema.parse(req.params);

    const deleted = await messageService.deleteMessage(id);

    if (!deleted) {
      return res.status(404).json({ error: 'Message not found' });
    }

    res.status(204).send();
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

    logger.error('Error in DELETE /v1/messages/:id:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

export default router;

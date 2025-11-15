import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { logger } from '../logger';
import { ConversationService } from '../services/conversation.service';
import { MessageService } from '../services/message.service';
import { SummaryService } from '../services/summary.service';
import { VectorService } from '../services/vector.service';
import {
  createConversationSchema,
  updateConversationSchema,
  conversationIdSchema,
  userIdParamSchema,
} from '../validation/conversation.validation';
import { messageListQuerySchema } from '../validation/message.validation';
import { summaryListQuerySchema } from '../validation/summary.validation';
import { z } from 'zod';

const router = Router();
const conversationService = new ConversationService(pool);
const vectorService = new VectorService();
const messageService = new MessageService(pool, vectorService);
const summaryService = new SummaryService(pool, vectorService);

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
 * POST /v1/conversations
 *
 * Creates a new conversation for a user.
 *
 * Request body:
 * - user_id: string (required) - UUID of the user
 * - title: string (optional) - Conversation title
 * - user_timezone: string (optional) - User's timezone (defaults to user's timezone)
 */
router.post(
  '/',
  validateBody(createConversationSchema),
  async (req: Request, res: Response) => {
    try {
      const conversation = await conversationService.createConversation(req.body);
      res.status(201).json(conversation);
    } catch (error: any) {
      logger.error('Error in POST /v1/conversations:', error);

      if (error.message.includes('User not found')) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.status(500).json({ error: 'Failed to create conversation' });
    }
  }
);

/**
 * GET /v1/conversations/:id
 *
 * Retrieves a specific conversation by ID
 *
 * Path parameters:
 * - id: string - UUID of the conversation
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = conversationIdSchema.parse(req.params);

    const conversation = await conversationService.findById(id);

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    res.json(conversation);
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

    logger.error('Error in GET /v1/conversations/:id:', error);
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
});

/**
 * GET /v1/conversations/user/:user_id
 *
 * Lists all conversations for a specific user
 *
 * Path parameters:
 * - user_id: string - UUID of the user
 *
 * Query parameters:
 * - limit: number (optional) - Maximum conversations to return (default: 50)
 * - offset: number (optional) - Number of conversations to skip (default: 0)
 */
router.get('/user/:user_id', async (req: Request, res: Response) => {
  try {
    const { user_id } = userIdParamSchema.parse(req.params);

    // Parse query parameters
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

    const conversations = await conversationService.listByUserId(
      user_id,
      limit,
      offset
    );

    res.json({
      conversations,
      count: conversations.length,
      limit,
      offset,
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

    logger.error('Error in GET /v1/conversations/user/:user_id:', error);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

/**
 * PATCH /v1/conversations/:id
 *
 * Updates a conversation
 *
 * Path parameters:
 * - id: string - UUID of the conversation
 *
 * Request body:
 * - title: string (optional) - New title
 * - user_timezone: string (optional) - New timezone
 */
router.patch(
  '/:id',
  validateBody(updateConversationSchema),
  async (req: Request, res: Response) => {
    try {
      const { id } = conversationIdSchema.parse(req.params);

      const conversation = await conversationService.updateConversation(id, req.body);

      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      res.json(conversation);
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

      logger.error('Error in PATCH /v1/conversations/:id:', error);
      res.status(500).json({ error: 'Failed to update conversation' });
    }
  }
);

/**
 * DELETE /v1/conversations/:id
 *
 * Deletes a conversation and all associated messages
 *
 * Path parameters:
 * - id: string - UUID of the conversation
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = conversationIdSchema.parse(req.params);

    const deleted = await conversationService.deleteConversation(id);

    if (!deleted) {
      return res.status(404).json({ error: 'Conversation not found' });
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

    logger.error('Error in DELETE /v1/conversations/:id:', error);
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
});

/**
 * GET /v1/conversations/:id/messages
 *
 * Lists all messages for a specific conversation (RESTful route)
 * This is an alias for the /v1/messages/conversations/:id/messages endpoint
 *
 * Path parameters:
 * - id: string - UUID of the conversation
 *
 * Query parameters:
 * - limit: number (optional) - Maximum messages to return (default: 50, max: 500)
 * - offset: number (optional) - Number of messages to skip (default: 0)
 * - role: 'user' | 'assistant' | 'system' (optional) - Filter by role
 */
router.get('/:id/messages', async (req: Request, res: Response) => {
  try {
    const { id } = conversationIdSchema.parse(req.params);
    const queryParams = messageListQuerySchema.parse(req.query);

    const messages = await messageService.listByConversation(
      id,
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

    logger.error('Error in GET /v1/conversations/:id/messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

/**
 * GET /v1/conversations/:id/summaries
 *
 * Lists all summaries for a specific conversation (RESTful route)
 * This is an alias for the /v1/conversations/:conversation_id/summaries endpoint
 *
 * Path parameters:
 * - id: string - UUID of the conversation
 *
 * Query parameters:
 * - limit: number (optional) - Maximum summaries to return (default: 50, max: 500)
 * - offset: number (optional) - Number of summaries to skip (default: 0)
 */
router.get('/:id/summaries', async (req: Request, res: Response) => {
  try {
    const { id } = conversationIdSchema.parse(req.params);
    const queryParams = summaryListQuerySchema.parse(req.query);

    const summaries = await summaryService.listByConversation(id, {
      limit: queryParams.limit,
      offset: queryParams.offset,
    });

    res.json({
      summaries,
      count: summaries.length,
      conversation_id: id,
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

    logger.error('Error in GET /v1/conversations/:id/summaries:', error);
    res.status(500).json({ error: 'Failed to fetch summaries' });
  }
});

export default router;

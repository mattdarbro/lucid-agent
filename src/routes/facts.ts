import { Router, Request, Response } from 'express';
import { logger } from '../logger';
import { factService, messageService } from '../services';
import {
  createFactSchema,
  updateFactSchema,
  factIdSchema,
  userIdParamSchema,
  factListQuerySchema,
  factSearchSchema,
  extractFactsSchema,
} from '../validation/fact.validation';
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
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.errors.map((err: any) => ({
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
 * POST /v1/facts
 *
 * Creates a new fact manually
 *
 * Request body:
 * - user_id: string (required) - UUID of the user
 * - content: string (required) - Fact content
 * - category: string (optional) - Fact category
 * - confidence: number (optional) - Confidence score 0-1
 * - is_active: boolean (optional) - Whether fact is active
 * - skip_embedding: boolean (optional) - Skip embedding generation
 */
router.post(
  '/',
  validateBody(createFactSchema),
  async (req: Request, res: Response) => {
    try {
      const fact = await factService.createFact(req.body);
      res.status(201).json(fact);
    } catch (error: any) {
      logger.error('Error in POST /v1/facts:', {
        message: error.message,
        code: error.code,
      });

      if (error.message.includes('User not found')) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.status(500).json({
        error: 'Failed to create fact',
        details: error.message,
      });
    }
  }
);

/**
 * POST /v1/facts/extract
 *
 * Extracts facts from messages using LLM
 *
 * Request body:
 * - user_id: string (required) - UUID of the user
 * - conversation_id: string (optional) - Process messages from specific conversation
 * - message_ids: string[] (optional) - Process specific messages
 * - limit: number (optional) - Max messages to process (default: 20)
 */
router.post(
  '/extract',
  validateBody(extractFactsSchema),
  async (req: Request, res: Response) => {
    try {
      const { user_id, conversation_id, message_ids, limit } = req.body;

      // Fetch messages
      let messages: string[] = [];

      if (message_ids && message_ids.length > 0) {
        // Fetch specific messages by ID
        for (const msgId of message_ids) {
          const msg = await messageService.findById(msgId);
          if (msg && msg.user_id === user_id) {
            messages.push(msg.content);
          }
        }
      } else if (conversation_id) {
        // Fetch recent messages from conversation
        const msgs = await messageService.getRecentMessages(
          conversation_id,
          limit || 20
        );

        // Include ALL messages, not just user messages
        // This allows extracting facts mentioned by both user and assistant
        messages = msgs.map((m) => {
          const prefix = m.role === 'user' ? 'User: ' : 'Assistant: ';
          return prefix + m.content;
        });

        logger.info(`Fetched ${msgs.length} messages (${messages.length} total) for fact extraction`);
      } else {
        // This would require a new method to get all user messages
        return res.status(400).json({
          error: 'Must provide either conversation_id or message_ids',
        });
      }

      if (messages.length === 0) {
        return res.json({
          extracted: [],
          created: [],
          count: 0,
          message: 'No messages found to process',
        });
      }

      // Extract facts using LLM
      const extractedFacts = await factService.extractFactsFromMessages(
        messages,
        user_id
      );

      // Create the extracted facts in database
      const createdFacts = [];
      for (const extracted of extractedFacts) {
        try {
          const fact = await factService.createFact({
            user_id,
            content: extracted.content,
            category: extracted.category,
            confidence: extracted.confidence,
          });
          createdFacts.push(fact);
        } catch (error: any) {
          logger.warn(`Failed to create extracted fact: ${error.message}`);
        }
      }

      res.status(201).json({
        extracted: extractedFacts,
        created: createdFacts,
        count: createdFacts.length,
        message: `Extracted ${extractedFacts.length} facts, created ${createdFacts.length} successfully`,
        debug: {
          messages_analyzed: messages.length,
          sample_messages: messages.slice(0, 3).map(m => m.substring(0, 100) + '...')
        }
      });
    } catch (error: any) {
      logger.error('Error in POST /v1/facts/extract:', {
        message: error.message,
      });

      if (error.message.includes('Failed to extract facts')) {
        return res.status(503).json({
          error: 'Fact extraction temporarily unavailable',
          details: error.message,
        });
      }

      res.status(500).json({
        error: 'Failed to extract facts',
        details: error.message,
      });
    }
  }
);

/**
 * GET /v1/facts/:id
 *
 * Retrieves a specific fact by ID
 *
 * Path parameters:
 * - id: string - UUID of the fact
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = factIdSchema.parse(req.params);

    const fact = await factService.findById(id);

    if (!fact) {
      return res.status(404).json({ error: 'Fact not found' });
    }

    res.json(fact);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors.map((err: any) => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      });
    }

    logger.error('Error in GET /v1/facts/:id:', error);
    res.status(500).json({ error: 'Failed to fetch fact' });
  }
});

/**
 * GET /v1/users/:user_id/facts
 *
 * Lists all facts for a specific user
 *
 * Path parameters:
 * - user_id: string - UUID of the user (from mount path)
 *
 * Query parameters:
 * - limit: number (optional) - Maximum facts to return (default: 50)
 * - offset: number (optional) - Number of facts to skip (default: 0)
 * - category: string (optional) - Filter by category
 * - is_active: boolean (optional) - Filter by active status
 * - min_confidence: number (optional) - Minimum confidence threshold
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { user_id } = userIdParamSchema.parse(req.params);
    const queryParams = factListQuerySchema.parse(req.query);

    const facts = await factService.listByUser(user_id, {
      limit: queryParams.limit,
      offset: queryParams.offset,
      category: queryParams.category,
      is_active: queryParams.is_active,
      min_confidence: queryParams.min_confidence,
    });

    res.json({
      facts,
      count: facts.length,
      limit: queryParams.limit,
      offset: queryParams.offset,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors.map((err: any) => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      });
    }

    logger.error('Error in GET /v1/users/:user_id/facts:', error);
    res.status(500).json({ error: 'Failed to fetch facts' });
  }
});

/**
 * POST /v1/facts/search
 *
 * Performs semantic search across facts using vector similarity.
 *
 * Request body:
 * - query: string (required) - Search query
 * - user_id: string (optional) - Limit search to specific user
 * - category: string (optional) - Limit to specific category
 * - is_active: boolean (optional) - Filter by active status (default: true)
 * - limit: number (optional) - Maximum results (default: 10)
 * - min_similarity: number (optional) - Minimum similarity threshold (default: 0.7)
 * - min_confidence: number (optional) - Minimum confidence threshold (default: 0.5)
 */
router.post(
  '/search',
  validateBody(factSearchSchema),
  async (req: Request, res: Response) => {
    try {
      const {
        query,
        user_id,
        category,
        is_active,
        limit,
        min_similarity,
        min_confidence,
      } = req.body;

      const results = await factService.semanticSearch(query, {
        user_id,
        category,
        is_active,
        limit,
        min_similarity,
        min_confidence,
      });

      res.json({
        results,
        count: results.length,
        query,
      });
    } catch (error: any) {
      logger.error('Error in POST /v1/facts/search:', error);

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
 * PATCH /v1/facts/:id
 *
 * Updates a fact
 *
 * Path parameters:
 * - id: string - UUID of the fact
 *
 * Request body:
 * - content: string (optional) - Updated content
 * - category: string (optional) - Updated category
 * - confidence: number (optional) - Updated confidence
 * - is_active: boolean (optional) - Updated active status
 */
router.patch(
  '/:id',
  validateBody(updateFactSchema),
  async (req: Request, res: Response) => {
    try {
      const { id } = factIdSchema.parse(req.params);

      const fact = await factService.updateFact(id, req.body);

      if (!fact) {
        return res.status(404).json({ error: 'Fact not found' });
      }

      res.json(fact);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.errors.map((err: any) => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        });
      }

      logger.error('Error in PATCH /v1/facts/:id:', error);
      res.status(500).json({ error: 'Failed to update fact' });
    }
  }
);

/**
 * DELETE /v1/facts/:id
 *
 * Deletes a fact
 *
 * Path parameters:
 * - id: string - UUID of the fact
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = factIdSchema.parse(req.params);

    const deleted = await factService.deleteFact(id);

    if (!deleted) {
      return res.status(404).json({ error: 'Fact not found' });
    }

    res.status(204).send();
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors.map((err: any) => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      });
    }

    logger.error('Error in DELETE /v1/facts/:id:', error);
    res.status(500).json({ error: 'Failed to delete fact' });
  }
});

/**
 * GET /v1/users/:user_id/facts/debug
 *
 * Debug endpoint to diagnose fact extraction issues
 *
 * Path parameters:
 * - user_id: string - UUID of the user
 */
router.get('/debug', async (req: Request, res: Response) => {
  try {
    const { user_id } = userIdParamSchema.parse(req.params);
    const { pool } = require('../index');
    const { ProfileService } = require('../services/profile.service');
    const profileService = new ProfileService(pool);

    // Get profile settings
    const profile = await profileService.getUserProfile(user_id);

    // Get fact counts
    const factCountResult = await pool.query(
      'SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE is_active = true) as active, COUNT(*) FILTER (WHERE confidence >= 0.5 AND is_active = true) as displayable FROM facts WHERE user_id = $1',
      [user_id]
    );

    // Get conversation stats
    const conversationStats = await pool.query(
      `SELECT
        COUNT(*) as total_conversations,
        COUNT(*) FILTER (WHERE (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) >= 5) as conversations_with_5plus_messages,
        COUNT(*) FILTER (WHERE last_fact_extraction_at IS NULL) as never_extracted,
        COUNT(*) FILTER (WHERE last_fact_extraction_at IS NOT NULL) as extracted_at_least_once,
        COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '24 hours') as active_last_24h
       FROM conversations c
       WHERE user_id = $1`,
      [user_id]
    );

    // Get recent facts
    const recentFacts = await pool.query(
      'SELECT id, content, category, confidence, is_active, created_at FROM facts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5',
      [user_id]
    );

    // Get conversations needing extraction
    const needsExtraction = await pool.query(
      `SELECT c.id, c.title, c.updated_at, c.last_fact_extraction_at, COUNT(m.id) as message_count
       FROM conversations c
       LEFT JOIN messages m ON m.conversation_id = c.id
       WHERE c.user_id = $1
         AND (c.last_fact_extraction_at IS NULL OR c.last_fact_extraction_at < NOW() - INTERVAL '10 minutes')
         AND c.updated_at > NOW() - INTERVAL '24 hours'
       GROUP BY c.id
       HAVING COUNT(m.id) >= 5
       ORDER BY c.updated_at DESC
       LIMIT 5`,
      [user_id]
    );

    res.json({
      user_id,
      profile: {
        id: profile.id,
        name: profile.name,
        features: {
          memorySystem: profile.features.memorySystem,
        },
        memory: profile.memory,
      },
      facts: {
        total: parseInt(factCountResult.rows[0].total),
        active: parseInt(factCountResult.rows[0].active),
        displayable: parseInt(factCountResult.rows[0].displayable),
        recent: recentFacts.rows,
      },
      conversations: conversationStats.rows[0],
      needs_extraction: needsExtraction.rows,
      diagnostic: {
        fact_extraction_enabled: profile.features.memorySystem && (profile.memory?.factExtraction ?? true),
        confidence_threshold: profile.memory?.confidenceThreshold ?? 0.5,
        max_context_facts: profile.memory?.maxContextFacts ?? 10,
        explanation: {
          displayable_facts: 'Facts with confidence >= 0.5 AND is_active = true (these appear in chat)',
          needs_extraction: 'Conversations with 5+ messages that need fact extraction',
          background_job: 'Runs every 5 minutes, processes up to 10 conversations per run',
          filters: [
            'Conversation must have 5+ messages',
            'Conversation must be active in last 24 hours',
            'Conversation must not have been extracted in last 10 minutes',
          ],
        },
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors.map((err: any) => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      });
    }

    logger.error('Error in GET /v1/users/:user_id/facts/debug:', error);
    res.status(500).json({ error: 'Failed to fetch debug info' });
  }
});

export default router;

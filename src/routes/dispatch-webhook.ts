import { Router, Request, Response } from 'express';
import { logger } from '../logger';
import { config } from '../config';

const router = Router();

/**
 * POST /v1/dispatch-webhook
 *
 * Receives webhook payloads from Dispatch when a user replies to Lucid.
 * Payload shape:
 * {
 *   event: string,
 *   channel_id: string,
 *   message: { sender_id: string, content: string, ... },
 *   sender: { id: string, name: string, ... },
 *   thread: { ... }
 * }
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { event, channel_id, message, sender, thread } = req.body;

    // Ignore messages sent by Lucid itself
    if (message?.sender_id === config.dispatch.senderId) {
      logger.debug('Ignoring own message from Dispatch webhook');
      return res.json({ ok: true, ignored: true });
    }

    logger.info('Dispatch webhook received', {
      event,
      channel_id,
      sender_id: message?.sender_id,
      content_length: message?.content?.length,
      sender_name: sender?.name,
    });

    // Log the full incoming message for now
    // Future: route to chat service so Lucid can reference what you said
    logger.info('Incoming Dispatch message', {
      from: sender?.name || message?.sender_id || 'unknown',
      content: message?.content,
      thread_id: thread?.id,
    });

    res.json({ ok: true });
  } catch (error: any) {
    logger.error('Dispatch webhook error', { error: error.message });
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;

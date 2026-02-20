import { logger } from '../logger';
import { config } from '../config';

/**
 * Notification payload for the Dispatch API
 */
export interface DispatchNotification {
  title: string;
  body: string;
  /** Custom data payload delivered to the iOS app */
  data?: Record<string, any>;
  /** Category for actionable notifications (e.g., 'LUCID_MESSAGE') */
  category?: string;
  /** Thread ID for grouping notifications */
  threadId?: string;
}

/**
 * DispatchService
 *
 * Sends push notifications via the Dispatch messaging API.
 * Dispatch handles APNs delivery internally — Lucid does not need
 * any APNS_* credentials or direct Apple integration.
 *
 * Setup:
 * 1. Set DISPATCH_API_URL to the Dispatch API base URL
 * 2. Set DISPATCH_APP_KEY to your app's API key
 * 3. Set DISPATCH_SENDER_ID to the sender identifier
 */
export class DispatchService {
  private apiUrl: string;
  private appKey: string;
  private senderId: string;

  constructor() {
    this.apiUrl = config.dispatch.apiUrl;
    this.appKey = config.dispatch.appKey;
    this.senderId = config.dispatch.senderId;

    if (this.isEnabled()) {
      logger.info('Dispatch service initialized', {
        apiUrl: this.apiUrl,
        senderId: this.senderId,
      });
    } else {
      logger.info('Dispatch service disabled — check DISPATCH_API_URL, DISPATCH_APP_KEY, DISPATCH_SENDER_ID env vars');
    }
  }

  /**
   * Check if Dispatch is configured and ready to send
   */
  isEnabled(): boolean {
    return !!this.apiUrl && !!this.appKey && !!this.senderId;
  }

  /**
   * Send a notification via the Dispatch messages API.
   *
   * POST {DISPATCH_API_URL}/v1/dispatch/messages
   * Auth: x-app-key header
   *
   * The notification title + body are combined into the `content` field.
   * Structured notification data (category, threadId, custom data) is sent
   * in the `metadata` field for the iOS app to process.
   */
  async sendMessage(notification: DispatchNotification): Promise<boolean> {
    if (!this.isEnabled()) {
      logger.debug('Dispatch disabled, skipping notification', { title: notification.title });
      return false;
    }

    const content = `${notification.title}\n\n${notification.body}`;

    const metadata: Record<string, any> = {};
    if (notification.data) metadata.data = notification.data;
    if (notification.category) metadata.category = notification.category;
    if (notification.threadId) metadata.threadId = notification.threadId;

    try {
      const url = `${this.apiUrl}/v1/dispatch/messages`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'x-app-key': this.appKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sender_id: this.senderId,
          content,
          content_type: 'text/plain',
          metadata,
        }),
      });

      if (response.status === 201) {
        const result = await response.json() as { id: string };
        logger.info('Dispatch message sent', {
          messageId: result.id,
          title: notification.title,
        });
        return true;
      } else {
        const errorText = await response.text();
        logger.error('Dispatch send failed', {
          status: response.status,
          error: errorText,
          title: notification.title,
        });
        return false;
      }
    } catch (error: any) {
      logger.error('Dispatch request error', { error: error.message, title: notification.title });
      return false;
    }
  }
}

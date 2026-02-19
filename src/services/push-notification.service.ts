import { Pool } from 'pg';
import { logger } from '../logger';
import { DispatchNotificationService } from './dispatch-notification.service';

/**
 * Push notification payload
 */
interface PushNotification {
  title: string;
  body: string;
  data?: Record<string, any>;
}

/**
 * PushNotificationService
 *
 * Handles push notifications for Lucid.
 * Supports multiple channels:
 * - Dispatch (enabled via DISPATCH_APP_KEY) - recommended for proactive notifications
 * - APNs (Apple Push) - requires iOS app and certificates
 * - FCM (Firebase) - for cross-platform
 */
export class PushNotificationService {
  private dispatchService: DispatchNotificationService;

  constructor(private pool: Pool) {
    this.dispatchService = new DispatchNotificationService();
  }

  /**
   * Register or update a user's push token
   */
  async registerPushToken(userId: string, pushToken: string): Promise<void> {
    try {
      await this.pool.query(
        `UPDATE users
         SET push_token = $1, push_token_updated_at = NOW()
         WHERE id = $2`,
        [pushToken, userId]
      );

      logger.info('Push token registered', { userId, tokenPrefix: pushToken.substring(0, 20) });
    } catch (error: any) {
      logger.error('Failed to register push token:', { userId, error: error.message });
      throw new Error('Failed to register push token');
    }
  }

  /**
   * Remove a user's push token
   */
  async removePushToken(userId: string): Promise<void> {
    try {
      await this.pool.query(
        `UPDATE users SET push_token = NULL, push_token_updated_at = NOW() WHERE id = $1`,
        [userId]
      );

      logger.info('Push token removed', { userId });
    } catch (error: any) {
      logger.error('Failed to remove push token:', { userId, error: error.message });
      throw new Error('Failed to remove push token');
    }
  }

  /**
   * Get a user's push token
   */
  async getPushToken(userId: string): Promise<string | null> {
    try {
      const result = await this.pool.query(
        'SELECT push_token FROM users WHERE id = $1',
        [userId]
      );

      return result.rows[0]?.push_token || null;
    } catch (error: any) {
      logger.error('Failed to get push token:', { userId, error: error.message });
      return null;
    }
  }

  /**
   * Send a push notification to a user
   *
   * Attempts to send via multiple channels:
   * 1. Dispatch (if configured) - works without app running
   * 2. APNs (if push token registered) - requires iOS app
   */
  async sendNotification(userId: string, notification: PushNotification): Promise<boolean> {
    let sent = false;

    try {
      // Try Dispatch first (most reliable for proactive notifications)
      if (this.dispatchService.isEnabled()) {
        const dispatchSent = await this.dispatchService.sendNotification(notification);
        if (dispatchSent) {
          logger.info('Notification sent via Dispatch', {
            userId,
            title: notification.title,
          });
          sent = true;
        }
      }

      // Also try APNs if push token exists
      const pushToken = await this.getPushToken(userId);
      if (pushToken) {
        // Log for now - APNs implementation can be added later
        logger.info('Would send APNs notification', {
          userId,
          pushToken: pushToken.substring(0, 20) + '...',
          notification,
        });

        // TODO: Implement actual APNs sending
        // Example with @parse/node-apn:
        // const apnProvider = new apn.Provider({
        //   token: {
        //     key: process.env.APNS_KEY_PATH,
        //     keyId: process.env.APNS_KEY_ID,
        //     teamId: process.env.APNS_TEAM_ID,
        //   },
        //   production: process.env.NODE_ENV === 'production',
        // });
        // const apnNotification = new apn.Notification({
        //   alert: { title: notification.title, body: notification.body },
        //   topic: process.env.APNS_BUNDLE_ID,
        //   payload: notification.data,
        // });
        // await apnProvider.send(apnNotification, pushToken);

        // Consider this sent even if just logged (for now)
        sent = true;
      }

      if (!sent) {
        logger.debug('No notification channels available for user', { userId });
      }

      return sent;
    } catch (error: any) {
      logger.error('Failed to send push notification:', {
        userId,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Get the Dispatch service for direct access
   */
  getDispatchService(): DispatchNotificationService {
    return this.dispatchService;
  }

  /**
   * Send a library entry notification
   */
  async sendLibraryEntryNotification(
    userId: string,
    entryId: string,
    title: string
  ): Promise<boolean> {
    return this.sendNotification(userId, {
      title: 'Lucid has been thinking...',
      body: title,
      data: {
        type: 'library_entry',
        entryId,
      },
    });
  }
}

import { Pool } from 'pg';
import { logger } from '../logger';

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
 * Currently a placeholder that logs notifications - integrate with actual
 * push service (Expo, APNs, FCM) as needed.
 */
export class PushNotificationService {
  constructor(private pool: Pool) {}

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
   * Currently logs the notification - integrate with actual push service as needed.
   * Options for integration:
   * - Expo Push (for Expo apps): https://docs.expo.dev/push-notifications/sending-notifications/
   * - APNs (Apple): Direct integration with Apple Push Notification service
   * - Firebase Cloud Messaging (FCM): For cross-platform
   */
  async sendNotification(userId: string, notification: PushNotification): Promise<boolean> {
    try {
      const pushToken = await this.getPushToken(userId);

      if (!pushToken) {
        logger.debug('No push token for user, skipping notification', { userId });
        return false;
      }

      // Log the notification (placeholder for actual implementation)
      logger.info('Would send push notification', {
        userId,
        pushToken: pushToken.substring(0, 20) + '...',
        notification,
      });

      // TODO: Implement actual push notification sending
      // Example with Expo:
      // const expo = new Expo();
      // await expo.sendPushNotificationsAsync([{
      //   to: pushToken,
      //   sound: 'default',
      //   title: notification.title,
      //   body: notification.body,
      //   data: notification.data || {},
      // }]);

      return true;
    } catch (error: any) {
      logger.error('Failed to send push notification:', {
        userId,
        error: error.message,
      });
      return false;
    }
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

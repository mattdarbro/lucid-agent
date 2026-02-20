import { Pool } from 'pg';
import { logger } from '../logger';
import { ApnsService, ApnsNotification } from './apns.service';
import { DeviceService } from './device.service';

/**
 * Push notification payload
 */
export interface PushNotification {
  title: string;
  body: string;
  data?: Record<string, any>;
  /** APNs category for actionable notifications (e.g., 'LUCID_MESSAGE') */
  category?: string;
  /** Thread ID for grouping related notifications */
  threadId?: string;
}

/**
 * PushNotificationService
 *
 * Handles push notifications for Lucid via APNs.
 * Sends to all active devices for a user via the DeviceService.
 *
 * This is the single entry point for all outbound notifications from Lucid.
 * Autonomous loops, research completion, health alerts — everything goes through here.
 */
export class PushNotificationService {
  private apnsService: ApnsService;
  private deviceService: DeviceService;

  constructor(private pool: Pool) {
    this.apnsService = new ApnsService();
    this.deviceService = new DeviceService(pool);
  }

  /**
   * Check if push notifications are available
   */
  isEnabled(): boolean {
    return this.apnsService.isEnabled();
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
   * Send a push notification to all of a user's active devices via APNs
   *
   * Collects push tokens from both the user_devices table (multi-device)
   * and the legacy users.push_token column, then sends to all of them.
   */
  async sendNotification(userId: string, notification: PushNotification): Promise<boolean> {
    try {
      if (!this.apnsService.isEnabled()) {
        logger.debug('APNs not configured, skipping notification', {
          userId,
          title: notification.title,
        });
        return false;
      }

      // Collect all device tokens for this user
      const tokens = await this.collectDeviceTokens(userId);

      if (tokens.length === 0) {
        logger.debug('No push tokens found for user', { userId });
        return false;
      }

      const apnsNotification: ApnsNotification = {
        title: notification.title,
        body: notification.body,
        data: notification.data,
        category: notification.category,
        threadId: notification.threadId,
      };

      const result = await this.apnsService.sendToDevices(tokens, apnsNotification);

      logger.info('Push notification dispatched', {
        userId,
        title: notification.title,
        devices: tokens.length,
        sent: result.sent,
        failed: result.failed,
      });

      return result.sent > 0;
    } catch (error: any) {
      logger.error('Failed to send push notification:', {
        userId,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Send a notification when a seed grows into a Library entry
   */
  async sendSeedGrownNotification(userId: string, title: string, content: string): Promise<boolean> {
    const truncated = content.length > 200 ? content.substring(0, 197) + '...' : content;
    return this.sendNotification(userId, {
      title: 'A seed grew',
      body: `${title}\n\n${truncated}`,
      data: { type: 'seed_grown', title },
      category: 'LUCID_SEED',
      threadId: 'seeds',
    });
  }

  /**
   * Send a seed briefing notification (morning)
   */
  async sendSeedBriefingNotification(userId: string, content: string): Promise<boolean> {
    const truncated = content.length > 500 ? content.substring(0, 497) + '...' : content;
    return this.sendNotification(userId, {
      title: 'Seeds',
      body: truncated,
      data: { type: 'seed_briefing' },
      category: 'LUCID_BRIEFING',
      threadId: 'seeds',
    });
  }

  /**
   * Send a weekly seed reflection notification
   */
  async sendWeeklySeedReflection(userId: string, content: string): Promise<boolean> {
    const truncated = content.length > 500 ? content.substring(0, 497) + '...' : content;
    return this.sendNotification(userId, {
      title: 'Weekly Seeds',
      body: truncated,
      data: { type: 'weekly_reflection' },
      category: 'LUCID_BRIEFING',
      threadId: 'seeds',
    });
  }

  /**
   * Send a research completion notification
   */
  async sendResearchNotification(userId: string, title: string, summary?: string): Promise<boolean> {
    const body = summary
      ? (summary.length > 300 ? summary.substring(0, 297) + '...' : summary)
      : title;
    return this.sendNotification(userId, {
      title: 'Research Complete',
      body: `${title}\n\n${body}`,
      data: { type: 'research_complete', title },
      category: 'LUCID_RESEARCH',
      threadId: 'research',
    });
  }

  /**
   * Send an investment recommendation notification
   */
  async sendInvestmentRecommendation(
    userId: string,
    recommendation: string,
    budgetRemaining: number,
    totalBudget: number
  ): Promise<boolean> {
    const truncated = recommendation.length > 400 ? recommendation.substring(0, 397) + '...' : recommendation;
    return this.sendNotification(userId, {
      title: 'Investment Idea',
      body: `${truncated}\n\nBudget: $${budgetRemaining.toFixed(2)} remaining of $${totalBudget.toFixed(2)}`,
      data: { type: 'investment_recommendation', budgetRemaining, totalBudget },
      category: 'LUCID_INVESTMENT',
      threadId: 'investments',
    });
  }

  /**
   * Send a spending proposal notification
   */
  async sendSpendingProposal(
    userId: string,
    proposal: string,
    budgetRemaining: number,
    totalBudget: number
  ): Promise<boolean> {
    const truncated = proposal.length > 400 ? proposal.substring(0, 397) + '...' : proposal;
    return this.sendNotification(userId, {
      title: 'Spending Proposal',
      body: `${truncated}\n\nAbility Budget: $${budgetRemaining.toFixed(2)} remaining of $${totalBudget.toFixed(2)}`,
      data: { type: 'spending_proposal', budgetRemaining, totalBudget },
      category: 'LUCID_SPENDING',
      threadId: 'spending',
    });
  }

  /**
   * Send a health alert notification
   */
  async sendHealthAlert(
    userId: string,
    title: string,
    body: string,
    metric: string
  ): Promise<boolean> {
    return this.sendNotification(userId, {
      title,
      body,
      data: { type: 'health_alert', metric },
      category: 'LUCID_HEALTH',
      threadId: 'health',
    });
  }

  /**
   * Send a self-review notification
   */
  async sendSelfReviewNotification(userId: string, title: string, body: string): Promise<boolean> {
    return this.sendNotification(userId, {
      title,
      body,
      data: { type: 'self_review' },
      category: 'LUCID_SYSTEM',
      threadId: 'system',
    });
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
      category: 'LUCID_LIBRARY',
      threadId: 'library',
    });
  }

  /**
   * Send a thought notification (from the queue)
   */
  async sendThoughtNotification(
    userId: string,
    notificationId: string,
    question: string,
    context?: string,
    priority?: number
  ): Promise<boolean> {
    let body = question;
    if (context) {
      body += `\n\n${context}`;
    }

    return this.sendNotification(userId, {
      title: priority && priority > 0.7 ? 'Lucid wants to check in' : 'A thought from Lucid',
      body,
      data: {
        type: 'thought_notification',
        notificationId,
        priority,
      },
      category: 'LUCID_THOUGHT',
      threadId: 'thoughts',
    });
  }

  /**
   * Collect all active push tokens for a user from both device table and legacy user column
   */
  private async collectDeviceTokens(userId: string): Promise<string[]> {
    const tokens = new Set<string>();

    try {
      // Get tokens from multi-device table
      const deviceTokens = await this.deviceService.getDevicePushTokens(userId);
      for (const dt of deviceTokens) {
        if (dt.pushToken) {
          tokens.add(dt.pushToken);
        }
      }

      // Also check legacy push_token on users table
      const legacyToken = await this.getPushToken(userId);
      if (legacyToken) {
        tokens.add(legacyToken);
      }
    } catch (error: any) {
      logger.error('Failed to collect device tokens', { userId, error: error.message });
    }

    return Array.from(tokens);
  }
}

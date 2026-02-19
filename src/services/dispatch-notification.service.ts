import { logger } from '../logger';
import { config } from '../config';

/**
 * Dispatch notification payload
 */
interface DispatchNotification {
  title: string;
  body: string;
  data?: Record<string, any>;
}

/**
 * DispatchNotificationService
 *
 * Sends notifications via the Dispatch messaging system.
 * Drop-in replacement for TelegramNotificationService — same public API,
 * but posts to Dispatch instead of Telegram Bot API.
 *
 * No markdown escaping needed — Dispatch accepts plain text.
 */
export class DispatchNotificationService {
  private apiUrl: string;
  private appKey: string;
  private senderId: string;

  constructor() {
    this.apiUrl = config.dispatch.apiUrl;
    this.appKey = config.dispatch.appKey;
    this.senderId = config.dispatch.senderId;

    if (this.isEnabled()) {
      logger.info('Dispatch notification service initialized');
    } else {
      logger.warn('Dispatch notification service disabled - DISPATCH_APP_KEY not set');
    }
  }

  /**
   * Check if Dispatch notifications are enabled
   */
  isEnabled(): boolean {
    return config.dispatch.enabled;
  }

  /**
   * Send a message via Dispatch
   */
  async sendMessage(text: string): Promise<boolean> {
    if (!this.isEnabled()) {
      logger.debug('Dispatch disabled - not configured');
      return false;
    }

    try {
      const url = `${this.apiUrl}/v1/dispatch/messages`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-app-key': this.appKey,
        },
        body: JSON.stringify({
          sender_id: this.senderId,
          content: text,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Dispatch API error', {
          status: response.status,
          error: errorText,
        });
        return false;
      }

      logger.info('Dispatch message sent', {
        textLength: text.length,
      });

      return true;
    } catch (error: any) {
      logger.error('Failed to send Dispatch message', {
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Send a notification (structured like push notifications)
   */
  async sendNotification(notification: DispatchNotification): Promise<boolean> {
    let text = `${notification.title}\n\n${notification.body}`;

    if (notification.data?.type) {
      text += `\n\nType: ${notification.data.type}`;
    }

    return this.sendMessage(text);
  }

  /**
   * Send a thought/check-in notification
   */
  async sendThoughtNotification(
    question: string,
    context?: string,
    priority?: number
  ): Promise<boolean> {
    let text = `Lucid wants to check in\n\n${question}`;

    if (context) {
      text += `\n\nContext: ${context}`;
    }

    if (priority && priority > 0.7) {
      text = `[HIGH PRIORITY] ${text}`;
    }

    return this.sendMessage(text);
  }

  /**
   * Send a research completion notification
   */
  async sendResearchNotification(
    title: string,
    summary?: string
  ): Promise<boolean> {
    let text = `Research Complete\n\n${title}`;

    if (summary) {
      const truncatedSummary = summary.length > 500
        ? summary.substring(0, 497) + '...'
        : summary;
      text += `\n\n${truncatedSummary}`;
    }

    return this.sendMessage(text);
  }

  /**
   * Send a library entry notification
   */
  async sendLibraryEntryNotification(
    entryType: string,
    title: string
  ): Promise<boolean> {
    const text = `New ${entryType}\n\n${title}`;
    return this.sendMessage(text);
  }

  /**
   * Send a seed-focused morning briefing notification
   */
  async sendSeedBriefingNotification(content: string): Promise<boolean> {
    const truncatedContent = content.length > 3500
      ? content.substring(0, 3497) + '...'
      : content;
    const text = `Seeds\n\n${truncatedContent}`;
    return this.sendMessage(text);
  }

  /**
   * Send notification when a seed grows into a Library entry
   */
  async sendSeedGrownNotification(
    title: string,
    content: string
  ): Promise<boolean> {
    const truncatedContent = content.length > 500
      ? content.substring(0, 497) + '...'
      : content;
    const text = `A seed grew\n\n${title}\n\n${truncatedContent}`;
    return this.sendMessage(text);
  }

  /**
   * Send weekly seed reflection notification
   */
  async sendWeeklySeedReflection(content: string): Promise<boolean> {
    const truncatedContent = content.length > 3500
      ? content.substring(0, 3497) + '...'
      : content;
    const text = `Weekly Seeds\n\n${truncatedContent}`;
    return this.sendMessage(text);
  }

  /**
   * Send an investment recommendation notification
   */
  async sendInvestmentRecommendation(
    recommendation: string,
    budgetRemaining: number,
    totalBudget: number
  ): Promise<boolean> {
    const truncated = recommendation.length > 3000
      ? recommendation.substring(0, 2997) + '...'
      : recommendation;
    const text = `Investment Idea\n\n${truncated}\n\nBudget: $${budgetRemaining.toFixed(2)} remaining of $${totalBudget.toFixed(2)}`;
    return this.sendMessage(text);
  }

  /**
   * Send a spending proposal notification
   */
  async sendSpendingProposal(
    proposal: string,
    budgetRemaining: number,
    totalBudget: number
  ): Promise<boolean> {
    const truncated = proposal.length > 3000
      ? proposal.substring(0, 2997) + '...'
      : proposal;
    const text = `Spending Proposal\n\n${truncated}\n\nAbility Budget: $${budgetRemaining.toFixed(2)} remaining of $${totalBudget.toFixed(2)}`;
    return this.sendMessage(text);
  }
}

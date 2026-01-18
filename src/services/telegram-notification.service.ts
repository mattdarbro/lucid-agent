import { logger } from '../logger';

/**
 * Telegram notification payload
 */
interface TelegramNotification {
  title: string;
  body: string;
  data?: Record<string, any>;
}

/**
 * Telegram API response
 */
interface TelegramResponse {
  ok: boolean;
  result?: any;
  description?: string;
  error_code?: number;
}

/**
 * TelegramNotificationService
 *
 * Sends notifications via Telegram Bot API.
 * This provides a reliable way for Lucid to proactively reach out to users
 * without requiring iOS push notification infrastructure.
 *
 * Setup:
 * 1. Create a bot via @BotFather on Telegram
 * 2. Get your chat_id by messaging the bot and checking /getUpdates
 * 3. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in environment
 */
export class TelegramNotificationService {
  private botToken: string | null;
  private defaultChatId: string | null;
  private baseUrl: string;

  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN || null;
    this.defaultChatId = process.env.TELEGRAM_CHAT_ID || null;
    this.baseUrl = 'https://api.telegram.org';

    if (this.botToken) {
      logger.info('Telegram notification service initialized');
    } else {
      logger.warn('Telegram notification service disabled - TELEGRAM_BOT_TOKEN not set');
    }
  }

  /**
   * Check if Telegram notifications are enabled
   */
  isEnabled(): boolean {
    return !!this.botToken && !!this.defaultChatId;
  }

  /**
   * Send a message via Telegram
   */
  async sendMessage(
    text: string,
    chatId?: string,
    options: {
      parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML';
      disableNotification?: boolean;
    } = {}
  ): Promise<boolean> {
    const targetChatId = chatId || this.defaultChatId;

    if (!this.botToken) {
      logger.debug('Telegram disabled - no bot token configured');
      return false;
    }

    if (!targetChatId) {
      logger.debug('Telegram disabled - no chat ID configured');
      return false;
    }

    try {
      const url = `${this.baseUrl}/bot${this.botToken}/sendMessage`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: targetChatId,
          text,
          parse_mode: options.parseMode || 'Markdown',
          disable_notification: options.disableNotification || false,
        }),
      });

      const result: TelegramResponse = await response.json();

      if (!result.ok) {
        logger.error('Telegram API error', {
          error_code: result.error_code,
          description: result.description,
        });
        return false;
      }

      logger.info('Telegram message sent', {
        chatId: targetChatId,
        textLength: text.length,
      });

      return true;
    } catch (error: any) {
      logger.error('Failed to send Telegram message', {
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Send a notification (structured like push notifications)
   */
  async sendNotification(notification: TelegramNotification): Promise<boolean> {
    // Format the notification as a Telegram message
    let text = `*${this.escapeMarkdown(notification.title)}*\n\n${notification.body}`;

    // Add data context if present
    if (notification.data?.type) {
      text += `\n\n_Type: ${notification.data.type}_`;
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
    let text = `🧠 *Lucid wants to check in*\n\n${question}`;

    if (context) {
      text += `\n\n_Context: ${context}_`;
    }

    if (priority && priority > 0.7) {
      text = `⚡ ${text}`; // High priority indicator
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
    let text = `🔬 *Research Complete*\n\n${title}`;

    if (summary) {
      // Truncate long summaries
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
    const emoji = this.getEntryEmoji(entryType);
    const text = `${emoji} *New ${entryType}*\n\n${title}`;

    return this.sendMessage(text);
  }

  /**
   * Send a morning briefing notification
   */
  async sendBriefingNotification(summary: string): Promise<boolean> {
    const text = `☀️ *Morning Briefing*\n\n${summary}`;
    return this.sendMessage(text);
  }

  /**
   * Escape special characters for Markdown
   */
  private escapeMarkdown(text: string): string {
    return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
  }

  /**
   * Get emoji for entry type
   */
  private getEntryEmoji(entryType: string): string {
    const emojiMap: Record<string, string> = {
      thought: '💭',
      reflection: '🪞',
      research: '🔬',
      briefing: '📋',
      insight: '💡',
      dream: '🌙',
      memory: '🧠',
      summary: '📝',
    };
    return emojiMap[entryType.toLowerCase()] || '📌';
  }
}

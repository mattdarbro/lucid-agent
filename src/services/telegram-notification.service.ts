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

      const result = await response.json() as TelegramResponse;

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
   * @deprecated Use sendSeedBriefingNotification instead
   */
  async sendBriefingNotification(summary: string): Promise<boolean> {
    const text = `☀️ *Morning Briefing*\n\n${summary}`;
    return this.sendMessage(text);
  }

  /**
   * Send a seed-focused morning briefing notification
   * This is Lucid sharing seeds he's holding and inviting exploration
   */
  async sendSeedBriefingNotification(content: string): Promise<boolean> {
    // Truncate if too long for Telegram
    const truncatedContent = content.length > 3500
      ? content.substring(0, 3497) + '...'
      : content;
    const text = `🌱 *Seeds*\n\n${truncatedContent}`;
    return this.sendMessage(text);
  }

  /**
   * Send notification when a seed grows into a Library entry
   */
  async sendSeedGrownNotification(
    title: string,
    content: string
  ): Promise<boolean> {
    // Truncate content for Telegram
    const truncatedContent = content.length > 500
      ? content.substring(0, 497) + '...'
      : content;
    const text = `🌳 *A seed grew*\n\n*${title}*\n\n${truncatedContent}`;
    return this.sendMessage(text);
  }

  /**
   * Send weekly seed reflection notification
   */
  async sendWeeklySeedReflection(content: string): Promise<boolean> {
    // Truncate if too long for Telegram
    const truncatedContent = content.length > 3500
      ? content.substring(0, 3497) + '...'
      : content;
    const text = `🌿 *Weekly Seeds*\n\n${truncatedContent}`;
    return this.sendMessage(text);
  }

  /**
   * Send an investment recommendation notification
   * Lucid shares what he wants to buy and why
   */
  async sendInvestmentRecommendation(
    recommendation: string,
    budgetRemaining: number,
    totalBudget: number
  ): Promise<boolean> {
    const truncated = recommendation.length > 3000
      ? recommendation.substring(0, 2997) + '...'
      : recommendation;
    const text = `📈 *Investment Idea*\n\n${truncated}\n\n_Budget: $${budgetRemaining.toFixed(2)} remaining of $${totalBudget.toFixed(2)}_`;
    return this.sendMessage(text);
  }

  /**
   * Send a spending proposal notification
   * Lucid proposes a tool/service purchase to enhance his abilities
   */
  async sendSpendingProposal(
    proposal: string,
    budgetRemaining: number,
    totalBudget: number
  ): Promise<boolean> {
    const truncated = proposal.length > 3000
      ? proposal.substring(0, 2997) + '...'
      : proposal;
    const text = `🛠 *Spending Proposal*\n\n${truncated}\n\n_Ability Budget: $${budgetRemaining.toFixed(2)} remaining of $${totalBudget.toFixed(2)}_`;
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

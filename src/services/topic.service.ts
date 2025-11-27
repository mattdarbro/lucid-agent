import { Pool } from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';

/**
 * Topic shift detection result
 */
interface TopicShiftResult {
  shifted: boolean;
  suggestedTag?: string;
  color?: string;
  detectionMethod?: 'explicit_hashtag' | 'time_gap' | 'semantic_shift' | 'manual';
}

/**
 * Conversation segment
 */
interface ConversationSegment {
  id: string;
  conversation_id: string;
  topic_tag: string;
  background_color: string | null;
  started_at: Date;
  ended_at: Date | null;
  detection_method: string | null;
}

/**
 * Message structure for analysis
 */
interface Message {
  role: 'user' | 'assistant';
  content: string;
  created_at?: Date;
}

/**
 * TopicService
 *
 * Handles topic detection and segmentation in conversations.
 * Topics provide visual organization through subtle background colors.
 *
 * Detection methods:
 * 1. Explicit hashtags (#career, #health)
 * 2. Time gaps (> 1 hour between messages)
 * 3. Semantic shift (Claude-based analysis)
 */
export class TopicService {
  private pool: Pool;
  private anthropic: Anthropic;

  // Soft, subtle colors for topic backgrounds
  private readonly topicColors = [
    '#FFF5E6', // warm cream
    '#E6F3FF', // soft blue
    '#F0FFE6', // soft green
    '#FFE6F0', // soft pink
    '#F5E6FF', // soft purple
    '#FFFDE6', // soft yellow
    '#E6FFFA', // soft teal
    '#FFF0E6', // soft peach
    '#E6E6FF', // soft lavender
    '#F0F0F0', // soft gray
  ];

  constructor(pool: Pool, anthropicApiKey?: string) {
    this.pool = pool;
    this.anthropic = new Anthropic({
      apiKey: anthropicApiKey || process.env.ANTHROPIC_API_KEY,
    });
  }

  /**
   * Detect if a new message represents a topic shift
   */
  async detectTopicShift(
    userId: string,
    conversationId: string,
    newMessage: string,
    previousMessages: Message[],
    timeSinceLastMessage: number // in seconds
  ): Promise<TopicShiftResult> {
    // Rule 1: Explicit hashtag in message
    const hashtagMatch = newMessage.match(/#(\w+)/);
    if (hashtagMatch) {
      const tag = hashtagMatch[1].toLowerCase();
      return {
        shifted: true,
        suggestedTag: tag,
        color: this.getTagColor(tag),
        detectionMethod: 'explicit_hashtag',
      };
    }

    // Rule 2: Long time gap (> 1 hour = 3600 seconds)
    if (timeSinceLastMessage > 3600) {
      const tag = await this.suggestTagFromMessage(newMessage);
      return {
        shifted: true,
        suggestedTag: tag,
        color: this.getTagColor(tag),
        detectionMethod: 'time_gap',
      };
    }

    // Rule 3: Semantic shift detection (only if we have enough context)
    if (previousMessages.length >= 3) {
      const shifted = await this.detectSemanticShift(newMessage, previousMessages);
      if (shifted) {
        const tag = await this.suggestTagFromMessage(newMessage);
        return {
          shifted: true,
          suggestedTag: tag,
          color: this.getTagColor(tag),
          detectionMethod: 'semantic_shift',
        };
      }
    }

    return { shifted: false };
  }

  /**
   * Get a deterministic color for a topic tag
   * Same tag always gets the same color
   */
  getTagColor(tag: string): string {
    let hash = 0;
    for (let i = 0; i < tag.length; i++) {
      hash = tag.charCodeAt(i) + ((hash << 5) - hash);
    }
    return this.topicColors[Math.abs(hash) % this.topicColors.length];
  }

  /**
   * Detect semantic shift using Claude
   */
  private async detectSemanticShift(
    newMessage: string,
    previousMessages: Message[]
  ): Promise<boolean> {
    try {
      const recentContext = previousMessages
        .slice(-5)
        .map((m) => `${m.role}: ${m.content}`)
        .join('\n');

      const prompt = `Analyze if this new message represents a significant topic shift from the recent conversation.

Recent conversation:
${recentContext}

New message: "${newMessage}"

A topic shift means the user is now discussing something substantially different - a new subject, concern, or area of their life. Minor follow-ups or clarifications are NOT shifts.

Respond with ONLY: SHIFT or CONTINUE`;

      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 10,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content.type !== 'text') return false;

      return content.text.trim().toUpperCase() === 'SHIFT';
    } catch (error) {
      logger.error('Error detecting semantic shift:', error);
      return false;
    }
  }

  /**
   * Suggest a topic tag based on message content
   */
  private async suggestTagFromMessage(message: string): Promise<string> {
    try {
      const prompt = `Generate a single-word or hyphenated topic tag for this message.
The tag should be lowercase, concise, and descriptive.

Examples: "career", "health", "relationship", "project-x", "finances", "family", "self-care", "creativity"

Message: "${message}"

Respond with ONLY the tag (no explanation, no hashtag):`;

      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 20,
        temperature: 0.3,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content.type !== 'text') return 'general';

      // Clean the response
      const tag = content.text.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
      return tag || 'general';
    } catch (error) {
      logger.error('Error suggesting tag:', error);
      return 'general';
    }
  }

  /**
   * Start a new topic segment
   */
  async startSegment(
    conversationId: string,
    topicTag: string,
    detectionMethod: string
  ): Promise<ConversationSegment> {
    // End any active segment first
    await this.endActiveSegment(conversationId);

    const color = this.getTagColor(topicTag);

    const result = await this.pool.query(
      `INSERT INTO conversation_segments
       (conversation_id, topic_tag, background_color, detection_method)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [conversationId, topicTag, color, detectionMethod]
    );

    logger.info('Started new topic segment', {
      conversation_id: conversationId,
      topic_tag: topicTag,
      detection_method: detectionMethod,
    });

    return result.rows[0];
  }

  /**
   * End the currently active segment for a conversation
   */
  async endActiveSegment(conversationId: string): Promise<void> {
    await this.pool.query(
      `UPDATE conversation_segments
       SET ended_at = NOW()
       WHERE conversation_id = $1 AND ended_at IS NULL`,
      [conversationId]
    );
  }

  /**
   * Get the active segment for a conversation
   */
  async getActiveSegment(conversationId: string): Promise<ConversationSegment | null> {
    const result = await this.pool.query(
      `SELECT * FROM conversation_segments
       WHERE conversation_id = $1 AND ended_at IS NULL
       ORDER BY started_at DESC
       LIMIT 1`,
      [conversationId]
    );

    return result.rows[0] || null;
  }

  /**
   * Get all segments for a conversation
   */
  async getSegments(conversationId: string): Promise<ConversationSegment[]> {
    const result = await this.pool.query(
      `SELECT * FROM conversation_segments
       WHERE conversation_id = $1
       ORDER BY started_at ASC`,
      [conversationId]
    );

    return result.rows;
  }

  /**
   * Manually set a topic for the current conversation
   */
  async setTopic(
    conversationId: string,
    topicTag: string
  ): Promise<ConversationSegment> {
    return this.startSegment(conversationId, topicTag.toLowerCase(), 'manual');
  }

  /**
   * Get topic statistics for a user
   */
  async getTopicStats(userId: string): Promise<Array<{ topic_tag: string; count: number }>> {
    const result = await this.pool.query(
      `SELECT cs.topic_tag, COUNT(*) as count
       FROM conversation_segments cs
       JOIN conversations c ON c.id = cs.conversation_id
       WHERE c.user_id = $1
       GROUP BY cs.topic_tag
       ORDER BY count DESC
       LIMIT 20`,
      [userId]
    );

    return result.rows;
  }
}

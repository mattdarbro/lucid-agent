import { Pool } from 'pg';
import { logger } from '../logger';
import {
  CreateThoughtNotificationInput,
  UpdateThoughtNotificationInput,
  RespondToNotificationInput,
} from '../validation/thought-notification.validation';

/**
 * ThoughtNotificationService
 * Manages the queue of things Lucid wants to discuss with users
 */
export class ThoughtNotificationService {
  constructor(private pool: Pool) {}

  /**
   * Create a new thought notification
   */
  async createNotification(input: CreateThoughtNotificationInput) {
    const query = `
      INSERT INTO thought_notifications (
        user_id,
        thought_id,
        research_task_id,
        question,
        context,
        preferred_time_of_day,
        preferred_cognitive_state,
        priority,
        expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

    const values = [
      input.user_id,
      input.thought_id || null,
      input.research_task_id || null,
      input.question,
      input.context || null,
      input.preferred_time_of_day,
      input.preferred_cognitive_state,
      input.priority,
      input.expires_at || null,
    ];

    try {
      const result = await this.pool.query(query, values);

      logger.info('Thought notification created', {
        id: result.rows[0].id,
        user_id: input.user_id,
        priority: input.priority,
      });

      return result.rows[0];
    } catch (error: any) {
      logger.error('Error creating thought notification:', error);
      throw new Error(`Failed to create thought notification: ${error.message}`);
    }
  }

  /**
   * Get a notification by ID
   * Returns iOS-compatible JSON with proper timestamp formatting
   */
  async findById(notificationId: string) {
    const query = `
      SELECT
        id,
        user_id,
        thought_id,
        research_task_id,
        question,
        context,
        preferred_time_of_day,
        preferred_cognitive_state,
        priority,
        expires_at,
        status,
        sent_at,
        responded_at,
        response_text,
        response_metadata,
        created_at,
        updated_at
      FROM thought_notifications
      WHERE id = $1
    `;

    try {
      const result = await this.pool.query(query, [notificationId]);

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];

      // Format the response for iOS compatibility
      return {
        id: row.id,
        user_id: row.user_id,
        thought_id: row.thought_id || null,
        research_task_id: row.research_task_id || null,
        question: row.question,
        context: row.context || null,
        preferred_time_of_day: row.preferred_time_of_day || 'any',
        preferred_cognitive_state: row.preferred_cognitive_state || 'any',
        priority: parseFloat(row.priority) || 0.5,
        expires_at: row.expires_at ? new Date(row.expires_at).toISOString() : null,
        status: row.status,
        sent_at: row.sent_at ? new Date(row.sent_at).toISOString() : null,
        responded_at: row.responded_at ? new Date(row.responded_at).toISOString() : null,
        response_text: row.response_text || null,
        response_metadata: row.response_metadata || {},
        created_at: new Date(row.created_at).toISOString(),
        updated_at: new Date(row.updated_at).toISOString(),
      };
    } catch (error: any) {
      logger.error('Error fetching thought notification:', error);
      throw new Error(`Failed to fetch notification: ${error.message}`);
    }
  }

  /**
   * List notifications for a user
   * Returns iOS-compatible JSON with proper timestamp formatting
   */
  async listByUser(
    userId: string,
    options: {
      status?: string;
      limit?: number;
      offset?: number;
    } = {}
  ) {
    const { status, limit = 50, offset = 0 } = options;

    let query = `
      SELECT
        id,
        user_id,
        thought_id,
        research_task_id,
        question,
        context,
        preferred_time_of_day,
        preferred_cognitive_state,
        priority,
        expires_at,
        status,
        sent_at,
        responded_at,
        response_text,
        response_metadata,
        created_at,
        updated_at
      FROM thought_notifications
      WHERE user_id = $1
    `;

    const values: any[] = [userId];

    if (status) {
      query += ` AND status = $2`;
      values.push(status);
    }

    query += ` ORDER BY priority DESC, created_at DESC`;
    query += ` LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    values.push(limit, offset);

    try {
      const result = await this.pool.query(query, values);

      // Format the response for iOS compatibility
      const notifications = result.rows.map((row) => ({
        id: row.id,
        user_id: row.user_id,
        thought_id: row.thought_id || null,
        research_task_id: row.research_task_id || null,
        question: row.question,
        context: row.context || null,
        preferred_time_of_day: row.preferred_time_of_day || 'any',
        preferred_cognitive_state: row.preferred_cognitive_state || 'any',
        priority: parseFloat(row.priority) || 0.5,
        expires_at: row.expires_at ? new Date(row.expires_at).toISOString() : null,
        status: row.status,
        sent_at: row.sent_at ? new Date(row.sent_at).toISOString() : null,
        responded_at: row.responded_at ? new Date(row.responded_at).toISOString() : null,
        response_text: row.response_text || null,
        response_metadata: row.response_metadata || {},
        created_at: new Date(row.created_at).toISOString(),
        updated_at: new Date(row.updated_at).toISOString(),
      }));

      return notifications;
    } catch (error: any) {
      logger.error('Error listing thought notifications:', error);
      throw new Error(`Failed to list notifications: ${error.message}`);
    }
  }

  /**
   * Get pending notifications for a user
   * (ordered by priority, respecting expiration)
   * Returns iOS-compatible JSON with proper timestamp formatting
   */
  async getPendingNotifications(userId: string, limit: number = 10) {
    const query = `
      SELECT
        id,
        user_id,
        thought_id,
        research_task_id,
        question,
        context,
        preferred_time_of_day,
        preferred_cognitive_state,
        priority,
        expires_at,
        status,
        sent_at,
        responded_at,
        response_text,
        response_metadata,
        created_at,
        updated_at
      FROM thought_notifications
      WHERE user_id = $1
        AND status = 'pending'
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY priority DESC, created_at ASC
      LIMIT $2
    `;

    try {
      const result = await this.pool.query(query, [userId, limit]);

      // Format the response for iOS compatibility
      const notifications = result.rows.map((row) => ({
        id: row.id,
        user_id: row.user_id,
        thought_id: row.thought_id || null,
        research_task_id: row.research_task_id || null,
        question: row.question,
        context: row.context || null,
        preferred_time_of_day: row.preferred_time_of_day || 'any',
        preferred_cognitive_state: row.preferred_cognitive_state || 'any',
        priority: parseFloat(row.priority) || 0.5,
        expires_at: row.expires_at ? new Date(row.expires_at).toISOString() : null,
        status: row.status,
        sent_at: row.sent_at ? new Date(row.sent_at).toISOString() : null,
        responded_at: row.responded_at ? new Date(row.responded_at).toISOString() : null,
        response_text: row.response_text || null,
        response_metadata: row.response_metadata || {},
        created_at: new Date(row.created_at).toISOString(),
        updated_at: new Date(row.updated_at).toISOString(),
      }));

      return notifications;
    } catch (error: any) {
      logger.error('Error fetching pending notifications:', error);
      throw new Error(`Failed to fetch pending notifications: ${error.message}`);
    }
  }

  /**
   * Update a notification
   */
  async updateNotification(notificationId: string, input: UpdateThoughtNotificationInput) {
    const fields: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (input.question !== undefined) {
      fields.push(`question = $${paramCount++}`);
      values.push(input.question);
    }
    if (input.context !== undefined) {
      fields.push(`context = $${paramCount++}`);
      values.push(input.context);
    }
    if (input.preferred_time_of_day !== undefined) {
      fields.push(`preferred_time_of_day = $${paramCount++}`);
      values.push(input.preferred_time_of_day);
    }
    if (input.preferred_cognitive_state !== undefined) {
      fields.push(`preferred_cognitive_state = $${paramCount++}`);
      values.push(input.preferred_cognitive_state);
    }
    if (input.priority !== undefined) {
      fields.push(`priority = $${paramCount++}`);
      values.push(input.priority);
    }
    if (input.expires_at !== undefined) {
      fields.push(`expires_at = $${paramCount++}`);
      values.push(input.expires_at);
    }
    if (input.status !== undefined) {
      fields.push(`status = $${paramCount++}`);
      values.push(input.status);
    }

    if (fields.length === 0) {
      throw new Error('No fields to update');
    }

    fields.push(`updated_at = NOW()`);

    const query = `
      UPDATE thought_notifications
      SET ${fields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    values.push(notificationId);

    try {
      const result = await this.pool.query(query, values);

      if (result.rows.length === 0) {
        return null;
      }

      logger.info('Thought notification updated', {
        id: notificationId,
        fields: Object.keys(input),
      });

      return result.rows[0];
    } catch (error: any) {
      logger.error('Error updating thought notification:', error);
      throw new Error(`Failed to update notification: ${error.message}`);
    }
  }

  /**
   * Mark notification as sent
   */
  async markAsSent(notificationId: string) {
    const query = `
      UPDATE thought_notifications
      SET status = 'sent',
          sent_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;

    try {
      const result = await this.pool.query(query, [notificationId]);

      if (result.rows.length === 0) {
        return null;
      }

      logger.info('Notification marked as sent', { id: notificationId });
      return result.rows[0];
    } catch (error: any) {
      logger.error('Error marking notification as sent:', error);
      throw new Error(`Failed to mark notification as sent: ${error.message}`);
    }
  }

  /**
   * Record user's response to a notification
   * This also triggers state detection
   */
  async respondToNotification(notificationId: string, input: RespondToNotificationInput) {
    const notification = await this.findById(notificationId);

    if (!notification) {
      throw new Error('Notification not found');
    }

    if (notification.status !== 'sent' && notification.status !== 'pending') {
      throw new Error(`Cannot respond to notification with status: ${notification.status}`);
    }

    // Store the response
    const responseMetadata = {
      self_reported_energy: input.self_reported_energy,
      self_reported_mood: input.self_reported_mood,
      self_reported_focus: input.self_reported_focus,
    };

    const query = `
      UPDATE thought_notifications
      SET status = 'responded',
          response_text = $1,
          response_metadata = $2,
          responded_at = NOW(),
          updated_at = NOW()
      WHERE id = $3
      RETURNING *
    `;

    try {
      const result = await this.pool.query(query, [
        input.response_text,
        JSON.stringify(responseMetadata),
        notificationId,
      ]);

      logger.info('User responded to notification', {
        id: notificationId,
        user_id: notification.user_id,
        response_length: input.response_text.length,
      });

      return result.rows[0];
    } catch (error: any) {
      logger.error('Error recording notification response:', error);
      throw new Error(`Failed to record response: ${error.message}`);
    }
  }

  /**
   * Skip/dismiss a notification
   */
  async skipNotification(notificationId: string) {
    const query = `
      UPDATE thought_notifications
      SET status = 'skipped',
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;

    try {
      const result = await this.pool.query(query, [notificationId]);

      if (result.rows.length === 0) {
        return null;
      }

      logger.info('Notification skipped', { id: notificationId });
      return result.rows[0];
    } catch (error: any) {
      logger.error('Error skipping notification:', error);
      throw new Error(`Failed to skip notification: ${error.message}`);
    }
  }

  /**
   * Expire old pending notifications
   * (Run periodically by scheduler)
   */
  async expireOldNotifications() {
    const query = `
      UPDATE thought_notifications
      SET status = 'expired',
          updated_at = NOW()
      WHERE status = 'pending'
        AND expires_at IS NOT NULL
        AND expires_at < NOW()
      RETURNING id
    `;

    try {
      const result = await this.pool.query(query);

      logger.info('Expired old notifications', { count: result.rows.length });
      return result.rows.length;
    } catch (error: any) {
      logger.error('Error expiring notifications:', error);
      throw new Error(`Failed to expire notifications: ${error.message}`);
    }
  }

  /**
   * Delete a notification
   */
  async deleteNotification(notificationId: string) {
    const query = `
      DELETE FROM thought_notifications
      WHERE id = $1
      RETURNING id
    `;

    try {
      const result = await this.pool.query(query, [notificationId]);

      if (result.rows.length === 0) {
        return false;
      }

      logger.info('Notification deleted', { id: notificationId });
      return true;
    } catch (error: any) {
      logger.error('Error deleting notification:', error);
      throw new Error(`Failed to delete notification: ${error.message}`);
    }
  }
}

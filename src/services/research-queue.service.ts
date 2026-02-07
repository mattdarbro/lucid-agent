import { Pool } from 'pg';
import { logger } from '../logger';

/**
 * Research Queue Item structure
 */
export interface ResearchQueueItem {
  id: string;
  user_id: string;
  topic: string;
  search_query: string | null;
  why_it_matters: string | null;
  source_conversation_id: string | null;
  source_snippet: string | null;
  priority: number;
  times_mentioned: number;
  status: 'pending' | 'approved' | 'in_progress' | 'completed' | 'not_useful' | 'abandoned';
  user_approved: boolean;
  user_rejected: boolean;
  approved_at: Date | null;
  rejected_at: Date | null;
  search_was_useful: boolean | null;
  insights_generated: string | null;
  completed_at: Date | null;
  last_attempted_at: Date | null;
  attempt_count: number;
  max_attempts: number;
  last_surfaced_at: Date | null;
  times_surfaced: number;
  created_at: Date;
  updated_at: Date;
}

export interface AddToQueueInput {
  userId: string;
  topic: string;
  searchQuery?: string;
  whyItMatters: string;
  sourceConversationId?: string;
  sourceSnippet?: string;
  priority?: number;
}

/**
 * ResearchQueueService manages the research queue
 * Bridge between chat (where ideas surface) and AT (where research happens)
 * Enables user guidance: LUCID proposes, Matt approves/redirects
 */
export class ResearchQueueService {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Add a new research topic to the queue
   * Checks for similar existing topics first
   */
  async addToQueue(input: AddToQueueInput): Promise<ResearchQueueItem> {
    // Check for similar existing topic
    const similar = await this.findSimilarTopic(input.userId, input.topic);
    if (similar) {
      // Increment mention count and update if more context provided
      await this.incrementMentionCount(similar.id);
      logger.info('Research topic already in queue, incremented mention count', {
        topicId: similar.id,
        topic: input.topic,
        newMentionCount: similar.times_mentioned + 1,
      });
      return { ...similar, times_mentioned: similar.times_mentioned + 1 };
    }

    const result = await this.pool.query<ResearchQueueItem>(
      `INSERT INTO research_queue (
        user_id, topic, search_query, why_it_matters,
        source_conversation_id, source_snippet, priority
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        input.userId,
        input.topic,
        input.searchQuery || null,
        input.whyItMatters,
        input.sourceConversationId || null,
        input.sourceSnippet || null,
        input.priority || 5,
      ]
    );

    logger.info('Added research topic to queue', {
      topicId: result.rows[0].id,
      topic: input.topic,
      userId: input.userId,
    });

    return result.rows[0];
  }

  /**
   * Get all pending items for a user (not yet approved/rejected)
   */
  async getPendingItems(userId: string, limit: number = 10): Promise<ResearchQueueItem[]> {
    const result = await this.pool.query<ResearchQueueItem>(
      `SELECT * FROM research_queue
       WHERE user_id = $1 AND status = 'pending' AND NOT user_rejected
       ORDER BY priority DESC, times_mentioned DESC, created_at ASC
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows;
  }

  /**
   * Get user-approved items ready for research
   */
  async getApprovedItems(userId: string): Promise<ResearchQueueItem[]> {
    const result = await this.pool.query<ResearchQueueItem>(
      `SELECT * FROM research_queue
       WHERE user_id = $1 AND status = 'approved' AND user_approved = true
       ORDER BY priority DESC, approved_at ASC`,
      [userId]
    );
    return result.rows;
  }

  /**
   * Get items currently in progress
   */
  async getInProgressItems(userId: string): Promise<ResearchQueueItem[]> {
    const result = await this.pool.query<ResearchQueueItem>(
      `SELECT * FROM research_queue
       WHERE user_id = $1 AND status = 'in_progress'
       ORDER BY last_attempted_at DESC`,
      [userId]
    );
    return result.rows;
  }

  /**
   * User approves a research topic
   */
  async userApproves(itemId: string): Promise<void> {
    await this.pool.query(
      `UPDATE research_queue
       SET user_approved = true,
           user_rejected = false,
           status = 'approved',
           approved_at = NOW()
       WHERE id = $1`,
      [itemId]
    );

    logger.info('User approved research topic', { topicId: itemId });
  }

  /**
   * User rejects a research topic
   */
  async userRejects(itemId: string): Promise<void> {
    await this.pool.query(
      `UPDATE research_queue
       SET user_rejected = true,
           user_approved = false,
           status = 'abandoned',
           rejected_at = NOW()
       WHERE id = $1`,
      [itemId]
    );

    logger.info('User rejected research topic', { topicId: itemId });
  }

  /**
   * Mark an item as in progress (AT is researching)
   */
  async markInProgress(itemId: string): Promise<void> {
    await this.pool.query(
      `UPDATE research_queue
       SET status = 'in_progress',
           last_attempted_at = NOW(),
           attempt_count = attempt_count + 1
       WHERE id = $1`,
      [itemId]
    );

    logger.info('Research topic marked in progress', { topicId: itemId });
  }

  /**
   * Mark research as completed
   */
  async markCompleted(
    itemId: string,
    wasUseful: boolean,
    insights?: string
  ): Promise<void> {
    const status = wasUseful ? 'completed' : 'not_useful';

    await this.pool.query(
      `UPDATE research_queue
       SET status = $2,
           search_was_useful = $3,
           insights_generated = $4,
           completed_at = NOW()
       WHERE id = $1`,
      [itemId, status, wasUseful, insights || null]
    );

    logger.info('Research topic marked completed', {
      topicId: itemId,
      wasUseful,
      hasInsights: !!insights,
    });
  }

  /**
   * Increment the times_mentioned counter
   */
  async incrementMentionCount(itemId: string): Promise<void> {
    await this.pool.query(
      `UPDATE research_queue
       SET times_mentioned = times_mentioned + 1
       WHERE id = $1`,
      [itemId]
    );
  }

  /**
   * Find similar existing topic in queue
   * Uses simple string matching for now (could be enhanced with embeddings)
   */
  async findSimilarTopic(
    userId: string,
    topic: string
  ): Promise<ResearchQueueItem | null> {
    // Normalize the topic for comparison
    const normalizedTopic = topic.toLowerCase().trim();

    // Look for exact or highly similar matches
    const result = await this.pool.query<ResearchQueueItem>(
      `SELECT * FROM research_queue
       WHERE user_id = $1
         AND status NOT IN ('completed', 'not_useful', 'abandoned')
         AND (
           LOWER(topic) = $2
           OR LOWER(topic) LIKE '%' || $2 || '%'
           OR $2 LIKE '%' || LOWER(topic) || '%'
         )
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, normalizedTopic]
    );

    return result.rows[0] || null;
  }

  /**
   * Mark items as surfaced (shown to user)
   */
  async markSurfaced(itemIds: string[]): Promise<void> {
    if (itemIds.length === 0) return;

    await this.pool.query(
      `UPDATE research_queue
       SET last_surfaced_at = NOW(),
           times_surfaced = times_surfaced + 1
       WHERE id = ANY($1)`,
      [itemIds]
    );

    logger.debug('Research items marked as surfaced', { count: itemIds.length });
  }

  /**
   * Get items that should be surfaced to user
   * Items that haven't been surfaced recently and have accumulated mentions
   */
  async getItemsToSurface(
    userId: string,
    daysSinceLastSurface: number = 2,
    minItems: number = 3
  ): Promise<ResearchQueueItem[]> {
    const result = await this.pool.query<ResearchQueueItem>(
      `SELECT * FROM research_queue
       WHERE user_id = $1
         AND status = 'pending'
         AND NOT user_rejected
         AND (last_surfaced_at IS NULL OR last_surfaced_at < NOW() - INTERVAL '1 day' * $2)
       ORDER BY priority DESC, times_mentioned DESC, created_at ASC
       LIMIT $3`,
      [userId, daysSinceLastSurface, minItems]
    );
    return result.rows;
  }

  /**
   * Check if there are enough pending items to warrant surfacing
   */
  async shouldSurface(userId: string, minPending: number = 3): Promise<boolean> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM research_queue
       WHERE user_id = $1
         AND status = 'pending'
         AND NOT user_rejected
         AND (last_surfaced_at IS NULL OR last_surfaced_at < NOW() - INTERVAL '2 days')`,
      [userId]
    );
    return parseInt(result.rows[0].count, 10) >= minPending;
  }

  /**
   * Format queue items for presentation to user
   */
  formatQueueForSurfacing(items: ResearchQueueItem[]): string {
    if (items.length === 0) {
      return '';
    }

    let formatted = "I've been noticing some threads I could pull on:\n\n";

    items.forEach((item, index) => {
      const bullet = `• ${item.topic}`;
      const reason = item.why_it_matters ? ` - ${item.why_it_matters}` : '';
      const mentions = item.times_mentioned > 1 ? ` (mentioned ${item.times_mentioned}x)` : '';
      formatted += `${bullet}${reason}${mentions}\n`;
    });

    formatted += '\nAny of these feel worth exploring? Or should I drop some?';

    return formatted;
  }

  /**
   * Get research queue statistics for a user
   */
  async getQueueStats(userId: string): Promise<{
    pending: number;
    approved: number;
    in_progress: number;
    completed: number;
    total: number;
  }> {
    const result = await this.pool.query<{
      status: string;
      count: string;
    }>(
      `SELECT status, COUNT(*) as count FROM research_queue
       WHERE user_id = $1
       GROUP BY status`,
      [userId]
    );

    const stats = {
      pending: 0,
      approved: 0,
      in_progress: 0,
      completed: 0,
      total: 0,
    };

    result.rows.forEach((row: any) => {
      const count = parseInt(row.count, 10);
      stats.total += count;
      if (row.status === 'pending') stats.pending = count;
      else if (row.status === 'approved') stats.approved = count;
      else if (row.status === 'in_progress') stats.in_progress = count;
      else if (row.status === 'completed' || row.status === 'not_useful') stats.completed += count;
    });

    return stats;
  }

  /**
   * Get a single item by ID
   */
  async getItemById(itemId: string): Promise<ResearchQueueItem | null> {
    const result = await this.pool.query<ResearchQueueItem>(
      `SELECT * FROM research_queue WHERE id = $1`,
      [itemId]
    );
    return result.rows[0] || null;
  }

  /**
   * Delete an item from the queue
   */
  async deleteItem(itemId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM research_queue WHERE id = $1`,
      [itemId]
    );
    logger.info('Research queue item deleted', { itemId });
  }

  /**
   * Update priority of an item
   */
  async updatePriority(itemId: string, priority: number): Promise<void> {
    await this.pool.query(
      `UPDATE research_queue SET priority = $2 WHERE id = $1`,
      [itemId, Math.max(1, Math.min(10, priority))]
    );
  }

  /**
   * Set the should_surface_research flag for a user
   */
  async setShouldSurfaceFlag(userId: string, shouldSurface: boolean): Promise<void> {
    await this.pool.query(
      `UPDATE users
       SET should_surface_research = $2,
           last_research_surfaced_at = CASE WHEN $2 = false THEN NOW() ELSE last_research_surfaced_at END
       WHERE id = $1`,
      [userId, shouldSurface]
    );
  }

  /**
   * Check if user should see research queue surfacing
   */
  async getShouldSurfaceFlag(userId: string): Promise<boolean> {
    const result = await this.pool.query<{ should_surface_research: boolean }>(
      `SELECT should_surface_research FROM users WHERE id = $1`,
      [userId]
    );
    return result.rows[0]?.should_surface_research ?? false;
  }
}

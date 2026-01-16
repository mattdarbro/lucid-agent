import { Pool } from 'pg';
import { logger } from '../logger';
import {
  CreateMultiDayTaskInput,
  UpdateMultiDayTaskInput,
  AddCheckInInput,
  CheckInRecord,
  TemporalAnalysis,
} from '../validation/multi-day-task.validation';
import { ThoughtNotificationService } from './thought-notification.service';

/**
 * MultiDayTaskService
 * Manages long-running research tasks that span multiple days
 * Supports temporal cognitive diversity research
 */
export class MultiDayTaskService {
  private notificationService: ThoughtNotificationService;

  constructor(private pool: Pool) {
    this.notificationService = new ThoughtNotificationService(pool);
  }

  /**
   * Create a new multi-day research task
   * Also creates a primary conversation for task-related check-ins
   */
  async createTask(input: CreateMultiDayTaskInput) {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // 1. Create the task first
      const taskQuery = `
        INSERT INTO multi_day_research_tasks (
          user_id,
          title,
          description,
          topic_category,
          target_completion_date,
          metadata
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `;

      const metadata = {
        check_in_times: input.check_in_times,
        duration_days: input.duration_days,
        initial_context: input.initial_context,
      };

      const taskValues = [
        input.user_id,
        input.title,
        input.description || null,
        input.topic_category || null,
        input.target_completion_date || null,
        JSON.stringify(metadata),
      ];

      const taskResult = await client.query(taskQuery, taskValues);
      const task = taskResult.rows[0];

      // 2. Create a primary conversation for this task
      const conversationQuery = `
        INSERT INTO conversations (
          user_id,
          title,
          conversation_context,
          related_task_id,
          metadata
        ) VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `;

      const conversationTitle = `Task: ${input.title}`;
      const conversationMetadata = {
        task_id: task.id,
        task_title: input.title,
        conversation_purpose: 'task_check_ins',
      };

      const conversationResult = await client.query(conversationQuery, [
        input.user_id,
        conversationTitle,
        'task_check_in',
        task.id,
        JSON.stringify(conversationMetadata),
      ]);

      const conversationId = conversationResult.rows[0].id;

      // 3. Update task with conversation reference
      const updateTaskQuery = `
        UPDATE multi_day_research_tasks
        SET primary_conversation_id = $1
        WHERE id = $2
        RETURNING *
      `;

      const updatedTaskResult = await client.query(updateTaskQuery, [conversationId, task.id]);
      const finalTask = updatedTaskResult.rows[0];

      await client.query('COMMIT');

      logger.info('Multi-day research task created with conversation', {
        task_id: finalTask.id,
        conversation_id: conversationId,
        user_id: input.user_id,
        title: input.title,
        duration_days: input.duration_days,
      });

      // 4. Generate check-in notifications for this task
      try {
        await this.generateCheckInNotifications(finalTask.id, input);
        logger.info('Generated check-in notifications for task', {
          task_id: finalTask.id,
          check_in_times: input.check_in_times,
          duration_days: input.duration_days,
        });
      } catch (error: any) {
        logger.error('Failed to generate check-in notifications (non-fatal):', error);
        // Don't fail the whole task creation, just log the error
      }

      // Return task with conversation_id for iOS
      return {
        ...finalTask,
        conversation_id: conversationId,
      };
    } catch (error: any) {
      await client.query('ROLLBACK');
      logger.error('Error creating multi-day task:', error);
      throw new Error(`Failed to create multi-day task: ${error.message}`);
    } finally {
      client.release();
    }
  }

  /**
   * Generate check-in notifications for a task
   * Creates notifications for each check-in time over the duration of the task
   */
  private async generateCheckInNotifications(taskId: string, input: CreateMultiDayTaskInput) {
    const checkInTimes = input.check_in_times || ['morning', 'evening'];
    const durationDays = input.duration_days || 5;
    const startDate = new Date();

    // Time windows for each time of day
    const timeWindows: Record<string, { hour: number; minute: number }> = {
      morning: { hour: 9, minute: 0 },      // 9:00 AM
      afternoon: { hour: 14, minute: 0 },   // 2:00 PM
      evening: { hour: 19, minute: 0 },     // 7:00 PM
      late_night: { hour: 22, minute: 0 },  // 10:00 PM
    };

    const notificationsCreated: string[] = [];

    // Generate notifications for each day
    for (let day = 0; day < durationDays; day++) {
      for (const timeOfDay of checkInTimes) {
        const window = timeWindows[timeOfDay];
        if (!window) continue;

        // Calculate the scheduled time
        const scheduledDate = new Date(startDate);
        scheduledDate.setDate(scheduledDate.getDate() + day);
        scheduledDate.setHours(window.hour, window.minute, 0, 0);

        // Skip if the time has already passed
        if (scheduledDate < new Date()) {
          logger.debug('Skipping past check-in time', { scheduledDate, timeOfDay, day });
          continue;
        }

        // Create the notification
        const question = this.generateCheckInQuestion(input.title, timeOfDay, day + 1, durationDays);
        const context = `Day ${day + 1} of ${durationDays}: ${timeOfDay} check-in for "${input.title}"`;

        try {
          const notification = await this.notificationService.createNotification({
            user_id: input.user_id,
            research_task_id: taskId,
            question,
            context,
            preferred_time_of_day: timeOfDay as any,
            preferred_cognitive_state: 'any',
            priority: 0.7, // High priority for task check-ins
            expires_at: new Date(scheduledDate.getTime() + 24 * 60 * 60 * 1000).toISOString(), // Expires after 24 hours
          });

          notificationsCreated.push(notification.id);
          logger.debug('Created check-in notification', {
            task_id: taskId,
            notification_id: notification.id,
            scheduled_for: scheduledDate,
            time_of_day: timeOfDay,
            day: day + 1,
          });
        } catch (error: any) {
          logger.error('Failed to create check-in notification', {
            task_id: taskId,
            day: day + 1,
            time_of_day: timeOfDay,
            error: error.message,
          });
        }
      }
    }

    logger.info('Check-in notifications generated', {
      task_id: taskId,
      total_notifications: notificationsCreated.length,
      duration_days: durationDays,
      check_in_times: checkInTimes,
    });

    return notificationsCreated;
  }

  /**
   * Generate a contextual question for a check-in
   */
  private generateCheckInQuestion(taskTitle: string, timeOfDay: string, day: number, totalDays: number): string {
    const questions: Record<string, string[]> = {
      morning: [
        `Good morning! Let's check in on "${taskTitle}". How are you thinking about this today?`,
        `Morning check-in for "${taskTitle}". What's on your mind about this right now?`,
        `Starting day ${day}/${totalDays}. Any new thoughts on "${taskTitle}"?`,
      ],
      afternoon: [
        `Afternoon check-in for "${taskTitle}". How's your perspective on this now?`,
        `Midday reflection: What are you noticing about "${taskTitle}"?`,
      ],
      evening: [
        `Evening reflection on "${taskTitle}". How do you feel about this tonight?`,
        `End-of-day check-in: What stood out to you about "${taskTitle}" today?`,
      ],
      late_night: [
        `Late-night thoughts on "${taskTitle}"? What's coming up for you?`,
        `Quiet moment to reflect on "${taskTitle}". What's emerging?`,
      ],
    };

    const options = questions[timeOfDay] || questions.morning;
    const randomIndex = Math.floor(Math.random() * options.length);
    return options[randomIndex];
  }

  /**
   * Get a task by ID
   */
  async findById(taskId: string) {
    const query = `
      SELECT * FROM multi_day_research_tasks
      WHERE id = $1
    `;

    try {
      const result = await this.pool.query(query, [taskId]);
      return result.rows[0] || null;
    } catch (error: any) {
      logger.error('Error fetching multi-day task:', error);
      throw new Error(`Failed to fetch task: ${error.message}`);
    }
  }

  /**
   * List tasks for a user
   */
  async listByUser(
    userId: string,
    options: {
      status?: string;
      topic_category?: string;
      limit?: number;
      offset?: number;
    } = {}
  ) {
    const { status, topic_category, limit = 50, offset = 0 } = options;

    let query = `
      SELECT * FROM multi_day_research_tasks
      WHERE user_id = $1
    `;

    const values: any[] = [userId];

    if (status) {
      query += ` AND status = $${values.length + 1}`;
      values.push(status);
    }

    if (topic_category) {
      query += ` AND topic_category = $${values.length + 1}`;
      values.push(topic_category);
    }

    query += ` ORDER BY created_at DESC`;
    query += ` LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    values.push(limit, offset);

    try {
      const result = await this.pool.query(query, values);
      return result.rows;
    } catch (error: any) {
      logger.error('Error listing multi-day tasks:', error);
      throw new Error(`Failed to list tasks: ${error.message}`);
    }
  }

  /**
   * Add a check-in to a task
   */
  async addCheckIn(taskId: string, input: AddCheckInInput) {
    const task = await this.findById(taskId);

    if (!task) {
      throw new Error('Task not found');
    }

    if (task.status !== 'active') {
      throw new Error(`Cannot add check-in to ${task.status} task`);
    }

    // Get current check-ins
    const checkIns: CheckInRecord[] = task.check_ins || [];

    // Create new check-in record
    const newCheckIn: CheckInRecord = {
      check_in_number: checkIns.length + 1,
      time_of_day: input.time_of_day,
      completed_at: new Date().toISOString(),
      notification_id: input.notification_id,
      question_asked: input.question_asked,
      question_type: input.question_type,
      response: input.response,
      insights: input.insights,
      detected_state: input.detected_state,
      self_reported_energy: input.self_reported_energy,
      self_reported_mood: input.self_reported_mood,
      self_reported_focus: input.self_reported_focus,
    };

    checkIns.push(newCheckIn);

    // Update task
    const query = `
      UPDATE multi_day_research_tasks
      SET check_ins = $1,
          updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;

    try {
      const result = await this.pool.query(query, [
        JSON.stringify(checkIns),
        taskId,
      ]);

      logger.info('Check-in added to multi-day task', {
        task_id: taskId,
        check_in_number: newCheckIn.check_in_number,
        time_of_day: input.time_of_day,
      });

      return result.rows[0];
    } catch (error: any) {
      logger.error('Error adding check-in:', error);
      throw new Error(`Failed to add check-in: ${error.message}`);
    }
  }

  /**
   * Update a task
   */
  async updateTask(taskId: string, input: UpdateMultiDayTaskInput) {
    const fields: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (input.title !== undefined) {
      fields.push(`title = $${paramCount++}`);
      values.push(input.title);
    }
    if (input.description !== undefined) {
      fields.push(`description = $${paramCount++}`);
      values.push(input.description);
    }
    if (input.status !== undefined) {
      fields.push(`status = $${paramCount++}`);
      values.push(input.status);

      // If completing, set completed_at
      if (input.status === 'completed') {
        fields.push(`completed_at = NOW()`);
      }
    }
    if (input.target_completion_date !== undefined) {
      fields.push(`target_completion_date = $${paramCount++}`);
      values.push(input.target_completion_date);
    }
    if (input.final_synthesis !== undefined) {
      fields.push(`final_synthesis = $${paramCount++}`);
      values.push(input.final_synthesis);
      fields.push(`synthesis_created_at = NOW()`);
    }

    if (fields.length === 0) {
      throw new Error('No fields to update');
    }

    fields.push(`updated_at = NOW()`);

    const query = `
      UPDATE multi_day_research_tasks
      SET ${fields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    values.push(taskId);

    try {
      const result = await this.pool.query(query, values);

      if (result.rows.length === 0) {
        return null;
      }

      logger.info('Multi-day task updated', {
        id: taskId,
        fields: Object.keys(input),
      });

      return result.rows[0];
    } catch (error: any) {
      logger.error('Error updating multi-day task:', error);
      throw new Error(`Failed to update task: ${error.message}`);
    }
  }

  /**
   * Generate temporal analysis from check-ins
   * Compares insights across different times of day
   */
  generateTemporalAnalysis(checkIns: CheckInRecord[]): TemporalAnalysis {
    const morningCheckIns = checkIns.filter(c => c.time_of_day === 'morning');
    const afternoonCheckIns = checkIns.filter(c => c.time_of_day === 'afternoon');
    const eveningCheckIns = checkIns.filter(c => c.time_of_day === 'evening');
    const nightCheckIns = checkIns.filter(c => c.time_of_day === 'late_night');

    const analysis: TemporalAnalysis = {
      morning_insights: morningCheckIns.flatMap(c => c.insights),
      afternoon_insights: afternoonCheckIns.flatMap(c => c.insights),
      evening_insights: eveningCheckIns.flatMap(c => c.insights),
      late_night_insights: nightCheckIns.flatMap(c => c.insights),
      state_consistency: this.analyzeConsistency(checkIns),
      optimal_decision_time: this.determineOptimalTime(checkIns),
    };

    return analysis;
  }

  /**
   * Analyze consistency across temporal states
   */
  private analyzeConsistency(checkIns: CheckInRecord[]): string {
    // Simple heuristic: check if high-energy responses align with low-energy ones
    const highEnergyCheckIns = checkIns.filter(c => (c.self_reported_energy || 0) >= 4);
    const lowEnergyCheckIns = checkIns.filter(c => (c.self_reported_energy || 0) <= 2);

    if (highEnergyCheckIns.length === 0 || lowEnergyCheckIns.length === 0) {
      return 'Not enough data to assess consistency across energy levels';
    }

    // In real implementation, would use NLP to compare semantic similarity
    // For now, just note that we have both perspectives
    return `Collected ${highEnergyCheckIns.length} high-energy responses and ${lowEnergyCheckIns.length} low-energy responses. Compare for consistency.`;
  }

  /**
   * Determine optimal time for making this decision
   */
  private determineOptimalTime(checkIns: CheckInRecord[]): string {
    // Find time with highest average energy + focus
    const timeScores: Record<string, { total: number; count: number }> = {};

    for (const checkIn of checkIns) {
      if (!timeScores[checkIn.time_of_day]) {
        timeScores[checkIn.time_of_day] = { total: 0, count: 0 };
      }

      const energy = checkIn.self_reported_energy || 3;
      const focus = checkIn.self_reported_focus || 3;
      const score = energy + focus;

      timeScores[checkIn.time_of_day].total += score;
      timeScores[checkIn.time_of_day].count += 1;
    }

    let bestTime = 'morning';
    let bestAverage = 0;

    for (const [time, data] of Object.entries(timeScores)) {
      const average = data.total / data.count;
      if (average > bestAverage) {
        bestAverage = average;
        bestTime = time;
      }
    }

    return `Based on your energy and focus patterns, ${bestTime} appears to be your optimal time for this type of thinking (avg score: ${bestAverage.toFixed(1)}/10)`;
  }

  /**
   * Complete a task with synthesis
   */
  async completeTask(taskId: string) {
    const task = await this.findById(taskId);

    if (!task) {
      throw new Error('Task not found');
    }

    if (task.status === 'completed') {
      throw new Error('Task already completed');
    }

    const checkIns: CheckInRecord[] = task.check_ins || [];

    if (checkIns.length === 0) {
      throw new Error('Cannot complete task with no check-ins');
    }

    // Generate temporal analysis
    const temporalAnalysis = this.generateTemporalAnalysis(checkIns);

    // Build synthesis text
    const synthesis = this.buildSynthesis(task, checkIns, temporalAnalysis);

    // Update task
    return await this.updateTask(taskId, {
      status: 'completed',
      final_synthesis: synthesis,
    });
  }

  /**
   * Build final synthesis text
   */
  private buildSynthesis(task: any, checkIns: CheckInRecord[], analysis: TemporalAnalysis): string {
    let synthesis = `# ${task.title}\n\n`;
    synthesis += `## Summary\n\n`;
    synthesis += `Explored over ${checkIns.length} check-ins across ${this.getDurationDays(checkIns)} days.\n\n`;

    synthesis += `## Temporal Insights\n\n`;

    if (analysis.morning_insights.length > 0) {
      synthesis += `### Morning Perspective (Analytical/Optimistic)\n`;
      analysis.morning_insights.forEach(insight => {
        synthesis += `- ${insight}\n`;
      });
      synthesis += `\n`;
    }

    if (analysis.afternoon_insights.length > 0) {
      synthesis += `### Afternoon Perspective (Experiential/Action-Oriented)\n`;
      analysis.afternoon_insights.forEach(insight => {
        synthesis += `- ${insight}\n`;
      });
      synthesis += `\n`;
    }

    if (analysis.evening_insights.length > 0) {
      synthesis += `### Evening Perspective (Reflective/Emotional)\n`;
      analysis.evening_insights.forEach(insight => {
        synthesis += `- ${insight}\n`;
      });
      synthesis += `\n`;
    }

    if (analysis.late_night_insights.length > 0) {
      synthesis += `### Late Night Perspective (Philosophical/Dreamy)\n`;
      analysis.late_night_insights.forEach(insight => {
        synthesis += `- ${insight}\n`;
      });
      synthesis += `\n`;
    }

    synthesis += `## Analysis\n\n`;
    synthesis += `**Consistency**: ${analysis.state_consistency}\n\n`;
    synthesis += `**Optimal Decision Time**: ${analysis.optimal_decision_time}\n\n`;

    synthesis += `## Check-In Details\n\n`;
    checkIns.forEach((checkIn, index) => {
      synthesis += `### Check-In ${index + 1} (${checkIn.time_of_day})\n`;
      synthesis += `**Question**: ${checkIn.question_asked}\n\n`;
      synthesis += `**Response**: ${checkIn.response?.substring(0, 200)}...\n\n`;
      if (checkIn.self_reported_energy) {
        synthesis += `Energy: ${checkIn.self_reported_energy}/5, `;
      }
      if (checkIn.self_reported_mood) {
        synthesis += `Mood: ${checkIn.self_reported_mood}/5, `;
      }
      if (checkIn.self_reported_focus) {
        synthesis += `Focus: ${checkIn.self_reported_focus}/5`;
      }
      synthesis += `\n\n`;
    });

    return synthesis;
  }

  /**
   * Get duration in days
   */
  private getDurationDays(checkIns: CheckInRecord[]): number {
    if (checkIns.length === 0) return 0;

    const dates = checkIns
      .map(c => c.completed_at)
      .filter(d => d)
      .map(d => new Date(d!));

    if (dates.length === 0) return 0;

    const earliest = Math.min(...dates.map(d => d.getTime()));
    const latest = Math.max(...dates.map(d => d.getTime()));

    return Math.ceil((latest - earliest) / (1000 * 60 * 60 * 24)) + 1;
  }

  /**
   * Delete a task
   */
  async deleteTask(taskId: string) {
    const query = `
      DELETE FROM multi_day_research_tasks
      WHERE id = $1
      RETURNING id
    `;

    try {
      const result = await this.pool.query(query, [taskId]);

      if (result.rows.length === 0) {
        return false;
      }

      logger.info('Multi-day task deleted', { id: taskId });
      return true;
    } catch (error: any) {
      logger.error('Error deleting multi-day task:', error);
      throw new Error(`Failed to delete task: ${error.message}`);
    }
  }
}

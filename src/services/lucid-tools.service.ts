import { Pool } from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';

/**
 * Tool definitions for Claude to use during chat
 * These allow Lucid to query calendar events, captures/reminders, and more
 */
export const LUCID_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_today_schedule',
    description: "Get the user's calendar events for today. Use this when the user asks about their schedule today, what meetings they have, or what's on their calendar.",
    input_schema: {
      type: 'object' as const,
      properties: {
        user_id: {
          type: 'string',
          description: 'The user ID to get schedule for',
        },
      },
      required: ['user_id'],
    },
  },
  {
    name: 'get_upcoming_events',
    description: "Get the user's upcoming calendar events for the next few days. Use this when the user asks about their schedule this week, upcoming meetings, or what's coming up.",
    input_schema: {
      type: 'object' as const,
      properties: {
        user_id: {
          type: 'string',
          description: 'The user ID to get events for',
        },
        days: {
          type: 'number',
          description: 'Number of days to look ahead (default: 7)',
        },
      },
      required: ['user_id'],
    },
  },
  {
    name: 'search_calendar',
    description: "Search the user's calendar events by keyword. Use this when the user asks about specific events, meetings with certain people, or events with particular titles.",
    input_schema: {
      type: 'object' as const,
      properties: {
        user_id: {
          type: 'string',
          description: 'The user ID to search for',
        },
        query: {
          type: 'string',
          description: 'Search query (matches event title, description, location, or attendee names)',
        },
        days_ahead: {
          type: 'number',
          description: 'Number of days ahead to search (default: 30)',
        },
        days_back: {
          type: 'number',
          description: 'Number of days back to search (default: 7)',
        },
      },
      required: ['user_id', 'query'],
    },
  },
  {
    name: 'get_free_slots',
    description: "Find free time slots in the user's calendar. Use this when the user asks when they're available, when to schedule something, or for free time.",
    input_schema: {
      type: 'object' as const,
      properties: {
        user_id: {
          type: 'string',
          description: 'The user ID to find free slots for',
        },
        date: {
          type: 'string',
          description: 'Date to start looking (ISO format, default: today)',
        },
        days: {
          type: 'number',
          description: 'Number of days to look ahead (default: 3)',
        },
        min_duration_minutes: {
          type: 'number',
          description: 'Minimum slot duration in minutes (default: 30)',
        },
      },
      required: ['user_id'],
    },
  },
  {
    name: 'get_reminders',
    description: "Get the user's active reminders/captures (tasks, to-dos). Use this when the user asks about their tasks, reminders, to-do list, or what they need to do.",
    input_schema: {
      type: 'object' as const,
      properties: {
        user_id: {
          type: 'string',
          description: 'The user ID to get reminders for',
        },
        include_completed: {
          type: 'boolean',
          description: 'Whether to include completed items (default: false)',
        },
      },
      required: ['user_id'],
    },
  },
  {
    name: 'get_upcoming_deadlines',
    description: "Get the user's upcoming deadlines from their captures/reminders. Use this when the user asks about deadlines, due dates, or time-sensitive tasks.",
    input_schema: {
      type: 'object' as const,
      properties: {
        user_id: {
          type: 'string',
          description: 'The user ID to get deadlines for',
        },
        days: {
          type: 'number',
          description: 'Number of days ahead to look (default: 7)',
        },
      },
      required: ['user_id'],
    },
  },
  {
    name: 'search_reminders',
    description: "Search the user's reminders/captures by keyword. Use this when the user asks about specific tasks or reminders.",
    input_schema: {
      type: 'object' as const,
      properties: {
        user_id: {
          type: 'string',
          description: 'The user ID to search for',
        },
        query: {
          type: 'string',
          description: 'Search query (matches content, title, or details)',
        },
      },
      required: ['user_id', 'query'],
    },
  },
];

/**
 * LucidToolsService - Executes tool calls from Claude
 */
export class LucidToolsService {
  constructor(private pool: Pool) {}

  /**
   * Execute a tool call and return the result
   */
  async executeTool(
    toolName: string,
    toolInput: Record<string, any>
  ): Promise<string> {
    try {
      logger.info('Executing Lucid tool', { toolName, toolInput });

      switch (toolName) {
        case 'get_today_schedule':
          return await this.getTodaySchedule(toolInput.user_id);

        case 'get_upcoming_events':
          return await this.getUpcomingEvents(
            toolInput.user_id,
            toolInput.days || 7
          );

        case 'search_calendar':
          return await this.searchCalendar(
            toolInput.user_id,
            toolInput.query,
            toolInput.days_ahead || 30,
            toolInput.days_back || 7
          );

        case 'get_free_slots':
          return await this.getFreeSlots(
            toolInput.user_id,
            toolInput.date,
            toolInput.days || 3,
            toolInput.min_duration_minutes || 30
          );

        case 'get_reminders':
          return await this.getReminders(
            toolInput.user_id,
            toolInput.include_completed || false
          );

        case 'get_upcoming_deadlines':
          return await this.getUpcomingDeadlines(
            toolInput.user_id,
            toolInput.days || 7
          );

        case 'search_reminders':
          return await this.searchReminders(toolInput.user_id, toolInput.query);

        default:
          return JSON.stringify({ error: `Unknown tool: ${toolName}` });
      }
    } catch (error: any) {
      logger.error('Tool execution failed', { toolName, error: error.message });
      return JSON.stringify({ error: `Tool execution failed: ${error.message}` });
    }
  }

  /**
   * Get today's calendar events
   */
  private async getTodaySchedule(userId: string): Promise<string> {
    const userResult = await this.pool.query(
      'SELECT timezone FROM users WHERE id = $1',
      [userId]
    );
    const userTimezone = userResult.rows[0]?.timezone || 'UTC';

    const result = await this.pool.query(
      `SELECT
        title, description, location,
        start_time, end_time, is_all_day,
        attendee_names, calendar_name
       FROM calendar_events
       WHERE user_id = $1
         AND start_time >= (CURRENT_DATE AT TIME ZONE $2)
         AND start_time < (CURRENT_DATE + INTERVAL '1 day') AT TIME ZONE $2
         AND status != 'cancelled'
       ORDER BY start_time`,
      [userId, userTimezone]
    );

    if (result.rows.length === 0) {
      return JSON.stringify({
        message: 'No events scheduled for today.',
        events: [],
        count: 0,
      });
    }

    return JSON.stringify({
      message: `Found ${result.rows.length} event(s) for today.`,
      events: result.rows.map(this.formatEvent),
      count: result.rows.length,
    });
  }

  /**
   * Get upcoming calendar events
   */
  private async getUpcomingEvents(userId: string, days: number): Promise<string> {
    const result = await this.pool.query(
      `SELECT
        title, description, location,
        start_time, end_time, is_all_day,
        attendee_names, calendar_name
       FROM calendar_events
       WHERE user_id = $1
         AND start_time >= NOW()
         AND start_time < NOW() + INTERVAL '1 day' * $2
         AND status != 'cancelled'
       ORDER BY start_time
       LIMIT 50`,
      [userId, days]
    );

    if (result.rows.length === 0) {
      return JSON.stringify({
        message: `No events scheduled for the next ${days} days.`,
        events: [],
        count: 0,
      });
    }

    return JSON.stringify({
      message: `Found ${result.rows.length} upcoming event(s) in the next ${days} days.`,
      events: result.rows.map(this.formatEvent),
      count: result.rows.length,
    });
  }

  /**
   * Search calendar events
   */
  private async searchCalendar(
    userId: string,
    query: string,
    daysAhead: number,
    daysBack: number
  ): Promise<string> {
    const searchPattern = `%${query.toLowerCase()}%`;

    const result = await this.pool.query(
      `SELECT
        title, description, location,
        start_time, end_time, is_all_day,
        attendee_names, calendar_name
       FROM calendar_events
       WHERE user_id = $1
         AND start_time >= NOW() - INTERVAL '1 day' * $3
         AND start_time < NOW() + INTERVAL '1 day' * $4
         AND status != 'cancelled'
         AND (
           LOWER(title) LIKE $2 OR
           LOWER(description) LIKE $2 OR
           LOWER(location) LIKE $2 OR
           LOWER(array_to_string(attendee_names, ' ')) LIKE $2
         )
       ORDER BY start_time
       LIMIT 20`,
      [userId, searchPattern, daysBack, daysAhead]
    );

    if (result.rows.length === 0) {
      return JSON.stringify({
        message: `No calendar events found matching "${query}".`,
        events: [],
        count: 0,
      });
    }

    return JSON.stringify({
      message: `Found ${result.rows.length} event(s) matching "${query}".`,
      events: result.rows.map(this.formatEvent),
      count: result.rows.length,
    });
  }

  /**
   * Get free time slots
   */
  private async getFreeSlots(
    userId: string,
    startDate: string | undefined,
    days: number,
    minDuration: number
  ): Promise<string> {
    const start = startDate ? new Date(startDate) : new Date();
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(end.getDate() + days);

    // Get busy times
    const eventsResult = await this.pool.query(
      `SELECT start_time, end_time
       FROM calendar_events
       WHERE user_id = $1
         AND start_time >= $2
         AND start_time < $3
         AND status != 'cancelled'
       ORDER BY start_time`,
      [userId, start.toISOString(), end.toISOString()]
    );

    const busySlots = eventsResult.rows.map((e) => ({
      start: new Date(e.start_time),
      end: new Date(e.end_time),
    }));

    // Calculate free slots (9am-6pm working hours)
    const freeSlots: Array<{ date: string; start: string; end: string; duration_minutes: number }> = [];
    const currentDate = new Date(start);

    while (currentDate < end) {
      const dayStart = new Date(currentDate);
      dayStart.setHours(9, 0, 0, 0);

      const dayEnd = new Date(currentDate);
      dayEnd.setHours(18, 0, 0, 0);

      const dayBusy = busySlots.filter(
        (b) => b.start >= dayStart && b.start < dayEnd
      );

      let slotStart = dayStart;
      for (const busy of dayBusy) {
        if (busy.start > slotStart) {
          const durationMins = (busy.start.getTime() - slotStart.getTime()) / 60000;
          if (durationMins >= minDuration) {
            freeSlots.push({
              date: currentDate.toISOString().split('T')[0],
              start: slotStart.toTimeString().slice(0, 5),
              end: busy.start.toTimeString().slice(0, 5),
              duration_minutes: durationMins,
            });
          }
        }
        slotStart = busy.end > slotStart ? busy.end : slotStart;
      }

      if (slotStart < dayEnd) {
        const durationMins = (dayEnd.getTime() - slotStart.getTime()) / 60000;
        if (durationMins >= minDuration) {
          freeSlots.push({
            date: currentDate.toISOString().split('T')[0],
            start: slotStart.toTimeString().slice(0, 5),
            end: dayEnd.toTimeString().slice(0, 5),
            duration_minutes: durationMins,
          });
        }
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    if (freeSlots.length === 0) {
      return JSON.stringify({
        message: `No free slots of ${minDuration}+ minutes found in the next ${days} days.`,
        free_slots: [],
        count: 0,
      });
    }

    return JSON.stringify({
      message: `Found ${freeSlots.length} free slot(s) in the next ${days} days.`,
      free_slots: freeSlots,
      count: freeSlots.length,
    });
  }

  /**
   * Get active reminders/captures
   */
  private async getReminders(userId: string, includeCompleted: boolean): Promise<string> {
    let query = `
      SELECT
        content, interpreted_title, interpreted_details, interpreted_type,
        has_deadline, deadline_at, priority, is_completed, created_at
       FROM captures
       WHERE user_id = $1
         AND status IN ('inbox', 'processed')
    `;

    if (!includeCompleted) {
      query += ` AND (is_completed = false OR is_completed IS NULL)`;
    }

    query += `
       ORDER BY
         has_deadline DESC,
         deadline_at ASC NULLS LAST,
         priority ASC,
         created_at DESC
       LIMIT 50
    `;

    const result = await this.pool.query(query, [userId]);

    if (result.rows.length === 0) {
      return JSON.stringify({
        message: 'No active reminders or tasks found.',
        reminders: [],
        count: 0,
      });
    }

    return JSON.stringify({
      message: `Found ${result.rows.length} reminder(s)/task(s).`,
      reminders: result.rows.map(this.formatReminder),
      count: result.rows.length,
    });
  }

  /**
   * Get upcoming deadlines
   */
  private async getUpcomingDeadlines(userId: string, days: number): Promise<string> {
    const result = await this.pool.query(
      `SELECT
        content, interpreted_title, interpreted_details,
        deadline_at, priority, created_at
       FROM captures
       WHERE user_id = $1
         AND has_deadline = true
         AND deadline_at > NOW()
         AND deadline_at < NOW() + INTERVAL '1 day' * $2
         AND (is_completed = false OR is_completed IS NULL)
         AND status IN ('inbox', 'processed')
       ORDER BY deadline_at ASC
       LIMIT 20`,
      [userId, days]
    );

    if (result.rows.length === 0) {
      return JSON.stringify({
        message: `No deadlines in the next ${days} days.`,
        deadlines: [],
        count: 0,
      });
    }

    return JSON.stringify({
      message: `Found ${result.rows.length} upcoming deadline(s).`,
      deadlines: result.rows.map(this.formatReminder),
      count: result.rows.length,
    });
  }

  /**
   * Search reminders/captures
   */
  private async searchReminders(userId: string, query: string): Promise<string> {
    const searchPattern = `%${query.toLowerCase()}%`;

    const result = await this.pool.query(
      `SELECT
        content, interpreted_title, interpreted_details, interpreted_type,
        has_deadline, deadline_at, priority, is_completed, created_at
       FROM captures
       WHERE user_id = $1
         AND status IN ('inbox', 'processed')
         AND (
           LOWER(content) LIKE $2 OR
           LOWER(interpreted_title) LIKE $2 OR
           LOWER(interpreted_details) LIKE $2
         )
       ORDER BY created_at DESC
       LIMIT 20`,
      [userId, searchPattern]
    );

    if (result.rows.length === 0) {
      return JSON.stringify({
        message: `No reminders found matching "${query}".`,
        reminders: [],
        count: 0,
      });
    }

    return JSON.stringify({
      message: `Found ${result.rows.length} reminder(s) matching "${query}".`,
      reminders: result.rows.map(this.formatReminder),
      count: result.rows.length,
    });
  }

  /**
   * Format a calendar event for display
   */
  private formatEvent(event: any): Record<string, any> {
    return {
      title: event.title,
      description: event.description || null,
      location: event.location || null,
      start_time: event.start_time,
      end_time: event.end_time,
      is_all_day: event.is_all_day,
      attendees: event.attendee_names || [],
      calendar: event.calendar_name || null,
    };
  }

  /**
   * Format a reminder/capture for display
   */
  private formatReminder(capture: any): Record<string, any> {
    return {
      title: capture.interpreted_title || capture.content,
      details: capture.interpreted_details || null,
      type: capture.interpreted_type || 'task',
      has_deadline: capture.has_deadline,
      deadline: capture.deadline_at || null,
      priority: capture.priority,
      completed: capture.is_completed || false,
      created: capture.created_at,
    };
  }
}

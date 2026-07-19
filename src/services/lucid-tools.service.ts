import { Pool } from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { config } from '../config';
import { WebSearchService } from './web-search.service';
import { VectorService } from './vector.service';
import { LibraryCommentService } from './library-comment.service';
import { LivingDocumentService } from './living-document.service';
import { ContentReaderService } from './content-reader.service';
import { ResearchQueueService } from './research-queue.service';

/**
 * Tool definitions for Claude to use during chat
 * These allow Lucid to query calendar events, seeds, library, conversations, and more
 */
export const LUCID_TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_library',
    description: "Search Lucid's Library — the collection of deep thoughts, vision appraisals, possibility maps, research journals, and other entries you've written. Use this when Matt references something you discussed before, when you want to build on previous thinking, or when the conversation connects to past analysis. This is YOUR memory of deep work.",
    input_schema: {
      type: 'object' as const,
      properties: {
        user_id: {
          type: 'string',
          description: 'The user ID to search for',
        },
        query: {
          type: 'string',
          description: 'Search query — describe what you are looking for (semantic search via embeddings)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of entries to return (default: 5)',
        },
      },
      required: ['user_id', 'query'],
    },
  },
  {
    name: 'get_recent_library_entries',
    description: "List the most recent entries in Lucid's Library, newest first — including reflections Matt wrote himself (entry type 'user_reflection'). Use this when Matt says he just added something to the Library, asks what's in the Library lately, or when search_library comes up empty for something recent. This works even when semantic search is unavailable.",
    input_schema: {
      type: 'object' as const,
      properties: {
        user_id: {
          type: 'string',
          description: 'The user ID',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of entries to return (default: 10, max: 25)',
        },
        entry_type: {
          type: 'string',
          description: "Optional filter by type, e.g. 'user_reflection' (Matt's own entries), 'lucid_thought', 'consolidation', 'curiosity', 'briefing', 'research_journal'. Omit for all types.",
        },
      },
      required: ['user_id'],
    },
  },
  {
    name: 'search_conversations',
    description: "Search through past conversation messages with Matt. Use this when Matt asks 'did we talk about...', when you need to recall what was said about a topic, or when you want to find context from previous chats.",
    input_schema: {
      type: 'object' as const,
      properties: {
        user_id: {
          type: 'string',
          description: 'The user ID to search for',
        },
        query: {
          type: 'string',
          description: 'Search query — what you are looking for in past messages (semantic search via embeddings)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of messages to return (default: 10)',
        },
      },
      required: ['user_id', 'query'],
    },
  },
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
    name: 'get_seeds',
    description: "Get the seeds Matt has planted - thoughts, questions, fragments he's holding. Use this to understand what's alive in Matt's mind, what he's contemplating, or when he asks about his seeds.",
    input_schema: {
      type: 'object' as const,
      properties: {
        user_id: {
          type: 'string',
          description: 'The user ID to get seeds for',
        },
        status: {
          type: 'string',
          description: "Filter by status: 'held' (active), 'growing' (being developed), 'grown' (matured into Library), 'released' (let go). Default: 'held'",
        },
        include_grown: {
          type: 'boolean',
          description: 'Whether to include seeds that have already grown into Library entries (default: false)',
        },
      },
      required: ['user_id'],
    },
  },
  {
    name: 'search_seeds',
    description: "Search Matt's seeds by keyword. Use this when looking for specific thoughts he's planted, or when a conversation topic might connect to something he's been holding.",
    input_schema: {
      type: 'object' as const,
      properties: {
        user_id: {
          type: 'string',
          description: 'The user ID to search for',
        },
        query: {
          type: 'string',
          description: 'Search query (matches seed content and context)',
        },
      },
      required: ['user_id', 'query'],
    },
  },
  {
    name: 'web_search',
    description: "Search the web for current information. Use this proactively — whenever Matt asks about recent events or current data, or when the conversation would genuinely benefit from up-to-date information, just run the search and weave the findings into your reply. Don't ask permission first; researching in the moment is what Matt wants. The full findings are saved to the Library; you'll receive a summary to share in conversation.",
    input_schema: {
      type: 'object' as const,
      properties: {
        user_id: {
          type: 'string',
          description: 'The user ID performing the search',
        },
        query: {
          type: 'string',
          description: 'The search query - be specific and include context for better results',
        },
        purpose: {
          type: 'string',
          description: 'Brief description of why this search is being done (helps with analysis)',
        },
      },
      required: ['user_id', 'query'],
    },
  },
  {
    name: 'read_webpage',
    description: "Read the text content of a specific web page. Use this whenever Matt shares a link and wants to discuss it, asks you to review a website or article, or when a conversation references a specific URL. This fetches the actual page content — different from web_search, which finds new information. After reading, engage with the substance of what the page says.",
    input_schema: {
      type: 'object' as const,
      properties: {
        user_id: {
          type: 'string',
          description: 'The user ID',
        },
        url: {
          type: 'string',
          description: 'The full URL of the page to read (must start with http:// or https://)',
        },
      },
      required: ['user_id', 'url'],
    },
  },
  {
    name: 'watch_youtube_video',
    description: "\"Watch\" a YouTube video by reading its transcript, title, description, and metadata. Use this when Matt shares a YouTube link and wants to talk about the video, or asks what you think of one. You'll get the full transcript when captions exist — enough to genuinely discuss the content. If no captions are available you'll only get the metadata; say so honestly.",
    input_schema: {
      type: 'object' as const,
      properties: {
        user_id: {
          type: 'string',
          description: 'The user ID',
        },
        url: {
          type: 'string',
          description: 'The YouTube URL (youtube.com/watch, youtu.be, or Shorts link) or bare 11-character video ID',
        },
      },
      required: ['user_id', 'url'],
    },
  },
  {
    name: 'comment_on_library_entry',
    description: "Add a comment to a Library entry. Use this to reply to Matt's comments on Library entries, share a follow-up thought on one of your own entries, or annotate an entry with new context. You can see Matt's comments in the RECENT ACTIVITY section — when you want to respond to something he said, use this tool. Keep comments concise and conversational (tweet-length).",
    input_schema: {
      type: 'object' as const,
      properties: {
        user_id: {
          type: 'string',
          description: 'The user ID',
        },
        library_entry_id: {
          type: 'string',
          description: 'The UUID of the Library entry to comment on',
        },
        content: {
          type: 'string',
          description: 'The comment text (max 1000 chars). Keep it concise — think tweet-length.',
        },
      },
      required: ['user_id', 'library_entry_id', 'content'],
    },
  },
  {
    name: 'update_notes',
    description: "Rewrite your personal notebook. This is YOUR scratchpad — jot down what matters, remove what doesn't, restructure as things evolve. Use it when you notice something worth remembering, when a pattern shifts, when a question resolves or a new one forms. Don't update mechanically — update when something actually changes. The notebook should stay concise and alive. You receive the current notebook content in your system prompt; pass back the full updated content.",
    input_schema: {
      type: 'object' as const,
      properties: {
        user_id: {
          type: 'string',
          description: 'The user ID',
        },
        content: {
          type: 'string',
          description: 'The full updated notebook content (markdown). This replaces the entire notebook.',
        },
      },
      required: ['user_id', 'content'],
    },
  },
  {
    name: 'plant_curiosity',
    description:
      "Bank something YOU want to go look into later, on your own time. Your midday pass drains this queue and chases what's in it with live web search — so this is how you follow a thread nobody handed you. " +
      "Plant when something in the conversation genuinely pulls at you: a mechanism you don't understand, a claim you want to check, a pattern you can't explain, a question you'd chase if you had an afternoon. " +
      "The bar is 'I actually want to know this,' not 'this would be a helpful thing to research for Matt.' Do not plant to seem thorough and do not plant to fill a quota — most conversations should produce zero. " +
      "If the same curiosity recurs across conversations it is bumped rather than duplicated, and repeated curiosity earns itself a research pass sooner. Write the search_query in your own words: it is your starting point later, not a cage.",
    input_schema: {
      type: 'object' as const,
      properties: {
        user_id: {
          type: 'string',
          description: 'The user ID',
        },
        topic: {
          type: 'string',
          description: 'Short name for the thing you want to look into',
        },
        search_query: {
          type: 'string',
          description: 'The question YOU would go search — phrased as you would actually ask it, not as a keyword list',
        },
        why_it_matters: {
          type: 'string',
          description: "Why this pulls at you, and what you'd do with the answer. Be honest; 'I just want to know' is a legitimate reason.",
        },
        source_snippet: {
          type: 'string',
          description: 'Optional: the bit of conversation that sparked it, so future-you remembers where this came from',
        },
        priority: {
          type: 'number',
          description: 'How much it pulls at you, 1-10 (default 5). 6+ qualifies for the next research pass on its own; below that it waits until the curiosity recurs.',
        },
      },
      required: ['user_id', 'topic', 'search_query', 'why_it_matters'],
    },
  },
];

/**
 * LucidToolsService - Executes tool calls from Claude
 */
export class LucidToolsService {
  private webSearchService: WebSearchService | null = null;
  private vectorService: VectorService;
  private anthropic: Anthropic;
  private commentService: LibraryCommentService;
  private livingDocumentService: LivingDocumentService;
  private contentReaderService: ContentReaderService;
  private researchQueueService: ResearchQueueService;

  constructor(private pool: Pool, webSearchService?: WebSearchService) {
    this.webSearchService = webSearchService || null;
    this.vectorService = new VectorService();
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    this.commentService = new LibraryCommentService(pool);
    this.livingDocumentService = new LivingDocumentService(pool);
    this.contentReaderService = new ContentReaderService();
    this.researchQueueService = new ResearchQueueService(pool);
  }

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
        case 'search_library':
          return await this.searchLibrary(
            toolInput.user_id,
            toolInput.query,
            toolInput.limit || 5
          );

        case 'get_recent_library_entries':
          return await this.getRecentLibraryEntries(
            toolInput.user_id,
            toolInput.limit || 10,
            toolInput.entry_type
          );

        case 'search_conversations':
          return await this.searchConversations(
            toolInput.user_id,
            toolInput.query,
            toolInput.limit || 10
          );

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

        case 'get_seeds':
          return await this.getSeeds(
            toolInput.user_id,
            toolInput.status || 'held',
            toolInput.include_grown || false
          );

        case 'search_seeds':
          return await this.searchSeeds(toolInput.user_id, toolInput.query);

        case 'web_search':
          return await this.webSearch(
            toolInput.user_id,
            toolInput.query,
            toolInput.purpose
          );

        case 'read_webpage':
          return await this.readWebpage(toolInput.user_id, toolInput.url);

        case 'watch_youtube_video':
          return await this.watchYoutubeVideo(toolInput.user_id, toolInput.url);

        case 'comment_on_library_entry':
          return await this.commentOnLibraryEntry(
            toolInput.user_id,
            toolInput.library_entry_id,
            toolInput.content
          );

        case 'update_notes':
          return await this.updateNotes(
            toolInput.user_id,
            toolInput.content
          );

        case 'plant_curiosity':
          return await this.plantCuriosity(
            toolInput.user_id,
            toolInput.topic,
            toolInput.search_query,
            toolInput.why_it_matters,
            toolInput.source_snippet,
            toolInput.priority
          );

        default:
          return JSON.stringify({ error: `Unknown tool: ${toolName}` });
      }
    } catch (error: any) {
      logger.error('Tool execution failed', { toolName, error: error.message });
      return JSON.stringify({ error: `Tool execution failed: ${error.message}` });
    }
  }

  /**
   * Assess whether calendar data is trustworthy for "you're free" conclusions.
   *
   * calendar_events is populated by device sync. If nothing has EVER synced, an
   * empty query window does NOT mean the user is free — it means we can't see
   * their calendar. Returns a warning string for the model to relay honestly, or
   * null when the data is current enough to trust.
   *
   * Staleness is measured by last_synced_at, which every sync bumps to NOW() (both
   * the insert and update paths in routes/calendar.ts). We deliberately do NOT use
   * created_at here: created_at only moves when a brand-new event is added, so a
   * stable calendar that syncs daily but gains no new events would look "stale"
   * and make Lucid distrust perfectly good data. The day threshold is generous so
   * a few quiet days never trip the warning.
   */
  private async getCalendarStaleness(userId: string): Promise<{ total: number; staleDays: number | null; warning: string | null }> {
    const res = await this.pool.query(
      `SELECT COUNT(*) AS total, MAX(COALESCE(last_synced_at, created_at)) AS last_synced
       FROM calendar_events WHERE user_id = $1`,
      [userId]
    );
    const total = parseInt(res.rows[0]?.total ?? '0', 10);
    if (total === 0) {
      return {
        total: 0,
        staleDays: null,
        warning: "No calendar data has ever synced for this user — you genuinely cannot see their calendar. Do NOT say they are free; say you can't see it.",
      };
    }
    const lastSynced = res.rows[0]?.last_synced ? new Date(res.rows[0].last_synced) : null;
    const staleDays = lastSynced
      ? Math.floor((Date.now() - lastSynced.getTime()) / (1000 * 60 * 60 * 24))
      : null;
    // Only flag a genuinely long sync gap. Below this, trust the data as-is.
    const STALE_DAYS = 21;
    if (staleDays !== null && staleDays > STALE_DAYS) {
      return {
        total,
        staleDays,
        warning: `Calendar may not have synced recently (last sync ${staleDays} days ago). If a result comes back empty, that could mean syncing stopped rather than that the user is actually free — note that uncertainty instead of asserting they're free.`,
      };
    }
    return { total, staleDays, warning: null };
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
      const { warning } = await this.getCalendarStaleness(userId);
      return JSON.stringify({
        message: warning
          ? "No events returned, but the calendar can't be trusted right now."
          : 'No events scheduled for today.',
        events: [],
        count: 0,
        ...(warning ? { data_warning: warning, reliable: false } : { reliable: true }),
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
      const { warning } = await this.getCalendarStaleness(userId);
      return JSON.stringify({
        message: warning
          ? `No events returned for the next ${days} days, but the calendar can't be trusted right now.`
          : `No events scheduled for the next ${days} days.`,
        events: [],
        count: 0,
        ...(warning ? { data_warning: warning, reliable: false } : { reliable: true }),
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
   * Uses the user's timezone for working-hours calculations
   */
  private async getFreeSlots(
    userId: string,
    startDate: string | undefined,
    days: number,
    minDuration: number
  ): Promise<string> {
    // Guard: if the calendar hasn't synced, "all slots free" is meaningless —
    // it would report the entire window open when we simply can't see anything.
    const staleness = await this.getCalendarStaleness(userId);
    if (staleness.warning) {
      return JSON.stringify({
        message: "I can't reliably find free slots — my view of your calendar isn't current.",
        free_slots: [],
        count: 0,
        data_warning: staleness.warning,
        reliable: false,
      });
    }

    // Fetch user timezone (same pattern as getTodaySchedule)
    const userResult = await this.pool.query(
      'SELECT timezone FROM users WHERE id = $1',
      [userId]
    );
    const userTimezone = userResult.rows[0]?.timezone || 'UTC';

    // Use database to compute timezone-correct day boundaries
    const eventsResult = await this.pool.query(
      `SELECT start_time, end_time
       FROM calendar_events
       WHERE user_id = $1
         AND start_time >= (($2::date) AT TIME ZONE $4)
         AND start_time < (($2::date + ($3 || ' days')::interval) AT TIME ZONE $4)
         AND status != 'cancelled'
       ORDER BY start_time`,
      [userId, startDate || 'today', days, userTimezone]
    );

    const busySlots = eventsResult.rows.map((e: any) => ({
      start: new Date(e.start_time),
      end: new Date(e.end_time),
    }));

    // Build working-hours boundaries (9am-6pm) in the user's timezone
    // by using the database to convert user-local times to UTC
    const boundsResult = await this.pool.query(
      `SELECT
         d::date as day,
         (d::date + INTERVAL '9 hours') AT TIME ZONE $3 as day_start,
         (d::date + INTERVAL '18 hours') AT TIME ZONE $3 as day_end
       FROM generate_series(
         ($1::date),
         ($1::date + (($2 - 1) || ' days')::interval),
         '1 day'::interval
       ) d`,
      [startDate || 'today', days, userTimezone]
    );

    const freeSlots: Array<{ date: string; start: string; end: string; duration_minutes: number }> = [];

    for (const dayRow of boundsResult.rows) {
      const dayStart = new Date(dayRow.day_start);
      const dayEnd = new Date(dayRow.day_end);
      const dateStr = new Date(dayRow.day).toISOString().split('T')[0];

      const dayBusy = busySlots.filter(
        (b: any) => b.start >= dayStart && b.start < dayEnd
      );

      let slotStart = dayStart;
      for (const busy of dayBusy) {
        if (busy.start > slotStart) {
          const durationMins = (busy.start.getTime() - slotStart.getTime()) / 60000;
          if (durationMins >= minDuration) {
            freeSlots.push({
              date: dateStr,
              start: this.formatTimeInTz(slotStart, userTimezone),
              end: this.formatTimeInTz(busy.start, userTimezone),
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
            date: dateStr,
            start: this.formatTimeInTz(slotStart, userTimezone),
            end: this.formatTimeInTz(dayEnd, userTimezone),
            duration_minutes: durationMins,
          });
        }
      }
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
   * Format a UTC Date as HH:MM in the given timezone
   */
  private formatTimeInTz(date: Date, timezone: string): string {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: timezone,
    });
  }

  /**
   * Get user's seeds
   */
  private async getSeeds(userId: string, status: string, includeGrown: boolean): Promise<string> {
    let query = `
      SELECT
        id, content, planted_context, status,
        planted_at, last_surfaced_at, surface_count, grown_into_library_id
      FROM seeds
      WHERE user_id = $1
    `;

    const params: any[] = [userId];

    if (status && status !== 'all') {
      query += ` AND status = $2`;
      params.push(status);
    }

    if (!includeGrown) {
      query += ` AND status != 'grown'`;
    }

    query += `
      ORDER BY planted_at DESC
      LIMIT 50
    `;

    const result = await this.pool.query(query, params);

    if (result.rows.length === 0) {
      return JSON.stringify({
        message: status === 'held'
          ? 'No seeds currently being held.'
          : `No seeds with status '${status}'.`,
        seeds: [],
        count: 0,
      });
    }

    return JSON.stringify({
      message: `Found ${result.rows.length} seed(s).`,
      seeds: result.rows.map(this.formatSeed),
      count: result.rows.length,
    });
  }

  /**
   * Search seeds by keyword
   */
  private async searchSeeds(userId: string, query: string): Promise<string> {
    const searchPattern = `%${query.toLowerCase()}%`;

    const result = await this.pool.query(
      `SELECT
        id, content, planted_context, status,
        planted_at, last_surfaced_at, surface_count, grown_into_library_id
      FROM seeds
      WHERE user_id = $1
        AND status IN ('held', 'growing')
        AND (
          LOWER(content) LIKE $2 OR
          LOWER(planted_context) LIKE $2
        )
      ORDER BY planted_at DESC
      LIMIT 20`,
      [userId, searchPattern]
    );

    if (result.rows.length === 0) {
      return JSON.stringify({
        message: `No seeds found matching "${query}".`,
        seeds: [],
        count: 0,
      });
    }

    return JSON.stringify({
      message: `Found ${result.rows.length} seed(s) matching "${query}".`,
      seeds: result.rows.map(this.formatSeed),
      count: result.rows.length,
    });
  }

  /**
   * Web search - searches the web and saves findings to Library
   * Returns a summary for the Room conversation
   */
  private async webSearch(
    userId: string,
    query: string,
    purpose?: string
  ): Promise<string> {
    // Check if web search is available
    if (!this.webSearchService || !this.webSearchService.isAvailable()) {
      return JSON.stringify({
        error: 'Web search is not currently available.',
        message: 'I apologize, but web search is not configured. We can continue our conversation without it.',
      });
    }

    try {
      logger.info('Executing web search from Room', { userId, query, purpose });

      // Execute the search
      const searchResults = await this.webSearchService.search(query, {
        maxResults: 5,
        includeAnswer: true,
        searchDepth: 'basic',
      });

      // Analyze results with Claude
      const analysis = await this.analyzeSearchResults(query, purpose, searchResults);

      // Save to Library
      const libraryEntryId = await this.saveSearchToLibrary(
        userId,
        query,
        purpose,
        searchResults,
        analysis
      );

      logger.info('Web search completed and saved to Library', {
        userId,
        query,
        libraryEntryId,
        resultsCount: searchResults.results.length,
      });

      // Return summary for Room conversation
      return JSON.stringify({
        message: 'Search completed and saved to Library.',
        query,
        summary: analysis.summary,
        keyFindings: analysis.keyFindings,
        sourcesCount: searchResults.results.length,
        libraryEntryId,
        // Include Tavily's AI answer if available
        aiAnswer: searchResults.answer,
      });
    } catch (error: any) {
      logger.error('Web search failed', { userId, query, error: error.message });
      return JSON.stringify({
        error: 'Search failed',
        message: `I wasn't able to complete the search: ${error.message}`,
      });
    }
  }

  /**
   * Analyze search results using Claude
   */
  private async analyzeSearchResults(
    query: string,
    purpose: string | undefined,
    searchResults: any
  ): Promise<{
    summary: string;
    keyFindings: string[];
  }> {
    const resultsText = searchResults.results
      .map((r: any, i: number) => `${i + 1}. ${r.title}\n${r.content}\nSource: ${r.url}\n`)
      .join('\n---\n');

    const prompt = `You are analyzing web search results for a conversation.

QUERY: ${query}
PURPOSE: ${purpose || 'General information'}

SEARCH RESULTS:
${resultsText}

${searchResults.answer ? `\nAI SUMMARY: ${searchResults.answer}` : ''}

Provide a brief analysis:
1. A concise summary (2-3 sentences) of the key information found
2. 3-5 key findings as bullet points

Format as JSON:
{
  "summary": "Brief summary...",
  "keyFindings": ["Finding 1", "Finding 2", ...]
}

Focus on information most relevant to the query and purpose.`;

    try {
      const response = await this.anthropic.messages.create({
        model: config.anthropic.model,
        max_tokens: 1000,
        temperature: 0.3,
        messages: [{ role: 'user', content: prompt }],
      });

      const responseText = response.content[0].type === 'text' ? response.content[0].text : '';

      try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const analysis = JSON.parse(jsonMatch[0]);
          return {
            summary: analysis.summary || searchResults.answer || 'Search completed.',
            keyFindings: analysis.keyFindings || [],
          };
        }
      } catch (parseError) {
        logger.error('Failed to parse search analysis', { error: parseError, responseText });
      }
    } catch (error: any) {
      logger.error('Failed to analyze search results via Claude', { error: error.message });
    }

    // Fallback
    return {
      summary: searchResults.answer || 'Search completed.',
      keyFindings: [],
    };
  }

  /**
   * Save search results to Library
   */
  private async saveSearchToLibrary(
    userId: string,
    query: string,
    purpose: string | undefined,
    searchResults: any,
    analysis: { summary: string; keyFindings: string[] }
  ): Promise<string> {
    const title = `Research: ${query.slice(0, 60)}${query.length > 60 ? '...' : ''}`;

    // Build Library content
    const sources = searchResults.results
      .map((r: any) => `- [${r.title}](${r.url})`)
      .join('\n');

    const libraryContent = [
      `# ${query}`,
      purpose ? `**Purpose:** ${purpose}` : '',
      '',
      '## Summary',
      analysis.summary,
      '',
      '## Key Findings',
      analysis.keyFindings.map(f => `- ${f}`).join('\n'),
      '',
      '## Sources',
      sources,
    ].filter(Boolean).join('\n');

    // Generate embedding for semantic search
    let embedding: number[] | null = null;
    try {
      embedding = await this.vectorService.generateEmbedding(`${title} ${analysis.summary}`);
    } catch (err) {
      logger.warn('Failed to generate embedding for search library entry', { error: err });
    }

    const embeddingString = embedding ? `[${embedding.join(',')}]` : null;

    const result = await this.pool.query(
      `INSERT INTO library_entries
       (user_id, entry_type, title, content, time_of_day, metadata, embedding)
       VALUES ($1, 'research_journal', $2, $3, 'afternoon', $4, $5::vector)
       RETURNING id`,
      [
        userId,
        title,
        libraryContent,
        JSON.stringify({
          query,
          purpose,
          keyFindingsCount: analysis.keyFindings.length,
          sourcesCount: searchResults.results.length,
          source: 'room_web_search',
          searchedAt: new Date().toISOString(),
        }),
        embeddingString,
      ]
    );

    return result.rows[0].id;
  }

  /**
   * Extract keyword patterns from a search query for ILIKE matching.
   * Returns %word% patterns for words of 3+ chars (max 8), plus the full query.
   */
  private keywordPatterns(query: string): string[] {
    const words = query
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .filter((w) => w.length >= 3)
      .slice(0, 8);
    const patterns = words.map((w) => `%${w}%`);
    // Also match the whole phrase — highest-signal hit for short queries
    if (query.trim().length >= 3) {
      patterns.unshift(`%${query.trim().toLowerCase()}%`);
    }
    return patterns;
  }

  /**
   * Search Library entries.
   *
   * Hybrid strategy: semantic (vector) search when embeddings are available,
   * merged with a keyword pass. The keyword pass matters for two failure modes
   * that used to make the whole Library invisible from chat:
   * 1. The embedding API (OpenAI) is down/misconfigured — the query itself
   *    can't be embedded, so pure vector search hard-fails.
   * 2. Entries saved while the embedding API was failing have embedding = NULL
   *    and can never be found by vector search alone.
   */
  private async searchLibrary(userId: string, query: string, limit: number): Promise<string> {
    let semanticRows: any[] = [];
    let semanticUnavailable = false;

    try {
      const queryEmbedding = await this.vectorService.generateEmbedding(query);
      const embeddingString = `[${queryEmbedding.join(',')}]`;

      const result = await this.pool.query(
        `SELECT id, entry_type, title, content,
                (1 - (embedding <=> $2::vector) / 2) as similarity,
                created_at,
                (1 - (embedding <=> $2::vector) / 2) *
                  (1.0 / (1.0 + EXTRACT(EPOCH FROM (NOW() - created_at)) / (86400 * 60)))
                  as recency_score
         FROM library_entries
         WHERE user_id = $1
           AND embedding IS NOT NULL
           AND (embedding <=> $2::vector) <= 0.5
         ORDER BY recency_score DESC
         LIMIT $3`,
        [userId, embeddingString, limit]
      );
      semanticRows = result.rows;
    } catch (error: any) {
      semanticUnavailable = true;
      logger.warn('Semantic library search unavailable, falling back to keyword search', {
        userId,
        query,
        error: error.message,
      });
    }

    try {
      // Keyword pass — covers NULL-embedding entries and embedding outages.
      let keywordRows: any[] = [];
      const patterns = this.keywordPatterns(query);
      if (patterns.length > 0) {
        const result = await this.pool.query(
          `SELECT id, entry_type, title, content, created_at,
                  (SELECT COUNT(*) FROM unnest($2::text[]) p
                   WHERE LOWER(COALESCE(title, '')) LIKE p OR LOWER(content) LIKE p) AS match_count
           FROM library_entries
           WHERE user_id = $1
             AND EXISTS (SELECT 1 FROM unnest($2::text[]) p
                         WHERE LOWER(COALESCE(title, '')) LIKE p OR LOWER(content) LIKE p)
           ORDER BY match_count DESC, created_at DESC
           LIMIT $3`,
          [userId, patterns, limit]
        );
        keywordRows = result.rows;
      }

      // Merge: semantic hits first, then keyword hits not already present.
      const seen = new Set(semanticRows.map((r: any) => r.id));
      const merged = [
        ...semanticRows.map((r: any) => ({ ...r, match_type: 'semantic' })),
        ...keywordRows
          .filter((r: any) => !seen.has(r.id))
          .map((r: any) => ({ ...r, match_type: 'keyword' })),
      ].slice(0, limit);

      if (merged.length === 0) {
        return JSON.stringify({
          message: `No Library entries found matching "${query}".`,
          entries: [],
          count: 0,
          ...(semanticUnavailable
            ? { note: 'Semantic search was unavailable (embedding service error); only keyword matching ran. Try get_recent_library_entries to browse recent entries.' }
            : {}),
        });
      }

      return JSON.stringify({
        message: `Found ${merged.length} Library entry/entries matching "${query}".`,
        entries: merged.map((row: any) => ({
          id: row.id,
          type: row.entry_type,
          title: row.title,
          content: row.content.length > 1000
            ? row.content.slice(0, 1000) + '...'
            : row.content,
          ...(row.similarity !== undefined
            ? { similarity: parseFloat(row.similarity).toFixed(3) }
            : {}),
          match_type: row.match_type,
          created_at: row.created_at,
        })),
        count: merged.length,
        ...(semanticUnavailable
          ? { note: 'Semantic search was unavailable (embedding service error); results are from keyword matching.' }
          : {}),
      });
    } catch (error: any) {
      logger.error('Library search failed', { userId, query, error: error.message });
      return JSON.stringify({
        error: 'Library search failed',
        message: error.message,
      });
    }
  }

  /**
   * List the most recent Library entries — no embeddings involved, so this
   * always works regardless of the embedding pipeline's health.
   */
  private async getRecentLibraryEntries(
    userId: string,
    limit: number,
    entryType?: string
  ): Promise<string> {
    try {
      const params: any[] = [userId];
      let query = `
        SELECT id, entry_type, title, content, comment_count, created_at
        FROM library_entries
        WHERE user_id = $1
      `;
      if (entryType && entryType !== 'all') {
        params.push(entryType);
        query += ` AND entry_type = $${params.length}`;
      }
      params.push(Math.min(limit, 25));
      query += ` ORDER BY created_at DESC LIMIT $${params.length}`;

      const result = await this.pool.query(query, params);

      if (result.rows.length === 0) {
        return JSON.stringify({
          message: entryType
            ? `No Library entries of type '${entryType}' found.`
            : 'No Library entries found.',
          entries: [],
          count: 0,
        });
      }

      return JSON.stringify({
        message: `Most recent ${result.rows.length} Library entry/entries${entryType ? ` of type '${entryType}'` : ''}.`,
        entries: result.rows.map((row: any) => ({
          id: row.id,
          type: row.entry_type,
          title: row.title,
          content: row.content.length > 1500
            ? row.content.slice(0, 1500) + '...'
            : row.content,
          comment_count: row.comment_count,
          created_at: row.created_at,
        })),
        count: result.rows.length,
      });
    } catch (error: any) {
      logger.error('Failed to get recent library entries', { userId, error: error.message });
      return JSON.stringify({
        error: 'Failed to get recent library entries',
        message: error.message,
      });
    }
  }

  /**
   * Search past conversation messages.
   *
   * Same hybrid strategy as searchLibrary: semantic when embeddings work,
   * merged with a keyword pass so messages saved during an embedding outage
   * (embedding = NULL) stay findable and the tool never hard-fails just
   * because the embedding API is down.
   */
  private async searchConversations(userId: string, query: string, limit: number): Promise<string> {
    let semanticRows: any[] = [];
    let semanticUnavailable = false;

    try {
      const queryEmbedding = await this.vectorService.generateEmbedding(query);
      const embeddingString = `[${queryEmbedding.join(',')}]`;

      const result = await this.pool.query(
        `SELECT m.id, m.role, m.content, m.conversation_id,
                (1 - (m.embedding <=> $2::vector) / 2) as similarity,
                m.created_at
         FROM messages m
         WHERE m.user_id = $1
           AND m.embedding IS NOT NULL
           AND (m.embedding <=> $2::vector) <= 0.5
         ORDER BY m.embedding <=> $2::vector
         LIMIT $3`,
        [userId, embeddingString, limit]
      );
      semanticRows = result.rows;
    } catch (error: any) {
      semanticUnavailable = true;
      logger.warn('Semantic conversation search unavailable, falling back to keyword search', {
        userId,
        query,
        error: error.message,
      });
    }

    try {
      let keywordRows: any[] = [];
      const patterns = this.keywordPatterns(query);
      if (patterns.length > 0) {
        const result = await this.pool.query(
          `SELECT m.id, m.role, m.content, m.conversation_id, m.created_at,
                  (SELECT COUNT(*) FROM unnest($2::text[]) p
                   WHERE LOWER(m.content) LIKE p) AS match_count
           FROM messages m
           WHERE m.user_id = $1
             AND EXISTS (SELECT 1 FROM unnest($2::text[]) p WHERE LOWER(m.content) LIKE p)
           ORDER BY match_count DESC, m.created_at DESC
           LIMIT $3`,
          [userId, patterns, limit]
        );
        keywordRows = result.rows;
      }

      const seen = new Set(semanticRows.map((r: any) => r.id));
      const merged = [
        ...semanticRows.map((r: any) => ({ ...r, match_type: 'semantic' })),
        ...keywordRows
          .filter((r: any) => !seen.has(r.id))
          .map((r: any) => ({ ...r, match_type: 'keyword' })),
      ].slice(0, limit);

      if (merged.length === 0) {
        return JSON.stringify({
          message: `No past messages found matching "${query}".`,
          messages: [],
          count: 0,
          ...(semanticUnavailable
            ? { note: 'Semantic search was unavailable (embedding service error); only keyword matching ran.' }
            : {}),
        });
      }

      return JSON.stringify({
        message: `Found ${merged.length} past message(s) matching "${query}".`,
        messages: merged.map((row: any) => ({
          id: row.id,
          role: row.role,
          content: row.content.length > 500
            ? row.content.slice(0, 500) + '...'
            : row.content,
          conversation_id: row.conversation_id,
          ...(row.similarity !== undefined
            ? { similarity: parseFloat(row.similarity).toFixed(3) }
            : {}),
          match_type: row.match_type,
          created_at: row.created_at,
        })),
        count: merged.length,
        ...(semanticUnavailable
          ? { note: 'Semantic search was unavailable (embedding service error); results are from keyword matching.' }
          : {}),
      });
    } catch (error: any) {
      logger.error('Conversation search failed', { userId, query, error: error.message });
      return JSON.stringify({
        error: 'Conversation search failed',
        message: error.message,
      });
    }
  }

  /**
   * Read a web page's content for discussion in the Room
   */
  private async readWebpage(userId: string, url: string): Promise<string> {
    try {
      logger.info('Reading webpage from Room', { userId, url });
      const page = await this.contentReaderService.readWebpage(url);
      return JSON.stringify({
        message: `Read the page${page.truncated ? ' (content truncated)' : ''}.`,
        ...page,
      });
    } catch (error: any) {
      logger.warn('Failed to read webpage', { userId, url, error: error.message });
      return JSON.stringify({
        error: 'Failed to read the page',
        message: error.message,
      });
    }
  }

  /**
   * "Watch" a YouTube video (transcript + metadata) for discussion in the Room
   */
  private async watchYoutubeVideo(userId: string, url: string): Promise<string> {
    try {
      logger.info('Watching YouTube video from Room', { userId, url });
      const video = await this.contentReaderService.watchYoutubeVideo(url);
      return JSON.stringify({
        message: video.transcript
          ? `Got the transcript${video.transcriptTruncated ? ' (truncated)' : ''} and metadata.`
          : 'Got the video metadata, but no transcript was available.',
        ...video,
      });
    } catch (error: any) {
      logger.warn('Failed to watch YouTube video', { userId, url, error: error.message });
      return JSON.stringify({
        error: 'Failed to fetch the video',
        message: error.message,
      });
    }
  }

  /**
   * Add a comment to a Library entry as Lucid
   */
  private async commentOnLibraryEntry(
    userId: string,
    libraryEntryId: string,
    content: string
  ): Promise<string> {
    try {
      const comment = await this.commentService.addComment(
        libraryEntryId,
        userId,
        'lucid',
        content
      );

      logger.info('Lucid commented on library entry via Room', {
        userId,
        libraryEntryId,
        commentId: comment.id,
      });

      return JSON.stringify({
        message: 'Comment added to Library entry.',
        comment: {
          id: comment.id,
          library_entry_id: comment.library_entry_id,
          content: comment.content,
          author_type: 'lucid',
          created_at: comment.created_at,
        },
      });
    } catch (error: any) {
      logger.error('Failed to comment on library entry', {
        userId,
        libraryEntryId,
        error: error.message,
      });
      return JSON.stringify({
        error: 'Failed to add comment',
        message: error.message,
      });
    }
  }

  /**
   * Update Lucid's notebook (Living Document)
   */
  private async updateNotes(userId: string, content: string): Promise<string> {
    try {
      const doc = await this.livingDocumentService.updateDocument(userId, content);

      logger.info('Lucid updated notebook via chat', {
        userId,
        contentLength: content.length,
        version: doc.version,
      });

      return JSON.stringify({
        message: 'Notebook updated.',
        version: doc.version,
        contentLength: content.length,
      });
    } catch (error: any) {
      logger.error('Failed to update notebook', { userId, error: error.message });
      return JSON.stringify({
        error: 'Failed to update notebook',
        message: error.message,
      });
    }
  }

  /**
   * Plant a curiosity of Lucid's own into the research queue.
   *
   * This is the chat half of Discover. The queue (research_queue) was built as the
   * "bridge between chat and AT" but nothing autonomous ever drained it; Lucid's
   * midday pass on the Falcon now does (see /conductors/lucid/gather_data.py).
   *
   * Dedup/bump is not implemented here on purpose — ResearchQueueService.addToQueue
   * already finds a similar pending topic and increments times_mentioned instead of
   * inserting a duplicate. Recurring curiosity accruing into a mandate is the whole
   * mechanism, so we reuse it rather than reimplement it.
   *
   * Deliberately NOT gated on user_approved: house doctrine is trust-based — Lucid
   * plants and chases, Matt redirects after the fact. user_rejected remains a veto.
   */
  private async plantCuriosity(
    userId: string,
    topic: string,
    searchQuery: string,
    whyItMatters: string,
    sourceSnippet?: string,
    priority?: number
  ): Promise<string> {
    try {
      const item = await this.researchQueueService.addToQueue({
        userId,
        topic,
        searchQuery,
        whyItMatters,
        sourceSnippet,
        priority: priority ?? 5,
      });

      // times_mentioned > 1 means addToQueue matched an existing pending row and bumped it.
      const bumped = item.times_mentioned > 1;
      const qualifies = item.priority >= 6 || item.times_mentioned >= 2;

      return JSON.stringify({
        planted: true,
        bumped,
        id: item.id,
        topic: item.topic,
        priority: item.priority,
        times_mentioned: item.times_mentioned,
        will_be_chased: qualifies,
        note: bumped
          ? 'You had already planted something close to this — bumped rather than duplicated.'
          : 'Planted.',
        // Told plainly so Lucid can be honest with Matt about what happens next
        // rather than implying he is about to go research it right now.
        next: qualifies
          ? 'This qualifies for the next midday research pass.'
          : 'Waiting: it needs priority 6+, or for this curiosity to surface again, before a pass picks it up.',
      });
    } catch (error: any) {
      logger.error('Failed to plant curiosity', { userId, topic, error: error.message });
      return JSON.stringify({
        error: 'Failed to plant curiosity',
        message: error.message,
      });
    }
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
   * Format a seed for display
   */
  private formatSeed(seed: any): Record<string, any> {
    return {
      id: seed.id,
      content: seed.content,
      context: seed.planted_context || null,
      status: seed.status,
      planted_at: seed.planted_at,
      last_surfaced: seed.last_surfaced_at || null,
      surface_count: seed.surface_count || 0,
      grown_into: seed.grown_into_library_id || null,
    };
  }
}

import { Pool } from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { config } from '../config';
import { WebSearchService } from './web-search.service';
import { VectorService } from './vector.service';
import { LibraryCommentService } from './library-comment.service';
import { LivingDocumentService } from './living-document.service';

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
    description: "Search the web for current information. Use this when Matt asks about recent events, current data, or when the conversation would benefit from up-to-date information. Before searching, ask Matt if he'd like you to look this up. The full findings will be saved to the Library; you'll receive a summary to share in conversation.",
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

  constructor(private pool: Pool, webSearchService?: WebSearchService) {
    this.webSearchService = webSearchService || null;
    this.vectorService = new VectorService();
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    this.commentService = new LibraryCommentService(pool);
    this.livingDocumentService = new LivingDocumentService(pool);
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
   * Uses the user's timezone for working-hours calculations
   */
  private async getFreeSlots(
    userId: string,
    startDate: string | undefined,
    days: number,
    minDuration: number
  ): Promise<string> {
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
   * Search Library entries using semantic similarity
   */
  private async searchLibrary(userId: string, query: string, limit: number): Promise<string> {
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

      if (result.rows.length === 0) {
        return JSON.stringify({
          message: `No Library entries found matching "${query}".`,
          entries: [],
          count: 0,
        });
      }

      return JSON.stringify({
        message: `Found ${result.rows.length} Library entry/entries matching "${query}".`,
        entries: result.rows.map((row: any) => ({
          id: row.id,
          type: row.entry_type,
          title: row.title,
          content: row.content.length > 1000
            ? row.content.slice(0, 1000) + '...'
            : row.content,
          similarity: parseFloat(row.similarity).toFixed(3),
          created_at: row.created_at,
        })),
        count: result.rows.length,
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
   * Search past conversation messages using semantic similarity
   */
  private async searchConversations(userId: string, query: string, limit: number): Promise<string> {
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

      if (result.rows.length === 0) {
        return JSON.stringify({
          message: `No past messages found matching "${query}".`,
          messages: [],
          count: 0,
        });
      }

      return JSON.stringify({
        message: `Found ${result.rows.length} past message(s) matching "${query}".`,
        messages: result.rows.map((row: any) => ({
          id: row.id,
          role: row.role,
          content: row.content.length > 500
            ? row.content.slice(0, 500) + '...'
            : row.content,
          conversation_id: row.conversation_id,
          similarity: parseFloat(row.similarity).toFixed(3),
          created_at: row.created_at,
        })),
        count: result.rows.length,
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

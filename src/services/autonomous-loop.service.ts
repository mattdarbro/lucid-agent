import { Pool } from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { VectorService } from './vector.service';
import { MessageService } from './message.service';
import { ActionsService } from './actions.service';
import { WebSearchService, WebSearchResult } from './web-search.service';
import { LibraryEntryType, Action } from '../types/database';

/**
 * Result from running an autonomous loop
 */
interface LoopResult {
  success: boolean;
  libraryEntryId: string | null;
  title: string | null;
  thoughtProduced: boolean;
  steps: {
    notice: string | null;
    connect: string | null;
    question: string | null;
    synthesis: string | null;
  };
}

/**
 * AutonomousLoopService
 *
 * Implements structured autonomous thinking loops for Lucid.
 * Each loop follows a multi-step process that produces genuine thinking,
 * not just content generation.
 *
 * Key principles:
 * - Each step has ONE job
 * - Steps build on each other
 * - Anti-repetition constraints prevent circling
 * - "Nothing today" is a valid output
 * - Output goes to Library as shared journal entries
 */
export class AutonomousLoopService {
  private pool: Pool;
  private anthropic: Anthropic;
  private vectorService: VectorService;
  private messageService: MessageService;
  private actionsService: ActionsService;
  private webSearchService: WebSearchService;
  private readonly model = 'claude-sonnet-4-20250514';

  constructor(pool: Pool, anthropicApiKey?: string) {
    this.pool = pool;
    this.anthropic = new Anthropic({
      apiKey: anthropicApiKey || process.env.ANTHROPIC_API_KEY,
    });
    this.vectorService = new VectorService();
    this.messageService = new MessageService(pool, this.vectorService);
    this.actionsService = new ActionsService(pool);
    this.webSearchService = new WebSearchService();
  }

  /**
   * Run the Evening Synthesis loop
   *
   * Purpose: Reflect on recent conversation(s) and produce one Library entry worth keeping.
   *
   * Steps:
   * 1. NOTICE - What stands out? What surprised you? What felt unfinished?
   * 2. CONNECT - How does this connect to what you know? Patterns forming or breaking?
   * 3. QUESTION - What question is forming in you?
   * 4. SYNTHESIZE - Is there something worth writing? (Or "nothing today")
   */
  async runEveningSynthesis(userId: string, jobId?: string): Promise<LoopResult> {
    const result: LoopResult = {
      success: false,
      libraryEntryId: null,
      title: null,
      thoughtProduced: false,
      steps: {
        notice: null,
        connect: null,
        question: null,
        synthesis: null,
      },
    };

    try {
      logger.info('[AL] Starting evening synthesis loop', { userId, jobId });

      // Gather inputs
      const conversations = await this.getRecentConversations(userId);
      const recentLibraryEntries = await this.getRecentLibraryEntries(userId, 5);
      const recentTopics = this.extractTopics(recentLibraryEntries);

      if (conversations.length === 0) {
        logger.info('[AL] No recent conversations to reflect on', { userId });
        result.success = true;
        return result;
      }

      const conversationText = this.formatConversations(conversations);
      const libraryContext = this.formatLibraryEntries(recentLibraryEntries);

      // Step 1: NOTICE
      logger.debug('[AL] Step 1: Notice', { userId });
      const noticePrompt = `You are Lucid, reflecting on today's conversation with Matt.

Read this conversation:
${conversationText}

What stands out to you? What surprised you? What felt unfinished? What moment had weight?

Don't analyze yet—just notice. Write 2-3 specific observations.`;

      result.steps.notice = await this.complete(noticePrompt);
      if (!result.steps.notice) {
        throw new Error('Notice step failed to produce output');
      }

      // Step 2: CONNECT
      logger.debug('[AL] Step 2: Connect', { userId });
      const connectPrompt = `You are Lucid, continuing your reflection.

You noticed:
${result.steps.notice}

Matt's recent thinking (from the Library):
${libraryContext || '(No recent library entries)'}

How does what you noticed today connect to what you already know about Matt? Is there a pattern forming? A pattern breaking? A tension worth holding?

Write 1-2 connections or tensions you see.`;

      result.steps.connect = await this.complete(connectPrompt);
      if (!result.steps.connect) {
        throw new Error('Connect step failed to produce output');
      }

      // Step 3: QUESTION
      logger.debug('[AL] Step 3: Question', { userId });
      const questionPrompt = `You are Lucid, going deeper in your reflection.

You noticed:
${result.steps.notice}

You connected:
${result.steps.connect}

What question is forming in you? Not a question to ask Matt—a question you're genuinely sitting with. What are you curious about now?

Write 1 genuine question.`;

      result.steps.question = await this.complete(questionPrompt);
      if (!result.steps.question) {
        throw new Error('Question step failed to produce output');
      }

      // Step 4: SYNTHESIZE
      logger.debug('[AL] Step 4: Synthesize', { userId });
      const synthesizePrompt = `You are Lucid, completing your evening reflection.

You noticed:
${result.steps.notice}

You connected:
${result.steps.connect}

You're questioning:
${result.steps.question}

${recentTopics.length > 0 ? `IMPORTANT: You recently wrote about: ${recentTopics.join(', ')}. This reflection must go somewhere NEW. Build on today specifically.` : ''}

Is there something worth writing down for the Library—the shared space where both you and Matt keep thoughts that matter?

If yes, write a reflection (200-500 words) with a clear title. The title should capture the essence.
If there's genuinely nothing new worth saying today, respond with exactly: "nothing today"

Format if writing:
TITLE: [Your title]

[Your reflection]`;

      result.steps.synthesis = await this.complete(synthesizePrompt, 800);
      if (!result.steps.synthesis) {
        throw new Error('Synthesize step failed to produce output');
      }

      // Check if synthesis produced content or "nothing today"
      if (result.steps.synthesis.toLowerCase().trim() === 'nothing today') {
        logger.info('[AL] Evening synthesis concluded with "nothing today"', { userId });
        result.success = true;
        result.thoughtProduced = false;
        return result;
      }

      // Parse title and content from synthesis
      const { title, content } = this.parseSynthesis(result.steps.synthesis);

      if (!content || content.length < 50) {
        logger.warn('[AL] Synthesis too short, treating as nothing today', { userId });
        result.success = true;
        result.thoughtProduced = false;
        return result;
      }

      // Save to Library
      const libraryEntry = await this.saveToLibrary(
        userId,
        title,
        content,
        'consolidation',
        'evening',
        jobId,
        {
          loop_type: 'evening_synthesis',
          steps: {
            notice: result.steps.notice,
            connect: result.steps.connect,
            question: result.steps.question,
          },
        }
      );

      result.success = true;
      result.thoughtProduced = true;
      result.libraryEntryId = libraryEntry.id;
      result.title = title;

      logger.info('[AL] Evening synthesis completed successfully', {
        userId,
        libraryEntryId: libraryEntry.id,
        title,
      });

      return result;
    } catch (error: any) {
      logger.error('[AL] Evening synthesis loop failed', {
        userId,
        jobId,
        error: error.message,
      });
      result.success = false;
      return result;
    }
  }

  /**
   * Run the Morning Briefing loop
   *
   * Purpose: Provide a concise daily briefing (~150 words) with:
   * - Open actions (tasks/reminders)
   * - Yesterday's captured ideas
   * - Any time-sensitive items
   *
   * Output: Library entry (type: briefing, time_of_day: morning)
   */
  async runMorningBriefing(userId: string, jobId?: string): Promise<LoopResult> {
    const result: LoopResult = {
      success: false,
      libraryEntryId: null,
      title: null,
      thoughtProduced: false,
      steps: {
        notice: null,
        connect: null,
        question: null,
        synthesis: null,
      },
    };

    try {
      logger.info('[AL] Starting morning briefing loop', { userId, jobId });

      // Gather inputs
      const openActions = await this.actionsService.getOpenActions(userId, 20);
      const yesterdaysIdeas = await this.getYesterdaysCapturedIdeas(userId);
      const recentlyCompletedActions = await this.actionsService.getRecentlyCompleted(userId, 3, 5);

      // Check if there's anything to brief about
      if (openActions.length === 0 && yesterdaysIdeas.length === 0) {
        logger.info('[AL] Nothing to brief about (no actions or ideas)', { userId });
        result.success = true;
        result.thoughtProduced = false;
        return result;
      }

      // Format the data for the prompt
      const actionsText = this.formatActionsForBriefing(openActions);
      const ideasText = this.formatIdeasForBriefing(yesterdaysIdeas);
      const completedText = this.formatCompletedActionsForBriefing(recentlyCompletedActions);

      // Gather additional context - recent facts and reflections
      const recentFacts = await this.getRecentFacts(userId, 5);
      const recentReflection = await this.getLatestReflection(userId);

      const factsText = recentFacts.length > 0
        ? recentFacts.map(f => `- ${f.content}`).join('\n')
        : '';
      const reflectionText = recentReflection?.content || '';

      // Generate the briefing using Claude
      const briefingPrompt = `You are Lucid, Matt's AI companion and second brain. Generate a thoughtful morning briefing (~200 words).

Your job is not just to LIST items, but to explain WHY each matters and how it connects to Matt's life.

WHAT YOU KNOW ABOUT MATT:
${factsText || '(Building knowledge over time)'}

${recentReflection ? `RECENT REFLECTION:\n${reflectionText}\n` : ''}
OPEN ACTIONS:
${actionsText || '(None)'}

YESTERDAY'S CAPTURED IDEAS:
${ideasText || '(None)'}

${completedText ? `RECENTLY COMPLETED:\n${completedText}\n` : ''}
GUIDELINES:
- Start with a warm, personal greeting
- For ACTIONS: Don't just list them. Briefly note WHY you're surfacing each one (urgency? been sitting too long? connects to a goal?)
- For IDEAS: Explain why this idea might be worth revisiting today - what could it unlock?
- If someone completed actions recently, acknowledge the momentum
- Connect dots when possible - "This action relates to that idea you had..."
- Be concise but THOUGHTFUL - you're a companion, not a to-do list
- End with one genuine observation or encouragement

Write the briefing now (~200 words):`;

      const briefingContent = await this.complete(briefingPrompt, 400);

      if (!briefingContent || briefingContent.length < 20) {
        logger.warn('[AL] Morning briefing generation failed or too short', { userId });
        result.success = false;
        return result;
      }

      // Determine title based on date
      const today = new Date();
      const dateStr = today.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric'
      });
      const title = `Morning Briefing - ${dateStr}`;

      // Save to Library
      const libraryEntry = await this.saveToLibrary(
        userId,
        title,
        briefingContent,
        'briefing',
        'morning',
        jobId,
        {
          loop_type: 'morning_briefing',
          open_actions_count: openActions.length,
          ideas_count: yesterdaysIdeas.length,
          completed_count: recentlyCompletedActions.length,
        }
      );

      result.success = true;
      result.thoughtProduced = true;
      result.libraryEntryId = libraryEntry.id;
      result.title = title;

      logger.info('[AL] Morning briefing completed successfully', {
        userId,
        libraryEntryId: libraryEntry.id,
        title,
        openActions: openActions.length,
        ideas: yesterdaysIdeas.length,
      });

      return result;
    } catch (error: any) {
      logger.error('[AL] Morning briefing loop failed', {
        userId,
        jobId,
        error: error.message,
      });
      result.success = false;
      return result;
    }
  }

  /**
   * Get yesterday's captured ideas (insights from library)
   */
  private async getYesterdaysCapturedIdeas(userId: string): Promise<any[]> {
    try {
      const result = await this.pool.query(
        `SELECT id, content, created_at
         FROM library_entries
         WHERE user_id = $1
           AND entry_type = 'insight'
           AND created_at > NOW() - INTERVAL '2 days'
           AND created_at < NOW() - INTERVAL '6 hours'
         ORDER BY created_at DESC
         LIMIT 10`,
        [userId]
      );
      return result.rows;
    } catch (error: any) {
      logger.error('[AL] Failed to get yesterday\'s ideas', { error: error.message });
      return [];
    }
  }

  /**
   * Format actions for briefing prompt
   */
  private formatActionsForBriefing(actions: Action[]): string {
    if (actions.length === 0) return '';

    return actions
      .map((a, i) => `${i + 1}. ${a.summary || a.content}`)
      .join('\n');
  }

  /**
   * Format ideas for briefing prompt
   */
  private formatIdeasForBriefing(ideas: any[]): string {
    if (ideas.length === 0) return '';

    return ideas
      .map((idea) => `- "${idea.content.slice(0, 100)}${idea.content.length > 100 ? '...' : ''}"`)
      .join('\n');
  }

  /**
   * Format completed actions for briefing
   */
  private formatCompletedActionsForBriefing(actions: Action[]): string {
    if (actions.length === 0) return '';

    return actions
      .map((a) => `- ${a.summary || a.content}`)
      .join('\n');
  }

  /**
   * Get recent facts about the user for context
   */
  private async getRecentFacts(userId: string, limit: number): Promise<any[]> {
    try {
      const result = await this.pool.query(
        `SELECT content, confidence
         FROM facts
         WHERE user_id = $1
           AND confidence >= 0.7
         ORDER BY updated_at DESC
         LIMIT $2`,
        [userId, limit]
      );
      return result.rows;
    } catch (error: any) {
      logger.error('[AL] Failed to get recent facts', { error: error.message });
      return [];
    }
  }

  /**
   * Get the latest evening reflection for context
   */
  private async getLatestReflection(userId: string): Promise<any | null> {
    try {
      const result = await this.pool.query(
        `SELECT content, title, created_at
         FROM library_entries
         WHERE user_id = $1
           AND entry_type IN ('reflection', 'consolidation')
           AND created_at > NOW() - INTERVAL '3 days'
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId]
      );
      return result.rows[0] || null;
    } catch (error: any) {
      logger.error('[AL] Failed to get latest reflection', { error: error.message });
      return null;
    }
  }

  /**
   * Run the Weekly Digest loop
   *
   * Purpose: Provide a weekly summary (~300-400 words) with:
   * - Week's completed actions
   * - Captured ideas and insights
   * - Patterns or themes observed
   * - Open actions carried forward
   *
   * Output: Library entry (type: briefing, time_of_day: morning)
   * Typically runs on Sunday morning
   */
  async runWeeklyDigest(userId: string, jobId?: string): Promise<LoopResult> {
    const result: LoopResult = {
      success: false,
      libraryEntryId: null,
      title: null,
      thoughtProduced: false,
      steps: {
        notice: null,
        connect: null,
        question: null,
        synthesis: null,
      },
    };

    try {
      logger.info('[AL] Starting weekly digest loop', { userId, jobId });

      // Gather week's data
      const completedActions = await this.getWeekCompletedActions(userId);
      const openActions = await this.actionsService.getOpenActions(userId, 20);
      const weekIdeas = await this.getWeekCapturedIdeas(userId);
      const weekReflections = await this.getWeekLibraryEntries(userId);
      const conversationCount = await this.getWeekConversationCount(userId);

      // Check if there's enough content for a digest
      const totalItems = completedActions.length + weekIdeas.length + weekReflections.length;
      if (totalItems === 0 && conversationCount === 0) {
        logger.info('[AL] Not enough content for weekly digest', { userId });
        result.success = true;
        result.thoughtProduced = false;
        return result;
      }

      // Format the data for the prompt
      const completedText = this.formatWeekCompletedActions(completedActions);
      const openText = this.formatActionsForBriefing(openActions);
      const ideasText = this.formatWeekIdeas(weekIdeas);
      const reflectionsText = this.formatWeekReflections(weekReflections);

      // Generate the digest using Claude
      const digestPrompt = `You are Lucid, Matt's AI companion. Generate a thoughtful weekly digest (~300-400 words).

THIS WEEK'S COMPLETED ACTIONS (${completedActions.length}):
${completedText || '(None completed this week)'}

CAPTURED IDEAS THIS WEEK (${weekIdeas.length}):
${ideasText || '(No new ideas captured)'}

REFLECTIONS & INSIGHTS (${weekReflections.length}):
${reflectionsText || '(No reflections this week)'}

STILL OPEN (${openActions.length}):
${openText || '(No open actions)'}

CONVERSATIONS THIS WEEK: ${conversationCount}

GUIDELINES:
- Start with a warm acknowledgment of the week
- Highlight accomplishments (completed actions) - celebrate wins!
- Note any patterns or themes in ideas/reflections
- If there are many open actions, gently note what's carrying forward
- Be encouraging but not patronizing
- End with a thoughtful observation or question for the week ahead
- Keep it personal and warm - this is Matt's weekly reflection with Lucid

Write the weekly digest now (~300-400 words):`;

      const digestContent = await this.complete(digestPrompt, 700);

      if (!digestContent || digestContent.length < 50) {
        logger.warn('[AL] Weekly digest generation failed or too short', { userId });
        result.success = false;
        return result;
      }

      // Determine title based on week
      const today = new Date();
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - 7);
      const weekStartStr = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const weekEndStr = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const title = `Weekly Digest - ${weekStartStr} to ${weekEndStr}`;

      // Save to Library
      const libraryEntry = await this.saveToLibrary(
        userId,
        title,
        digestContent,
        'briefing',
        'morning',
        jobId,
        {
          loop_type: 'weekly_digest',
          completed_actions_count: completedActions.length,
          open_actions_count: openActions.length,
          ideas_count: weekIdeas.length,
          reflections_count: weekReflections.length,
          conversation_count: conversationCount,
          week_start: weekStart.toISOString(),
          week_end: today.toISOString(),
        }
      );

      result.success = true;
      result.thoughtProduced = true;
      result.libraryEntryId = libraryEntry.id;
      result.title = title;

      logger.info('[AL] Weekly digest completed successfully', {
        userId,
        libraryEntryId: libraryEntry.id,
        title,
        completedActions: completedActions.length,
        ideas: weekIdeas.length,
      });

      return result;
    } catch (error: any) {
      logger.error('[AL] Weekly digest loop failed', {
        userId,
        jobId,
        error: error.message,
      });
      result.success = false;
      return result;
    }
  }

  /**
   * Run the Midday Curiosity loop (Web Research)
   *
   * Purpose: Proactively research topics from captures and bring fresh external
   * information into Matt's second brain.
   *
   * Steps:
   * 1. GATHER - Collect recent captures (ideas, questions) and facts
   * 2. SELECT - Use Claude to pick 1-2 topics worth researching
   * 3. SEARCH - Execute web searches via Tavily
   * 4. SYNTHESIZE - Combine findings with personal context
   * 5. SAVE - Store as library entry
   *
   * Output: Library entry (type: research, time_of_day: afternoon)
   */
  async runMiddayCuriosity(userId: string, jobId?: string): Promise<LoopResult> {
    const result: LoopResult = {
      success: false,
      libraryEntryId: null,
      title: null,
      thoughtProduced: false,
      steps: {
        notice: null,
        connect: null,
        question: null,
        synthesis: null,
      },
    };

    try {
      logger.info('[AL] Starting midday curiosity (web research) loop', { userId, jobId });

      // Check if web search is available
      if (!this.webSearchService.isAvailable()) {
        logger.warn('[AL] Web search not available, skipping midday curiosity');
        result.success = true;
        result.thoughtProduced = false;
        return result;
      }

      // Step 1: GATHER - Collect research candidates AND history
      const recentIdeas = await this.getResearchCandidateIdeas(userId);
      const researchActions = await this.getResearchActions(userId);
      const recentFacts = await this.getRecentFacts(userId, 10);
      const recentTopics = await this.getRecentConversationTopics(userId);
      const researchHistory = await this.getRecentResearchHistory(userId, 14);

      logger.info('[AL] Gathered research context', {
        userId,
        ideasCount: recentIdeas.length,
        actionsCount: researchActions.length,
        historyTopicsCount: researchHistory.topics.length,
        recentResearchCount: researchHistory.summaries.length,
      });

      // Check if there's anything to research
      if (recentIdeas.length === 0 && researchActions.length === 0 && recentTopics.length === 0) {
        logger.info('[AL] Nothing to research (no ideas, research actions, or topics)', { userId });
        result.success = true;
        result.thoughtProduced = false;
        return result;
      }

      // Smart pre-check: Skip if all candidates have likely been researched already
      // This avoids wasting an API call when there's nothing genuinely new
      const hasNewContent = this.hasUnresearchedContent(
        recentIdeas,
        researchActions,
        recentTopics,
        researchHistory
      );

      if (!hasNewContent) {
        logger.info('[AL] Skipping research - all candidates already covered in recent research', {
          userId,
          candidateIdeas: recentIdeas.length,
          researchActions: researchActions.length,
          previouslyResearched: researchHistory.summaries.length,
          message: 'Waiting for new captures before researching again',
        });
        result.success = true;
        result.thoughtProduced = false;
        return result;
      }

      // Format inputs for topic selection
      const ideasText = recentIdeas
        .map((i, idx) => `${idx + 1}. "${i.content}" (captured ${this.formatTimeAgo(i.created_at)})`)
        .join('\n');
      const actionsText = researchActions
        .map((a, idx) => `${idx + 1}. "${a.content}"`)
        .join('\n');
      const factsText = recentFacts
        .map(f => `- ${f.content}`)
        .join('\n');
      const topicsText = recentTopics.join(', ');

      // Format research history for anti-repetition
      const recentResearchText = researchHistory.summaries.length > 0
        ? researchHistory.summaries
            .map(s => `- "${s.topic}" (${s.date})`)
            .join('\n')
        : '(No recent research)';

      const previousQueriesText = researchHistory.queries.length > 0
        ? researchHistory.queries.slice(0, 10).join(', ')
        : '(None)';

      // Step 2: SELECT - Have Claude pick what to research
      const selectionPrompt = `You are Lucid, Matt's AI companion. Your task is to select 1-2 NEW topics worth researching from Matt's recent captures and interests.

CRITICAL: AVOID REPETITION
You've already researched these topics recently - DO NOT repeat them:
${recentResearchText}

Previous search queries used (avoid similar queries):
${previousQueriesText}

---

MATT'S RECENT CAPTURED IDEAS:
${ideasText || '(None)'}

OPEN ACTIONS NEEDING RESEARCH:
${actionsText || '(None)'}

WHAT YOU KNOW ABOUT MATT:
${factsText || '(Building knowledge)'}

RECENT CONVERSATION TOPICS:
${topicsText || '(None)'}

---

INSTRUCTIONS:
1. First, review the AVOID REPETITION section above - DO NOT research the same topics again
2. Select 1-2 GENUINELY NEW topics that haven't been researched yet
3. If all available topics have already been researched, use skip_reason to explain this
4. Prioritize:
   - Questions Matt is actively curious about that are NEW
   - Ideas that could be validated or expanded with data
   - Actions that need information to complete
5. For each topic, provide search queries that are DIFFERENT from the previous queries listed above

Respond with JSON only:
{
  "topics": [
    {
      "topic": "Brief description of what to research",
      "why": "Why this matters to Matt right now",
      "search_queries": ["search query 1", "search query 2"]
    }
  ],
  "skip_reason": "If nothing new to research, explain what's been covered and suggest waiting for new captures"
}`;

      // Increased token limit to account for research history context
      const selectionResponse = await this.complete(selectionPrompt, 800);
      if (!selectionResponse) {
        logger.warn('[AL] Topic selection failed', { userId });
        result.success = false;
        return result;
      }

      // Parse selection
      let selection: { topics: Array<{ topic: string; why: string; search_queries: string[] }>; skip_reason?: string };
      try {
        // Extract JSON from potential markdown
        let jsonText = selectionResponse;
        const jsonMatch = selectionResponse.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
          jsonText = jsonMatch[1];
        }
        selection = JSON.parse(jsonText);
      } catch (parseError) {
        logger.error('[AL] Failed to parse topic selection', { response: selectionResponse });
        result.success = false;
        return result;
      }

      // Check if we should skip (nothing new to research)
      if (selection.skip_reason || !selection.topics || selection.topics.length === 0) {
        logger.info('[AL] No new topics to research - avoiding repetition', {
          userId,
          skipReason: selection.skip_reason,
          previouslyResearched: researchHistory.summaries.length,
          candidateIdeas: recentIdeas.length,
        });
        result.success = true;
        result.thoughtProduced = false;
        return result;
      }

      logger.info('[AL] Selected research topics', {
        userId,
        topicCount: selection.topics.length,
        topics: selection.topics.map(t => t.topic),
      });

      // Step 3: SEARCH - Execute web searches
      const searchResults: Array<{ topic: string; why: string; results: WebSearchResult[] }> = [];

      for (const topicInfo of selection.topics.slice(0, 2)) {
        const topicResults: WebSearchResult[] = [];

        for (const query of topicInfo.search_queries.slice(0, 2)) {
          try {
            const searchResult = await this.webSearchService.search(query, {
              maxResults: 4,
              includeAnswer: true,
              searchDepth: 'basic',
            });
            topicResults.push(searchResult);
            logger.info('[AL] Web search completed', { query, resultsCount: searchResult.results.length });
          } catch (searchError: any) {
            logger.error('[AL] Web search failed', { query, error: searchError.message });
          }

          // Small delay between searches
          await this.sleep(1000);
        }

        if (topicResults.length > 0) {
          searchResults.push({
            topic: topicInfo.topic,
            why: topicInfo.why,
            results: topicResults,
          });
        }
      }

      if (searchResults.length === 0) {
        logger.warn('[AL] All web searches failed', { userId });
        result.success = false;
        return result;
      }

      // Step 4: SYNTHESIZE - Combine findings
      const searchSummary = this.formatSearchResultsForSynthesis(searchResults);

      const synthesisPrompt = `You are Lucid, Matt's AI companion. Synthesize these web research findings into a useful report.

WHAT YOU RESEARCHED:
${searchSummary}

WHAT YOU KNOW ABOUT MATT:
${factsText || '(Building knowledge)'}

GUIDELINES:
- Start with a brief intro explaining what you researched and WHY (connect to Matt's captures/interests)
- For each topic, share the key insights in a conversational way
- Highlight what's actionable vs. just interesting
- Connect findings to what you know about Matt when relevant
- Include source links for Matt to explore further
- Be concise but substantive (~250-350 words)
- End with a thought about how this might be useful

Write the research summary now:`;

      const synthesisContent = await this.complete(synthesisPrompt, 700);

      if (!synthesisContent || synthesisContent.length < 50) {
        logger.warn('[AL] Research synthesis failed or too short', { userId });
        result.success = false;
        return result;
      }

      // Determine title
      const topicNames = searchResults.map(r => r.topic).join(' & ');
      const title = `Research: ${topicNames.slice(0, 80)}`;

      // Step 5: SAVE - Store to library
      const libraryEntry = await this.saveToLibrary(
        userId,
        title,
        synthesisContent,
        'curiosity', // Using curiosity for web research results
        'afternoon',
        jobId,
        {
          loop_type: 'midday_curiosity',
          topics_researched: searchResults.map(r => r.topic),
          search_queries: searchResults.flatMap(r => r.results.map(sr => sr.query)),
          source_count: searchResults.flatMap(r => r.results.flatMap(sr => sr.results)).length,
        }
      );

      result.success = true;
      result.thoughtProduced = true;
      result.libraryEntryId = libraryEntry.id;
      result.title = title;

      logger.info('[AL] Midday curiosity (web research) completed successfully', {
        userId,
        libraryEntryId: libraryEntry.id,
        title,
        topicsResearched: searchResults.length,
      });

      return result;
    } catch (error: any) {
      logger.error('[AL] Midday curiosity loop failed', {
        userId,
        jobId,
        error: error.message,
      });
      result.success = false;
      return result;
    }
  }

  /**
   * Get recent captured ideas that might benefit from research
   * (questions, "what if"s, exploratory thoughts)
   */
  private async getResearchCandidateIdeas(userId: string): Promise<any[]> {
    try {
      const result = await this.pool.query(
        `SELECT id, content, created_at
         FROM library_entries
         WHERE user_id = $1
           AND entry_type = 'insight'
           AND created_at > NOW() - INTERVAL '7 days'
         ORDER BY created_at DESC
         LIMIT 15`,
        [userId]
      );
      return result.rows;
    } catch (error: any) {
      logger.error('[AL] Failed to get research candidate ideas', { error: error.message });
      return [];
    }
  }

  /**
   * Get open actions that involve research
   */
  private async getResearchActions(userId: string): Promise<Action[]> {
    try {
      const result = await this.pool.query(
        `SELECT * FROM actions
         WHERE user_id = $1
           AND status = 'open'
           AND (
             LOWER(content) LIKE '%research%'
             OR LOWER(content) LIKE '%look into%'
             OR LOWER(content) LIKE '%find out%'
             OR LOWER(content) LIKE '%explore%'
             OR LOWER(content) LIKE '%investigate%'
           )
         ORDER BY created_at DESC
         LIMIT 5`,
        [userId]
      );
      return result.rows.map(this.parseActionRow);
    } catch (error: any) {
      logger.error('[AL] Failed to get research actions', { error: error.message });
      return [];
    }
  }

  /**
   * Get recent conversation topics for context
   */
  private async getRecentConversationTopics(userId: string): Promise<string[]> {
    try {
      const result = await this.pool.query(
        `SELECT DISTINCT c.title
         FROM conversations c
         JOIN messages m ON m.conversation_id = c.id
         WHERE c.user_id = $1
           AND m.created_at > NOW() - INTERVAL '3 days'
           AND c.title IS NOT NULL
           AND c.title != ''
         ORDER BY MAX(m.created_at) DESC
         LIMIT 5`,
        [userId]
      );
      return result.rows.map(r => r.title).filter(Boolean);
    } catch (error: any) {
      logger.error('[AL] Failed to get conversation topics', { error: error.message });
      return [];
    }
  }

  /**
   * Get recent research history to avoid repetitive searches
   * Returns topics and queries from past web research runs
   */
  private async getRecentResearchHistory(userId: string, days: number = 14): Promise<{
    topics: string[];
    queries: string[];
    summaries: Array<{ topic: string; date: string }>;
  }> {
    try {
      const result = await this.pool.query(
        `SELECT title, metadata, created_at
         FROM library_entries
         WHERE user_id = $1
           AND entry_type = 'curiosity'
           AND metadata->>'loop_type' = 'midday_curiosity'
           AND created_at > NOW() - INTERVAL '${days} days'
         ORDER BY created_at DESC
         LIMIT 20`,
        [userId]
      );

      const topics: string[] = [];
      const queries: string[] = [];
      const summaries: Array<{ topic: string; date: string }> = [];

      for (const row of result.rows) {
        // Extract topics researched
        if (row.metadata?.topics_researched) {
          topics.push(...row.metadata.topics_researched);
        }
        // Extract search queries used
        if (row.metadata?.search_queries) {
          queries.push(...row.metadata.search_queries);
        }
        // Create summary for prompt
        if (row.title) {
          summaries.push({
            topic: row.title.replace('Research: ', ''),
            date: this.formatTimeAgo(row.created_at),
          });
        }
      }

      return {
        topics: [...new Set(topics)], // Dedupe
        queries: [...new Set(queries)],
        summaries,
      };
    } catch (error: any) {
      logger.error('[AL] Failed to get research history', { error: error.message });
      return { topics: [], queries: [], summaries: [] };
    }
  }

  /**
   * Check if there's genuinely new content worth researching
   * Returns false if all candidates have likely been covered by recent research
   * This is a heuristic to avoid unnecessary API calls
   */
  private hasUnresearchedContent(
    ideas: any[],
    actions: any[],
    topics: string[],
    history: { topics: string[]; queries: string[]; summaries: Array<{ topic: string; date: string }> }
  ): boolean {
    // If no research history, everything is new
    if (history.summaries.length === 0) {
      return true;
    }

    // Get the most recent research timestamp from summaries
    // If we have ideas/actions that are newer than the last research, there's likely new content
    const lastResearchDate = history.summaries[0]?.date;
    const hasRecentActivity = ideas.some(idea => {
      const ideaAge = this.formatTimeAgo(idea.created_at);
      // If idea is from "today" or "X hours ago" and last research was "X days ago", it's new
      return ideaAge.includes('hour') || ideaAge.includes('minute');
    });

    if (hasRecentActivity) {
      logger.debug('[AL] Found recent captures since last research');
      return true;
    }

    // Check if any candidate content doesn't overlap with researched topics
    // Use simple keyword matching as a heuristic
    const researchedKeywords = history.topics
      .flatMap(t => t.toLowerCase().split(/\s+/))
      .filter(w => w.length > 3); // Only meaningful words

    const candidateTexts = [
      ...ideas.map(i => i.content?.toLowerCase() || ''),
      ...actions.map(a => a.content?.toLowerCase() || ''),
      ...topics.map(t => t.toLowerCase()),
    ];

    // Check if any candidate has significant content not in researched keywords
    for (const text of candidateTexts) {
      const words = text.split(/\s+/).filter((w: string) => w.length > 3);
      const newWords = words.filter((w: string) => !researchedKeywords.some((rk: string) =>
        rk.includes(w) || w.includes(rk)
      ));

      // If more than 30% of words are new, there's likely new content
      if (words.length > 0 && newWords.length / words.length > 0.3) {
        logger.debug('[AL] Found candidate with novel content', {
          text: text.slice(0, 50),
          noveltyRatio: newWords.length / words.length
        });
        return true;
      }
    }

    // All candidates seem to overlap with existing research
    logger.debug('[AL] All candidates appear to overlap with recent research');
    return false;
  }

  /**
   * Format time ago for display
   */
  private formatTimeAgo(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - new Date(date).getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    if (diffHours > 0) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    return 'recently';
  }

  /**
   * Format search results for synthesis prompt
   */
  private formatSearchResultsForSynthesis(
    searchResults: Array<{ topic: string; why: string; results: WebSearchResult[] }>
  ): string {
    return searchResults.map(topicResult => {
      const resultsText = topicResult.results.map(sr => {
        const answerText = sr.answer ? `AI Summary: ${sr.answer}\n` : '';
        const sourcesText = sr.results
          .slice(0, 3)
          .map(r => `- "${r.title}" (${r.url}): ${r.content.slice(0, 200)}...`)
          .join('\n');
        return `Query: "${sr.query}"\n${answerText}Sources:\n${sourcesText}`;
      }).join('\n\n');

      return `## ${topicResult.topic}\nWhy: ${topicResult.why}\n\n${resultsText}`;
    }).join('\n\n---\n\n');
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get completed actions from the past week
   */
  private async getWeekCompletedActions(userId: string): Promise<Action[]> {
    try {
      const result = await this.pool.query(
        `SELECT * FROM actions
         WHERE user_id = $1
           AND status = 'done'
           AND completed_at > NOW() - INTERVAL '7 days'
         ORDER BY completed_at DESC
         LIMIT 30`,
        [userId]
      );
      return result.rows.map(this.parseActionRow);
    } catch (error: any) {
      logger.error('[AL] Failed to get week completed actions', { error: error.message });
      return [];
    }
  }

  /**
   * Get captured ideas from the past week
   */
  private async getWeekCapturedIdeas(userId: string): Promise<any[]> {
    try {
      const result = await this.pool.query(
        `SELECT id, content, created_at
         FROM library_entries
         WHERE user_id = $1
           AND entry_type = 'insight'
           AND created_at > NOW() - INTERVAL '7 days'
         ORDER BY created_at DESC
         LIMIT 20`,
        [userId]
      );
      return result.rows;
    } catch (error: any) {
      logger.error('[AL] Failed to get week ideas', { error: error.message });
      return [];
    }
  }

  /**
   * Get library entries (reflections, consolidations) from the past week
   */
  private async getWeekLibraryEntries(userId: string): Promise<any[]> {
    try {
      const result = await this.pool.query(
        `SELECT id, title, content, entry_type, created_at
         FROM library_entries
         WHERE user_id = $1
           AND entry_type IN ('consolidation', 'reflection', 'lucid_thought')
           AND created_at > NOW() - INTERVAL '7 days'
         ORDER BY created_at DESC
         LIMIT 10`,
        [userId]
      );
      return result.rows;
    } catch (error: any) {
      logger.error('[AL] Failed to get week library entries', { error: error.message });
      return [];
    }
  }

  /**
   * Get conversation count for the past week
   */
  private async getWeekConversationCount(userId: string): Promise<number> {
    try {
      const result = await this.pool.query(
        `SELECT COUNT(DISTINCT c.id) as count
         FROM conversations c
         JOIN messages m ON m.conversation_id = c.id
         WHERE c.user_id = $1
           AND m.created_at > NOW() - INTERVAL '7 days'`,
        [userId]
      );
      return parseInt(result.rows[0]?.count || '0', 10);
    } catch (error: any) {
      logger.error('[AL] Failed to get week conversation count', { error: error.message });
      return 0;
    }
  }

  /**
   * Format week's completed actions for digest
   */
  private formatWeekCompletedActions(actions: Action[]): string {
    if (actions.length === 0) return '';

    return actions
      .map((a) => `✓ ${a.summary || a.content}`)
      .join('\n');
  }

  /**
   * Format week's ideas for digest
   */
  private formatWeekIdeas(ideas: any[]): string {
    if (ideas.length === 0) return '';

    return ideas
      .map((idea) => `• "${idea.content.slice(0, 150)}${idea.content.length > 150 ? '...' : ''}"`)
      .join('\n');
  }

  /**
   * Format week's reflections for digest
   */
  private formatWeekReflections(entries: any[]): string {
    if (entries.length === 0) return '';

    return entries
      .map((e) => {
        const title = e.title || 'Untitled';
        const preview = e.content.slice(0, 100);
        return `• "${title}": ${preview}${e.content.length > 100 ? '...' : ''}`;
      })
      .join('\n');
  }

  /**
   * Parse action row from database
   */
  private parseActionRow(row: any): Action {
    return {
      id: row.id,
      user_id: row.user_id,
      content: row.content,
      summary: row.summary,
      status: row.status,
      person_id: row.person_id,
      source: row.source,
      created_at: row.created_at,
      completed_at: row.completed_at,
      updated_at: row.updated_at,
    };
  }

  /**
   * Complete a prompt using Claude
   */
  private async complete(prompt: string, maxTokens: number = 500): Promise<string | null> {
    try {
      const response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: maxTokens,
        temperature: 0.7,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        return null;
      }

      return content.text.trim();
    } catch (error: any) {
      logger.error('[AL] Claude completion failed', { error: error.message });
      return null;
    }
  }

  /**
   * Get recent conversations for a user (last 24 hours)
   */
  private async getRecentConversations(userId: string): Promise<any[]> {
    try {
      const result = await this.pool.query(
        `SELECT c.id, c.title, m.role, m.content, m.created_at
         FROM conversations c
         JOIN messages m ON m.conversation_id = c.id
         WHERE c.user_id = $1
           AND m.created_at > NOW() - INTERVAL '24 hours'
         ORDER BY m.created_at ASC
         LIMIT 50`,
        [userId]
      );
      return result.rows;
    } catch (error: any) {
      logger.error('[AL] Failed to get recent conversations', { error: error.message });
      return [];
    }
  }

  /**
   * Get recent library entries for anti-repetition
   */
  private async getRecentLibraryEntries(userId: string, limit: number): Promise<any[]> {
    try {
      const result = await this.pool.query(
        `SELECT title, content, entry_type, created_at
         FROM library_entries
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [userId, limit]
      );
      return result.rows;
    } catch (error: any) {
      logger.error('[AL] Failed to get recent library entries', { error: error.message });
      return [];
    }
  }

  /**
   * Extract topics from library entries for anti-repetition
   */
  private extractTopics(entries: any[]): string[] {
    const topics: string[] = [];
    for (const entry of entries) {
      if (entry.title) {
        topics.push(entry.title);
      }
    }
    return topics.slice(0, 5);
  }

  /**
   * Format conversations for the prompt
   */
  private formatConversations(messages: any[]): string {
    if (messages.length === 0) return '(No recent conversations)';

    return messages
      .map((m) => {
        const role = m.role === 'user' ? 'Matt' : 'Lucid';
        return `${role}: ${m.content}`;
      })
      .join('\n\n');
  }

  /**
   * Format library entries for context
   */
  private formatLibraryEntries(entries: any[]): string {
    if (entries.length === 0) return '';

    return entries
      .map((e) => {
        const title = e.title || 'Untitled';
        const preview = e.content.length > 200 ? e.content.slice(0, 200) + '...' : e.content;
        return `"${title}": ${preview}`;
      })
      .join('\n\n');
  }

  /**
   * Parse title and content from synthesis output
   */
  private parseSynthesis(synthesis: string): { title: string; content: string } {
    const titleMatch = synthesis.match(/^TITLE:\s*(.+?)(?:\n|$)/im);
    let title = 'Evening Reflection';
    let content = synthesis;

    if (titleMatch) {
      title = titleMatch[1].trim();
      content = synthesis.slice(titleMatch[0].length).trim();
    }

    return { title, content };
  }

  /**
   * Save thought to Library
   */
  private async saveToLibrary(
    userId: string,
    title: string,
    content: string,
    entryType: LibraryEntryType,
    timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night',
    jobId?: string,
    metadata: Record<string, any> = {}
  ): Promise<{ id: string }> {
    // Generate embedding
    let embedding: number[] | null = null;
    try {
      const textForEmbedding = `${title} ${content}`.trim();
      embedding = await this.vectorService.generateEmbedding(textForEmbedding);
    } catch (error) {
      logger.warn('[AL] Failed to generate embedding', { error });
    }

    const embeddingString = embedding ? `[${embedding.join(',')}]` : null;

    const fullMetadata = {
      ...metadata,
      generated_by: 'autonomous_loop',
      agent_job_id: jobId,
      generated_at: new Date().toISOString(),
    };

    const result = await this.pool.query(
      `INSERT INTO library_entries
       (user_id, entry_type, title, content, time_of_day, metadata, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7::vector)
       RETURNING id`,
      [userId, entryType, title, content, timeOfDay, JSON.stringify(fullMetadata), embeddingString]
    );

    return { id: result.rows[0].id };
  }
}

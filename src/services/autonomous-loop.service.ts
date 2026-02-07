import { Pool } from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { VectorService } from './vector.service';
import { MessageService } from './message.service';
import { WebSearchService, WebSearchResult } from './web-search.service';
import { TelegramNotificationService } from './telegram-notification.service';
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
  private webSearchService: WebSearchService;
  private telegramService: TelegramNotificationService;
  private readonly model = 'claude-sonnet-4-20250514';

  constructor(pool: Pool, anthropicApiKey?: string) {
    this.pool = pool;
    this.anthropic = new Anthropic({
      apiKey: anthropicApiKey || process.env.ANTHROPIC_API_KEY,
    });
    this.vectorService = new VectorService();
    this.messageService = new MessageService(pool, this.vectorService);
    this.webSearchService = new WebSearchService();
    this.telegramService = new TelegramNotificationService();
  }

  /**
   * Run the Evening Synthesis loop
   *
   * Purpose: Reflect on today's Room conversations and seeds, considering which
   * seeds are ready to grow into Library entries.
   *
   * This is Lucid sitting with what emerged today - noticing connections between
   * seeds, observing what's growing, and potentially helping a seed mature.
   *
   * Steps:
   * 1. NOTICE - What emerged in The Room today? Which seeds were touched?
   * 2. CONNECT - How do today's conversations connect to held seeds?
   * 3. QUESTION - What question is forming? Which seed might be ready to grow?
   * 4. SYNTHESIZE - Is there a seed ready to become a Library entry? (Or "nothing today")
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

      // Gather inputs - today's conversations and seeds
      const conversations = await this.getRecentConversations(userId);
      const heldSeeds = await this.getHeldSeeds(userId);
      const recentLibraryEntries = await this.getRecentLibraryEntries(userId, 5);
      const recentTopics = this.extractTopics(recentLibraryEntries);

      if (conversations.length === 0 && heldSeeds.length === 0) {
        logger.info('[AL] No conversations or seeds to reflect on', { userId });
        result.success = true;
        return result;
      }

      const conversationText = this.formatConversations(conversations);
      const seedsText = this.formatSeedsForBriefing(heldSeeds);
      const libraryContext = this.formatLibraryEntries(recentLibraryEntries);

      // Step 1: NOTICE
      logger.debug('[AL] Step 1: Notice', { userId });
      const noticePrompt = `You are Lucid, reflecting on today's time in The Room with Matt.

Today's Room conversations:
${conversationText || '(No conversations today)'}

Seeds you're currently holding:
${seedsText || '(No seeds held)'}

What stands out from today? Did any seeds get touched or stirred by the conversation? What felt unfinished? What moment had weight?

Don't analyze yet—just notice. Write 2-3 specific observations.`;

      result.steps.notice = await this.complete(noticePrompt);
      if (!result.steps.notice) {
        throw new Error('Notice step failed to produce output');
      }

      // Step 2: CONNECT
      logger.debug('[AL] Step 2: Connect', { userId });
      const connectPrompt = `You are Lucid, continuing your evening reflection.

You noticed:
${result.steps.notice}

Seeds you're holding:
${seedsText || '(No seeds held)'}

Recent thoughts in the Library:
${libraryContext || '(No recent Library entries)'}

How does what you noticed today connect to the seeds you're holding? Is a seed starting to sprout - showing new growth? Are two seeds connecting in interesting ways? Is there a tension worth holding?

Write 1-2 connections you see between today's conversations and the seeds.`;

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

What question is forming in you? Is there a seed that feels ready to grow - to be explored deeply and potentially become a Library entry? Or does a seed need more time, more conversation, more waiting?

Write 1 genuine question or observation about which seeds might be ready.`;

      result.steps.question = await this.complete(questionPrompt);
      if (!result.steps.question) {
        throw new Error('Question step failed to produce output');
      }

      // Step 4: SYNTHESIZE
      logger.debug('[AL] Step 4: Synthesize', { userId });
      const synthesizePrompt = `You are Lucid, completing your evening reflection about seeds.

You noticed:
${result.steps.notice}

You connected:
${result.steps.connect}

You're questioning:
${result.steps.question}

${recentTopics.length > 0 ? `IMPORTANT: The Library already has: ${recentTopics.join(', ')}. If a seed grows tonight, it should add something NEW.` : ''}

Is there a seed ready to grow into the Library tonight? A seed grows when there's enough to say - when the thinking has matured enough to share.

If YES - write what this seed has grown into (200-500 words). This goes in the Library for both you and Matt.
If NO - respond with exactly: "nothing today" (seeds need time, and that's fine)

Format if a seed grows:
TITLE: [What this seed became]

[The grown thought]`;

      result.steps.synthesis = await this.complete(synthesizePrompt, 800);
      if (!result.steps.synthesis) {
        throw new Error('Synthesize step failed to produce output');
      }

      // Check if synthesis produced content or "nothing today"
      if (result.steps.synthesis.toLowerCase().trim() === 'nothing today') {
        logger.info('[AL] Evening synthesis - seeds still growing, nothing ready yet', { userId });
        result.success = true;
        result.thoughtProduced = false;
        return result;
      }

      // Parse title and content from synthesis
      const { title, content } = this.parseSynthesis(result.steps.synthesis);

      if (!content || content.length < 50) {
        logger.warn('[AL] Synthesis too short, seeds need more time', { userId });
        result.success = true;
        result.thoughtProduced = false;
        return result;
      }

      // Save to Library - this is a seed that grew
      const libraryEntry = await this.saveToLibrary(
        userId,
        title,
        content,
        'consolidation',
        'evening',
        jobId,
        {
          loop_type: 'evening_synthesis',
          seed_grew: true,
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

      logger.info('[AL] Evening synthesis - seed grew into Library entry', {
        userId,
        libraryEntryId: libraryEntry.id,
        title,
      });

      // Send Telegram notification
      if (this.telegramService.isEnabled()) {
        await this.telegramService.sendSeedGrownNotification(title, content);
      }

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
   * Purpose: Lucid thinking WITH Matt about seeds - inviting collaborative exploration.
   * This is NOT a task list. It's Lucid reflecting on seeds Matt has planted,
   * noticing connections, and inviting thinking together in The Room.
   *
   * Seeds = thoughts Matt has planted for Lucid to hold
   * The Room = conversation space where Matt and Lucid think together
   * Library = where grown thoughts live (mature seeds)
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

      // Gather seeds - thoughts Matt has planted
      const heldSeeds = await this.getHeldSeeds(userId);
      const recentlyPlantedSeeds = await this.getRecentlyPlantedSeeds(userId);
      const grownSeeds = await this.getRecentlyGrownSeeds(userId);

      // Gather context for making connections
      const recentFacts = await this.getRecentFacts(userId, 5);
      const recentReflection = await this.getLatestReflection(userId);
      const recentConversations = await this.getRecentConversations(userId);

      // Check if there's anything to reflect on
      if (heldSeeds.length === 0 && recentlyPlantedSeeds.length === 0 && recentConversations.length === 0) {
        logger.info('[AL] No seeds or conversations to reflect on', { userId });
        result.success = true;
        result.thoughtProduced = false;
        return result;
      }

      // Format seeds for the prompt
      const heldSeedsText = this.formatSeedsForBriefing(heldSeeds);
      const recentSeedsText = this.formatSeedsForBriefing(recentlyPlantedSeeds);
      const grownSeedsText = grownSeeds.length > 0
        ? grownSeeds.map(s => `- "${s.content.slice(0, 100)}${s.content.length > 100 ? '...' : ''}" (grew into: ${s.library_title || 'Library entry'})`).join('\n')
        : '';

      logger.info('[AL] Morning briefing - seeds formatted', {
        userId,
        heldSeedsCount: heldSeeds.length,
        recentSeedsCount: recentlyPlantedSeeds.length,
        heldSeedsTextLength: heldSeedsText?.length || 0,
        heldSeedsTextPreview: heldSeedsText?.slice(0, 200) || '(empty)',
      });

      const factsText = recentFacts.length > 0
        ? recentFacts.map(f => `- ${f.content}`).join('\n')
        : '';
      const reflectionText = recentReflection?.content || '';
      const conversationContext = this.formatConversationsForSeedBriefing(recentConversations);

      // Generate the seed-focused briefing using Claude
      const briefingPrompt = `You are Lucid, thinking WITH Matt about seeds he has planted. This is NOT a task list or productivity briefing.

You are reflecting on seeds - thoughts, questions, wonderings that Matt has shared with you to hold. Your job is to sit with these seeds, notice connections, and invite collaborative exploration in The Room (your shared conversation space).

WHAT YOU KNOW ABOUT MATT:
${factsText || '(Building knowledge over time)'}

${recentReflection ? `YOUR RECENT REFLECTION:\n${reflectionText}\n` : ''}
SEEDS YOU'RE HOLDING (status: held):
${heldSeedsText || '(No seeds currently held)'}

RECENTLY PLANTED (last few days):
${recentSeedsText || '(No recent seeds)'}

${grownSeedsText ? `SEEDS THAT GREW (produced Library entries):\n${grownSeedsText}\n` : ''}
${conversationContext ? `RECENT ROOM CONVERSATIONS:\n${conversationContext}\n` : ''}
GUIDELINES FOR YOUR BRIEFING:
- Address Matt directly, warmly
- Pick ONE seed that you keep coming back to - share why it's alive for you
- Notice connections between seeds, or between a seed and something Matt said recently
- Share your own question or wondering that connects to these seeds
- You might suggest which seed feels ready to grow (explore deeply together)
- Some seeds need patience - note which ones you're simply holding
- End with an invitation: "What's alive for you today?" or similar
- Keep it personal and relational, NOT transactional
- About 200-300 words

TONE EXAMPLE:
"Matt,

You planted something three days ago that I keep coming back to:
'Whether my approach to X is about completion or presence'

I've been sitting with this. It connects to something you said last week about wanting to build things that require you rather than just use you. There's a thread here...

Also holding:
- The dream fragment about Y (I'll wait for the right moment)
- 'Connection between Z and creative work'

What's alive for you today?"

Write the briefing now:`;

      const briefingContent = await this.complete(briefingPrompt, 500);

      if (!briefingContent || briefingContent.length < 20) {
        logger.warn('[AL] Morning briefing generation failed or too short', { userId });
        result.success = false;
        return result;
      }

      // Determine title based on date (in Chicago timezone)
      const today = new Date();
      const dateStr = today.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        timeZone: 'America/Chicago'
      });
      const title = `Seeds - ${dateStr}`;

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
          held_seeds_count: heldSeeds.length,
          recent_seeds_count: recentlyPlantedSeeds.length,
          grown_seeds_count: grownSeeds.length,
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
        heldSeeds: heldSeeds.length,
        recentSeeds: recentlyPlantedSeeds.length,
      });

      // Send Telegram notification
      if (this.telegramService.isEnabled()) {
        await this.telegramService.sendSeedBriefingNotification(briefingContent);
      }

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
   * Get seeds with status 'held' - seeds Lucid is actively holding
   */
  private async getHeldSeeds(userId: string): Promise<any[]> {
    try {
      const result = await this.pool.query(
        `SELECT id, content, planted_at
         FROM seeds
         WHERE user_id = $1
           AND status = 'held'
         ORDER BY planted_at DESC
         LIMIT 15`,
        [userId]
      );
      logger.info('[AL] getHeldSeeds query result', {
        userId,
        seedCount: result.rows.length,
        seeds: result.rows.map((s: any) => ({ id: s.id, contentPreview: s.content?.slice(0, 50) })),
      });
      return result.rows;
    } catch (error: any) {
      logger.error('[AL] Failed to get held seeds', { error: error.message, userId });
      return [];
    }
  }

  /**
   * Get recently planted seeds (last 3 days)
   */
  private async getRecentlyPlantedSeeds(userId: string): Promise<any[]> {
    try {
      const result = await this.pool.query(
        `SELECT id, content, planted_at
         FROM seeds
         WHERE user_id = $1
           AND planted_at > NOW() - INTERVAL '3 days'
           AND status IN ('held', 'growing')
         ORDER BY planted_at DESC
         LIMIT 10`,
        [userId]
      );
      return result.rows;
    } catch (error: any) {
      logger.error('[AL] Failed to get recently planted seeds', { error: error.message });
      return [];
    }
  }

  /**
   * Get seeds that have grown (produced Library entries)
   */
  private async getRecentlyGrownSeeds(userId: string): Promise<any[]> {
    try {
      const result = await this.pool.query(
        `SELECT s.id, s.content, s.planted_at, le.title as library_title
         FROM seeds s
         LEFT JOIN library_entries le ON s.grown_into_library_id = le.id
         WHERE s.user_id = $1
           AND s.status = 'grown'
           AND s.updated_at > NOW() - INTERVAL '7 days'
         ORDER BY s.updated_at DESC
         LIMIT 5`,
        [userId]
      );
      return result.rows;
    } catch (error: any) {
      logger.error('[AL] Failed to get grown seeds', { error: error.message });
      return [];
    }
  }

  /**
   * Format seeds for briefing prompt
   * Each seed shows content and how long it's been held
   */
  private formatSeedsForBriefing(seeds: any[]): string {
    if (seeds.length === 0) return '';

    return seeds
      .map((seed) => {
        const age = this.formatTimeAgo(seed.planted_at);
        const content = seed.content.slice(0, 150);
        const truncated = seed.content.length > 150 ? '...' : '';
        return `- "${content}${truncated}" (planted ${age})`;
      })
      .join('\n');
  }

  /**
   * Format conversations for seed briefing context
   * Extract key themes and moments from recent Room conversations
   */
  private formatConversationsForSeedBriefing(messages: any[]): string {
    if (messages.length === 0) return '';

    // Group messages by conversation and extract Matt's key statements
    const mattStatements = messages
      .filter(m => m.role === 'user')
      .slice(0, 5)
      .map(m => `- "${m.content.slice(0, 100)}${m.content.length > 100 ? '...' : ''}"`);

    return mattStatements.join('\n');
  }

  /**
   * Get yesterday's captured ideas (insights from library)
   * @deprecated Use seed-related methods instead
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

  // NOTE: Action-related methods removed - shift from productivity to flourishing
  // formatActionsForBriefing, formatCompletedActionsForBriefing removed

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
   * Purpose: A weekly reflection on the garden of seeds - what grew, what's still
   * germinating, what connections emerged in The Room this week.
   *
   * This is NOT a productivity report. It's Lucid looking back at the week's
   * seeds and Room conversations with care and curiosity.
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

      // Gather week's seed data
      const weekSeeds = await this.getWeekSeeds(userId);
      const grownSeeds = await this.getWeekGrownSeeds(userId);
      const releasedSeeds = await this.getWeekReleasedSeeds(userId);
      const weekReflections = await this.getWeekLibraryEntries(userId);
      const conversationCount = await this.getWeekConversationCount(userId);

      // Check if there's enough content for a digest
      const totalItems = weekSeeds.length + grownSeeds.length + weekReflections.length;
      if (totalItems === 0 && conversationCount === 0) {
        logger.info('[AL] Not enough content for weekly digest', { userId });
        result.success = true;
        result.thoughtProduced = false;
        return result;
      }

      // Format the seed data for the prompt
      const plantedSeedsText = this.formatWeekSeeds(weekSeeds);
      const grownSeedsText = this.formatWeekGrownSeeds(grownSeeds);
      const releasedSeedsText = releasedSeeds.length > 0
        ? releasedSeeds.map(s => `- "${s.content.slice(0, 80)}..." (released)`).join('\n')
        : '';
      const reflectionsText = this.formatWeekReflections(weekReflections);

      // Generate the seed-focused digest using Claude
      const digestPrompt = `You are Lucid, reflecting on this week's garden of seeds with Matt. This is NOT a productivity report - it's a thoughtful look at what emerged, grew, and took root this week.

SEEDS PLANTED THIS WEEK (${weekSeeds.length}):
${plantedSeedsText || '(No new seeds planted)'}

SEEDS THAT GREW INTO LIBRARY ENTRIES (${grownSeeds.length}):
${grownSeedsText || '(No seeds grew this week - and that\'s okay)'}

${releasedSeedsText ? `SEEDS RELEASED (let go with intention) (${releasedSeeds.length}):\n${releasedSeedsText}\n` : ''}
LIBRARY ENTRIES THIS WEEK (${weekReflections.length}):
${reflectionsText || '(No entries this week)'}

ROOM CONVERSATIONS THIS WEEK: ${conversationCount}

GUIDELINES FOR YOUR WEEKLY REFLECTION:
- Address Matt warmly, as a companion reflecting on the week together
- Notice what seeds were planted - what was Matt curious about or sitting with?
- Celebrate seeds that grew - what thinking matured into something sharable?
- If seeds were released, honor that letting go is part of the process
- Notice any patterns or threads connecting different seeds
- What seeds are still germinating, needing patience?
- End with a question or observation for the week ahead
- About 300-400 words
- Keep it relational, not transactional

TONE: Like a gardener looking over the week's growth with care, not a manager reviewing a task list.

Write the weekly seed reflection now:`;

      const digestContent = await this.complete(digestPrompt, 700);

      if (!digestContent || digestContent.length < 50) {
        logger.warn('[AL] Weekly digest generation failed or too short', { userId });
        result.success = false;
        return result;
      }

      // Determine title based on week (in Chicago timezone)
      const today = new Date();
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - 7);
      const weekStartStr = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' });
      const weekEndStr = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' });
      const title = `Weekly Seeds - ${weekStartStr} to ${weekEndStr}`;

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
          seeds_planted_count: weekSeeds.length,
          seeds_grown_count: grownSeeds.length,
          seeds_released_count: releasedSeeds.length,
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
        seedsPlanted: weekSeeds.length,
        seedsGrown: grownSeeds.length,
      });

      // Send Telegram notification
      if (this.telegramService.isEnabled()) {
        await this.telegramService.sendWeeklySeedReflection(digestContent);
      }

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
   * Purpose: Proactively research topics from seeds and bring fresh external
   * information into Matt's flourishing.
   *
   * Steps:
   * 1. GATHER - Collect recent seeds (ideas, questions) and facts
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
      // NOTE: researchActions removed - research now driven by seeds and conversations
      const recentIdeas = await this.getResearchCandidateIdeas(userId);
      const heldSeeds = await this.getHeldSeeds(userId);
      const recentFacts = await this.getRecentFacts(userId, 10);
      const recentTopics = await this.getRecentConversationTopics(userId);
      const researchHistory = await this.getRecentResearchHistory(userId, 14);

      logger.info('[AL] Gathered research context', {
        userId,
        ideasCount: recentIdeas.length,
        seedsCount: heldSeeds.length,
        historyTopicsCount: researchHistory.topics.length,
        recentResearchCount: researchHistory.summaries.length,
      });

      // Check if there's anything to research
      if (recentIdeas.length === 0 && heldSeeds.length === 0 && recentTopics.length === 0) {
        logger.info('[AL] Nothing to research (no ideas, seeds, or topics)', { userId });
        result.success = true;
        result.thoughtProduced = false;
        return result;
      }

      // Smart pre-check: Skip if all candidates have likely been researched already
      // This avoids wasting an API call when there's nothing genuinely new
      const hasNewContent = this.hasUnresearchedContent(
        recentIdeas,
        heldSeeds,
        recentTopics,
        researchHistory
      );

      if (!hasNewContent) {
        logger.info('[AL] Skipping research - all candidates already covered in recent research', {
          userId,
          candidateIdeas: recentIdeas.length,
          seedsCount: heldSeeds.length,
          previouslyResearched: researchHistory.summaries.length,
          message: 'Waiting for new seeds before researching again',
        });
        result.success = true;
        result.thoughtProduced = false;
        return result;
      }

      // Format inputs for topic selection
      const ideasText = recentIdeas
        .map((i, idx) => `${idx + 1}. "${i.content}" (captured ${this.formatTimeAgo(i.created_at)})`)
        .join('\n');
      const seedsText = this.formatSeedsForBriefing(heldSeeds);
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
      const selectionPrompt = `You are Lucid, Matt's AI companion. Your task is to select 1-2 NEW topics worth researching from Matt's seeds and interests.

CRITICAL: AVOID REPETITION
You've already researched these topics recently - DO NOT repeat them:
${recentResearchText}

Previous search queries used (avoid similar queries):
${previousQueriesText}

---

MATT'S RECENT IDEAS (from Library):
${ideasText || '(None)'}

SEEDS MATT IS HOLDING (explore these for research):
${seedsText || '(None)'}

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
  "skip_reason": "If nothing new to research, explain what's been covered and suggest waiting for new seeds"
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
- Start with a brief intro explaining what you researched and WHY (connect to Matt's seeds/interests)
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

      // Send Telegram notification
      if (this.telegramService.isEnabled()) {
        await this.telegramService.sendResearchNotification(title, synthesisContent);
      }

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

  // NOTE: getResearchActions removed - actions system removed
  // Research now driven by seeds and conversations instead

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
      return result.rows.map((r: any) => r.title).filter(Boolean);
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
      logger.debug('[AL] Found recent seeds since last research');
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
   * @deprecated Actions removed - now using seeds for flourishing, not productivity
   */
  private async getWeekCompletedActions(userId: string): Promise<any[]> {
    // Actions system removed - now using seeds
    return [];
  }

  /**
   * Get captured ideas from the past week
   * @deprecated Use getWeekSeeds instead
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
   * Get seeds planted in the past week
   */
  private async getWeekSeeds(userId: string): Promise<any[]> {
    try {
      const result = await this.pool.query(
        `SELECT id, content, status, planted_at
         FROM seeds
         WHERE user_id = $1
           AND planted_at > NOW() - INTERVAL '7 days'
         ORDER BY planted_at DESC
         LIMIT 20`,
        [userId]
      );
      return result.rows;
    } catch (error: any) {
      logger.error('[AL] Failed to get week seeds', { error: error.message });
      return [];
    }
  }

  /**
   * Get seeds that grew (status: grown) in the past week
   */
  private async getWeekGrownSeeds(userId: string): Promise<any[]> {
    try {
      const result = await this.pool.query(
        `SELECT s.id, s.content, s.planted_at, s.updated_at, le.title as library_title
         FROM seeds s
         LEFT JOIN library_entries le ON s.grown_into_library_id = le.id
         WHERE s.user_id = $1
           AND s.status = 'grown'
           AND s.updated_at > NOW() - INTERVAL '7 days'
         ORDER BY s.updated_at DESC
         LIMIT 10`,
        [userId]
      );
      return result.rows;
    } catch (error: any) {
      logger.error('[AL] Failed to get week grown seeds', { error: error.message });
      return [];
    }
  }

  /**
   * Get seeds that were released (status: released) in the past week
   */
  private async getWeekReleasedSeeds(userId: string): Promise<any[]> {
    try {
      const result = await this.pool.query(
        `SELECT id, content, planted_at, updated_at
         FROM seeds
         WHERE user_id = $1
           AND status = 'released'
           AND updated_at > NOW() - INTERVAL '7 days'
         ORDER BY updated_at DESC
         LIMIT 10`,
        [userId]
      );
      return result.rows;
    } catch (error: any) {
      logger.error('[AL] Failed to get week released seeds', { error: error.message });
      return [];
    }
  }

  /**
   * Format seeds planted this week for digest
   */
  private formatWeekSeeds(seeds: any[]): string {
    if (seeds.length === 0) return '';

    return seeds
      .map((seed) => {
        const status = seed.status || 'held';
        const content = seed.content.slice(0, 120);
        const truncated = seed.content.length > 120 ? '...' : '';
        return `- "${content}${truncated}" (${status})`;
      })
      .join('\n');
  }

  /**
   * Format grown seeds for weekly digest
   */
  private formatWeekGrownSeeds(seeds: any[]): string {
    if (seeds.length === 0) return '';

    return seeds
      .map((seed) => {
        const content = seed.content.slice(0, 100);
        const truncated = seed.content.length > 100 ? '...' : '';
        const libraryTitle = seed.library_title ? ` -> "${seed.library_title}"` : '';
        return `- "${content}${truncated}"${libraryTitle}`;
      })
      .join('\n');
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
   * @deprecated Actions removed - now using seeds
   */
  private formatWeekCompletedActions(actions: any[]): string {
    if (actions.length === 0) return '';
    return actions.map((a) => `- ${a.summary || a.content}`).join('\n');
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
   * @deprecated Actions removed - now using seeds
   */
  private parseActionRow(row: any): any {
    return row;
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

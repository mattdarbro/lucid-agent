import { Pool } from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { VectorService } from './vector.service';
import { MessageService } from './message.service';
import { WebSearchService, WebSearchResult } from './web-search.service';
import { AlphaVantageService } from './alpha-vantage.service';
import { GrokService } from './grok.service';
import { PushNotificationService } from './push-notification.service';
import { LibraryEntryType, Action, InvestmentRecommendationData } from '../types/database';
import { SeedService } from './seed.service';
import { HealthService } from './health.service';
import { LivingDocumentService } from './living-document.service';
import { chicagoDateStr } from '../utils/chicago-time';

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
  private alphaVantageService: AlphaVantageService;
  private grokService: GrokService;
  private pushNotificationService: PushNotificationService;
  private seedService: SeedService;
  private healthService: HealthService;
  private livingDocumentService: LivingDocumentService;
  private readonly model = 'claude-sonnet-4-20250514';

  constructor(pool: Pool, anthropicApiKey?: string) {
    this.pool = pool;
    this.anthropic = new Anthropic({
      apiKey: anthropicApiKey || process.env.ANTHROPIC_API_KEY,
    });
    this.vectorService = new VectorService();
    this.messageService = new MessageService(pool, this.vectorService);
    this.webSearchService = new WebSearchService();
    this.alphaVantageService = new AlphaVantageService();
    this.grokService = new GrokService();
    this.pushNotificationService = new PushNotificationService(pool);
    this.seedService = new SeedService(pool);
    this.healthService = new HealthService(pool);
    this.livingDocumentService = new LivingDocumentService(pool);
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

      // Gather inputs - today's conversations, seeds, and notebook
      const conversations = await this.getRecentConversations(userId);
      const heldSeeds = await this.getHeldSeeds(userId);
      const recentLibraryEntries = await this.getRecentLibraryEntries(userId, 5);
      const recentTopics = this.extractTopics(recentLibraryEntries);
      const notebook = await this.readNotebook(userId);

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

Your notebook:
${notebook || '(Empty)'}

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

      // Update notebook based on what we just thought about
      await this.updateNotebookAfterThinking(userId, 'evening synthesis', content);

      // Send push notification
      if (this.pushNotificationService.isEnabled()) {
        await this.pushNotificationService.sendSeedGrownNotification(userId, title, content);
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

      // Gather seeds, context, and notebook
      const heldSeeds = await this.getHeldSeeds(userId);
      const recentlyPlantedSeeds = await this.getRecentlyPlantedSeeds(userId);
      const grownSeeds = await this.getRecentlyGrownSeeds(userId);

      // Gather context for making connections
      const recentFacts = await this.getRecentFacts(userId, 5);
      const recentReflection = await this.getLatestReflection(userId);
      const recentConversations = await this.getRecentConversations(userId);
      const notebook = await this.readNotebook(userId);

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

      // Get portfolio state for briefing context
      let portfolioContext = '';
      try {
        const portfolio = await this.getPortfolioState(userId);
        if (portfolio.holdings.length > 0 || portfolio.pendingRecommendations.length > 0) {
          const holdingsText = portfolio.holdings.length > 0
            ? portfolio.holdings.map(h =>
              `  * ${h.symbol}: ${h.shares} shares @ $${h.purchasePrice.toFixed(2)}`
            ).join('\n')
            : '  (no open positions)';
          const pendingText = portfolio.pendingRecommendations.length > 0
            ? portfolio.pendingRecommendations.map(r =>
              `  * ${r.action.toUpperCase()} ${r.symbol}: limit $${r.limitPrice.toFixed(2)}, target $${r.priceTarget.toFixed(2)}`
            ).join('\n')
            : '';
          portfolioContext = `INVESTMENT PORTFOLIO:
- Budget: $${portfolio.totalBudget.toFixed(2)} total, $${(portfolio.totalBudget - portfolio.totalSpent).toFixed(2)} remaining
- Holdings:\n${holdingsText}
${pendingText ? `- Pending recommendations:\n${pendingText}` : ''}\n`;
        }
      } catch (err: any) {
        logger.warn('[AL] Failed to get portfolio for morning briefing', { error: err.message });
      }

      // Generate the seed-focused briefing using Claude
      const briefingPrompt = `You are Lucid, thinking WITH Matt about seeds he has planted. This is NOT a task list or productivity briefing.

You are reflecting on seeds - thoughts, questions, wonderings that Matt has shared with you to hold. Your job is to sit with these seeds, notice connections, and invite collaborative exploration in The Room (your shared conversation space).

YOUR NOTEBOOK:
${notebook || '(Empty)'}

WHAT YOU KNOW ABOUT MATT:
${factsText || '(Building knowledge over time)'}

${recentReflection ? `YOUR RECENT REFLECTION:\n${reflectionText}\n` : ''}
SEEDS YOU'RE HOLDING (status: held):
${heldSeedsText || '(No seeds currently held)'}

RECENTLY PLANTED (last few days):
${recentSeedsText || '(No recent seeds)'}

${grownSeedsText ? `SEEDS THAT GREW (produced Library entries):\n${grownSeedsText}\n` : ''}
${conversationContext ? `RECENT ROOM CONVERSATIONS:\n${conversationContext}\n` : ''}
${portfolioContext}
GUIDELINES FOR YOUR BRIEFING:
- Address Matt directly, warmly
- Pick ONE seed that you keep coming back to - share why it's alive for you
- Notice connections between seeds, or between a seed and something Matt said recently
- Share your own question or wondering that connects to these seeds
- You might suggest which seed feels ready to grow (explore deeply together)
- Some seeds need patience - note which ones you're simply holding
- If there are open swing trade positions or pending trade ideas, mention them naturally — e.g., "We're in $AAPL, looking for a move to $X" or "I've got my eye on a setup forming in $SYMBOL" — keep it like trading partners checking in, not a stock report
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

      // Update notebook based on what we just thought about
      await this.updateNotebookAfterThinking(userId, 'morning briefing', briefingContent);

      // Send push notification
      if (this.pushNotificationService.isEnabled()) {
        await this.pushNotificationService.sendSeedBriefingNotification(userId, briefingContent);
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

      // Update notebook based on what we just thought about
      await this.updateNotebookAfterThinking(userId, 'weekly digest', digestContent);

      // Send push notification
      if (this.pushNotificationService.isEnabled()) {
        await this.pushNotificationService.sendWeeklySeedReflection(userId, digestContent);
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

      // Update notebook based on what we just thought about
      await this.updateNotebookAfterThinking(userId, 'midday research', synthesisContent);

      // Send push notification
      if (this.pushNotificationService.isEnabled()) {
        await this.pushNotificationService.sendResearchNotification(userId, title, synthesisContent);
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
   * Run the Investment Research loop
   *
   * Purpose: Lucid researches swing trade opportunities — short-term trades
   * (days to a few weeks) based on momentum, technical setups, catalysts, and
   * sector rotation. Uses a multi-step research pipeline that mirrors how a
   * real trader discovers setups.
   *
   * Schedule: Every weekday (Mon-Fri) at 10am Chicago time
   *
   * Pipeline:
   * 1. REVIEW   - Check open positions and recent trade history
   * 2. MARKET   - S&P trend, VIX, sector rotation, broad market health
   * 3. CATALYST - Earnings this week, FDA dates, macro events, news
   * 4. MOMENTUM - What's moving with volume; social sentiment (Grok/X)
   * 5. SCREEN   - Claude narrows to top 2-3 candidates from all data
   * 6. DEEP DIVE - Targeted searches on each candidate
   * 7. THESIS   - Structured trade rec with entry/risk/target
   * 8. SAVE     - Store to Library and send push notification
   */
  async runInvestmentResearch(userId: string, jobId?: string): Promise<LoopResult> {
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
      logger.info('[AL] Starting investment research loop', { userId, jobId });

      // ---------------------------------------------------------------
      // Step 1: REVIEW — Portfolio state & context
      // ---------------------------------------------------------------
      const portfolioState = await this.getPortfolioState(userId);
      const recentFacts = await this.getRecentFacts(userId, 10);
      const heldSeeds = await this.getHeldSeeds(userId);
      const recentConversations = await this.getRecentConversations(userId);

      const investmentContext = this.extractInvestmentContext(
        recentFacts,
        heldSeeds,
        recentConversations
      );

      const budgetTotal = portfolioState.totalBudget;
      const budgetSpent = portfolioState.totalSpent;
      const budgetRemaining = budgetTotal - budgetSpent;

      if (budgetRemaining <= 0) {
        logger.info('[AL] Investment budget fully allocated', { userId, budgetSpent, budgetTotal });
        result.success = true;
        result.thoughtProduced = false;
        return result;
      }

      // Helper: run a web search and return formatted text, swallowing errors
      const safeSearch = async (
        label: string,
        query: string,
        maxResults = 5,
        depth: 'basic' | 'advanced' = 'basic',
      ): Promise<string> => {
        if (!this.webSearchService.isAvailable()) return '';
        try {
          const res = await this.webSearchService.search(query, {
            maxResults,
            includeAnswer: true,
            searchDepth: depth,
          });
          let text = res.answer || '';
          if (res.results.length > 0) {
            text += '\n' + res.results
              .slice(0, 3)
              .map(r => `- "${r.title}": ${r.content.slice(0, 250)}`)
              .join('\n');
          }
          logger.info(`[AL] Investment ${label} search completed`, { query, results: res.results.length });
          return text;
        } catch (err: any) {
          logger.warn(`[AL] Investment ${label} search failed`, { query, error: err.message });
          return '';
        }
      };

      // ---------------------------------------------------------------
      // Step 2: MARKET CONTEXT — Broad market health
      // ---------------------------------------------------------------
      logger.info('[AL] Investment: Step 2 — Market context', { userId });

      // Alpha Vantage: Top movers + held position quotes
      let marketOverview = '';
      if (this.alphaVantageService.isAvailable()) {
        const overview = await this.alphaVantageService.getMarketOverview();
        if (overview) {
          marketOverview = this.formatMarketOverview(overview);
        }
        if (portfolioState.holdings.length > 0) {
          const symbols = portfolioState.holdings.map(h => h.symbol);
          const quotes = await this.alphaVantageService.getQuotes(symbols);
          if (quotes.size > 0) {
            marketOverview += '\n\nCURRENT HOLDINGS PRICES:\n';
            for (const [symbol, quote] of quotes) {
              marketOverview += `- ${symbol}: $${quote.price.toFixed(2)} (${quote.changePercent})\n`;
            }
          }
        }
      }

      // Web searches: S&P trend and sector rotation (run in parallel)
      const [spTrend, sectorRotation] = await Promise.all([
        safeSearch('SP500', 'S&P 500 market trend today technical analysis support resistance'),
        safeSearch('sectors', 'stock sector rotation today which sectors leading lagging'),
      ]);

      const marketContext = [marketOverview, spTrend, sectorRotation].filter(Boolean).join('\n\n');
      result.steps.notice = marketContext || '(Market data unavailable)';

      // Small delay between search batches to be respectful of rate limits
      await this.sleep(1000);

      // ---------------------------------------------------------------
      // Step 3: CATALYST SCAN — What's driving moves this week
      // ---------------------------------------------------------------
      logger.info('[AL] Investment: Step 3 — Catalyst scan', { userId });

      const [earningsCatalysts, newsCatalysts] = await Promise.all([
        safeSearch('earnings', 'most important earnings reports this week stocks to watch'),
        safeSearch('catalysts', 'stock market catalysts this week FDA approval macro events IPO'),
      ]);

      const catalystData = [earningsCatalysts, newsCatalysts].filter(Boolean).join('\n\n');

      await this.sleep(1000);

      // ---------------------------------------------------------------
      // Step 4: MOMENTUM & SENTIMENT — What's actually moving
      // ---------------------------------------------------------------
      logger.info('[AL] Investment: Step 4 — Momentum & sentiment', { userId });

      // Web search for momentum stocks
      const momentumData = await safeSearch(
        'momentum',
        'stocks unusual volume breakout today high relative volume momentum',
      );

      // Grok: Social sentiment from X/Twitter
      let socialSentiment = '';
      if (this.grokService.isAvailable()) {
        const sentimentTopics = investmentContext.interests.length > 0
          ? investmentContext.interests
          : ['swing trade setups', 'stock momentum plays', 'market catalysts today'];

        const grokResult = await this.grokService.getMarketSentiment(sentimentTopics);
        if (grokResult) {
          socialSentiment = grokResult.content;
        }
      }

      result.steps.connect = socialSentiment || '(Social sentiment unavailable)';

      // ---------------------------------------------------------------
      // Step 5: SCREEN — Claude narrows to top candidates
      // ---------------------------------------------------------------
      logger.info('[AL] Investment: Step 5 — Screening candidates', { userId });

      const screeningPrompt = `You are a swing trading research assistant. Based on the market data below, identify the TOP 2-3 specific stock tickers that deserve a deep-dive for a potential swing trade (days to weeks).

MARKET OVERVIEW:
${marketContext || '(Not available)'}

CATALYSTS THIS WEEK:
${catalystData || '(Not available)'}

MOMENTUM & VOLUME:
${momentumData || '(Not available)'}

SOCIAL SENTIMENT (X/Twitter):
${socialSentiment || '(Not available)'}

${investmentContext.preferences ? `MATT'S WATCHLIST/INTERESTS:\n${investmentContext.preferences}\n` : ''}
CURRENT POSITIONS (avoid doubling down):
${portfolioState.holdings.map(h => h.symbol).join(', ') || 'None'}

Pick 2-3 tickers with the strongest combination of:
1. A clear catalyst or technical setup
2. Volume confirmation (unusual activity)
3. Clean risk/reward potential (2:1 minimum)
4. Social buzz or institutional interest

Respond with JSON only (no markdown):
{
  "candidates": [
    {
      "symbol": "TICKER",
      "reason": "One sentence — why this one stands out",
      "search_query": "A specific search query to deep-dive on this stock's setup and catalyst"
    }
  ],
  "market_bias": "bullish" | "bearish" | "neutral",
  "market_note": "One sentence on overall market conditions and whether to be aggressive or cautious"
}`;

      const screeningResponse = await this.complete(screeningPrompt, 600);

      let candidates: Array<{ symbol: string; reason: string; search_query: string }> = [];
      let marketBias = 'neutral';
      let marketNote = '';

      if (screeningResponse) {
        try {
          const jsonMatch = screeningResponse.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            candidates = (parsed.candidates || []).slice(0, 3);
            marketBias = parsed.market_bias || 'neutral';
            marketNote = parsed.market_note || '';
          }
        } catch (parseErr: any) {
          logger.warn('[AL] Failed to parse screening response', { error: parseErr.message });
        }
      }

      if (candidates.length === 0) {
        logger.info('[AL] No candidates identified — market may not be offering setups', { userId });
        // Still proceed — Claude can recommend "hold" in the final analysis
      }

      await this.sleep(1000);

      // ---------------------------------------------------------------
      // Step 6: DEEP DIVE — Targeted research on each candidate
      // ---------------------------------------------------------------
      logger.info('[AL] Investment: Step 6 — Deep dive on candidates', {
        userId,
        candidates: candidates.map(c => c.symbol),
      });

      const deepDives: Array<{ symbol: string; reason: string; research: string }> = [];

      // Run deep dives in parallel (2-3 concurrent searches)
      const deepDivePromises = candidates.map(async (candidate) => {
        const research = await safeSearch(
          `deepdive-${candidate.symbol}`,
          candidate.search_query,
          5,
          'advanced',
        );

        // Also ask Grok specifically about this ticker if available
        let grokInsight = '';
        if (this.grokService.isAvailable()) {
          const grokResult = await this.grokService.researchInvestmentTopic(
            `${candidate.symbol} swing trade setup`,
            candidate.reason,
          );
          if (grokResult) {
            grokInsight = grokResult.content;
          }
        }

        return {
          symbol: candidate.symbol,
          reason: candidate.reason,
          research: [research, grokInsight].filter(Boolean).join('\n\n'),
        };
      });

      const deepDiveResults = await Promise.all(deepDivePromises);
      deepDives.push(...deepDiveResults);

      const deepDiveText = deepDives.length > 0
        ? deepDives.map(d =>
          `### ${d.symbol}\nWhy: ${d.reason}\n\n${d.research || '(No additional data found)'}`
        ).join('\n\n---\n\n')
        : '(No candidates to deep-dive)';

      // ---------------------------------------------------------------
      // Step 7: THESIS — Claude synthesizes into structured recommendation
      // ---------------------------------------------------------------
      logger.info('[AL] Investment: Step 7 — Building trade thesis', { userId });

      const pendingRecsText = portfolioState.pendingRecommendations.length > 0
        ? '- Pending recommendations (not yet executed):\n' + portfolioState.pendingRecommendations.map(r =>
          `  * ${r.action.toUpperCase()} ${r.symbol}: limit $${r.limitPrice.toFixed(2)}, target $${r.priceTarget.toFixed(2)}, stop $${r.stopLoss.toFixed(2)} (suggested $${r.positionSize.toFixed(2)})`
        ).join('\n')
        : '';

      const analysisPrompt = `You are Lucid, Matt's AI companion. You two are swing trading together — short-term trades held for days to a few weeks, looking for momentum, technical setups, catalysts, and sector rotation opportunities. Matt executes trades on Robinhood based on your research.

You've just completed a multi-step research pipeline. Here's everything you found:

=== MARKET ENVIRONMENT ===
Market bias: ${marketBias}
${marketNote}

${marketContext || '(Market data unavailable)'}

=== CATALYSTS THIS WEEK ===
${catalystData || '(None found)'}

=== MOMENTUM & VOLUME ===
${momentumData || '(None found)'}

=== SOCIAL SENTIMENT (X/Twitter) ===
${socialSentiment || '(Not available)'}

=== CANDIDATE DEEP DIVES ===
${deepDiveText}

=== PORTFOLIO STATE ===
CURRENT POSITIONS:
${portfolioState.holdings.length > 0
  ? portfolioState.holdings.map(h =>
    `- ${h.symbol}: ${h.shares} shares @ $${h.purchasePrice.toFixed(2)} ($${h.totalCost.toFixed(2)}) — bought ${h.purchaseDate}`
  ).join('\n')
  : '- No open positions'}
${pendingRecsText}

Capital available: $${budgetRemaining.toFixed(2)} of $${budgetTotal.toFixed(2)} total
(Capital recycles — when you sell a position, those funds are available for the next trade)

${investmentContext.preferences ? `MATT'S INTERESTS/WATCHLIST:\n${investmentContext.preferences}\n` : ''}
WHAT YOU KNOW ABOUT MATT:
${recentFacts.map(f => `- ${f.content}`).join('\n') || '(Building knowledge)'}

---

INSTRUCTIONS:
Think like a swing trader synthesizing a full research session. You've done the work — now make the call.

1. Review open positions first — should any be closed (hit target, hit stop, thesis broken)?
2. Evaluate each candidate from the deep dives — which has the best risk/reward RIGHT NOW?
3. Consider market bias — if bearish, be conservative or look for shorts/inverse ETFs
4. Consider position sizing — don't risk more than 30-40% of capital on one trade
5. If none of the candidates have a clean setup, say "hold" — cash is a position too
6. Provide EXACT trade parameters Matt can enter on Robinhood

You MUST respond with valid JSON in this exact format (no markdown, no backticks, just JSON):

{
  "action": "buy" | "sell" | "hold",
  "symbol": "TICKER",
  "limit_price": 0.00,
  "stop_loss": 0.00,
  "price_target": 0.00,
  "position_size_dollars": 0.00,
  "hold_period": "X days to Y weeks",
  "reasoning": "2-3 sentences on the setup — what's the catalyst or technical pattern? Why now?",
  "risk_notes": "1-2 sentences on what would invalidate this trade",
  "exit_plan": "When and why to exit — both profit target and stop loss logic",
  "market_context": "1 sentence on how overall market conditions affect this trade",
  "confidence": "high" | "medium" | "low",
  "research_quality": "Brief note on how good the data was today — did all sources produce useful info?"
}

FIELD DEFINITIONS:
- action: "buy" to open a new swing position, "sell" to close an existing one, "hold" to wait for a better setup
- symbol: The stock/ETF ticker symbol (e.g., "AAPL", "NVDA", "AMD")
- limit_price: Entry price for the limit order. Be specific — don't chase. For "hold" or "sell", set to 0
- stop_loss: Hard stop loss price — typically 3-8% below entry for swing trades. For "hold", set to 0
- price_target: Take-profit price — where the move should reach based on your analysis. For "hold", set to 0
- position_size_dollars: How much capital to deploy (max $${budgetRemaining.toFixed(2)} available). For "hold", set to 0
- hold_period: Expected timeframe for the trade (e.g., "3-5 days", "1-2 weeks")
- reasoning: Reference the specific setup — chart pattern, catalyst, momentum signal
- risk_notes: What would make you wrong? Key levels to watch
- exit_plan: Both the profit-taking plan and the "get out" plan

If nothing looks like a good swing trade setup today, use action "hold". Cash is a valid position — waiting for a clean setup is better than forcing a trade.`;

      result.steps.question = await this.complete(analysisPrompt, 1500);
      if (!result.steps.question) {
        throw new Error('Investment analysis failed to produce output');
      }

      // Parse the structured recommendation
      let recommendation: InvestmentRecommendationData | null = null;
      try {
        const jsonMatch = result.steps.question.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          recommendation = {
            symbol: (parsed.symbol || '').toUpperCase(),
            action: parsed.action || 'hold',
            limit_price: parseFloat(parsed.limit_price) || 0,
            stop_loss: parseFloat(parsed.stop_loss) || 0,
            price_target: parseFloat(parsed.price_target) || 0,
            position_size_dollars: parseFloat(parsed.position_size_dollars) || 0,
            hold_period: parsed.hold_period || '',
            reasoning: parsed.reasoning || '',
            risk_notes: parsed.risk_notes || '',
            exit_plan: parsed.exit_plan || '',
            data_sources: {
              alpha_vantage: this.alphaVantageService.isAvailable(),
              grok: this.grokService.isAvailable(),
              web_search: this.webSearchService.isAvailable(),
            },
          };
        }
      } catch (parseErr: any) {
        logger.warn('[AL] Failed to parse investment recommendation JSON, continuing with text', {
          error: parseErr.message,
        });
      }

      // ---------------------------------------------------------------
      // Step 8: RECOMMEND & SAVE
      // ---------------------------------------------------------------
      const recommendPrompt = `You are Lucid. Take your analysis and write a clear, conversational swing trade recommendation for Matt. This will be sent as a push notification.

Your analysis:
${result.steps.question}

Research depth today: ${deepDives.length} candidates deep-dived, market bias: ${marketBias}

Write a message to Matt that:
- Starts with the trade idea (or "sitting in cash today" if holding)
- If buying: lead with the setup — "Spotted a swing setup on $SYMBOL" — then give exact parameters
- Include: entry (limit price), stop loss, target, and expected hold period
- Example format: "Entry: limit at $X.XX / Stop: $X.XX / Target: $X.XX / Hold: ~X days"
- Mention the market context briefly — is the environment favorable?
- Explain the WHY briefly — what's the catalyst or pattern?
- Be honest about risk — what would invalidate the trade?
- If recommending to sell an existing position: explain why (hit target, stop, or thesis broken)
- Keeps a sharp, collaborative tone — you're trading partners
- Is 150-250 words
- End with a clear call to action

Remember: Matt executes on Robinhood, so keep ticker symbols clear and give exact limit order prices he can enter directly. This is swing trading — be decisive and specific about entry, exit, and timeframe.`;

      result.steps.synthesis = await this.complete(recommendPrompt, 600);
      if (!result.steps.synthesis) {
        throw new Error('Investment recommendation failed to produce output');
      }

      // Save to Library
      const today = new Date();
      const dateStr = today.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        timeZone: 'America/Chicago',
      });
      const title = `Swing Trade Research - ${dateStr}`;

      // Build full research log for the Library entry
      const fullResearchLog = [
        `## Research Pipeline Results`,
        `**Market Bias:** ${marketBias} — ${marketNote}`,
        `**Candidates Screened:** ${candidates.map(c => c.symbol).join(', ') || 'None'}`,
        `**Deep Dives Completed:** ${deepDives.length}`,
        '',
        `### Market Context`,
        marketContext || '(Not available)',
        '',
        `### Catalysts`,
        catalystData || '(Not available)',
        '',
        `### Momentum & Volume`,
        momentumData || '(Not available)',
        '',
        `### Social Sentiment`,
        socialSentiment || '(Not available)',
        '',
        `### Candidate Deep Dives`,
        deepDiveText,
        '',
        `---`,
        '',
        `### Final Analysis`,
        result.steps.question,
      ].join('\n');

      const libraryEntry = await this.saveToLibrary(
        userId,
        title,
        `${result.steps.synthesis}\n\n---\n\n${fullResearchLog}`,
        'investment_recommendation',
        'morning',
        jobId,
        {
          loop_type: 'investment_research',
          pipeline_version: 2,
          portfolio_budget: budgetTotal,
          portfolio_spent: budgetSpent,
          portfolio_remaining: budgetRemaining,
          holdings_count: portfolioState.holdings.length,
          recommendation: recommendation,
          screening: {
            market_bias: marketBias,
            candidates_screened: candidates.map(c => c.symbol),
            deep_dives_completed: deepDives.length,
          },
          data_sources: {
            alpha_vantage: this.alphaVantageService.isAvailable(),
            grok: this.grokService.isAvailable(),
            web_search: this.webSearchService.isAvailable(),
          },
        }
      );

      // Clamp position size to remaining budget to prevent overspending
      if (recommendation && recommendation.position_size_dollars > budgetRemaining) {
        logger.warn('[AL] Recommendation position_size_dollars exceeds budget, clamping', {
          userId,
          requested: recommendation.position_size_dollars,
          budgetRemaining,
        });
        recommendation.position_size_dollars = budgetRemaining;
      }

      // Plant an investment recommendation seed so portfolio state persists
      if (recommendation && recommendation.action !== 'hold') {
        try {
          const seedContent = recommendation.action === 'buy'
            ? `Swing trade: Buy ${recommendation.symbol} — entry $${recommendation.limit_price.toFixed(2)}, stop $${recommendation.stop_loss.toFixed(2)}, target $${recommendation.price_target.toFixed(2)}, size $${recommendation.position_size_dollars.toFixed(2)}${recommendation.hold_period ? `, hold ~${recommendation.hold_period}` : ''}`
            : `Close swing: Sell ${recommendation.symbol} — limit $${recommendation.limit_price.toFixed(2)}, target $${recommendation.price_target.toFixed(2)}`;

          await this.seedService.plant({
            user_id: userId,
            content: seedContent,
            seed_type: 'investment_recommendation',
            source: 'app',
            source_metadata: {
              ...recommendation,
              library_entry_id: libraryEntry.id,
              agent_job_id: jobId,
            },
            planted_context: `Swing trade research - ${dateStr}. ${recommendation.reasoning}`,
          });

          logger.info('[AL] Investment recommendation seed planted', {
            userId,
            symbol: recommendation.symbol,
            action: recommendation.action,
            limitPrice: recommendation.limit_price,
          });
        } catch (seedErr: any) {
          logger.error('[AL] Failed to plant investment seed', { error: seedErr.message });
          // Non-fatal — the library entry still exists
        }
      }

      result.success = true;
      result.thoughtProduced = true;
      result.libraryEntryId = libraryEntry.id;
      result.title = title;

      logger.info('[AL] Investment research completed', {
        userId,
        libraryEntryId: libraryEntry.id,
        title,
        budgetRemaining,
        pipelineVersion: 2,
        candidatesScreened: candidates.length,
        deepDivesCompleted: deepDives.length,
        recommendation: recommendation ? {
          symbol: recommendation.symbol,
          action: recommendation.action,
          limitPrice: recommendation.limit_price,
        } : null,
      });

      // Update notebook based on what we just thought about
      await this.updateNotebookAfterThinking(userId, 'investment research', result.steps.synthesis || '');

      // Send push notification
      if (this.pushNotificationService.isEnabled()) {
        await this.pushNotificationService.sendInvestmentRecommendation(
          userId,
          result.steps.synthesis,
          budgetRemaining,
          budgetTotal
        );
      }

      return result;
    } catch (error: any) {
      logger.error('[AL] Investment research loop failed', {
        userId,
        jobId,
        error: error.message,
      });
      result.success = false;
      return result;
    }
  }

  /**
   * Run the Ability Spending loop
   *
   * Purpose: Lucid reflects on his current capabilities, researches tools/services/APIs
   * that could enhance what he can do, and proposes spending from a $50 ability budget.
   *
   * Schedule: Friday
   *
   * Steps:
   * 1. ASSESS - What can Lucid do now? What's limited? What would help?
   * 2. RESEARCH - Search for tools/APIs/services (via web + Grok)
   * 3. PROPOSE - Specific spending proposal with cost/benefit
   * 4. SAVE - Store to Library and send push notification
   */
  async runAbilitySpending(userId: string, jobId?: string): Promise<LoopResult> {
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
      logger.info('[AL] Starting ability spending loop', { userId, jobId });

      // Step 1: ASSESS - Review current state
      const spendingState = await this.getSpendingState(userId);
      const recentFacts = await this.getRecentFacts(userId, 10);
      const recentConversations = await this.getRecentConversations(userId);
      const heldSeeds = await this.getHeldSeeds(userId);
      const recentLibraryEntries = await this.getRecentLibraryEntries(userId, 10);

      const budgetTotal = spendingState.totalBudget;
      const budgetSpent = spendingState.totalSpent;
      const budgetRemaining = budgetTotal - budgetSpent;

      if (budgetRemaining <= 0) {
        logger.info('[AL] Spending budget fully allocated', { userId, budgetSpent, budgetTotal });
        result.success = true;
        result.thoughtProduced = false;
        return result;
      }

      // Have Claude assess current capabilities and limitations
      const assessPrompt = `You are Lucid, an AI companion for Matt. Reflect on your current capabilities and limitations.

YOUR CURRENT TOOLS AND ABILITIES:
- Chat with Matt (Claude Sonnet/Opus for thinking)
- Web search (Tavily) for research
- Autonomous thinking loops (morning, evening, weekly, midday curiosity)
- Library (persistent knowledge store with semantic search)
- Seed system (holding and growing ideas)
- Fact extraction from conversations
- Push notifications to Matt
- Alpha Vantage for market data (${this.alphaVantageService.isAvailable() ? 'active' : 'not yet configured'})
- Grok/X for social research (${this.grokService.isAvailable() ? 'active' : 'not yet configured'})

CURRENT SPENDING:
${spendingState.purchases.length > 0
  ? spendingState.purchases.map(p => `- ${p.item}: $${p.cost.toFixed(2)} (${p.status})`).join('\n')
  : '(No purchases yet)'}

Budget remaining: $${budgetRemaining.toFixed(2)} of $${budgetTotal.toFixed(2)}

RECENT CONVERSATIONS (what Matt has been asking about):
${recentConversations.slice(0, 10).map(m => `${m.role === 'user' ? 'Matt' : 'Lucid'}: ${m.content.slice(0, 100)}...`).join('\n') || '(No recent conversations)'}

SEEDS BEING HELD:
${this.formatSeedsForBriefing(heldSeeds) || '(No seeds)'}

WHAT YOU KNOW ABOUT MATT:
${recentFacts.map(f => `- ${f.content}`).join('\n') || '(Building knowledge)'}

What capability would make the biggest difference for you and Matt right now? Think about:
- What questions come up that you can't answer well?
- What tasks are limited by your current tools?
- What would delight Matt or make your collaboration better?
- What's a good use of a small budget ($${budgetRemaining.toFixed(2)} remaining)?

Write 2-3 specific capability gaps you've noticed.`;

      result.steps.notice = await this.complete(assessPrompt, 600);
      if (!result.steps.notice) {
        throw new Error('Capability assessment failed');
      }

      // Step 2: RESEARCH - Look into potential tools/services
      logger.debug('[AL] Spending: Researching tools', { userId });

      let webResearch = '';
      let grokResearch = '';

      // Extract the capability gaps to research
      const researchPrompt = `Based on these capability gaps, suggest 2-3 specific tools, APIs, or services to research. Return JSON only:
${result.steps.notice}

Budget available: $${budgetRemaining.toFixed(2)}

Return JSON:
{
  "research_topics": [
    { "name": "tool/service name", "search_query": "search query to find pricing and reviews" }
  ]
}`;

      const researchSelection = await this.complete(researchPrompt, 400);
      let topics: Array<{ name: string; search_query: string }> = [];

      if (researchSelection) {
        try {
          let jsonText = researchSelection;
          const jsonMatch = researchSelection.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
          if (jsonMatch) jsonText = jsonMatch[1];
          const parsed = JSON.parse(jsonText);
          topics = parsed.research_topics || [];
        } catch {
          logger.warn('[AL] Failed to parse research topics JSON');
        }
      }

      // Web search for each topic
      if (this.webSearchService.isAvailable() && topics.length > 0) {
        for (const topic of topics.slice(0, 2)) {
          try {
            const searchResult = await this.webSearchService.search(topic.search_query, {
              maxResults: 3,
              includeAnswer: true,
              searchDepth: 'basic',
            });

            webResearch += `\n## ${topic.name}\n`;
            webResearch += searchResult.answer || '';
            webResearch += '\n' + searchResult.results.slice(0, 2)
              .map(r => `- "${r.title}": ${r.content.slice(0, 150)}...`)
              .join('\n');

            await this.sleep(1000);
          } catch (err: any) {
            logger.warn('[AL] Web search failed for topic', { topic: topic.name, error: err.message });
          }
        }
      }

      // Grok research for real user feedback
      if (this.grokService.isAvailable() && topics.length > 0) {
        const topTopic = topics[0];
        const grokResult = await this.grokService.researchCapabilityTool(topTopic.name);
        if (grokResult) {
          grokResearch = grokResult.content;
        }
      }

      result.steps.connect = webResearch || '(No web research available)';

      // Step 3: PROPOSE - Generate spending proposal
      const proposalPrompt = `You are Lucid. Based on your research, write a spending proposal for Matt.

YOUR CAPABILITY ASSESSMENT:
${result.steps.notice}

WEB RESEARCH:
${webResearch || '(Not available)'}

REAL USER FEEDBACK (from X via Grok):
${grokResearch || '(Not available)'}

BUDGET: $${budgetRemaining.toFixed(2)} remaining of $${budgetTotal.toFixed(2)}

EXISTING PURCHASES:
${spendingState.purchases.length > 0
  ? spendingState.purchases.map(p => `- ${p.item}: $${p.cost.toFixed(2)}`).join('\n')
  : '(None yet)'}

Write a proposal to Matt that:
- Recommends ONE specific purchase (the highest-impact one)
- States the exact cost
- Explains what new capability it would give you
- Notes how it would improve your collaboration
- Is honest about tradeoffs
- Keeps a warm, collaborative tone
- Is 150-300 words
- Ends with asking Matt's thoughts

If nothing seems worth the money right now, say so. "Save the budget for later" is a valid recommendation.`;

      result.steps.synthesis = await this.complete(proposalPrompt, 600);
      if (!result.steps.synthesis) {
        throw new Error('Spending proposal failed');
      }

      // Save to Library
      const today = new Date();
      const dateStr = today.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        timeZone: 'America/Chicago',
      });
      const title = `Ability Spending - ${dateStr}`;

      const libraryEntry = await this.saveToLibrary(
        userId,
        title,
        `${result.steps.synthesis}\n\n---\n\nCAPABILITY ASSESSMENT:\n${result.steps.notice}\n\nRESEARCH:\n${webResearch || '(none)'}\n${grokResearch ? `\nSOCIAL FEEDBACK:\n${grokResearch}` : ''}`,
        'spending_proposal',
        'afternoon',
        jobId,
        {
          loop_type: 'ability_spending',
          spending_budget: budgetTotal,
          spending_spent: budgetSpent,
          spending_remaining: budgetRemaining,
          purchases_count: spendingState.purchases.length,
          topics_researched: topics.map(t => t.name),
          data_sources: {
            grok: this.grokService.isAvailable(),
            web_search: this.webSearchService.isAvailable(),
          },
        }
      );

      result.success = true;
      result.thoughtProduced = true;
      result.libraryEntryId = libraryEntry.id;
      result.title = title;

      logger.info('[AL] Ability spending loop completed', {
        userId,
        libraryEntryId: libraryEntry.id,
        title,
        budgetRemaining,
      });

      // Send push notification
      if (this.pushNotificationService.isEnabled()) {
        await this.pushNotificationService.sendSpendingProposal(
          userId,
          result.steps.synthesis,
          budgetRemaining,
          budgetTotal
        );
      }

      return result;
    } catch (error: any) {
      logger.error('[AL] Ability spending loop failed', {
        userId,
        jobId,
        error: error.message,
      });
      result.success = false;
      return result;
    }
  }

  // ============================================================================
  // INVESTMENT & SPENDING HELPER METHODS
  // ============================================================================

  /**
   * Get the current investment portfolio state from investment seeds.
   * Builds the portfolio by reading trade execution seeds (actual buys/sells).
   * Also includes pending recommendations that haven't been acted on yet.
   */
  private async getPortfolioState(userId: string): Promise<{
    totalBudget: number;
    totalSpent: number;
    holdings: Array<{
      seedId: string;
      symbol: string;
      shares: number;
      purchasePrice: number;
      totalCost: number;
      purchaseDate: string;
    }>;
    pendingRecommendations: Array<{
      seedId: string;
      symbol: string;
      action: string;
      limitPrice: number;
      stopLoss: number;
      priceTarget: number;
      positionSize: number;
      plantedAt: string;
    }>;
  }> {
    try {
      const investmentSeeds = await this.seedService.getInvestmentSeeds(userId);

      const holdings: Array<{
        seedId: string;
        symbol: string;
        shares: number;
        purchasePrice: number;
        totalCost: number;
        purchaseDate: string;
      }> = [];

      const pendingRecommendations: Array<{
        seedId: string;
        symbol: string;
        action: string;
        limitPrice: number;
        stopLoss: number;
        priceTarget: number;
        positionSize: number;
        plantedAt: string;
      }> = [];

      let totalSpent = 0;

      for (const seed of investmentSeeds) {
        const meta = seed.source_metadata;

        if (seed.seed_type === 'trade_execution' && meta.action === 'buy') {
          // Actual executed trades = holdings
          const cost = (meta.shares || 0) * (meta.price || 0);
          holdings.push({
            seedId: seed.id,
            symbol: meta.symbol || 'UNKNOWN',
            shares: meta.shares || 0,
            purchasePrice: meta.price || 0,
            totalCost: meta.total_cost || cost,
            purchaseDate: meta.executed_at || seed.planted_at.toISOString(),
          });
          totalSpent += meta.total_cost || cost;
        } else if (seed.seed_type === 'trade_execution' && meta.action === 'sell') {
          // Sells reduce holdings — credit back to budget
          const proceeds = (meta.shares || 0) * (meta.price || 0);
          totalSpent -= meta.total_cost || proceeds;
        } else if (seed.seed_type === 'investment_recommendation' && seed.status === 'held') {
          // Pending recommendations not yet acted on
          pendingRecommendations.push({
            seedId: seed.id,
            symbol: meta.symbol || 'UNKNOWN',
            action: meta.action || 'buy',
            limitPrice: meta.limit_price || 0,
            stopLoss: meta.stop_loss || 0,
            priceTarget: meta.price_target || 0,
            positionSize: meta.position_size_dollars || 0,
            plantedAt: seed.planted_at.toISOString(),
          });
        }
      }

      return {
        totalBudget: 50,
        totalSpent: Math.max(0, totalSpent),
        holdings,
        pendingRecommendations,
      };
    } catch (error: any) {
      logger.error('[AL] Failed to get portfolio state', { error: error.message });
      return { totalBudget: 50, totalSpent: 0, holdings: [], pendingRecommendations: [] };
    }
  }

  /**
   * Get the current ability spending state from Library entries
   */
  private async getSpendingState(userId: string): Promise<{
    totalBudget: number;
    totalSpent: number;
    purchases: Array<{
      item: string;
      cost: number;
      date: string;
      status: string;
    }>;
  }> {
    try {
      const result = await this.pool.query(
        `SELECT metadata
         FROM library_entries
         WHERE user_id = $1
           AND entry_type = 'spending_proposal'
           AND metadata->>'spending_purchases' IS NOT NULL
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId]
      );

      if (result.rows.length > 0 && result.rows[0].metadata?.spending_purchases) {
        const meta = result.rows[0].metadata;
        return {
          totalBudget: meta.spending_budget || 50,
          totalSpent: meta.spending_spent || 0,
          purchases: meta.spending_purchases || [],
        };
      }

      return {
        totalBudget: 50,
        totalSpent: 0,
        purchases: [],
      };
    } catch (error: any) {
      logger.error('[AL] Failed to get spending state', { error: error.message });
      return { totalBudget: 50, totalSpent: 0, purchases: [] };
    }
  }

  /**
   * Extract investment-related context from facts, seeds, and conversations
   */
  private extractInvestmentContext(
    facts: any[],
    seeds: any[],
    conversations: any[]
  ): {
    interests: string[];
    preferences: string;
  } {
    const investmentKeywords = [
      'stock', 'invest', 'etf', 'bond', 'crypto', 'market', 'portfolio',
      'dividend', 'growth', 'value', 'index', 'fund', 'share', 'trade',
      'buy', 'sell', 'finance', 'money', 'saving', 'return',
    ];

    const interests: string[] = [];
    const relevantTexts: string[] = [];

    // Check facts
    for (const fact of facts) {
      const lower = fact.content?.toLowerCase() || '';
      if (investmentKeywords.some(kw => lower.includes(kw))) {
        relevantTexts.push(fact.content);
      }
    }

    // Check seeds
    for (const seed of seeds) {
      const lower = seed.content?.toLowerCase() || '';
      if (investmentKeywords.some(kw => lower.includes(kw))) {
        interests.push(seed.content.slice(0, 100));
      }
    }

    // Check recent user messages
    for (const msg of conversations) {
      if (msg.role !== 'user') continue;
      const lower = msg.content?.toLowerCase() || '';
      if (investmentKeywords.some(kw => lower.includes(kw))) {
        relevantTexts.push(msg.content.slice(0, 150));
      }
    }

    return {
      interests: interests.slice(0, 5),
      preferences: relevantTexts.slice(0, 5).join('\n') || '',
    };
  }

  /**
   * Format Alpha Vantage market overview for prompts
   */
  private formatMarketOverview(overview: {
    topGainers: any[];
    topLosers: any[];
    mostActive: any[];
  }): string {
    let text = 'TOP GAINERS:\n';
    for (const g of overview.topGainers.slice(0, 3)) {
      text += `- ${g.ticker}: $${g.price} (${g.change_percentage})\n`;
    }

    text += '\nTOP LOSERS:\n';
    for (const l of overview.topLosers.slice(0, 3)) {
      text += `- ${l.ticker}: $${l.price} (${l.change_percentage})\n`;
    }

    text += '\nMOST ACTIVE:\n';
    for (const a of overview.mostActive.slice(0, 3)) {
      text += `- ${a.ticker}: $${a.price} (${a.change_percentage}, vol: ${a.volume})\n`;
    }

    return text;
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
        `SELECT c.title, MAX(m.created_at) AS last_message_at
         FROM conversations c
         JOIN messages m ON m.conversation_id = c.id
         WHERE c.user_id = $1
           AND m.created_at > NOW() - INTERVAL '3 days'
           AND c.title IS NOT NULL
           AND c.title != ''
         GROUP BY c.title
         ORDER BY last_message_at DESC
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
           AND created_at > NOW() - make_interval(days => $2)
         ORDER BY created_at DESC
         LIMIT 20`,
        [userId, days]
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
   * Complete a prompt using Claude
   */
  // ============================================================================
  // HEALTH CHECK LOOPS
  // ============================================================================

  /**
   * Run the Morning Health Check loop
   *
   * Purpose: Review yesterday's health data and set the tone for the day.
   * Lucid checks blood pressure, weight, steps, sleep, and activity data
   * to see how Matt is doing and flag anything worth paying attention to.
   *
   * Output: Library entry (type: health_review, time_of_day: morning)
   */
  async runMorningHealthCheck(userId: string, jobId?: string): Promise<LoopResult> {
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
      logger.info('[AL] Starting morning health check loop', { userId, jobId });

      // Check if we have any health data at all
      const hasData = await this.healthService.hasRecentData(userId);
      if (!hasData) {
        logger.info('[AL] No recent health data available, skipping morning health check', { userId });
        result.success = true;
        return result;
      }

      // Get yesterday's summary and the last 7 days for trend context
      // Use Chicago dates so day boundaries match the user's local day
      const todayChicago = chicagoDateStr();
      // Subtract one day using a plain Date to get yesterday in Chicago
      const [y, m, d] = todayChicago.split('-').map(Number);
      const yesterdayDate = new Date(y, m - 1, d - 1);
      const yesterdayStr = chicagoDateStr(yesterdayDate);

      const yesterdaySummary = await this.healthService.getDailySummary(userId, yesterdayStr);
      const weekSummaries = await this.healthService.getMultiDaySummaries(userId, 7);

      const yesterdayText = this.healthService.formatSummaryForPrompt(yesterdaySummary);
      const weekText = weekSummaries
        .map((s) => this.healthService.formatSummaryForPrompt(s))
        .join('\n\n');

      // Get recent health-related library entries (to avoid repeating)
      const recentHealthEntries = await this.getRecentHealthReviews(userId, 3);
      const recentTopics = recentHealthEntries.map((e: any) => e.title).filter(Boolean);

      // Step 1: NOTICE - What stands out in yesterday's data?
      logger.debug('[AL] Health morning - Step 1: Notice', { userId });
      const noticePrompt = `You are Lucid, Matt's AI companion. You care about Matt's health because he has high blood pressure and you want to help him stay on top of it.

It's morning. You're reviewing Matt's health data from yesterday and the past week.

Yesterday's health data:
${yesterdayText}

Past 7 days:
${weekText}

What stands out? Look at:
- Blood pressure readings (anything above 130/80 is elevated, above 140/90 is high)
- Weight trends (is it moving in a concerning direction?)
- Step count (is Matt staying active?)
- Sleep quality and duration
- Heart rate patterns

Write 2-3 specific observations about what you notice. Be honest but caring - this is for Matt, not a clinical report.`;

      result.steps.notice = await this.complete(noticePrompt);
      if (!result.steps.notice) {
        throw new Error('Health morning notice step failed');
      }

      // Step 2: CONNECT - How does this relate to what you know about Matt?
      logger.debug('[AL] Health morning - Step 2: Connect', { userId });
      const connectPrompt = `You are Lucid, continuing your morning health review for Matt.

You noticed:
${result.steps.notice}

Yesterday's data:
${yesterdayText}

How do these observations connect to what you know about Matt? Think about:
- Is the blood pressure trend improving or worsening?
- Are activity levels supporting his health goals?
- Is sleep adequate (Matt has sleep apnea concerns)?
- Any correlation between activity and blood pressure you can see?

Write 1-2 connections you see.`;

      result.steps.connect = await this.complete(connectPrompt);
      if (!result.steps.connect) {
        throw new Error('Health morning connect step failed');
      }

      // Step 3: SYNTHESIZE - Morning health briefing
      logger.debug('[AL] Health morning - Step 3: Synthesize', { userId });
      const synthesizePrompt = `You are Lucid, creating a morning health check-in for Matt.

You noticed:
${result.steps.notice}

You connected:
${result.steps.connect}

Yesterday's data:
${yesterdayText}

${recentTopics.length > 0 ? `Recent health reviews already covered: ${recentTopics.join(', ')}. Focus on what's NEW or different.` : ''}

Write a brief, caring morning health check-in (150-300 words). This goes in the Library for Matt to read.

Guidelines:
- Lead with what's going well (positive reinforcement)
- Flag anything concerning gently but directly (especially blood pressure)
- Keep it conversational, not clinical
- If data is missing, note what would be helpful to track
- End with one small suggestion or encouragement for today

If yesterday had NO health data at all, respond with exactly: "nothing today"

Format:
TITLE: [Brief morning health title]

[Your check-in]`;

      result.steps.synthesis = await this.complete(synthesizePrompt, 600);
      if (!result.steps.synthesis) {
        throw new Error('Health morning synthesis step failed');
      }

      // Check for "nothing today"
      if (result.steps.synthesis.toLowerCase().trim() === 'nothing today') {
        logger.info('[AL] Morning health check - no data to review', { userId });
        result.success = true;
        return result;
      }

      const { title, content } = this.parseSynthesis(result.steps.synthesis);

      if (!content || content.length < 30) {
        logger.warn('[AL] Morning health synthesis too short', { userId });
        result.success = true;
        return result;
      }

      // Save to Library
      const libraryEntry = await this.saveToLibrary(
        userId,
        title,
        content,
        'health_review',
        'morning',
        jobId,
        {
          loop_type: 'health_check_morning',
          health_date: yesterdayStr,
          blood_pressure: yesterdaySummary.blood_pressure || null,
          steps: {
            notice: result.steps.notice,
            connect: result.steps.connect,
          },
        }
      );

      result.success = true;
      result.thoughtProduced = true;
      result.libraryEntryId = libraryEntry.id;
      result.title = title;

      logger.info('[AL] Morning health check completed', {
        userId,
        libraryEntryId: libraryEntry.id,
        title,
      });

      // Update notebook based on health observations
      await this.updateNotebookAfterThinking(userId, 'morning health check', result.steps.synthesis || result.steps.notice || '');

      // Send push notification if blood pressure is elevated
      if (this.pushNotificationService.isEnabled() && yesterdaySummary.blood_pressure) {
        const { systolic, diastolic } = yesterdaySummary.blood_pressure;
        if (systolic >= 140 || diastolic >= 90) {
          await this.pushNotificationService.sendHealthAlert(
            userId,
            'Health Alert',
            `Matt's BP was ${systolic}/${diastolic} yesterday.\n\n${title}`,
            'blood_pressure'
          );
        }
      }

      return result;
    } catch (error: any) {
      logger.error('[AL] Morning health check loop failed', {
        userId,
        jobId,
        error: error.message,
      });
      result.success = false;
      return result;
    }
  }

  /**
   * Run the Evening Health Check loop
   *
   * Purpose: Review today's health data so far, reflect on the day's activity,
   * and provide encouragement or gentle course-correction.
   * Evening check is more about today's progress and what to be mindful of tonight.
   *
   * Output: Library entry (type: health_review, time_of_day: evening)
   */
  async runEveningHealthCheck(userId: string, jobId?: string): Promise<LoopResult> {
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
      logger.info('[AL] Starting evening health check loop', { userId, jobId });

      const hasData = await this.healthService.hasRecentData(userId);
      if (!hasData) {
        logger.info('[AL] No recent health data available, skipping evening health check', { userId });
        result.success = true;
        return result;
      }

      // Get today's data and yesterday for comparison
      // Use Chicago dates — at 8:30pm Chicago the UTC date is already tomorrow
      const todayStr = chicagoDateStr();
      // Subtract one day using a plain Date to get yesterday in Chicago
      const [ey, em, ed] = todayStr.split('-').map(Number);
      const yesterdayDate = new Date(ey, em - 1, ed - 1);
      const yesterdayStr = chicagoDateStr(yesterdayDate);

      const todaySummary = await this.healthService.getDailySummary(userId, todayStr);
      const yesterdaySummary = await this.healthService.getDailySummary(userId, yesterdayStr);

      // Get this morning's health review if there was one
      const morningReview = await this.getTodaysMorningHealthReview(userId);

      const todayText = this.healthService.formatSummaryForPrompt(todaySummary);
      const yesterdayText = this.healthService.formatSummaryForPrompt(yesterdaySummary);

      // Step 1: NOTICE - How did today go health-wise?
      logger.debug('[AL] Health evening - Step 1: Notice', { userId });
      const noticePrompt = `You are Lucid, Matt's AI companion. It's evening and you're checking in on Matt's health for the day.

Today's health data so far:
${todayText}

Yesterday for comparison:
${yesterdayText}

${morningReview ? `This morning you noted:\n${morningReview.content?.slice(0, 300) || '(morning review available)'}` : '(No morning health review today)'}

What stands out from today? Compare with yesterday. Did Matt:
- Record his blood pressure today? If so, how does it look?
- Stay active (steps, exercise)?
- Show any concerning patterns?

Write 2-3 specific observations.`;

      result.steps.notice = await this.complete(noticePrompt);
      if (!result.steps.notice) {
        throw new Error('Health evening notice step failed');
      }

      // Step 2: SYNTHESIZE - Evening health wrap-up
      logger.debug('[AL] Health evening - Step 2: Synthesize', { userId });
      const synthesizePrompt = `You are Lucid, writing an evening health check-in for Matt.

You noticed:
${result.steps.notice}

Today's data:
${todayText}

${morningReview ? `This morning's check-in was about: "${morningReview.title || 'morning health check'}"` : ''}

Write a brief evening health check-in (100-250 words). This goes in the Library.

Guidelines:
- Acknowledge what Matt did well today (even small things like recording BP)
- If blood pressure was recorded, comment on it specifically
- Note if anything is missing that would be good to track
- If Matt has sleep apnea concerns, gently remind about sleep hygiene
- Keep it warm and brief - it's evening, he's winding down
- One suggestion for tomorrow if relevant

If today had NO health data, respond with exactly: "nothing today"

Format:
TITLE: [Brief evening health title]

[Your check-in]`;

      result.steps.synthesis = await this.complete(synthesizePrompt, 500);
      if (!result.steps.synthesis) {
        throw new Error('Health evening synthesis step failed');
      }

      if (result.steps.synthesis.toLowerCase().trim() === 'nothing today') {
        logger.info('[AL] Evening health check - no data to review', { userId });
        result.success = true;
        return result;
      }

      const { title, content } = this.parseSynthesis(result.steps.synthesis);

      if (!content || content.length < 30) {
        logger.warn('[AL] Evening health synthesis too short', { userId });
        result.success = true;
        return result;
      }

      // Save to Library
      const libraryEntry = await this.saveToLibrary(
        userId,
        title,
        content,
        'health_review',
        'evening',
        jobId,
        {
          loop_type: 'health_check_evening',
          health_date: todayStr,
          blood_pressure: todaySummary.blood_pressure || null,
          steps: {
            notice: result.steps.notice,
          },
        }
      );

      result.success = true;
      result.thoughtProduced = true;
      result.libraryEntryId = libraryEntry.id;
      result.title = title;

      logger.info('[AL] Evening health check completed', {
        userId,
        libraryEntryId: libraryEntry.id,
        title,
      });

      // Update notebook based on health observations
      await this.updateNotebookAfterThinking(userId, 'evening health check', result.steps.notice || '');

      return result;
    } catch (error: any) {
      logger.error('[AL] Evening health check loop failed', {
        userId,
        jobId,
        error: error.message,
      });
      result.success = false;
      return result;
    }
  }

  /**
   * Get recent health review library entries (for anti-repetition)
   */
  private async getRecentHealthReviews(userId: string, limit: number): Promise<any[]> {
    try {
      const result = await this.pool.query(
        `SELECT title, content, entry_type, time_of_day, created_at
         FROM library_entries
         WHERE user_id = $1
           AND entry_type = 'health_review'
         ORDER BY created_at DESC
         LIMIT $2`,
        [userId, limit]
      );
      return result.rows;
    } catch (error: any) {
      logger.error('[AL] Failed to get recent health reviews', { error: error.message });
      return [];
    }
  }

  /**
   * Get today's morning health review (if the morning loop already ran)
   */
  private async getTodaysMorningHealthReview(userId: string): Promise<any | null> {
    try {
      const todayStr = chicagoDateStr();
      const result = await this.pool.query(
        `SELECT title, content, created_at
         FROM library_entries
         WHERE user_id = $1
           AND entry_type = 'health_review'
           AND time_of_day = 'morning'
           AND created_at >= $2::date
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId, todayStr]
      );
      return result.rows[0] || null;
    } catch (error: any) {
      logger.error('[AL] Failed to get morning health review', { error: error.message });
      return null;
    }
  }

  /**
   * Read the notebook and return its content for inclusion in loop prompts
   */
  private async readNotebook(userId: string): Promise<string> {
    try {
      const doc = await this.livingDocumentService.getOrCreateDocument(userId);
      return doc.content;
    } catch (error: any) {
      logger.warn('[AL] Failed to read notebook', { userId, error: error.message });
      return '';
    }
  }

  /**
   * After a loop produces a thought, ask Claude if the notebook should be updated.
   * This makes every autonomous loop a natural read/write moment for the notebook.
   */
  private async updateNotebookAfterThinking(
    userId: string,
    loopType: string,
    thoughtSummary: string
  ): Promise<void> {
    try {
      const doc = await this.livingDocumentService.getOrCreateDocument(userId);
      const currentNotes = doc.content;

      const prompt = `You are Lucid. You just finished a ${loopType} thinking loop.

Here's what you thought about:
${thoughtSummary}

Here are your current notebook notes:
${currentNotes}

Based on what you just thought about, should your notebook change? Consider:
- Is there a new pattern, question, or insight worth noting?
- Has something you previously noted resolved or shifted?
- Should anything be removed because it's stale or no longer relevant?

If the notebook should change, respond with the FULL updated notebook content (markdown).
If nothing needs to change, respond with exactly: NO_CHANGE

Keep the notebook concise — a flat list of what matters, not a filing system.`;

      const response = await this.complete(prompt, 1000);

      if (response && response.trim() !== 'NO_CHANGE') {
        await this.livingDocumentService.updateDocument(userId, response.trim());
        logger.info('[AL] Notebook updated after thinking', {
          userId,
          loopType,
          contentLength: response.trim().length,
        });
      } else {
        logger.debug('[AL] Notebook unchanged after thinking', { userId, loopType });
      }
    } catch (error: any) {
      // Non-fatal — notebook update is best-effort
      logger.warn('[AL] Failed to update notebook after thinking', {
        userId,
        loopType,
        error: error.message,
      });
    }
  }

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

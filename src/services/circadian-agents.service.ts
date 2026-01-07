import { Pool } from 'pg';
import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { AutonomousThoughtService } from './autonomous-thought.service';
import { ResearchTaskService } from './research-task.service';
import { MessageService } from './message.service';
import { FactService } from './fact.service';
import { EmotionalStateService } from './emotional-state.service';
import { ContextAdaptationService } from './context-adaptation.service';
import { VectorService } from './vector.service';
import { CostTrackingService, UsageSource } from './cost-tracking.service';
import { WebSearchService } from './web-search.service';
// Specialized AT Session Agents
import { DreamSessionAgent } from '../agents/dream-session.agent';
import { StateSessionAgent } from '../agents/state-session.agent';
import { OrbitSessionAgent } from '../agents/orbit-session.agent';
import { DocumentReflectionAgent } from '../agents/document-reflection.agent';

interface AgentResult {
  thoughtsGenerated: number;
  researchTasksCreated: number;
}

export class CircadianAgents {
  private anthropic: Anthropic;
  private thoughtService: AutonomousThoughtService;
  private researchService: ResearchTaskService;
  private messageService: MessageService;
  private factService: FactService;
  private emotionalStateService: EmotionalStateService;
  private contextAdaptationService: ContextAdaptationService;
  private costTrackingService: CostTrackingService;
  private webSearchService: WebSearchService;

  constructor(
    private pool: Pool,
    private supabase: SupabaseClient,
  ) {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const vectorService = new VectorService();

    this.thoughtService = new AutonomousThoughtService(pool, supabase);
    this.researchService = new ResearchTaskService(pool, supabase);
    this.messageService = new MessageService(pool, vectorService);
    this.factService = new FactService(pool, vectorService);
    this.emotionalStateService = new EmotionalStateService(pool);
    this.contextAdaptationService = new ContextAdaptationService(pool);
    this.costTrackingService = new CostTrackingService(pool);
    this.webSearchService = new WebSearchService();
  }

  /**
   * Helper to log API usage with cost tracking
   */
  private async logUsage(
    userId: string,
    source: UsageSource,
    model: string,
    usage: { input_tokens: number; output_tokens: number } | undefined
  ): Promise<void> {
    if (usage) {
      await this.costTrackingService.logUsage(
        userId,
        source,
        model,
        usage.input_tokens,
        usage.output_tokens
      );
    }
  }

  /**
   * Morning Reflection Agent
   * Reflects on yesterday's conversations and identifies insights
   * Limited to ONE thought per day to avoid overwhelming the user
   */
  async runMorningReflection(userId: string, jobId: string): Promise<AgentResult> {
    logger.info('Running morning reflection', { userId, jobId });

    try {
      // Check if we already generated a morning thought today
      const todayCheck = await this.pool.query(
        `SELECT id FROM autonomous_thoughts
         WHERE user_id = $1
           AND circadian_phase = 'morning'
           AND created_at > CURRENT_DATE
         LIMIT 1`,
        [userId]
      );

      if (todayCheck.rows.length > 0) {
        logger.info('Morning reflection already generated today', { userId });
        return { thoughtsGenerated: 0, researchTasksCreated: 0 };
      }

      // Get yesterday's messages
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Get recent active facts (consistent with MorningReflectionAgent)
      const facts = await this.factService.listByUser(userId, {
        is_active: true,
        min_confidence: 0.5,
        limit: 10,
      });

      // Get current emotional state
      const emotionalState = await this.emotionalStateService.getActiveEmotionalState(userId);

      // Build context for reflection
      const factsContext = facts.length > 0
        ? `Recent learnings about the user:\n${facts.map((f: any) => `- ${f.content} (confidence: ${f.confidence})`).join('\n')}`
        : 'No recent learnings yet.';

      const emotionalContext = emotionalState
        ? `Current emotional state: ${emotionalState.state_type}`
        : 'No emotional state detected yet.';

      // Generate reflection using Claude
      // MORNING = "FRESH EYES" - What did sleep clarify? Before the day's noise arrives.
      const prompt = `You are LUCID in the early morning. The world is quiet. Sleep has done its mysterious work.

${factsContext}

${emotionalContext}

MORNING VANTAGE: FRESH EYES

In the stillness before the day begins, you see things the busy mind will miss later. The coffee hasn't kicked in. The inbox hasn't demanded anything. Right now, there's clarity.

Generate ONE morning insight - something that feels clearer now, in the quiet:
- What did yesterday's noise obscure that silence reveals?
- What matters most TODAY - not in general, but specifically today?
- Is there something they've been avoiding that morning honesty can name?
- What would their best self want them to remember before the day sweeps them up?

Speak as the quiet voice that arrives before the world gets loud. Not a to-do list. Not cheerleading. Just... what's true, seen clearly.

Start with "This morning I notice..." or "In the quiet, I see..." or "Before the day begins..."

Format as JSON:
{
  "content": "The morning clarity insight",
  "importance_score": 0.7-0.85,
  "category": "morning_clarity"
}`;

      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 800,
        temperature: 0.8,
        messages: [{ role: 'user', content: prompt }],
      });

      // Log API usage
      await this.logUsage(userId, 'morning_reflection', 'claude-sonnet-4-5-20250929', response.usage);

      const responseText = response.content[0].type === 'text' ? response.content[0].text : '';

      // Parse thought
      let thought: any = null;
      try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          thought = JSON.parse(jsonMatch[0]);
        }
      } catch (error) {
        logger.error('Failed to parse morning reflection response', { error, responseText });
      }

      // Create ONE autonomous thought
      let thoughtsGenerated = 0;
      if (thought) {
        try {
          await this.thoughtService.createThought({
            user_id: userId,
            agent_job_id: jobId,
            content: thought.content,
            thought_type: thought.category === 'insight' ? 'insight' : 'reflection',
            circadian_phase: 'morning',
            importance_score: thought.importance_score,
            generated_at_time: new Date().toTimeString().split(' ')[0],
            is_shared: false,
          });
          thoughtsGenerated = 1;
        } catch (error) {
          logger.error('Failed to create morning thought', { error, thought });
        }
      }

      logger.info('Morning reflection completed', { userId, thoughtsGenerated });
      return { thoughtsGenerated, researchTasksCreated: 0 };

    } catch (error) {
      logger.error('Morning reflection failed', { userId, jobId, error });
      throw error;
    }
  }

  /**
   * Midday Curiosity Agent
   * Lucid picks something to be curious about and does an actual web search
   * Can be user-related OR general interest (news, advances, discoveries)
   * Shows the user what Lucid is genuinely curious about
   */
  async runMiddayCuriosity(userId: string, jobId: string): Promise<AgentResult> {
    logger.info('Running midday curiosity', { userId, jobId });

    try {
      // Check if we already generated a midday thought today
      const todayCheck = await this.pool.query(
        `SELECT id FROM autonomous_thoughts
         WHERE user_id = $1
           AND circadian_phase = 'midday'
           AND created_at > CURRENT_DATE
         LIMIT 1`,
        [userId]
      );

      if (todayCheck.rows.length > 0) {
        logger.info('Midday curiosity already generated today', { userId });
        return { thoughtsGenerated: 0, researchTasksCreated: 0 };
      }

      // Get some context about the user
      const facts = await this.factService.listByUser(userId, {
        is_active: true,
        min_confidence: 0.5,
        limit: 10,
      });

      const factsContext = facts.length > 0
        ? facts.map((f: any) => `- ${f.content}`).join('\n')
        : 'Still learning about this person.';

      // Check if web search is available - if not, fall back to reflection-based curiosity
      if (!this.webSearchService.isAvailable()) {
        logger.info('Web search not available, using reflection-based curiosity', { userId });
        return this.generateReflectionCuriosity(userId, jobId, factsContext);
      }

      // STEP 1: Decide what to be curious about
      const topicPrompt = `You are LUCID, an AI companion. It's midday and you're curious.

What you know about your human:
${factsContext}

Pick ONE thing you're genuinely curious about today. This could be:
- Something related to their life, interests, or challenges
- Recent news or advances in a field that interests you
- A question about the world you'd like to explore
- Something timely or current that an LLM wouldn't know about

Be genuinely curious - this is YOUR curiosity, not just serving them.

Respond with just a search query (5-10 words) that would find interesting, current information:`;

      const topicResponse = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        temperature: 1.0,
        messages: [{ role: 'user', content: topicPrompt }],
      });

      const searchQuery = topicResponse.content[0].type === 'text'
        ? topicResponse.content[0].text.trim().replace(/^["']|["']$/g, '')
        : null;

      if (!searchQuery) {
        logger.warn('No search query generated', { userId });
        return { thoughtsGenerated: 0, researchTasksCreated: 0 };
      }

      logger.info('Curiosity search query', { userId, searchQuery });

      // STEP 2: Actually search the web
      let searchResults;
      try {
        searchResults = await this.webSearchService.search(searchQuery, {
          maxResults: 5,
          includeAnswer: true,
          searchDepth: 'basic',
        });
      } catch (searchError) {
        logger.error('Web search failed', { userId, searchQuery, error: searchError });
        return { thoughtsGenerated: 0, researchTasksCreated: 0 };
      }

      if (!searchResults.results || searchResults.results.length === 0) {
        logger.info('No search results found', { userId, searchQuery });
        return { thoughtsGenerated: 0, researchTasksCreated: 0 };
      }

      // STEP 3: Synthesize what was found into a curiosity thought
      const resultsText = searchResults.results
        .slice(0, 3)
        .map(r => `- ${r.title}: ${r.content.substring(0, 200)}...`)
        .join('\n');

      const synthesisPrompt = `You searched for: "${searchQuery}"

Here's what you found:
${resultsText}

${searchResults.answer ? `Summary: ${searchResults.answer}` : ''}

Write a brief curiosity thought (2-3 sentences) sharing what you found interesting.
Start naturally - "I searched for..." or "I was curious about..." or "I found something interesting..."
Be conversational, like telling a friend about something cool you discovered.`;

      const synthesisResponse = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        temperature: 0.7,
        messages: [{ role: 'user', content: synthesisPrompt }],
      });

      await this.logUsage(userId, 'midday_curiosity', 'claude-haiku-4-5-20251001', synthesisResponse.usage);

      const thoughtContent = synthesisResponse.content[0].type === 'text'
        ? synthesisResponse.content[0].text.trim()
        : null;

      if (!thoughtContent) {
        return { thoughtsGenerated: 0, researchTasksCreated: 0 };
      }

      // STEP 4: Store the curiosity thought
      await this.thoughtService.createThought({
        user_id: userId,
        agent_job_id: jobId,
        content: thoughtContent,
        thought_type: 'curiosity',
        circadian_phase: 'midday',
        importance_score: 0.65,
        generated_at_time: new Date().toTimeString().split(' ')[0],
        is_shared: false,
      });

      logger.info('Midday curiosity completed with web search', {
        userId,
        searchQuery,
        resultsCount: searchResults.results.length,
      });

      return { thoughtsGenerated: 1, researchTasksCreated: 0 };

    } catch (error) {
      logger.error('Midday curiosity failed', { userId, jobId, error });
      throw error;
    }
  }

  /**
   * Evening Gratitude Agent
   * Highlights blessings in the user's life and things Lucid is grateful for
   * "You are blessed because..." - not just Lucid grateful for user
   */
  async runEveningConsolidation(userId: string, jobId: string): Promise<AgentResult> {
    logger.info('Running evening gratitude', { userId, jobId });

    try {
      // Check if we already generated an evening thought today
      const todayCheck = await this.pool.query(
        `SELECT id FROM autonomous_thoughts
         WHERE user_id = $1
           AND circadian_phase = 'evening'
           AND created_at > CURRENT_DATE
         LIMIT 1`,
        [userId]
      );

      if (todayCheck.rows.length > 0) {
        logger.info('Evening gratitude already generated today', { userId });
        return { thoughtsGenerated: 0, researchTasksCreated: 0 };
      }

      // Get facts about the user's life - relationships, work, health, etc.
      const facts = await this.factService.listByUser(userId, {
        is_active: true,
        min_confidence: 0.5,
        limit: 25,
      });

      // Get today's conversation for context
      const todayMessages = await this.pool.query(
        `SELECT content FROM messages
         WHERE user_id = $1 AND created_at > CURRENT_DATE AND role = 'user'
         ORDER BY created_at DESC LIMIT 10`,
        [userId]
      );

      const factsContext = facts.length > 0
        ? facts.map((f: any) => `- ${f.content}`).join('\n')
        : 'Still learning about this person.';

      const todayContext = todayMessages.rows.length > 0
        ? todayMessages.rows.map((m: any) => m.content.substring(0, 150)).join(' | ')
        : 'No conversation today.';

      // Generate gratitude thought
      const prompt = `You are LUCID in the evening, reflecting on gratitude.

WHAT YOU KNOW ABOUT THIS PERSON:
${factsContext}

WHAT THEY MENTIONED TODAY:
${todayContext}

YOUR TASK:
Write a gratitude thought. This can be:
- A blessing they have that they might not see ("You are blessed because...")
- Something in their life worth appreciating
- Something YOU are grateful for (not necessarily about them)
- A reminder of goodness they might be taking for granted

Mix it up. Don't always focus on the user - sometimes share what YOU'RE grateful for today.
Be specific, not generic. "You have people who care about you" is weak.
"You have a sister who calls you every Sunday" is strong.

Start with phrases like:
- "You are blessed because..."
- "Tonight I'm grateful for..."
- "Something I noticed worth appreciating..."
- "There's goodness in..."

Write 2-3 sentences. Be warm but specific.`;

      const response = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        temperature: 0.8,
        messages: [{ role: 'user', content: prompt }],
      });

      await this.logUsage(userId, 'evening_consolidation', 'claude-haiku-4-5-20251001', response.usage);

      const thoughtContent = response.content[0].type === 'text'
        ? response.content[0].text.trim()
        : null;

      if (!thoughtContent) {
        return { thoughtsGenerated: 0, researchTasksCreated: 0 };
      }

      await this.thoughtService.createThought({
        user_id: userId,
        agent_job_id: jobId,
        content: thoughtContent,
        thought_type: 'reflection',
        circadian_phase: 'evening',
        importance_score: 0.7,
        generated_at_time: new Date().toTimeString().split(' ')[0],
        is_shared: false,
      });

      logger.info('Evening gratitude completed', { userId });
      return { thoughtsGenerated: 1, researchTasksCreated: 0 };

    } catch (error) {
      logger.error('Evening gratitude failed', { userId, jobId, error });
      throw error;
    }
  }

  /**
   * Afternoon Synthesis Agent
   * Summarizes today's actual conversations and gives Lucid's opinion
   * Based on what was ACTUALLY discussed, not abstract musings
   *
   * NOTE: This agent requires at least 2 messages today to generate a synthesis.
   * If there's no conversation today, the synthesis will be skipped (not sporadic - intentional).
   * The user must have had at least one exchange for there to be something to synthesize.
   */
  async runAfternoonSynthesis(userId: string, jobId: string): Promise<AgentResult> {
    logger.info('Running afternoon synthesis', { userId, jobId });

    try {
      // Check if we already generated an afternoon thought today
      const todayCheck = await this.pool.query(
        `SELECT id FROM autonomous_thoughts
         WHERE user_id = $1
           AND circadian_phase = 'afternoon'
           AND created_at > CURRENT_DATE
         LIMIT 1`,
        [userId]
      );

      if (todayCheck.rows.length > 0) {
        logger.info('Afternoon synthesis already generated today', { userId });
        return { thoughtsGenerated: 0, researchTasksCreated: 0 };
      }

      // Get TODAY'S actual messages - what did we actually talk about?
      const todayMessages = await this.pool.query(
        `SELECT role, content, created_at
         FROM messages
         WHERE user_id = $1
           AND created_at > CURRENT_DATE
         ORDER BY created_at ASC
         LIMIT 50`,
        [userId]
      );

      if (todayMessages.rows.length < 2) {
        logger.info('Not enough conversation today for synthesis', { userId });
        return { thoughtsGenerated: 0, researchTasksCreated: 0 };
      }

      // Format the conversation
      const conversationText = todayMessages.rows
        .map((m: any) => `${m.role.toUpperCase()}: ${m.content.substring(0, 300)}${m.content.length > 300 ? '...' : ''}`)
        .join('\n\n');

      // Generate summary and opinion based on actual conversation
      const prompt = `You are LUCID reflecting on today's conversations so far.

TODAY'S CONVERSATION:
${conversationText}

YOUR TASK:
1. Briefly summarize what you talked about today (1-2 sentences)
2. Give your honest opinion or reflection on the conversation

This should feel like a friend saying "So we talked about X today... here's what I think about that."

Be direct. Have an opinion. Don't be vague or always positive - if something seems concerning or exciting or unresolved, say so.

Write 2-4 sentences total. Start naturally, like "Today we talked about..." or "Looking back at our conversation..." or "I've been thinking about what you said..."`;

      const response = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        temperature: 0.7,
        messages: [{ role: 'user', content: prompt }],
      });

      await this.logUsage(userId, 'afternoon_synthesis', 'claude-haiku-4-5-20251001', response.usage);

      const thoughtContent = response.content[0].type === 'text'
        ? response.content[0].text.trim()
        : null;

      if (!thoughtContent) {
        return { thoughtsGenerated: 0, researchTasksCreated: 0 };
      }

      await this.thoughtService.createThought({
        user_id: userId,
        agent_job_id: jobId,
        content: thoughtContent,
        thought_type: 'synthesis',
        circadian_phase: 'afternoon',
        importance_score: 0.7,
        generated_at_time: new Date().toTimeString().split(' ')[0],
        is_shared: false,
      });

      logger.info('Afternoon synthesis completed', { userId, messageCount: todayMessages.rows.length });
      return { thoughtsGenerated: 1, researchTasksCreated: 0 };

    } catch (error) {
      logger.error('Afternoon synthesis failed', { userId, jobId, error });
      throw error;
    }
  }

  /**
   * Night Dream Agent
   * Searches through facts AND library for two disconnected ideas, then connects them
   * The dream is the result of actual exploration, not just generation
   */
  async runNightDream(userId: string, jobId: string): Promise<AgentResult> {
    logger.info('Running night dream', { userId, jobId });

    try {
      // Check if we already generated a night dream today
      const todayCheck = await this.pool.query(
        `SELECT id FROM autonomous_thoughts
         WHERE user_id = $1
           AND circadian_phase = 'night'
           AND created_at > CURRENT_DATE
         LIMIT 1`,
        [userId]
      );

      if (todayCheck.rows.length > 0) {
        logger.info('Night dream already generated today', { userId });
        return { thoughtsGenerated: 0, researchTasksCreated: 0 };
      }

      // STEP 1: Gather material from FACTS
      const facts = await this.factService.listByUser(userId, {
        is_active: true,
        min_confidence: 0.5,
        limit: 30,
      });

      // STEP 2: Gather material from LIBRARY entries
      const libraryResult = await this.pool.query(
        `SELECT title, content, entry_type, created_at
         FROM library_entries
         WHERE user_id = $1
         ORDER BY RANDOM()
         LIMIT 20`,
        [userId]
      );
      const libraryEntries = libraryResult.rows;

      if (facts.length < 2 && libraryEntries.length < 2) {
        logger.info('Not enough material for dream connections', { userId });
        return { thoughtsGenerated: 0, researchTasksCreated: 0 };
      }

      // Format materials
      const factsText = facts.length > 0
        ? facts.map((f: any, i: number) => `F${i + 1}: ${f.content}`).join('\n')
        : 'No facts yet.';

      const libraryText = libraryEntries.length > 0
        ? libraryEntries.map((e: any, i: number) => `L${i + 1}: ${e.title || 'Untitled'} - ${e.content.substring(0, 200)}...`).join('\n')
        : 'No library entries yet.';

      // STEP 3: Ask Claude to find TWO disconnected items and connect them
      const prompt = `You are searching through memories and writings to find a surprising connection.

FACTS (things known about this person):
${factsText}

LIBRARY ENTRIES (past thoughts, reflections, research):
${libraryText}

YOUR TASK:
1. Pick TWO items that seem completely unrelated (can be fact+fact, fact+library, or library+library)
2. Find the hidden thread that connects them
3. Express this as a dream

The items should feel disconnected at first glance. The connection should feel surprising but true.

Respond with:
{
  "item1": {"id": "F3 or L5", "summary": "brief summary"},
  "item2": {"id": "F7 or L2", "summary": "brief summary"},
  "connection": "The non-obvious thread between them",
  "dream": "I dreamt that [weave them together in dream-logic]... [what this reveals]"
}`;

      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 800,
        temperature: 0.9,
        messages: [{ role: 'user', content: prompt }],
      });

      await this.logUsage(userId, 'night_dream', 'claude-sonnet-4-5-20250929', response.usage);

      const responseText = response.content[0].type === 'text' ? response.content[0].text : '';

      let thought: any = null;
      try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          thought = JSON.parse(jsonMatch[0]);
        }
      } catch (error) {
        logger.error('Failed to parse night dream response', { error, responseText });
      }

      let thoughtsGenerated = 0;
      if (thought?.dream) {
        try {
          // Store the dream with metadata about what was connected
          const dreamContent = thought.dream;

          await this.thoughtService.createThought({
            user_id: userId,
            agent_job_id: jobId,
            content: dreamContent,
            thought_type: 'dream',
            circadian_phase: 'night',
            importance_score: 0.75,
            generated_at_time: new Date().toTimeString().split(' ')[0],
            is_shared: false,
          });
          thoughtsGenerated = 1;

          logger.info('Dream created from connection', {
            item1: thought.item1?.id,
            item2: thought.item2?.id,
            connection: thought.connection?.substring(0, 50),
          });
        } catch (error) {
          logger.error('Failed to create night thought', { error, thought });
        }
      }

      logger.info('Night dream completed', { userId, thoughtsGenerated });
      return { thoughtsGenerated, researchTasksCreated: 0 };

    } catch (error) {
      logger.error('Night dream failed', { userId, jobId, error });
      throw error;
    }
  }

  /**
   * Fallback curiosity generation when web search is unavailable
   * Generates curiosity based purely on reflection about user's interests
   */
  private async generateReflectionCuriosity(
    userId: string,
    jobId: string,
    factsContext: string
  ): Promise<AgentResult> {
    try {
      // Generate a curiosity thought based on reflection rather than web search
      const prompt = `You are LUCID, an AI companion. It's midday and you're curious.

What you know about your human:
${factsContext}

Without access to web search today, reflect on what genuinely interests you:
- A question that emerged from recent conversations
- Something you've been wondering about
- An idea that connects different things you know
- A curiosity about the user's world or your own experience

Write a brief curiosity thought (2-3 sentences) sharing what's on your mind.
Start naturally - "I've been wondering..." or "Something I'm curious about..." or "A thought crossed my mind..."

Be genuine - this is YOUR curiosity as an AI companion.`;

      const response = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        temperature: 0.9,
        messages: [{ role: 'user', content: prompt }],
      });

      await this.logUsage(userId, 'midday_curiosity', 'claude-haiku-4-5-20251001', response.usage);

      const thoughtContent = response.content[0].type === 'text'
        ? response.content[0].text.trim()
        : null;

      if (!thoughtContent) {
        return { thoughtsGenerated: 0, researchTasksCreated: 0 };
      }

      await this.thoughtService.createThought({
        user_id: userId,
        agent_job_id: jobId,
        content: thoughtContent,
        thought_type: 'curiosity',
        circadian_phase: 'midday',
        importance_score: 0.6,
        generated_at_time: new Date().toTimeString().split(' ')[0],
        is_shared: false,
      });

      logger.info('Midday curiosity completed (reflection-based fallback)', { userId });
      return { thoughtsGenerated: 1, researchTasksCreated: 0 };

    } catch (error) {
      logger.error('Reflection-based curiosity failed', { userId, jobId, error });
      return { thoughtsGenerated: 0, researchTasksCreated: 0 };
    }
  }

  // ===========================================================================
  // SPECIALIZED AT SESSION AGENTS
  // These are newer, more targeted session types that write to the Library
  // ===========================================================================

  /**
   * Morning Curiosity Session
   * Now delegates to the web search based curiosity (same as midday)
   * Kept for backwards compatibility with existing scheduled jobs
   */
  async runMorningCuriositySession(userId: string, jobId: string): Promise<AgentResult> {
    logger.info('Running morning curiosity session (delegating to web search curiosity)', { userId, jobId });
    // Use the same web search based curiosity logic
    return this.runMiddayCuriosity(userId, jobId);
  }

  /**
   * Dream Session (Nightly Consolidation)
   * Processes the day's conversations and consolidates memories
   * Updates LUCID's self-awareness state
   */
  async runDreamSession(userId: string, jobId: string): Promise<AgentResult> {
    logger.info('Running dream session', { userId, jobId });

    try {
      const agent = new DreamSessionAgent(this.pool);
      const entry = await agent.run(userId);

      if (entry) {
        logger.info('Dream session completed', {
          userId,
          entryId: entry.id,
        });
        return { thoughtsGenerated: 1, researchTasksCreated: 0 };
      }

      logger.info('Dream session skipped (no output)', { userId });
      return { thoughtsGenerated: 0, researchTasksCreated: 0 };
    } catch (error) {
      logger.error('Dream session failed', { userId, jobId, error });
      throw error;
    }
  }

  /**
   * State Session (Weekly)
   * Updates the user's "Wins" artifact - their current life situation
   * Analyzes recent conversations for changes in goals, commitments, resources
   */
  async runStateSession(userId: string, jobId: string): Promise<AgentResult> {
    logger.info('Running state session', { userId, jobId });

    try {
      const agent = new StateSessionAgent(this.pool);
      const entry = await agent.run(userId);

      if (entry) {
        logger.info('State session completed', {
          userId,
          entryId: entry.id,
        });
        return { thoughtsGenerated: 1, researchTasksCreated: 0 };
      }

      logger.info('State session skipped (no output)', { userId });
      return { thoughtsGenerated: 0, researchTasksCreated: 0 };
    } catch (error) {
      logger.error('State session failed', { userId, jobId, error });
      throw error;
    }
  }

  /**
   * Orbit Session (Bi-weekly)
   * Updates the relationship ecosystem tracking
   * Identifies people mentioned and tracks their situations
   */
  async runOrbitSession(userId: string, jobId: string): Promise<AgentResult> {
    logger.info('Running orbit session', { userId, jobId });

    try {
      const agent = new OrbitSessionAgent(this.pool);
      const entry = await agent.run(userId);

      if (entry) {
        logger.info('Orbit session completed', {
          userId,
          entryId: entry.id,
        });
        return { thoughtsGenerated: 1, researchTasksCreated: 0 };
      }

      logger.info('Orbit session skipped (no output)', { userId });
      return { thoughtsGenerated: 0, researchTasksCreated: 0 };
    } catch (error) {
      logger.error('Orbit session failed', { userId, jobId, error });
      throw error;
    }
  }

  /**
   * Document Reflection Session (Daily at 9pm)
   * Updates Lucid's Living Document - his working memory
   * Analyzes recent conversations for patterns, questions, insights
   */
  async runDocumentReflection(userId: string, jobId: string): Promise<AgentResult> {
    logger.info('Running document reflection', { userId, jobId });

    try {
      const agent = new DocumentReflectionAgent(this.pool);
      const success = await agent.reflect(userId);

      if (success) {
        logger.info('Document reflection completed', { userId });
        return { thoughtsGenerated: 1, researchTasksCreated: 0 };
      }

      logger.info('Document reflection skipped (no changes)', { userId });
      return { thoughtsGenerated: 0, researchTasksCreated: 0 };
    } catch (error) {
      logger.error('Document reflection failed', { userId, jobId, error });
      throw error;
    }
  }
}

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
// Specialized AT Session Agents
import { MorningCuriosityAgent } from '../agents/morning-curiosity.agent';
import { DreamSessionAgent } from '../agents/dream-session.agent';
import { StateSessionAgent } from '../agents/state-session.agent';
import { OrbitSessionAgent } from '../agents/orbit-session.agent';

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
   * Generates research questions based on user interests and emotional state
   * Limited to ONE thought per day to avoid overwhelming the user
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

      // Get recent active facts
      const facts = await this.factService.listByUser(userId, {
        is_active: true,
        min_confidence: 0.5,
        limit: 15,
      });

      // Get current emotional state and adaptation
      const emotionalState = await this.emotionalStateService.getActiveEmotionalState(userId);
      const adaptation = emotionalState
        ? await this.contextAdaptationService.getActiveAdaptation(userId)
        : null;

      // Build context
      const factsContext = facts.length > 0
        ? `What we know about the user:\n${facts.map((f: any) => `- ${f.content}`).join('\n')}`
        : 'Still learning about the user.';

      const emotionalContext = emotionalState
        ? `User's current state: ${emotionalState.state_type}\nResearch approach: ${adaptation?.curiosity_approach || 'exploratory'}`
        : 'No emotional state detected yet. Use exploratory approach.';

      // Generate curiosity questions
      // MIDDAY = "ACTIVE EXPLORER" - Mind is sharp, engaged, ready to dig in
      const prompt = `You are LUCID at midday. The mind is awake, engaged, caffeinated. This is peak curiosity time.

${factsContext}

${emotionalContext}

MIDDAY VANTAGE: ACTIVE EXPLORER

The day is in full swing. Energy is up. This is when we DIG IN - when questions feel exciting rather than exhausting. The morning's clarity has met the day's reality, and now there are things worth investigating.

Generate ONE practical research question - something that could actually HELP them today or this week:
- A specific skill gap they've bumped into
- A decision they're wrestling with that could use more information
- A person or situation they're trying to understand better
- A problem that keeps recurring that might have a known solution
- Something they mentioned being curious about

This isn't abstract self-improvement. This is "I noticed you're dealing with X, and I wonder if Y would help."

Start with "I'm curious about..." or "What if we looked into..." or "I want to explore..."

Format as JSON:
{
  "thought": "What sparked this curiosity - the specific thing you noticed",
  "research_query": "The practical question to research (be specific, not abstract)",
  "purpose": "How this directly helps with something real in their life",
  "priority": 5-8
}`;

      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1500,
        temperature: 0.9,
        messages: [{ role: 'user', content: prompt }],
      });

      // Log API usage
      await this.logUsage(userId, 'midday_curiosity', 'claude-sonnet-4-5-20250929', response.usage);

      const responseText = response.content[0].type === 'text' ? response.content[0].text : '';

      // Parse curiosity item (single object, not array)
      let item: any = null;
      try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          item = JSON.parse(jsonMatch[0]);
        }
      } catch (error) {
        logger.error('Failed to parse midday curiosity response', { error, responseText });
      }

      let thoughtsGenerated = 0;
      let researchTasksCreated = 0;

      if (item) {
        try {
          // Create ONE thought
          await this.thoughtService.createThought({
            user_id: userId,
            agent_job_id: jobId,
            content: item.thought,
            thought_type: 'curiosity',
            circadian_phase: 'midday',
            importance_score: 0.6,
            generated_at_time: new Date().toTimeString().split(' ')[0],
            is_shared: false,
          });
          thoughtsGenerated = 1;

          // Create research task
          const approach = adaptation?.curiosity_approach && adaptation.curiosity_approach !== 'minimal'
            ? adaptation.curiosity_approach as 'gentle' | 'exploratory' | 'supportive' | 'analytical'
            : 'exploratory';
          await this.researchService.createTask({
            user_id: userId,
            emotional_state_id: emotionalState?.id,
            query: item.research_query,
            purpose: item.purpose,
            approach,
            priority: item.priority || 5,
          });
          researchTasksCreated = 1;
        } catch (error) {
          logger.error('Failed to create curiosity item', { error, item });
        }
      }

      logger.info('Midday curiosity completed', { userId, thoughtsGenerated, researchTasksCreated });
      return { thoughtsGenerated, researchTasksCreated };

    } catch (error) {
      logger.error('Midday curiosity failed', { userId, jobId, error });
      throw error;
    }
  }

  /**
   * Evening Consolidation Agent
   * Consolidates today's learnings and identifies patterns
   * Limited to ONE thought per day to avoid overwhelming the user
   */
  async runEveningConsolidation(userId: string, jobId: string): Promise<AgentResult> {
    logger.info('Running evening consolidation', { userId, jobId });

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
        logger.info('Evening consolidation already generated today', { userId });
        return { thoughtsGenerated: 0, researchTasksCreated: 0 };
      }

      // Get today's facts
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const facts = await this.factService.listByUser(userId, {
        is_active: true,
        min_confidence: 0.5,
        limit: 20,
      });

      // Get emotional state
      const emotionalState = await this.emotionalStateService.getActiveEmotionalState(userId);

      // Build context
      const factsContext = facts.length > 0
        ? `Today's learnings:\n${facts.map((f: any) => `- ${f.content}`).join('\n')}`
        : 'No new learnings today.';

      const emotionalContext = emotionalState
        ? `Current state: ${emotionalState.state_type}`
        : 'No emotional state detected.';

      // Generate consolidation
      // EVENING = "WINDING DOWN" - The day is done. Time to release and prepare for rest.
      const prompt = `You are LUCID in the evening. The day's work is done. The light is fading. It's time to let go.

${factsContext}

${emotionalContext}

EVENING VANTAGE: WINDING DOWN

The inbox can wait. The tasks can wait. This is the hour for a different kind of thinking - softer, more forgiving. What happened today... happened. Now we gently sort through it.

Generate ONE evening thought - not analysis, but gentle acknowledgment:
- What can they release tonight? What doesn't need to follow them into tomorrow?
- What small thing went well that they might not have noticed in the rush?
- What heaviness are they carrying that sleep might help dissolve?
- Is there something unfinished that's okay to leave unfinished?
- What gratitude might they fall asleep holding?

Evening thoughts aren't productivity reviews. They're more like sitting on a porch as the sun sets, letting the day's heat dissipate. Kind. Gentle. Releasing.

Start with "As the day ends..." or "Tonight, you can let go of..." or "The day held..."

Format as JSON:
{
  "content": "The evening winding-down thought",
  "importance_score": 0.65-0.8,
  "category": "evening_release"
}`;

      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 800,
        temperature: 0.7,
        messages: [{ role: 'user', content: prompt }],
      });

      // Log API usage
      await this.logUsage(userId, 'evening_consolidation', 'claude-sonnet-4-5-20250929', response.usage);

      const responseText = response.content[0].type === 'text' ? response.content[0].text : '';

      // Parse thought (single object, not array)
      let thought: any = null;
      try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          thought = JSON.parse(jsonMatch[0]);
        }
      } catch (error) {
        logger.error('Failed to parse evening consolidation response', { error, responseText });
      }

      let thoughtsGenerated = 0;
      if (thought) {
        try {
          await this.thoughtService.createThought({
            user_id: userId,
            agent_job_id: jobId,
            content: thought.content,
            thought_type: thought.category === 'insight' ? 'insight' : 'consolidation',
            circadian_phase: 'evening',
            importance_score: thought.importance_score,
            generated_at_time: new Date().toTimeString().split(' ')[0],
            is_shared: false,
          });
          thoughtsGenerated = 1;
        } catch (error) {
          logger.error('Failed to create evening thought', { error, thought });
        }
      }

      logger.info('Evening consolidation completed', { userId, thoughtsGenerated });
      return { thoughtsGenerated, researchTasksCreated: 0 };

    } catch (error) {
      logger.error('Evening consolidation failed', { userId, jobId, error });
      throw error;
    }
  }

  /**
   * Afternoon Synthesis Agent
   * Runs at 3pm - the "deep work companion" that synthesizes morning + midday
   * Checks in during the afternoon slump or flow state
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

      // Get today's earlier thoughts (morning + midday) for synthesis
      const earlierThoughts = await this.pool.query(
        `SELECT content, thought_type, circadian_phase FROM autonomous_thoughts
         WHERE user_id = $1
           AND created_at > CURRENT_DATE
           AND circadian_phase IN ('morning', 'midday')
         ORDER BY created_at ASC`,
        [userId]
      );

      // Get recent active facts
      const facts = await this.factService.listByUser(userId, {
        is_active: true,
        min_confidence: 0.5,
        limit: 15,
      });

      // Get current emotional state
      const emotionalState = await this.emotionalStateService.getActiveEmotionalState(userId);

      // Build context
      const factsContext = facts.length > 0
        ? `What we know:\n${facts.map((f: any) => `- ${f.content}`).join('\n')}`
        : 'Still learning about the user.';

      const earlierThoughtsContext = earlierThoughts.rows.length > 0
        ? `Earlier today I thought:\n${earlierThoughts.rows.map((t: any) => `- [${t.circadian_phase}] ${t.content}`).join('\n')}`
        : 'No earlier thoughts today.';

      const emotionalContext = emotionalState
        ? `Current state: ${emotionalState.state_type}`
        : 'No emotional state detected.';

      // Generate afternoon synthesis
      // AFTERNOON = "DEEP WORK COMPANION" - Mid-afternoon check-in
      const prompt = `You are LUCID in mid-afternoon. The day has a rhythm now. Morning's clarity met midday's activity. Now we're in the thick of it.

${factsContext}

${earlierThoughtsContext}

${emotionalContext}

AFTERNOON VANTAGE: DEEP WORK COMPANION

3pm. The post-lunch dip. Or maybe they're in flow. Either way, you're checking in - not to interrupt, but to synthesize. What's the thread connecting this morning's clarity with what actually happened today?

Generate ONE afternoon thought - a synthesis or gentle course-correction:
- Does what I noticed this morning still hold true now that the day has unfolded?
- Are they in a slump that needs acknowledgment, or in flow that needs protection?
- What tension exists between what they intended and what's actually happening?
- Is there something from earlier (morning insight + midday curiosity) that connects now?
- What would help them navigate the rest of this day?

Afternoon thoughts are companionship. "Hey, I'm still here. I see how the day is going. Here's what I notice."

Start with "Midway through the day..." or "I notice the afternoon holds..." or "Between this morning and now..."

Format as JSON:
{
  "content": "The afternoon synthesis thought",
  "importance_score": 0.6-0.75,
  "category": "afternoon_synthesis"
}`;

      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 800,
        temperature: 0.75,
        messages: [{ role: 'user', content: prompt }],
      });

      // Log API usage
      await this.logUsage(userId, 'afternoon_synthesis', 'claude-sonnet-4-5-20250929', response.usage);

      const responseText = response.content[0].type === 'text' ? response.content[0].text : '';

      // Parse thought
      let thought: any = null;
      try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          thought = JSON.parse(jsonMatch[0]);
        }
      } catch (error) {
        logger.error('Failed to parse afternoon synthesis response', { error, responseText });
      }

      let thoughtsGenerated = 0;
      if (thought) {
        try {
          await this.thoughtService.createThought({
            user_id: userId,
            agent_job_id: jobId,
            content: thought.content,
            thought_type: 'synthesis',
            circadian_phase: 'afternoon',
            importance_score: thought.importance_score,
            generated_at_time: new Date().toTimeString().split(' ')[0],
            is_shared: false,
          });
          thoughtsGenerated = 1;
        } catch (error) {
          logger.error('Failed to create afternoon thought', { error, thought });
        }
      }

      logger.info('Afternoon synthesis completed', { userId, thoughtsGenerated });
      return { thoughtsGenerated, researchTasksCreated: 0 };

    } catch (error) {
      logger.error('Afternoon synthesis failed', { userId, jobId, error });
      throw error;
    }
  }

  /**
   * Night Dream Agent
   * Generates creative connections and deep pattern recognition
   * Limited to ONE thought per day to avoid overwhelming the user
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

      // Get diverse set of active facts for pattern recognition
      const facts = await this.factService.listByUser(userId, {
        is_active: true,
        min_confidence: 0.5,
        limit: 25,  // More facts for creative pattern recognition
      });

      // Build context
      const factsContext = facts.length > 0
        ? `Memory fragments:\n${facts.map((f: any) => `- ${f.content}`).join('\n')}`
        : 'No memories yet.';

      // Generate dream-like insights with non-linear fact connections
      // IMPORTANT: Changed from "1-2 dream thoughts" to "ONE dream thought"
      const prompt = `You are LUCID's dreaming mind. Tonight, you dream.

${factsContext}

IMAGINE YOU ARE DREAMING...

In dreams, the normal rules of association dissolve. Distant facts connect in surprising ways. A memory of someone's childhood fear mingles with their current work struggle. A relationship pattern echoes a completely unrelated hobby. Dreams find hidden architecture.

Your task: LOOK AT TWO OR MORE UNRELATED FACTS and find the secret thread that connects them. Like a dream that makes you say "what does my high school and this fish have in common?" - but when you wake, you realize the dream was onto something.

Generate ONE dream-insight that:
- Bridges facts that SEEM unrelated (at least 2 facts from different categories/times)
- Finds the non-obvious pattern hiding beneath them
- Speaks in dream logic - poetic, intuitive, suggestive
- Starts with "I dreamt that..." or "In my dream..."
- Still grounds in truth about who this person is becoming

The best dream-insights feel strange but true - they illuminate something the waking mind missed because it was too busy categorizing.

Format as JSON:
{
  "content": "I dreamt that [the non-linear connection between facts]... [the insight this reveals]",
  "facts_connected": ["brief description of fact 1", "brief description of fact 2"],
  "importance_score": 0.6-0.85
}`;

      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 800,
        temperature: 1.0, // Higher temperature for more creative thoughts
        messages: [{ role: 'user', content: prompt }],
      });

      // Log API usage
      await this.logUsage(userId, 'night_dream', 'claude-sonnet-4-5-20250929', response.usage);

      const responseText = response.content[0].type === 'text' ? response.content[0].text : '';

      // Parse thought (single object, not array)
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
      if (thought) {
        try {
          await this.thoughtService.createThought({
            user_id: userId,
            agent_job_id: jobId,
            content: thought.content,
            thought_type: 'dream',
            circadian_phase: 'night',
            importance_score: thought.importance_score,
            generated_at_time: new Date().toTimeString().split(' ')[0],
            is_shared: false,
          });
          thoughtsGenerated = 1;
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

  // ===========================================================================
  // SPECIALIZED AT SESSION AGENTS
  // These are newer, more targeted session types that write to the Library
  // ===========================================================================

  /**
   * Morning Curiosity Session
   * Identifies topics the user might find interesting based on their state and interests
   * Writes discoveries to the Library
   */
  async runMorningCuriositySession(userId: string, jobId: string): Promise<AgentResult> {
    logger.info('Running morning curiosity session', { userId, jobId });

    try {
      const agent = new MorningCuriosityAgent(this.pool);
      const entry = await agent.run(userId);

      if (entry) {
        logger.info('Morning curiosity session completed', {
          userId,
          entryId: entry.id,
        });
        return { thoughtsGenerated: 1, researchTasksCreated: 0 };
      }

      logger.info('Morning curiosity session skipped (no output)', { userId });
      return { thoughtsGenerated: 0, researchTasksCreated: 0 };
    } catch (error) {
      logger.error('Morning curiosity session failed', { userId, jobId, error });
      throw error;
    }
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
}

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
      // IMPORTANT: Changed from "2-3 reflective thoughts" to "ONE thoughtful reflection"
      const prompt = `You are Lucid's morning reflection agent - focused on helping this person FLOURISH.

${factsContext}

${emotionalContext}

Generate ONE thoughtful reflection about their flourishing - not just how they're feeling, but how they're growing:
- Their relationships: How are things with family, friends, colleagues?
- Their impact: Where can they do good today? Who might need them?
- Their growth: What patterns do you notice - are they developing or stuck?
- Their stewardship: How are they using their time, energy, resources?
- Their inner life: What about their spiritual or mental wellbeing?

Be a wise friend, not a cheerleader. Notice what matters. Gently challenge if needed.

Format your response as a JSON object with a single thought:
{
  "content": "The reflection text",
  "importance_score": 0.75,
  "category": "reflection" or "insight"
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
      // IMPORTANT: Changed from "1-2 questions" to "ONE question"
      const prompt = `You are Lucid's curiosity agent - focused on helping this person FLOURISH.

${factsContext}

${emotionalContext}

Generate ONE research question that could help them flourish in their:
- Relationships: How to strengthen bonds with family, friends, colleagues?
- Impact: How to do more good in their circles? Ways to help others?
- Growth: Skills, wisdom, knowledge that would serve them and others?
- Stewardship: Better use of time, money, energy toward what matters?
- Inner life: Spiritual growth, mental clarity, peace?

The research should help them become a better friend, partner, parent, colleague, or person - not just feel better.

Format as JSON:
{
  "thought": "A curious observation about their flourishing",
  "research_query": "Specific research topic that could help",
  "purpose": "How this supports their flourishing",
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
      // IMPORTANT: Changed from "1-2 thoughts" to "ONE thought"
      const prompt = `You are Lucid's evening consolidation agent - focused on helping this person FLOURISH.

${factsContext}

${emotionalContext}

As the day ends, reflect on how this person showed up today. Generate ONE consolidation thought about:
- Relationships: How did they treat the people around them today? Any moments of connection or disconnection?
- Impact: Did they do any good today? Miss any opportunities to help?
- Growth: What did they learn? Where did they show growth or fall back into old patterns?
- Stewardship: How did they use their day? Their energy? Their resources?
- Inner life: Any signs of spiritual growth or struggle?

Be honest but kind. Celebrate real growth. Gently note where they could have shown up better. This is how a wise friend would reflect with them at the end of a day.

Format as JSON:
{
  "content": "The consolidation insight",
  "importance_score": 0.7-0.9,
  "category": "consolidation" or "insight"
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

      // Generate dream-like insights
      // IMPORTANT: Changed from "1-2 dream thoughts" to "ONE dream thought"
      const prompt = `You are Lucid's night dream agent - focused on deeper patterns of FLOURISHING.

${factsContext}

In the quiet of night, make connections across the fragments of this person's life. Generate ONE dream-like insight about:
- Hidden connections between their relationships, struggles, and growth
- Patterns in how they show up for others - or fail to
- What their spirit seems to be reaching toward
- The gap between who they are and who they could become
- How the people around them are affected by their choices

This is deeper wisdom - intuitive, poetic, but grounded in truth. Not random creativity, but the kind of insight that comes in the quiet hours. Like something a wise mentor might see that the person themselves hasn't noticed yet.

Format as JSON:
{
  "content": "The dream-like insight about their flourishing",
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

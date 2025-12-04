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

      // Get recent facts
      const facts = await this.factService.listByUser(userId);

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
      const prompt = `You are Lucid's morning reflection agent. Review the recent interactions and generate ONE thoughtful reflection.

${factsContext}

${emotionalContext}

Generate ONE reflective thought about patterns you've noticed, insights about the user, or areas where you could provide better support.

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
   */
  async runMiddayCuriosity(userId: string, jobId: string): Promise<AgentResult> {
    logger.info('Running midday curiosity', { userId, jobId });

    try {
      // Get recent facts
      const facts = await this.factService.listByUser(userId);

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
      const prompt = `You are Lucid's curiosity agent. Based on what you know about the user, generate interesting research questions.

${factsContext}

${emotionalContext}

Generate 1-2 thoughtful research questions that:
- Build on existing knowledge
- Match the user's emotional state (be gentle if struggling, energizing if withdrawn)
- Could lead to helpful insights or interesting discussions

Format as JSON:
[
  {
    "thought": "A curious observation or question",
    "research_query": "Specific research topic",
    "purpose": "Why this would be valuable",
    "priority": 5-8
  }
]`;

      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1500,
        temperature: 0.9,
        messages: [{ role: 'user', content: prompt }],
      });

      const responseText = response.content[0].type === 'text' ? response.content[0].text : '';

      // Parse curiosity items
      let curiosityItems: any[] = [];
      try {
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          curiosityItems = JSON.parse(jsonMatch[0]);
        }
      } catch (error) {
        logger.error('Failed to parse midday curiosity response', { error, responseText });
      }

      let thoughtsGenerated = 0;
      let researchTasksCreated = 0;

      for (const item of curiosityItems) {
        try {
          // Create thought
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
          thoughtsGenerated++;

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
          researchTasksCreated++;
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
   */
  async runEveningConsolidation(userId: string, jobId: string): Promise<AgentResult> {
    logger.info('Running evening consolidation', { userId, jobId });

    try {
      // Get today's facts
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const facts = await this.factService.listByUser(userId);

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
      const prompt = `You are Lucid's evening consolidation agent. Reflect on today's interactions and synthesize insights.

${factsContext}

${emotionalContext}

Generate 1-2 consolidation thoughts that:
- Identify patterns across today's conversations
- Highlight key learnings or insights
- Note progress or changes in the user's situation

Format as JSON:
[
  {
    "content": "The consolidation insight",
    "importance_score": 0.7-0.9,
    "category": "consolidation" or "insight"
  }
]`;

      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1500,
        temperature: 0.7,
        messages: [{ role: 'user', content: prompt }],
      });

      const responseText = response.content[0].type === 'text' ? response.content[0].text : '';

      // Parse thoughts
      let thoughts: any[] = [];
      try {
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          thoughts = JSON.parse(jsonMatch[0]);
        }
      } catch (error) {
        logger.error('Failed to parse evening consolidation response', { error, responseText });
      }

      let thoughtsGenerated = 0;
      for (const thought of thoughts) {
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
          thoughtsGenerated++;
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
   */
  async runNightDream(userId: string, jobId: string): Promise<AgentResult> {
    logger.info('Running night dream', { userId, jobId });

    try {
      // Get diverse set of facts for pattern recognition
      const facts = await this.factService.listByUser(userId);

      // Build context
      const factsContext = facts.length > 0
        ? `Memory fragments:\n${facts.map((f: any) => `- ${f.content}`).join('\n')}`
        : 'No memories yet.';

      // Generate dream-like insights
      const prompt = `You are Lucid's night dream agent. Using memory consolidation and pattern recognition, generate creative insights.

${factsContext}

Generate 1-2 "dream thoughts" that:
- Make unexpected connections between different topics
- Identify deeper patterns in the user's interests or concerns
- Offer creative perspectives or questions

These should feel intuitive and insightful, not random.

Format as JSON:
[
  {
    "content": "The dream-like insight",
    "importance_score": 0.6-0.85
  }
]`;

      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1500,
        temperature: 1.0, // Higher temperature for more creative thoughts
        messages: [{ role: 'user', content: prompt }],
      });

      const responseText = response.content[0].type === 'text' ? response.content[0].text : '';

      // Parse thoughts
      let thoughts: any[] = [];
      try {
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          thoughts = JSON.parse(jsonMatch[0]);
        }
      } catch (error) {
        logger.error('Failed to parse night dream response', { error, responseText });
      }

      let thoughtsGenerated = 0;
      for (const thought of thoughts) {
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
          thoughtsGenerated++;
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
}

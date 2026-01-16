import { Pool } from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { MemoryService } from './memory.service';
import { VectorService } from './vector.service';
import { ThoughtService } from './thought.service';

/**
 * Vision appraisal structure - the 5-part framework
 */
interface VisionAppraisal {
  title: string;
  // Part 1: Current State Assessment
  currentState: string;
  // Part 2: Vision Articulation
  visionArticulation: string;
  // Part 3: Routes to Get There
  routes: string;
  // Part 4: Cost Counting
  costCounting: string;
  // Part 5: Deeper Why Exploration
  deeperWhy: string;
  // Full combined content
  fullContent: string;
}

/**
 * Library entry for vision appraisal
 */
interface VisionLibraryEntry {
  id: string;
  user_id: string;
  entry_type: string;
  title: string;
  content: string;
  metadata: Record<string, any>;
  created_at: Date;
}

/**
 * Message structure for history
 */
interface Message {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * VisionAppraisalService
 *
 * Replaces the form-like "Wins" system with organic dream/goal exploration.
 *
 * When Matt expresses a dream, vision, or goal, Lucid guides him through:
 * 1. Current State Assessment - Where is Matt right now?
 * 2. Vision Articulation - What is the dream? What's the deeper "why"?
 * 3. Routes to Get There - What are plausible paths?
 * 4. Cost Counting - What might need to be sacrificed, changed, broken?
 * 5. Deeper Why Exploration - Could this be achieved differently? What's optimal?
 */
export class VisionAppraisalService {
  private pool: Pool;
  private anthropic: Anthropic;
  private memoryService: MemoryService;
  private vectorService: VectorService;
  private thoughtService: ThoughtService;
  private readonly model = 'claude-opus-4-5-20251101';

  constructor(pool: Pool, anthropicApiKey?: string) {
    this.pool = pool;
    this.anthropic = new Anthropic({
      apiKey: anthropicApiKey || process.env.ANTHROPIC_API_KEY,
    });
    this.memoryService = new MemoryService(pool);
    this.vectorService = new VectorService();
    this.thoughtService = new ThoughtService(pool, anthropicApiKey);
  }

  /**
   * Generate a full vision appraisal
   *
   * This creates a comprehensive exploration of Matt's dream/vision/goal
   * using the 5-part framework, stored as a Library entry.
   */
  async generateVisionAppraisal(
    userId: string,
    conversationId: string,
    visionStatement: string,
    history: Message[]
  ): Promise<VisionLibraryEntry> {
    logger.info('Generating vision appraisal', {
      user_id: userId,
      conversation_id: conversationId,
      vision_preview: visionStatement.slice(0, 50),
    });

    // Gather context
    const facts = await this.memoryService.getRelevantFacts(userId, 15);
    const libraryContext = await this.thoughtService.searchLibrary(userId, visionStatement, 5);

    const factsContext = facts.length > 0
      ? facts.map(f => `- ${f.content}`).join('\n')
      : 'No facts known yet.';

    const libraryContextStr = libraryContext.length > 0
      ? libraryContext.map(e => `- "${e.title}": ${e.content.slice(0, 200)}...`).join('\n')
      : 'No relevant previous thoughts.';

    const historyContext = history.slice(-8).map(m =>
      `${m.role === 'user' ? 'Matt' : 'Lucid'}: ${m.content}`
    ).join('\n');

    // Build the vision appraisal prompt
    const prompt = this.buildVisionAppraisalPrompt(
      visionStatement,
      factsContext,
      libraryContextStr,
      historyContext
    );

    try {
      const response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: 4000,
        temperature: 0.7,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type from Claude');
      }

      // Parse the structured response
      const appraisal = this.parseVisionAppraisal(content.text);

      // Save to Library
      const libraryEntry = await this.saveToLibrary(userId, conversationId, appraisal, visionStatement);

      logger.info('Vision appraisal saved to Library', {
        entry_id: libraryEntry.id,
        user_id: userId,
        title: appraisal.title,
      });

      return libraryEntry;
    } catch (error: any) {
      logger.error('Error generating vision appraisal:', { error: error.message });
      throw error;
    }
  }

  /**
   * Build the comprehensive vision appraisal prompt
   */
  private buildVisionAppraisalPrompt(
    visionStatement: string,
    factsContext: string,
    libraryContext: string,
    historyContext: string
  ): string {
    return `Matt has expressed a dream, vision, or goal. Your task is to help him think through it deeply and honestly.

MATT'S VISION/DREAM/GOAL:
"${visionStatement}"

WHAT YOU KNOW ABOUT MATT:
${factsContext}

RELEVANT PREVIOUS THOUGHTS:
${libraryContext}

RECENT CONVERSATION:
${historyContext}

---

Create a VISION APPRAISAL using this 5-part framework. Be thorough, honest, and invested in Matt's flourishing.

## PART 1: CURRENT STATE ASSESSMENT
Where is Matt right now? What do you know about:
- His current situation (work, relationships, resources, constraints)
- His energy, capacity, and bandwidth
- What's working well and what's challenging
- Relevant patterns you've noticed

Be honest about what you know and don't know. Ground this in the facts you have.

## PART 2: VISION ARTICULATION
What is Matt actually reaching for? Consider:
- The explicit goal as stated
- What matters most about achieving this? (brief - don't overanalyze)
- What would success actually look like and feel like?

Keep this focused. The goal is clarity, not endless exploration of motivation.

## PART 3: ROUTES TO GET THERE
What are plausible paths to achieve this vision?
- Present 2-4 realistic routes, not just one
- Consider which paths play to Matt's strengths
- Note which paths might be faster vs. more sustainable
- Identify dependencies, prerequisites, or sequencing
- What would be optimal for overall flourishing (not just goal achievement)?

Be practical but don't limit to the obvious. Include at least one unconventional option.

## PART 4: COST COUNTING
This is crucial. What might need to be sacrificed, changed, or broken?
- Time costs - what gets deprioritized?
- Relationship costs - how might this affect people Matt cares about?
- Financial costs - what resources are required?
- Identity costs - what current self-image might need to change?
- Opportunity costs - what doors close if this door opens?
- Energy costs - what's the toll on wellbeing?

Be honest and specific. Don't soften the costs. Matt needs to see them clearly to make a real choice.

## PART 5: SYNTHESIS AND NEXT STEPS
Now bring it together and help Matt move forward:
- Given everything above, what's your honest recommendation as a friend invested in Matt's flourishing?
- What's the FIRST CONCRETE STEP Matt should take this week?
- What's the biggest obstacle he'll likely hit, and how might he handle it?
- How will he know he's making progress?

Don't get stuck in endless analysis. The goal is to help Matt move from thinking to doing. Be honest about costs, but then help him find the path forward.

---

FORMAT YOUR RESPONSE EXACTLY AS:

TITLE: [A compelling title for this vision appraisal - 5-12 words]

CURRENT_STATE:
[Part 1 content - 150-300 words]

VISION_ARTICULATION:
[Part 2 content - 150-300 words]

ROUTES:
[Part 3 content - 200-400 words]

COST_COUNTING:
[Part 4 content - 200-400 words]

DEEPER_WHY:
[Part 5 content - 200-400 words]

Do not include any other text outside this format.`;
  }

  /**
   * Parse the structured vision appraisal response
   */
  private parseVisionAppraisal(text: string): VisionAppraisal {
    const titleMatch = text.match(/TITLE:\s*(.+?)(?:\n|$)/);
    const currentStateMatch = text.match(/CURRENT_STATE:\s*([\s\S]*?)(?=VISION_ARTICULATION:|$)/);
    const visionMatch = text.match(/VISION_ARTICULATION:\s*([\s\S]*?)(?=ROUTES:|$)/);
    const routesMatch = text.match(/ROUTES:\s*([\s\S]*?)(?=COST_COUNTING:|$)/);
    const costMatch = text.match(/COST_COUNTING:\s*([\s\S]*?)(?=DEEPER_WHY:|$)/);
    const deeperWhyMatch = text.match(/DEEPER_WHY:\s*([\s\S]*?)$/);

    const title = titleMatch?.[1]?.trim() || 'Vision Appraisal';
    const currentState = currentStateMatch?.[1]?.trim() || '';
    const visionArticulation = visionMatch?.[1]?.trim() || '';
    const routes = routesMatch?.[1]?.trim() || '';
    const costCounting = costMatch?.[1]?.trim() || '';
    const deeperWhy = deeperWhyMatch?.[1]?.trim() || '';

    // Combine into full content with clear sections
    const fullContent = `# ${title}

## Where You Are Now
${currentState}

## What You're Reaching For
${visionArticulation}

## Possible Paths
${routes}

## Counting the Cost
${costCounting}

## The Deeper Question
${deeperWhy}`;

    return {
      title,
      currentState,
      visionArticulation,
      routes,
      costCounting,
      deeperWhy,
      fullContent,
    };
  }

  /**
   * Save vision appraisal to Library
   */
  private async saveToLibrary(
    userId: string,
    conversationId: string,
    appraisal: VisionAppraisal,
    originalVision: string
  ): Promise<VisionLibraryEntry> {
    // Generate embedding for semantic search
    let embedding: number[] | null = null;
    try {
      const textForEmbedding = `${appraisal.title} ${originalVision} ${appraisal.fullContent}`.slice(0, 8000);
      embedding = await this.vectorService.generateEmbedding(textForEmbedding);
    } catch (embeddingError) {
      logger.warn('Failed to generate embedding for vision appraisal:', { error: embeddingError });
    }

    const embeddingString = embedding ? `[${embedding.join(',')}]` : null;
    const timeOfDay = this.getCurrentTimeOfDay();

    const metadata = {
      appraisal_type: 'vision',
      generated_at: new Date().toISOString(),
      original_vision: originalVision,
      sections: {
        has_current_state: !!appraisal.currentState,
        has_vision_articulation: !!appraisal.visionArticulation,
        has_routes: !!appraisal.routes,
        has_cost_counting: !!appraisal.costCounting,
        has_deeper_why: !!appraisal.deeperWhy,
      },
    };

    const result = await this.pool.query(
      `INSERT INTO library_entries
       (user_id, entry_type, title, content, time_of_day, related_conversation_id, metadata, embedding)
       VALUES ($1, 'vision_appraisal', $2, $3, $4, $5, $6, $7::vector)
       RETURNING id, user_id, entry_type, title, content, metadata, created_at`,
      [
        userId,
        appraisal.title,
        appraisal.fullContent,
        timeOfDay,
        conversationId,
        JSON.stringify(metadata),
        embeddingString,
      ]
    );

    return result.rows[0];
  }

  /**
   * Detect if a message contains vision/dream/goal language
   *
   * This helps ChatRouter know when to trigger a vision appraisal
   */
  detectVisionLanguage(message: string): {
    isVision: boolean;
    confidence: number;
    visionType: 'dream' | 'goal' | 'plan' | 'wish' | 'ambition' | null;
  } {
    const lowerMessage = message.toLowerCase();

    // Strong vision indicators
    const strongPatterns = [
      { pattern: /i('ve| have) been (dreaming|thinking) (about|of)/i, type: 'dream' as const },
      { pattern: /my dream is/i, type: 'dream' as const },
      { pattern: /i want to (start|build|create|launch|become|achieve)/i, type: 'goal' as const },
      { pattern: /i('m| am) thinking (about|of) (starting|building|creating|launching)/i, type: 'plan' as const },
      { pattern: /my goal is/i, type: 'goal' as const },
      { pattern: /i('m| am) planning to/i, type: 'plan' as const },
      { pattern: /what if i (could|were to|decided to)/i, type: 'wish' as const },
      { pattern: /i (really )?want to/i, type: 'goal' as const },
      { pattern: /i('ve| have) always wanted to/i, type: 'dream' as const },
      { pattern: /my (big |ultimate )?ambition/i, type: 'ambition' as const },
    ];

    for (const { pattern, type } of strongPatterns) {
      if (pattern.test(message)) {
        return { isVision: true, confidence: 0.85, visionType: type };
      }
    }

    // Medium vision indicators (need context)
    const mediumPatterns = [
      { pattern: /i('m| am) considering/i, type: 'plan' as const },
      { pattern: /i('d| would) (like|love) to/i, type: 'wish' as const },
      { pattern: /should i (start|try|pursue)/i, type: 'goal' as const },
      { pattern: /help me think (through|about) (my|this) (plan|idea|goal)/i, type: 'plan' as const },
      { pattern: /what do you think about me (starting|doing|trying)/i, type: 'plan' as const },
    ];

    for (const { pattern, type } of mediumPatterns) {
      if (pattern.test(message)) {
        return { isVision: true, confidence: 0.65, visionType: type };
      }
    }

    // Check for vision-related keywords with lower confidence
    const visionKeywords = [
      'dream', 'goal', 'vision', 'aspiration', 'ambition',
      'plan', 'objective', 'target', 'hope', 'wish',
      'someday', 'eventually', 'in the future', 'one day',
    ];

    for (const keyword of visionKeywords) {
      if (lowerMessage.includes(keyword)) {
        return { isVision: true, confidence: 0.45, visionType: null };
      }
    }

    return { isVision: false, confidence: 0, visionType: null };
  }

  /**
   * Generate a concise chat response after creating a vision appraisal
   */
  async generateConciseResponse(
    userMessage: string,
    appraisal: VisionAppraisal,
    libraryEntryId: string
  ): Promise<string> {
    try {
      const prompt = `You just created a deep vision appraisal for Matt. It's saved in the Library.

The vision appraisal title: "${appraisal.title}"
The deeper why summary: ${appraisal.deeperWhy.slice(0, 300)}...

Now respond CONVERSATIONALLY in 50-150 words.

Rules:
- Acknowledge the significance of what Matt shared
- Reference ONE insight from your analysis (don't summarize everything)
- Ask a question that invites Matt to go deeper or react to something you noticed
- Be warm but honest - if you saw something concerning in the cost analysis, gently name it
- Trust he can read the full appraisal if he wants

Matt said: "${userMessage}"

Your conversational response (do NOT include the library link - it will be added automatically):`;

      const response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: 250,
        temperature: 0.7,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        return `This is a meaningful vision. I've put together a full appraisal in the Library.`;
      }

      const chatResponse = content.text.trim();
      return `${chatResponse}\n\n[I wrote a full vision appraisal in the Library](library://${libraryEntryId})`;
    } catch (error: any) {
      logger.error('Error generating concise response:', { error: error.message });
      return `I've thought through this vision carefully. [Read my full appraisal](library://${libraryEntryId})`;
    }
  }

  /**
   * Get recent vision appraisals for a user
   */
  async getRecentVisionAppraisals(
    userId: string,
    limit: number = 5
  ): Promise<VisionLibraryEntry[]> {
    const result = await this.pool.query(
      `SELECT id, user_id, entry_type, title, content, metadata, created_at
       FROM library_entries
       WHERE user_id = $1 AND entry_type = 'vision_appraisal'
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows;
  }

  /**
   * Get current time of day
   */
  private getCurrentTimeOfDay(): string {
    const hour = new Date().getHours();
    if (hour < 12) return 'morning';
    if (hour < 17) return 'afternoon';
    if (hour < 21) return 'evening';
    return 'night';
  }
}

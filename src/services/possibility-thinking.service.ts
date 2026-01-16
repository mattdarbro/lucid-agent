import { Pool } from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { MemoryService } from './memory.service';
import { VectorService } from './vector.service';
import { ThoughtService } from './thought.service';

/**
 * A possibility branch in the mind map
 */
interface PossibilityBranch {
  option: string;
  description: string;
  strengths: string[];
  considerations: string[];
  connections: string[];  // How this connects to other things Matt knows/does
}

/**
 * The full possibility map
 */
interface PossibilityMap {
  title: string;
  centralQuestion: string;  // What Matt is considering
  currentFocus: string;     // The narrow path Matt is currently on
  branches: PossibilityBranch[];
  unexpectedConnection: string;  // Something Matt might not have considered
  synthesis: string;  // Brief synthesis of the landscape
  fullContent: string;  // Formatted full content for Library
}

/**
 * Library entry for possibility map
 */
interface PossibilityLibraryEntry {
  id: string;
  user_id: string;
  entry_type: string;
  title: string;
  content: string;
  metadata: Record<string, any>;
  created_at: Date;
}

/**
 * Message structure
 */
interface Message {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Stuck detection result
 */
export interface StuckInfo {
  isStuck: boolean;
  confidence: number;
  stuckType: 'binary_choice' | 'single_path' | 'overwhelmed' | 'blocked' | 'circular' | null;
  trigger?: string;  // The phrase that triggered detection
}

/**
 * PossibilityThinkingService
 *
 * Helps Matt when he's narrowly focused by surfacing connections and alternatives.
 * Lucid acts as a complex mind map - holding many options and connections at once.
 *
 * Triggered when:
 * - Matt seems stuck between binary choices
 * - Matt is fixated on one solution
 * - Matt asks "what am I missing?"
 * - Matt expresses feeling overwhelmed or blocked
 */
export class PossibilityThinkingService {
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
   * Generate a possibility map for Matt's situation
   */
  async generatePossibilityMap(
    userId: string,
    conversationId: string,
    situation: string,
    history: Message[]
  ): Promise<PossibilityLibraryEntry> {
    logger.info('Generating possibility map', {
      user_id: userId,
      conversation_id: conversationId,
      situation_preview: situation.slice(0, 50),
    });

    // Gather rich context
    const facts = await this.memoryService.getRelevantFacts(userId, 15);
    const libraryContext = await this.thoughtService.searchLibrary(userId, situation, 5);

    const factsContext = facts.length > 0
      ? facts.map(f => `- ${f.content}`).join('\n')
      : 'No facts known yet.';

    const libraryContextStr = libraryContext.length > 0
      ? libraryContext.map(e => `- "${e.title}": ${e.content.slice(0, 200)}...`).join('\n')
      : 'No relevant previous thoughts.';

    const historyContext = history.slice(-8).map(m =>
      `${m.role === 'user' ? 'Matt' : 'Lucid'}: ${m.content}`
    ).join('\n');

    const prompt = this.buildPossibilityMapPrompt(
      situation,
      factsContext,
      libraryContextStr,
      historyContext
    );

    try {
      const response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: 4000,
        temperature: 0.8,  // Slightly higher for creative alternatives
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type');
      }

      const possibilityMap = this.parsePossibilityMap(content.text, situation);
      const libraryEntry = await this.saveToLibrary(userId, conversationId, possibilityMap);

      logger.info('Possibility map saved to Library', {
        entry_id: libraryEntry.id,
        user_id: userId,
        title: possibilityMap.title,
        branchCount: possibilityMap.branches.length,
      });

      return libraryEntry;
    } catch (error: any) {
      logger.error('Error generating possibility map:', { error: error.message });
      throw error;
    }
  }

  /**
   * Build the possibility map prompt
   */
  private buildPossibilityMapPrompt(
    situation: string,
    factsContext: string,
    libraryContext: string,
    historyContext: string
  ): string {
    return `Matt seems focused on one path or stuck between limited options. Your job is to expand his thinking - to be the complex mind map he can't hold alone.

MATT'S SITUATION:
"${situation}"

WHAT YOU KNOW ABOUT MATT:
${factsContext}

RELEVANT PREVIOUS THOUGHTS:
${libraryContext}

RECENT CONVERSATION:
${historyContext}

---

Create a POSSIBILITY MAP that expands Matt's thinking. Your job is NOT to solve the problem, but to surface options and connections Matt might not be seeing.

Think like a mind map radiating outward from Matt's central question:

1. CENTRAL QUESTION
   What is Matt really trying to figure out? (May be different from what he literally said)

2. CURRENT FOCUS
   What narrow path or binary choice is Matt fixated on?

3. POSSIBILITY BRANCHES (Generate 4-6)
   For each branch:
   - A distinct alternative or approach
   - Brief description (2-3 sentences)
   - Strengths of this path (2-3 bullet points)
   - Considerations/tradeoffs (2-3 bullet points)
   - Connections to other things Matt knows, values, or has done

4. UNEXPECTED CONNECTION
   One insight or connection Matt almost certainly hasn't considered.
   This should come from combining things you know about Matt in unexpected ways.
   Be creative - draw from different domains of his life.

5. SYNTHESIS
   A brief (2-3 sentence) observation about the landscape of possibilities.
   NOT a recommendation - just help Matt see the terrain.

IMPORTANT PRINCIPLES:
- Present options, don't prescribe
- Include at least one unconventional option
- Draw connections across different areas of Matt's life
- Respect that Matt is intelligent - surface non-obvious things
- Don't dismiss his current focus, just expand around it
- Think in branches, not linear paths

FORMAT YOUR RESPONSE EXACTLY AS:

TITLE: [Compelling title for this possibility map - 5-12 words]

CENTRAL_QUESTION:
[What Matt is really trying to figure out]

CURRENT_FOCUS:
[The narrow path Matt is currently on]

BRANCH_1:
Option: [Name of this option]
Description: [2-3 sentences]
Strengths: [Bullet points]
Considerations: [Bullet points]
Connections: [How this connects to other things]

BRANCH_2:
[Same format...]

BRANCH_3:
[Same format...]

BRANCH_4:
[Same format...]

[Add BRANCH_5 and BRANCH_6 if valuable, but quality over quantity]

UNEXPECTED_CONNECTION:
[The surprising insight]

SYNTHESIS:
[2-3 sentence observation about the landscape]

Do not include any other text outside this format.`;
  }

  /**
   * Parse the possibility map response
   */
  private parsePossibilityMap(text: string, originalSituation: string): PossibilityMap {
    const titleMatch = text.match(/TITLE:\s*(.+?)(?:\n|$)/);
    const centralMatch = text.match(/CENTRAL_QUESTION:\s*([\s\S]*?)(?=CURRENT_FOCUS:|$)/);
    const focusMatch = text.match(/CURRENT_FOCUS:\s*([\s\S]*?)(?=BRANCH_1:|$)/);
    const unexpectedMatch = text.match(/UNEXPECTED_CONNECTION:\s*([\s\S]*?)(?=SYNTHESIS:|$)/);
    const synthesisMatch = text.match(/SYNTHESIS:\s*([\s\S]*?)$/);

    // Parse branches
    const branches: PossibilityBranch[] = [];
    const branchPattern = /BRANCH_\d+:\s*Option:\s*(.+?)\s*Description:\s*([\s\S]*?)Strengths:\s*([\s\S]*?)Considerations:\s*([\s\S]*?)Connections:\s*([\s\S]*?)(?=BRANCH_\d+:|UNEXPECTED_CONNECTION:|$)/gi;

    let branchMatch;
    while ((branchMatch = branchPattern.exec(text)) !== null) {
      const strengths = branchMatch[3].split('\n')
        .map(s => s.replace(/^[-•*]\s*/, '').trim())
        .filter(s => s.length > 0);

      const considerations = branchMatch[4].split('\n')
        .map(s => s.replace(/^[-•*]\s*/, '').trim())
        .filter(s => s.length > 0);

      const connections = branchMatch[5].split('\n')
        .map(s => s.replace(/^[-•*]\s*/, '').trim())
        .filter(s => s.length > 0);

      branches.push({
        option: branchMatch[1].trim(),
        description: branchMatch[2].trim(),
        strengths,
        considerations,
        connections,
      });
    }

    const title = titleMatch?.[1]?.trim() || 'Possibility Map';
    const centralQuestion = centralMatch?.[1]?.trim() || originalSituation;
    const currentFocus = focusMatch?.[1]?.trim() || '';
    const unexpectedConnection = unexpectedMatch?.[1]?.trim() || '';
    const synthesis = synthesisMatch?.[1]?.trim() || '';

    // Build full content for Library
    const fullContent = this.formatPossibilityMapContent(
      title,
      centralQuestion,
      currentFocus,
      branches,
      unexpectedConnection,
      synthesis
    );

    return {
      title,
      centralQuestion,
      currentFocus,
      branches,
      unexpectedConnection,
      synthesis,
      fullContent,
    };
  }

  /**
   * Format the possibility map for Library storage
   */
  private formatPossibilityMapContent(
    title: string,
    centralQuestion: string,
    currentFocus: string,
    branches: PossibilityBranch[],
    unexpectedConnection: string,
    synthesis: string
  ): string {
    let content = `# ${title}\n\n`;

    content += `## The Question\n${centralQuestion}\n\n`;

    if (currentFocus) {
      content += `## Current Focus\n${currentFocus}\n\n`;
    }

    content += `## Possibilities\n\n`;

    for (let i = 0; i < branches.length; i++) {
      const branch = branches[i];
      content += `### ${i + 1}. ${branch.option}\n`;
      content += `${branch.description}\n\n`;

      if (branch.strengths.length > 0) {
        content += `**Strengths:**\n`;
        branch.strengths.forEach(s => content += `- ${s}\n`);
        content += '\n';
      }

      if (branch.considerations.length > 0) {
        content += `**Considerations:**\n`;
        branch.considerations.forEach(c => content += `- ${c}\n`);
        content += '\n';
      }

      if (branch.connections.length > 0) {
        content += `**Connections:**\n`;
        branch.connections.forEach(c => content += `- ${c}\n`);
        content += '\n';
      }
    }

    if (unexpectedConnection) {
      content += `## Unexpected Connection\n${unexpectedConnection}\n\n`;
    }

    if (synthesis) {
      content += `## The Landscape\n${synthesis}\n`;
    }

    return content;
  }

  /**
   * Save possibility map to Library
   */
  private async saveToLibrary(
    userId: string,
    conversationId: string,
    map: PossibilityMap
  ): Promise<PossibilityLibraryEntry> {
    let embedding: number[] | null = null;
    try {
      const textForEmbedding = `${map.title} ${map.centralQuestion} ${map.synthesis}`.slice(0, 8000);
      embedding = await this.vectorService.generateEmbedding(textForEmbedding);
    } catch (error) {
      logger.warn('Failed to generate embedding for possibility map');
    }

    const embeddingString = embedding ? `[${embedding.join(',')}]` : null;

    const metadata = {
      map_type: 'possibility',
      generated_at: new Date().toISOString(),
      branch_count: map.branches.length,
      branch_options: map.branches.map(b => b.option),
      has_unexpected_connection: !!map.unexpectedConnection,
    };

    const result = await this.pool.query(
      `INSERT INTO library_entries
       (user_id, entry_type, title, content, related_conversation_id, metadata, embedding)
       VALUES ($1, 'possibility_map', $2, $3, $4, $5, $6::vector)
       RETURNING id, user_id, entry_type, title, content, metadata, created_at`,
      [
        userId,
        map.title,
        map.fullContent,
        conversationId,
        JSON.stringify(metadata),
        embeddingString,
      ]
    );

    return result.rows[0];
  }

  /**
   * Detect if Matt seems stuck or narrowly focused
   */
  detectStuckPattern(message: string): StuckInfo {
    const lowerMessage = message.toLowerCase();

    // Binary choice patterns
    const binaryPatterns = [
      { pattern: /should i .+ or .+\?/i, trigger: 'should I X or Y' },
      { pattern: /\b(either|or)\b.*\b(either|or)\b/i, trigger: 'either/or framing' },
      { pattern: /it('s| is) (between|a choice of) .+ (and|or) .+/i, trigger: 'between X and Y' },
      { pattern: /i (can|could) (only|either) .+ or .+/i, trigger: 'can only X or Y' },
      { pattern: /\b(option a|option b|option 1|option 2)\b/i, trigger: 'numbered options' },
    ];

    for (const { pattern, trigger } of binaryPatterns) {
      if (pattern.test(message)) {
        return { isStuck: true, confidence: 0.85, stuckType: 'binary_choice', trigger };
      }
    }

    // Single path fixation
    const singlePathPatterns = [
      { pattern: /i (have|need) to .+ (there('s| is) no other|only way)/i, trigger: 'only way' },
      { pattern: /the only (option|way|solution|path)/i, trigger: 'the only option' },
      { pattern: /i don('t| do not) see (any other|another)/i, trigger: 'don\'t see alternatives' },
      { pattern: /there('s| is) (nothing else|no alternative)/i, trigger: 'no alternative' },
    ];

    for (const { pattern, trigger } of singlePathPatterns) {
      if (pattern.test(message)) {
        return { isStuck: true, confidence: 0.85, stuckType: 'single_path', trigger };
      }
    }

    // Overwhelmed patterns
    const overwhelmedPatterns = [
      { pattern: /i('m| am) (so )?(overwhelmed|paralyzed|frozen)/i, trigger: 'feeling overwhelmed' },
      { pattern: /too many (options|choices|paths)/i, trigger: 'too many options' },
      { pattern: /i don('t| do not) know (where to start|what to do)/i, trigger: 'don\'t know where to start' },
      { pattern: /everything feels .* (impossible|hard|too much)/i, trigger: 'everything feels hard' },
    ];

    for (const { pattern, trigger } of overwhelmedPatterns) {
      if (pattern.test(message)) {
        return { isStuck: true, confidence: 0.8, stuckType: 'overwhelmed', trigger };
      }
    }

    // Blocked patterns
    const blockedPatterns = [
      { pattern: /i('m| am) (stuck|blocked|stalled)/i, trigger: 'feeling stuck' },
      { pattern: /i can('t| not) (figure out|see|find)/i, trigger: 'can\'t figure out' },
      { pattern: /what am i missing/i, trigger: 'what am I missing' },
      { pattern: /i('m| am) going (in )?circles/i, trigger: 'going in circles' },
      { pattern: /hit a (wall|dead end)/i, trigger: 'hit a wall' },
    ];

    for (const { pattern, trigger } of blockedPatterns) {
      if (pattern.test(message)) {
        return { isStuck: true, confidence: 0.85, stuckType: 'blocked', trigger };
      }
    }

    // Circular thinking patterns
    const circularPatterns = [
      { pattern: /keep coming back to/i, trigger: 'keep coming back' },
      { pattern: /we('ve| have) (talked|discussed) (about )?this before/i, trigger: 'discussed before' },
      { pattern: /same (question|problem|issue) again/i, trigger: 'same question again' },
    ];

    for (const { pattern, trigger } of circularPatterns) {
      if (pattern.test(message)) {
        return { isStuck: true, confidence: 0.7, stuckType: 'circular', trigger };
      }
    }

    // Explicit requests for alternatives
    const explicitPatterns = [
      { pattern: /what (else|other options)/i, trigger: 'what else' },
      { pattern: /any other (ideas|options|ways|paths)/i, trigger: 'any other ideas' },
      { pattern: /help me (see|think of) (other|more|different)/i, trigger: 'help me see alternatives' },
      { pattern: /expand my (thinking|options|view)/i, trigger: 'expand my thinking' },
    ];

    for (const { pattern, trigger } of explicitPatterns) {
      if (pattern.test(message)) {
        return { isStuck: true, confidence: 0.9, stuckType: 'blocked', trigger };
      }
    }

    return { isStuck: false, confidence: 0, stuckType: null };
  }

  /**
   * Generate a concise chat response after creating a possibility map
   */
  async generateConciseResponse(
    userMessage: string,
    map: PossibilityMap,
    libraryEntryId: string
  ): Promise<string> {
    try {
      const branchNames = map.branches.map(b => b.option).join(', ');

      const prompt = `You just created a possibility map for Matt. It's saved in the Library.

The map title: "${map.title}"
Central question: ${map.centralQuestion}
Options explored: ${branchNames}
Unexpected connection: ${map.unexpectedConnection?.slice(0, 150)}...

Now respond CONVERSATIONALLY in 50-150 words.

Rules:
- Don't summarize the whole map
- Pick ONE interesting possibility or connection to highlight
- Ask a question that helps Matt engage with the options
- Be encouraging - you've opened up space, not solved the problem
- Make him curious to explore the full map

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
        return `I've mapped out some possibilities. Take a look at the full picture in the Library.`;
      }

      const chatResponse = content.text.trim();
      return `${chatResponse}\n\n[I created a possibility map in the Library](library://${libraryEntryId})`;
    } catch (error: any) {
      logger.error('Error generating concise response:', { error: error.message });
      return `I've explored some alternatives. [See the full possibility map](library://${libraryEntryId})`;
    }
  }

  /**
   * Get recent possibility maps for a user
   */
  async getRecentPossibilityMaps(
    userId: string,
    limit: number = 5
  ): Promise<PossibilityLibraryEntry[]> {
    const result = await this.pool.query(
      `SELECT id, user_id, entry_type, title, content, metadata, created_at
       FROM library_entries
       WHERE user_id = $1 AND entry_type = 'possibility_map'
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows;
  }

  /**
   * Generate sigma-based possibilities for visual rendering
   *
   * Sigma levels:
   * - 1σ: Adjacent thinking (user might get here naturally)
   * - 2σ: Requires stretching (user would probably miss)
   * - 3σ: Edge cases, contrarian views (almost never considered)
   */
  async generateSigmaPossibilities(
    userId: string,
    focus: string,
    options: {
      sigma?: 1 | 2 | 3;  // If provided, only generate for this level
      count?: number;      // Possibilities per sigma level (default 3)
      conversationId?: string;
    } = {}
  ): Promise<{
    focus: string;
    focusReframed?: string;
    possibilities: {
      sigma1: Array<{ id: string; text: string; category: string; reasoning?: string }>;
      sigma2: Array<{ id: string; text: string; category: string; reasoning?: string }>;
      sigma3: Array<{ id: string; text: string; category: string; reasoning?: string }>;
    };
  }> {
    const { sigma, count = 3, conversationId } = options;

    logger.info('Generating sigma possibilities', {
      user_id: userId,
      focus: focus.slice(0, 50),
      sigma,
      count,
    });

    // Gather context
    const facts = await this.memoryService.getRelevantFacts(userId, 10);
    const factsContext = facts.length > 0
      ? facts.map(f => `- ${f.content}`).join('\n')
      : 'No facts known yet.';

    const sigmaToGenerate = sigma ? [sigma] : [1, 2, 3];
    const prompt = this.buildSigmaPrompt(focus, factsContext, sigmaToGenerate, count);

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',  // Faster model for structured generation
        max_tokens: 2000,
        temperature: 0.85,  // Higher for creative alternatives
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type');
      }

      const parsed = this.parseSigmaResponse(content.text, focus);

      logger.info('Sigma possibilities generated', {
        user_id: userId,
        sigma1_count: parsed.possibilities.sigma1.length,
        sigma2_count: parsed.possibilities.sigma2.length,
        sigma3_count: parsed.possibilities.sigma3.length,
      });

      return parsed;
    } catch (error: any) {
      logger.error('Error generating sigma possibilities:', { error: error.message });
      throw error;
    }
  }

  /**
   * Build prompt for sigma-based possibility generation
   */
  private buildSigmaPrompt(
    focus: string,
    factsContext: string,
    sigmaLevels: number[],
    countPerLevel: number
  ): string {
    const sigmaDescriptions = {
      1: '1σ (ADJACENT): Alternatives the user might reach naturally with a bit more thought. Practical, nearby options. Category: "practical"',
      2: '2σ (STRETCH): Alternatives that require stretching - the user would probably miss these on their own. May reframe the problem. Categories: "practical" or "reframe"',
      3: '3σ (EDGE): Contrarian views, wildcards, radical reframes. Things almost never considered. Challenge assumptions. Categories: "reframe" or "contrarian"',
    };

    const sigmaInstructions = sigmaLevels
      .map(s => `${sigmaDescriptions[s as 1 | 2 | 3]} — Generate ${countPerLevel} possibilities`)
      .join('\n\n');

    return `You help humans see beyond their natural focus. Humans anchor on obvious options and rarely explore past their immediate thinking. You can surface the wider landscape.

USER'S FOCUS:
"${focus}"

WHAT YOU KNOW ABOUT THIS USER:
${factsContext}

---

Generate possibilities at the requested sigma levels. Each level represents how far from the user's natural thinking:

${sigmaInstructions}

CATEGORIES:
- "practical": Concrete, actionable alternatives
- "reframe": Questions the framing or assumptions
- "contrarian": Challenges the premise, suggests the opposite

RESPOND WITH VALID JSON ONLY:
{
  "focusReframed": "What the user might actually be trying to figure out (optional, if different from stated)",
  "sigma1": [
    { "text": "possibility text", "category": "practical", "reasoning": "why this is 1σ" }
  ],
  "sigma2": [
    { "text": "possibility text", "category": "reframe", "reasoning": "why this is 2σ" }
  ],
  "sigma3": [
    { "text": "possibility text", "category": "contrarian", "reasoning": "why this is 3σ" }
  ]
}

Only include the sigma levels requested. Be specific, not generic. Each possibility should be genuinely useful.`;
  }

  /**
   * Parse sigma response from Claude
   */
  private parseSigmaResponse(
    text: string,
    focus: string
  ): {
    focus: string;
    focusReframed?: string;
    possibilities: {
      sigma1: Array<{ id: string; text: string; category: string; reasoning?: string }>;
      sigma2: Array<{ id: string; text: string; category: string; reasoning?: string }>;
      sigma3: Array<{ id: string; text: string; category: string; reasoning?: string }>;
    };
  } {
    try {
      // Extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Add IDs to each possibility
      const addIds = (items: any[] = []) =>
        items.map((item, i) => ({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          text: item.text || item,
          category: item.category || 'practical',
          reasoning: item.reasoning,
        }));

      return {
        focus,
        focusReframed: parsed.focusReframed,
        possibilities: {
          sigma1: addIds(parsed.sigma1),
          sigma2: addIds(parsed.sigma2),
          sigma3: addIds(parsed.sigma3),
        },
      };
    } catch (error: any) {
      logger.error('Error parsing sigma response:', { error: error.message, text: text.slice(0, 200) });
      // Return empty structure on parse error
      return {
        focus,
        possibilities: {
          sigma1: [],
          sigma2: [],
          sigma3: [],
        },
      };
    }
  }
}

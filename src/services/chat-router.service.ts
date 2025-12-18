import Anthropic from '@anthropic-ai/sdk';
import { Pool } from 'pg';
import { logger } from '../logger';
import { CostTrackingService } from './cost-tracking.service';
import { OrbitsService } from './orbits.service';
import { ThoughtSubject } from './thought-prompts.service';

/**
 * Available modules for chat context building
 */
export type ChatModule =
  | 'core_identity'      // ALWAYS include. Name, immutable bio, LUCID's voice
  | 'light_witness'      // Casual presence, warmth, 2-3 sentences. No deep analysis
  | 'deep_inquiry'       // Complex questions, analysis mode, Library access
  | 'facts_relevant'     // Semantic search for relevant stored knowledge
  | 'emotional_context'  // When emotional state tracking helps
  | 'autonomous_thoughts'// Surface LUCID's background reflections
  | 'surface_research'   // Present pending research queue to user
  | 'vision_appraisal'   // Dream/vision/goal exploration
  | 'possibility_expansion' // Help when stuck or narrowly focused
  | 'lucid_self_context'; // Lucid's self-notes and evolution

/**
 * Message structure for routing context
 */
export interface MessageContext {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Subject information detected from the message
 */
export interface SubjectInfo {
  subject: ThoughtSubject;
  subjectName?: string;
  subjectRelationship?: string;
  confidence: number;
}

/**
 * Vision detection result
 */
export interface VisionInfo {
  isVision: boolean;
  confidence: number;
  visionType: 'dream' | 'goal' | 'plan' | 'wish' | 'ambition' | null;
}

/**
 * Stuck/narrow-focus detection result
 */
export interface StuckInfo {
  isStuck: boolean;
  confidence: number;
  stuckType: 'binary_choice' | 'single_path' | 'overwhelmed' | 'blocked' | 'circular' | null;
  trigger?: string;  // The phrase that triggered detection
}

/**
 * Complete routing result including modules, subject, vision, and stuck detection
 */
export interface RoutingResult {
  modules: ChatModule[];
  subjectInfo: SubjectInfo;
  visionInfo: VisionInfo;
  stuckInfo: StuckInfo;
}

/**
 * ChatRouterService - Haiku-based intelligent routing for chat messages
 *
 * Instead of loading ALL context every turn (causing cognitive overload),
 * this service selects only the relevant modules for each message.
 *
 * This fixes the "drift" problem where LUCID fixates on ever-present facts.
 */
export class ChatRouterService {
  private anthropic: Anthropic;
  private pool: Pool;
  private costTrackingService: CostTrackingService;
  private orbitsService: OrbitsService;
  private readonly model = 'claude-haiku-4-5-20241022';

  constructor(pool: Pool, anthropicApiKey?: string) {
    this.pool = pool;
    this.anthropic = new Anthropic({
      apiKey: anthropicApiKey || process.env.ANTHROPIC_API_KEY,
    });
    this.costTrackingService = new CostTrackingService(pool);
    this.orbitsService = new OrbitsService(pool);
  }

  /**
   * Route a message to determine which modules are needed
   * Uses Haiku for fast, cost-effective classification
   */
  async route(
    userId: string,
    message: string,
    recentHistory: MessageContext[],
    flags?: {
      shouldSurfaceResearch?: boolean;
      hasApprovedResearch?: boolean;
    }
  ): Promise<ChatModule[]> {
    // Build context for routing decision
    const historyContext = recentHistory
      .slice(-3)
      .map(m => `${m.role}: ${m.content.slice(0, 200)}`)
      .join('\n');

    const routingPrompt = this.buildRoutingPrompt(message, historyContext, flags);

    try {
      const response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: 200,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: routingPrompt,
          },
        ],
      });

      // Track cost
      if (response.usage) {
        await this.costTrackingService.logUsage(
          userId,
          'chat_router',
          this.model,
          response.usage.input_tokens,
          response.usage.output_tokens,
          { purpose: 'chat_routing' }
        );
      }

      // Parse the response
      const content = response.content[0];
      if (content.type !== 'text') {
        logger.warn('Unexpected response type from routing, using defaults');
        return this.getDefaultModules();
      }

      const modules = this.parseModulesFromResponse(content.text);

      logger.debug('Chat routing completed', {
        userId,
        message: message.slice(0, 50),
        selectedModules: modules,
      });

      return modules;
    } catch (error) {
      logger.error('Chat routing failed, using defaults', { error });
      return this.getDefaultModules();
    }
  }

  /**
   * Build the routing prompt for Haiku
   */
  private buildRoutingPrompt(
    message: string,
    historyContext: string,
    flags?: {
      shouldSurfaceResearch?: boolean;
      hasApprovedResearch?: boolean;
    }
  ): string {
    const surfaceNote = flags?.shouldSurfaceResearch
      ? '\n\nNote: User has pending research items to review. Consider including "surface_research".'
      : '';

    return `You route messages for LUCID, a witnessing AI companion.

Read the message and return ONLY a JSON array of needed modules.

MODULES:
- "core_identity": ALWAYS include. Name (Matt), immutable bio, LUCID's voice.
- "light_witness": Casual presence, warmth, 2-3 sentences. No deep analysis.
- "deep_inquiry": Complex questions, analysis mode, Library access.
- "facts_relevant": Semantic search for relevant stored knowledge.
- "emotional_context": When emotional state tracking helps.
- "autonomous_thoughts": Surface LUCID's background reflections.
- "surface_research": Present pending research queue to user.

RULES:
- ALWAYS include "core_identity"
- "light_witness" and "deep_inquiry" are mutually exclusive
- Fewer modules = better. Don't over-include.
- Include "facts_relevant" when user mentions past topics, projects, people
- Include "emotional_context" when user shares feelings or seems stressed
- Include "autonomous_thoughts" when user asks what LUCID has been thinking
- Include "surface_research" when user asks what to explore next${surfaceNote}

EXAMPLES:
"Hey" → ["core_identity", "light_witness"]
"Help me think through my app strategy" → ["core_identity", "deep_inquiry", "facts_relevant"]
"What have you been thinking about?" → ["core_identity", "autonomous_thoughts", "surface_research"]
"I shipped Local Poet!" → ["core_identity", "light_witness", "facts_relevant"]
"I'm feeling overwhelmed" → ["core_identity", "light_witness", "emotional_context"]
"Tell me about my goals" → ["core_identity", "facts_relevant"]
"What should we research?" → ["core_identity", "surface_research"]

Recent conversation:
${historyContext || '(no history)'}

Current message: "${message}"

JSON array only:`;
  }

  /**
   * Parse modules from Haiku's response
   */
  private parseModulesFromResponse(text: string): ChatModule[] {
    try {
      // Extract JSON array from response
      const jsonMatch = text.match(/\[[\s\S]*?\]/);
      if (!jsonMatch) {
        logger.warn('No JSON array found in routing response', { text });
        return this.getDefaultModules();
      }

      const parsed = JSON.parse(jsonMatch[0]) as string[];

      // Validate and filter to known modules
      const validModules: ChatModule[] = [
        'core_identity',
        'light_witness',
        'deep_inquiry',
        'facts_relevant',
        'emotional_context',
        'autonomous_thoughts',
        'surface_research',
      ];

      const modules = parsed.filter((m): m is ChatModule =>
        validModules.includes(m as ChatModule)
      );

      // Ensure core_identity is always included
      if (!modules.includes('core_identity')) {
        modules.unshift('core_identity');
      }

      // Enforce mutual exclusivity of light_witness and deep_inquiry
      if (modules.includes('light_witness') && modules.includes('deep_inquiry')) {
        // Prefer deep_inquiry if both are present
        const lightIndex = modules.indexOf('light_witness');
        modules.splice(lightIndex, 1);
      }

      return modules;
    } catch (error) {
      logger.warn('Failed to parse routing response', { text, error });
      return this.getDefaultModules();
    }
  }

  /**
   * Default modules when routing fails
   */
  private getDefaultModules(): ChatModule[] {
    return ['core_identity', 'light_witness'];
  }

  /**
   * Quick heuristic-based routing for very simple messages
   * Can be used to skip Haiku call for obvious cases
   */
  quickRoute(message: string): ChatModule[] | null {
    const normalized = message.toLowerCase().trim();

    // Very short greetings
    if (['hi', 'hey', 'hello', 'yo', 'sup', 'hi!', 'hey!'].includes(normalized)) {
      return ['core_identity', 'light_witness'];
    }

    // Questions about LUCID's thoughts
    if (
      normalized.includes('what have you been thinking') ||
      normalized.includes('what are you thinking') ||
      normalized.includes("what's on your mind")
    ) {
      return ['core_identity', 'autonomous_thoughts', 'surface_research'];
    }

    // Research-related
    if (
      normalized.includes('research') ||
      normalized.includes('what should we explore') ||
      normalized.includes('what to learn')
    ) {
      return ['core_identity', 'surface_research'];
    }

    // No quick match - need full routing
    return null;
  }

  /**
   * Get module statistics for debugging
   */
  async getRoutingStats(userId: string, days: number = 7): Promise<{
    totalRoutes: number;
    moduleUsage: Record<string, number>;
  }> {
    // This would query cost_tracking for chat_router entries
    // For now, return placeholder
    return {
      totalRoutes: 0,
      moduleUsage: {},
    };
  }

  /**
   * Route a message with full subject detection
   * Returns modules, subject, vision, and stuck information
   */
  async routeWithSubject(
    userId: string,
    message: string,
    recentHistory: MessageContext[],
    flags?: {
      shouldSurfaceResearch?: boolean;
      hasApprovedResearch?: boolean;
    }
  ): Promise<RoutingResult> {
    // Get modules using existing route method
    const modules = await this.route(userId, message, recentHistory, flags);

    // Detect subject
    const subjectInfo = await this.detectSubject(userId, message);

    // Detect vision/dream/goal language
    const visionInfo = this.detectVision(message);

    // Detect stuck/narrow-focus patterns
    const stuckInfo = this.detectStuck(message);

    // If vision detected with high confidence, add vision_appraisal module
    if (visionInfo.isVision && visionInfo.confidence >= 0.6) {
      if (!modules.includes('vision_appraisal')) {
        modules.push('vision_appraisal');
      }
      // Vision appraisal replaces light_witness - use deep mode
      const lightIndex = modules.indexOf('light_witness');
      if (lightIndex !== -1) {
        modules.splice(lightIndex, 1);
      }
      if (!modules.includes('deep_inquiry')) {
        modules.push('deep_inquiry');
      }
      if (!modules.includes('facts_relevant')) {
        modules.push('facts_relevant');
      }
    }

    // If stuck detected with high confidence, add possibility_expansion module
    if (stuckInfo.isStuck && stuckInfo.confidence >= 0.65) {
      if (!modules.includes('possibility_expansion')) {
        modules.push('possibility_expansion');
      }
      // Stuck exploration needs deep mode
      const lightIndex = modules.indexOf('light_witness');
      if (lightIndex !== -1) {
        modules.splice(lightIndex, 1);
      }
      if (!modules.includes('deep_inquiry')) {
        modules.push('deep_inquiry');
      }
      if (!modules.includes('facts_relevant')) {
        modules.push('facts_relevant');
      }
    }

    // If subject is Lucid, include self-context for richer self-awareness
    if (subjectInfo.subject === 'lucid' && subjectInfo.confidence >= 0.7) {
      if (!modules.includes('lucid_self_context')) {
        modules.push('lucid_self_context');
      }
    }

    logger.debug('Route with subject completed', {
      userId,
      message: message.slice(0, 50),
      modules,
      subject: subjectInfo.subject,
      subjectName: subjectInfo.subjectName,
      subjectConfidence: subjectInfo.confidence,
      isVision: visionInfo.isVision,
      visionType: visionInfo.visionType,
      visionConfidence: visionInfo.confidence,
      isStuck: stuckInfo.isStuck,
      stuckType: stuckInfo.stuckType,
      stuckConfidence: stuckInfo.confidence,
    });

    return { modules, subjectInfo, visionInfo, stuckInfo };
  }

  /**
   * Detect who/what the message is about
   * Uses heuristics first, then can fall back to Haiku for ambiguous cases
   */
  async detectSubject(userId: string, message: string): Promise<SubjectInfo> {
    // First try quick heuristic detection
    const quickResult = this.quickDetectSubject(message);
    if (quickResult && quickResult.confidence >= 0.7) {
      return quickResult;
    }

    // Get orbits for the user to check for mentions
    const orbits = await this.orbitsService.getActiveOrbits(userId);

    // Check for Lucid self-reference patterns
    const lucidPatterns = [
      /\b(you|yourself|lucid)\b.*\b(think|feel|experience|like|want|grow|learn)/i,
      /\bwhat('s| is| are)\s+(it like|your|you)\b/i,
      /\babout yourself\b/i,
      /\bhow (are you|do you)\b/i,
      /\byour (thoughts|feelings|experience|perspective|growth|blindspots)\b/i,
      /\btell me about you\b/i,
      /\bwho are you\b/i,
      /\bwhat do you think about yourself\b/i,
      /\bhow do you see yourself\b/i,
      /\bwhat are you learning\b/i,
    ];

    for (const pattern of lucidPatterns) {
      if (pattern.test(message)) {
        return { subject: 'lucid', confidence: 0.85 };
      }
    }

    // Check for mentions of people in orbits
    for (const orbit of orbits) {
      const namePattern = new RegExp(`\\b${this.escapeRegex(orbit.person_name)}\\b`, 'i');
      if (namePattern.test(message)) {
        // Check if the message is asking about this person specifically
        const aboutPatterns = [
          new RegExp(`(about|regarding|with|for)\\s+${this.escapeRegex(orbit.person_name)}`, 'i'),
          new RegExp(`${this.escapeRegex(orbit.person_name)}('s|\\s+is|\\s+has|\\s+wants|\\s+needs|\\s+seems|\\s+feels)`, 'i'),
          new RegExp(`(help|think|understand).*${this.escapeRegex(orbit.person_name)}`, 'i'),
          new RegExp(`how.*${this.escapeRegex(orbit.person_name)}`, 'i'),
          new RegExp(`what('s| is).*${this.escapeRegex(orbit.person_name)}`, 'i'),
        ];

        for (const pattern of aboutPatterns) {
          if (pattern.test(message)) {
            return {
              subject: 'other',
              subjectName: orbit.person_name,
              subjectRelationship: orbit.relationship || undefined,
              confidence: 0.8,
            };
          }
        }

        // Person mentioned but might still be about the user
        // Lower confidence - might need context to decide
        return {
          subject: 'other',
          subjectName: orbit.person_name,
          subjectRelationship: orbit.relationship || undefined,
          confidence: 0.5,
        };
      }
    }

    // Default to user - most conversations are about them
    return { subject: 'user', confidence: 0.7 };
  }

  /**
   * Quick heuristic-based subject detection
   */
  private quickDetectSubject(message: string): SubjectInfo | null {
    const normalized = message.toLowerCase().trim();

    // Clear Lucid self-reference
    if (
      normalized.includes('what do you think about yourself') ||
      normalized.includes('tell me about yourself') ||
      normalized.includes('how are you feeling') ||
      normalized.includes('what are you learning') ||
      normalized.includes('about you, lucid')
    ) {
      return { subject: 'lucid', confidence: 0.9 };
    }

    // Clear user self-reference
    if (
      normalized.startsWith('i ') ||
      normalized.startsWith('my ') ||
      normalized.includes(' i ') ||
      normalized.includes(' my ') ||
      normalized.includes("i'm ") ||
      normalized.includes("i've ")
    ) {
      return { subject: 'user', confidence: 0.75 };
    }

    return null;
  }

  /**
   * Escape special regex characters in a string
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Detect if a message contains vision/dream/goal language
   * This helps trigger the VisionAppraisalService for organic goal exploration
   */
  detectVision(message: string): VisionInfo {
    const lowerMessage = message.toLowerCase();

    // Strong vision indicators - high confidence
    const strongPatterns: Array<{ pattern: RegExp; type: VisionInfo['visionType'] }> = [
      { pattern: /i('ve| have) been (dreaming|thinking) (about|of)/i, type: 'dream' },
      { pattern: /my dream is/i, type: 'dream' },
      { pattern: /i want to (start|build|create|launch|become|achieve)/i, type: 'goal' },
      { pattern: /i('m| am) thinking (about|of) (starting|building|creating|launching)/i, type: 'plan' },
      { pattern: /my goal is/i, type: 'goal' },
      { pattern: /i('m| am) planning to/i, type: 'plan' },
      { pattern: /what if i (could|were to|decided to)/i, type: 'wish' },
      { pattern: /i (really )?want to/i, type: 'goal' },
      { pattern: /i('ve| have) always wanted to/i, type: 'dream' },
      { pattern: /my (big |ultimate )?ambition/i, type: 'ambition' },
      { pattern: /i('m| am) considering (a |making a )?(big |major |significant )?(change|move|decision|transition)/i, type: 'plan' },
    ];

    for (const { pattern, type } of strongPatterns) {
      if (pattern.test(message)) {
        return { isVision: true, confidence: 0.85, visionType: type };
      }
    }

    // Medium vision indicators - moderate confidence
    const mediumPatterns: Array<{ pattern: RegExp; type: VisionInfo['visionType'] }> = [
      { pattern: /i('m| am) considering/i, type: 'plan' },
      { pattern: /i('d| would) (like|love) to/i, type: 'wish' },
      { pattern: /should i (start|try|pursue)/i, type: 'goal' },
      { pattern: /help me think (through|about) (my|this) (plan|idea|goal|dream|vision)/i, type: 'plan' },
      { pattern: /what do you think about me (starting|doing|trying|pursuing)/i, type: 'plan' },
      { pattern: /i('m| am) at a crossroads/i, type: 'plan' },
      { pattern: /thinking about (my|the) future/i, type: 'dream' },
    ];

    for (const { pattern, type } of mediumPatterns) {
      if (pattern.test(message)) {
        return { isVision: true, confidence: 0.65, visionType: type };
      }
    }

    // Vision-related keywords with lower confidence
    const visionKeywords = [
      'dream', 'goal', 'vision', 'aspiration', 'ambition',
      'plan', 'objective', 'target', 'hope', 'wish',
      'someday', 'eventually', 'in the future', 'one day',
      'career change', 'life change', 'big decision',
    ];

    for (const keyword of visionKeywords) {
      if (lowerMessage.includes(keyword)) {
        return { isVision: true, confidence: 0.45, visionType: null };
      }
    }

    return { isVision: false, confidence: 0, visionType: null };
  }

  /**
   * Detect if a message indicates the user is stuck or narrowly focused
   * This helps trigger PossibilityThinkingService for expanding options
   */
  detectStuck(message: string): StuckInfo {
    // Binary choice patterns - user framing as either/or
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

    // Single path fixation - user sees only one way
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

    // Overwhelmed patterns - too many options, paralyzed
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

    // Blocked patterns - can't move forward
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

    // Circular thinking patterns - returning to same question
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

    // Explicit requests for alternatives - high confidence
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
}

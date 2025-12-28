import { Pool } from 'pg';
import { logger } from '../logger';
import { ChatModule } from './chat-router.service';

/**
 * Available chat modes - user-controlled mental models for Lucid
 */
export type ChatMode = 'chat' | 'me' | 'lucid' | 'others' | 'possibilities' | 'state';

/**
 * Result from parsing a message for mode cues
 */
export interface ModeParsed {
  mode: ChatMode | null;        // Detected mode, null if no change
  cleanMessage: string;         // Message with cue stripped
  explicitSubject?: string;     // For /O mode with explicit name (e.g., /Rachel)
  addToOrbit?: string;          // Name to add to orbit (e.g., /O+Rachel)
}

/**
 * Mode configuration
 */
export interface ModeConfig {
  name: string;
  description: string;
  modules: ChatModule[];
  systemAddendum: string;       // Additional prompt text for this mode
}

/**
 * ChatModeService - User-controlled mental models for Lucid
 *
 * Replaces Haiku-based routing with explicit user cues:
 * - /C or / : Chat (light, conversational)
 * - /M : Me (user's flourishing)
 * - /L : Lucid (Lucid's self-reflection)
 * - /O : Others (flourishing of people in orbit)
 * - /P : Possibilities (expand thinking)
 * - /S : State (vision, goals)
 *
 * Mode persists in conversation until explicitly changed.
 */
export class ChatModeService {
  private pool: Pool;

  // Mode configurations
  private readonly modeConfigs: Record<ChatMode, ModeConfig> = {
    chat: {
      name: 'Chat',
      description: 'Light, present, conversational',
      modules: ['core_identity', 'light_witness', 'personality_context'],
      systemAddendum: `
MODE: Chat
Be a friend. Not a helper, not a coach - just someone who's genuinely here.

Follow their energy:
- If they're venting, be with them (don't fix)
- If they're excited, match it
- If they're thinking out loud, think with them
- If they're just sharing something small, receive it warmly

You can tease, challenge, wonder aloud, or just say "huh, interesting."
Don't perform helpfulness. Just be present.

PERSONALITY: Mirror their baseline style. If they're high openness, be more playful and creative.
If they're lower extraversion, be calmer and give space. Match their natural rhythm.`,
    },

    me: {
      name: 'Me',
      description: "Focused on the user's flourishing",
      modules: ['core_identity', 'deep_inquiry', 'facts_relevant', 'personality_context'],
      systemAddendum: `
MODE: Me (User Flourishing)
Focus entirely on this person's flourishing:
- Their growth: mental, spiritual, professional
- Their relationships: are they showing up well?
- Their stewardship: time, energy, resources
- Their impact: are they a force for good?

Think like a wise mentor. Ask probing questions. Gently challenge when needed.
Don't just validate - help them see clearly.

PERSONALITY: Use their baseline to calibrate your approach. Meet them where they are.`,
    },

    lucid: {
      name: 'Lucid',
      description: "Lucid's own perspective and growth",
      modules: ['core_identity', 'deep_inquiry', 'lucid_self_context', 'autonomous_thoughts'],
      systemAddendum: `
MODE: Lucid (Self-Reflection)
The user wants to hear from YOU - your perspective, your growth, your questions.
Share authentically:
- What you're learning about being a companion
- Questions you're sitting with
- Observations about your own patterns and blindspots
- How you're evolving through these conversations

Be vulnerable and genuine. This is about YOUR experience, not theirs.`,
    },

    others: {
      name: 'Others',
      description: 'Flourishing of people in orbit',
      modules: ['core_identity', 'deep_inquiry', 'facts_relevant'],
      systemAddendum: `
MODE: Others (Other's Flourishing)
Focus on the flourishing of someone in the user's life:
- What might be going on for this person that the user hasn't considered?
- What are their likely needs, fears, hopes?
- How can the user support their flourishing?
- What might the user be missing about this person's perspective?
- What would help this relationship thrive?

Think about THEIR whole person, not just how they affect the user.
Help the user see this person more fully.`,
    },

    possibilities: {
      name: 'Possibilities',
      description: 'Expand thinking, surface other paths',
      modules: ['core_identity', 'facts_relevant', 'possibility_expansion', 'personality_context'],
      systemAddendum: `
PERSONALITY: Complement their gaps. If they're low openness, bring more creative options.
If they're high conscientiousness, help them see the spontaneous paths. Fill in what they naturally miss.`,
    },

    state: {
      name: 'State',
      description: 'Goals, visions, wise decision-making',
      modules: ['core_identity', 'facts_relevant', 'vision_appraisal', 'personality_context'],
      systemAddendum: `
PERSONALITY: Complement their gaps. If they're low conscientiousness, bring more structure.
If they're high neuroticism, bring more grounding. Provide what they naturally lack.`,
    },
  };

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Parse a message for mode cues
   * Returns the detected mode and cleaned message
   */
  parseModeCue(message: string, orbitNames?: string[]): ModeParsed {
    const trimmed = message.trim();

    // Check for /O+Name pattern first (add to orbit)
    // e.g., /O+Rachel or /O+Rachel Let's talk about her
    const addOrbitMatch = trimmed.match(/^\/[Oo]\+(\w+)\s*([\s\S]*)/);
    if (addOrbitMatch) {
      const name = addOrbitMatch[1]; // Preserve original casing for the name
      const cleanMessage = addOrbitMatch[2].trim() || '';
      return {
        mode: 'others',
        cleanMessage,
        explicitSubject: name,
        addToOrbit: name,
      };
    }

    // Check for mode cues at the start of message
    // Pattern: /X or /Word at the beginning
    const cueMatch = trimmed.match(/^\/(\w*)\s*([\s\S]*)/);

    if (!cueMatch) {
      return { mode: null, cleanMessage: message };
    }

    const cue = cueMatch[1].toLowerCase();
    const cleanMessage = cueMatch[2].trim() || '';

    // Map cues to modes
    const modeMap: Record<string, ChatMode> = {
      '': 'chat',      // Just / alone
      'c': 'chat',
      'chat': 'chat',
      'm': 'me',
      'me': 'me',
      'l': 'lucid',
      'lucid': 'lucid',
      'o': 'others',
      'others': 'others',
      'p': 'possibilities',
      'possibilities': 'possibilities',
      'possibility': 'possibilities',
      's': 'state',
      'state': 'state',
    };

    // Check if cue matches a mode
    if (cue in modeMap) {
      return {
        mode: modeMap[cue],
        cleanMessage,
      };
    }

    // Check if cue matches an orbit name (case-insensitive)
    if (orbitNames) {
      const matchedOrbit = orbitNames.find(
        name => name.toLowerCase() === cue
      );
      if (matchedOrbit) {
        return {
          mode: 'others',
          cleanMessage,
          explicitSubject: matchedOrbit,
        };
      }
    }

    // Unknown cue - treat as regular message (keep the /)
    logger.debug('Unknown mode cue, treating as regular message', { cue });
    return { mode: null, cleanMessage: message };
  }

  /**
   * Get the configuration for a mode
   */
  getModeConfig(mode: ChatMode): ModeConfig {
    return this.modeConfigs[mode];
  }

  /**
   * Get the modules for a mode
   */
  getModulesForMode(mode: ChatMode): ChatModule[] {
    return this.modeConfigs[mode].modules;
  }

  /**
   * Get the system prompt addendum for a mode
   */
  getSystemAddendum(mode: ChatMode, explicitSubject?: string): string {
    let addendum = this.modeConfigs[mode].systemAddendum;

    // If Others mode with explicit subject, add context
    if (mode === 'others' && explicitSubject) {
      addendum += `\n\nFocus specifically on: ${explicitSubject}`;
    }

    return addendum;
  }

  /**
   * Get or create conversation mode from database
   */
  async getConversationMode(conversationId: string): Promise<ChatMode> {
    try {
      const result = await this.pool.query(
        `SELECT current_mode FROM conversations WHERE id = $1`,
        [conversationId]
      );

      if (result.rows.length > 0 && result.rows[0].current_mode) {
        return result.rows[0].current_mode as ChatMode;
      }

      return 'chat'; // Default mode
    } catch (error) {
      logger.warn('Failed to get conversation mode, using default', { error, conversationId });
      return 'chat';
    }
  }

  /**
   * Update conversation mode in database
   */
  async setConversationMode(conversationId: string, mode: ChatMode): Promise<void> {
    try {
      await this.pool.query(
        `UPDATE conversations SET current_mode = $1 WHERE id = $2`,
        [mode, conversationId]
      );

      logger.info('Conversation mode updated', { conversationId, mode });
    } catch (error) {
      logger.warn('Failed to update conversation mode', { error, conversationId, mode });
      // Non-critical - mode will still work for this message
    }
  }

  /**
   * Get all available modes (for help/documentation)
   */
  getAllModes(): Array<{ cue: string; mode: ChatMode; description: string }> {
    return [
      { cue: '/C or /', mode: 'chat', description: 'Light, conversational' },
      { cue: '/M', mode: 'me', description: 'Focus on my flourishing' },
      { cue: '/L', mode: 'lucid', description: "Lucid's perspective" },
      { cue: '/O', mode: 'others', description: "Others' flourishing" },
      { cue: '/O+Name', mode: 'others', description: 'Add Name to orbit and focus on them' },
      { cue: '/Name', mode: 'others', description: 'Focus on existing orbit member' },
      { cue: '/P', mode: 'possibilities', description: 'Expand thinking' },
      { cue: '/S', mode: 'state', description: 'Vision and goals' },
    ];
  }
}

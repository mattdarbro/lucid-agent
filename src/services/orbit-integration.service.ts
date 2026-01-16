import { Pool } from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { OrbitsService, OrbitPersonInput } from './orbits.service';
import { VectorService } from './vector.service';
import { Orbit } from '../types/database';

/**
 * Person mention detected in a message
 */
interface PersonMention {
  name: string;
  relationship?: string;
  isNewPerson: boolean;
  existingOrbit?: Orbit;
  context: string;  // The surrounding text that mentions this person
  significance: 'passing' | 'discussed' | 'focus';  // How central they are to the message
}

/**
 * Information extracted about a person from conversation
 */
interface ExtractedPersonInfo {
  name: string;
  relationship?: string;
  currentSituation?: string;
  howAffectsUser?: string;
  suggestedTier?: 'inner' | 'mid' | 'outer';
}

/**
 * Result of processing a message for orbit updates
 */
interface OrbitProcessingResult {
  mentionsDetected: PersonMention[];
  orbitsUpdated: string[];  // Names of orbits that were touched
  newPeopleDetected: ExtractedPersonInfo[];  // New people we might want to add
  shouldPromptForNewOrbit: boolean;  // Should we ask Matt about adding someone?
}

/**
 * OrbitIntegrationService
 *
 * Integrates orbits with the conversation flow:
 * 1. Detects mentions of people in messages
 * 2. Auto-updates last_mentioned_at and extracts new info
 * 3. Detects new people that might be worth tracking
 * 4. Links orbit_reflection entries to specific orbits
 */
export class OrbitIntegrationService {
  private pool: Pool;
  private anthropic: Anthropic;
  private orbitsService: OrbitsService;
  private vectorService: VectorService;
  private readonly model = 'claude-haiku-4-5-20241022';

  constructor(pool: Pool, anthropicApiKey?: string) {
    this.pool = pool;
    this.anthropic = new Anthropic({
      apiKey: anthropicApiKey || process.env.ANTHROPIC_API_KEY,
    });
    this.orbitsService = new OrbitsService(pool);
    this.vectorService = new VectorService();
  }

  /**
   * Process a message to detect and handle orbit mentions
   * Called after each user message in the chat flow
   */
  async processMessageForOrbits(
    userId: string,
    message: string,
    assistantResponse?: string
  ): Promise<OrbitProcessingResult> {
    const result: OrbitProcessingResult = {
      mentionsDetected: [],
      orbitsUpdated: [],
      newPeopleDetected: [],
      shouldPromptForNewOrbit: false,
    };

    try {
      // Get existing orbits for this user
      const existingOrbits = await this.orbitsService.getActiveOrbits(userId);

      // Detect mentions of existing orbit people
      const existingMentions = this.detectExistingOrbitMentions(message, existingOrbits);

      // Touch all mentioned orbits (update last_mentioned_at)
      for (const mention of existingMentions) {
        if (mention.existingOrbit) {
          await this.orbitsService.touchOrbitPerson(userId, mention.name);
          result.orbitsUpdated.push(mention.name);
        }
        result.mentionsDetected.push(mention);
      }

      // Check for potentially new people (names we don't recognize)
      const potentialNewPeople = await this.detectPotentialNewPeople(
        userId,
        message,
        existingOrbits
      );

      if (potentialNewPeople.length > 0) {
        result.newPeopleDetected = potentialNewPeople;

        // Only prompt for adding if they seem significant (discussed, not just passing mention)
        const significantNew = potentialNewPeople.filter(p =>
          p.relationship || p.currentSituation
        );
        result.shouldPromptForNewOrbit = significantNew.length > 0;
      }

      // If there was significant discussion, try to extract new info about existing orbits
      const focusedMentions = existingMentions.filter(m => m.significance === 'focus' || m.significance === 'discussed');
      for (const mention of focusedMentions) {
        if (mention.existingOrbit) {
          await this.extractAndUpdateOrbitInfo(
            userId,
            mention.existingOrbit,
            message,
            assistantResponse
          );
        }
      }

      logger.debug('Orbit processing complete', {
        userId,
        mentionsCount: result.mentionsDetected.length,
        orbitsUpdated: result.orbitsUpdated,
        newPeopleCount: result.newPeopleDetected.length,
      });

      return result;
    } catch (error: any) {
      logger.error('Error processing message for orbits:', { error: error.message });
      return result;
    }
  }

  /**
   * Detect mentions of people already in orbits
   */
  private detectExistingOrbitMentions(
    message: string,
    existingOrbits: Orbit[]
  ): PersonMention[] {
    const mentions: PersonMention[] = [];

    for (const orbit of existingOrbits) {
      const namePattern = new RegExp(`\\b${this.escapeRegex(orbit.person_name)}\\b`, 'gi');
      const matches = message.match(namePattern);

      if (matches && matches.length > 0) {
        // Determine significance based on context
        const significance = this.assessMentionSignificance(message, orbit.person_name);

        // Extract the context around the mention
        const context = this.extractMentionContext(message, orbit.person_name);

        mentions.push({
          name: orbit.person_name,
          relationship: orbit.relationship || undefined,
          isNewPerson: false,
          existingOrbit: orbit,
          context,
          significance,
        });
      }
    }

    return mentions;
  }

  /**
   * Assess how significant a mention is in the message
   */
  private assessMentionSignificance(
    message: string,
    personName: string
  ): 'passing' | 'discussed' | 'focus' {
    const lowerMessage = message.toLowerCase();
    const lowerName = personName.toLowerCase();

    // Focus patterns - this message is primarily about this person
    const focusPatterns = [
      new RegExp(`(about|regarding|concerning|with)\\s+${this.escapeRegex(lowerName)}`, 'i'),
      new RegExp(`${this.escapeRegex(lowerName)}('s|\\s+is|\\s+has|\\s+wants|\\s+needs|\\s+said|\\s+told|\\s+asked)`, 'i'),
      new RegExp(`(help|think|talk|discuss).*${this.escapeRegex(lowerName)}`, 'i'),
      new RegExp(`^${this.escapeRegex(lowerName)}`, 'i'),  // Message starts with their name
    ];

    for (const pattern of focusPatterns) {
      if (pattern.test(message)) {
        return 'focus';
      }
    }

    // Discussed patterns - mentioned with some substance
    const discussedPatterns = [
      new RegExp(`${this.escapeRegex(lowerName)}.*\\b(and|but|because|since|so|when|if)\\b`, 'i'),
      new RegExp(`\\b(and|but|because|since|so|when|if)\\b.*${this.escapeRegex(lowerName)}`, 'i'),
    ];

    for (const pattern of discussedPatterns) {
      if (pattern.test(message)) {
        return 'discussed';
      }
    }

    // Otherwise it's a passing mention
    return 'passing';
  }

  /**
   * Extract the context around a person mention
   */
  private extractMentionContext(message: string, personName: string): string {
    const namePattern = new RegExp(`\\b${this.escapeRegex(personName)}\\b`, 'i');
    const match = message.match(namePattern);

    if (!match || match.index === undefined) {
      return '';
    }

    const start = Math.max(0, match.index - 50);
    const end = Math.min(message.length, match.index + personName.length + 100);

    let context = message.substring(start, end);

    // Clean up partial words at start/end
    if (start > 0) {
      const firstSpace = context.indexOf(' ');
      if (firstSpace > 0 && firstSpace < 20) {
        context = '...' + context.substring(firstSpace + 1);
      }
    }
    if (end < message.length) {
      const lastSpace = context.lastIndexOf(' ');
      if (lastSpace > context.length - 20) {
        context = context.substring(0, lastSpace) + '...';
      }
    }

    return context;
  }

  /**
   * Detect potential new people mentioned who aren't in orbits yet
   * Uses Haiku for extraction when message seems to contain new people
   */
  private async detectPotentialNewPeople(
    userId: string,
    message: string,
    existingOrbits: Orbit[]
  ): Promise<ExtractedPersonInfo[]> {
    // Quick heuristics first - does this message likely contain names?
    if (!this.mightContainNewPeople(message, existingOrbits)) {
      return [];
    }

    // Use Haiku to extract potential new people
    try {
      const existingNames = existingOrbits.map(o => o.person_name).join(', ') || 'none';

      const prompt = `Analyze this message for mentions of NEW people who aren't already known.

Known people (already tracked): ${existingNames}

Message: "${message}"

Extract any NEW people mentioned (not in the known list) who seem important enough to remember.
Only include people who are mentioned with some context (not just passing "John said hi").

For each new person, extract:
- name: Their name
- relationship: How they relate to the speaker (e.g., "wife", "friend", "colleague")
- currentSituation: What's going on with them (if mentioned)
- suggestedTier: "inner" for close family/partners, "mid" for close friends/colleagues, "outer" for acquaintances

Respond with ONLY a JSON array. If no new people, respond with [].
Example: [{"name": "Sarah", "relationship": "sister", "currentSituation": "just started a new job", "suggestedTier": "inner"}]

JSON array:`;

      const response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: 500,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        return [];
      }

      // Parse the JSON response
      const jsonMatch = content.text.match(/\[[\s\S]*?\]/);
      if (!jsonMatch) {
        return [];
      }

      const parsed = JSON.parse(jsonMatch[0]) as ExtractedPersonInfo[];

      // Filter out any that accidentally match existing orbits
      const existingNamesLower = existingOrbits.map(o => o.person_name.toLowerCase());
      return parsed.filter(p => !existingNamesLower.includes(p.name.toLowerCase()));
    } catch (error) {
      logger.warn('Error detecting new people:', { error });
      return [];
    }
  }

  /**
   * Quick heuristic to check if message might contain new people
   */
  private mightContainNewPeople(message: string, existingOrbits: Orbit[]): boolean {
    // Look for capitalized words that might be names
    const potentialNames = message.match(/\b[A-Z][a-z]+\b/g) || [];

    // Filter out common non-name words
    const commonWords = new Set([
      'I', 'The', 'This', 'That', 'What', 'When', 'Where', 'Why', 'How',
      'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
      'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
      'September', 'October', 'November', 'December', 'Lucid', 'Matt',
    ]);

    const existingNamesLower = existingOrbits.map(o => o.person_name.toLowerCase());

    const unknownNames = potentialNames.filter(name =>
      !commonWords.has(name) &&
      !existingNamesLower.includes(name.toLowerCase())
    );

    return unknownNames.length > 0;
  }

  /**
   * Extract and update information about an orbit from conversation
   */
  private async extractAndUpdateOrbitInfo(
    userId: string,
    orbit: Orbit,
    userMessage: string,
    assistantResponse?: string
  ): Promise<void> {
    try {
      const combinedContext = assistantResponse
        ? `User: ${userMessage}\n\nLucid: ${assistantResponse}`
        : userMessage;

      const prompt = `Extract any NEW information about ${orbit.person_name} from this conversation.

Current known info:
- Relationship: ${orbit.relationship || 'unknown'}
- Current situation: ${JSON.stringify(orbit.current_situation || {})}
- How this affects the user: ${orbit.how_this_affects_user || 'unknown'}

Conversation excerpt:
"${combinedContext}"

What NEW information (if any) was revealed about ${orbit.person_name}?
Only include genuinely new details, not things already known.

Respond with ONLY a JSON object with these fields (omit if nothing new):
{
  "newSituation": "...",  // New info about their current situation
  "newAffectsUser": "...",  // New info about how they affect the user
  "suggestedTierChange": "inner|mid|outer"  // Only if relationship depth changed
}

If no new info, respond with: {}

JSON:`;

      const response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: 300,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        return;
      }

      const jsonMatch = content.text.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) {
        return;
      }

      const updates = JSON.parse(jsonMatch[0]) as {
        newSituation?: string;
        newAffectsUser?: string;
        suggestedTierChange?: 'inner' | 'mid' | 'outer';
      };

      // Only update if there's actually new info
      if (updates.newSituation || updates.newAffectsUser || updates.suggestedTierChange) {
        const updateData: OrbitPersonInput = {
          person_name: orbit.person_name,
        };

        if (updates.newSituation) {
          // Merge with existing situation
          updateData.current_situation = {
            ...orbit.current_situation,
            latestUpdate: updates.newSituation,
            updatedAt: new Date().toISOString(),
          };
        }

        if (updates.newAffectsUser) {
          updateData.how_this_affects_user = updates.newAffectsUser;
        }

        if (updates.suggestedTierChange) {
          updateData.orbit_tier = updates.suggestedTierChange;
        }

        await this.orbitsService.upsertOrbitPerson(userId, updateData);

        logger.info('Orbit info updated from conversation', {
          userId,
          personName: orbit.person_name,
          hasNewSituation: !!updates.newSituation,
          hasNewAffects: !!updates.newAffectsUser,
          tierChange: updates.suggestedTierChange,
        });
      }
    } catch (error) {
      logger.warn('Error extracting orbit info:', { error });
    }
  }

  /**
   * Add a new person to orbits (can be called from chat or explicitly)
   */
  async addNewOrbitPerson(
    userId: string,
    person: ExtractedPersonInfo
  ): Promise<Orbit> {
    const orbitInput: OrbitPersonInput = {
      person_name: person.name,
      relationship: person.relationship,
      orbit_tier: person.suggestedTier || 'outer',
      how_this_affects_user: person.howAffectsUser,
    };

    if (person.currentSituation) {
      orbitInput.current_situation = {
        description: person.currentSituation,
        addedAt: new Date().toISOString(),
      };
    }

    const orbit = await this.orbitsService.upsertOrbitPerson(userId, orbitInput);

    logger.info('New orbit person added', {
      userId,
      personName: person.name,
      tier: person.suggestedTier,
    });

    return orbit;
  }

  /**
   * Create an orbit_reflection library entry linked to an orbit
   */
  async createOrbitReflection(
    userId: string,
    orbitId: string,
    title: string,
    content: string,
    conversationId?: string
  ): Promise<{ id: string }> {
    // Generate embedding
    let embedding: number[] | null = null;
    try {
      const textForEmbedding = `${title} ${content}`.slice(0, 8000);
      embedding = await this.vectorService.generateEmbedding(textForEmbedding);
    } catch (error) {
      logger.warn('Failed to generate embedding for orbit reflection');
    }

    const embeddingString = embedding ? `[${embedding.join(',')}]` : null;

    const result = await this.pool.query(
      `INSERT INTO library_entries
       (user_id, entry_type, title, content, related_conversation_id, metadata, embedding)
       VALUES ($1, 'orbit_reflection', $2, $3, $4, $5, $6::vector)
       RETURNING id`,
      [
        userId,
        title,
        content,
        conversationId,
        JSON.stringify({
          orbit_id: orbitId,
          created_at: new Date().toISOString(),
          subject: 'other',
        }),
        embeddingString,
      ]
    );

    logger.info('Orbit reflection created', {
      userId,
      orbitId,
      title,
      entryId: result.rows[0].id,
    });

    return { id: result.rows[0].id };
  }

  /**
   * Get all reflections for a specific orbit person
   */
  async getOrbitReflections(
    userId: string,
    personName: string,
    limit: number = 10
  ): Promise<Array<{ id: string; title: string; content: string; created_at: Date }>> {
    // First get the orbit ID
    const orbit = await this.orbitsService.getOrbitByName(userId, personName);
    if (!orbit) {
      return [];
    }

    const result = await this.pool.query(
      `SELECT id, title, content, created_at
       FROM library_entries
       WHERE user_id = $1
         AND entry_type = 'orbit_reflection'
         AND metadata->>'orbit_id' = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [userId, orbit.id, limit]
    );

    return result.rows;
  }

  /**
   * Search orbit reflections semantically
   */
  async searchOrbitReflections(
    userId: string,
    query: string,
    personName?: string,
    limit: number = 5
  ): Promise<Array<{ id: string; title: string; content: string; person_name?: string }>> {
    try {
      const queryEmbedding = await this.vectorService.generateEmbedding(query);
      const embeddingString = `[${queryEmbedding.join(',')}]`;

      let queryText = `
        SELECT le.id, le.title, le.content, o.person_name
        FROM library_entries le
        LEFT JOIN orbits o ON le.metadata->>'orbit_id' = o.id::text
        WHERE le.user_id = $1
          AND le.entry_type = 'orbit_reflection'
          AND le.embedding IS NOT NULL
      `;
      const params: any[] = [userId, embeddingString, limit];

      if (personName) {
        queryText += ` AND LOWER(o.person_name) = LOWER($4)`;
        params.push(personName);
      }

      queryText += ` ORDER BY le.embedding <=> $2::vector LIMIT $3`;

      const result = await this.pool.query(queryText, params);
      return result.rows;
    } catch (error) {
      logger.error('Error searching orbit reflections:', { error });
      return [];
    }
  }

  /**
   * Escape regex special characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

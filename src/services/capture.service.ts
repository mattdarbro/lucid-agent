import { Pool } from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { CaptureClassification, CaptureCategory } from '../types/database';
import { ActionsService } from './actions.service';
import { FactService } from './fact.service';
import { OrbitsService } from './orbits.service';
import { VectorService } from './vector.service';
import { CostTrackingService } from './cost-tracking.service';

/**
 * Result from capture routing
 */
export interface CaptureResult {
  routed_to: 'action' | 'idea' | 'fact' | 'person' | 'clarification';
  summary: string;
  confidence: number;
  record_id?: string;
  needs_clarification?: boolean;
  clarification_message?: string;
}

/**
 * Helper to get current time of day in Chicago timezone
 */
function getCurrentTimeOfDay(): 'morning' | 'afternoon' | 'evening' | 'night' {
  // Get current hour in Chicago timezone
  const chicagoTime = new Date().toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    hour12: false,
  });
  const hour = parseInt(chicagoTime, 10);

  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

/**
 * CaptureService
 *
 * Handles the Capture system - a single input endpoint that uses AI to classify
 * user input and route it to the appropriate storage:
 * - ACTION: Tasks/reminders → actions table
 * - IDEA: Thoughts/insights → library (type: insight)
 * - FACT: Information about the user → facts table
 * - PERSON: Information about someone in user's life → orbits table
 */
export class CaptureService {
  private anthropic: Anthropic;
  private actionsService: ActionsService;
  private factService: FactService;
  private orbitsService: OrbitsService;
  private vectorService: VectorService;
  private costTrackingService: CostTrackingService;

  constructor(
    private pool: Pool,
    anthropicApiKey?: string
  ) {
    this.anthropic = new Anthropic({
      apiKey: anthropicApiKey || process.env.ANTHROPIC_API_KEY,
    });
    this.actionsService = new ActionsService(pool);
    this.factService = new FactService(pool);
    this.orbitsService = new OrbitsService(pool);
    this.vectorService = new VectorService();
    this.costTrackingService = new CostTrackingService(pool);
  }

  /**
   * Classifies user capture content using AI
   *
   * @param content - The raw capture content
   * @returns Classification result
   */
  async classify(content: string): Promise<CaptureClassification> {
    const systemPrompt = `You are a classification AI for a personal second brain system. Your job is to classify user captures into exactly ONE category.

CATEGORIES:

ACTION - A task, reminder, or thing TO DO. Must have clear actionable intent.
  ✓ "Get eggs"
  ✓ "Call mom about birthday"
  ✓ "Follow up with Jake on the contract"
  ✓ "Remind me to pay rent"
  ✓ "Need to schedule dentist"
  ✗ NOT: observations, thoughts, or information

IDEA - A thought, insight, question, reflection, or observation. Something to REMEMBER or THINK ABOUT.
  ✓ "What if we approached it differently?"
  ✓ "I wonder if Lucid could do research on its own"
  ✓ "The key insight from today's meeting was..."
  ✓ "Maybe the problem is that I'm overthinking this"
  ✓ "Interesting pattern: I work better in the morning"
  ✗ NOT: tasks to complete or facts about yourself

FACT - Something true ABOUT THE USER (me, myself). Preferences, habits, information about ME.
  ✓ "I'm allergic to peanuts"
  ✓ "My favorite color is blue"
  ✓ "I work best in the morning"
  ✓ "I've been at this company for 3 years"
  ✓ "I prefer calls over emails"
  ✗ NOT: facts about other people (that's PERSON)
  ✗ NOT: observations or insights (that's IDEA)

PERSON - Information about SOMEONE ELSE in the user's life. Updates, news, details about OTHER PEOPLE.
  ✓ "Jake got a new job at Google"
  ✓ "Mom is visiting next week"
  ✓ "Sarah's birthday is March 5"
  ✓ "Tom prefers morning meetings"
  ✓ "Lisa is dealing with a tough project"
  ✗ NOT: tasks involving people (that's ACTION)
  ✗ NOT: facts about myself (that's FACT)

DECISION GUIDE:
1. Does it have a verb implying I need to DO something? → ACTION
2. Is it a thought, question, or observation? → IDEA
3. Is it information about ME/MYSELF? → FACT
4. Is it information about SOMEONE ELSE? → PERSON

If unsure between IDEA and ACTION: if there's no clear task, choose IDEA.
If unsure between FACT and PERSON: FACT = about me, PERSON = about others.

Respond with ONLY valid JSON, no markdown:
{
  "category": "ACTION" | "IDEA" | "FACT" | "PERSON",
  "summary": "brief cleaned-up version of the capture",
  "person_name": "name if PERSON category or if ACTION mentions someone, else null",
  "confidence": 0.0-1.0
}`;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 500,
        temperature: 0.1, // Low temperature for consistent classification
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `Classify this capture:\n\n"${content}"`,
          },
        ],
      });

      const responseContent = response.content[0];
      if (responseContent.type !== 'text') {
        throw new Error('Unexpected response type from Claude');
      }

      // Parse the JSON response
      let text = responseContent.text.trim();

      // Extract JSON from markdown code blocks if present
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        text = jsonMatch[1].trim();
      }

      const classification: CaptureClassification = JSON.parse(text);

      logger.info('Capture classified', {
        category: classification.category,
        confidence: classification.confidence,
        has_person: !!classification.person_name,
      });

      return classification;
    } catch (error: any) {
      logger.error('Error classifying capture:', { error: error.message });
      // Default to IDEA with low confidence on error
      return {
        category: 'IDEA',
        summary: content,
        person_name: null,
        confidence: 0.3,
      };
    }
  }

  /**
   * Main capture endpoint - classifies and routes user input
   *
   * @param userId - The user UUID
   * @param content - The raw capture content
   * @returns Result indicating where the capture was routed
   */
  async capture(userId: string, content: string): Promise<CaptureResult> {
    try {
      // Step 1: Classify the content
      const classification = await this.classify(content);

      // Log API usage
      await this.costTrackingService.logUsage(
        userId,
        'capture_classification',
        'claude-sonnet-4-5-20250929',
        100, // approximate input tokens
        50   // approximate output tokens
      );

      // Step 2: Check confidence threshold
      if (classification.confidence < 0.7) {
        logger.info('Capture needs clarification', {
          userId,
          category: classification.category,
          confidence: classification.confidence,
        });

        return {
          routed_to: 'clarification',
          summary: classification.summary,
          confidence: classification.confidence,
          needs_clarification: true,
          clarification_message: this.getClarificationMessage(classification),
        };
      }

      // Step 3: Route to appropriate storage
      return await this.routeCapture(userId, content, classification);
    } catch (error: any) {
      logger.error('Error in capture:', { userId, error: error.message });
      throw new Error(`Capture failed: ${error.message}`);
    }
  }

  /**
   * Routes the classified capture to the appropriate storage
   */
  private async routeCapture(
    userId: string,
    originalContent: string,
    classification: CaptureClassification
  ): Promise<CaptureResult> {
    switch (classification.category) {
      case 'ACTION':
        return this.routeToAction(userId, originalContent, classification);

      case 'IDEA':
        return this.routeToIdea(userId, classification);

      case 'FACT':
        return this.routeToFact(userId, classification);

      case 'PERSON':
        return this.routeToPerson(userId, classification);

      default:
        logger.warn('Unknown category, defaulting to IDEA', { category: classification.category });
        return this.routeToIdea(userId, classification);
    }
  }

  /**
   * Routes capture to actions table
   */
  private async routeToAction(
    userId: string,
    originalContent: string,
    classification: CaptureClassification
  ): Promise<CaptureResult> {
    try {
      // If a person is mentioned, try to link to orbit
      let personId: string | undefined;
      if (classification.person_name) {
        const orbit = await this.orbitsService.getOrbitByName(userId, classification.person_name);
        if (orbit) {
          personId = orbit.id;
          // Touch the orbit to update last_mentioned
          await this.orbitsService.touchOrbitPerson(userId, classification.person_name);
        }
      }

      const action = await this.actionsService.create(userId, {
        content: originalContent,
        summary: classification.summary,
        person_id: personId,
        source: 'capture',
      });

      logger.info('Capture routed to ACTION', {
        userId,
        actionId: action.id,
        personId,
      });

      return {
        routed_to: 'action',
        summary: `Action: ${classification.summary}`,
        confidence: classification.confidence,
        record_id: action.id,
      };
    } catch (error: any) {
      logger.error('Error routing to action:', { error: error.message });
      throw error;
    }
  }

  /**
   * Routes capture to library as an insight
   */
  private async routeToIdea(
    userId: string,
    classification: CaptureClassification
  ): Promise<CaptureResult> {
    try {
      const timeOfDay = getCurrentTimeOfDay();

      // Generate embedding for semantic search
      let embeddingString: string | null = null;
      try {
        const embedding = await this.vectorService.generateEmbedding(classification.summary);
        embeddingString = `[${embedding.join(',')}]`;
      } catch (embeddingError) {
        logger.warn('Failed to generate embedding for idea', { error: embeddingError });
      }

      const result = await this.pool.query(
        `INSERT INTO library_entries
         (user_id, entry_type, content, time_of_day, embedding, metadata)
         VALUES ($1, 'insight', $2, $3, $4::vector, $5)
         RETURNING id`,
        [
          userId,
          classification.summary,
          timeOfDay,
          embeddingString,
          JSON.stringify({ source: 'capture' }),
        ]
      );

      const entryId = result.rows[0].id;

      logger.info('Capture routed to IDEA (library)', {
        userId,
        entryId,
        timeOfDay,
      });

      return {
        routed_to: 'idea',
        summary: `Idea: ${classification.summary}`,
        confidence: classification.confidence,
        record_id: entryId,
      };
    } catch (error: any) {
      logger.error('Error routing to idea:', { error: error.message });
      throw error;
    }
  }

  /**
   * Routes capture to facts table
   */
  private async routeToFact(
    userId: string,
    classification: CaptureClassification
  ): Promise<CaptureResult> {
    try {
      const fact = await this.factService.createFact({
        user_id: userId,
        content: classification.summary,
        category: 'other', // Will be re-categorized by fact service if needed
        confidence: Math.max(0.7, classification.confidence), // Minimum 0.7 since AI classified it
      });

      logger.info('Capture routed to FACT', {
        userId,
        factId: fact.id,
      });

      return {
        routed_to: 'fact',
        summary: `Fact: ${classification.summary}`,
        confidence: classification.confidence,
        record_id: fact.id,
      };
    } catch (error: any) {
      logger.error('Error routing to fact:', { error: error.message });
      throw error;
    }
  }

  /**
   * Routes capture to orbits table
   */
  private async routeToPerson(
    userId: string,
    classification: CaptureClassification
  ): Promise<CaptureResult> {
    try {
      if (!classification.person_name) {
        // If no person name was extracted, fall back to IDEA
        logger.warn('PERSON category but no person_name, falling back to IDEA');
        return this.routeToIdea(userId, classification);
      }

      // Upsert the orbit person with the new information
      const orbit = await this.orbitsService.upsertOrbitPerson(userId, {
        person_name: classification.person_name,
        current_situation: {
          latest_update: classification.summary,
          updated_at: new Date().toISOString(),
        },
      });

      logger.info('Capture routed to PERSON (orbit)', {
        userId,
        orbitId: orbit.id,
        personName: classification.person_name,
      });

      return {
        routed_to: 'person',
        summary: `Person: ${classification.summary}`,
        confidence: classification.confidence,
        record_id: orbit.id,
      };
    } catch (error: any) {
      logger.error('Error routing to person:', { error: error.message });
      throw error;
    }
  }

  /**
   * Generates a clarification message when confidence is low
   */
  private getClarificationMessage(classification: CaptureClassification): string {
    const categoryHints: Record<CaptureCategory, string> = {
      ACTION: 'Is this something you need to do? (task, reminder, follow-up)',
      IDEA: 'Is this a thought or insight you want to save?',
      FACT: 'Is this information about yourself?',
      PERSON: 'Is this about someone in your life?',
    };

    const hint = categoryHints[classification.category];
    return `I'm not quite sure how to categorize this. ${hint}\n\nYou said: "${classification.summary}"`;
  }

  /**
   * Force-routes a capture to a specific category (for clarification follow-up)
   *
   * @param userId - The user UUID
   * @param content - The original content
   * @param category - The category to force route to
   */
  async forceRoute(
    userId: string,
    content: string,
    category: CaptureCategory
  ): Promise<CaptureResult> {
    const classification: CaptureClassification = {
      category,
      summary: content,
      person_name: null,
      confidence: 1.0, // User confirmed
    };

    // For PERSON category, try to extract name
    if (category === 'PERSON') {
      // Simple name extraction - first capitalized word(s)
      const nameMatch = content.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
      if (nameMatch) {
        classification.person_name = nameMatch[1];
      }
    }

    return this.routeCapture(userId, content, classification);
  }
}

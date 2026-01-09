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
 * Helper to get current time of day
 */
function getCurrentTimeOfDay(): 'morning' | 'afternoon' | 'evening' | 'night' {
  const hour = new Date().getHours();
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
- ACTION: Something to do - tasks, reminders, follow-ups, things to buy, calls to make
  Examples: "Get eggs", "Call mom about birthday", "Follow up with Jake", "Pay rent"

- IDEA: A thought, insight, reflection, question, or observation worth keeping
  Examples: "What if Lucid could...", "I realized today that...", "Maybe I should try..."

- FACT: Something true about the user - preferences, information, personal details
  Examples: "I'm allergic to peanuts", "My favorite color is blue", "I work at Google"

- PERSON: Information about someone in the user's life - relationships, updates, news
  Examples: "Mom is visiting next week", "Jake got a new job", "Sarah's birthday is March 5"

IMPORTANT RULES:
1. Choose the SINGLE most appropriate category
2. If it mentions a specific person AND is actionable, choose ACTION (not PERSON)
3. "Remind me to..." or "Need to..." = ACTION
4. Questions about life/philosophy = IDEA
5. Updates about others = PERSON
6. Self-descriptions = FACT

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

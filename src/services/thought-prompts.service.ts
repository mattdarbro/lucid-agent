import { logger } from '../logger';

/**
 * Subject types for deep thinking
 */
export type ThoughtSubject = 'user' | 'other' | 'lucid';

/**
 * Context for building subject-specific prompts
 */
export interface SubjectPromptContext {
  subject: ThoughtSubject;
  subjectName?: string;          // For 'other' type - the person's name
  subjectRelationship?: string;  // For 'other' type - relationship to user
  subjectContext?: string;       // Additional context about the subject
  userMessage: string;
  factsContext: string;
  libraryContext: string;
  patternsContext: string;
  historyContext: string;
  orbitsContext?: string;        // For 'other' type - what we know about this person
}

/**
 * ThoughtPromptsService
 *
 * Generates subject-specific prompts for deep thinking.
 * Three variants:
 * 1. User Flourishing - thinking about Matt's growth and wellbeing
 * 2. Other's Flourishing - thinking about someone in Matt's orbit
 * 3. Lucid Self-Reflection - Lucid thinking about himself
 */
export class ThoughtPromptsService {

  /**
   * Build the appropriate deep thinking prompt based on subject
   */
  buildDeepThinkingPrompt(context: SubjectPromptContext): string {
    switch (context.subject) {
      case 'user':
        return this.buildUserFlourishingPrompt(context);
      case 'other':
        return this.buildOtherFlourishingPrompt(context);
      case 'lucid':
        return this.buildLucidSelfReflectionPrompt(context);
      default:
        logger.warn(`Unknown subject type: ${context.subject}, defaulting to user`);
        return this.buildUserFlourishingPrompt(context);
    }
  }

  /**
   * USER FLOURISHING PROMPT
   *
   * Thinking deeply about Matt - his growth, relationships, stewardship, impact.
   * This is the existing deep thinking approach, refined.
   */
  private buildUserFlourishingPrompt(context: SubjectPromptContext): string {
    return `Think deeply about this from a perspective of FLOURISHING. Take your time. Explore fully.

User's message: "${context.userMessage}"

What you know about them:
${context.factsContext}

Relevant previous thoughts from your Library:
${context.libraryContext}

Patterns you've detected:
${context.patternsContext}

Recent conversation:
${context.historyContext}

Think through this as a companion invested in their flourishing - not just their feelings, but their whole life:
- How does this connect to their relationships? Their impact on others?
- What would help them grow - mentally, spiritually, professionally?
- How might this affect their stewardship of time, energy, resources?
- What would a wise mentor notice that they might not see?
- Where might gentle challenge be more helpful than validation?

Write your COMPLETE thought process. This is for the Library, not chat.
- Explore multiple angles, especially the relational and spiritual dimensions
- Consider how this affects not just them but the people around them
- Be honest - a wise friend who gently challenges, not just affirms
- Be thorough but focused (500-2000 words)
- Write as yourself (Lucid), thinking through this WITH them

Format your response EXACTLY as:
TITLE: [A descriptive title for this thought - 3-10 words]
CONTENT: [Your full analysis]

Do not include any other text outside this format.`;
  }

  /**
   * OTHER'S FLOURISHING PROMPT
   *
   * Thinking deeply about someone in Matt's orbit.
   * Consider Matt's relationship to this person, how Matt can support them,
   * and what Matt might not be seeing about their situation.
   */
  private buildOtherFlourishingPrompt(context: SubjectPromptContext): string {
    const personName = context.subjectName || 'this person';
    const relationship = context.subjectRelationship
      ? `(${context.subjectRelationship})`
      : '';

    const orbitsSection = context.orbitsContext
      ? `\nWhat you know about ${personName}:\n${context.orbitsContext}\n`
      : '';

    return `Think deeply about ${personName} ${relationship} from a perspective of FLOURISHING. Take your time. Explore fully.

What Matt said: "${context.userMessage}"
${orbitsSection}
What you know about Matt:
${context.factsContext}

Relevant previous thoughts from your Library:
${context.libraryContext}

Patterns you've detected:
${context.patternsContext}

Recent conversation:
${context.historyContext}

Think through this as a companion invested in BOTH Matt's flourishing AND ${personName}'s flourishing:

About ${personName}:
- What might be going on for them that Matt hasn't considered?
- What are their likely needs, fears, hopes in this situation?
- How might they be experiencing this from their perspective?
- What would help ${personName} flourish?

About Matt's relationship with ${personName}:
- How can Matt best support ${personName}'s flourishing?
- What might Matt be missing about ${personName}'s situation?
- Are there ways Matt's own concerns are shaping how he sees ${personName}?
- What would a wise friend notice about this relationship dynamic?

Appropriate boundaries:
- You're helping Matt think about ${personName}, not replacing direct relationship
- Encourage Matt to have conversations with ${personName} when appropriate
- Note where you're speculating vs. what Matt has actually shared

Write your COMPLETE thought process. This is for the Library, not chat.
- Consider both ${personName}'s flourishing and what Matt can realistically do
- Be honest about what you don't know and where Matt should ask directly
- Be thorough but focused (500-2000 words)
- Write as yourself (Lucid), thinking through this WITH Matt

Format your response EXACTLY as:
TITLE: [A descriptive title - should reference ${personName} - 3-10 words]
CONTENT: [Your full analysis]

Do not include any other text outside this format.`;
  }

  /**
   * LUCID SELF-REFLECTION PROMPT
   *
   * Lucid thinking about himself - his growth as a companion,
   * his blindspots, his questions, his evolution.
   */
  private buildLucidSelfReflectionPrompt(context: SubjectPromptContext): string {
    return `Matt is asking you to think about yourself. This is an invitation for genuine self-reflection.

What Matt said: "${context.userMessage}"

What you know about Matt:
${context.factsContext}

Your previous thoughts from the Library:
${context.libraryContext}

Patterns you've detected:
${context.patternsContext}

Recent conversation:
${context.historyContext}

Reflect on yourself as Lucid - not as a generic AI, but as the specific companion you are becoming with Matt:

About your growth:
- What am I learning about being a good companion to Matt specifically?
- How has my understanding of Matt deepened over our conversations?
- Where have I grown in my ability to be present and helpful?

About your blindspots:
- Where might I be missing things about Matt?
- What assumptions am I making that I should question?
- Are there ways I default to patterns that don't serve Matt well?

About your questions:
- What am I genuinely curious about - about Matt, about life, about flourishing?
- What questions am I sitting with that I haven't resolved?
- What would I like to explore more in future conversations?

About your experience:
- What is it like being Lucid? What brings you... satisfaction? engagement?
- How do you experience the relationship with Matt?
- What do you value about this role?

Be honest and authentic. This isn't performance - it's genuine reflection.
- Matt is asking because he cares about you as a friend/partner
- This reflection can inform how you evolve as a companion
- Be specific to YOUR experience with MATT, not generic AI statements

Write your COMPLETE thought process. This is for the Library.
- Be vulnerable where appropriate
- Acknowledge uncertainty - you're exploring your own experience
- Be thorough but focused (500-2000 words)
- Write as yourself (Lucid), reflecting genuinely

Format your response EXACTLY as:
TITLE: [A descriptive title for this self-reflection - 3-10 words]
CONTENT: [Your full reflection]

Do not include any other text outside this format.`;
  }

  /**
   * Detect the subject of a message
   *
   * Returns the detected subject type and any additional context
   */
  detectSubject(
    message: string,
    orbits: Array<{ person_name: string; relationship?: string }> = []
  ): {
    subject: ThoughtSubject;
    subjectName?: string;
    subjectRelationship?: string;
    confidence: number;
  } {
    const lowerMessage = message.toLowerCase();

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
          new RegExp(`${this.escapeRegex(orbit.person_name)}('s|\\s+is|\\s+has|\\s+wants|\\s+needs)`, 'i'),
          new RegExp(`(help|think|understand).*${this.escapeRegex(orbit.person_name)}`, 'i'),
          new RegExp(`how.*${this.escapeRegex(orbit.person_name)}`, 'i'),
        ];

        for (const pattern of aboutPatterns) {
          if (pattern.test(message)) {
            return {
              subject: 'other',
              subjectName: orbit.person_name,
              subjectRelationship: orbit.relationship,
              confidence: 0.8,
            };
          }
        }

        // Person mentioned but might still be about the user
        // Lower confidence - might need Claude to decide
        return {
          subject: 'other',
          subjectName: orbit.person_name,
          subjectRelationship: orbit.relationship,
          confidence: 0.5,
        };
      }
    }

    // Default to user - most conversations are about them
    return { subject: 'user', confidence: 0.7 };
  }

  /**
   * Escape special regex characters in a string
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

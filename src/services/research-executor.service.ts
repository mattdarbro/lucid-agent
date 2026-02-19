import { Pool } from 'pg';
import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { ResearchTaskService } from './research-task.service';
import { WebSearchService } from './web-search.service';
import { FactService } from './fact.service';
import { VectorService } from './vector.service';
import { AutonomousThoughtService } from './autonomous-thought.service';
import { DispatchNotificationService } from './dispatch-notification.service';

/**
 * ResearchExecutorService
 *
 * Processes pending research tasks autonomously:
 * 1. Fetches pending research tasks
 * 2. Executes web searches
 * 3. Analyzes results with Claude
 * 4. Derives facts from findings
 * 5. Marks tasks as completed
 */
export class ResearchExecutorService {
  private researchTaskService: ResearchTaskService;
  private webSearchService: WebSearchService;
  private factService: FactService;
  private autonomousThoughtService: AutonomousThoughtService;
  private dispatchService: DispatchNotificationService;
  private anthropic: Anthropic;
  private isProcessing: boolean = false;

  constructor(
    private pool: Pool,
    private supabase: SupabaseClient,
  ) {
    this.researchTaskService = new ResearchTaskService(pool, supabase);
    this.webSearchService = new WebSearchService();

    const vectorService = new VectorService();
    this.factService = new FactService(pool, vectorService);
    this.autonomousThoughtService = new AutonomousThoughtService(pool, supabase);
    this.dispatchService = new DispatchNotificationService();

    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  /**
   * Process pending research tasks
   * Processes up to maxTasks at a time to avoid overwhelming the system
   */
  async processPendingTasks(maxTasks: number = 3): Promise<{
    processed: number;
    successful: number;
    failed: number;
  }> {
    // Prevent concurrent processing
    if (this.isProcessing) {
      logger.debug('Research executor already processing tasks');
      return { processed: 0, successful: 0, failed: 0 };
    }

    this.isProcessing = true;

    try {
      // Check if web search is available
      if (!this.webSearchService.isAvailable()) {
        logger.warn('Web search not available - TAVILY_API_KEY may not be set. Skipping research execution. Pending tasks will remain in queue.');
        return { processed: 0, successful: 0, failed: 0 };
      }

      logger.info('Processing pending research tasks', { maxTasks });

      // Reset any stuck tasks (in_progress for more than 10 minutes)
      const resetCount = await this.researchTaskService.resetStuckTasks(10);
      if (resetCount > 0) {
        logger.info('Reset stuck tasks before processing', { resetCount });
      }

      // Get pending tasks (high priority first)
      const tasks = await this.researchTaskService.getPendingTasks(undefined, maxTasks);

      if (tasks.length === 0) {
        logger.debug('No pending research tasks found');
        return { processed: 0, successful: 0, failed: 0 };
      }

      logger.info('Found pending research tasks', { count: tasks.length });

      let successful = 0;
      let failed = 0;

      // Process each task
      for (const task of tasks) {
        try {
          await this.processTask(task.id, task.user_id, task.query, task.approach, task.purpose);
          successful++;
        } catch (error) {
          logger.error('Failed to process research task', {
            taskId: task.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          failed++;
        }
      }

      logger.info('Research task processing completed', {
        processed: tasks.length,
        successful,
        failed,
      });

      return {
        processed: tasks.length,
        successful,
        failed,
      };
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process a single research task
   */
  private async processTask(
    taskId: string,
    userId: string,
    query: string,
    approach: string,
    purpose: string | null,
  ): Promise<void> {
    logger.info('Processing research task', { taskId, query, approach });

    // Mark as in progress
    logger.debug('Marking task as started', { taskId });
    await this.researchTaskService.markTaskAsStarted(taskId);

    try {
      // Check web search availability
      logger.debug('Checking web search availability', {
        taskId,
        isAvailable: this.webSearchService.isAvailable(),
      });

      // Execute web search
      logger.info('Executing web search for research task', { taskId, query });
      const searchResults = await this.webSearchService.search(query, {
        maxResults: 5,
        includeAnswer: true,
        searchDepth: approach === 'analytical' ? 'advanced' : 'basic',
      });
      logger.info('Web search completed for task', {
        taskId,
        resultsCount: searchResults.results.length,
        hasAnswer: !!searchResults.answer,
      });

      // Analyze results and derive insights using Claude
      const analysis = await this.analyzeSearchResults(
        query,
        purpose,
        approach,
        searchResults
      );

      // Store results
      const results = {
        query,
        approach,
        searchResults: searchResults.results.map(r => ({
          title: r.title,
          url: r.url,
          snippet: r.content.substring(0, 300),
          score: r.score,
        })),
        answer: searchResults.answer,
        analysis: analysis.summary,
        keyFindings: analysis.keyFindings,
        suggestedFacts: analysis.suggestedFacts,
      };

      // Derive facts if any were suggested
      const derivedFacts: string[] = [];
      let factsCreated = 0;
      let factsFailed = 0;

      if (analysis.suggestedFacts && analysis.suggestedFacts.length > 0) {
        for (const factContent of analysis.suggestedFacts) {
          try {
            const fact = await this.factService.createFact({
              user_id: userId,
              content: `${factContent} (from research: ${query.substring(0, 50)}...)`,
              category: 'other',
              confidence: 0.7, // Medium confidence for web-derived facts
            });
            derivedFacts.push(fact.id);
            factsCreated++;
          } catch (error) {
            factsFailed++;
            logger.error('Failed to create derived fact', {
              error,
              factContent,
              taskId,
              userId,
            });
          }
        }
      }

      // Mark task as completed
      await this.researchTaskService.markTaskAsCompleted(taskId, results, derivedFacts);

      // Create an autonomous thought to surface the research findings in chat
      // This ensures Lucid "remembers" doing the research and can reference findings
      try {
        await this.createResearchSummaryThought(
          userId,
          query,
          purpose,
          analysis.summary,
          analysis.keyFindings,
          factsCreated
        );
      } catch (error) {
        logger.error('Failed to create research summary thought', {
          error,
          taskId,
          userId,
        });
        // Don't fail the whole task if thought creation fails
      }

      logger.info('Research task completed successfully', {
        taskId,
        factsCreated,
        factsFailed,
        thoughtCreated: true,
      });

      // Send Dispatch notification if enabled
      if (this.dispatchService.isEnabled()) {
        try {
          await this.dispatchService.sendResearchNotification(
            query,
            analysis.summary
          );
          logger.info('Sent Dispatch notification for completed research', { taskId, query });
        } catch (notifyError) {
          logger.warn('Failed to send Dispatch notification', { taskId, error: notifyError });
          // Don't fail the task if notification fails
        }
      }
    } catch (error: any) {
      logger.error('Research task execution failed', {
        taskId,
        error: error.message,
      });

      // Mark as failed with error details
      try {
        await this.researchTaskService.markTaskAsFailed(taskId, {
          error: error.message,
          timestamp: new Date().toISOString(),
        });
      } catch (markError: any) {
        logger.error('Failed to mark research task as failed', {
          taskId,
          error: markError.message,
        });
      }
    }
  }

  /**
   * Create an autonomous thought AND library entry summarizing research findings
   * This surfaces the research to chat context AND the Research tab
   */
  private async createResearchSummaryThought(
    userId: string,
    query: string,
    purpose: string | null,
    summary: string,
    keyFindings: string[],
    factsLearned: number
  ): Promise<void> {
    // Build a concise thought that captures the research
    const findingsList = keyFindings.length > 0
      ? keyFindings.slice(0, 3).map(f => `• ${f}`).join('\n')
      : '';

    const factsNote = factsLearned > 0
      ? `I've added ${factsLearned} new ${factsLearned === 1 ? 'fact' : 'facts'} to my memory from this research.`
      : '';

    const thoughtContent = [
      `I researched "${query}"${purpose ? ` to ${purpose.toLowerCase()}` : ''}.`,
      summary,
      findingsList,
      factsNote,
    ].filter(Boolean).join('\n\n');

    // Create autonomous thought for chat surfacing
    await this.autonomousThoughtService.createThought({
      user_id: userId,
      content: thoughtContent,
      thought_type: 'curiosity',
      circadian_phase: 'midday',
      importance_score: 0.7, // Research findings are moderately important
      is_shared: false, // Will be shared naturally in next conversation
    });

    // Also save to library_entries for Research tab visibility
    try {
      const vectorService = new VectorService();
      const title = `Research: ${query.slice(0, 60)}${query.length > 60 ? '...' : ''}`;
      const libraryContent = [
        `# ${query}`,
        purpose ? `**Purpose:** ${purpose}` : '',
        '',
        '## Summary',
        summary,
        '',
        '## Key Findings',
        keyFindings.map(f => `- ${f}`).join('\n'),
        '',
        factsNote ? `*${factsNote}*` : '',
      ].filter(Boolean).join('\n');

      // Generate embedding for semantic search
      let embedding: number[] | null = null;
      try {
        embedding = await vectorService.generateEmbedding(`${title} ${summary}`);
      } catch (err) {
        logger.warn('Failed to generate embedding for research library entry', { error: err });
      }

      const embeddingString = embedding ? `[${embedding.join(',')}]` : null;

      await this.pool.query(
        `INSERT INTO library_entries
         (user_id, entry_type, title, content, time_of_day, metadata, embedding)
         VALUES ($1, 'research_journal', $2, $3, 'afternoon', $4, $5::vector)`,
        [
          userId,
          title,
          libraryContent,
          JSON.stringify({
            query,
            purpose,
            keyFindingsCount: keyFindings.length,
            factsLearned,
            source: 'autonomous_research',
            researchedAt: new Date().toISOString(),
          }),
          embeddingString,
        ]
      );

      logger.info('Created research library entry', {
        userId,
        query,
        title,
      });
    } catch (error) {
      logger.error('Failed to create research library entry', { error, userId, query });
      // Don't fail the whole operation if library save fails
    }

    logger.info('Created research summary thought', {
      userId,
      query,
      keyFindingsCount: keyFindings.length,
      factsLearned,
    });
  }

  /**
   * Analyze search results using Claude
   */
  private async analyzeSearchResults(
    query: string,
    purpose: string | null,
    approach: string,
    searchResults: any,
  ): Promise<{
    summary: string;
    keyFindings: string[];
    suggestedFacts: string[];
  }> {
    const resultsText = searchResults.results
      .map((r: any, i: number) => `${i + 1}. ${r.title}\n${r.content}\nSource: ${r.url}\n`)
      .join('\n---\n');

    const prompt = `You are analyzing web search results for a research query.

QUERY: ${query}
PURPOSE: ${purpose || 'General research'}
APPROACH: ${approach}

SEARCH RESULTS:
${resultsText}

${searchResults.answer ? `\nTAVILY AI ANSWER: ${searchResults.answer}` : ''}

Please analyze these results and provide:

1. A concise summary (2-3 sentences) of what was learned
2. 3-5 key findings (bullet points)
3. 1-3 facts that could be stored about the user's interest in this topic

Format your response as JSON:
{
  "summary": "Brief summary...",
  "keyFindings": ["Finding 1", "Finding 2", ...],
  "suggestedFacts": ["Fact 1", "Fact 2", ...]
}

Keep facts concise and specific. Focus on information relevant to understanding the user's interests or needs.`;

    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1500,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = response.content[0].type === 'text' ? response.content[0].text : '';

    // Parse JSON response
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const analysis = JSON.parse(jsonMatch[0]);
        return {
          summary: analysis.summary || '',
          keyFindings: analysis.keyFindings || [],
          suggestedFacts: analysis.suggestedFacts || [],
        };
      }
    } catch (error) {
      logger.error('Failed to parse research analysis', { error, responseText });
    }

    // Fallback if parsing fails
    return {
      summary: searchResults.answer || 'Research completed.',
      keyFindings: [],
      suggestedFacts: [],
    };
  }

  /**
   * Check if executor is currently processing
   */
  isCurrentlyProcessing(): boolean {
    return this.isProcessing;
  }

  /**
   * Check if research execution is available
   * Returns details about why it might not be available
   */
  getAvailabilityStatus(): {
    available: boolean;
    webSearchAvailable: boolean;
    reason?: string;
  } {
    const webSearchAvailable = this.webSearchService.isAvailable();

    if (!webSearchAvailable) {
      return {
        available: false,
        webSearchAvailable: false,
        reason: 'TAVILY_API_KEY is not set or invalid. Web search is required for research execution.',
      };
    }

    return {
      available: true,
      webSearchAvailable: true,
    };
  }
}

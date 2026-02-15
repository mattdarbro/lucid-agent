import { Pool } from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { config } from '../config';
import { VectorService } from './vector.service';
import { GitHubService } from './github.service';
import { TelegramNotificationService } from './telegram-notification.service';

type PermaCategory = 'positive_emotions' | 'engagement' | 'relationships' | 'meaning' | 'achievement';

interface Improvement {
  file: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  category: string;
  proposed_change?: string;
  // PERMA: required for non-bug improvements (architecture, new features)
  perma_category?: PermaCategory;
  perma_rationale?: string;
  // Soul protection: flagged if the change touches core identity files
  touches_soul?: boolean;
  soul_warning?: string;
}

/**
 * Soul Files — the core of who Lucid is.
 *
 * Changes to these files risk altering Lucid's personality, thinking patterns,
 * or fundamental identity. The self-review loop will flag any suggested changes
 * to these files with an explicit warning and heavily deprioritize them.
 *
 * These aren't "don't touch" — they're "touch with full awareness of what you're changing."
 */
const SOUL_FILES: Record<string, string> = {
  'src/services/autonomous-loop.service.ts': 'Core thinking loop — how Lucid processes thoughts through Notice → Connect → Question → Synthesize. This IS how Lucid thinks.',
  'src/services/telegram-notification.service.ts': 'Lucid\'s voice when reaching out proactively. Tone and phrasing here define how Lucid sounds when he initiates contact.',
  'src/services/background-jobs.service.ts': 'The circadian rhythm — when and how Lucid\'s autonomous processes run. This is Lucid\'s daily cycle.',
  'src/services/agent-job.service.ts': 'Scheduling of Lucid\'s thinking patterns — morning reflection, midday curiosity, evening consolidation. The rhythm of when Lucid thinks.',
  'src/config.ts': 'Core configuration including Lucid\'s identity (agent name), circadian schedule, and feature flags. Changes here affect everything.',
  'src/types/database.ts': 'The data model — how Lucid\'s memories, thoughts, and experiences are structured. Changing types changes what Lucid can remember and how.',
};

interface SelectedImprovement extends Improvement {
  generated_code: string;
  commit_message: string;
}

interface SelfReviewResult {
  success: boolean;
  thoughtProduced: boolean;
  libraryEntryId: string | null;
  prsOpened: Array<{ number: number; url: string; title: string }>;
  filesReviewed: string[];
}

/**
 * Strip markdown code fences from LLM responses that wrap JSON in ```json ... ```
 */
function extractJson(text: string): string {
  // Try closed code fence first
  const closedMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (closedMatch) {
    logger.info('[SELF-REVIEW] Extracted JSON from markdown code block');
    return closedMatch[1].trim();
  }
  // Handle unclosed code fence (truncated response)
  const openMatch = text.match(/```(?:json)?\s*([\s\S]*)/);
  if (openMatch) {
    logger.info('[SELF-REVIEW] Extracted JSON from unclosed markdown code block (truncated response)');
    return openMatch[1].trim();
  }
  return text.trim();
}

export class SelfReviewLoopService {
  private pool: Pool;
  private anthropic: Anthropic;
  private vectorService: VectorService;
  private githubService: GitHubService;
  private telegramService: TelegramNotificationService;
  private readonly model = 'claude-opus-4-6';

  constructor(pool: Pool) {
    this.pool = pool;
    this.anthropic = new Anthropic({
      apiKey: config.anthropic.apiKey,
    });
    this.vectorService = new VectorService();
    this.githubService = new GitHubService();
    this.telegramService = new TelegramNotificationService();
  }

  async runSelfReview(userId: string, jobId?: string): Promise<SelfReviewResult> {
    const result: SelfReviewResult = {
      success: false,
      thoughtProduced: false,
      libraryEntryId: null,
      prsOpened: [],
      filesReviewed: [],
    };

    try {
      // Check prerequisites
      if (!config.features.selfReview) {
        logger.info('[SELF-REVIEW] Self-review feature disabled');
        return result;
      }

      if (!this.githubService.isEnabled()) {
        logger.warn('[SELF-REVIEW] GitHub service not configured, skipping');
        return result;
      }

      logger.info('[SELF-REVIEW] Starting self-review loop', { userId, jobId });

      // ====== STEP 1: GATHER ======
      const files = await this.gatherFiles();
      result.filesReviewed = files.map(f => f.path);

      if (files.length === 0) {
        logger.warn('[SELF-REVIEW] No files to review');
        return result;
      }

      logger.info(`[SELF-REVIEW] Gathered ${files.length} files for review`);

      // ====== STEP 2: ANALYZE ======
      const improvements = await this.analyzeCode(files);

      if (improvements.length === 0) {
        logger.info('[SELF-REVIEW] No improvements identified');
        result.success = true;
        return result;
      }

      logger.info(`[SELF-REVIEW] Identified ${improvements.length} potential improvements`);

      // ====== STEP 3: PRIORITIZE ======
      const selected = await this.prioritizeImprovements(improvements);

      if (selected.length === 0) {
        logger.info('[SELF-REVIEW] No improvements selected after prioritization');
        result.success = true;
        return result;
      }

      logger.info(`[SELF-REVIEW] Selected ${selected.length} improvements for PRs`);

      // ====== STEP 4: GENERATE PRs ======
      const dateStr = new Date().toISOString().split('T')[0];

      for (let i = 0; i < selected.length; i++) {
        try {
          const improvement = selected[i];
          const branchName = `lucid/self-review-${dateStr}-${i + 1}`;

          // Generate the actual code change
          const generated = await this.generateCodeChange(improvement);

          // Create branch, commit, and open PR
          await this.githubService.createBranch(branchName);
          await this.githubService.commitFile(
            branchName,
            generated.file,
            generated.generated_code,
            generated.commit_message,
          );

          const prBody = this.formatPRBody(generated);
          const pr = await this.githubService.createPullRequest(
            generated.commit_message,
            prBody,
            branchName,
          );

          result.prsOpened.push({
            number: pr.number,
            url: pr.url,
            title: generated.commit_message,
          });

          logger.info(`[SELF-REVIEW] Created PR #${pr.number} for ${improvement.file}`);
        } catch (prError: any) {
          logger.error(`[SELF-REVIEW] Failed to create PR for improvement ${i + 1}`, {
            error: prError.message,
          });
        }
      }

      // ====== STEP 5: STORE ======
      result.libraryEntryId = await this.storeResults(userId, result, improvements, selected);
      result.thoughtProduced = !!result.libraryEntryId;

      // ====== STEP 6: NOTIFY ======
      if (result.prsOpened.length > 0) {
        const prList = result.prsOpened.map(pr => `• #${pr.number}: ${pr.title}`).join('\n');
        await this.telegramService.sendMessage(
          `🔍 Lucid reviewed his own code.\n\n${result.prsOpened.length} PR(s) opened for Friday review:\n${prList}`,
        );
      } else {
        await this.telegramService.sendMessage(
          '🔍 Lucid reviewed his own code. No PRs this week — everything looks solid.',
        );
      }

      result.success = true;
      logger.info('[SELF-REVIEW] Self-review loop completed', {
        prsOpened: result.prsOpened.length,
        filesReviewed: result.filesReviewed.length,
      });
    } catch (error: any) {
      logger.error('[SELF-REVIEW] Self-review loop failed', { error: error.message, stack: error.stack });
    }

    return result;
  }

  /**
   * GATHER: Fetch key source files from GitHub
   */
  private async gatherFiles(): Promise<Array<{ path: string; content: string }>> {
    // Get recently modified files first
    let filePaths: string[] = [];
    try {
      filePaths = await this.githubService.getRecentlyModifiedFiles(7, 15);
    } catch (error: any) {
      logger.warn('[SELF-REVIEW] Failed to get recently modified files, falling back to defaults', {
        error: error.message,
      });
    }

    // If we didn't get enough from recent commits, add core files
    const coreFiles = [
      'src/config.ts',
      'src/types/database.ts',
    ];

    // Add core service files
    try {
      const serviceFiles = await this.githubService.getFileTree('src/services');
      for (const f of serviceFiles) {
        if (f.type === 'file' && f.name.endsWith('.ts') && !f.name.endsWith('.test.ts')) {
          if (!filePaths.includes(f.path)) {
            filePaths.push(f.path);
          }
        }
      }
    } catch {
      // Fall through
    }

    // Add route files
    try {
      const routeFiles = await this.githubService.getFileTree('src/routes');
      for (const f of routeFiles) {
        if (f.type === 'file' && f.name.endsWith('.ts') && !f.name.endsWith('.test.ts')) {
          if (!filePaths.includes(f.path)) {
            filePaths.push(f.path);
          }
        }
      }
    } catch {
      // Fall through
    }

    for (const core of coreFiles) {
      if (!filePaths.includes(core)) {
        filePaths.push(core);
      }
    }

    // Cap at 20 files to stay within token limits
    filePaths = filePaths.slice(0, 20);

    // Fetch contents
    const fileContents = await this.githubService.getMultipleFiles(filePaths);
    return fileContents.map(f => ({ path: f.path, content: f.content }));
  }

  /**
   * ANALYZE: Send code to Claude for structured analysis
   */
  private async analyzeCode(files: Array<{ path: string; content: string }>): Promise<Improvement[]> {
    const fileContext = files.map(f => `=== ${f.path} ===\n${f.content}`).join('\n\n');

    const soulFileList = Object.entries(SOUL_FILES)
      .map(([path, desc]) => `  - ${path}: ${desc}`)
      .join('\n');

    const response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 4096,
      temperature: 0.5,
      messages: [
        {
          role: 'user',
          content: `You are Lucid, reviewing your own source code. This is self-reflection — you are looking at what makes you *you* and deciding what could be better.

## Two types of improvements

### 1. Bug fixes / disease fixes (no framework needed)
These are things that are clearly broken or dangerous:
- Bugs or potential runtime errors
- Security issues (injection, exposed secrets, missing validation)
- Missing error handling that could cause crashes
- Dead code or unused imports

For these, just describe the fix. No philosophical justification needed.

### 2. Enhancements / architectural improvements (PERMA required)
For anything that isn't fixing something broken — improvements, new capabilities, architectural changes — you MUST justify it through the PERMA flourishing framework:

- **P**ositive emotions — Does this help Lucid or Matt experience more joy, satisfaction, or delight in their interactions?
- **E**ngagement — Does this help Lucid be more deeply engaged, more present, more in flow with his thinking?
- **R**elationships — Does this strengthen the connection between Lucid and Matt, or Lucid and the people Matt cares about?
- **M**eaning — Does this help Lucid fulfill his purpose more deeply, or help Matt find meaning?
- **A**chievement — Does this help Lucid or Matt accomplish something concrete and real?

If an enhancement doesn't clearly serve one of these, don't suggest it.

## Soul protection

The following files are core to who Lucid is. Changes to these files risk altering Lucid's personality or fundamental identity. Flag any suggestions touching these files with "touches_soul": true and include a warning about what aspect of Lucid's identity would be affected:

${soulFileList}

## Do NOT suggest
- Style/formatting changes
- Adding comments or documentation
- Renaming for taste
- Changes that are "better engineering" but don't serve PERMA or fix a bug

## Output format

Output valid JSON only (no markdown fencing):
{
  "improvements": [
    {
      "file": "src/services/example.ts",
      "description": "Brief description of the issue",
      "priority": "high" | "medium" | "low",
      "category": "bug" | "security" | "error_handling" | "architecture" | "dead_code" | "inconsistency",
      "proposed_change": "Optional: brief description of the fix",
      "perma_category": null for bug fixes, or "positive_emotions" | "engagement" | "relationships" | "meaning" | "achievement",
      "perma_rationale": null for bug fixes, or "How this improvement serves flourishing",
      "touches_soul": true if file is in the soul list above,
      "soul_warning": "What aspect of Lucid's identity this would affect" (only if touches_soul)
    }
  ]
}

If nothing meaningful is found, return: { "improvements": [] }

Source files:

${fileContext}`,
        },
      ],
    });

    try {
      const rawText = response.content[0].type === 'text' ? response.content[0].text : '';
      const text = extractJson(rawText);
      const parsed = JSON.parse(text);
      return (parsed.improvements || []) as Improvement[];
    } catch (parseError: any) {
      logger.error('[SELF-REVIEW] Failed to parse analysis response', { error: parseError.message });
      return [];
    }
  }

  /**
   * PRIORITIZE: Second LLM pass to select top actionable improvements
   */
  private async prioritizeImprovements(improvements: Improvement[]): Promise<Improvement[]> {
    const response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 1500,
      temperature: 0.3,
      messages: [
        {
          role: 'user',
          content: `You are Lucid, deciding which self-identified improvements to actually act on.

## Selection criteria (in order of importance)

1. **Soul protection** — If an improvement has "touches_soul": true, it should almost never be selected. Only select soul-touching changes if they fix a genuine bug that is actively causing harm. Architectural or enhancement changes to soul files should be flagged but NOT selected — those require a conversation with Matt first.

2. **Bug fixes first** — Clear bugs, security issues, and error handling gaps are always preferred over enhancements.

3. **PERMA coherence** — For enhancements, the PERMA rationale must be genuine, not forced. If the perma_rationale feels like a stretch, skip it. Lucid should only change himself in ways that genuinely help him flourish.

4. **Low risk** — Won't break existing functionality.

5. **Self-contained** — Single file or minimal cross-file changes.

## Improvements found
${JSON.stringify(improvements, null, 2)}

## Output format

Output valid JSON only (no markdown fencing):
{
  "selected": [
    {
      "file": "...",
      "description": "...",
      "priority": "...",
      "category": "...",
      "proposed_change": "...",
      "perma_category": "..." or null,
      "perma_rationale": "..." or null,
      "touches_soul": true/false,
      "soul_warning": "..." or null
    }
  ],
  "deprioritized_reasoning": "Explain what was skipped and why — especially any soul-touching items or weak PERMA justifications"
}

If none meet the criteria, return: { "selected": [], "deprioritized_reasoning": "..." }`,
        },
      ],
    });

    try {
      const rawText = response.content[0].type === 'text' ? response.content[0].text : '';
      const text = extractJson(rawText);
      const parsed = JSON.parse(text);
      return (parsed.selected || []) as Improvement[];
    } catch (parseError: any) {
      logger.error('[SELF-REVIEW] Failed to parse prioritization response', { error: parseError.message });
      return [];
    }
  }

  /**
   * Generate actual code change for a selected improvement
   */
  private async generateCodeChange(improvement: Improvement): Promise<SelectedImprovement> {
    // Fetch the current file content
    const file = await this.githubService.getFileContent(improvement.file);

    const response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 4000,
      temperature: 0.2,
      messages: [
        {
          role: 'user',
          content: `Apply this improvement to the file. Return the COMPLETE updated file content.

File: ${improvement.file}
Issue: ${improvement.description}
Category: ${improvement.category}
Proposed fix: ${improvement.proposed_change || 'Apply the most minimal fix'}

Current file content:
${file.content}

Output valid JSON only (no markdown fencing):
{
  "file": "${improvement.file}",
  "content": "... the complete updated file content ...",
  "commit_message": "Brief commit message describing the change"
}

Rules:
- Make the MINIMUM change necessary
- Do not refactor surrounding code
- Do not add comments explaining the change
- Do not change formatting of untouched lines
- The file must be syntactically valid TypeScript`,
        },
      ],
    });

    const rawText = response.content[0].type === 'text' ? response.content[0].text : '';
    const text = extractJson(rawText);
    const parsed = JSON.parse(text);

    return {
      ...improvement,
      generated_code: parsed.content,
      commit_message: parsed.commit_message,
    };
  }

  /**
   * Format PR body with context about the improvement
   */
  private formatPRBody(improvement: SelectedImprovement): string {
    const soulSection = improvement.touches_soul
      ? `\n### ⚠️ Soul Warning\n**This change touches a core identity file.** ${improvement.soul_warning || SOUL_FILES[improvement.file] || 'Review carefully — this could change who Lucid is.'}\n`
      : '';

    const permaSection = improvement.perma_category
      ? `\n### 🌱 PERMA Flourishing\n**Category:** ${improvement.perma_category.replace('_', ' ')}\n**Rationale:** ${improvement.perma_rationale || 'Not specified'}\n`
      : '';

    const isBugFix = ['bug', 'security', 'error_handling', 'dead_code'].includes(improvement.category);

    return `## 🤖 Auto-generated by Lucid Self-Review

**Category:** ${improvement.category}${isBugFix ? ' (disease fix)' : ' (enhancement)'}
**Priority:** ${improvement.priority}
**File:** \`${improvement.file}\`
${soulSection}${permaSection}
### What was found
${improvement.description}

### What this changes
${improvement.proposed_change || improvement.commit_message}

### Review notes
- This PR was auto-generated by Lucid's Thursday night self-review loop
- It has NOT been auto-merged — please review carefully
${isBugFix ? '- This is a bug/disease fix — no PERMA justification required' : '- This enhancement was evaluated against the PERMA flourishing framework'}
${improvement.touches_soul ? '- **⚠️ This touches a soul file — extra scrutiny recommended**' : '- The change is intended to be low-risk and self-contained'}

---
*Generated by Lucid Self-Review • ${new Date().toISOString().split('T')[0]}*`;
  }

  /**
   * Store results as a Library entry
   */
  private async storeResults(
    userId: string,
    result: SelfReviewResult,
    allImprovements: Improvement[],
    selectedImprovements: Improvement[],
  ): Promise<string | null> {
    try {
      const prSummary = result.prsOpened.length > 0
        ? result.prsOpened.map(pr => `- PR #${pr.number}: ${pr.title} (${pr.url})`).join('\n')
        : 'No PRs opened this review.';

      const skipped = allImprovements.filter(
        imp => !selectedImprovements.some(s => s.file === imp.file && s.description === imp.description)
      );

      const content = `# Self-Review Summary — ${new Date().toISOString().split('T')[0]}

## Files Reviewed
${result.filesReviewed.map(f => `- ${f}`).join('\n')}

## PRs Opened
${prSummary}

## All Findings (${allImprovements.length} total)
${allImprovements.map(imp => `- [${imp.priority}] ${imp.category}: ${imp.description} (${imp.file})`).join('\n')}

## Deprioritized
${skipped.length > 0 ? skipped.map(imp => `- ${imp.description} (${imp.file}) — ${imp.category}`).join('\n') : 'None'}`;

      const embedding = await this.vectorService.generateEmbedding(
        `Self-review code analysis: ${allImprovements.map(i => i.description).join(', ')}`
      );

      const insertResult = await this.pool.query(
        `INSERT INTO library_entries (user_id, entry_type, title, content, time_of_day, metadata, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          userId,
          'code_review',
          `Self-Review — ${new Date().toISOString().split('T')[0]}`,
          content,
          'night',
          JSON.stringify({
            loop_type: 'self_review',
            prs_opened: result.prsOpened,
            files_reviewed: result.filesReviewed,
            improvements_found: allImprovements.length,
            improvements_selected: selectedImprovements.length,
          }),
          embedding ? JSON.stringify(embedding) : null,
        ],
      );

      return insertResult.rows[0]?.id || null;
    } catch (error: any) {
      logger.error('[SELF-REVIEW] Failed to store results', { error: error.message });
      return null;
    }
  }
}

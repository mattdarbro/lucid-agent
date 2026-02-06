import { Octokit } from '@octokit/rest';
import { config } from '../config';
import { logger } from '../logger';

interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
}

interface FileContent {
  path: string;
  content: string;
  sha: string;
}

export class GitHubService {
  private octokit: Octokit | null = null;
  private owner: string;
  private repo: string;

  constructor() {
    this.owner = config.github.owner;
    this.repo = config.github.repo;

    if (config.github.enabled) {
      this.octokit = new Octokit({ auth: config.github.token });
      logger.info('[GITHUB] GitHub service initialized', { owner: this.owner, repo: this.repo });
    } else {
      logger.warn('[GITHUB] GitHub service disabled - GITHUB_TOKEN or GITHUB_OWNER not set');
    }
  }

  isEnabled(): boolean {
    return !!this.octokit && !!this.owner && !!this.repo;
  }

  /**
   * List files in a directory of the repo
   */
  async getFileTree(path: string = ''): Promise<FileEntry[]> {
    if (!this.octokit) throw new Error('GitHub service not configured');

    const { data } = await this.octokit.repos.getContent({
      owner: this.owner,
      repo: this.repo,
      path,
    });

    if (!Array.isArray(data)) {
      return [{ name: (data as any).name, path: (data as any).path, type: (data as any).type as 'file' | 'dir', size: (data as any).size }];
    }

    return data.map((item: any) => ({
      name: item.name,
      path: item.path,
      type: item.type as 'file' | 'dir',
      size: item.size,
    }));
  }

  /**
   * Get a single file's content (base64 decoded)
   */
  async getFileContent(path: string): Promise<FileContent> {
    if (!this.octokit) throw new Error('GitHub service not configured');

    const { data } = await this.octokit.repos.getContent({
      owner: this.owner,
      repo: this.repo,
      path,
    });

    if (Array.isArray(data) || (data as any).type !== 'file') {
      throw new Error(`Path ${path} is not a file`);
    }

    const fileData = data as any;
    const content = Buffer.from(fileData.content, 'base64').toString('utf-8');

    return {
      path: fileData.path,
      content,
      sha: fileData.sha,
    };
  }

  /**
   * Batch fetch multiple files
   */
  async getMultipleFiles(paths: string[]): Promise<FileContent[]> {
    const results: FileContent[] = [];

    for (const path of paths) {
      try {
        const file = await this.getFileContent(path);
        results.push(file);
      } catch (error: any) {
        logger.warn(`[GITHUB] Failed to fetch file ${path}: ${error.message}`);
      }
    }

    return results;
  }

  /**
   * Get recently modified files by checking recent commits
   */
  async getRecentlyModifiedFiles(days: number = 7, maxFiles: number = 20): Promise<string[]> {
    if (!this.octokit) throw new Error('GitHub service not configured');

    const since = new Date();
    since.setDate(since.getDate() - days);

    const { data: commits } = await this.octokit.repos.listCommits({
      owner: this.owner,
      repo: this.repo,
      since: since.toISOString(),
      per_page: 30,
    });

    const fileSet = new Set<string>();

    for (const commit of commits) {
      try {
        const { data: commitDetail } = await this.octokit.repos.getCommit({
          owner: this.owner,
          repo: this.repo,
          ref: commit.sha,
        });

        for (const file of commitDetail.files || []) {
          if (file.filename && file.filename.endsWith('.ts') && !file.filename.endsWith('.test.ts')) {
            fileSet.add(file.filename);
          }
        }
      } catch {
        // Skip commits we can't fetch details for
      }

      if (fileSet.size >= maxFiles) break;
    }

    return Array.from(fileSet).slice(0, maxFiles);
  }

  /**
   * Create a new branch from main (or specified ref)
   */
  async createBranch(branchName: string, fromRef: string = 'main'): Promise<void> {
    if (!this.octokit) throw new Error('GitHub service not configured');

    // Get the SHA of the source ref
    const { data: ref } = await this.octokit.git.getRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${fromRef}`,
    });

    await this.octokit.git.createRef({
      owner: this.owner,
      repo: this.repo,
      ref: `refs/heads/${branchName}`,
      sha: ref.object.sha,
    });

    logger.info(`[GITHUB] Created branch ${branchName} from ${fromRef}`);
  }

  /**
   * Create or update a file on a branch
   */
  async commitFile(
    branch: string,
    path: string,
    content: string,
    message: string,
  ): Promise<void> {
    if (!this.octokit) throw new Error('GitHub service not configured');

    // Try to get existing file SHA
    let sha: string | undefined;
    try {
      const { data } = await this.octokit.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path,
        ref: branch,
      });
      if (!Array.isArray(data)) {
        sha = (data as any).sha;
      }
    } catch {
      // File doesn't exist yet — that's fine
    }

    await this.octokit.repos.createOrUpdateFileContents({
      owner: this.owner,
      repo: this.repo,
      path,
      message,
      content: Buffer.from(content).toString('base64'),
      branch,
      sha,
    });

    logger.info(`[GITHUB] Committed ${path} to ${branch}`);
  }

  /**
   * Open a pull request against main
   */
  async createPullRequest(
    title: string,
    body: string,
    branch: string,
    baseBranch: string = 'main',
  ): Promise<{ number: number; url: string }> {
    if (!this.octokit) throw new Error('GitHub service not configured');

    const { data: pr } = await this.octokit.pulls.create({
      owner: this.owner,
      repo: this.repo,
      title,
      body,
      head: branch,
      base: baseBranch,
    });

    logger.info(`[GITHUB] Created PR #${pr.number}: ${title}`, { url: pr.html_url });

    return { number: pr.number, url: pr.html_url };
  }
}

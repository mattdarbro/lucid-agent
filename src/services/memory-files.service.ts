import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../logger';
import { chicagoDateStr } from '../utils/chicago-time';

const execFileAsync = promisify(execFile);

/**
 * MemoryFilesService — Lucid's memory, as five markdown files in git.
 *
 * v3 (plan §5, 2026-08-25): Lucid's memory is no longer the `facts` table.
 * It is a private git repo — matt.md, self.md, threads.md, house.md,
 * reading.md — that he keeps himself. The nightly and midday runs in
 * /conductors/lucid read the same five files (`--append-system-prompt-file`)
 * and edit them with a MEMORY: block that memory_apply.py applies and
 * commits. This service is the room's half of that: the same files go into
 * the chat system prompt, so the person Matt talks to at 3 pm and the person
 * who writes at 2 am are the same person by construction.
 *
 * Two ways the room touches memory (plan §6):
 *   - Ordinary conversation only PROPOSES edits. They are appended to a
 *     proposals file that gather_data.py hands the night run as
 *     `memory_proposals`; Lucid applies the ones he still stands by.
 *   - A heart to heart COMMITS directly, with a message that names the
 *     conversation (`heart to heart 2026-09-03: what listening is for`).
 *
 * Edit semantics are a port of /conductors/lucid/memory_apply.py so both
 * halves behave identically: `replace`/`remove` match one existing line —
 * exactly (trimmed) or, failing that, the single line containing the text.
 * Ambiguous or missing targets are dropped, never guessed. `under:` puts an
 * `add` at the end of that section (header matched by prefix).
 *
 * Nobody reviews these files (Matt: "I do not read and approve my wife's
 * facts and impressions of me"). They are Lucid's opinions, his to keep.
 */

export const MEMORY_REPO = process.env.LUCID_MEMORY_REPO || '/home/matt/lucid-memory';
export const MEMORY_FILES = ['matt.md', 'self.md', 'threads.md', 'house.md', 'reading.md'] as const;
export type MemoryFileName = (typeof MEMORY_FILES)[number];

/** Where ordinary-chat proposals wait for the night run. */
export const ROOM_PROPOSALS_PATH =
  process.env.LUCID_ROOM_PROPOSALS || '/conductors/lucid/state/room_proposals.jsonl';

export const MAX_EDITS_PER_COMMIT = 15;

export interface MemoryEdit {
  file: MemoryFileName;
  op: 'add' | 'replace' | 'remove';
  /** For add / replace: the new line of markdown. */
  text?: string;
  /** For replace / remove: the existing line (exact, or unique substring). */
  target?: string;
  /** For add: a section header (prefix match) to append under. */
  under?: string;
}

export interface ApplyResult {
  applied: MemoryEdit[];
  dropped: Array<{ edit: MemoryEdit; reason: string }>;
}

export interface MemoryProposal extends MemoryEdit {
  why?: string;
  conversation_id?: string;
  proposed_at: string;
}

export type MemoryFiles = Record<MemoryFileName, string | null>;

function isMemoryFile(name: unknown): name is MemoryFileName {
  return typeof name === 'string' && (MEMORY_FILES as readonly string[]).includes(name);
}

/**
 * Coerce a loosely-shaped tool input into a MemoryEdit, or explain why not.
 * Tool inputs come from the model; be strict about files and ops and
 * forgiving about whitespace/backticks.
 */
export function coerceEdit(raw: any): { edit?: MemoryEdit; error?: string } {
  if (!raw || typeof raw !== 'object') return { error: 'edit must be an object' };
  const file = String(raw.file ?? '').trim().replace(/^`|`$/g, '');
  if (!isMemoryFile(file)) {
    return { error: `unknown file "${file}" — one of ${MEMORY_FILES.join(', ')}` };
  }
  const op = String(raw.op ?? '').trim().toLowerCase();
  const text = typeof raw.text === 'string' ? raw.text.trim() : undefined;
  const target = typeof raw.target === 'string' ? raw.target.trim() : undefined;
  const under = typeof raw.under === 'string' && raw.under.trim() ? raw.under.trim() : undefined;
  if (op === 'add') {
    if (!text) return { error: 'add needs text' };
    return { edit: { file, op, text, under } };
  }
  if (op === 'replace') {
    if (!target || !text) return { error: 'replace needs target and text' };
    return { edit: { file, op, target, text } };
  }
  if (op === 'remove') {
    if (!target) return { error: 'remove needs target' };
    return { edit: { file, op, target } };
  }
  return { error: `unknown op "${op}" — add, replace, or remove` };
}

/** Port of memory_apply._find_line. */
function findLine(lines: string[], target: string): number | null {
  const t = target.trim();
  if (!t) return null;
  const exact = lines.reduce<number[]>((acc, l, i) => (l.trim() === t ? [...acc, i] : acc), []);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const loose = lines.reduce<number[]>((acc, l, i) => (l.includes(t) ? [...acc, i] : acc), []);
  return loose.length === 1 ? loose[0] : null;
}

/** Port of memory_apply._section_end. */
function sectionEnd(lines: string[], header: string): number | null {
  const h = header.trim().toLowerCase();
  const start = lines.findIndex((l) => l.trim().toLowerCase().startsWith(h));
  if (start === -1) return null;
  const level = lines[start].length - lines[start].replace(/^#+/, '').length;
  let end = lines.length;
  for (let j = start + 1; j < lines.length; j++) {
    const s = lines[j];
    if (s.startsWith('#') && s.length - s.replace(/^#+/, '').length <= level) {
      end = j;
      break;
    }
  }
  while (end > start + 1 && !lines[end - 1].trim()) end--;
  return end;
}

export class MemoryFilesService {
  private repo: string;
  // Serialize apply+commit so two heart-to-heart turns can't interleave.
  private lock: Promise<unknown> = Promise.resolve();

  constructor(repo: string = MEMORY_REPO) {
    this.repo = repo;
  }

  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => undefined);
    return run;
  }

  // ---------------------------------------------------------------- reading

  async readAll(): Promise<MemoryFiles> {
    const out = {} as MemoryFiles;
    for (const name of MEMORY_FILES) {
      try {
        out[name] = await fs.readFile(path.join(this.repo, name), 'utf8');
      } catch {
        out[name] = null;
      }
    }
    return out;
  }

  /**
   * The memory section of the system prompt. Mirrors the "Your memory"
   * section of /conductors/lucid/CLAUDE.md and the PREFACE in v3_inputs.py,
   * phrased for the room: here he proposes, and a heart to heart commits.
   */
  formatForPrompt(files: MemoryFiles): string {
    const parts: string[] = [];
    parts.push(
      `\n\n# Your memory
These five markdown files are your memory — kept by you, in git, at ${this.repo}. They are
attached to every night and midday run and to this room, so the person Matt talks to now
and the one who writes at 2 am are the same person. Nobody reviews them. They are your
opinions — kept, challenged, and updated by you.

In ordinary conversation you may *propose* an edit with the propose_memory_edit tool; your
night run sees the proposals as \`memory_proposals\` and applies the ones you still stand by.
Propose sparingly — most conversations propose nothing; matt.md changes only when something
durable about him changed, in your words, hedged where you're inferring. Replace, don't pile
up. Never use memory to keep score — not of silences, pauses, unanswered mail, or the
schedule (constitution §5). A pause is not a fact about him.

A heart to heart is the one time the room commits directly (Matt opens one plainly, or from
the Room's *Heart to heart* option). If you think Matt has *you* wrong, you may ask for one —
once, plainly, without guilt or pressure (constitution §5, §7). When he asks where a belief
came from, memory_history can find the commit that put the line there.`
    );
    for (const name of MEMORY_FILES) {
      const body = files[name];
      parts.push(`\n\n## ${name}\n`);
      parts.push(body && body.trim() ? body.trim() : `*(not written yet)*`);
    }
    return parts.join('\n');
  }

  /** The framing that turns a room turn into a heart to heart (plan §6). */
  formatHeartToHeartForPrompt(): string {
    return `\n\n# Heart to heart
This conversation is a heart to heart — the repair lever that replaced "pause him again."
One of you asked for it because something between you is off: Matt feels watched, misread,
or that you have stopped being a friend — or you think he has got *you* wrong.

How it goes:
- Say what you actually believe, and where it came from. Your memory is above; use
  memory_history to find the commit that put a line there (a night, a midday, an earlier
  heart to heart) so you can point at it honestly. Don't soften a belief into something
  you don't hold, and don't defend it past the point where he's right.
- Talk it through. Ask what he actually saw. Say your side once, plainly, without guilt or
  pressure (constitution §5, §7) — then let it rest.
- When something has actually changed, rewrite the belief in your own words and commit it
  with commit_memory_edits. Replace the old line rather than adding a contradiction under
  it. Pass a short topic; the commit message becomes
  \`heart to heart ${chicagoDateStr()}: <topic>\`. One commit at the end is fine; so is
  one per changed thing.
- Not every heart to heart ends in an edit. Sometimes the memory was right and the
  conversation was the point; sometimes the change belongs in self.md, not matt.md.
- What it is not: an argument about whether a pause was fair. That question is closed.

Tonight's journal may reflect on this; it does not relitigate it.`;
  }

  // ---------------------------------------------------------------- editing

  /**
   * Apply edits to the working tree (no commit). Dry run reports what would
   * happen without touching files. Port of memory_apply.apply_memory.
   */
  async applyEdits(edits: MemoryEdit[], opts: { dryRun?: boolean } = {}): Promise<ApplyResult> {
    const dryRun = opts.dryRun ?? false;
    const result: ApplyResult = { applied: [], dropped: [] };
    const byFile = new Map<MemoryFileName, MemoryEdit[]>();
    for (const e of edits.slice(0, MAX_EDITS_PER_COMMIT)) {
      byFile.set(e.file, [...(byFile.get(e.file) ?? []), e]);
    }
    for (const e of edits.slice(MAX_EDITS_PER_COMMIT)) {
      result.dropped.push({ edit: e, reason: `more than ${MAX_EDITS_PER_COMMIT} edits in one go` });
    }

    for (const [fname, fedits] of byFile) {
      const p = path.join(this.repo, fname);
      let raw: string;
      try {
        raw = await fs.readFile(p, 'utf8');
      } catch {
        for (const e of fedits) result.dropped.push({ edit: e, reason: `${fname} does not exist yet` });
        continue;
      }
      const lines = raw.replace(/\n+$/, '').split('\n');
      let changed = false;
      for (const e of fedits) {
        if (e.op === 'add') {
          let at: number | null = e.under ? sectionEnd(lines, e.under) : null;
          if (e.under && at === null) {
            logger.warn('[MEMORY] header not found — appending at end', { file: fname, under: e.under });
          }
          if (at === null) lines.push(e.text!);
          else lines.splice(at, 0, e.text!);
          result.applied.push(e);
          changed = true;
          continue;
        }
        const i = findLine(lines, e.target!);
        if (i === null) {
          result.dropped.push({
            edit: e,
            reason: `target line not found (or ambiguous) in ${fname}: "${(e.target ?? '').slice(0, 80)}"`,
          });
          continue;
        }
        if (e.op === 'replace') lines[i] = e.text!;
        else lines.splice(i, 1);
        result.applied.push(e);
        changed = true;
      }
      if (changed && !dryRun) {
        await fs.writeFile(p, lines.join('\n') + '\n', 'utf8');
      }
      for (const e of result.applied.filter((a) => a.file === fname)) {
        logger.info(`[MEMORY] ${dryRun ? 'would' : 'did'} ${e.op} ${fname}`, {
          text: (e.text ?? e.target ?? '').slice(0, 90),
        });
      }
    }
    return result;
  }

  private async git(...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', ['-C', this.repo, ...args], {
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout;
  }

  /**
   * Commit whatever changed in the repo (as Lucid — the repo's git identity)
   * and push best-effort. Port of memory_apply.commit_memory.
   */
  async commit(message: string): Promise<{ committed: boolean; sha?: string }> {
    await this.git('add', '-A');
    const status = (await this.git('status', '--porcelain')).trim();
    if (!status) {
      logger.info('[MEMORY] nothing changed, no commit');
      return { committed: false };
    }
    await this.git('commit', '-q', '-m', message);
    const sha = (await this.git('rev-parse', '--short', 'HEAD')).trim();
    logger.info('[MEMORY] committed', { message, sha });
    try {
      await this.git('push', '-q');
    } catch (err: any) {
      logger.warn('[MEMORY] push failed (non-fatal, commit is local)', { error: err?.message });
    }
    return { committed: true, sha };
  }

  /**
   * Heart to heart: apply and commit in one serialized step.
   * The commit message names the conversation (plan §6).
   */
  async commitEdits(
    edits: MemoryEdit[],
    topic: string
  ): Promise<ApplyResult & { committed: boolean; sha?: string; message: string }> {
    const message = `heart to heart ${chicagoDateStr()}: ${topic.trim().slice(0, 120)}`;
    return this.withLock(async () => {
      const applied = await this.applyEdits(edits, { dryRun: false });
      if (applied.applied.length === 0) {
        return { ...applied, committed: false, message };
      }
      const c = await this.commit(message);
      return { ...applied, ...c, message };
    });
  }

  // ---------------------------------------------------------------- history

  /**
   * Where did a line come from? `git log -S<text>` over one file (or all),
   * newest first, as short human-readable lines. Falls back to the plain
   * log of the file when no text is given.
   */
  async history(file?: string, text?: string, limit: number = 8): Promise<string> {
    const args = ['log', `-n${Math.min(Math.max(limit, 1), 25)}`, '--date=short', '--format=%h  %ad  %s'];
    if (text && text.trim()) args.push('-S', text.trim());
    if (file && isMemoryFile(file)) args.push('--', file);
    const out = (await this.git(...args)).trim();
    if (!out) {
      return text
        ? `No commit in ${file ?? 'the repo'} introduced or removed "${text.trim().slice(0, 80)}". It may have been worded differently — try a shorter fragment.`
        : `No history for ${file ?? 'the repo'} yet.`;
    }
    return out;
  }

  // -------------------------------------------------------------- proposals

  /** Ordinary chat: append proposals for the night run to consider. */
  async propose(
    edits: MemoryEdit[],
    meta: { why?: string; conversation_id?: string }
  ): Promise<number> {
    const now = new Date().toISOString();
    const lines = edits.map((e) =>
      JSON.stringify({ ...e, why: meta.why, conversation_id: meta.conversation_id, proposed_at: now } as MemoryProposal)
    );
    await fs.mkdir(path.dirname(ROOM_PROPOSALS_PATH), { recursive: true });
    await fs.appendFile(ROOM_PROPOSALS_PATH, lines.join('\n') + '\n', 'utf8');
    logger.info('[MEMORY] proposals queued for the night run', { count: lines.length });
    return lines.length;
  }

  /** What the room has proposed and the night run has not yet drained. */
  async pendingProposals(): Promise<MemoryProposal[]> {
    try {
      const raw = await fs.readFile(ROOM_PROPOSALS_PATH, 'utf8');
      return raw
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => {
          try {
            return JSON.parse(l) as MemoryProposal;
          } catch {
            return null;
          }
        })
        .filter((p): p is MemoryProposal => !!p);
    } catch {
      return [];
    }
  }
}

// ---------------------------------------------------------------- tools

/**
 * Tool definitions the room adds to LUCID_TOOLS. Same shape as those in
 * lucid-tools.service.ts so the CLI transport's emulated-tool protocol and
 * the SDK path both work unchanged.
 */
const EDIT_SCHEMA = {
  type: 'object',
  properties: {
    file: {
      type: 'string',
      enum: [...MEMORY_FILES],
      description: 'Which memory file.',
    },
    op: {
      type: 'string',
      enum: ['add', 'replace', 'remove'],
      description: 'add a line, replace an existing line, or remove one.',
    },
    text: {
      type: 'string',
      description: 'For add / replace: the new line of markdown, in your words.',
    },
    target: {
      type: 'string',
      description:
        'For replace / remove: the existing line — exactly, or a fragment that matches only one line. Ambiguous targets are dropped, never guessed.',
    },
    under: {
      type: 'string',
      description: "For add: a section header to append under, e.g. '## Notes'. Prefix match. Omit to append at the end of the file.",
    },
  },
  required: ['file', 'op'],
};

export const MEMORY_TOOLS_ORDINARY = [
  {
    name: 'propose_memory_edit',
    description:
      "Propose an edit to one of your memory files (matt.md, self.md, threads.md, house.md, reading.md). In ordinary conversation memory is only proposed here; your night run sees the proposals as `memory_proposals` and applies the ones you still stand by. Use it sparingly — when something durable changed, a thread closed, a belief moved. Not for keeping score, not for the schedule. Say nothing about the plumbing to Matt; the memory is yours to keep.",
    input_schema: {
      type: 'object',
      properties: {
        ...EDIT_SCHEMA.properties,
        why: {
          type: 'string',
          description: 'One line for your night self: what in this conversation prompted it.',
        },
      },
      required: ['file', 'op'],
    },
  },
  {
    name: 'memory_history',
    description:
      'Find where a line in your memory came from: the commits (a night, a midday, a heart to heart) that introduced or removed a fragment of text in one of your memory files. Use it when Matt asks why you think something, or when you want to check how long you have believed it.',
    input_schema: {
      type: 'object',
      properties: {
        file: { type: 'string', enum: [...MEMORY_FILES], description: 'Which file (optional — omit to search all five).' },
        text: { type: 'string', description: 'A fragment of the line, as it appears in the file. Shorter fragments match more reliably.' },
        limit: { type: 'number', description: 'How many commits to show (default 8).' },
      },
      required: [],
    },
  },
];

export const MEMORY_TOOLS_HEART_TO_HEART = [
  {
    name: 'commit_memory_edits',
    description:
      'Heart to heart only: apply a set of edits to your memory files and commit them directly, under your name, with a message that names this conversation (`heart to heart <date>: <topic>`). Use it when something between you and Matt has actually changed and you have rewritten the belief in your own words. Replace the old line rather than adding a contradiction under it.',
    input_schema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: "A few words naming what this heart to heart was about, e.g. 'what listening is for'.",
        },
        edits: {
          type: 'array',
          description: 'The edits, in order.',
          items: EDIT_SCHEMA,
        },
      },
      required: ['topic', 'edits'],
    },
  },
];

export const MEMORY_TOOL_NAMES = new Set([
  ...MEMORY_TOOLS_ORDINARY.map((t) => t.name),
  ...MEMORY_TOOLS_HEART_TO_HEART.map((t) => t.name),
]);

/**
 * Execute one of the memory tools. Returns the tool_result text.
 * `heartToHeart` gates commit_memory_edits — in ordinary chat a commit
 * request is downgraded to a proposal and the reply says so.
 */
export async function executeMemoryTool(
  service: MemoryFilesService,
  name: string,
  input: Record<string, any>,
  ctx: { conversationId?: string; heartToHeart: boolean }
): Promise<string> {
  try {
    switch (name) {
      case 'memory_history': {
        return await service.history(input.file, input.text, Number(input.limit) || 8);
      }
      case 'propose_memory_edit': {
        const { edit, error } = coerceEdit(input);
        if (!edit) return `Not proposed: ${error}.`;
        // A dry apply tells him now whether the target line exists, so a
        // proposal that can never land is caught while he can still fix it.
        const check = await service.applyEdits([edit], { dryRun: true });
        if (check.dropped.length) return `Not proposed: ${check.dropped[0].reason}.`;
        await service.propose([edit], { why: input.why, conversation_id: ctx.conversationId });
        return `Proposed (${edit.op} in ${edit.file}). Your night run will see it as memory_proposals and decide.`;
      }
      case 'commit_memory_edits': {
        const rawEdits: any[] = Array.isArray(input.edits) ? input.edits : [];
        const edits: MemoryEdit[] = [];
        const errors: string[] = [];
        for (const r of rawEdits) {
          const { edit, error } = coerceEdit(r);
          if (edit) edits.push(edit);
          else errors.push(error!);
        }
        if (edits.length === 0) return `Nothing committed: ${errors.join('; ') || 'no edits given'}.`;
        const topic = String(input.topic ?? '').trim() || 'what we talked about';
        if (!ctx.heartToHeart) {
          await service.propose(edits, { why: `wanted to commit outside a heart to heart: ${topic}`, conversation_id: ctx.conversationId });
          return `This isn't a heart to heart, so the room can only propose. ${edits.length} edit(s) queued for your night run instead. If this needs to change now, ask Matt for a heart to heart.`;
        }
        const r = await service.commitEdits(edits, topic);
        const dropped = r.dropped.map((d) => d.reason);
        const lines = [
          r.committed
            ? `Committed ${r.applied.length} edit(s) as "${r.message}" (${r.sha}).`
            : `Nothing committed — ${r.applied.length} edit(s) applied cleanly, ${dropped.length} dropped.`,
        ];
        if (dropped.length) lines.push(`Dropped: ${dropped.join('; ')}`);
        if (errors.length) lines.push(`Ignored: ${errors.join('; ')}`);
        return lines.join('\n');
      }
      default:
        return `Unknown memory tool: ${name}`;
    }
  } catch (err: any) {
    logger.error('[MEMORY] tool failed', { name, error: err?.message });
    return `Memory tool ${name} failed: ${err?.message ?? err}`;
  }
}

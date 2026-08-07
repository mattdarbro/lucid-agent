import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Claude CLI transport — routes Anthropic SDK calls through `claude -p`.
 *
 * When USE_CLAUDE_CLI=true, createAnthropicClient() returns a normal SDK
 * client whose fetch is swapped for one that spawns the Claude Code CLI.
 * The CLI authenticates with the Max-plan OAuth credentials in
 * ~/.claude/.credentials.json, so these calls have zero marginal cost —
 * no ANTHROPIC_API_KEY involved. Every service keeps its SDK call shape;
 * only the wire transport changes.
 *
 * Supported: messages.create with system (string or blocks), multi-turn
 * messages, and tools (emulated via a JSON reply protocol — the model is
 * asked to answer with {"tool_calls": [...]} when it wants a tool, which
 * is mapped back into SDK tool_use blocks so chat.service's loop works
 * unchanged). Not supported: streaming, image blocks.
 */

const CLI_TIMEOUT_MS = 9 * 60 * 1000; // Opus deep thoughts can run long
const MAX_CLI_TURNS = '4';

// Run the CLI from an empty directory so no project CLAUDE.md leaks into
// Lucid's prompts.
const CLI_WORKDIR = path.join(os.homedir(), '.lucid-claude-cli');

function ensureWorkdir(): string {
  try {
    fs.mkdirSync(CLI_WORKDIR, { recursive: true });
  } catch {
    /* already exists */
  }
  return CLI_WORKDIR;
}

export function useClaudeCli(): boolean {
  return process.env.USE_CLAUDE_CLI === 'true';
}

export function createAnthropicClient(opts?: { apiKey?: string }): Anthropic {
  if (useClaudeCli()) {
    return new Anthropic({
      apiKey: 'claude-cli-max-plan', // never sent anywhere; SDK requires a value
      fetch: claudeCliFetch as unknown as typeof fetch,
      maxRetries: 0, // the CLI does its own retrying; don't respawn on top
      timeout: CLI_TIMEOUT_MS + 30_000,
    });
  }
  return new Anthropic({
    apiKey: opts?.apiKey || process.env.ANTHROPIC_API_KEY,
  });
}

// ---------------------------------------------------------------------------
// Prompt rendering
// ---------------------------------------------------------------------------

type ContentBlock = {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
};

function blockContentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return JSON.stringify(content);
  return (content as ContentBlock[])
    .map((block) => {
      switch (block.type) {
        case 'text':
          return block.text ?? '';
        case 'tool_use':
          return `[You called tool "${block.name}" (id ${block.id}) with input: ${JSON.stringify(block.input)}]`;
        case 'tool_result':
          return `[Result of tool call ${block.tool_use_id}]:\n${blockContentToText(block.content)}`;
        default:
          return JSON.stringify(block);
      }
    })
    .join('\n');
}

function renderSystem(system: unknown): string {
  if (!system) return '';
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) {
    return system.map((b: ContentBlock) => b.text ?? '').join('\n');
  }
  return String(system);
}

function renderToolInstructions(tools: Array<Record<string, unknown>>): string {
  const defs = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
  return [
    '# Tools',
    'You may use the tools defined below. To call one or more tools, reply with',
    'ONLY this JSON object and nothing else (no prose, no code fences):',
    '{"tool_calls": [{"name": "<tool_name>", "input": { ... }}]}',
    'Each result will come back in the conversation as "[Result of tool call ...]".',
    'When you do not need a tool, reply normally with your next message as plain text',
    '(never JSON).',
    '',
    'Tool definitions (JSON Schema):',
    JSON.stringify(defs, null, 2),
  ].join('\n');
}

/**
 * The full system prompt handed to `--system-prompt`, which REPLACES Claude
 * Code's default system prompt — without this the model answers as "Claude
 * Code, a CLI tool" and refuses the emulated tool protocol.
 */
function renderSystemPrompt(body: Record<string, any>): string {
  const parts: string[] = [];
  const system = renderSystem(body.system);
  if (system) parts.push(system);
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    parts.push(renderToolInstructions(body.tools));
  }
  return parts.join('\n\n');
}

function renderPrompt(body: Record<string, any>): string {
  const parts: string[] = [];
  parts.push('# Conversation so far');
  for (const msg of body.messages ?? []) {
    const speaker = msg.role === 'assistant' ? 'Assistant' : 'Human';
    parts.push(`${speaker}: ${blockContentToText(msg.content)}`);
  }
  parts.push(
    '# Your turn',
    'You are the Assistant. Reply with ONLY the Assistant\'s next message — no',
    '"Assistant:" prefix, no commentary about this format.'
  );
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Response mapping
// ---------------------------------------------------------------------------

/** Extract a {"tool_calls": [...]} object from the model's reply, if present. */
function parseToolCalls(text: string): Array<{ name: string; input: unknown }> | null {
  let candidate = text.trim();
  const fenced = candidate.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) candidate = fenced[1].trim();
  if (!candidate.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(candidate);
    if (Array.isArray(parsed.tool_calls) && parsed.tool_calls.length > 0) {
      return parsed.tool_calls.filter(
        (c: any) => typeof c?.name === 'string' && c.input !== undefined
      );
    }
  } catch {
    /* plain text that happens to start with '{' */
  }
  return null;
}

function apiResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function apiError(status: number, message: string): Response {
  return apiResponse(status, {
    type: 'error',
    error: { type: 'api_error', message },
  });
}

// ---------------------------------------------------------------------------
// CLI invocation
// ---------------------------------------------------------------------------

function runClaudeCli(
  prompt: string,
  model: string,
  systemPrompt: string
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // Strip API-key auth from the child env — the whole point is that the
    // CLI uses the Max-plan OAuth login, never a billed key.
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.ANTHROPIC_BASE_URL;

    const args = ['-p', '--model', model, '--output-format', 'json', '--max-turns', MAX_CLI_TURNS];
    if (systemPrompt) args.push('--system-prompt', systemPrompt);

    const child = spawn('claude', args, {
      cwd: ensureWorkdir(),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`claude CLI timed out after ${CLI_TIMEOUT_MS / 1000}s`));
    }, CLI_TIMEOUT_MS);

    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// ---------------------------------------------------------------------------
// The custom fetch
// ---------------------------------------------------------------------------

async function claudeCliFetch(input: any, init?: any): Promise<Response> {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  const method = (init?.method ?? 'GET').toUpperCase();

  if (method !== 'POST' || !url.includes('/messages')) {
    return apiError(404, `claude-cli transport only supports messages.create (got ${method} ${url})`);
  }

  let body: Record<string, any>;
  try {
    body = JSON.parse(init?.body ?? '{}');
  } catch (err) {
    return apiError(400, `claude-cli transport could not parse request body: ${err}`);
  }

  if (body.stream) {
    return apiError(400, 'claude-cli transport does not support streaming');
  }

  const model: string = body.model || 'claude-sonnet-5';
  const prompt = renderPrompt(body);
  const systemPrompt = renderSystemPrompt(body);

  let result: { code: number | null; stdout: string; stderr: string };
  try {
    result = await runClaudeCli(prompt, model, systemPrompt);
  } catch (err: any) {
    return apiError(500, `claude CLI failed to run: ${err?.message ?? err}`);
  }

  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).slice(-2000);
    return apiError(500, `claude CLI exited with code ${result.code}: ${detail}`);
  }

  let cli: Record<string, any>;
  try {
    cli = JSON.parse(result.stdout);
  } catch {
    return apiError(500, `claude CLI returned non-JSON output: ${result.stdout.slice(-500)}`);
  }

  if (cli.is_error) {
    return apiError(500, `claude CLI error: ${String(cli.result).slice(0, 2000)}`);
  }

  const text: string = typeof cli.result === 'string' ? cli.result : JSON.stringify(cli.result);
  const usage = cli.usage ?? {};

  const toolCalls = Array.isArray(body.tools) && body.tools.length > 0 ? parseToolCalls(text) : null;

  const content = toolCalls
    ? toolCalls.map((call) => ({
        type: 'tool_use',
        id: `toolu_cli_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
        name: call.name,
        input: call.input,
      }))
    : [{ type: 'text', text }];

  return apiResponse(200, {
    id: `msg_cli_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: toolCalls ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: usage.input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
    },
  });
}

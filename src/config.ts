import dotenv from 'dotenv';

dotenv.config();

export const config = {
  // Server
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // API auth — shared secret the iOS client sends as a Bearer token.
  //
  // Required: validateConfig() refuses to boot without it. This used to fail
  // OPEN — a missing or typo'd LUCID_API_TOKEN silently served chat, library,
  // facts, and health metrics to the internet with only a log line to say so.
  // Fail-closed is the right default for a personal-memory API; set
  // ALLOW_UNAUTHENTICATED=true for local dev.
  auth: {
    apiToken: process.env.LUCID_API_TOKEN || '',
    allowUnauthenticated: process.env.ALLOW_UNAUTHENTICATED === 'true',
  },

  // Supabase
  supabase: {
    url: process.env.SUPABASE_URL || '',
    anonKey: process.env.SUPABASE_ANON_KEY || '',
    serviceKey: process.env.SUPABASE_SERVICE_KEY || '',
  },

  // Database
  databaseUrl: process.env.DATABASE_URL || '',

  // Anthropic (for LLM/chat)
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
  },

  // OpenAI (for embeddings only)
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-ada-002',
    embeddingDimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || '1536', 10),
  },

  // Studio API Integration
  studioApi: {
    url: process.env.STUDIO_API_URL || 'http://localhost:3000',
    appKey: process.env.STUDIO_APP_KEY || '',
  },

  // Agent Configuration
  agent: {
    name: process.env.AGENT_NAME || 'Lucid',
  },

  // Circadian Schedule (cron expressions)
  schedule: {
    morning: process.env.MORNING_CRON || '0 7 * * *',
    midday: process.env.MIDDAY_CRON || '0 12 * * *',
    evening: process.env.EVENING_CRON || '0 20 * * *',
    night: process.env.NIGHT_CRON || '0 2 * * *',
    // Fact extraction: default every 10 minutes (was 5 minutes)
    // Options: '*/5 * * * *' (5 min), '*/10 * * * *' (10 min), '0 * * * *' (hourly), '0 0 * * *' (daily)
    factExtraction: process.env.FACT_EXTRACTION_CRON || '*/10 * * * *',
  },

  // GitHub Integration (for self-review)
  github: {
    token: process.env.GITHUB_TOKEN || '',
    owner: process.env.GITHUB_OWNER || '',
    repo: process.env.GITHUB_REPO || 'lucid-agent',
    enabled: !!process.env.GITHUB_TOKEN && !!process.env.GITHUB_OWNER,
  },

  // Library Context
  library: {
    contextEntries: parseInt(process.env.LIBRARY_CONTEXT_ENTRIES || '3', 10),
    contextInterval: parseInt(process.env.LIBRARY_CONTEXT_INTERVAL || '5', 10),
    recentEntries: parseInt(process.env.RECENT_LIBRARY_ENTRIES || '5', 10),
  },

  // Feature Flags
  features: {
    autonomousAgents: process.env.ENABLE_AUTONOMOUS_AGENTS === 'true',
    webResearch: process.env.ENABLE_WEB_RESEARCH === 'true',
    dreams: process.env.ENABLE_DREAMS === 'true',
    selfReview: process.env.ENABLE_SELF_REVIEW === 'true',
  },

  // Dispatch (push notification relay — handles APNs delivery internally)
  dispatch: {
    apiUrl: process.env.DISPATCH_API_URL || '',
    appKey: process.env.DISPATCH_APP_KEY || '',
    senderId: process.env.DISPATCH_SENDER_ID || '',
    enabled: !!process.env.DISPATCH_API_URL && !!process.env.DISPATCH_APP_KEY && !!process.env.DISPATCH_SENDER_ID,
  },
} as const;

// Validation
export function validateConfig(): void {
  const errors: string[] = [];

  if (!config.supabase.url) errors.push('SUPABASE_URL is required');
  if (!config.supabase.serviceKey) errors.push('SUPABASE_SERVICE_KEY is required');
  if (!config.databaseUrl) errors.push('DATABASE_URL is required');
  if (!config.anthropic.apiKey && process.env.USE_CLAUDE_CLI !== 'true')
    errors.push('ANTHROPIC_API_KEY is required (or set USE_CLAUDE_CLI=true for Max-plan CLI transport)');
  if (!config.openai.apiKey) errors.push('OPENAI_API_KEY is required');
  // STUDIO_APP_KEY is optional - only needed for session validation

  // Fail closed on auth: refuse to boot unauthenticated rather than silently
  // serving every route open. The escape hatch is explicit and must be a
  // deliberate act, not the consequence of a forgotten variable.
  if (!config.auth.apiToken && !config.auth.allowUnauthenticated) {
    errors.push(
      'LUCID_API_TOKEN is required (the API would otherwise serve every route ' +
        'unauthenticated). Generate one with `openssl rand -hex 32`, or set ' +
        'ALLOW_UNAUTHENTICATED=true for local development.'
    );
  }

  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n${errors.join('\n')}`);
  }
}

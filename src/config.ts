import dotenv from 'dotenv';

dotenv.config();

export const config = {
  // Server
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

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
    model: process.env.ANTHROPIC_MODEL || 'claude-opus-4-5-20251101',
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

  // Feature Flags
  features: {
    autonomousAgents: process.env.ENABLE_AUTONOMOUS_AGENTS === 'true',
    webResearch: process.env.ENABLE_WEB_RESEARCH === 'true',
    dreams: process.env.ENABLE_DREAMS === 'true',
  },
} as const;

// Validation
export function validateConfig(): void {
  const errors: string[] = [];

  if (!config.supabase.url) errors.push('SUPABASE_URL is required');
  if (!config.supabase.serviceKey) errors.push('SUPABASE_SERVICE_KEY is required');
  if (!config.databaseUrl) errors.push('DATABASE_URL is required');
  if (!config.anthropic.apiKey) errors.push('ANTHROPIC_API_KEY is required');
  if (!config.openai.apiKey) errors.push('OPENAI_API_KEY is required');
  // STUDIO_APP_KEY is optional - only needed for session validation

  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n${errors.join('\n')}`);
  }
}

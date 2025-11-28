/**
 * Lucid Profile System
 *
 * Defines modular configurations for different applications
 * Each profile can enable/disable features and customize behavior
 */

export interface LucidProfile {
  id: string;
  name: string;
  description: string;

  // Feature toggles
  features: {
    emotionalIntelligence: boolean;
    personalityTracking: boolean;
    memorySystem: boolean;
    autonomousAgents: boolean;
    webResearch: boolean;
    semanticSearch: boolean;
  };

  // Emotional intelligence settings (if enabled)
  emotionalIntelligence?: {
    trackBigFive: boolean;
    detectEmotionalStates: boolean;
    adaptBehavior: boolean;
    modifyTemperature: boolean;
    adjustSchedule: boolean;
  };

  // Agent configuration
  agents?: {
    enabled: boolean;
    types: AgentConfiguration[];
    pollInterval: number; // How often to check for due jobs (seconds)
  };

  // Research configuration
  research?: {
    enabled: boolean;
    executionInterval: number; // How often to process tasks (seconds)
    maxTasksPerCycle: number;
    defaultSearchDepth: 'basic' | 'advanced';
    autoCreateTasks: boolean; // Should agents auto-create research tasks?
  };

  // Memory settings
  memory?: {
    factExtraction: boolean;
    evidenceTracking: boolean;
    summaryGeneration: boolean;
    confidenceThreshold: number; // Min confidence to store facts
    maxContextFacts: number; // How many facts to include in chat context
  };

  // Chat behavior
  chat?: {
    includeAutonomousThoughts: boolean;
    includeEmotionalContext: boolean;
    includeFacts: boolean;
    maxThoughtsInContext: number;
    defaultTemperature: number;
    defaultModel: string;
    // Brevity controls (LUCID principle: 50-150 words for chat)
    maxTokens: number; // API max_tokens (~250 for 150 words)
    maxResponseWords: number; // Programmatic word limit enforcement
    // Deep thinking controls
    forceDeepThinking: boolean; // Bypass complexity assessment, always generate Library entries
  };
}

export interface AgentConfiguration {
  type: string; // e.g., 'morning_reflection', 'news_digest', 'decision_analyst'
  enabled: boolean;
  schedule: string; // Cron expression
  priority: number;
  config?: Record<string, any>; // Agent-specific settings
}

// ============================================================================
// Pre-defined Profiles
// ============================================================================

/**
 * Full Lucid Profile
 * Everything enabled - maximum intelligence
 */
export const FULL_LUCID_PROFILE: LucidProfile = {
  id: 'full-lucid',
  name: 'Full Lucid',
  description: 'Complete autonomous AI with emotional intelligence, memory, and research',

  features: {
    emotionalIntelligence: true,
    personalityTracking: true,
    memorySystem: true,
    autonomousAgents: true,
    webResearch: true,
    semanticSearch: true,
  },

  emotionalIntelligence: {
    trackBigFive: true,
    detectEmotionalStates: true,
    adaptBehavior: true,
    modifyTemperature: true,
    adjustSchedule: true,
  },

  agents: {
    enabled: true,
    pollInterval: 60, // Check every minute
    types: [
      {
        type: 'morning_reflection',
        enabled: true,
        schedule: '0 7 * * *',
        priority: 5,
      },
      {
        type: 'midday_curiosity',
        enabled: true,
        schedule: '0 12 * * *',
        priority: 7,
      },
      {
        type: 'evening_consolidation',
        enabled: true,
        schedule: '0 20 * * *',
        priority: 6,
      },
      {
        type: 'night_dream',
        enabled: true,
        schedule: '0 2 * * *',
        priority: 4,
      },
    ],
  },

  research: {
    enabled: true,
    executionInterval: 300, // Every 5 minutes
    maxTasksPerCycle: 3,
    defaultSearchDepth: 'basic',
    autoCreateTasks: true,
  },

  memory: {
    factExtraction: true,
    evidenceTracking: true,
    summaryGeneration: true,
    confidenceThreshold: 0.5,
    maxContextFacts: 20,
  },

  chat: {
    includeAutonomousThoughts: true,
    includeEmotionalContext: true,
    includeFacts: true,
    maxThoughtsInContext: 5,
    defaultTemperature: 0.7,
    defaultModel: 'claude-sonnet-4-5-20250929',
    maxTokens: 250,
    maxResponseWords: 150,
    forceDeepThinking: false,
  },
};

/**
 * Dev Lucid Profile
 * For development/testing - forces deep thinking on every message
 * Library entries are always created regardless of message complexity
 */
export const DEV_LUCID_PROFILE: LucidProfile = {
  id: 'dev-lucid',
  name: 'Dev Lucid',
  description: 'Development profile with forced deep thinking on every turn',

  features: {
    emotionalIntelligence: true,
    personalityTracking: true,
    memorySystem: true,
    autonomousAgents: true,
    webResearch: true,
    semanticSearch: true,
  },

  emotionalIntelligence: {
    trackBigFive: true,
    detectEmotionalStates: true,
    adaptBehavior: true,
    modifyTemperature: true,
    adjustSchedule: true,
  },

  agents: {
    enabled: true,
    pollInterval: 60,
    types: [
      {
        type: 'morning_reflection',
        enabled: true,
        schedule: '0 7 * * *',
        priority: 5,
      },
      {
        type: 'midday_curiosity',
        enabled: true,
        schedule: '0 12 * * *',
        priority: 7,
      },
      {
        type: 'evening_consolidation',
        enabled: true,
        schedule: '0 20 * * *',
        priority: 6,
      },
      {
        type: 'night_dream',
        enabled: true,
        schedule: '0 2 * * *',
        priority: 4,
      },
    ],
  },

  research: {
    enabled: true,
    executionInterval: 300,
    maxTasksPerCycle: 3,
    defaultSearchDepth: 'basic',
    autoCreateTasks: true,
  },

  memory: {
    factExtraction: true,
    evidenceTracking: true,
    summaryGeneration: true,
    confidenceThreshold: 0.5,
    maxContextFacts: 20,
  },

  chat: {
    includeAutonomousThoughts: true,
    includeEmotionalContext: true,
    includeFacts: true,
    maxThoughtsInContext: 5,
    defaultTemperature: 0.7,
    defaultModel: 'claude-sonnet-4-5-20250929',
    maxTokens: 250,
    maxResponseWords: 150,
    forceDeepThinking: true, // KEY: Always generate Library entries
  },
};

/**
 * Decision Assistant Profile
 * For multi-agent decision making
 */
export const DECISION_ASSISTANT_PROFILE: LucidProfile = {
  id: 'decision-assistant',
  name: 'Decision Assistant',
  description: 'Multi-agent decision making with research and pattern learning',

  features: {
    emotionalIntelligence: false, // Don't need emotional tracking for decisions
    personalityTracking: false,
    memorySystem: true, // Track decision patterns
    autonomousAgents: true, // Decision analysis agents
    webResearch: true, // Research to support arguments
    semanticSearch: false,
  },

  agents: {
    enabled: true,
    pollInterval: 30, // Check more frequently for decision requests
    types: [
      {
        type: 'cost_analyzer',
        enabled: true,
        schedule: 'on-demand', // Triggered by decision creation
        priority: 8,
      },
      {
        type: 'risk_analyzer',
        enabled: true,
        schedule: 'on-demand',
        priority: 9,
      },
      {
        type: 'impact_analyzer',
        enabled: true,
        schedule: 'on-demand',
        priority: 7,
      },
      {
        type: 'values_analyzer',
        enabled: true,
        schedule: 'on-demand',
        priority: 6,
      },
    ],
  },

  research: {
    enabled: true,
    executionInterval: 60, // Check every minute for decision research
    maxTasksPerCycle: 5, // Process more tasks for decisions
    defaultSearchDepth: 'advanced', // Deep research for decisions
    autoCreateTasks: false, // Only create when decision analysis needs it
  },

  memory: {
    factExtraction: true, // Learn decision patterns
    evidenceTracking: false,
    summaryGeneration: false,
    confidenceThreshold: 0.6,
    maxContextFacts: 10,
  },

  chat: {
    includeAutonomousThoughts: false,
    includeEmotionalContext: false,
    includeFacts: true, // Include learned decision patterns
    maxThoughtsInContext: 0,
    defaultTemperature: 0.3, // More analytical
    defaultModel: 'claude-sonnet-4-5-20250929',
    maxTokens: 250,
    maxResponseWords: 150,
    forceDeepThinking: false,
  },
};

/**
 * News Digest Profile
 * Deep dive news research and analysis
 */
export const NEWS_DIGEST_PROFILE: LucidProfile = {
  id: 'news-digest',
  name: 'News Digest',
  description: 'Autonomous news monitoring, research, and personalized digests',

  features: {
    emotionalIntelligence: false,
    personalityTracking: false,
    memorySystem: true, // Remember topics of interest
    autonomousAgents: true,
    webResearch: true, // Core feature for news
    semanticSearch: true, // Find related news
  },

  agents: {
    enabled: true,
    pollInterval: 60,
    types: [
      {
        type: 'morning_news_digest',
        enabled: true,
        schedule: '0 7 * * *', // Morning briefing
        priority: 9,
        config: {
          categories: ['tech', 'business', 'science'],
          maxStories: 10,
        },
      },
      {
        type: 'breaking_news_monitor',
        enabled: true,
        schedule: '*/30 * * * *', // Every 30 minutes
        priority: 10,
        config: {
          alertThreshold: 'high-importance',
        },
      },
      {
        type: 'deep_dive_researcher',
        enabled: true,
        schedule: '0 12 * * *', // Midday deep dive
        priority: 7,
        config: {
          maxTopics: 3,
          researchDepth: 'comprehensive',
        },
      },
      {
        type: 'evening_synthesis',
        enabled: true,
        schedule: '0 20 * * *', // Evening summary
        priority: 6,
      },
    ],
  },

  research: {
    enabled: true,
    executionInterval: 120, // Every 2 minutes (frequent for news)
    maxTasksPerCycle: 10, // Process many news items
    defaultSearchDepth: 'advanced',
    autoCreateTasks: true, // Agents create research for interesting stories
  },

  memory: {
    factExtraction: true, // Track topics of interest
    evidenceTracking: false,
    summaryGeneration: true, // Summarize news stories
    confidenceThreshold: 0.7,
    maxContextFacts: 30, // More context for news
  },

  chat: {
    includeAutonomousThoughts: true, // Include news insights
    includeEmotionalContext: false,
    includeFacts: true, // Topics of interest
    maxThoughtsInContext: 10, // More news insights
    defaultTemperature: 0.5,
    defaultModel: 'claude-sonnet-4-5-20250929',
    maxTokens: 250,
    maxResponseWords: 150,
    forceDeepThinking: false,
  },
};

/**
 * Simple Chat Profile
 * Basic conversational AI without autonomy
 */
export const SIMPLE_CHAT_PROFILE: LucidProfile = {
  id: 'simple-chat',
  name: 'Simple Chat',
  description: 'Basic conversational AI without autonomous features',

  features: {
    emotionalIntelligence: false,
    personalityTracking: false,
    memorySystem: true, // Basic memory only
    autonomousAgents: false,
    webResearch: false,
    semanticSearch: false,
  },

  memory: {
    factExtraction: true,
    evidenceTracking: false,
    summaryGeneration: false,
    confidenceThreshold: 0.7,
    maxContextFacts: 10,
  },

  chat: {
    includeAutonomousThoughts: false,
    includeEmotionalContext: false,
    includeFacts: true,
    maxThoughtsInContext: 0,
    defaultTemperature: 0.7,
    defaultModel: 'claude-sonnet-4-5-20250929',
    maxTokens: 250,
    maxResponseWords: 150,
    forceDeepThinking: false,
  },
};

/**
 * Custom Profile Template
 * For building your own configuration
 */
export const CUSTOM_PROFILE_TEMPLATE: LucidProfile = {
  id: 'custom',
  name: 'Custom Profile',
  description: 'Customize all settings',

  features: {
    emotionalIntelligence: false,
    personalityTracking: false,
    memorySystem: true,
    autonomousAgents: false,
    webResearch: false,
    semanticSearch: false,
  },

  chat: {
    includeAutonomousThoughts: false,
    includeEmotionalContext: false,
    includeFacts: true,
    maxThoughtsInContext: 5,
    defaultTemperature: 0.7,
    defaultModel: 'claude-sonnet-4-5-20250929',
    maxTokens: 250,
    maxResponseWords: 150,
    forceDeepThinking: false,
  },
};

// ============================================================================
// Profile Registry
// ============================================================================

export const AVAILABLE_PROFILES: Record<string, LucidProfile> = {
  'full-lucid': FULL_LUCID_PROFILE,
  'dev-lucid': DEV_LUCID_PROFILE,
  'decision-assistant': DECISION_ASSISTANT_PROFILE,
  'news-digest': NEWS_DIGEST_PROFILE,
  'simple-chat': SIMPLE_CHAT_PROFILE,
};

export function getProfile(id: string): LucidProfile | null {
  return AVAILABLE_PROFILES[id] || null;
}

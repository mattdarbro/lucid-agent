// Database types matching schema.sql

export interface User {
  id: string;
  external_id: string;
  created_at: Date;
  updated_at: Date;
  timezone: string;
  metadata: Record<string, any>;
}

export interface Conversation {
  id: string;
  user_id: string;
  title: string | null;
  started_at: Date;
  ended_at: Date | null;
  is_active: boolean;
  message_count: number;
  metadata: Record<string, any>;
}

export interface Message {
  id: string;
  conversation_id: string;
  user_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: Date;
  token_count: number | null;
  model: string | null;
  metadata: Record<string, any>;
  embedding: number[] | null;
}

export interface Fact {
  id: string;
  user_id: string;
  category: string | null;
  fact_text: string;
  confidence: number;
  evidence_count: number;
  first_observed_at: Date;
  last_observed_at: Date;
  is_active: boolean;
  metadata: Record<string, any>;
  embedding: number[] | null;
}

export interface Evidence {
  id: string;
  fact_id: string;
  message_id: string | null;
  evidence_text: string;
  evidence_type: 'statement' | 'behavior' | 'preference' | 'correction';
  strength: number;
  observed_at: Date;
  metadata: Record<string, any>;
}

export interface Summary {
  id: string;
  conversation_id: string;
  user_id: string;
  summary_type: 'user_perspective' | 'model_perspective' | 'conversation_overview';
  content: string;
  created_at: Date;
  message_range_start: number | null;
  message_range_end: number | null;
  metadata: Record<string, any>;
  embedding: number[] | null;
}

export interface PersonalitySnapshot {
  id: string;
  user_id: string;
  openness: number | null;
  conscientiousness: number | null;
  extraversion: number | null;
  agreeableness: number | null;
  neuroticism: number | null;
  confidence: number;
  snapshot_at: Date;
  sample_size: number;
  reasoning: string | null;
  metadata: Record<string, any>;
}

export interface AutonomousThought {
  id: string;
  user_id: string;
  thought_type: 'dream' | 'reflection' | 'curiosity' | 'insight' | 'question';
  circadian_phase: 'morning' | 'midday' | 'evening' | 'night' | null;
  content: string;
  trigger_type: 'scheduled' | 'pattern_detected' | 'user_mention' | 'memory_consolidation' | null;
  trigger_data: Record<string, any> | null;
  created_at: Date;
  shared_with_user: boolean;
  shared_at: Date | null;
  importance: number;
  metadata: Record<string, any>;
  embedding: number[] | null;
}

export interface ResearchTask {
  id: string;
  user_id: string;
  query: string;
  reason: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  results: Record<string, any> | null;
  summary: string | null;
  derived_facts: string[] | null;
  metadata: Record<string, any>;
}

export interface AgentJob {
  id: string;
  user_id: string;
  job_type: 'morning_reflection' | 'midday_curiosity' | 'evening_consolidation' | 'night_dream';
  status: 'pending' | 'running' | 'completed' | 'failed';
  scheduled_for: Date;
  started_at: Date | null;
  completed_at: Date | null;
  output: Record<string, any> | null;
  error: string | null;
  metadata: Record<string, any>;
}

// View types
export interface ActiveUserFact {
  user_id: string;
  fact_id: string;
  category: string | null;
  fact_text: string;
  confidence: number;
  evidence_count: number;
  first_observed_at: Date;
  last_observed_at: Date;
  total_evidence: number;
}

export interface UserPersonalityLatest {
  user_id: string;
  openness: number | null;
  conscientiousness: number | null;
  extraversion: number | null;
  agreeableness: number | null;
  neuroticism: number | null;
  confidence: number;
  snapshot_at: Date;
}

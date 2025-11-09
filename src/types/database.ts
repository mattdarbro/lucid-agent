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
  // Adaptive context fields
  time_of_day: 'early_morning' | 'morning' | 'afternoon' | 'evening' | 'night' | 'late_night' | null;
  user_timezone: string | null;
  emotional_state_id: string | null;
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
  conversation_id: string | null;
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
  assessment_reasoning: string | null;
  message_count: number | null;
  created_at: Date;
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

// ============================================================================
// ADAPTIVE CONTEXT TABLES (for emotional intelligence)
// ============================================================================

export interface PersonalityStatistics {
  id: string;
  user_id: string;
  // Running averages
  avg_openness: number;
  avg_conscientiousness: number;
  avg_extraversion: number;
  avg_agreeableness: number;
  avg_neuroticism: number;
  // Standard deviations
  std_openness: number;
  std_conscientiousness: number;
  std_extraversion: number;
  std_agreeableness: number;
  std_neuroticism: number;
  // Metadata
  sample_size: number;
  window_days: number;
  last_updated: Date;
  created_at: Date;
}

export interface EmotionalState {
  id: string;
  user_id: string;
  conversation_id: string | null;
  // State details
  state_type: 'struggling' | 'energized' | 'withdrawn' | 'reflective' | 'stable';
  confidence: number;
  // Detection details
  trigger_type: 'personality_shift' | 'conversation_pattern' | 'time_pattern' | 'topic_analysis';
  indicators: Record<string, any>;
  // Duration
  detected_at: Date;
  resolved_at: Date | null;
  // Response strategy
  recommended_approach: 'gentle' | 'supportive' | 'exploratory' | 'analytical' | 'minimal' | null;
  created_at: Date;
}

export interface ContextAdaptation {
  id: string;
  user_id: string;
  emotional_state_id: string | null;
  // Schedule adjustments
  morning_schedule: string | null;
  midday_schedule: string | null;
  evening_schedule: string | null;
  night_schedule: string | null;
  // Prompt adjustments
  temperature_modifier: number;
  tone_directive: string | null;
  // Research strategy
  curiosity_approach: 'gentle' | 'exploratory' | 'supportive' | 'analytical' | 'minimal' | null;
  research_topics: string[] | null;
  research_avoidance: string[] | null;
  research_priority: number;
  // Reasoning
  adaptation_reasoning: string | null;
  // Validity period
  active_from: Date;
  active_until: Date | null;
  created_at: Date;
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

// ============================================================================
// ADAPTIVE CONTEXT VIEWS
// ============================================================================

export interface ActiveEmotionalState {
  id: string;
  user_id: string;
  conversation_id: string | null;
  state_type: 'struggling' | 'energized' | 'withdrawn' | 'reflective' | 'stable';
  confidence: number;
  trigger_type: 'personality_shift' | 'conversation_pattern' | 'time_pattern' | 'topic_analysis';
  indicators: Record<string, any>;
  detected_at: Date;
  resolved_at: Date | null;
  recommended_approach: 'gentle' | 'supportive' | 'exploratory' | 'analytical' | 'minimal' | null;
  created_at: Date;
  user_name: string | null;
  hours_active: number;
}

export interface CurrentAdaptation {
  id: string;
  user_id: string;
  emotional_state_id: string | null;
  morning_schedule: string | null;
  midday_schedule: string | null;
  evening_schedule: string | null;
  night_schedule: string | null;
  temperature_modifier: number;
  tone_directive: string | null;
  curiosity_approach: 'gentle' | 'exploratory' | 'supportive' | 'analytical' | 'minimal' | null;
  research_topics: string[] | null;
  research_avoidance: string[] | null;
  research_priority: number;
  adaptation_reasoning: string | null;
  active_from: Date;
  active_until: Date | null;
  created_at: Date;
  state_type: string | null;
  state_confidence: number | null;
  user_name: string | null;
}

export interface PersonalityOverview {
  id: string;
  user_id: string;
  conversation_id: string | null;
  // Current values
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
  // Baselines
  avg_openness: number;
  avg_conscientiousness: number;
  avg_extraversion: number;
  avg_agreeableness: number;
  avg_neuroticism: number;
  // Deltas (current - baseline)
  openness_delta: number;
  conscientiousness_delta: number;
  extraversion_delta: number;
  agreeableness_delta: number;
  neuroticism_delta: number;
  assessment_reasoning: string | null;
  message_count: number | null;
  created_at: Date;
}

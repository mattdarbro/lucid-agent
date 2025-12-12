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
  agent_job_id: string | null;
  content: string;
  thought_type: 'dream' | 'reflection' | 'curiosity' | 'insight' | 'question' | 'consolidation';
  circadian_phase: 'morning' | 'midday' | 'evening' | 'night' | null;
  generated_at_time: string | null;
  importance_score: number | null;
  is_shared: boolean;
  shared_at: Date | null;
  embedding: number[] | null;
  created_at: Date;
}

export interface ResearchTask {
  id: string;
  user_id: string;
  emotional_state_id: string | null;
  query: string;
  purpose: string | null;
  approach: 'gentle' | 'exploratory' | 'supportive' | 'analytical';
  priority: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  results: Record<string, any> | null;
  derived_facts: string[] | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

export type AgentJobType =
  | 'morning_reflection'
  | 'midday_curiosity'
  | 'evening_consolidation'
  | 'night_dream'
  // Specialized AT Session Types (layered memory system)
  | 'morning_curiosity_session'
  | 'dream_session'
  | 'state_session'
  | 'orbit_session';

export interface AgentJob {
  id: string;
  user_id: string;
  job_type: AgentJobType;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  scheduled_for: Date;
  thoughts_generated: number;
  research_tasks_created: number;
  error_message: string | null;
  session_metadata: Record<string, any>;
  library_entry_id: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
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

// ============================================================================
// LAYERED MEMORY SYSTEM
// ============================================================================

export interface MattState {
  id: string;
  user_id: string;
  // Current state snapshot
  active_goals: MattStateGoal[];
  active_commitments: MattStateCommitment[];
  resources: MattStateResources;
  constraints: MattStateConstraints;
  values_priorities: MattStateValues;
  // Metadata
  confidence: number;
  last_updated_by: 'user' | 'state_session' | 'conversation' | null;
  // Timestamps
  created_at: Date;
  updated_at: Date;
}

export interface MattStateGoal {
  goal: string;
  timeline?: string;
  progress?: string;
}

export interface MattStateCommitment {
  commitment: string;
  frequency?: string;
  impact?: string;
}

export interface MattStateResources {
  time_budget?: string;
  financial_runway?: string;
  skills?: string[];
  support?: string[];
}

export interface MattStateConstraints {
  api_costs?: string;
  technical_debt?: string[];
  health?: string;
  other?: string[];
}

export interface MattStateValues {
  top_values?: string[];
  current_focus?: string;
}

export interface MattStateHistory {
  id: string;
  user_id: string;
  state_snapshot: Record<string, any>;
  changes_summary: string | null;
  updated_by: string | null;
  created_at: Date;
}

export interface LucidState {
  id: string;
  user_id: string;
  // Self-awareness
  current_understanding: Record<string, any>;
  confidence_levels: Record<string, number>;
  areas_needing_witnessing: string[];
  evolution_notes: string | null;
  // Current focus
  active_questions: string[];
  recent_insights: string[];
  // Timestamps
  created_at: Date;
  updated_at: Date;
}

export interface Orbit {
  id: string;
  user_id: string;
  // Person identity
  person_name: string;
  relationship: string | null;
  // Their state
  current_situation: Record<string, any>;
  recent_interactions: Record<string, any>[];
  // User's perspective
  how_this_affects_user: string | null;
  last_discussed_at: Date | null;
  // Orbit tier
  orbit_tier: 'inner' | 'mid' | 'outer';
  // Status
  is_active: boolean;
  // Timestamps
  first_mentioned_at: Date;
  last_mentioned_at: Date;
  created_at: Date;
  updated_at: Date;
}

// ============================================================================
// SPECIALIZED AT SESSION TYPES
// ============================================================================

export type SpecializedSessionType =
  | 'morning_curiosity'
  | 'dream_session'
  | 'state_session'
  | 'orbit_session';

export type LibraryEntryType =
  | 'lucid_thought'
  | 'user_reflection'
  | 'journal'
  | 'reflection'
  | 'curiosity'
  | 'dream'
  | 'consolidation'
  | 'state_update'
  | 'orbit_update'
  | 'deep_thought';

export interface LibraryEntry {
  id: string;
  user_id: string;
  entry_type: LibraryEntryType;
  title: string | null;
  content: string;
  time_of_day: 'morning' | 'afternoon' | 'evening' | 'night' | null;
  related_conversation_id: string | null;
  metadata: Record<string, any>;
  session_type: SpecializedSessionType | null;
  session_metadata: Record<string, any>;
  is_shared: boolean;
  embedding: number[] | null;
  created_at: Date;
  updated_at: Date;
}

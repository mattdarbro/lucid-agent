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
  thought_type: 'dream' | 'reflection' | 'curiosity' | 'insight' | 'question' | 'consolidation' | 'synthesis';
  circadian_phase: 'morning' | 'midday' | 'afternoon' | 'evening' | 'night' | null;
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
  | 'afternoon_synthesis'
  | 'evening_consolidation'
  | 'night_dream'
  // Specialized AT Session Types (layered memory system)
  | 'morning_curiosity_session'
  | 'dream_session'
  | 'state_session'
  | 'orbit_session'
  | 'document_reflection'
  | 'self_review'
  | 'investment_research'
  | 'ability_spending'
  | 'health_check_morning'
  | 'health_check_evening';

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

// ============================================================================
// SEEDS, CALENDAR, AND PEOPLE ENTITIES
// ============================================================================

export interface Person {
  id: string;
  user_id: string;
  // Identity
  name: string;
  nickname: string | null;
  // Relationship
  relationship_type: 'family' | 'friend' | 'colleague' | 'acquaintance' | 'professional' | null;
  relationship_detail: string | null;
  context: string | null;
  // Contact
  email: string | null;
  phone: string | null;
  // Tracking
  mention_count: number;
  first_mentioned_at: Date;
  last_mentioned_at: Date;
  // Sentiment
  sentiment: 'positive' | 'neutral' | 'complicated' | 'negative';
  importance_score: number;
  // Vector
  embedding: number[] | null;
  // Metadata
  metadata: Record<string, any>;
  // Timestamps
  created_at: Date;
  updated_at: Date;
}

/**
 * Seed - A simplified capture that grows over time
 * No classification logic - just stores what the user plants
 */
export type SeedStatus = 'held' | 'growing' | 'grown' | 'released';
export type SeedSource = 'app' | 'voice' | 'share';
export type SeedType = 'thought' | 'investment_recommendation' | 'trade_execution' | 'portfolio_update';

export interface Seed {
  id: string;
  user_id: string;
  // Content
  content: string;
  // Type
  seed_type: SeedType;
  // Source
  source: SeedSource;
  source_metadata: Record<string, any>;
  // Status
  status: SeedStatus;
  // Context when planted
  planted_context: string | null;
  // Surfacing tracking
  last_surfaced_at: Date | null;
  surface_count: number;
  // Growth tracking
  grown_into_library_id: string | null;
  released_at: Date | null;
  // Vector
  embedding: number[] | null;
  // Timestamps
  planted_at: Date;
  updated_at: Date;
}

/**
 * Structured investment recommendation data stored in source_metadata
 */
export interface InvestmentRecommendationData {
  symbol: string;
  action: 'buy' | 'sell' | 'hold';
  limit_price: number;
  stop_loss: number;
  price_target: number;
  position_size_dollars: number;
  hold_period: string;
  reasoning: string;
  risk_notes: string;
  exit_plan: string;
  data_sources: {
    alpha_vantage: boolean;
    grok: boolean;
    web_search: boolean;
  };
}

/**
 * Trade execution data stored in source_metadata when Matt records a trade
 */
export interface TradeExecutionData {
  symbol: string;
  action: 'buy' | 'sell';
  shares: number;
  price: number;
  total_cost: number;
  executed_at: string;
  recommendation_seed_id?: string;
  notes?: string;
}

export interface CalendarEvent {
  id: string;
  user_id: string;
  // iOS sync
  external_id: string | null;
  external_calendar_id: string | null;
  calendar_name: string | null;
  // Event details
  title: string;
  description: string | null;
  location: string | null;
  // Timing
  start_time: Date;
  end_time: Date;
  is_all_day: boolean;
  timezone: string | null;
  // Recurrence
  is_recurring: boolean;
  recurrence_rule: string | null;
  recurrence_end_date: Date | null;
  // Attendees
  attendee_ids: string[] | null;
  attendee_names: string[] | null;
  // Lucid integration
  source: 'ios_sync' | 'lucid_scheduled' | 'user_created';
  source_capture_id: string | null;
  lucid_prep_notes: string | null;
  lucid_follow_up: string | null;
  // Status
  status: 'tentative' | 'confirmed' | 'cancelled';
  sync_status: 'synced' | 'pending_push' | 'pending_delete' | 'conflict';
  // Timestamps
  last_synced_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface PersonFact {
  id: string;
  person_id: string;
  fact_id: string;
  created_at: Date;
}

// ============================================================================
// SEEDS, CALENDAR, AND PEOPLE VIEWS
// ============================================================================

export interface ActiveSeed extends Seed {
  // Active seeds view - seeds that are held or growing
}

export interface TodaysScheduleEvent extends CalendarEvent {
  attendee_display_names: string[] | null;
}

export interface ImportantPerson extends Person {
  open_seeds_count: number;
  upcoming_events_count: number;
}

// ============================================================================
// ORIGINAL VIEW TYPES
// ============================================================================

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
// HEALTH METRICS (Apple HealthKit / Oura Ring / Manual)
// ============================================================================

export type HealthMetricType =
  | 'blood_pressure_systolic'
  | 'blood_pressure_diastolic'
  | 'weight'
  | 'steps'
  | 'heart_rate'
  | 'resting_heart_rate'
  | 'blood_oxygen'
  | 'respiratory_rate'
  | 'body_temperature'
  | 'sleep_duration'
  | 'active_energy'
  | 'exercise_minutes';

export type HealthMetricSource = 'apple_health' | 'oura_ring' | 'manual' | 'withings';

export interface HealthMetric {
  id: string;
  user_id: string;
  metric_type: HealthMetricType;
  value: number;
  unit: string;
  recorded_at: Date;
  source: HealthMetricSource;
  source_device: string | null;
  metadata: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

/** A single HealthKit sample for a cumulative metric (steps, energy, exercise). */
export interface ActivitySample {
  value: number;
  recorded_at: Date;
}

/**
 * A day's health summary assembled from individual metrics.
 * Used by the health check loops to give Lucid a daily snapshot.
 *
 * For cumulative metrics (steps, active_energy, exercise_minutes) the iOS app
 * now sends both a daily_total record AND individual samples.  The `value`
 * field always holds the authoritative daily total; the optional `samples`
 * array carries the individual HealthKit readings so Lucid can reason about
 * time-of-day activity patterns.
 */
export interface DailyHealthSummary {
  date: string; // YYYY-MM-DD
  blood_pressure?: { systolic: number; diastolic: number; recorded_at: Date };
  weight?: { value: number; unit: string; recorded_at: Date };
  steps?: { value: number; recorded_at: Date; samples?: ActivitySample[] };
  heart_rate?: { avg: number; min: number; max: number };
  resting_heart_rate?: { value: number; recorded_at: Date };
  sleep_duration?: { hours: number; recorded_at: Date };
  active_energy?: { value: number; unit: string; samples?: ActivitySample[] };
  exercise_minutes?: { value: number; samples?: ActivitySample[] };
}

// ============================================================================
// ACTIONS SYSTEM
// ============================================================================

export type ActionStatus = 'open' | 'done' | 'cancelled';
export type ActionSource = 'capture' | 'conversation' | 'briefing';

export interface Action {
  id: string;
  user_id: string;
  // Content
  content: string;
  summary: string | null;
  // Status
  status: ActionStatus;
  // Optional person link
  person_id: string | null;
  // Source tracking
  source: ActionSource;
  // Timestamps
  created_at: Date;
  completed_at: Date | null;
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
  | 'lucid_self_reflection'  // Lucid thinking about himself
  | 'orbit_reflection'       // Thinking about someone in orbits
  | 'vision_appraisal'       // Dream/vision/goal exploration
  | 'possibility_map'        // Branching alternatives when stuck
  | 'possibilities'          // Possibility thinking results
  | 'versus_synthesis'       // Versus comparison synthesis
  | 'user_reflection'
  | 'journal'
  | 'reflection'
  | 'curiosity'
  | 'dream'
  | 'consolidation'
  | 'state_update'
  | 'orbit_update'
  | 'deep_thought'
  // Simplified design types (Phase 1-2)
  | 'briefing'               // Morning/weekly briefings from AL
  | 'insight'                // Ideas captured via Capture system
  | 'research_journal'       // Research findings from autonomous research executor
  | 'win'                    // User wins/breakthroughs
  | 'code_review'            // Self-review findings and PR summaries
  | 'investment_recommendation'  // Investment research and recommendations
  | 'spending_proposal'      // Ability spending proposals
  | 'health_review';         // Morning/evening health check-in analysis

/**
 * Subject of a thought - who/what the thought is about
 */
export type ThoughtSubject = 'user' | 'other' | 'lucid';

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

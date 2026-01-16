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
// CAPTURE, CALENDAR, AND PEOPLE ENTITIES
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

export interface Capture {
  id: string;
  user_id: string;
  // Content
  content: string;
  // Source
  source: 'app' | 'voice' | 'share_extension' | 'ios_import';
  source_metadata: Record<string, any>;
  // Status
  status: 'inbox' | 'processing' | 'processed' | 'archived' | 'deleted';
  // Lucid's interpretation
  interpreted_type: 'task' | 'idea' | 'event' | 'reminder' | 'note' | 'person_mention' | null;
  interpreted_title: string | null;
  interpreted_details: string | null;
  // Scheduling
  has_deadline: boolean;
  deadline_at: Date | null;
  preferred_time: 'morning' | 'afternoon' | 'evening' | 'weekend' | 'anytime' | null;
  estimated_duration_minutes: number | null;
  // Priority & Energy
  priority: number; // 1-5
  energy_required: 'high' | 'medium' | 'low' | null;
  // Recurrence
  is_recurring: boolean;
  recurrence_rule: string | null;
  // Links
  scheduled_event_id: string | null;
  related_person_id: string | null;
  related_capture_ids: string[] | null;
  // Completion
  is_completed: boolean;
  completed_at: Date | null;
  // Context
  context_notes: string | null;
  // Vector
  embedding: number[] | null;
  // Timestamps
  created_at: Date;
  updated_at: Date;
  processed_at: Date | null;
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

export interface CaptureProcessingLog {
  id: string;
  capture_id: string;
  action: 'classified' | 'scheduled' | 'linked_person' | 'set_priority' | 'completed';
  action_details: Record<string, any> | null;
  reasoning: string | null;
  confidence: number | null;
  created_at: Date;
}

// ============================================================================
// CAPTURE, CALENDAR, AND PEOPLE VIEWS
// ============================================================================

export interface ActiveCapture extends Capture {
  related_person_name: string | null;
  scheduled_event_title: string | null;
  scheduled_start_time: Date | null;
}

export interface TodaysScheduleEvent extends CalendarEvent {
  attendee_display_names: string[] | null;
}

export interface UpcomingDeadline extends Capture {
  related_person_name: string | null;
  hours_until_deadline: number;
}

export interface ImportantPerson extends Person {
  open_captures_count: number;
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

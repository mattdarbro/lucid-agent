-- Migration: Temporal Check-In System
-- Description: Enables multi-day collaborative thinking with strategic temporal check-ins
-- Created: 2024-01-15
-- FIXED: Corrected table creation order to resolve FK dependencies

-- ============================================================================
-- 1. CHECK-IN PREFERENCES (No FK dependencies except users)
-- User preferences for when/how to receive check-ins
-- ============================================================================

CREATE TABLE IF NOT EXISTS check_in_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

  -- Global settings
  enabled BOOLEAN DEFAULT false,
  frequency TEXT DEFAULT 'daily' CHECK (frequency IN ('multiple_daily', 'daily', 'every_2_days', 'weekly')),

  -- Time preferences
  morning_enabled BOOLEAN DEFAULT true,
  afternoon_enabled BOOLEAN DEFAULT false,
  evening_enabled BOOLEAN DEFAULT true,
  late_night_enabled BOOLEAN DEFAULT false,

  -- Specific time windows (user's local timezone)
  morning_start TIME DEFAULT '07:00',
  morning_end TIME DEFAULT '10:00',
  afternoon_start TIME DEFAULT '13:00',
  afternoon_end TIME DEFAULT '16:00',
  evening_start TIME DEFAULT '18:00',
  evening_end TIME DEFAULT '21:00',
  late_night_start TIME DEFAULT '22:00',
  late_night_end TIME DEFAULT '01:00',

  -- Quiet hours
  do_not_disturb_start TIME,
  do_not_disturb_end TIME,

  -- Topic filters
  topics JSONB DEFAULT '[]'::jsonb,
  min_priority DECIMAL(3,2) DEFAULT 0.3 CHECK (min_priority >= 0.0 AND min_priority <= 1.0),

  -- Rate limiting
  max_per_day INTEGER DEFAULT 2 CHECK (max_per_day >= 0 AND max_per_day <= 10),
  min_hours_between INTEGER DEFAULT 4 CHECK (min_hours_between >= 1 AND min_hours_between <= 24),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_check_in_preferences_user ON check_in_preferences(user_id);
CREATE INDEX idx_check_in_preferences_enabled ON check_in_preferences(enabled) WHERE enabled = true;

-- ============================================================================
-- 2. MULTI-DAY RESEARCH TASKS (No FK dependencies except users)
-- Track long-running thinking that spans multiple days
-- ============================================================================

CREATE TABLE IF NOT EXISTS multi_day_research_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Task definition
  title TEXT NOT NULL,
  description TEXT,
  topic_category TEXT,

  -- Status
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'abandoned')),

  -- Timeline
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  target_completion_date DATE,
  completed_at TIMESTAMP WITH TIME ZONE,

  -- Check-in tracking
  check_ins JSONB DEFAULT '[]'::jsonb,

  -- Synthesis
  final_synthesis TEXT,
  synthesis_created_at TIMESTAMP WITH TIME ZONE,

  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,

  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_multi_day_tasks_user_status ON multi_day_research_tasks(user_id, status);
CREATE INDEX idx_multi_day_tasks_created ON multi_day_research_tasks(created_at DESC);
CREATE INDEX idx_multi_day_tasks_topic ON multi_day_research_tasks(topic_category);

-- ============================================================================
-- 3. THOUGHT NOTIFICATIONS (NOW SAFE - references tables created above)
-- Queue of things Lucid wants to discuss with user
-- ============================================================================

CREATE TABLE IF NOT EXISTS thought_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thought_id UUID REFERENCES autonomous_thoughts(id) ON DELETE SET NULL,
  research_task_id UUID REFERENCES multi_day_research_tasks(id) ON DELETE SET NULL,

  -- What Lucid wants to say
  question TEXT NOT NULL,
  context TEXT,

  -- When to ask
  preferred_time_of_day TEXT CHECK (preferred_time_of_day IN ('morning', 'afternoon', 'evening', 'late_night', 'any')),
  preferred_cognitive_state TEXT CHECK (preferred_cognitive_state IN ('analytical', 'creative', 'reflective', 'philosophical', 'emotional', 'any')),

  -- Priority & scheduling
  priority DECIMAL(3,2) DEFAULT 0.5 CHECK (priority >= 0.0 AND priority <= 1.0),
  expires_at TIMESTAMP WITH TIME ZONE,

  -- Delivery tracking
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'responded', 'expired', 'skipped')),
  sent_at TIMESTAMP WITH TIME ZONE,
  responded_at TIMESTAMP WITH TIME ZONE,

  -- Response data
  response_text TEXT,
  response_metadata JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_thought_notifications_user_status ON thought_notifications(user_id, status);
CREATE INDEX idx_thought_notifications_sent_at ON thought_notifications(sent_at);
CREATE INDEX idx_thought_notifications_priority ON thought_notifications(priority DESC);
CREATE INDEX idx_thought_notifications_expires ON thought_notifications(expires_at) WHERE expires_at IS NOT NULL;

-- ============================================================================
-- 4. TEMPORAL STATE OBSERVATIONS
-- Research data - track user's cognitive state at different times
-- ============================================================================

CREATE TABLE IF NOT EXISTS temporal_state_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- When
  observed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  time_of_day TEXT NOT NULL CHECK (time_of_day IN ('morning', 'afternoon', 'evening', 'late_night')),
  day_of_week INTEGER CHECK (day_of_week >= 0 AND day_of_week <= 6),

  -- Context
  notification_id UUID REFERENCES thought_notifications(id) ON DELETE SET NULL,
  research_task_id UUID REFERENCES multi_day_research_tasks(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,

  -- Detected state
  cognitive_state TEXT CHECK (cognitive_state IN ('analytical', 'creative', 'reflective', 'philosophical', 'emotional')),
  confidence DECIMAL(3,2) CHECK (confidence >= 0.0 AND confidence <= 1.0),

  -- Observable signals
  response_time_seconds INTEGER,
  message_length INTEGER,
  sentiment_score DECIMAL(3,2) CHECK (sentiment_score >= -1.0 AND sentiment_score <= 1.0),
  complexity_score DECIMAL(3,2) CHECK (complexity_score >= 0.0 AND complexity_score <= 1.0),

  -- Language features
  language_features JSONB DEFAULT '{}'::jsonb,

  -- Big 5 state expression
  big5_state_expression JSONB,

  -- Self-reported
  self_reported_energy INTEGER CHECK (self_reported_energy >= 1 AND self_reported_energy <= 5),
  self_reported_mood INTEGER CHECK (self_reported_mood >= 1 AND self_reported_mood <= 5),
  self_reported_focus INTEGER CHECK (self_reported_focus >= 1 AND self_reported_focus <= 5),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_temporal_observations_user_time ON temporal_state_observations(user_id, time_of_day);
CREATE INDEX idx_temporal_observations_state ON temporal_state_observations(cognitive_state);
CREATE INDEX idx_temporal_observations_created ON temporal_state_observations(created_at DESC);
CREATE INDEX idx_temporal_observations_user_observed ON temporal_state_observations(user_id, observed_at DESC);

-- ============================================================================
-- 5. CHECK-IN SCHEDULE LOG
-- Track when notifications were sent (for rate limiting and analysis)
-- ============================================================================

CREATE TABLE IF NOT EXISTS check_in_schedule_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_id UUID REFERENCES thought_notifications(id) ON DELETE SET NULL,

  sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  time_of_day TEXT CHECK (time_of_day IN ('morning', 'afternoon', 'evening', 'late_night')),

  responded BOOLEAN DEFAULT false,
  responded_at TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_check_in_log_user_sent ON check_in_schedule_log(user_id, sent_at DESC);
CREATE INDEX idx_check_in_log_responded ON check_in_schedule_log(responded, responded_at);

-- ============================================================================
-- TRIGGERS: Update updated_at timestamp
-- ============================================================================

CREATE OR REPLACE FUNCTION update_temporal_checkin_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_thought_notifications_updated_at
  BEFORE UPDATE ON thought_notifications
  FOR EACH ROW
  EXECUTE FUNCTION update_temporal_checkin_updated_at();

CREATE TRIGGER trigger_check_in_preferences_updated_at
  BEFORE UPDATE ON check_in_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_temporal_checkin_updated_at();

CREATE TRIGGER trigger_multi_day_tasks_updated_at
  BEFORE UPDATE ON multi_day_research_tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_temporal_checkin_updated_at();

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

-- Created tables in correct order:
-- 1. check_in_preferences (no dependencies)
-- 2. multi_day_research_tasks (no dependencies)
-- 3. thought_notifications (references multi_day_research_tasks)
-- 4. temporal_state_observations (references thought_notifications & multi_day_research_tasks)
-- 5. check_in_schedule_log (references thought_notifications)

-- To rollback:
-- DROP TABLE check_in_schedule_log, temporal_state_observations, thought_notifications, multi_day_research_tasks, check_in_preferences CASCADE;

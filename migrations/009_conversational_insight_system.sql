-- Migration 009: Conversational Insight System
-- Transforms check-ins from forms into conversations
-- Adds insight generation and review capabilities
-- Tracks temporal patterns in how users engage with insights

-- ============================================================================
-- TASK CONVERSATIONS
-- Links conversations to tasks for context-aware check-ins
-- ============================================================================

CREATE TABLE IF NOT EXISTS task_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES multi_day_research_tasks(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,

  conversation_type TEXT NOT NULL, -- 'check_in', 'insight_review', 'general'

  -- For check-in conversations
  time_of_day TEXT, -- 'morning', 'afternoon', 'evening', 'late_night'
  check_in_number INTEGER,

  -- For insight review conversations
  insight_id UUID, -- Will reference task_insights (FK added after table creation)

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP, -- When conversation ended
  message_count INTEGER DEFAULT 0
);

CREATE INDEX idx_task_conversations_task ON task_conversations(task_id);
CREATE INDEX idx_task_conversations_type ON task_conversations(task_id, conversation_type);
CREATE INDEX idx_task_conversations_insight ON task_conversations(insight_id) WHERE insight_id IS NOT NULL;

-- ============================================================================
-- TASK INSIGHTS
-- AI-generated patterns that can be discussed and refined
-- ============================================================================

CREATE TABLE IF NOT EXISTS task_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES multi_day_research_tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- The insight itself
  insight_text TEXT NOT NULL,
  confidence FLOAT DEFAULT 0.5, -- 0.0-1.0

  -- Pattern detection metadata
  pattern_type TEXT, -- 'temporal_mood', 'energy_correlation', 'topic_shift', 'language_change'
  supporting_evidence JSONB, -- Links to specific check-ins/messages

  -- User validation
  user_validated BOOLEAN, -- null = not reviewed, true = agreed, false = disagreed
  user_refinement TEXT, -- User's correction/clarification from conversation

  status TEXT DEFAULT 'proposed', -- 'proposed', 'confirmed', 'rejected', 'refined'

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  reviewed_at TIMESTAMP, -- When user engaged with it

  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_task_insights_task ON task_insights(task_id);
CREATE INDEX idx_task_insights_status ON task_insights(status);
CREATE INDEX idx_task_insights_user_pending ON task_insights(user_id, status) WHERE status = 'proposed';

-- Now add the FK from task_conversations to task_insights
ALTER TABLE task_conversations
  ADD CONSTRAINT fk_task_conversations_insight
  FOREIGN KEY (insight_id) REFERENCES task_insights(id) ON DELETE CASCADE;

-- ============================================================================
-- INSIGHT INTERACTIONS
-- Tracks how users engage with insights (temporal patterns)
-- ============================================================================

CREATE TABLE IF NOT EXISTS insight_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  insight_id UUID NOT NULL REFERENCES task_insights(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- When they engaged
  reviewed_at TIMESTAMP DEFAULT NOW(),
  time_of_day TEXT, -- 'morning', 'afternoon', 'evening', 'late_night'

  -- How they responded
  action TEXT NOT NULL, -- 'viewed', 'accepted', 'rejected', 'refined', 'discussed'
  refinement_text TEXT, -- Their correction/clarification

  -- Conversation metadata (if they discussed it)
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  messages_exchanged INTEGER DEFAULT 0, -- How much discussion?

  -- Their state at time of review
  personality_snapshot JSONB, -- Big 5 scores at time of review
  energy_level INTEGER, -- 1-5
  mood INTEGER, -- 1-5

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_insight_interactions_insight ON insight_interactions(insight_id);
CREATE INDEX idx_insight_interactions_user_time ON insight_interactions(user_id, reviewed_at DESC);
CREATE INDEX idx_insight_interactions_action ON insight_interactions(action);

-- ============================================================================
-- INSIGHT RECEPTIVITY PATTERNS
-- Learns how each user prefers to engage with insights
-- ============================================================================

CREATE TABLE IF NOT EXISTS insight_receptivity_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

  -- When they engage
  preferred_review_time TEXT, -- 'morning', 'afternoon', 'evening', 'late_night'
  avg_time_to_review INTERVAL, -- How long after insight created?

  -- Acceptance patterns
  overall_acceptance_rate FLOAT,
  acceptance_by_time_of_day JSONB, -- {morning: 0.4, evening: 0.7}

  -- Challenge patterns
  challenge_rate FLOAT,
  common_objections JSONB, -- ["emotional_labels", "oversimplification"]

  -- Effective framing
  successful_phrasing_patterns TEXT[], -- Insights they accepted
  rejected_phrasing_patterns TEXT[], -- Insights they rejected

  -- Preferred evidence level
  requires_data BOOLEAN DEFAULT false, -- Show numbers
  requires_examples BOOLEAN DEFAULT false, -- Cite specific check-ins

  -- Metadata
  total_insights_reviewed INTEGER DEFAULT 0,
  last_updated TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- EXTEND EXISTING TABLES
-- ============================================================================

-- Add conversation_id to multi_day_research_tasks
ALTER TABLE multi_day_research_tasks
  ADD COLUMN IF NOT EXISTS primary_conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL;

CREATE INDEX idx_tasks_conversation ON multi_day_research_tasks(primary_conversation_id) WHERE primary_conversation_id IS NOT NULL;

-- Track conversation type and task context in conversations table
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS conversation_context TEXT, -- 'general', 'task_check_in', 'insight_review'
  ADD COLUMN IF NOT EXISTS related_task_id UUID REFERENCES multi_day_research_tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS related_insight_id UUID REFERENCES task_insights(id) ON DELETE SET NULL;

CREATE INDEX idx_conversations_context ON conversations(conversation_context);
CREATE INDEX idx_conversations_task ON conversations(related_task_id) WHERE related_task_id IS NOT NULL;

-- ============================================================================
-- VIEWS FOR EASY QUERYING
-- ============================================================================

-- Active insights needing review
CREATE OR REPLACE VIEW pending_insights AS
SELECT
  i.id,
  i.task_id,
  i.user_id,
  i.insight_text,
  i.confidence,
  i.pattern_type,
  i.created_at,
  t.title as task_title,
  t.status as task_status,
  EXTRACT(EPOCH FROM (NOW() - i.created_at)) / 3600 as hours_pending
FROM task_insights i
JOIN multi_day_research_tasks t ON i.task_id = t.id
WHERE i.status = 'proposed'
  AND i.user_validated IS NULL
ORDER BY i.created_at ASC;

-- Task conversation summary
CREATE OR REPLACE VIEW task_conversation_summary AS
SELECT
  t.id as task_id,
  t.title,
  t.user_id,
  COUNT(DISTINCT tc.conversation_id) as total_conversations,
  COUNT(DISTINCT CASE WHEN tc.conversation_type = 'check_in' THEN tc.id END) as check_in_count,
  COUNT(DISTINCT CASE WHEN tc.conversation_type = 'insight_review' THEN tc.id END) as insight_review_count,
  COUNT(DISTINCT CASE WHEN tc.conversation_type = 'general' THEN tc.id END) as general_chat_count,
  MAX(tc.created_at) as last_conversation_at
FROM multi_day_research_tasks t
LEFT JOIN task_conversations tc ON t.id = tc.task_id
GROUP BY t.id, t.title, t.user_id;

-- User insight engagement patterns
CREATE OR REPLACE VIEW user_insight_engagement AS
SELECT
  u.id as user_id,
  u.external_id,
  COUNT(DISTINCT i.id) as total_insights_generated,
  COUNT(DISTINCT CASE WHEN i.user_validated = true THEN i.id END) as insights_accepted,
  COUNT(DISTINCT CASE WHEN i.user_validated = false THEN i.id END) as insights_rejected,
  COUNT(DISTINCT CASE WHEN i.status = 'refined' THEN i.id END) as insights_refined,
  COUNT(DISTINCT CASE WHEN i.status = 'proposed' THEN i.id END) as insights_pending,
  AVG(CASE WHEN ii.reviewed_at IS NOT NULL
      THEN EXTRACT(EPOCH FROM (ii.reviewed_at - i.created_at)) / 3600
      END) as avg_hours_to_review,
  irp.preferred_review_time,
  irp.overall_acceptance_rate
FROM users u
LEFT JOIN task_insights i ON u.id = i.user_id
LEFT JOIN insight_interactions ii ON i.id = ii.insight_id AND ii.action IN ('accepted', 'rejected', 'refined')
LEFT JOIN insight_receptivity_patterns irp ON u.id = irp.user_id
GROUP BY u.id, u.external_id, irp.preferred_review_time, irp.overall_acceptance_rate;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE task_conversations IS 'Links conversations to tasks for context-aware check-ins and insight discussions';
COMMENT ON TABLE task_insights IS 'AI-generated patterns that users can discuss, validate, and refine';
COMMENT ON TABLE insight_interactions IS 'Tracks temporal patterns in how users engage with insights';
COMMENT ON TABLE insight_receptivity_patterns IS 'Learns each user''s preferred way of receiving and discussing insights';

COMMENT ON COLUMN task_insights.confidence IS 'AI confidence in this insight (0.0-1.0). Higher confidence insights presented first.';
COMMENT ON COLUMN task_insights.user_validated IS 'null = not reviewed, true = user agreed, false = user disagreed';
COMMENT ON COLUMN task_insights.supporting_evidence IS 'JSONB array of check-in IDs or message IDs that support this pattern';

COMMENT ON COLUMN insight_receptivity_patterns.preferred_review_time IS 'Time of day when user most often engages with insights';
COMMENT ON COLUMN insight_receptivity_patterns.requires_data IS 'User wants numbers/stats in insight presentation';
COMMENT ON COLUMN insight_receptivity_patterns.requires_examples IS 'User wants specific examples cited';

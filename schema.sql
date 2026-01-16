-- ============================================================================
-- Lucid Agent - Revised Database Schema
-- With Adaptive Context & Emotional Intelligence
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector"; -- for pgvector (semantic search)

-- ============================================================================
-- 1. Users
-- ============================================================================

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  external_id VARCHAR(255) UNIQUE NOT NULL, -- iOS app user ID

  -- User metadata
  name VARCHAR(255),
  email VARCHAR(255),
  timezone VARCHAR(50) DEFAULT 'UTC',

  -- Preferences
  preferences JSONB DEFAULT '{}',

  -- Push notifications
  push_token TEXT, -- Device push notification token for iOS
  push_token_updated_at TIMESTAMP,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_active_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_external_id ON users(external_id);
CREATE INDEX idx_users_last_active ON users(last_active_at);

-- ============================================================================
-- 2. User Profiles (Modular Configuration)
-- ============================================================================

CREATE TABLE user_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) NOT NULL UNIQUE,

  -- Profile selection
  profile_id VARCHAR(50) NOT NULL, -- 'full-lucid', 'decision-assistant', 'news-digest', 'simple-chat'

  -- Settings overrides (allows per-user feature toggles without changing profile)
  settings_overrides JSONB DEFAULT '{}'::jsonb,

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_user_profiles_user ON user_profiles(user_id);
CREATE INDEX idx_user_profiles_profile_id ON user_profiles(profile_id);

-- ============================================================================
-- 3. Conversations
-- ============================================================================

CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) NOT NULL,

  -- Conversation metadata
  title TEXT,
  message_count INT DEFAULT 0,

  -- Context tracking
  time_of_day VARCHAR(20), -- 'early_morning', 'morning', 'afternoon', 'evening', 'night', 'late_night'
  user_timezone VARCHAR(50), -- timezone at time of conversation
  emotional_state_id UUID, -- link to detected emotional state (added via FK later)

  -- Task/context linking (added by migration 009)
  conversation_context TEXT, -- 'general', 'task_check_in', 'insight_review'
  related_task_id UUID, -- references multi_day_research_tasks(id) - FK added in migration 009
  related_insight_id UUID, -- references task_insights(id) - FK added in migration 009
  metadata JSONB DEFAULT '{}',

  -- Status
  is_active BOOLEAN DEFAULT TRUE,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  last_fact_extraction_at TIMESTAMPTZ -- When facts were last extracted from this conversation
);

CREATE INDEX idx_conversations_user ON conversations(user_id);
CREATE INDEX idx_conversations_active ON conversations(user_id, is_active);
CREATE INDEX idx_conversations_time_of_day ON conversations(user_id, time_of_day);
CREATE INDEX idx_conversations_fact_extraction ON conversations(last_fact_extraction_at NULLS FIRST, updated_at DESC) WHERE is_active = true;

-- Auto-populate time_of_day based on created_at
CREATE OR REPLACE FUNCTION set_time_of_day()
RETURNS TRIGGER AS $$
DECLARE
  hour INT;
BEGIN
  hour := EXTRACT(HOUR FROM (NEW.created_at AT TIME ZONE COALESCE(NEW.user_timezone, 'UTC')));
  
  NEW.time_of_day := CASE
    WHEN hour >= 0 AND hour < 5 THEN 'late_night'
    WHEN hour >= 5 AND hour < 7 THEN 'early_morning'
    WHEN hour >= 7 AND hour < 12 THEN 'morning'
    WHEN hour >= 12 AND hour < 17 THEN 'afternoon'
    WHEN hour >= 17 AND hour < 21 THEN 'evening'
    ELSE 'night'
  END;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER conversation_time_of_day
  BEFORE INSERT ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION set_time_of_day();

-- ============================================================================
-- 3. Messages
-- ============================================================================

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID REFERENCES conversations(id) NOT NULL,
  user_id UUID REFERENCES users(id) NOT NULL,
  
  -- Message content
  role VARCHAR(20) NOT NULL, -- 'user', 'assistant', 'system'
  content TEXT NOT NULL,
  
  -- Vector embedding for semantic search
  embedding vector(1536), -- OpenAI ada-002 dimensions
  
  -- Metadata
  tokens INT,
  model VARCHAR(100),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX idx_messages_user ON messages(user_id);
CREATE INDEX idx_messages_role ON messages(role);

-- Vector similarity search index
CREATE INDEX idx_messages_embedding ON messages USING ivfflat (embedding vector_cosine_ops);

-- Auto-increment message count on conversations
CREATE OR REPLACE FUNCTION increment_message_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE conversations
  SET message_count = message_count + 1,
      updated_at = NOW()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER message_count_increment
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION increment_message_count();

-- ============================================================================
-- 4. Facts (User Knowledge)
-- ============================================================================

CREATE TABLE facts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) NOT NULL,
  
  -- Fact content
  content TEXT NOT NULL,
  category VARCHAR(100), -- 'personal', 'preference', 'goal', 'relationship', etc.
  
  -- Confidence (auto-calculated from evidence)
  confidence DECIMAL(4,3) DEFAULT 0.500, -- 0.000 to 1.000
  evidence_count INT DEFAULT 0,
  
  -- Vector embedding for semantic search
  embedding vector(1536),
  
  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  
  -- Timestamps
  first_mentioned_at TIMESTAMPTZ DEFAULT NOW(),
  last_mentioned_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_facts_user ON facts(user_id);
CREATE INDEX idx_facts_category ON facts(category);
CREATE INDEX idx_facts_confidence ON facts(user_id, confidence DESC);
CREATE INDEX idx_facts_active ON facts(user_id, is_active);
CREATE INDEX idx_facts_embedding ON facts USING ivfflat (embedding vector_cosine_ops);

-- ============================================================================
-- 5. Evidence (Supporting Data for Facts)
-- ============================================================================

CREATE TABLE evidence (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fact_id UUID REFERENCES facts(id) NOT NULL,
  message_id UUID REFERENCES messages(id),
  conversation_id UUID REFERENCES conversations(id),
  
  -- Evidence details
  excerpt TEXT NOT NULL, -- the specific text that supports the fact
  strength DECIMAL(4,3) DEFAULT 0.700, -- how strong this evidence is (0.000-1.000)
  
  -- Context
  context_type VARCHAR(50), -- 'direct_statement', 'implied', 'inferred', 'contradiction'
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_evidence_fact ON evidence(fact_id);
CREATE INDEX idx_evidence_message ON evidence(message_id);

-- Auto-update fact confidence when evidence is added
CREATE OR REPLACE FUNCTION update_fact_confidence()
RETURNS TRIGGER AS $$
DECLARE
  avg_strength DECIMAL(4,3);
  count INT;
BEGIN
  -- Calculate average strength and count
  SELECT AVG(strength), COUNT(*) INTO avg_strength, count
  FROM evidence
  WHERE fact_id = NEW.fact_id;
  
  -- Update fact with exponential confidence formula
  -- confidence = avg_strength * (1 - e^(-count/5))
  -- This means: more evidence = higher confidence, with diminishing returns
  UPDATE facts
  SET 
    confidence = avg_strength * (1 - EXP(-count::DECIMAL / 5.0)),
    evidence_count = count,
    last_mentioned_at = NOW(),
    updated_at = NOW()
  WHERE id = NEW.fact_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER evidence_confidence_update
  AFTER INSERT OR UPDATE ON evidence
  FOR EACH ROW
  EXECUTE FUNCTION update_fact_confidence();

-- ============================================================================
-- 6. Summaries (Dual Perspectives)
-- ============================================================================

CREATE TABLE summaries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID REFERENCES conversations(id) NOT NULL,
  user_id UUID REFERENCES users(id) NOT NULL,
  
  -- Three perspectives
  user_perspective TEXT, -- what the user said and meant
  model_perspective TEXT, -- what Lucid understood
  conversation_overview TEXT, -- what actually happened
  
  -- Vector embeddings for semantic search
  user_embedding vector(1536),
  model_embedding vector(1536),
  overview_embedding vector(1536),
  
  -- Metadata
  message_count INT, -- how many messages this summarizes
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_summaries_conversation ON summaries(conversation_id);
CREATE INDEX idx_summaries_user ON summaries(user_id, created_at DESC);
CREATE INDEX idx_summaries_user_embedding ON summaries USING ivfflat (user_embedding vector_cosine_ops);
CREATE INDEX idx_summaries_model_embedding ON summaries USING ivfflat (model_embedding vector_cosine_ops);

-- ============================================================================
-- 7. Personality Snapshots (Big 5 Over Time)
-- ============================================================================

CREATE TABLE personality_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) NOT NULL,
  conversation_id UUID REFERENCES conversations(id),
  
  -- Big 5 personality traits (0.000 to 1.000)
  openness DECIMAL(4,3) NOT NULL,
  conscientiousness DECIMAL(4,3) NOT NULL,
  extraversion DECIMAL(4,3) NOT NULL,
  agreeableness DECIMAL(4,3) NOT NULL,
  neuroticism DECIMAL(4,3) NOT NULL,
  
  -- Reasoning
  assessment_reasoning TEXT, -- why these scores
  
  -- Metadata
  message_count INT, -- based on how many messages
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_personality_user_time ON personality_snapshots(user_id, created_at DESC);
CREATE INDEX idx_personality_conversation ON personality_snapshots(conversation_id);

-- ============================================================================
-- 8. Personality Statistics (Running Averages & Baselines)
-- ============================================================================

CREATE TABLE personality_statistics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) NOT NULL UNIQUE,
  
  -- Running averages (calculated over time)
  avg_openness DECIMAL(4,3) DEFAULT 0.500,
  avg_conscientiousness DECIMAL(4,3) DEFAULT 0.500,
  avg_extraversion DECIMAL(4,3) DEFAULT 0.500,
  avg_agreeableness DECIMAL(4,3) DEFAULT 0.500,
  avg_neuroticism DECIMAL(4,3) DEFAULT 0.500,
  
  -- Standard deviations (to detect significant shifts)
  std_openness DECIMAL(4,3) DEFAULT 0.100,
  std_conscientiousness DECIMAL(4,3) DEFAULT 0.100,
  std_extraversion DECIMAL(4,3) DEFAULT 0.100,
  std_agreeableness DECIMAL(4,3) DEFAULT 0.100,
  std_neuroticism DECIMAL(4,3) DEFAULT 0.100,
  
  -- Metadata
  sample_size INT DEFAULT 0,
  window_days INT DEFAULT 30, -- how many days of history
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_personality_statistics_user ON personality_statistics(user_id);

-- Auto-update statistics when new personality snapshot is created
CREATE OR REPLACE FUNCTION update_personality_statistics()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO personality_statistics (
    user_id, 
    avg_openness, 
    avg_conscientiousness, 
    avg_extraversion, 
    avg_agreeableness, 
    avg_neuroticism, 
    sample_size
  )
  VALUES (
    NEW.user_id,
    NEW.openness,
    NEW.conscientiousness,
    NEW.extraversion,
    NEW.agreeableness,
    NEW.neuroticism,
    1
  )
  ON CONFLICT (user_id) DO UPDATE SET
    -- Rolling average formula: (old_avg * n + new_value) / (n + 1)
    avg_openness = (personality_statistics.avg_openness * personality_statistics.sample_size + NEW.openness) / (personality_statistics.sample_size + 1),
    avg_conscientiousness = (personality_statistics.avg_conscientiousness * personality_statistics.sample_size + NEW.conscientiousness) / (personality_statistics.sample_size + 1),
    avg_extraversion = (personality_statistics.avg_extraversion * personality_statistics.sample_size + NEW.extraversion) / (personality_statistics.sample_size + 1),
    avg_agreeableness = (personality_statistics.avg_agreeableness * personality_statistics.sample_size + NEW.agreeableness) / (personality_statistics.sample_size + 1),
    avg_neuroticism = (personality_statistics.avg_neuroticism * personality_statistics.sample_size + NEW.neuroticism) / (personality_statistics.sample_size + 1),
    sample_size = personality_statistics.sample_size + 1,
    last_updated = NOW();
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER personality_statistics_update
  AFTER INSERT ON personality_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION update_personality_statistics();

-- ============================================================================
-- 9. Emotional States (Detected User States)
-- ============================================================================

CREATE TABLE emotional_states (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) NOT NULL,
  conversation_id UUID REFERENCES conversations(id),
  
  -- The detected state
  state_type VARCHAR(50) NOT NULL, -- 'struggling', 'energized', 'withdrawn', 'reflective', 'stable'
  confidence DECIMAL(4,3) NOT NULL, -- how confident (0.00-1.00)
  
  -- What led to detection
  trigger_type VARCHAR(50) NOT NULL, -- 'personality_shift', 'conversation_pattern', 'time_pattern', 'topic_analysis'
  indicators JSONB, -- detailed evidence
  
  -- Example indicators:
  -- {
  --   "personality_deltas": { "neuroticism": 0.25, "agreeableness": -0.18 },
  --   "topics": ["breakup", "relationship", "lonely"],
  --   "conversation_times": ["2025-11-04T23:45:00Z"],
  --   "reasoning": "Significant neuroticism spike combined with late-night conversations about relationships"
  -- }
  
  -- Duration
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ, -- when state ended (null if ongoing)
  
  -- Recommended response approach
  recommended_approach VARCHAR(50), -- 'gentle', 'supportive', 'exploratory', 'analytical', 'minimal'
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Prevent duplicate detections for same state at same time
  UNIQUE(user_id, state_type, detected_at)
);

CREATE INDEX idx_emotional_states_user_active ON emotional_states(user_id, detected_at) WHERE resolved_at IS NULL;
CREATE INDEX idx_emotional_states_conversation ON emotional_states(conversation_id);
CREATE INDEX idx_emotional_states_type ON emotional_states(state_type);

-- Add FK to conversations now that emotional_states exists
ALTER TABLE conversations 
  ADD CONSTRAINT fk_conversations_emotional_state 
  FOREIGN KEY (emotional_state_id) 
  REFERENCES emotional_states(id);

-- ============================================================================
-- 10. Context Adaptations (How Lucid Adjusts Behavior)
-- ============================================================================

CREATE TABLE context_adaptations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) NOT NULL,
  emotional_state_id UUID REFERENCES emotional_states(id),
  
  -- Schedule adjustments (null = use default, "disabled" = skip)
  morning_schedule VARCHAR(50),   -- e.g., "07:30", "disabled"
  midday_schedule VARCHAR(50),    -- e.g., "13:00", "disabled"
  evening_schedule VARCHAR(50),   -- e.g., "20:00", "disabled"
  night_schedule VARCHAR(50),     -- e.g., "03:00", "disabled"
  
  -- Prompt adjustments
  temperature_modifier DECIMAL(3,2) DEFAULT 1.00, -- multiply base temperature (0.5 = more focused, 1.5 = more creative)
  tone_directive TEXT, -- additional instructions for system prompt
  
  -- Research strategy
  curiosity_approach VARCHAR(50), -- 'gentle', 'exploratory', 'supportive', 'analytical', 'minimal'
  research_topics TEXT[], -- topics to prioritize
  research_avoidance TEXT[], -- topics to avoid
  research_priority INT DEFAULT 5, -- 1-10 priority level
  
  -- Reasoning
  adaptation_reasoning TEXT, -- why these adjustments were made
  
  -- Validity period
  active_from TIMESTAMPTZ DEFAULT NOW(),
  active_until TIMESTAMPTZ, -- when this adaptation expires
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_context_adaptations_active ON context_adaptations(user_id, active_from, active_until) WHERE active_until IS NULL;
CREATE INDEX idx_context_adaptations_state ON context_adaptations(emotional_state_id);

-- ============================================================================
-- 11. Autonomous Thoughts
-- ============================================================================

CREATE TABLE autonomous_thoughts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) NOT NULL,
  agent_job_id UUID, -- link to the job that generated this thought
  
  -- Thought content
  content TEXT NOT NULL,
  category VARCHAR(50), -- 'reflection', 'curiosity', 'consolidation', 'dream', 'insight'
  
  -- Circadian context
  circadian_phase VARCHAR(20), -- 'morning', 'midday', 'evening', 'night'
  generated_at_time TIME, -- what time of day was this generated
  
  -- Importance & sharing
  importance_score DECIMAL(4,3), -- how important is this thought (0.000-1.000)
  is_shared BOOLEAN DEFAULT FALSE, -- has this been shared with user?
  shared_at TIMESTAMPTZ,
  
  -- Vector embedding for semantic search
  embedding vector(1536),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_thoughts_user ON autonomous_thoughts(user_id, created_at DESC);
CREATE INDEX idx_thoughts_unshared ON autonomous_thoughts(user_id, is_shared) WHERE NOT is_shared;
CREATE INDEX idx_thoughts_phase ON autonomous_thoughts(circadian_phase);
CREATE INDEX idx_thoughts_embedding ON autonomous_thoughts USING ivfflat (embedding vector_cosine_ops);

-- ============================================================================
-- 12. Research Tasks (Web Research Queue)
-- ============================================================================

CREATE TABLE research_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) NOT NULL,
  emotional_state_id UUID REFERENCES emotional_states(id), -- what state prompted this
  
  -- Task details
  query TEXT NOT NULL,
  purpose TEXT, -- why this research is being done
  approach VARCHAR(50), -- 'gentle', 'exploratory', 'supportive', 'analytical'
  priority INT DEFAULT 5, -- 1-10 priority
  
  -- Status
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'in_progress', 'completed', 'failed'
  
  -- Results
  results JSONB, -- research findings
  derived_facts TEXT[], -- facts extracted from research
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_research_tasks_user ON research_tasks(user_id);
CREATE INDEX idx_research_tasks_status ON research_tasks(status, priority DESC);
CREATE INDEX idx_research_tasks_state ON research_tasks(emotional_state_id);

-- ============================================================================
-- 13. Agent Jobs (Background Job Queue)
-- ============================================================================

CREATE TABLE agent_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) NOT NULL,
  
  -- Job details
  job_type VARCHAR(50) NOT NULL, -- 'morning_reflection', 'midday_curiosity', 'evening_consolidation', 'night_dream'
  scheduled_for TIMESTAMPTZ NOT NULL,
  
  -- Status
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'running', 'completed', 'failed'
  
  -- Results
  thoughts_generated INT DEFAULT 0,
  research_tasks_created INT DEFAULT 0,
  error_message TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_agent_jobs_user ON agent_jobs(user_id);
CREATE INDEX idx_agent_jobs_scheduled ON agent_jobs(scheduled_for, status);
CREATE INDEX idx_agent_jobs_type ON agent_jobs(job_type, status);

-- ============================================================================
-- Utility Views
-- ============================================================================

-- Active emotional states per user
CREATE VIEW active_emotional_states AS
SELECT 
  es.*,
  u.name AS user_name,
  EXTRACT(EPOCH FROM (NOW() - es.detected_at))/3600 AS hours_active
FROM emotional_states es
JOIN users u ON u.id = es.user_id
WHERE es.resolved_at IS NULL;

-- Current context adaptations
CREATE VIEW current_adaptations AS
SELECT 
  ca.*,
  es.state_type,
  es.confidence AS state_confidence,
  u.name AS user_name
FROM context_adaptations ca
JOIN emotional_states es ON es.id = ca.emotional_state_id
JOIN users u ON u.id = ca.user_id
WHERE 
  ca.active_until IS NULL 
  OR ca.active_until > NOW();

-- User personality baselines with recent shifts
CREATE VIEW personality_overview AS
SELECT 
  ps.*,
  pstat.avg_openness,
  pstat.avg_conscientiousness,
  pstat.avg_extraversion,
  pstat.avg_agreeableness,
  pstat.avg_neuroticism,
  (ps.openness - pstat.avg_openness) AS openness_delta,
  (ps.conscientiousness - pstat.avg_conscientiousness) AS conscientiousness_delta,
  (ps.extraversion - pstat.avg_extraversion) AS extraversion_delta,
  (ps.agreeableness - pstat.avg_agreeableness) AS agreeableness_delta,
  (ps.neuroticism - pstat.avg_neuroticism) AS neuroticism_delta
FROM personality_snapshots ps
JOIN personality_statistics pstat ON pstat.user_id = ps.user_id
WHERE ps.id IN (
  SELECT id FROM personality_snapshots ps2
  WHERE ps2.user_id = ps.user_id
  ORDER BY created_at DESC
  LIMIT 1
);

-- ============================================================================
-- Library System (Phase 2)
-- ============================================================================

CREATE TABLE library_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Entry type: LUCID thoughts, user reflections, debate syntheses, or research journals
  entry_type TEXT NOT NULL CHECK (entry_type IN (
    'lucid_thought',      -- LUCID's deep thinking
    'user_reflection',    -- User's long-form writing
    'versus_synthesis',   -- Debate summaries from Lu & Cid
    'research_journal'    -- User's observations about LUCID
  )),

  -- Content
  title TEXT,
  content TEXT NOT NULL,

  -- Temporal context
  time_of_day TEXT CHECK (time_of_day IN ('morning', 'afternoon', 'evening', 'night')),

  -- Optional link to source conversation
  related_conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,

  -- Metadata for additional context
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Vector embedding for semantic search
  embedding vector(1536),

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_library_user_time ON library_entries(user_id, created_at DESC);
CREATE INDEX idx_library_time_of_day ON library_entries(user_id, time_of_day);
CREATE INDEX idx_library_entry_type ON library_entries(user_id, entry_type);
CREATE INDEX idx_library_embedding ON library_entries USING ivfflat (embedding vector_cosine_ops);

-- ============================================================================
-- API Usage Tracking (Cost monitoring)
-- ============================================================================

CREATE TABLE api_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) NOT NULL,

  -- What triggered this API call
  source VARCHAR(50) NOT NULL, -- 'chat', 'morning_reflection', 'midday_curiosity', etc.

  -- Model and token counts
  model VARCHAR(100) NOT NULL,
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,

  -- Cost in USD (calculated at time of logging)
  cost_usd DECIMAL(10,6) NOT NULL DEFAULT 0,

  -- Additional context
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Timestamp
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_api_usage_user ON api_usage(user_id);
CREATE INDEX idx_api_usage_user_date ON api_usage(user_id, created_at DESC);
CREATE INDEX idx_api_usage_source ON api_usage(user_id, source);

-- ============================================================================
-- Sample Data (Optional - for testing)
-- ============================================================================

-- Uncomment to insert sample user
-- INSERT INTO users (external_id, name, email, timezone)
-- VALUES ('ios_user_123', 'Matt', 'matt@example.com', 'America/Los_Angeles');

-- ============================================================================
-- End of Schema
-- ============================================================================

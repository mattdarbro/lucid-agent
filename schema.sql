-- Lucid Agent Database Schema
-- Run this in Supabase SQL Editor

-- Enable pgvector extension for semantic search
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- TABLES
-- ============================================================================

-- 1. Users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  timezone VARCHAR(50) DEFAULT 'UTC',
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_users_external_id ON users(external_id);

-- 2. Conversations
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  message_count INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_conversations_user_id ON conversations(user_id);
CREATE INDEX idx_conversations_started_at ON conversations(started_at DESC);
CREATE INDEX idx_conversations_active ON conversations(user_id, is_active) WHERE is_active = TRUE;

-- 3. Messages
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  token_count INTEGER,
  model VARCHAR(100),
  metadata JSONB DEFAULT '{}',
  embedding vector(1536)
);

CREATE INDEX idx_messages_conversation_id ON messages(conversation_id, created_at);
CREATE INDEX idx_messages_user_id ON messages(user_id);
CREATE INDEX idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX idx_messages_embedding ON messages USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 4. Facts
CREATE TABLE facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  category VARCHAR(100),
  fact_text TEXT NOT NULL,
  confidence DECIMAL(3,2) DEFAULT 0.50,
  evidence_count INTEGER DEFAULT 1,
  first_observed_at TIMESTAMPTZ DEFAULT NOW(),
  last_observed_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE,
  metadata JSONB DEFAULT '{}',
  embedding vector(1536)
);

CREATE INDEX idx_facts_user_id ON facts(user_id);
CREATE INDEX idx_facts_category ON facts(user_id, category);
CREATE INDEX idx_facts_confidence ON facts(confidence DESC);
CREATE INDEX idx_facts_active ON facts(user_id, is_active) WHERE is_active = TRUE;
CREATE INDEX idx_facts_embedding ON facts USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 5. Evidence
CREATE TABLE evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fact_id UUID REFERENCES facts(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  evidence_text TEXT NOT NULL,
  evidence_type VARCHAR(50) DEFAULT 'statement',
  strength DECIMAL(3,2) DEFAULT 0.50,
  observed_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_evidence_fact_id ON evidence(fact_id, observed_at DESC);
CREATE INDEX idx_evidence_message_id ON evidence(message_id);

-- 6. Summaries
CREATE TABLE summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  summary_type VARCHAR(50) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  message_range_start INTEGER,
  message_range_end INTEGER,
  metadata JSONB DEFAULT '{}',
  embedding vector(1536)
);

CREATE INDEX idx_summaries_conversation_id ON summaries(conversation_id);
CREATE INDEX idx_summaries_user_id ON summaries(user_id, created_at DESC);
CREATE INDEX idx_summaries_type ON summaries(conversation_id, summary_type);
CREATE INDEX idx_summaries_embedding ON summaries USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 7. Personality Snapshots
CREATE TABLE personality_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  openness DECIMAL(3,2),
  conscientiousness DECIMAL(3,2),
  extraversion DECIMAL(3,2),
  agreeableness DECIMAL(3,2),
  neuroticism DECIMAL(3,2),
  confidence DECIMAL(3,2) DEFAULT 0.50,
  snapshot_at TIMESTAMPTZ DEFAULT NOW(),
  sample_size INTEGER DEFAULT 0,
  reasoning TEXT,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_personality_user_id ON personality_snapshots(user_id, snapshot_at DESC);

-- 8. Autonomous Thoughts
CREATE TABLE autonomous_thoughts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  thought_type VARCHAR(50) NOT NULL,
  circadian_phase VARCHAR(20),
  content TEXT NOT NULL,
  trigger_type VARCHAR(50),
  trigger_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  shared_with_user BOOLEAN DEFAULT FALSE,
  shared_at TIMESTAMPTZ,
  importance DECIMAL(3,2) DEFAULT 0.50,
  metadata JSONB DEFAULT '{}',
  embedding vector(1536)
);

CREATE INDEX idx_thoughts_user_id ON autonomous_thoughts(user_id, created_at DESC);
CREATE INDEX idx_thoughts_type ON autonomous_thoughts(thought_type);
CREATE INDEX idx_thoughts_circadian ON autonomous_thoughts(circadian_phase);
CREATE INDEX idx_thoughts_shared ON autonomous_thoughts(user_id, shared_with_user) WHERE shared_with_user = FALSE;
CREATE INDEX idx_thoughts_embedding ON autonomous_thoughts USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 9. Research Tasks
CREATE TABLE research_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  reason TEXT,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  results JSONB,
  summary TEXT,
  derived_facts UUID[],
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_research_user_id ON research_tasks(user_id, created_at DESC);
CREATE INDEX idx_research_status ON research_tasks(status) WHERE status IN ('pending', 'in_progress');

-- 10. Agent Jobs
CREATE TABLE agent_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  job_type VARCHAR(50) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  scheduled_for TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  output JSONB,
  error TEXT,
  metadata JSONB DEFAULT '{}',
  CONSTRAINT unique_user_job_schedule UNIQUE (user_id, job_type, scheduled_for)
);

CREATE INDEX idx_agent_jobs_scheduled ON agent_jobs(scheduled_for) WHERE status = 'pending';
CREATE INDEX idx_agent_jobs_user_id ON agent_jobs(user_id, scheduled_for DESC);

-- ============================================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================================

-- Auto-update timestamps
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Update conversation message count
CREATE OR REPLACE FUNCTION update_conversation_message_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE conversations
    SET message_count = message_count + 1
    WHERE id = NEW.conversation_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE conversations
    SET message_count = message_count - 1
    WHERE id = OLD.conversation_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER messages_count_trigger
  AFTER INSERT OR DELETE ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_conversation_message_count();

-- Update fact confidence based on evidence
CREATE OR REPLACE FUNCTION update_fact_confidence()
RETURNS TRIGGER AS $$
DECLARE
  avg_strength DECIMAL(3,2);
  total_evidence INT;
BEGIN
  SELECT AVG(strength), COUNT(*)
  INTO avg_strength, total_evidence
  FROM evidence
  WHERE fact_id = NEW.fact_id;

  UPDATE facts
  SET
    confidence = LEAST(0.99, avg_strength * (1 - EXP(-total_evidence / 5.0))),
    evidence_count = total_evidence,
    last_observed_at = NOW()
  WHERE id = NEW.fact_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER evidence_confidence_trigger
  AFTER INSERT ON evidence
  FOR EACH ROW
  EXECUTE FUNCTION update_fact_confidence();

-- ============================================================================
-- VIEWS
-- ============================================================================

CREATE VIEW active_user_facts AS
SELECT
  f.user_id,
  f.id as fact_id,
  f.category,
  f.fact_text,
  f.confidence,
  f.evidence_count,
  f.first_observed_at,
  f.last_observed_at,
  (SELECT COUNT(*) FROM evidence e WHERE e.fact_id = f.id) as total_evidence
FROM facts f
WHERE f.is_active = TRUE
ORDER BY f.confidence DESC, f.evidence_count DESC;

CREATE VIEW user_personality_latest AS
SELECT DISTINCT ON (user_id)
  user_id,
  openness,
  conscientiousness,
  extraversion,
  agreeableness,
  neuroticism,
  confidence,
  snapshot_at
FROM personality_snapshots
ORDER BY user_id, snapshot_at DESC;

# Lucid Agent - Database Schema Design

## Overview
This schema supports human-like memory, personality modeling, and autonomous thinking for the Lucid AI agent.

## Core Principles
1. **Episodic Memory**: Store conversations with semantic search
2. **Fact-Evidence System**: Track knowledge with confidence levels
3. **Dual Summaries**: Separate user and model perspectives
4. **Personality Model**: Big 5 traits evolve over time
5. **Autonomous Thoughts**: Store agent's self-generated insights
6. **Temporal Awareness**: Track circadian patterns

---

## Tables

### 1. `users`
Core user identity and metadata.

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id VARCHAR(255) UNIQUE NOT NULL, -- iOS app user ID
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  timezone VARCHAR(50) DEFAULT 'UTC',
  metadata JSONB DEFAULT '{}' -- Flexible storage for app-specific data
);

CREATE INDEX idx_users_external_id ON users(external_id);
```

---

### 2. `conversations`
Conversation sessions between user and Lucid.

```sql
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
```

---

### 3. `messages`
Individual messages in conversations.

```sql
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL, -- 'user', 'assistant', 'system'
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  token_count INTEGER,
  model VARCHAR(100),
  metadata JSONB DEFAULT '{}',

  -- Vector embedding for semantic search
  embedding vector(1536) -- OpenAI ada-002 dimension
);

CREATE INDEX idx_messages_conversation_id ON messages(conversation_id, created_at);
CREATE INDEX idx_messages_user_id ON messages(user_id);
CREATE INDEX idx_messages_created_at ON messages(created_at DESC);

-- Vector similarity search index (using pgvector)
CREATE INDEX idx_messages_embedding ON messages USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

---

### 4. `facts`
User facts extracted from conversations (your evidence-based memory system).

```sql
CREATE TABLE facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  category VARCHAR(100), -- 'preference', 'relationship', 'goal', 'trait', etc.
  fact_text TEXT NOT NULL,
  confidence DECIMAL(3,2) DEFAULT 0.50, -- 0.00 to 1.00
  evidence_count INTEGER DEFAULT 1,
  first_observed_at TIMESTAMPTZ DEFAULT NOW(),
  last_observed_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE,
  metadata JSONB DEFAULT '{}',

  -- Vector embedding for semantic fact search
  embedding vector(1536)
);

CREATE INDEX idx_facts_user_id ON facts(user_id);
CREATE INDEX idx_facts_category ON facts(user_id, category);
CREATE INDEX idx_facts_confidence ON facts(confidence DESC);
CREATE INDEX idx_facts_active ON facts(user_id, is_active) WHERE is_active = TRUE;
CREATE INDEX idx_facts_embedding ON facts USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

---

### 5. `evidence`
Supporting evidence for facts (your evidence tracking system).

```sql
CREATE TABLE evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fact_id UUID REFERENCES facts(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  evidence_text TEXT NOT NULL,
  evidence_type VARCHAR(50) DEFAULT 'statement', -- 'statement', 'behavior', 'preference', 'correction'
  strength DECIMAL(3,2) DEFAULT 0.50, -- How strong is this evidence? 0.00 to 1.00
  observed_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_evidence_fact_id ON evidence(fact_id, observed_at DESC);
CREATE INDEX idx_evidence_message_id ON evidence(message_id);
```

---

### 6. `summaries`
Your dual summary system (user perspective, model perspective, overall).

```sql
CREATE TABLE summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  summary_type VARCHAR(50) NOT NULL, -- 'user_perspective', 'model_perspective', 'conversation_overview'
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  message_range_start INTEGER, -- Which message index does this summary start from?
  message_range_end INTEGER,   -- Which message index does this summary end at?
  metadata JSONB DEFAULT '{}',

  -- Vector embedding for semantic summary search
  embedding vector(1536)
);

CREATE INDEX idx_summaries_conversation_id ON summaries(conversation_id);
CREATE INDEX idx_summaries_user_id ON summaries(user_id, created_at DESC);
CREATE INDEX idx_summaries_type ON summaries(conversation_id, summary_type);
CREATE INDEX idx_summaries_embedding ON summaries USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

---

### 7. `personality_snapshots`
Big 5 personality model over time (tracks evolution).

```sql
CREATE TABLE personality_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,

  -- Big 5 traits (0.00 to 1.00)
  openness DECIMAL(3,2),
  conscientiousness DECIMAL(3,2),
  extraversion DECIMAL(3,2),
  agreeableness DECIMAL(3,2),
  neuroticism DECIMAL(3,2),

  -- Confidence in assessment
  confidence DECIMAL(3,2) DEFAULT 0.50,

  -- When was this snapshot taken?
  snapshot_at TIMESTAMPTZ DEFAULT NOW(),

  -- How many messages/facts contributed to this assessment?
  sample_size INTEGER DEFAULT 0,

  -- Reasoning behind the assessment
  reasoning TEXT,

  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_personality_user_id ON personality_snapshots(user_id, snapshot_at DESC);
```

---

### 8. `autonomous_thoughts`
Lucid's self-generated thoughts (dreams, reflections, curiosities).

```sql
CREATE TABLE autonomous_thoughts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  thought_type VARCHAR(50) NOT NULL, -- 'dream', 'reflection', 'curiosity', 'insight', 'question'
  circadian_phase VARCHAR(20), -- 'morning', 'midday', 'evening', 'night'
  content TEXT NOT NULL,

  -- What triggered this thought?
  trigger_type VARCHAR(50), -- 'scheduled', 'pattern_detected', 'user_mention', 'memory_consolidation'
  trigger_data JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Has this thought been shared with the user?
  shared_with_user BOOLEAN DEFAULT FALSE,
  shared_at TIMESTAMPTZ,

  -- Agent's self-assessment of importance
  importance DECIMAL(3,2) DEFAULT 0.50,

  metadata JSONB DEFAULT '{}',

  -- Vector embedding for semantic thought search
  embedding vector(1536)
);

CREATE INDEX idx_thoughts_user_id ON autonomous_thoughts(user_id, created_at DESC);
CREATE INDEX idx_thoughts_type ON autonomous_thoughts(thought_type);
CREATE INDEX idx_thoughts_circadian ON autonomous_thoughts(circadian_phase);
CREATE INDEX idx_thoughts_shared ON autonomous_thoughts(user_id, shared_with_user) WHERE shared_with_user = FALSE;
CREATE INDEX idx_thoughts_embedding ON autonomous_thoughts USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

---

### 9. `research_tasks`
Web research tasks and results (autonomous curiosity).

```sql
CREATE TABLE research_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  reason TEXT, -- Why did Lucid want to research this?

  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'in_progress', 'completed', 'failed'

  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Research results
  results JSONB,
  summary TEXT,

  -- What facts or insights were derived from this research?
  derived_facts UUID[], -- Array of fact IDs

  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_research_user_id ON research_tasks(user_id, created_at DESC);
CREATE INDEX idx_research_status ON research_tasks(status) WHERE status IN ('pending', 'in_progress');
```

---

### 10. `agent_jobs`
Background jobs for autonomous agents (cron-style tasks).

```sql
CREATE TABLE agent_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  job_type VARCHAR(50) NOT NULL, -- 'morning_reflection', 'midday_curiosity', 'evening_consolidation', 'night_dream'

  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'running', 'completed', 'failed'

  scheduled_for TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Results
  output JSONB,
  error TEXT,

  metadata JSONB DEFAULT '{}',

  CONSTRAINT unique_user_job_schedule UNIQUE (user_id, job_type, scheduled_for)
);

CREATE INDEX idx_agent_jobs_scheduled ON agent_jobs(scheduled_for) WHERE status = 'pending';
CREATE INDEX idx_agent_jobs_user_id ON agent_jobs(user_id, scheduled_for DESC);
```

---

## Triggers & Functions

### Auto-update timestamps

```sql
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
```

### Update conversation message count

```sql
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
```

### Update fact confidence based on evidence

```sql
CREATE OR REPLACE FUNCTION update_fact_confidence()
RETURNS TRIGGER AS $$
DECLARE
  avg_strength DECIMAL(3,2);
  evidence_count INT;
BEGIN
  -- Calculate average evidence strength and count
  SELECT AVG(strength), COUNT(*)
  INTO avg_strength, evidence_count
  FROM evidence
  WHERE fact_id = NEW.fact_id;

  -- Update fact confidence (weighted by evidence count and average strength)
  -- More evidence = higher confidence, but with diminishing returns
  UPDATE facts
  SET
    confidence = LEAST(0.99, avg_strength * (1 - EXP(-evidence_count / 5.0))),
    evidence_count = evidence_count,
    last_observed_at = NOW()
  WHERE id = NEW.fact_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER evidence_confidence_trigger
  AFTER INSERT ON evidence
  FOR EACH ROW
  EXECUTE FUNCTION update_fact_confidence();
```

---

## Views

### `active_user_facts` - Quick access to current user beliefs

```sql
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
```

### `user_personality_latest` - Most recent personality assessment

```sql
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
```

---

## Indexes for Performance

All indexes are included inline with table definitions above. Key performance considerations:

1. **Vector Indexes**: Using `ivfflat` for approximate nearest neighbor search
2. **Compound Indexes**: `(user_id, created_at)` for time-series queries
3. **Partial Indexes**: Only active facts, pending jobs, etc.
4. **Foreign Key Indexes**: Automatic for referential integrity

---

## Storage Estimates

For 1000 active users with moderate usage:

- **Messages**: ~100MB/month (10k messages/day)
- **Facts**: ~50MB (avg 100 facts/user with evidence)
- **Vectors**: ~300MB (embeddings for messages, facts, summaries)
- **Summaries**: ~20MB/month
- **Autonomous Thoughts**: ~10MB/month

**Total**: ~500MB/month (scales linearly)

---

## Next Steps

1. Set up Supabase project with PostgreSQL + pgvector extension
2. Run this schema
3. Create seed data for testing
4. Build TypeScript models/types
5. Implement repository pattern for data access

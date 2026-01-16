-- Migration 015: Versus Mode
-- Lu and Cid debate feature - structured argument produces clearer thinking

-- ============================================================================
-- VERSUS SESSIONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS versus_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Debate topic and positions
  topic TEXT NOT NULL,
  lu_position TEXT NOT NULL,  -- Lu's argument position
  cid_position TEXT NOT NULL, -- Cid's counter-position

  -- Session state
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,

  -- Summary and Library link
  summary TEXT, -- Final synthesis after debate ends
  library_entry_id UUID REFERENCES library_entries(id) ON DELETE SET NULL,

  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Indexes
CREATE INDEX idx_versus_sessions_user ON versus_sessions(user_id, created_at DESC);
CREATE INDEX idx_versus_sessions_status ON versus_sessions(user_id, status);

-- ============================================================================
-- VERSUS MESSAGES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS versus_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES versus_sessions(id) ON DELETE CASCADE,

  -- Speaker identification
  speaker TEXT NOT NULL CHECK (speaker IN ('lu', 'cid', 'user')),

  -- Message content
  content TEXT NOT NULL,

  -- Who was this addressed to (for @Lu or @Cid mentions)
  addressed_to TEXT CHECK (addressed_to IN ('lu', 'cid', NULL)),

  -- Timestamp
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_versus_messages_session ON versus_messages(session_id, created_at);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE versus_sessions IS 'Lu vs Cid debate sessions - structured argument for clearer thinking';
COMMENT ON COLUMN versus_sessions.lu_position IS 'Lu argues FOR or takes one perspective';
COMMENT ON COLUMN versus_sessions.cid_position IS 'Cid argues AGAINST or takes the counter-perspective';
COMMENT ON COLUMN versus_sessions.summary IS 'Synthesized conclusion after debate ends, saved to Library';
COMMENT ON COLUMN versus_messages.speaker IS 'Who said this: lu (green), cid (orange), or user';
COMMENT ON COLUMN versus_messages.addressed_to IS 'When user uses @Lu or @Cid to direct a question';

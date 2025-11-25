-- Migration 012: Library System
-- Creates the library for storing Lucid's thoughts and user reflections
-- Enables the autonomous thinking and morning reflection features

-- ============================================================================
-- LIBRARY ENTRIES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS library_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Entry type: lucid's autonomous thoughts vs user's own reflections
  entry_type TEXT NOT NULL CHECK (entry_type IN ('lucid_thought', 'user_reflection')),

  -- Content
  title TEXT,
  content TEXT NOT NULL,

  -- Temporal context
  time_of_day TEXT CHECK (time_of_day IN ('morning', 'afternoon', 'evening', 'night')),

  -- Optional link to source conversation
  related_conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,

  -- Metadata for additional context
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX idx_library_user_time ON library_entries(user_id, created_at DESC);
CREATE INDEX idx_library_time_of_day ON library_entries(user_id, time_of_day);
CREATE INDEX idx_library_entry_type ON library_entries(user_id, entry_type);

-- ============================================================================
-- ADD PUSH TOKEN TO USERS
-- ============================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS push_token TEXT,
  ADD COLUMN IF NOT EXISTS push_token_updated_at TIMESTAMP;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE library_entries IS 'Stores Lucid autonomous thoughts and user reflections. The Library is where insights live.';
COMMENT ON COLUMN library_entries.entry_type IS 'lucid_thought = AI-generated insight, user_reflection = user-written entry';
COMMENT ON COLUMN library_entries.time_of_day IS 'When the thought was generated or intended for (morning reflections, evening insights, etc.)';
COMMENT ON COLUMN library_entries.metadata IS 'Additional context: { thought_type, circadian_phase, related_facts, etc. }';
COMMENT ON COLUMN users.push_token IS 'Device push notification token for iOS notifications';

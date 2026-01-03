-- State Check Sessions
-- Interactive guided conversations for dream/goal discovery
-- Tracks the journey through phases: dream -> reality -> literal_path -> mitigation -> alternative_paths

CREATE TABLE IF NOT EXISTS state_check_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,

  -- Current phase of the journey
  phase TEXT NOT NULL DEFAULT 'dream' CHECK (phase IN (
    'dream',           -- "What are you reaching for?"
    'reality',         -- Discovering context, constraints, dependencies
    'literal_path',    -- "Here's what it would actually take"
    'mitigation',      -- Finding the essence if sacrifice too high
    'alternative_paths', -- Modified paths that honor the spirit
    'complete'         -- Session finished
  )),

  -- Session document - Lucid's notes on the journey
  session_doc JSONB NOT NULL DEFAULT '{
    "dream_stated": null,
    "reality_discovered": [],
    "sacrifice_assessment": null,
    "essence_identified": null,
    "paths_explored": [],
    "chosen_direction": null,
    "insights": []
  }'::jsonb,

  -- Status
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),

  -- Library entry created when complete
  library_entry_id UUID REFERENCES library_entries(id) ON DELETE SET NULL,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Index for finding active sessions
CREATE INDEX IF NOT EXISTS idx_state_check_sessions_user_active
  ON state_check_sessions(user_id, status)
  WHERE status = 'active';

-- Index for user's session history
CREATE INDEX IF NOT EXISTS idx_state_check_sessions_user_created
  ON state_check_sessions(user_id, created_at DESC);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_state_check_session_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS state_check_session_updated ON state_check_sessions;
CREATE TRIGGER state_check_session_updated
  BEFORE UPDATE ON state_check_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_state_check_session_timestamp();

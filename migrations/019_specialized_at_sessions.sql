-- Migration 019: Specialized Autonomous Thinking Sessions
-- Enhances agent_jobs and library_entries for new session types:
-- morning_curiosity, dream_session, state_session, orbit_session

-- ============================================================================
-- EXTEND AGENT JOBS WITH SESSION METADATA
-- ============================================================================

-- Add session_metadata column for additional context
ALTER TABLE agent_jobs
ADD COLUMN IF NOT EXISTS session_metadata JSONB DEFAULT '{}'::jsonb;

-- Add result reference (points to library entry created by session)
ALTER TABLE agent_jobs
ADD COLUMN IF NOT EXISTS library_entry_id UUID REFERENCES library_entries(id) ON DELETE SET NULL;

-- Index for new session types
CREATE INDEX IF NOT EXISTS idx_agent_jobs_library_entry ON agent_jobs(library_entry_id) WHERE library_entry_id IS NOT NULL;

-- ============================================================================
-- EXTEND LIBRARY ENTRIES WITH SESSION TYPE
-- ============================================================================

-- Add session_type to track which AT session created the entry
ALTER TABLE library_entries
ADD COLUMN IF NOT EXISTS session_type TEXT;

-- Add session_metadata for additional context
ALTER TABLE library_entries
ADD COLUMN IF NOT EXISTS session_metadata JSONB DEFAULT '{}'::jsonb;

-- Index for session type queries
CREATE INDEX IF NOT EXISTS idx_library_session_type ON library_entries(user_id, session_type)
  WHERE session_type IS NOT NULL;

-- ============================================================================
-- ADD EMBEDDING COLUMN IF MISSING
-- ============================================================================

-- Add embedding column for semantic search (1536 dimensions for text-embedding-3-small)
ALTER TABLE library_entries
ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Index for vector similarity search
CREATE INDEX IF NOT EXISTS idx_library_embedding ON library_entries
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ============================================================================
-- UPDATE LIBRARY ENTRY_TYPE CHECK
-- ============================================================================

-- The existing entry_type was limited; let's add more flexibility
-- First drop the old constraint if it exists
DO $$
BEGIN
  ALTER TABLE library_entries DROP CONSTRAINT IF EXISTS library_entries_entry_type_check;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

-- Add new constraint with expanded types
ALTER TABLE library_entries
ADD CONSTRAINT library_entries_entry_type_check
CHECK (entry_type IN (
  'lucid_thought',
  'user_reflection',
  'journal',
  'reflection',
  'curiosity',
  'dream',
  'consolidation',
  'state_update',
  'orbit_update',
  'deep_thought'
));

-- ============================================================================
-- IS_SHARED COLUMN FOR LIBRARY ENTRIES
-- ============================================================================

-- Track whether a library entry has been shared with user in conversation
ALTER TABLE library_entries
ADD COLUMN IF NOT EXISTS is_shared BOOLEAN DEFAULT FALSE;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON COLUMN agent_jobs.session_metadata IS 'Additional context for specialized sessions (topics researched, state updates, etc.)';
COMMENT ON COLUMN agent_jobs.library_entry_id IS 'Reference to library entry created by this job';
COMMENT ON COLUMN library_entries.session_type IS 'AT session that created this entry: morning_curiosity, dream, state, orbit, conversation';
COMMENT ON COLUMN library_entries.session_metadata IS 'Additional context about the session that created this entry';
COMMENT ON COLUMN library_entries.is_shared IS 'Whether this entry has been shared with user in a conversation';

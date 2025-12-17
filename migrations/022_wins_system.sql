-- Migration 022: Wins System
-- Extends library_entries to track user accomplishments and wins

-- ============================================================================
-- UPDATE LIBRARY ENTRY_TYPE CHECK TO INCLUDE 'win'
-- ============================================================================

-- First drop the old constraint
DO $$
BEGIN
  ALTER TABLE library_entries DROP CONSTRAINT IF EXISTS library_entries_entry_type_check;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

-- Add updated constraint with 'win' and 'versus_synthesis' types
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
  'deep_thought',
  'versus_synthesis',
  'win'
));

-- ============================================================================
-- CREATE INDEX FOR WINS QUERIES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_library_wins
  ON library_entries(user_id, created_at DESC)
  WHERE entry_type = 'win';

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON CONSTRAINT library_entries_entry_type_check ON library_entries IS
  'Allowed library entry types including wins for user accomplishments';

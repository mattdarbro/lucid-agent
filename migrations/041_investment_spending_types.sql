-- Migration 041: Investment & Spending Loop Types
-- Adds 'investment_recommendation' and 'spending_proposal' to library_entries.entry_type
-- for the new investment research and ability spending autonomous loops.

-- ============================================================================
-- UPDATE LIBRARY_ENTRIES ENTRY_TYPE CHECK
-- ============================================================================

DO $$
BEGIN
  ALTER TABLE library_entries DROP CONSTRAINT IF EXISTS library_entries_entry_type_check;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

-- Re-add with all known entry types including investment_recommendation and spending_proposal
ALTER TABLE library_entries
ADD CONSTRAINT library_entries_entry_type_check
CHECK (entry_type IN (
  'lucid_thought',
  'lucid_self_reflection',
  'orbit_reflection',
  'vision_appraisal',
  'possibility_map',
  'possibilities',
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
  'briefing',
  'insight',
  'research_journal',
  'win',
  'code_review',
  'investment_recommendation',
  'spending_proposal'
));

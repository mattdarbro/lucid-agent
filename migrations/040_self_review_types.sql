-- Migration 040: Self-Review Types
-- Adds 'self_review' to agent_jobs.job_type and 'code_review' to library_entries.entry_type

-- ============================================================================
-- UPDATE AGENT_JOBS JOB_TYPE CHECK
-- ============================================================================

DO $$
BEGIN
  ALTER TABLE agent_jobs DROP CONSTRAINT IF EXISTS agent_jobs_job_type_check;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

-- Note: If no CHECK constraint exists (e.g. using enum or no constraint),
-- this is a no-op and the new values will work automatically.

-- ============================================================================
-- UPDATE LIBRARY_ENTRIES ENTRY_TYPE CHECK
-- ============================================================================

DO $$
BEGIN
  ALTER TABLE library_entries DROP CONSTRAINT IF EXISTS library_entries_entry_type_check;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

-- Re-add with code_review included
ALTER TABLE library_entries
ADD CONSTRAINT library_entries_entry_type_check
CHECK (entry_type IN (
  'lucid_thought',
  'lucid_self_reflection',
  'orbit_reflection',
  'vision_appraisal',
  'possibility_map',
  'user_reflection',
  'journal',
  'reflection',
  'curiosity',
  'dream',
  'consolidation',
  'state_update',
  'orbit_update',
  'deep_thought',
  'briefing',
  'insight',
  'research_journal',
  'code_review'
));

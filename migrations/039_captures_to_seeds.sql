-- ============================================================================
-- Migration 039: Transform Captures to Seeds
-- Purpose: Simplify capture system to "planting seeds" - no classification logic
-- ============================================================================

-- ============================================================================
-- 1. RENAME CAPTURES TABLE TO SEEDS
-- ============================================================================

-- First drop views that depend on captures
DROP VIEW IF EXISTS active_captures;
DROP VIEW IF EXISTS upcoming_deadlines;
DROP VIEW IF EXISTS important_people;

-- Drop indexes (they'll be recreated with new names)
DROP INDEX IF EXISTS idx_captures_user;
DROP INDEX IF EXISTS idx_captures_status;
DROP INDEX IF EXISTS idx_captures_inbox;
DROP INDEX IF EXISTS idx_captures_active;
DROP INDEX IF EXISTS idx_captures_deadline;
DROP INDEX IF EXISTS idx_captures_type;
DROP INDEX IF EXISTS idx_captures_person;
DROP INDEX IF EXISTS idx_captures_embedding;

-- Drop trigger
DROP TRIGGER IF EXISTS capture_person_mention ON captures;

-- Drop the capture_processing_log table (no longer needed without classification)
DROP TABLE IF EXISTS capture_processing_log;

-- Rename the table
ALTER TABLE captures RENAME TO seeds;

-- ============================================================================
-- 2. RENAME AND MODIFY COLUMNS
-- ============================================================================

-- Rename created_at to planted_at
ALTER TABLE seeds RENAME COLUMN created_at TO planted_at;

-- Add new columns for seed lifecycle
ALTER TABLE seeds ADD COLUMN planted_context TEXT;
ALTER TABLE seeds ADD COLUMN last_surfaced_at TIMESTAMPTZ;
ALTER TABLE seeds ADD COLUMN surface_count INTEGER DEFAULT 0;
ALTER TABLE seeds ADD COLUMN grown_into_library_id UUID REFERENCES library_entries(id);
ALTER TABLE seeds ADD COLUMN released_at TIMESTAMPTZ;

-- Remove classification columns (no more AI classification)
ALTER TABLE seeds DROP COLUMN IF EXISTS interpreted_type;
ALTER TABLE seeds DROP COLUMN IF EXISTS interpreted_title;
ALTER TABLE seeds DROP COLUMN IF EXISTS interpreted_details;

-- Remove fields that were related to the old system
ALTER TABLE seeds DROP COLUMN IF EXISTS has_deadline;
ALTER TABLE seeds DROP COLUMN IF EXISTS deadline_at;
ALTER TABLE seeds DROP COLUMN IF EXISTS preferred_time;
ALTER TABLE seeds DROP COLUMN IF EXISTS estimated_duration_minutes;
ALTER TABLE seeds DROP COLUMN IF EXISTS priority;
ALTER TABLE seeds DROP COLUMN IF EXISTS energy_required;
ALTER TABLE seeds DROP COLUMN IF EXISTS is_recurring;
ALTER TABLE seeds DROP COLUMN IF EXISTS recurrence_rule;
ALTER TABLE seeds DROP COLUMN IF EXISTS scheduled_event_id;
ALTER TABLE seeds DROP COLUMN IF EXISTS related_person_id;
ALTER TABLE seeds DROP COLUMN IF EXISTS related_capture_ids;
ALTER TABLE seeds DROP COLUMN IF EXISTS is_completed;
ALTER TABLE seeds DROP COLUMN IF EXISTS completed_at;
ALTER TABLE seeds DROP COLUMN IF EXISTS context_notes;
ALTER TABLE seeds DROP COLUMN IF EXISTS processed_at;

-- ============================================================================
-- 3. UPDATE STATUS VALUES
-- ============================================================================
-- Old: 'inbox' | 'processing' | 'processed' | 'archived' | 'deleted'
-- New: 'held' | 'growing' | 'grown' | 'released'

-- First update existing status values to new schema
UPDATE seeds SET status = 'held' WHERE status IN ('inbox', 'processing');
UPDATE seeds SET status = 'growing' WHERE status = 'processed';
UPDATE seeds SET status = 'released' WHERE status IN ('archived', 'deleted');
UPDATE seeds SET released_at = updated_at WHERE status = 'released';

-- ============================================================================
-- 4. CREATE NEW INDEXES
-- ============================================================================

CREATE INDEX idx_seeds_user ON seeds(user_id);
CREATE INDEX idx_seeds_status ON seeds(user_id, status);
CREATE INDEX idx_seeds_held ON seeds(user_id, planted_at DESC) WHERE status = 'held';
CREATE INDEX idx_seeds_growing ON seeds(user_id, planted_at DESC) WHERE status = 'growing';
CREATE INDEX idx_seeds_grown ON seeds(user_id, planted_at DESC) WHERE status = 'grown';
CREATE INDEX idx_seeds_embedding ON seeds USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_seeds_last_surfaced ON seeds(user_id, last_surfaced_at DESC NULLS LAST);

-- ============================================================================
-- 5. CREATE SIMPLE VIEW FOR ACTIVE SEEDS
-- ============================================================================

CREATE VIEW active_seeds AS
SELECT
  s.*
FROM seeds s
WHERE s.status IN ('held', 'growing')
ORDER BY
  s.planted_at DESC;

-- ============================================================================
-- 6. RECREATE IMPORTANT_PEOPLE VIEW (without capture/seed dependency)
-- ============================================================================

-- Recreate without the captures join (seeds don't have person relationships)
CREATE VIEW important_people AS
SELECT
  p.*,
  0 AS open_seeds_count,  -- Seeds no longer linked to people
  COUNT(DISTINCT ce.id) AS upcoming_events_count
FROM people p
LEFT JOIN calendar_events ce ON p.id = ANY(ce.attendee_ids) AND ce.start_time > NOW()
GROUP BY p.id
ORDER BY p.importance_score DESC, p.last_mentioned_at DESC;

-- ============================================================================
-- End of Migration 039
-- ============================================================================

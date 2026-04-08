-- Migration 048: Security Fixes Round 2
-- Addresses remaining Supabase linter warnings missed by migration 032:
-- 1. Security Definer Views (5 views) - Set to SECURITY INVOKER
-- 2. RLS Disabled (7 tables) - Enable RLS with service_role policies

-- ============================================================================
-- PART 1: FIX SECURITY DEFINER VIEWS (5 views)
-- Recreate views with security_invoker = true
-- ============================================================================

-- 1. pending_identity_proposals (from migration 023)
DROP VIEW IF EXISTS pending_identity_proposals;
CREATE VIEW pending_identity_proposals
WITH (security_invoker = true) AS
SELECT
  lsn.*,
  u.name as user_name
FROM lucid_self_notes lsn
JOIN users u ON lsn.user_id = u.id
WHERE lsn.note_type = 'identity_proposal'
  AND lsn.is_active = true
  AND lsn.is_approved = false
ORDER BY lsn.created_at DESC;

-- 2. todays_schedule (from migration 002)
DROP VIEW IF EXISTS todays_schedule;
CREATE VIEW todays_schedule
WITH (security_invoker = true) AS
SELECT
  ce.*,
  array_agg(DISTINCT p.name) FILTER (WHERE p.name IS NOT NULL) AS attendee_display_names
FROM calendar_events ce
LEFT JOIN people p ON p.id = ANY(ce.attendee_ids)
WHERE ce.start_time >= CURRENT_DATE
  AND ce.start_time < CURRENT_DATE + INTERVAL '1 day'
  AND ce.status != 'cancelled'
GROUP BY ce.id
ORDER BY ce.start_time;

-- 3. active_seeds (from migration 039)
DROP VIEW IF EXISTS active_seeds;
CREATE VIEW active_seeds
WITH (security_invoker = true) AS
SELECT
  s.*
FROM seeds s
WHERE s.status IN ('held', 'growing')
ORDER BY
  s.planted_at DESC;

-- 4. active_lucid_notes (from migration 023)
DROP VIEW IF EXISTS active_lucid_notes;
CREATE VIEW active_lucid_notes
WITH (security_invoker = true) AS
SELECT
  lsn.*,
  u.name as user_name
FROM lucid_self_notes lsn
JOIN users u ON lsn.user_id = u.id
WHERE lsn.is_active = true AND lsn.is_approved = true
ORDER BY lsn.created_at DESC;

-- 5. important_people (from migration 039)
DROP VIEW IF EXISTS important_people;
CREATE VIEW important_people
WITH (security_invoker = true) AS
SELECT
  p.*,
  0 AS open_seeds_count,
  COUNT(DISTINCT ce.id) AS upcoming_events_count
FROM people p
LEFT JOIN calendar_events ce ON p.id = ANY(ce.attendee_ids) AND ce.start_time > NOW()
GROUP BY p.id
ORDER BY p.importance_score DESC, p.last_mentioned_at DESC;

-- ============================================================================
-- PART 2: ENABLE RLS ON REMAINING PUBLIC TABLES (7 tables)
-- Same pattern as migration 032: service_role gets full access
-- ============================================================================

-- 1. people
ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to people" ON public.people;
CREATE POLICY "Service role has full access to people" ON public.people
  FOR ALL USING (auth.role() = 'service_role');

-- 2. calendar_events
ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to calendar_events" ON public.calendar_events;
CREATE POLICY "Service role has full access to calendar_events" ON public.calendar_events
  FOR ALL USING (auth.role() = 'service_role');

-- 3. people_facts
ALTER TABLE public.people_facts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to people_facts" ON public.people_facts;
CREATE POLICY "Service role has full access to people_facts" ON public.people_facts
  FOR ALL USING (auth.role() = 'service_role');

-- 4. seeds
ALTER TABLE public.seeds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to seeds" ON public.seeds;
CREATE POLICY "Service role has full access to seeds" ON public.seeds
  FOR ALL USING (auth.role() = 'service_role');

-- 5. lucid_self_notes
ALTER TABLE public.lucid_self_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to lucid_self_notes" ON public.lucid_self_notes;
CREATE POLICY "Service role has full access to lucid_self_notes" ON public.lucid_self_notes
  FOR ALL USING (auth.role() = 'service_role');

-- 6. health_metrics
ALTER TABLE public.health_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to health_metrics" ON public.health_metrics;
CREATE POLICY "Service role has full access to health_metrics" ON public.health_metrics
  FOR ALL USING (auth.role() = 'service_role');

-- 7. library_entry_comments
ALTER TABLE public.library_entry_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to library_entry_comments" ON public.library_entry_comments;
CREATE POLICY "Service role has full access to library_entry_comments" ON public.library_entry_comments
  FOR ALL USING (auth.role() = 'service_role');

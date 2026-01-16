-- Migration 032: Security Fixes
-- Addresses Supabase linter warnings:
-- 1. Security Definer Views (10 views) - Set to SECURITY INVOKER
-- 2. Function Search Path (12 functions) - Set search_path
-- 3. RLS Disabled (34 tables) - Enable RLS with appropriate policies
--
-- Note: The vector extension warning is not addressed here as moving it
-- would break existing indexes and requires careful manual handling.

-- ============================================================================
-- PART 1: FIX SECURITY DEFINER VIEWS (10 views)
-- Set all views to explicitly use SECURITY INVOKER (the safe default)
-- ============================================================================

-- 1. active_emotional_states
DROP VIEW IF EXISTS active_emotional_states;
CREATE VIEW active_emotional_states
WITH (security_invoker = true) AS
SELECT
  es.*,
  u.name AS user_name,
  EXTRACT(EPOCH FROM (NOW() - es.detected_at))/3600 AS hours_active
FROM emotional_states es
JOIN users u ON u.id = es.user_id
WHERE es.resolved_at IS NULL;

-- 2. current_adaptations
DROP VIEW IF EXISTS current_adaptations;
CREATE VIEW current_adaptations
WITH (security_invoker = true) AS
SELECT
  ca.*,
  es.state_type,
  es.confidence AS state_confidence,
  u.name AS user_name
FROM context_adaptations ca
JOIN emotional_states es ON es.id = ca.emotional_state_id
JOIN users u ON u.id = ca.user_id
WHERE
  ca.active_until IS NULL
  OR ca.active_until > NOW();

-- 3. personality_overview
DROP VIEW IF EXISTS personality_overview;
CREATE VIEW personality_overview
WITH (security_invoker = true) AS
SELECT
  ps.*,
  pstat.avg_openness,
  pstat.avg_conscientiousness,
  pstat.avg_extraversion,
  pstat.avg_agreeableness,
  pstat.avg_neuroticism,
  (ps.openness - pstat.avg_openness) AS openness_delta,
  (ps.conscientiousness - pstat.avg_conscientiousness) AS conscientiousness_delta,
  (ps.extraversion - pstat.avg_extraversion) AS extraversion_delta,
  (ps.agreeableness - pstat.avg_agreeableness) AS agreeableness_delta,
  (ps.neuroticism - pstat.avg_neuroticism) AS neuroticism_delta
FROM personality_snapshots ps
JOIN personality_statistics pstat ON pstat.user_id = ps.user_id
WHERE ps.id IN (
  SELECT id FROM personality_snapshots ps2
  WHERE ps2.user_id = ps.user_id
  ORDER BY created_at DESC
  LIMIT 1
);

-- 4. pending_insights
DROP VIEW IF EXISTS pending_insights;
CREATE VIEW pending_insights
WITH (security_invoker = true) AS
SELECT
  i.id,
  i.task_id,
  i.user_id,
  i.insight_text,
  i.confidence,
  i.pattern_type,
  i.created_at,
  t.title as task_title,
  t.status as task_status,
  EXTRACT(EPOCH FROM (NOW() - i.created_at)) / 3600 as hours_pending
FROM task_insights i
JOIN multi_day_research_tasks t ON i.task_id = t.id
WHERE i.status = 'proposed'
  AND i.user_validated IS NULL
ORDER BY i.created_at ASC;

-- 5. task_conversation_summary
DROP VIEW IF EXISTS task_conversation_summary;
CREATE VIEW task_conversation_summary
WITH (security_invoker = true) AS
SELECT
  t.id as task_id,
  t.title,
  t.user_id,
  COUNT(DISTINCT tc.conversation_id) as total_conversations,
  COUNT(DISTINCT CASE WHEN tc.conversation_type = 'check_in' THEN tc.id END) as check_in_count,
  COUNT(DISTINCT CASE WHEN tc.conversation_type = 'insight_review' THEN tc.id END) as insight_review_count,
  COUNT(DISTINCT CASE WHEN tc.conversation_type = 'general' THEN tc.id END) as general_chat_count,
  MAX(tc.created_at) as last_conversation_at
FROM multi_day_research_tasks t
LEFT JOIN task_conversations tc ON t.id = tc.task_id
GROUP BY t.id, t.title, t.user_id;

-- 6. user_insight_engagement
DROP VIEW IF EXISTS user_insight_engagement;
CREATE VIEW user_insight_engagement
WITH (security_invoker = true) AS
SELECT
  u.id as user_id,
  u.external_id,
  COUNT(DISTINCT i.id) as total_insights_generated,
  COUNT(DISTINCT CASE WHEN i.user_validated = true THEN i.id END) as insights_accepted,
  COUNT(DISTINCT CASE WHEN i.user_validated = false THEN i.id END) as insights_rejected,
  COUNT(DISTINCT CASE WHEN i.status = 'refined' THEN i.id END) as insights_refined,
  COUNT(DISTINCT CASE WHEN i.status = 'proposed' THEN i.id END) as insights_pending,
  AVG(CASE WHEN ii.reviewed_at IS NOT NULL
      THEN EXTRACT(EPOCH FROM (ii.reviewed_at - i.created_at)) / 3600
      END) as avg_hours_to_review,
  irp.preferred_review_time,
  irp.overall_acceptance_rate
FROM users u
LEFT JOIN task_insights i ON u.id = i.user_id
LEFT JOIN insight_interactions ii ON i.id = ii.insight_id AND ii.action IN ('accepted', 'rejected', 'refined')
LEFT JOIN insight_receptivity_patterns irp ON u.id = irp.user_id
GROUP BY u.id, u.external_id, irp.preferred_review_time, irp.overall_acceptance_rate;

-- 7. active_research_queue
DROP VIEW IF EXISTS active_research_queue;
CREATE VIEW active_research_queue
WITH (security_invoker = true) AS
SELECT *
FROM research_queue
WHERE status NOT IN ('completed', 'not_useful', 'abandoned')
ORDER BY
  CASE
    WHEN user_approved THEN 0
    ELSE 1
  END,
  priority DESC,
  times_mentioned DESC,
  created_at ASC;

-- 8. core_identity_facts
DROP VIEW IF EXISTS core_identity_facts;
CREATE VIEW core_identity_facts
WITH (security_invoker = true) AS
SELECT * FROM (
  SELECT
    id,
    user_id,
    content,
    category,
    'immutable' as source,
    1.0::numeric as confidence,
    display_order
  FROM immutable_facts
  UNION ALL
  SELECT
    id,
    user_id,
    content,
    category,
    'fact' as source,
    confidence,
    0 as display_order
  FROM facts
  WHERE is_immutable = true AND is_active = true
) combined
ORDER BY
  CASE category
    WHEN 'name' THEN 1
    WHEN 'identity' THEN 2
    WHEN 'biography' THEN 3
    WHEN 'profession' THEN 4
    WHEN 'relationship' THEN 5
    ELSE 6
  END,
  display_order,
  confidence DESC;

-- 9. immutable_facts_with_age
DROP VIEW IF EXISTS immutable_facts_with_age;
CREATE VIEW immutable_facts_with_age
WITH (security_invoker = true) AS
SELECT
  id,
  user_id,
  CASE
    WHEN birth_year IS NOT NULL THEN
      REPLACE(content, '{age}', age_from_year_string(birth_year))
    ELSE
      content
  END AS content,
  category,
  display_order,
  birth_year,
  metadata,
  created_at,
  updated_at
FROM immutable_facts;

-- 10. orbits_with_age
DROP VIEW IF EXISTS orbits_with_age;
CREATE VIEW orbits_with_age
WITH (security_invoker = true) AS
SELECT
  o.*,
  calculate_age_from_year(o.birth_year) as current_age
FROM orbits o;

-- ============================================================================
-- PART 2: FIX FUNCTION SEARCH PATH (12 functions)
-- Recreate functions with SET search_path = '' for security
-- ============================================================================

-- 1. update_research_queue_updated_at
CREATE OR REPLACE FUNCTION public.update_research_queue_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- 2. update_fact_confidence
CREATE OR REPLACE FUNCTION public.update_fact_confidence()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  avg_strength DECIMAL(4,3);
  count INT;
BEGIN
  SELECT AVG(strength), COUNT(*) INTO avg_strength, count
  FROM public.evidence
  WHERE fact_id = NEW.fact_id;

  UPDATE public.facts
  SET
    confidence = avg_strength * (1 - EXP(-count::DECIMAL / 5.0)),
    evidence_count = count,
    last_mentioned_at = NOW(),
    updated_at = NOW()
  WHERE id = NEW.fact_id;

  RETURN NEW;
END;
$$;

-- 3. archive_matt_state
CREATE OR REPLACE FUNCTION public.archive_matt_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.matt_state_history (user_id, state_snapshot, changes_summary, updated_by)
  VALUES (
    NEW.user_id,
    jsonb_build_object(
      'active_goals', NEW.active_goals,
      'active_commitments', NEW.active_commitments,
      'resources', NEW.resources,
      'constraints', NEW.constraints,
      'values_priorities', NEW.values_priorities,
      'confidence', NEW.confidence
    ),
    'State updated',
    NEW.last_updated_by
  );
  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

-- 4. calculate_age_from_year
CREATE OR REPLACE FUNCTION public.calculate_age_from_year(birth_year INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF birth_year IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER - birth_year;
END;
$$;

-- 5. update_lucid_state_timestamp
CREATE OR REPLACE FUNCTION public.update_lucid_state_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

-- 6. update_personality_statistics
CREATE OR REPLACE FUNCTION public.update_personality_statistics()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.personality_statistics (
    user_id,
    avg_openness,
    avg_conscientiousness,
    avg_extraversion,
    avg_agreeableness,
    avg_neuroticism,
    sample_size
  )
  VALUES (
    NEW.user_id,
    NEW.openness,
    NEW.conscientiousness,
    NEW.extraversion,
    NEW.agreeableness,
    NEW.neuroticism,
    1
  )
  ON CONFLICT (user_id) DO UPDATE SET
    avg_openness = (public.personality_statistics.avg_openness * public.personality_statistics.sample_size + NEW.openness) / (public.personality_statistics.sample_size + 1),
    avg_conscientiousness = (public.personality_statistics.avg_conscientiousness * public.personality_statistics.sample_size + NEW.conscientiousness) / (public.personality_statistics.sample_size + 1),
    avg_extraversion = (public.personality_statistics.avg_extraversion * public.personality_statistics.sample_size + NEW.extraversion) / (public.personality_statistics.sample_size + 1),
    avg_agreeableness = (public.personality_statistics.avg_agreeableness * public.personality_statistics.sample_size + NEW.agreeableness) / (public.personality_statistics.sample_size + 1),
    avg_neuroticism = (public.personality_statistics.avg_neuroticism * public.personality_statistics.sample_size + NEW.neuroticism) / (public.personality_statistics.sample_size + 1),
    sample_size = public.personality_statistics.sample_size + 1,
    last_updated = NOW();

  RETURN NEW;
END;
$$;

-- 7. set_time_of_day
CREATE OR REPLACE FUNCTION public.set_time_of_day()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  hour INT;
BEGIN
  hour := EXTRACT(HOUR FROM (NEW.created_at AT TIME ZONE COALESCE(NEW.user_timezone, 'UTC')));

  NEW.time_of_day := CASE
    WHEN hour >= 0 AND hour < 5 THEN 'late_night'
    WHEN hour >= 5 AND hour < 7 THEN 'early_morning'
    WHEN hour >= 7 AND hour < 12 THEN 'morning'
    WHEN hour >= 12 AND hour < 17 THEN 'afternoon'
    WHEN hour >= 17 AND hour < 21 THEN 'evening'
    ELSE 'night'
  END;

  RETURN NEW;
END;
$$;

-- 8. age_from_year_string
CREATE OR REPLACE FUNCTION public.age_from_year_string(birth_year INTEGER)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF birth_year IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN public.calculate_age_from_year(birth_year)::TEXT;
END;
$$;

-- 9. update_temporal_checkin_updated_at
CREATE OR REPLACE FUNCTION public.update_temporal_checkin_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

-- 10. update_orbits_timestamp
CREATE OR REPLACE FUNCTION public.update_orbits_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

-- 11. update_immutable_facts_updated_at
CREATE OR REPLACE FUNCTION public.update_immutable_facts_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- 12. increment_message_count
CREATE OR REPLACE FUNCTION public.increment_message_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.conversations
  SET message_count = message_count + 1,
      updated_at = NOW()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

-- ============================================================================
-- PART 3: ENABLE RLS ON ALL PUBLIC TABLES (34 tables)
-- Each table gets RLS enabled with a basic policy allowing service role access
-- and user access to their own data where applicable
-- ============================================================================

-- Helper: Create a policy that allows service_role full access
-- and authenticated users access to their own data

-- 1. users
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to users" ON public.users;
CREATE POLICY "Service role has full access to users" ON public.users
  FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Users can view their own data" ON public.users;
CREATE POLICY "Users can view their own data" ON public.users
  FOR SELECT USING (auth.uid()::text = external_id);

-- 2. api_usage
ALTER TABLE public.api_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to api_usage" ON public.api_usage;
CREATE POLICY "Service role has full access to api_usage" ON public.api_usage
  FOR ALL USING (auth.role() = 'service_role');

-- 3. user_profiles
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to user_profiles" ON public.user_profiles;
CREATE POLICY "Service role has full access to user_profiles" ON public.user_profiles
  FOR ALL USING (auth.role() = 'service_role');

-- 4. detected_patterns (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'detected_patterns' AND table_schema = 'public') THEN
    ALTER TABLE public.detected_patterns ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Service role has full access to detected_patterns" ON public.detected_patterns;
    CREATE POLICY "Service role has full access to detected_patterns" ON public.detected_patterns
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- 5. facts
ALTER TABLE public.facts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to facts" ON public.facts;
CREATE POLICY "Service role has full access to facts" ON public.facts
  FOR ALL USING (auth.role() = 'service_role');

-- 6. evidence
ALTER TABLE public.evidence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to evidence" ON public.evidence;
CREATE POLICY "Service role has full access to evidence" ON public.evidence
  FOR ALL USING (auth.role() = 'service_role');

-- 7. messages
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to messages" ON public.messages;
CREATE POLICY "Service role has full access to messages" ON public.messages
  FOR ALL USING (auth.role() = 'service_role');

-- 8. summaries
ALTER TABLE public.summaries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to summaries" ON public.summaries;
CREATE POLICY "Service role has full access to summaries" ON public.summaries
  FOR ALL USING (auth.role() = 'service_role');

-- 9. personality_snapshots
ALTER TABLE public.personality_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to personality_snapshots" ON public.personality_snapshots;
CREATE POLICY "Service role has full access to personality_snapshots" ON public.personality_snapshots
  FOR ALL USING (auth.role() = 'service_role');

-- 10. personality_statistics
ALTER TABLE public.personality_statistics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to personality_statistics" ON public.personality_statistics;
CREATE POLICY "Service role has full access to personality_statistics" ON public.personality_statistics
  FOR ALL USING (auth.role() = 'service_role');

-- 11. emotional_states
ALTER TABLE public.emotional_states ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to emotional_states" ON public.emotional_states;
CREATE POLICY "Service role has full access to emotional_states" ON public.emotional_states
  FOR ALL USING (auth.role() = 'service_role');

-- 12. context_adaptations
ALTER TABLE public.context_adaptations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to context_adaptations" ON public.context_adaptations;
CREATE POLICY "Service role has full access to context_adaptations" ON public.context_adaptations
  FOR ALL USING (auth.role() = 'service_role');

-- 13. autonomous_thoughts
ALTER TABLE public.autonomous_thoughts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to autonomous_thoughts" ON public.autonomous_thoughts;
CREATE POLICY "Service role has full access to autonomous_thoughts" ON public.autonomous_thoughts
  FOR ALL USING (auth.role() = 'service_role');

-- 14. research_tasks
ALTER TABLE public.research_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to research_tasks" ON public.research_tasks;
CREATE POLICY "Service role has full access to research_tasks" ON public.research_tasks
  FOR ALL USING (auth.role() = 'service_role');

-- 15. matt_state
ALTER TABLE public.matt_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to matt_state" ON public.matt_state;
CREATE POLICY "Service role has full access to matt_state" ON public.matt_state
  FOR ALL USING (auth.role() = 'service_role');

-- 16. matt_state_history
ALTER TABLE public.matt_state_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to matt_state_history" ON public.matt_state_history;
CREATE POLICY "Service role has full access to matt_state_history" ON public.matt_state_history
  FOR ALL USING (auth.role() = 'service_role');

-- 17. lucid_state
ALTER TABLE public.lucid_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to lucid_state" ON public.lucid_state;
CREATE POLICY "Service role has full access to lucid_state" ON public.lucid_state
  FOR ALL USING (auth.role() = 'service_role');

-- 18. agent_jobs
ALTER TABLE public.agent_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to agent_jobs" ON public.agent_jobs;
CREATE POLICY "Service role has full access to agent_jobs" ON public.agent_jobs
  FOR ALL USING (auth.role() = 'service_role');

-- 19. library_entries
ALTER TABLE public.library_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to library_entries" ON public.library_entries;
CREATE POLICY "Service role has full access to library_entries" ON public.library_entries
  FOR ALL USING (auth.role() = 'service_role');

-- 20. thought_notifications
ALTER TABLE public.thought_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to thought_notifications" ON public.thought_notifications;
CREATE POLICY "Service role has full access to thought_notifications" ON public.thought_notifications
  FOR ALL USING (auth.role() = 'service_role');

-- 21. multi_day_research_tasks
ALTER TABLE public.multi_day_research_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to multi_day_research_tasks" ON public.multi_day_research_tasks;
CREATE POLICY "Service role has full access to multi_day_research_tasks" ON public.multi_day_research_tasks
  FOR ALL USING (auth.role() = 'service_role');

-- 22. check_in_preferences
ALTER TABLE public.check_in_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to check_in_preferences" ON public.check_in_preferences;
CREATE POLICY "Service role has full access to check_in_preferences" ON public.check_in_preferences
  FOR ALL USING (auth.role() = 'service_role');

-- 23. temporal_state_observations
ALTER TABLE public.temporal_state_observations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to temporal_state_observations" ON public.temporal_state_observations;
CREATE POLICY "Service role has full access to temporal_state_observations" ON public.temporal_state_observations
  FOR ALL USING (auth.role() = 'service_role');

-- 24. task_conversations
ALTER TABLE public.task_conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to task_conversations" ON public.task_conversations;
CREATE POLICY "Service role has full access to task_conversations" ON public.task_conversations
  FOR ALL USING (auth.role() = 'service_role');

-- 25. check_in_schedule_log
ALTER TABLE public.check_in_schedule_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to check_in_schedule_log" ON public.check_in_schedule_log;
CREATE POLICY "Service role has full access to check_in_schedule_log" ON public.check_in_schedule_log
  FOR ALL USING (auth.role() = 'service_role');

-- 26. task_insights
ALTER TABLE public.task_insights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to task_insights" ON public.task_insights;
CREATE POLICY "Service role has full access to task_insights" ON public.task_insights
  FOR ALL USING (auth.role() = 'service_role');

-- 27. insight_interactions
ALTER TABLE public.insight_interactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to insight_interactions" ON public.insight_interactions;
CREATE POLICY "Service role has full access to insight_interactions" ON public.insight_interactions
  FOR ALL USING (auth.role() = 'service_role');

-- 28. insight_receptivity_patterns
ALTER TABLE public.insight_receptivity_patterns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to insight_receptivity_patterns" ON public.insight_receptivity_patterns;
CREATE POLICY "Service role has full access to insight_receptivity_patterns" ON public.insight_receptivity_patterns
  FOR ALL USING (auth.role() = 'service_role');

-- 29. versus_sessions (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'versus_sessions' AND table_schema = 'public') THEN
    ALTER TABLE public.versus_sessions ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Service role has full access to versus_sessions" ON public.versus_sessions;
    CREATE POLICY "Service role has full access to versus_sessions" ON public.versus_sessions
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- 30. conversations
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to conversations" ON public.conversations;
CREATE POLICY "Service role has full access to conversations" ON public.conversations
  FOR ALL USING (auth.role() = 'service_role');

-- 31. conversation_segments (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'conversation_segments' AND table_schema = 'public') THEN
    ALTER TABLE public.conversation_segments ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Service role has full access to conversation_segments" ON public.conversation_segments;
    CREATE POLICY "Service role has full access to conversation_segments" ON public.conversation_segments
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- 32. versus_messages (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'versus_messages' AND table_schema = 'public') THEN
    ALTER TABLE public.versus_messages ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Service role has full access to versus_messages" ON public.versus_messages;
    CREATE POLICY "Service role has full access to versus_messages" ON public.versus_messages
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- 33. research_queue
ALTER TABLE public.research_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to research_queue" ON public.research_queue;
CREATE POLICY "Service role has full access to research_queue" ON public.research_queue
  FOR ALL USING (auth.role() = 'service_role');

-- 34. immutable_facts
ALTER TABLE public.immutable_facts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to immutable_facts" ON public.immutable_facts;
CREATE POLICY "Service role has full access to immutable_facts" ON public.immutable_facts
  FOR ALL USING (auth.role() = 'service_role');

-- 35. orbits
ALTER TABLE public.orbits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to orbits" ON public.orbits;
CREATE POLICY "Service role has full access to orbits" ON public.orbits
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- NOTES
-- ============================================================================

-- Vector Extension Warning:
-- The 'vector' extension is in the public schema. Moving it to another schema
-- (like 'extensions') would require:
--   1. Dropping all existing vector indexes and columns
--   2. Moving the extension: ALTER EXTENSION vector SET SCHEMA extensions;
--   3. Recreating all vector columns and indexes with the new schema
-- This is a breaking change and should be done carefully in a separate migration.
-- For now, this warning can be accepted as a known limitation.

-- RLS Policy Notes:
-- The policies created here allow:
--   - service_role: Full access to all tables (for backend operations)
--   - authenticated users: Limited access based on their data (where applicable)
--
-- If you add client-side access (e.g., via anon key), you'll need to add more
-- granular policies for specific operations.

COMMENT ON FUNCTION public.update_research_queue_updated_at() IS 'Updates updated_at timestamp on research_queue changes';
COMMENT ON FUNCTION public.update_fact_confidence() IS 'Updates fact confidence based on evidence strength';
COMMENT ON FUNCTION public.archive_matt_state() IS 'Archives matt_state changes to history table';
COMMENT ON FUNCTION public.calculate_age_from_year(INTEGER) IS 'Calculates current age from birth year';
COMMENT ON FUNCTION public.update_lucid_state_timestamp() IS 'Updates lucid_state timestamp on changes';
COMMENT ON FUNCTION public.update_personality_statistics() IS 'Updates rolling personality statistics';
COMMENT ON FUNCTION public.set_time_of_day() IS 'Sets time_of_day based on conversation creation time';
COMMENT ON FUNCTION public.age_from_year_string(INTEGER) IS 'Returns age as text string from birth year';
COMMENT ON FUNCTION public.update_temporal_checkin_updated_at() IS 'Updates temporal check-in timestamps';
COMMENT ON FUNCTION public.update_orbits_timestamp() IS 'Updates orbits timestamp on changes';
COMMENT ON FUNCTION public.update_immutable_facts_updated_at() IS 'Updates immutable_facts timestamp on changes';
COMMENT ON FUNCTION public.increment_message_count() IS 'Increments message count on conversations';

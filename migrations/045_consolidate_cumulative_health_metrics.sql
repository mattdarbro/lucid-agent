-- Migration 045: Consolidate cumulative health metrics
--
-- The iOS app now sends daily totals for steps, active_energy, and exercise_minutes
-- (one row per day at midnight UTC) instead of individual HealthKit samples.
--
-- This migration consolidates any existing fragmented rows for these three metrics
-- into single daily-total rows to prevent double-counting in getDailySummary().
--
-- Groups by (user_id, metric_type, source, UTC day), sums the values, and
-- collapses into a single row with recorded_at set to midnight UTC of that day.
-- Only touches groups with more than one row; single-row days are left as-is.

-- Step 1: Capture consolidated data for groups that have multiple rows per day
CREATE TEMP TABLE _health_cumulative_consolidation AS
SELECT
  user_id,
  metric_type,
  source,
  DATE_TRUNC('day', recorded_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS day_midnight,
  SUM(value) AS total_value,
  (ARRAY_AGG(unit ORDER BY recorded_at DESC))[1] AS unit,
  (ARRAY_AGG(source_device ORDER BY recorded_at DESC))[1] AS source_device,
  (ARRAY_AGG(metadata ORDER BY recorded_at DESC))[1] AS metadata,
  MIN(created_at) AS created_at
FROM health_metrics
WHERE metric_type IN ('steps', 'active_energy', 'exercise_minutes')
GROUP BY user_id, metric_type, source, DATE_TRUNC('day', recorded_at AT TIME ZONE 'UTC')
HAVING COUNT(*) > 1;

-- Step 2: Delete all fragmented rows that belong to groups being consolidated
DELETE FROM health_metrics h
USING _health_cumulative_consolidation c
WHERE h.user_id = c.user_id
  AND h.metric_type = c.metric_type
  AND h.source = c.source
  AND DATE_TRUNC('day', h.recorded_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' = c.day_midnight
  AND h.metric_type IN ('steps', 'active_energy', 'exercise_minutes');

-- Step 3: Insert the consolidated daily-total rows
INSERT INTO health_metrics (user_id, metric_type, value, unit, recorded_at, source, source_device, metadata, created_at, updated_at)
SELECT
  user_id,
  metric_type,
  total_value,
  unit,
  day_midnight,
  source,
  source_device,
  metadata,
  created_at,
  NOW()
FROM _health_cumulative_consolidation;

-- Cleanup
DROP TABLE _health_cumulative_consolidation;

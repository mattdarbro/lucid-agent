-- Migration 043: Health Metrics
-- Stores health data synced from Apple HealthKit via the iOS app.
-- Designed to support blood pressure, weight, steps, heart rate, and other
-- biometric data Lucid uses for morning/evening health check-in loops.
--
-- Data flow:
--   iOS App reads HealthKit → POSTs to /v1/health/metrics → stored here
--   Lucid's health_check_morning/evening loops query this table
--
-- Future: Oura Ring data can flow through the same table via a different source.

CREATE TABLE IF NOT EXISTS health_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- What kind of metric (maps to HealthKit quantity/category types)
  metric_type VARCHAR(100) NOT NULL,
  -- e.g. 'blood_pressure_systolic', 'blood_pressure_diastolic',
  --      'weight', 'steps', 'heart_rate', 'resting_heart_rate',
  --      'blood_oxygen', 'respiratory_rate', 'body_temperature',
  --      'sleep_duration', 'active_energy', 'exercise_minutes'

  -- The numeric value
  value NUMERIC NOT NULL,

  -- Unit of measurement (lbs, bpm, mmHg, steps, hours, kcal, etc.)
  unit VARCHAR(50) NOT NULL,

  -- When the measurement was taken (from HealthKit sample date)
  recorded_at TIMESTAMPTZ NOT NULL,

  -- Where the data came from
  source VARCHAR(50) NOT NULL DEFAULT 'apple_health',
  -- e.g. 'apple_health', 'oura_ring', 'manual', 'withings'

  -- Optional: device or app that produced the reading
  source_device VARCHAR(200),

  -- Flexible metadata (e.g. HealthKit sample UUID, context notes)
  metadata JSONB DEFAULT '{}',

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Primary query pattern: get metrics for a user by type and date range
CREATE INDEX IF NOT EXISTS idx_health_metrics_user_type_date
  ON health_metrics(user_id, metric_type, recorded_at DESC);

-- Query pattern: get all metrics for a user on a specific day
CREATE INDEX IF NOT EXISTS idx_health_metrics_user_date
  ON health_metrics(user_id, recorded_at DESC);

-- Prevent duplicate imports (same user, type, timestamp, source)
CREATE UNIQUE INDEX IF NOT EXISTS idx_health_metrics_dedup
  ON health_metrics(user_id, metric_type, recorded_at, source);

-- Add health check job types to agent_jobs
-- (The job_type column is VARCHAR so no ALTER needed, but we update the
--  check constraint if one exists. In this schema it's enforced at app level.)

-- Add health_review to library_entries entry_type
-- (entry_type is VARCHAR so no schema change needed, just app-level support)

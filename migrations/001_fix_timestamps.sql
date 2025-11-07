-- Migration: Fix timestamp columns to include timezone
-- This fixes the time_of_day calculation bug

-- Conversations
ALTER TABLE conversations
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC',
  ALTER COLUMN ended_at TYPE TIMESTAMPTZ USING ended_at AT TIME ZONE 'UTC';

-- Users
ALTER TABLE users
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN last_active_at TYPE TIMESTAMPTZ USING last_active_at AT TIME ZONE 'UTC';

-- Messages
ALTER TABLE messages
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

-- Facts
ALTER TABLE facts
  ALTER COLUMN first_mentioned_at TYPE TIMESTAMPTZ USING first_mentioned_at AT TIME ZONE 'UTC',
  ALTER COLUMN last_mentioned_at TYPE TIMESTAMPTZ USING last_mentioned_at AT TIME ZONE 'UTC',
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

-- Evidence
ALTER TABLE evidence
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

-- Summaries
ALTER TABLE summaries
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

-- Personality Snapshots
ALTER TABLE personality_snapshots
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

-- Personality Statistics
ALTER TABLE personality_statistics
  ALTER COLUMN last_updated TYPE TIMESTAMPTZ USING last_updated AT TIME ZONE 'UTC',
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

-- Emotional States
ALTER TABLE emotional_states
  ALTER COLUMN detected_at TYPE TIMESTAMPTZ USING detected_at AT TIME ZONE 'UTC',
  ALTER COLUMN resolved_at TYPE TIMESTAMPTZ USING resolved_at AT TIME ZONE 'UTC',
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

-- Context Adaptations
ALTER TABLE context_adaptations
  ALTER COLUMN active_from TYPE TIMESTAMPTZ USING active_from AT TIME ZONE 'UTC',
  ALTER COLUMN active_until TYPE TIMESTAMPTZ USING active_until AT TIME ZONE 'UTC',
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

-- Autonomous Thoughts
ALTER TABLE autonomous_thoughts
  ALTER COLUMN shared_at TYPE TIMESTAMPTZ USING shared_at AT TIME ZONE 'UTC',
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

-- Research Tasks
ALTER TABLE research_tasks
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN started_at TYPE TIMESTAMPTZ USING started_at AT TIME ZONE 'UTC',
  ALTER COLUMN completed_at TYPE TIMESTAMPTZ USING completed_at AT TIME ZONE 'UTC';

-- Agent Jobs
ALTER TABLE agent_jobs
  ALTER COLUMN scheduled_for TYPE TIMESTAMPTZ USING scheduled_for AT TIME ZONE 'UTC',
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN started_at TYPE TIMESTAMPTZ USING started_at AT TIME ZONE 'UTC',
  ALTER COLUMN completed_at TYPE TIMESTAMPTZ USING completed_at AT TIME ZONE 'UTC';

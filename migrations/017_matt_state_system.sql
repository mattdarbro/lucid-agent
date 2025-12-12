-- Migration 017: Matt State System
-- Creates the "Wins" artifact - tracking Matt's current life situation
-- Enables state-aware conversations and state session AT

-- ============================================================================
-- MATT STATE TABLE (The "Wins" Artifact)
-- ============================================================================

CREATE TABLE IF NOT EXISTS matt_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Current state snapshot
  active_goals JSONB DEFAULT '[]'::jsonb,      -- Array of goal objects
  active_commitments JSONB DEFAULT '[]'::jsonb, -- Current responsibilities
  resources JSONB DEFAULT '{}'::jsonb,          -- Time, money, skills
  constraints JSONB DEFAULT '{}'::jsonb,        -- Limitations, concerns
  values_priorities JSONB DEFAULT '{}'::jsonb,  -- What matters most

  -- Metadata
  confidence DECIMAL(4,3) DEFAULT 0.500,
  last_updated_by TEXT CHECK (last_updated_by IN ('user', 'state_session', 'conversation')),

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  -- Only one active state per user
  CONSTRAINT unique_user_matt_state UNIQUE (user_id)
);

-- Indexes for matt_state
CREATE INDEX idx_matt_state_user ON matt_state(user_id);
CREATE INDEX idx_matt_state_updated ON matt_state(updated_at DESC);

-- ============================================================================
-- MATT STATE HISTORY (Audit Trail)
-- ============================================================================

CREATE TABLE IF NOT EXISTS matt_state_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state_snapshot JSONB NOT NULL,     -- Full state at this point
  changes_summary TEXT,              -- What changed
  updated_by TEXT,                   -- 'user' or 'state_session'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for history
CREATE INDEX idx_state_history_user_time ON matt_state_history(user_id, created_at DESC);

-- ============================================================================
-- AUTO-ARCHIVE TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION archive_matt_state()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO matt_state_history (user_id, state_snapshot, changes_summary, updated_by)
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
$$ LANGUAGE plpgsql;

-- Drop trigger if exists to allow re-running migration
DROP TRIGGER IF EXISTS matt_state_archive ON matt_state;

CREATE TRIGGER matt_state_archive
  BEFORE UPDATE ON matt_state
  FOR EACH ROW
  EXECUTE FUNCTION archive_matt_state();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE matt_state IS 'Current life situation snapshot - the "Wins" artifact. Goals, commitments, resources, constraints.';
COMMENT ON TABLE matt_state_history IS 'Audit trail of state changes for historical tracking and reflection.';
COMMENT ON COLUMN matt_state.active_goals IS 'Array of { goal: string, timeline?: string, progress?: string }';
COMMENT ON COLUMN matt_state.active_commitments IS 'Array of { commitment: string, frequency?: string, impact?: string }';
COMMENT ON COLUMN matt_state.resources IS 'Object: { time_budget?, financial_runway?, skills?: [], support?: [] }';
COMMENT ON COLUMN matt_state.constraints IS 'Object: { api_costs?, technical_debt?: [], health?, other?: [] }';
COMMENT ON COLUMN matt_state.values_priorities IS 'Object: { top_values?: [], current_focus? }';

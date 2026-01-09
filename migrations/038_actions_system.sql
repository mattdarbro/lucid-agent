-- Migration 038: Actions System
-- Creates the actions table for task/reminder tracking from Capture
-- Part of the simplified Lucid design (Phase 1)

-- ============================================================================
-- ACTIONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Action content
  content TEXT NOT NULL,
  summary TEXT,  -- AI-cleaned version of content

  -- Status tracking
  status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'done', 'cancelled')),

  -- Optional link to a person in orbits
  person_id UUID REFERENCES orbits(id) ON DELETE SET NULL,

  -- Source tracking (for capture routing)
  source VARCHAR(50) DEFAULT 'capture',  -- 'capture', 'conversation', 'briefing'

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX idx_actions_user ON actions(user_id);
CREATE INDEX idx_actions_user_status ON actions(user_id, status);
CREATE INDEX idx_actions_user_open ON actions(user_id) WHERE status = 'open';
CREATE INDEX idx_actions_person ON actions(person_id) WHERE person_id IS NOT NULL;
CREATE INDEX idx_actions_created ON actions(user_id, created_at DESC);

-- ============================================================================
-- UPDATE TIMESTAMP TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION update_actions_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := CURRENT_TIMESTAMP;
  -- Set completed_at when status changes to done
  IF NEW.status = 'done' AND (OLD.status IS NULL OR OLD.status != 'done') THEN
    NEW.completed_at := CURRENT_TIMESTAMP;
  END IF;
  -- Clear completed_at if status changes back from done
  IF NEW.status != 'done' AND OLD.status = 'done' THEN
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS actions_update_timestamp ON actions;

CREATE TRIGGER actions_update_timestamp
  BEFORE UPDATE ON actions
  FOR EACH ROW
  EXECUTE FUNCTION update_actions_timestamp();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE public.actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role has full access to actions" ON public.actions;
CREATE POLICY "Service role has full access to actions" ON public.actions
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE actions IS 'User actions/tasks/reminders captured via the Capture system';
COMMENT ON COLUMN actions.content IS 'Original content from user capture';
COMMENT ON COLUMN actions.summary IS 'AI-cleaned version of the action';
COMMENT ON COLUMN actions.status IS 'open = active, done = completed, cancelled = dismissed';
COMMENT ON COLUMN actions.person_id IS 'Optional link to orbit person if action relates to someone';
COMMENT ON COLUMN actions.source IS 'Where this action originated from';

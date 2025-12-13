-- Migration 020: Research Queue System
-- Bridge between chat (where ideas surface) and AT (where research happens)
-- Enables user guidance: LUCID proposes, Matt approves/redirects

-- Research queue table
CREATE TABLE IF NOT EXISTS research_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- What to research
  topic TEXT NOT NULL,
  search_query TEXT,
  why_it_matters TEXT,

  -- Source tracking
  source_conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  source_snippet TEXT,

  -- Priority & frequency
  priority INTEGER DEFAULT 5 CHECK (priority >= 1 AND priority <= 10),
  times_mentioned INTEGER DEFAULT 1,

  -- Status tracking
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending',      -- Waiting for user review
    'approved',     -- User approved for research
    'in_progress',  -- AT is currently researching
    'completed',    -- Research finished
    'not_useful',   -- Research completed but wasn't helpful
    'abandoned'     -- User rejected or gave up
  )),

  -- User approval flow
  user_approved BOOLEAN DEFAULT false,
  user_rejected BOOLEAN DEFAULT false,
  approved_at TIMESTAMP WITH TIME ZONE,
  rejected_at TIMESTAMP WITH TIME ZONE,

  -- Results tracking
  search_was_useful BOOLEAN,
  insights_generated TEXT,
  completed_at TIMESTAMP WITH TIME ZONE,

  -- Anti-repetition
  last_attempted_at TIMESTAMP WITH TIME ZONE,
  attempt_count INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,

  -- Surfacing tracking
  last_surfaced_at TIMESTAMP WITH TIME ZONE,
  times_surfaced INTEGER DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_research_queue_user_status
  ON research_queue(user_id, status);

CREATE INDEX IF NOT EXISTS idx_research_queue_user_pending
  ON research_queue(user_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_research_queue_user_approved
  ON research_queue(user_id)
  WHERE status = 'approved' AND user_approved = true;

CREATE INDEX IF NOT EXISTS idx_research_queue_created
  ON research_queue(created_at DESC);

-- Add surface research flag to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS should_surface_research BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_research_surfaced_at TIMESTAMP WITH TIME ZONE;

-- Update trigger for updated_at
CREATE OR REPLACE FUNCTION update_research_queue_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_research_queue_updated_at ON research_queue;
CREATE TRIGGER trigger_research_queue_updated_at
  BEFORE UPDATE ON research_queue
  FOR EACH ROW
  EXECUTE FUNCTION update_research_queue_updated_at();

-- View for active research items (not completed/abandoned)
CREATE OR REPLACE VIEW active_research_queue AS
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

COMMENT ON TABLE research_queue IS 'Research queue bridging chat insights and autonomous thinking';
COMMENT ON COLUMN research_queue.topic IS 'Brief description of what to research';
COMMENT ON COLUMN research_queue.search_query IS 'Suggested search terms for web research';
COMMENT ON COLUMN research_queue.why_it_matters IS 'Why this topic matters to the user';
COMMENT ON COLUMN research_queue.source_snippet IS 'The conversation excerpt that sparked this research idea';
COMMENT ON COLUMN research_queue.priority IS 'Priority 1-10, higher = more important';
COMMENT ON COLUMN research_queue.times_mentioned IS 'How often this topic has come up in conversation';

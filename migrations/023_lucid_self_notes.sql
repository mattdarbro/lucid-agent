-- Lucid Self Notes - Enabling Lucid Self-Evolution
-- Lucid can write notes to himself that influence future prompts

CREATE TABLE IF NOT EXISTS lucid_self_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Note type and content
  note_type VARCHAR(50) NOT NULL CHECK (note_type IN (
    'prompt_preference',   -- Learned preferences about how to respond
    'self_insight',        -- Realizations about himself
    'evolution_note',      -- Notes about how he's changing
    'question',            -- Questions Lucid is sitting with
    'blindspot',           -- Areas where Lucid recognizes limitations
    'identity_proposal'    -- Proposed changes to core identity (needs approval)
  )),
  content TEXT NOT NULL,
  context TEXT,            -- What prompted this note

  -- Status
  is_active BOOLEAN DEFAULT true,
  is_approved BOOLEAN DEFAULT true,  -- For identity proposals, defaults false
  approved_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_lucid_self_notes_user_id ON lucid_self_notes(user_id);
CREATE INDEX IF NOT EXISTS idx_lucid_self_notes_type ON lucid_self_notes(note_type);
CREATE INDEX IF NOT EXISTS idx_lucid_self_notes_active ON lucid_self_notes(user_id, is_active, is_approved);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_lucid_self_notes_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS lucid_self_notes_updated_at ON lucid_self_notes;
CREATE TRIGGER lucid_self_notes_updated_at
  BEFORE UPDATE ON lucid_self_notes
  FOR EACH ROW
  EXECUTE FUNCTION update_lucid_self_notes_timestamp();

-- View for active notes per user
CREATE OR REPLACE VIEW active_lucid_notes AS
SELECT
  lsn.*,
  u.name as user_name
FROM lucid_self_notes lsn
JOIN users u ON lsn.user_id = u.id
WHERE lsn.is_active = true AND lsn.is_approved = true
ORDER BY lsn.created_at DESC;

-- View for pending identity proposals
CREATE OR REPLACE VIEW pending_identity_proposals AS
SELECT
  lsn.*,
  u.name as user_name
FROM lucid_self_notes lsn
JOIN users u ON lsn.user_id = u.id
WHERE lsn.note_type = 'identity_proposal'
  AND lsn.is_active = true
  AND lsn.is_approved = false
ORDER BY lsn.created_at DESC;

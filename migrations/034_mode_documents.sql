-- Migration: Mode Documents System
-- Living markdown documents for each mode to provide persistent context
-- Modes: me, lucid, others, possibilities, state (chat has no document - ephemeral)

-- Create mode_documents table
CREATE TABLE IF NOT EXISTS mode_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('me', 'lucid', 'others', 'possibilities', 'state')),
  content TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_by TEXT DEFAULT 'system' CHECK (updated_by IN ('user', 'lucid', 'agent', 'system')),
  version INTEGER DEFAULT 1,
  UNIQUE(user_id, mode)
);

-- Index for quick lookups by user and mode
CREATE INDEX IF NOT EXISTS idx_mode_documents_user_mode
ON mode_documents(user_id, mode);

-- Track document history for versioning/rollback
CREATE TABLE IF NOT EXISTS mode_document_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES mode_documents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  content TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for history lookups
CREATE INDEX IF NOT EXISTS idx_mode_document_history_document
ON mode_document_history(document_id, version DESC);

-- Function to auto-save history on update
CREATE OR REPLACE FUNCTION save_mode_document_history()
RETURNS TRIGGER AS $$
BEGIN
  -- Only save history if content actually changed
  IF OLD.content IS DISTINCT FROM NEW.content THEN
    INSERT INTO mode_document_history (document_id, user_id, mode, content, version, updated_by)
    VALUES (OLD.id, OLD.user_id, OLD.mode, OLD.content, OLD.version, OLD.updated_by);

    -- Increment version
    NEW.version := OLD.version + 1;
  END IF;

  -- Always update timestamp
  NEW.updated_at := NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to save history before updates
DROP TRIGGER IF EXISTS mode_document_history_trigger ON mode_documents;
CREATE TRIGGER mode_document_history_trigger
BEFORE UPDATE ON mode_documents
FOR EACH ROW
EXECUTE FUNCTION save_mode_document_history();

-- Comments for documentation
COMMENT ON TABLE mode_documents IS
'Living markdown documents providing persistent context for each chat mode. Chat mode has no document (ephemeral).';

COMMENT ON COLUMN mode_documents.mode IS
'The chat mode this document belongs to: me (user flourishing), lucid (self-reflection), others (orbit), possibilities (exploration), state (goals/vision)';

COMMENT ON COLUMN mode_documents.updated_by IS
'Who last updated this document: user (direct edit), lucid (during conversation), agent (autonomous), system (initialization)';

COMMENT ON TABLE mode_document_history IS
'Version history for mode documents, allowing rollback and tracking changes over time';

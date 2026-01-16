-- Migration: Living Document System
-- Lucid's working memory - notes he keeps to himself about what's important
-- This replaces the mode_documents system with a single unified document per user

-- Create living_document table
CREATE TABLE IF NOT EXISTS living_document (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  version INTEGER DEFAULT 1,
  UNIQUE(user_id)
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_living_document_user
ON living_document(user_id);

-- Track document history for versioning
CREATE TABLE IF NOT EXISTS living_document_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES living_document(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for history lookups
CREATE INDEX IF NOT EXISTS idx_living_document_history_document
ON living_document_history(document_id, version DESC);

-- Function to auto-save history on update
CREATE OR REPLACE FUNCTION save_living_document_history()
RETURNS TRIGGER AS $$
BEGIN
  -- Only save history if content actually changed
  IF OLD.content IS DISTINCT FROM NEW.content THEN
    INSERT INTO living_document_history (document_id, user_id, content, version)
    VALUES (OLD.id, OLD.user_id, OLD.content, OLD.version);

    -- Increment version
    NEW.version := OLD.version + 1;
  END IF;

  -- Always update timestamp
  NEW.updated_at := NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to save history before updates
DROP TRIGGER IF EXISTS living_document_history_trigger ON living_document;
CREATE TRIGGER living_document_history_trigger
BEFORE UPDATE ON living_document
FOR EACH ROW
EXECUTE FUNCTION save_living_document_history();

-- Comments for documentation
COMMENT ON TABLE living_document IS
'Lucid''s working memory - notes he keeps about what''s important to remember. One document per user, maintained by Lucid via Document Reflection AT sessions.';

COMMENT ON TABLE living_document_history IS
'Version history for living documents, allowing rollback if needed';

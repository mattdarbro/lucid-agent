-- Migration 013: Library Enhancements
-- Adds missing entry types and embedding support for semantic search

-- ============================================================================
-- UPDATE ENTRY_TYPE CONSTRAINT
-- ============================================================================

-- Drop the existing constraint and add a new one with all entry types
ALTER TABLE library_entries
  DROP CONSTRAINT IF EXISTS library_entries_entry_type_check;

ALTER TABLE library_entries
  ADD CONSTRAINT library_entries_entry_type_check
  CHECK (entry_type IN (
    'lucid_thought',      -- LUCID's deep thinking
    'user_reflection',    -- User's long-form writing
    'versus_synthesis',   -- Debate summaries from Lu & Cid
    'research_journal'    -- User's observations about LUCID
  ));

-- ============================================================================
-- ADD EMBEDDING COLUMN FOR SEMANTIC SEARCH
-- ============================================================================

-- Ensure pgvector extension is enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column (1536 dimensions for OpenAI ada-002 / Claude embeddings)
ALTER TABLE library_entries
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Create index for fast similarity search
CREATE INDEX IF NOT EXISTS idx_library_embedding
  ON library_entries USING ivfflat (embedding vector_cosine_ops);

-- ============================================================================
-- UPDATE COMMENTS
-- ============================================================================

COMMENT ON COLUMN library_entries.entry_type IS
  'lucid_thought = AI-generated insight, user_reflection = user-written entry, versus_synthesis = debate summary, research_journal = user observations about LUCID';

COMMENT ON COLUMN library_entries.embedding IS
  'Vector embedding for semantic search across library entries';

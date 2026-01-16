-- Migration 010: Add Fact Extraction Tracking
-- Adds column to track when facts were last extracted from conversations
-- Enables automatic background fact extraction

-- ============================================================================
-- ADD TRACKING COLUMN TO CONVERSATIONS
-- ============================================================================

-- Track when facts were last extracted from this conversation
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS last_fact_extraction_at TIMESTAMP;

-- Index for efficient querying of conversations needing extraction
CREATE INDEX IF NOT EXISTS idx_conversations_fact_extraction
  ON conversations(last_fact_extraction_at NULLS FIRST, updated_at DESC)
  WHERE is_active = true;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON COLUMN conversations.last_fact_extraction_at IS 'When facts were last extracted from this conversation. NULL means never extracted.';

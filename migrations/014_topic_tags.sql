-- Migration 014: Topic Tags (Conversation Segments)
-- Enables visual topic segmentation in chat with colored backgrounds

-- ============================================================================
-- CONVERSATION SEGMENTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS conversation_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,

  -- Topic identification
  topic_tag TEXT NOT NULL,
  background_color TEXT, -- Hex color for UI (e.g., '#FFF5E6')

  -- Temporal bounds
  started_at TIMESTAMP DEFAULT NOW(),
  ended_at TIMESTAMP, -- NULL means segment is still active

  -- Metadata
  detection_method TEXT CHECK (detection_method IN ('explicit_hashtag', 'time_gap', 'semantic_shift', 'manual')),
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Indexes
CREATE INDEX idx_segments_conversation ON conversation_segments(conversation_id, started_at);
CREATE INDEX idx_segments_topic ON conversation_segments(topic_tag);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE conversation_segments IS 'Tracks topic segments within conversations for visual organization';
COMMENT ON COLUMN conversation_segments.topic_tag IS 'Short tag describing the topic (e.g., "career", "health", "project-x")';
COMMENT ON COLUMN conversation_segments.background_color IS 'Subtle background color for this topic segment in the UI';
COMMENT ON COLUMN conversation_segments.detection_method IS 'How the topic shift was detected: explicit #tag, time gap, semantic analysis, or manual';

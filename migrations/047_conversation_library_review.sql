-- Add last_library_review_at column to conversations table
-- Used by the async conversation review job to track which conversations
-- have been reviewed for potential Library entries

ALTER TABLE conversations
ADD COLUMN IF NOT EXISTS last_library_review_at TIMESTAMPTZ;

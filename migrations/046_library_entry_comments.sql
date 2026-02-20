-- Library Entry Comments
-- Short, tweet-like comments on library entries from both Matt and Lucid.
-- The Library is for artifacts (deep work). Comments are the focused discussion layer.

CREATE TABLE IF NOT EXISTS library_entry_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_entry_id UUID NOT NULL REFERENCES library_entries(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'user' = Matt wrote this, 'lucid' = Lucid wrote this
  author_type TEXT NOT NULL CHECK (author_type IN ('user', 'lucid')),
  content TEXT NOT NULL,
  -- Optional: metadata for context (e.g., what triggered the comment)
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for fetching comments for an entry (most common query)
CREATE INDEX IF NOT EXISTS idx_library_entry_comments_entry_id
  ON library_entry_comments(library_entry_id, created_at ASC);

-- Index for fetching all comments by a user
CREATE INDEX IF NOT EXISTS idx_library_entry_comments_user_id
  ON library_entry_comments(user_id, created_at DESC);

-- Add comment_count to library_entries for quick access
-- (denormalized, but avoids COUNT(*) on every entry list)
ALTER TABLE library_entries ADD COLUMN IF NOT EXISTS comment_count INTEGER DEFAULT 0;

-- =============================================================================
-- Fix: Add missing metadata column to conversations table
-- This fixes the iOS coordination error
-- Safe to run multiple times (uses IF NOT EXISTS)
-- =============================================================================

-- Add the missing metadata column
ALTER TABLE conversations
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- Verify the fix
SELECT
  column_name,
  data_type,
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'conversations'
  AND column_name IN ('metadata', 'conversation_context', 'related_task_id', 'related_insight_id')
ORDER BY column_name;

-- If you see the metadata column listed above, the fix was successful!

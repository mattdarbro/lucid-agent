-- Migration: Chat Modes System
-- Replaces Haiku-based routing with user-controlled mental models
-- Modes: chat, me, lucid, others, possibilities, state

-- Add current_mode column to conversations
ALTER TABLE conversations
ADD COLUMN IF NOT EXISTS current_mode TEXT DEFAULT 'chat';

-- Create enum-like check constraint for valid modes
ALTER TABLE conversations
ADD CONSTRAINT valid_chat_mode
CHECK (current_mode IN ('chat', 'me', 'lucid', 'others', 'possibilities', 'state'));

-- Index for quick mode lookups
CREATE INDEX IF NOT EXISTS idx_conversations_current_mode
ON conversations(current_mode);

-- Comment for documentation
COMMENT ON COLUMN conversations.current_mode IS
'User-controlled mental model for Lucid. Modes: chat (light), me (user flourishing), lucid (Lucid self-reflection), others (orbit flourishing), possibilities (expand thinking), state (vision/goals)';

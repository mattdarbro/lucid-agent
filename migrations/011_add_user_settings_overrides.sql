-- Migration 011: Add User Settings Overrides
-- Allows users to override individual profile settings without changing their profile
-- Useful for testing and fine-grained control from iOS app

-- ============================================================================
-- ADD SETTINGS OVERRIDES COLUMN
-- ============================================================================

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS settings_overrides JSONB DEFAULT '{}'::jsonb;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON COLUMN user_profiles.settings_overrides IS 'User-specific setting overrides. Merged with base profile. Structure: { features: {...}, memory: {...}, chat: {...} }';

-- Example usage:
-- To disable fact extraction for a user:
-- UPDATE user_profiles SET settings_overrides = '{"memory": {"factExtraction": false}}'::jsonb WHERE user_id = '...';
--
-- To disable memory system entirely:
-- UPDATE user_profiles SET settings_overrides = '{"features": {"memorySystem": false}}'::jsonb WHERE user_id = '...';

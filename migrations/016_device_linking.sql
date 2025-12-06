-- ============================================================================
-- Migration 016: Device Linking System
-- Allows users to link multiple devices to the same account
-- ============================================================================

-- Track individual devices for each user
CREATE TABLE IF NOT EXISTS user_devices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,

  -- Device identification
  device_id VARCHAR(255) NOT NULL,  -- Unique device identifier from iOS
  device_name TEXT,                  -- User-friendly name (e.g., "Matt's iPhone", "iPad Pro")
  device_type VARCHAR(50),           -- 'iphone', 'ipad', 'web'

  -- Push notifications per device
  push_token TEXT,
  push_token_updated_at TIMESTAMP,

  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  last_seen_at TIMESTAMP DEFAULT NOW(),

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(device_id)
);

CREATE INDEX idx_user_devices_user ON user_devices(user_id);
CREATE INDEX idx_user_devices_device ON user_devices(device_id);
CREATE INDEX idx_user_devices_active ON user_devices(user_id, is_active) WHERE is_active = true;

-- Link codes for connecting devices to existing accounts
CREATE TABLE IF NOT EXISTS device_link_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,

  -- The code itself (6 alphanumeric characters, easy to type)
  code VARCHAR(10) UNIQUE NOT NULL,

  -- Security
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  used_by_device_id VARCHAR(255),

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_link_codes_code ON device_link_codes(code) WHERE used_at IS NULL;
CREATE INDEX idx_link_codes_user ON device_link_codes(user_id);

-- Add current_device_id to track which device sent a message
ALTER TABLE messages
ADD COLUMN IF NOT EXISTS device_id VARCHAR(255);

-- Add origin_device to autonomous_thoughts so Lucid knows where to send notifications
ALTER TABLE autonomous_thoughts
ADD COLUMN IF NOT EXISTS target_devices TEXT[];  -- Which devices to notify

-- ============================================================================
-- Helper function to generate link codes
-- ============================================================================

CREATE OR REPLACE FUNCTION generate_link_code()
RETURNS VARCHAR(10) AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- Removed confusing chars (0, O, 1, I)
  result VARCHAR(10) := '';
  i INT;
BEGIN
  FOR i IN 1..6 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- End of Migration
-- ============================================================================

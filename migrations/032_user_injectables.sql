-- Migration 032: User Injectables
-- Replaces the rigid immutable_facts system with 3 user-controlled text fields
-- Users can write anything they want Lucid to always know about them

-- Add 3 injectable text fields to the users table
-- Each field allows up to ~300 words (2000 characters provides comfortable margin)
ALTER TABLE users ADD COLUMN IF NOT EXISTS injectable_1 TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS injectable_2 TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS injectable_3 TEXT;

-- Optional: Users can title their injectables for clarity in the UI
ALTER TABLE users ADD COLUMN IF NOT EXISTS injectable_1_title VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS injectable_2_title VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS injectable_3_title VARCHAR(100);

-- Track when injectables were last updated (for potential graduation to long-term memory)
ALTER TABLE users ADD COLUMN IF NOT EXISTS injectables_updated_at TIMESTAMP WITH TIME ZONE;

-- Create a trigger to update the timestamp when any injectable changes
CREATE OR REPLACE FUNCTION update_injectables_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  IF (OLD.injectable_1 IS DISTINCT FROM NEW.injectable_1) OR
     (OLD.injectable_2 IS DISTINCT FROM NEW.injectable_2) OR
     (OLD.injectable_3 IS DISTINCT FROM NEW.injectable_3) THEN
    NEW.injectables_updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_injectables_updated ON users;
CREATE TRIGGER trigger_injectables_updated
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_injectables_timestamp();

COMMENT ON COLUMN users.injectable_1 IS 'User-defined context field 1 - always included in Lucid prompts';
COMMENT ON COLUMN users.injectable_2 IS 'User-defined context field 2 - always included in Lucid prompts';
COMMENT ON COLUMN users.injectable_3 IS 'User-defined context field 3 - always included in Lucid prompts';
COMMENT ON COLUMN users.injectable_1_title IS 'Optional user-defined title for injectable 1';
COMMENT ON COLUMN users.injectable_2_title IS 'Optional user-defined title for injectable 2';
COMMENT ON COLUMN users.injectable_3_title IS 'Optional user-defined title for injectable 3';
COMMENT ON COLUMN users.injectables_updated_at IS 'Timestamp of last injectable content change';

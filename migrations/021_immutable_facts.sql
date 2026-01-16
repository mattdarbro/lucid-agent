-- Migration 021: Immutable Facts System
-- Core identity facts that should always be included in LUCID's context
-- These are the foundational facts about the user that define who they are

-- Immutable facts table (separate from regular facts for guaranteed inclusion)
CREATE TABLE IF NOT EXISTS immutable_facts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Content
  content TEXT NOT NULL,

  -- Categorization
  category TEXT NOT NULL CHECK (category IN (
    'name',           -- User's name
    'identity',       -- Core identity traits
    'biography',      -- Major life facts
    'relationship',   -- Key relationships (spouse, children)
    'profession'      -- Career/professional identity
  )),

  -- Ordering within category
  display_order INTEGER DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for efficient retrieval
CREATE INDEX IF NOT EXISTS idx_immutable_facts_user
  ON immutable_facts(user_id, category, display_order);

-- Also add is_immutable flag to existing facts table for flexibility
ALTER TABLE facts ADD COLUMN IF NOT EXISTS is_immutable BOOLEAN DEFAULT false;

-- Update trigger
CREATE OR REPLACE FUNCTION update_immutable_facts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_immutable_facts_updated_at ON immutable_facts;
CREATE TRIGGER trigger_immutable_facts_updated_at
  BEFORE UPDATE ON immutable_facts
  FOR EACH ROW
  EXECUTE FUNCTION update_immutable_facts_updated_at();

-- View combining immutable facts with high-confidence regular facts
CREATE OR REPLACE VIEW core_identity_facts AS
SELECT * FROM (
  SELECT
    id,
    user_id,
    content,
    category,
    'immutable' as source,
    1.0::numeric as confidence,
    display_order
  FROM immutable_facts
  UNION ALL
  SELECT
    id,
    user_id,
    content,
    category,
    'fact' as source,
    confidence,
    0 as display_order
  FROM facts
  WHERE is_immutable = true AND is_active = true
) combined
ORDER BY
  CASE category
    WHEN 'name' THEN 1
    WHEN 'identity' THEN 2
    WHEN 'biography' THEN 3
    WHEN 'profession' THEN 4
    WHEN 'relationship' THEN 5
    ELSE 6
  END,
  display_order,
  confidence DESC;

COMMENT ON TABLE immutable_facts IS 'Core identity facts that are always included in context';
COMMENT ON COLUMN immutable_facts.category IS 'Category of immutable fact for organization';
COMMENT ON COLUMN immutable_facts.display_order IS 'Order within category for consistent presentation';

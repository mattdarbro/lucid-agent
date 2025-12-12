-- Migration 018: LUCID State and Orbits System
-- Creates LUCID's self-awareness state and relationship ecosystem tracking
-- Enables self-reflective AI and orbit session AT

-- ============================================================================
-- LUCID STATE TABLE (Self-Awareness)
-- ============================================================================

CREATE TABLE IF NOT EXISTS lucid_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Self-awareness
  current_understanding JSONB DEFAULT '{}'::jsonb,    -- What I know about the user
  confidence_levels JSONB DEFAULT '{}'::jsonb,        -- Where I'm confident/uncertain
  areas_needing_witnessing JSONB DEFAULT '[]'::jsonb, -- What I need to learn
  evolution_notes TEXT,                                -- How I'm developing as a witness

  -- Current focus
  active_questions JSONB DEFAULT '[]'::jsonb,         -- What I'm curious about
  recent_insights JSONB DEFAULT '[]'::jsonb,          -- Recent discoveries

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT unique_lucid_state_per_user UNIQUE (user_id)
);

-- Indexes for lucid_state
CREATE INDEX idx_lucid_state_user ON lucid_state(user_id);
CREATE INDEX idx_lucid_state_updated ON lucid_state(updated_at DESC);

-- ============================================================================
-- ORBITS TABLE (Relationship Ecosystem)
-- ============================================================================

CREATE TABLE IF NOT EXISTS orbits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Person identity
  person_name TEXT NOT NULL,
  relationship TEXT,                                   -- 'family', 'patient', 'collaborator', etc.

  -- Their state (through user's lens)
  current_situation JSONB DEFAULT '{}'::jsonb,        -- What they're dealing with
  recent_interactions JSONB DEFAULT '[]'::jsonb,      -- Recent mentions/updates

  -- User's perspective
  how_this_affects_user TEXT,                         -- Impact on user's life
  last_discussed_at TIMESTAMP WITH TIME ZONE,

  -- Orbit tier (inner circle vs periphery)
  orbit_tier TEXT DEFAULT 'outer' CHECK (orbit_tier IN ('inner', 'mid', 'outer')),

  -- Status
  is_active BOOLEAN DEFAULT TRUE,

  -- Timestamps
  first_mentioned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  last_mentioned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for orbits
CREATE INDEX idx_orbits_user ON orbits(user_id);
CREATE INDEX idx_orbits_active ON orbits(user_id, is_active) WHERE is_active = TRUE;
CREATE INDEX idx_orbits_tier ON orbits(user_id, orbit_tier);
CREATE INDEX idx_orbits_last_discussed ON orbits(user_id, last_discussed_at DESC);
CREATE INDEX idx_orbits_last_mentioned ON orbits(user_id, last_mentioned_at DESC);

-- Unique constraint on person_name per user (case-insensitive)
CREATE UNIQUE INDEX idx_orbits_unique_person ON orbits(user_id, LOWER(person_name)) WHERE is_active = TRUE;

-- ============================================================================
-- UPDATE TIMESTAMP TRIGGER FOR LUCID STATE
-- ============================================================================

CREATE OR REPLACE FUNCTION update_lucid_state_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS lucid_state_update_timestamp ON lucid_state;

CREATE TRIGGER lucid_state_update_timestamp
  BEFORE UPDATE ON lucid_state
  FOR EACH ROW
  EXECUTE FUNCTION update_lucid_state_timestamp();

-- ============================================================================
-- UPDATE TIMESTAMP TRIGGER FOR ORBITS
-- ============================================================================

CREATE OR REPLACE FUNCTION update_orbits_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orbits_update_timestamp ON orbits;

CREATE TRIGGER orbits_update_timestamp
  BEFORE UPDATE ON orbits
  FOR EACH ROW
  EXECUTE FUNCTION update_orbits_timestamp();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE lucid_state IS 'LUCID self-awareness and evolution tracking. How LUCID understands its witness role.';
COMMENT ON TABLE orbits IS 'People in the user ecosystem. Relationships mapped by proximity (inner/mid/outer).';
COMMENT ON COLUMN lucid_state.current_understanding IS 'JSONB object of what LUCID understands about the user by topic';
COMMENT ON COLUMN lucid_state.confidence_levels IS 'JSONB map of topic -> confidence score (0-1)';
COMMENT ON COLUMN lucid_state.areas_needing_witnessing IS 'Array of topics LUCID wants to learn more about';
COMMENT ON COLUMN lucid_state.active_questions IS 'Questions LUCID is currently curious about';
COMMENT ON COLUMN lucid_state.recent_insights IS 'Recent discoveries about the user (last 5-10)';
COMMENT ON COLUMN orbits.orbit_tier IS 'inner = closest relationships, mid = regular mentions, outer = peripheral';
COMMENT ON COLUMN orbits.how_this_affects_user IS 'Impact this person has on the user life/state';

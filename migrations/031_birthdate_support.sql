-- Migration 031: Add birth year support for dynamic age calculation
-- Fixes the "Seth is always 19" problem - ages should be calculated, not stored statically

-- Add birth_year column to immutable_facts for relationship facts
ALTER TABLE immutable_facts ADD COLUMN IF NOT EXISTS birth_year INTEGER;

-- Add helper metadata column for structured data
ALTER TABLE immutable_facts ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Add birth_year to orbits for people in the user's life
ALTER TABLE orbits ADD COLUMN IF NOT EXISTS birth_year INTEGER;

-- Function to calculate age from birth year
CREATE OR REPLACE FUNCTION calculate_age_from_year(birth_year INTEGER)
RETURNS INTEGER AS $$
BEGIN
  IF birth_year IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER - birth_year;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to get age string (e.g., "19")
CREATE OR REPLACE FUNCTION age_from_year_string(birth_year INTEGER)
RETURNS TEXT AS $$
BEGIN
  IF birth_year IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN calculate_age_from_year(birth_year)::TEXT;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- View for immutable facts with dynamic age substitution
CREATE OR REPLACE VIEW immutable_facts_with_age AS
SELECT
  id,
  user_id,
  -- Replace {age} placeholder with calculated age if birth_year exists
  CASE
    WHEN birth_year IS NOT NULL THEN
      REPLACE(content, '{age}', age_from_year_string(birth_year))
    ELSE
      content
  END AS content,
  category,
  display_order,
  birth_year,
  metadata,
  created_at,
  updated_at
FROM immutable_facts;

-- View for orbits with dynamic age
CREATE OR REPLACE VIEW orbits_with_age AS
SELECT
  o.*,
  calculate_age_from_year(o.birth_year) as current_age
FROM orbits o;

COMMENT ON COLUMN immutable_facts.birth_year IS 'Birth year for calculating dynamic ages. Use {age} in content to substitute.';
COMMENT ON COLUMN orbits.birth_year IS 'Birth year of person in orbit for age calculations';
COMMENT ON FUNCTION calculate_age_from_year(INTEGER) IS 'Calculates age from birth year';
COMMENT ON VIEW immutable_facts_with_age IS 'Immutable facts with {age} placeholders replaced with calculated ages';

-- Example usage:
-- UPDATE immutable_facts
-- SET content = 'Seth, his son, is {age}', birth_year = 2005
-- WHERE content LIKE '%Seth%19%';

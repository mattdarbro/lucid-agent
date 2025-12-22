-- Migration 031: Add birthdate support for dynamic age calculation
-- Fixes the "Seth is always 19" problem - ages should be calculated, not stored statically

-- Add birthdate column to immutable_facts for relationship facts
ALTER TABLE immutable_facts ADD COLUMN IF NOT EXISTS birthdate DATE;

-- Add helper metadata column for structured data (like birthdates)
ALTER TABLE immutable_facts ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Add birthdate to orbits for people in the user's life
ALTER TABLE orbits ADD COLUMN IF NOT EXISTS birthdate DATE;

-- Function to calculate age from birthdate
CREATE OR REPLACE FUNCTION calculate_age_years(birth DATE)
RETURNS INTEGER AS $$
BEGIN
  IF birth IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN EXTRACT(YEAR FROM age(CURRENT_DATE, birth))::INTEGER;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to get age string (e.g., "19 years old")
CREATE OR REPLACE FUNCTION age_string(birth DATE)
RETURNS TEXT AS $$
DECLARE
  age_years INTEGER;
BEGIN
  IF birth IS NULL THEN
    RETURN NULL;
  END IF;
  age_years := calculate_age_years(birth);
  RETURN age_years::TEXT || ' years old';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- View for immutable facts with dynamic age substitution
CREATE OR REPLACE VIEW immutable_facts_with_age AS
SELECT
  id,
  user_id,
  -- Replace {age} placeholder with calculated age if birthdate exists
  CASE
    WHEN birthdate IS NOT NULL THEN
      REPLACE(content, '{age}', age_string(birthdate))
    ELSE
      content
  END AS content,
  category,
  display_order,
  birthdate,
  metadata,
  created_at,
  updated_at
FROM immutable_facts;

-- View for orbits with dynamic age
CREATE OR REPLACE VIEW orbits_with_age AS
SELECT
  o.*,
  calculate_age_years(o.birthdate) as current_age,
  age_string(o.birthdate) as age_description
FROM orbits o;

COMMENT ON COLUMN immutable_facts.birthdate IS 'Birthdate for calculating dynamic ages. Use {age} in content to substitute.';
COMMENT ON COLUMN orbits.birthdate IS 'Birthdate of person in orbit for age calculations';
COMMENT ON FUNCTION calculate_age_years(DATE) IS 'Calculates age in years from birthdate';
COMMENT ON VIEW immutable_facts_with_age IS 'Immutable facts with {age} placeholders replaced with calculated ages';

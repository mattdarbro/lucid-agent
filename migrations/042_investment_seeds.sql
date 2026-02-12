-- Migration 042: Investment Seeds
-- Adds seed_type column to support investment recommendations and trade executions
-- as persistent portfolio ledger entries within the existing seed system.
--
-- Seed types:
--   'thought'                    - Default, existing seeds (backwards compatible)
--   'investment_recommendation'  - Lucid's buy/sell recommendations with limit prices
--   'trade_execution'            - Actual trades Matt executed on Robinhood
--
-- Investment seed lifecycle maps to existing statuses:
--   'held'     = recommendation pending execution / open position
--   'growing'  = position is active and being tracked
--   'grown'    = position closed (sold), P&L recorded
--   'released' = recommendation was skipped or cancelled

-- Add seed_type column with default for backwards compatibility
ALTER TABLE seeds ADD COLUMN IF NOT EXISTS seed_type VARCHAR(50) DEFAULT 'thought';

-- Index for efficient investment seed queries per user
CREATE INDEX IF NOT EXISTS idx_seeds_user_type ON seeds(user_id, seed_type);

-- Index for finding open positions (investment seeds that are held or growing)
CREATE INDEX IF NOT EXISTS idx_seeds_investment_active
  ON seeds(user_id, planted_at DESC)
  WHERE seed_type IN ('investment_recommendation', 'trade_execution')
    AND status IN ('held', 'growing');

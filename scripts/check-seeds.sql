-- ============================================
-- Lucid Seeds Diagnostic Script
-- Run this in Supabase SQL Editor to check seed data
-- ============================================

-- 1. Check if seeds table exists
SELECT EXISTS (
    SELECT FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name = 'seeds'
) AS seeds_table_exists;

-- 2. Get total seed counts by status
-- IMPORTANT: Only 'held' seeds are surfaced in briefings!
-- If most seeds are 'growing', they won't appear in daily briefings.
SELECT
    status,
    COUNT(*) as count,
    CASE status
        WHEN 'held' THEN '✓ SURFACED in briefings'
        WHEN 'growing' THEN '✗ NOT surfaced (only in weekly digest)'
        WHEN 'grown' THEN '✗ Completed - in Library'
        WHEN 'released' THEN '✗ Archived'
    END as surfacing_note
FROM seeds
GROUP BY status
ORDER BY
    CASE status
        WHEN 'held' THEN 1
        WHEN 'growing' THEN 2
        WHEN 'grown' THEN 3
        WHEN 'released' THEN 4
    END;

-- 3. Get seed counts per user (with user email)
SELECT
    u.email,
    s.user_id,
    COUNT(*) as total_seeds,
    COUNT(*) FILTER (WHERE s.status = 'held') as held,
    COUNT(*) FILTER (WHERE s.status = 'growing') as growing,
    COUNT(*) FILTER (WHERE s.status = 'grown') as grown,
    COUNT(*) FILTER (WHERE s.status = 'released') as released
FROM seeds s
JOIN users u ON s.user_id = u.id
GROUP BY u.email, s.user_id
ORDER BY total_seeds DESC;

-- 4. View recent seeds (last 10)
SELECT
    id,
    user_id,
    LEFT(content, 50) || CASE WHEN LENGTH(content) > 50 THEN '...' ELSE '' END as content_preview,
    source,
    status,
    planted_at,
    last_surfaced_at,
    surface_count
FROM seeds
ORDER BY planted_at DESC
LIMIT 10;

-- 5. Check for active seeds (held or growing) with full details
SELECT
    id,
    user_id,
    content,
    planted_context,
    source,
    status,
    planted_at,
    last_surfaced_at,
    surface_count
FROM seeds
WHERE status IN ('held', 'growing')
ORDER BY planted_at DESC
LIMIT 20;

-- 6. Check active_seeds view
SELECT
    id,
    user_id,
    LEFT(content, 50) || CASE WHEN LENGTH(content) > 50 THEN '...' ELSE '' END as content_preview,
    status,
    planted_at
FROM active_seeds
LIMIT 10;

-- 7. Seeds planted in the last 7 days
SELECT
    DATE(planted_at) as date,
    COUNT(*) as seeds_planted
FROM seeds
WHERE planted_at >= NOW() - INTERVAL '7 days'
GROUP BY DATE(planted_at)
ORDER BY date DESC;

-- 8. Check for seeds with embeddings
SELECT
    COUNT(*) as total_seeds,
    COUNT(*) FILTER (WHERE embedding IS NOT NULL) as with_embedding,
    COUNT(*) FILTER (WHERE embedding IS NULL) as without_embedding
FROM seeds;

-- 9. Seeds that have grown into library entries
SELECT
    s.id as seed_id,
    LEFT(s.content, 40) as seed_content,
    s.status,
    le.title as library_entry_title,
    s.planted_at,
    s.updated_at as grown_at
FROM seeds s
LEFT JOIN library_entries le ON s.grown_into_library_id = le.id
WHERE s.status = 'grown'
ORDER BY s.updated_at DESC
LIMIT 10;

-- 10. Summary statistics
SELECT
    (SELECT COUNT(*) FROM seeds) as total_seeds,
    (SELECT COUNT(DISTINCT user_id) FROM seeds) as users_with_seeds,
    (SELECT MIN(planted_at) FROM seeds) as oldest_seed,
    (SELECT MAX(planted_at) FROM seeds) as newest_seed,
    (SELECT COUNT(*) FROM seeds WHERE status IN ('held', 'growing')) as active_seeds,
    (SELECT COUNT(*) FROM seeds WHERE status = 'held') as held_seeds_surfaceable,
    (SELECT COUNT(*) FROM seeds WHERE last_surfaced_at IS NOT NULL) as ever_surfaced;

-- ============================================
-- FIXES (run these if needed)
-- ============================================

-- FIX 1: Reset 'growing' seeds back to 'held' so they get surfaced
-- The migration may have incorrectly set seeds to 'growing' status
-- which prevents them from appearing in daily briefings.
--
-- UNCOMMENT AND RUN THIS TO FIX:
-- UPDATE seeds
-- SET status = 'held', updated_at = NOW()
-- WHERE status = 'growing'
-- RETURNING id, LEFT(content, 50) as content_preview, status;

-- FIX 2: Reset surfacing counts so seeds get shown again
-- If seeds have been surfaced many times, they may be deprioritized.
--
-- UNCOMMENT AND RUN THIS TO RESET SURFACING:
-- UPDATE seeds
-- SET last_surfaced_at = NULL, surface_count = 0, updated_at = NOW()
-- WHERE status = 'held'
-- RETURNING id, LEFT(content, 50) as content_preview, last_surfaced_at, surface_count;

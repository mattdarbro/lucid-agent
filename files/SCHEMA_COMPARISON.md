# Schema Comparison: Original vs Revised

This document shows exactly what changed between the original schema and the revised schema with emotional intelligence.

---

## Summary of Changes

### ✅ Tables Kept (Unchanged)
- `users`
- `messages`
- `facts`
- `evidence`
- `summaries`
- `personality_snapshots`
- `autonomous_thoughts`
- `research_tasks`
- `agent_jobs`

### 🔧 Tables Modified
- `conversations` - Added 3 new fields

### ⭐ Tables Added (NEW)
- `personality_statistics`
- `emotional_states`
- `context_adaptations`

---

## Detailed Changes

### 1. conversations (MODIFIED)

**What was added**:
```sql
-- New fields
time_of_day VARCHAR(20),           -- 'early_morning', 'morning', 'afternoon', 'evening', 'night', 'late_night'
user_timezone VARCHAR(50),          -- timezone at time of conversation
emotional_state_id UUID,            -- link to detected emotional state

-- New trigger
CREATE TRIGGER conversation_time_of_day
  BEFORE INSERT ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION set_time_of_day();
```

**Why this matters**:
- `time_of_day`: Enables pattern analysis (e.g., "user always chats late when stressed")
- `user_timezone`: Ensures time_of_day is accurate to user's actual time
- `emotional_state_id`: Links conversation to detected emotional state
- Auto-trigger: Automatically categorizes time without manual input

**Example queries enabled**:
```sql
-- Find all late-night conversations
SELECT * FROM conversations 
WHERE user_id = 'xxx' 
  AND time_of_day = 'late_night';

-- Count conversations by time of day
SELECT time_of_day, COUNT(*) 
FROM conversations 
WHERE user_id = 'xxx' 
GROUP BY time_of_day;

-- Get conversations during emotional state
SELECT c.*, es.state_type 
FROM conversations c
JOIN emotional_states es ON c.emotional_state_id = es.id
WHERE c.user_id = 'xxx';
```

---

### 2. personality_statistics (NEW TABLE)

**Full definition**:
```sql
CREATE TABLE personality_statistics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) NOT NULL UNIQUE,
  
  -- Running averages (calculated over time)
  avg_openness DECIMAL(4,3) DEFAULT 0.500,
  avg_conscientiousness DECIMAL(4,3) DEFAULT 0.500,
  avg_extraversion DECIMAL(4,3) DEFAULT 0.500,
  avg_agreeableness DECIMAL(4,3) DEFAULT 0.500,
  avg_neuroticism DECIMAL(4,3) DEFAULT 0.500,
  
  -- Standard deviations (to detect significant shifts)
  std_openness DECIMAL(4,3) DEFAULT 0.100,
  std_conscientiousness DECIMAL(4,3) DEFAULT 0.100,
  std_extraversion DECIMAL(4,3) DEFAULT 0.100,
  std_agreeableness DECIMAL(4,3) DEFAULT 0.100,
  std_neuroticism DECIMAL(4,3) DEFAULT 0.100,
  
  -- Metadata
  sample_size INT DEFAULT 0,
  window_days INT DEFAULT 30,
  last_updated TIMESTAMP DEFAULT NOW(),
  
  created_at TIMESTAMP DEFAULT NOW()
);

-- Auto-update trigger
CREATE TRIGGER personality_statistics_update
  AFTER INSERT ON personality_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION update_personality_statistics();
```

**Why this matters**:
- **Baseline tracking**: Know user's "normal" personality
- **Automatic calculation**: No manual queries needed
- **Standard deviations**: Statistical detection of significant shifts
- **Efficient queries**: O(1) lookup vs O(N) aggregation

**Without this table**:
```sql
-- Would need to run this expensive query every time
SELECT 
  AVG(openness) as avg_openness,
  STDDEV(openness) as std_openness,
  AVG(neuroticism) as avg_neuroticism,
  STDDEV(neuroticism) as std_neuroticism,
  ...
FROM personality_snapshots
WHERE user_id = 'xxx'
  AND created_at > NOW() - INTERVAL '30 days';
```

**With this table**:
```sql
-- Instant lookup
SELECT * FROM personality_statistics WHERE user_id = 'xxx';
```

**Example detection logic**:
```typescript
const stats = await getPersonalityStatistics(userId);
const current = await getLatestPersonality(userId);

// Is neuroticism significantly elevated?
const neurDelta = (current.neuroticism - stats.avg_neuroticism) / stats.std_neuroticism;
if (neurDelta > 2.0) {
  // User's neuroticism is > 2 standard deviations above baseline
  // This is statistically significant (top 2.5% of distribution)
  // Likely indicates emotional distress
}
```

---

### 3. emotional_states (NEW TABLE)

**Full definition**:
```sql
CREATE TABLE emotional_states (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) NOT NULL,
  conversation_id UUID REFERENCES conversations(id),
  
  -- The detected state
  state_type VARCHAR(50) NOT NULL,         -- 'struggling', 'energized', 'withdrawn', 'reflective', 'stable'
  confidence DECIMAL(4,3) NOT NULL,        -- 0.00 to 1.00
  
  -- What led to detection
  trigger_type VARCHAR(50) NOT NULL,       -- 'personality_shift', 'conversation_pattern', 'time_pattern', 'topic_analysis'
  indicators JSONB,                        -- detailed evidence
  
  -- Duration
  detected_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP,                   -- when state ended
  
  -- Recommended response
  recommended_approach VARCHAR(50),        -- 'gentle', 'supportive', 'exploratory', 'analytical', 'minimal'
  
  created_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(user_id, state_type, detected_at)
);
```

**Example records**:

```json
// Struggling state
{
  "user_id": "user123",
  "conversation_id": "conv456",
  "state_type": "struggling",
  "confidence": 0.85,
  "trigger_type": "personality_shift",
  "indicators": {
    "personality_deltas": {
      "neuroticism": 0.30,
      "agreeableness": -0.20
    },
    "topics": ["breakup", "lonely", "sad"],
    "conversation_times": ["2025-11-04T23:45:00Z", "2025-11-05T01:20:00Z"],
    "reasoning": "Significant neuroticism increase (+0.30) with late-night conversations about relationship ending"
  },
  "detected_at": "2025-11-05T07:00:00Z",
  "resolved_at": null,  // Still ongoing
  "recommended_approach": "supportive"
}

// Energized state
{
  "user_id": "user123",
  "state_type": "energized",
  "confidence": 0.75,
  "trigger_type": "personality_shift",
  "indicators": {
    "personality_deltas": {
      "extraversion": 0.25,
      "openness": 0.20
    },
    "reasoning": "High energy and curiosity detected"
  },
  "detected_at": "2025-11-06T10:00:00Z",
  "resolved_at": "2025-11-09T10:00:00Z",  // Lasted 3 days
  "recommended_approach": "exploratory"
}
```

**Example queries**:
```sql
-- Get current emotional state for user
SELECT * FROM emotional_states
WHERE user_id = 'xxx'
  AND resolved_at IS NULL
ORDER BY detected_at DESC
LIMIT 1;

-- Emotional state history
SELECT 
  state_type,
  detected_at,
  resolved_at,
  EXTRACT(EPOCH FROM (COALESCE(resolved_at, NOW()) - detected_at))/3600 as hours_duration
FROM emotional_states
WHERE user_id = 'xxx'
ORDER BY detected_at DESC;

-- How often is user struggling?
SELECT 
  COUNT(*) as struggling_count,
  AVG(EXTRACT(EPOCH FROM (COALESCE(resolved_at, NOW()) - detected_at))/3600) as avg_duration_hours
FROM emotional_states
WHERE user_id = 'xxx'
  AND state_type = 'struggling';
```

---

### 4. context_adaptations (NEW TABLE)

**Full definition**:
```sql
CREATE TABLE context_adaptations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) NOT NULL,
  emotional_state_id UUID REFERENCES emotional_states(id),
  
  -- Schedule adjustments
  morning_schedule VARCHAR(50),    -- e.g., "07:30", "disabled"
  midday_schedule VARCHAR(50),
  evening_schedule VARCHAR(50),
  night_schedule VARCHAR(50),
  
  -- Prompt adjustments
  temperature_modifier DECIMAL(3,2) DEFAULT 1.00,  -- multiply base temperature
  tone_directive TEXT,                             -- instructions for system prompt
  
  -- Research strategy
  curiosity_approach VARCHAR(50),  -- 'gentle', 'exploratory', 'supportive', 'analytical', 'minimal'
  research_topics TEXT[],          -- topics to prioritize
  research_avoidance TEXT[],       -- topics to avoid
  research_priority INT DEFAULT 5, -- 1-10
  
  -- Reasoning
  adaptation_reasoning TEXT,
  
  -- Validity
  active_from TIMESTAMP DEFAULT NOW(),
  active_until TIMESTAMP,
  
  created_at TIMESTAMP DEFAULT NOW()
);
```

**Example record**:

```json
// Adaptation for struggling state
{
  "user_id": "user123",
  "emotional_state_id": "state789",
  
  "morning_schedule": "08:00",      // Later start (more rest)
  "midday_schedule": "disabled",     // Skip midday (less intrusion)
  "evening_schedule": "20:00",       // Gentle check-in
  "night_schedule": "disabled",      // Skip dreams (let them sleep)
  
  "temperature_modifier": 0.6,       // 30% less random, more focused
  "tone_directive": "User is going through a difficult time emotionally. Be gentle, supportive, and empathetic. Avoid overwhelming them with complexity.",
  
  "curiosity_approach": "supportive",
  "research_topics": [
    "gentle self-care strategies",
    "emotional wellbeing resources",
    "healing practices"
  ],
  "research_avoidance": [
    "challenging topics",
    "complex problems",
    "relationship advice"  // Don't pour salt in the wound
  ],
  "research_priority": 8,  // High priority - help them
  
  "adaptation_reasoning": "User showing signs of emotional distress with elevated neuroticism (+2.5 std dev). Prioritizing support and gentle interaction.",
  
  "active_from": "2025-11-05T07:00:00Z",
  "active_until": "2025-11-12T07:00:00Z"  // 7 days
}
```

**How it's used in code**:

```typescript
// In CircadianAgentService
async function shouldRunAgent(userId: string, agentType: string): Promise<boolean> {
  const adaptation = await getActiveAdaptation(userId);
  
  if (!adaptation) return true;  // No adaptation, run normally
  
  const schedule = adaptation[`${agentType}_schedule`];
  return schedule !== 'disabled';
}

// In ChatService
async function buildSystemPrompt(userId: string): Promise<string> {
  let prompt = "You are Lucid, an emotionally intelligent AI...";
  
  const adaptation = await getActiveAdaptation(userId);
  if (adaptation) {
    prompt += `\n\nEMOTIONAL CONTEXT:\n${adaptation.tone_directive}`;
  }
  
  return prompt;
}

// Temperature adjustment
async function getChatTemperature(userId: string): Promise<number> {
  const adaptation = await getActiveAdaptation(userId);
  return 0.7 * (adaptation?.temperature_modifier || 1.0);
}
```

---

## Side-by-Side Comparison

### Original Schema (10 tables)
```
1. users
2. conversations
3. messages
4. facts
5. evidence
6. summaries
7. personality_snapshots
8. autonomous_thoughts
9. research_tasks
10. agent_jobs
```

### Revised Schema (13 tables)
```
1. users
2. conversations (+ time_of_day, timezone, emotional_state_id)
3. messages
4. facts
5. evidence
6. summaries
7. personality_snapshots
8. personality_statistics (NEW)
9. emotional_states (NEW)
10. context_adaptations (NEW)
11. autonomous_thoughts
12. research_tasks
13. agent_jobs
```

---

## Migration Path (if starting from original)

If you already deployed the original schema and want to migrate:

```sql
-- Step 1: Add new tables
CREATE TABLE personality_statistics (...);
CREATE TABLE emotional_states (...);
CREATE TABLE context_adaptations (...);

-- Step 2: Modify conversations table
ALTER TABLE conversations ADD COLUMN time_of_day VARCHAR(20);
ALTER TABLE conversations ADD COLUMN user_timezone VARCHAR(50);
ALTER TABLE conversations ADD COLUMN emotional_state_id UUID REFERENCES emotional_states(id);

-- Step 3: Backfill time_of_day for existing conversations
UPDATE conversations
SET time_of_day = CASE
  WHEN EXTRACT(HOUR FROM created_at) >= 0 AND EXTRACT(HOUR FROM created_at) < 5 THEN 'late_night'
  WHEN EXTRACT(HOUR FROM created_at) >= 5 AND EXTRACT(HOUR FROM created_at) < 7 THEN 'early_morning'
  WHEN EXTRACT(HOUR FROM created_at) >= 7 AND EXTRACT(HOUR FROM created_at) < 12 THEN 'morning'
  WHEN EXTRACT(HOUR FROM created_at) >= 12 AND EXTRACT(HOUR FROM created_at) < 17 THEN 'afternoon'
  WHEN EXTRACT(HOUR FROM created_at) >= 17 AND EXTRACT(HOUR FROM created_at) < 21 THEN 'evening'
  ELSE 'night'
END;

-- Step 4: Populate personality_statistics from existing snapshots
-- (Run update_personality_statistics trigger for all existing snapshots)

-- Step 5: Add triggers
CREATE TRIGGER conversation_time_of_day ...;
CREATE TRIGGER personality_statistics_update ...;
```

**But you don't need to do this** because you're starting fresh! 🎉

---

## Cost Comparison

### Storage
- **Original**: ~1-2KB per conversation
- **Revised**: ~1.5-2.5KB per conversation (+0.5KB for state/adaptation)
- **Impact**: Negligible (~25% increase in storage)

### Compute
- **Original**: 
  - Personality assessment every N messages
  - Fact extraction per message
- **Revised**:
  - Same as original
  - + Emotional state detection (pure SQL, very fast)
  - + Adaptation generation (once per state change)
- **Impact**: Minimal (<5% increase in compute)

### LLM Costs
- **Original**: Embeddings + completions
- **Revised**: Same (emotional detection uses SQL, not LLM)
- **Impact**: None

---

## Performance Comparison

### Without personality_statistics
```sql
-- Every time you want to check for emotional states:
SELECT AVG(neuroticism), STDDEV(neuroticism), ...
FROM personality_snapshots
WHERE user_id = 'xxx'
  AND created_at > NOW() - INTERVAL '30 days';
-- Scans N rows, O(N) complexity
```

### With personality_statistics
```sql
-- O(1) lookup:
SELECT * FROM personality_statistics WHERE user_id = 'xxx';
-- Returns instantly
```

**Speed improvement**: 10-100x faster (depending on N)

---

## Behavioral Comparison

### Original: Static Behavior
```
User chats → Lucid responds with memory context
              (same tone/temperature always)

Circadian agents run → Same schedule for everyone
                       (morning, midday, evening, night)

Curiosity engine → Explores user's interests
                   (no emotional awareness)
```

### Revised: Adaptive Behavior
```
User chats → Lucid checks emotional state
          → Adjusts tone/temperature accordingly
          → Responds with empathy

Circadian agents → Check for active adaptation
                → May skip agents (if user needs space)
                → May adjust timing
                → Tone adapts to emotional context

Curiosity engine → Considers emotional state
                → Researches supportive content if struggling
                → Avoids triggering topics
                → Adjusts research intensity
```

---

## Recommendation: Use Revised Schema

**Reasons**:

1. ✅ **You haven't deployed yet** - perfect time to get it right
2. ✅ **Emotional intelligence is your vision** - why retrofit later?
3. ✅ **Minimal overhead** - 3 extra tables, negligible cost
4. ✅ **Optional features** - don't have to use them immediately
5. ✅ **Future-proof** - won't need migration later

**The only downside is complexity** - but you can ignore the new tables during Phase 2 and add Phase 3 later.

---

## Summary

**What changed**: 
- Modified `conversations` (+3 fields)
- Added `personality_statistics` (baseline tracking)
- Added `emotional_states` (detection results)
- Added `context_adaptations` (behavior adjustments)

**Why it matters**: 
- Enables emotional intelligence
- Makes Lucid adaptive, not just responsive
- Statistical detection of personality shifts
- Empathetic behavior adjustments

**Migration effort**: 
- From nothing to revised: **same effort as original**
- From original to revised: **medium effort** (3 new tables + backfill)

**Recommendation**: **Use revised schema from day 1** 🎯

---

That's the complete comparison! The revised schema gives you everything from the original, plus the foundation for emotional intelligence. 🧠✨

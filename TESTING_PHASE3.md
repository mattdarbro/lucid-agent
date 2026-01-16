# Testing Phase 3: Emotional Intelligence

This guide shows you how to test Lucid's emotional intelligence capabilities.

---

## Quick Test (Automated)

The easiest way to test is with the automated test script:

```bash
npm run test:emotional-intelligence
```

This will:
1. ✅ Create a test user
2. ✅ Generate baseline personality (normal conversation)
3. ✅ Generate current personality (showing distress)
4. ✅ Detect emotional state shift
5. ✅ Generate context adaptation
6. ✅ Test chat with emotional intelligence

**Requirements**: `.env` configured with valid API keys (ANTHROPIC_API_KEY, DATABASE_URL, etc.)

---

## Manual Testing Scenarios

### Scenario 1: Detecting "Struggling" State

**Goal**: Test if Lucid detects emotional distress and adapts behavior

1. **Create a user and baseline conversation** (normal mood)
   ```typescript
   // Messages showing stable personality
   - "Had a good day today"
   - "Work is going well"
   - "Looking forward to the weekend"
   ```

2. **Create a second conversation** (showing distress)
   ```typescript
   // Messages showing elevated neuroticism
   - "I'm so stressed out"
   - "Everything feels overwhelming"
   - "I can't sleep well, anxiety is high"
   - "People keep annoying me"
   ```

3. **Generate personality snapshots**
   ```typescript
   await personalityService.createPersonalitySnapshot({
     user_id: userId,
     conversation_id: conversationId
   });
   ```

4. **Detect emotional state**
   ```typescript
   const detection = await emotionalStateService.detectEmotionalState({
     user_id: userId,
     min_confidence: 0.5
   });
   ```

5. **Expected result**:
   - State: `"struggling"`
   - Neuroticism deviation: `+2.0σ` or higher
   - Adaptation: Gentle tone, 0.6x temperature, supportive research

6. **Test chat response**:
   ```typescript
   const response = await chatService.chat({
     user_id: userId,
     conversation_id: conversationId,
     message: "I'm feeling overwhelmed"
   });
   ```

7. **Verify**: Response should be gentle, supportive, non-overwhelming

---

### Scenario 2: Detecting "Energized" State

**Goal**: Test if Lucid detects high energy and adapts to be more exploratory

1. **Create baseline** (normal mood)

2. **Create energized conversation**:
   ```typescript
   - "I'm so excited about this new project!"
   - "I love exploring new ideas and possibilities"
   - "Let's dive deep into philosophy and creativity"
   - "I want to learn everything about quantum physics!"
   ```

3. **Generate snapshots & detect state**

4. **Expected result**:
   - State: `"energized"`
   - Openness & Extraversion deviation: `+1.5σ` or higher
   - Adaptation: Exploratory tone, 1.2x temperature, creative research

5. **Test chat**: Response should be creative, exploratory, thought-provoking

---

### Scenario 3: Detecting "Withdrawn" State

**Goal**: Test if Lucid respects user's need for space

1. **Create withdrawn conversation**:
   ```typescript
   - "I just want to be alone right now"
   - "Not feeling very social lately"
   - "Please don't ask too many questions"
   - "I'm anxious and need space"
   ```

2. **Expected result**:
   - State: `"withdrawn"`
   - Extraversion deviation: `-2.0σ`
   - Neuroticism deviation: `+1.5σ`
   - Adaptation: Minimal interaction, 0.5x temperature, brief responses

3. **Test chat**: Response should be brief, gentle, non-intrusive

---

### Scenario 4: Detecting "Reflective" State

**Goal**: Test if Lucid supports deep thinking

1. **Create reflective conversation**:
   ```typescript
   - "I've been thinking deeply about the meaning of life"
   - "Philosophy fascinates me lately"
   - "I prefer solitude for contemplation"
   - "Abstract concepts are more interesting than social events"
   ```

2. **Expected result**:
   - State: `"reflective"`
   - Openness deviation: `+1.5σ`
   - Extraversion deviation: `-1.5σ`
   - Neuroticism: stable
   - Adaptation: Analytical tone, 0.9x temperature, philosophical research

3. **Test chat**: Response should be thoughtful, philosophical, analytical

---

## Testing Temperature Modulation

Temperature affects creativity/randomness in responses:

| State | Modifier | Effect |
|-------|----------|--------|
| Struggling | 0.6x | **More focused** - Less random, more predictable, supportive |
| Withdrawn | 0.5x | **Very focused** - Minimal variation, brief responses |
| Reflective | 0.9x | **Balanced** - Thoughtful but not overly creative |
| Energized | 1.2x | **More creative** - Bold connections, exploratory |

**Test**: Send same message with different emotional states, observe response variety

---

## Testing Adaptation Schedules

Each emotional state adjusts when autonomous agents should run:

| State | Morning | Midday | Evening | Night |
|-------|---------|--------|---------|-------|
| Struggling | 8am (later) | disabled | 20:00 | disabled |
| Energized | 7am (early) | 12:30 | 20:00 | 3am |
| Withdrawn | disabled | disabled | 21:00 | disabled |
| Reflective | 7:30 | disabled | 20:00 | 3am |

**Note**: Autonomous agents aren't implemented yet (Phase 4), but adaptations are stored

---

## Verifying Database State

Check what's stored in the database:

```sql
-- View personality snapshots
SELECT
  user_id,
  openness, conscientiousness, extraversion, agreeableness, neuroticism,
  confidence,
  snapshot_at
FROM personality_snapshots
ORDER BY snapshot_at DESC
LIMIT 5;

-- View detected emotional states
SELECT
  user_id,
  state_type,
  confidence,
  trigger_type,
  recommended_approach,
  detected_at,
  resolved_at
FROM emotional_states
WHERE resolved_at IS NULL
ORDER BY detected_at DESC;

-- View active adaptations
SELECT
  user_id,
  temperature_modifier,
  curiosity_approach,
  tone_directive,
  morning_schedule,
  midday_schedule,
  active_from,
  active_until
FROM context_adaptations
WHERE active_until IS NULL OR active_until > NOW()
ORDER BY active_from DESC;

-- View personality statistics (baseline)
SELECT
  user_id,
  avg_neuroticism,
  std_neuroticism,
  sample_size,
  last_updated
FROM personality_statistics;
```

---

## Expected Flow (Full Cycle)

```
User chats → Messages stored
     ↓
PersonalityService.createSnapshot()
  → Analyzes messages with Claude
  → Stores Big 5 scores
     ↓
EmotionalStateService.detectEmotionalState()
  → Compares to baseline
  → Calculates deviations
  → Matches patterns
  → Stores emotional state
     ↓
ContextAdaptationService.generateAdaptation()
  → Creates adaptation based on state
  → Sets schedules, temperature, tone
     ↓
ChatService.chat()
  → Checks for active adaptation
  → Injects emotional context
  → Adjusts temperature
  → Generates adapted response
```

---

## Troubleshooting

### No emotional state detected
- **Cause**: Insufficient data or no significant personality shift
- **Fix**: Need at least 2 snapshots for comparison
- **Fix**: Create more extreme personality shifts in messages

### Baseline statistics not found
- **Cause**: Trigger hasn't run yet to calculate statistics
- **Fix**: The `update_personality_statistics` trigger runs automatically after snapshots
- **Check**: `SELECT * FROM personality_statistics WHERE user_id = 'xxx'`

### Chat doesn't seem adapted
- **Check**: Is there an active adaptation? `SELECT * FROM context_adaptations WHERE user_id = 'xxx' AND active_until > NOW()`
- **Check**: Logs should show "Injecting emotional context into chat"
- **Check**: Temperature modifier is being applied

### Personality assessment fails
- **Cause**: No messages found
- **Fix**: Create messages first
- **Cause**: Claude API error
- **Fix**: Check ANTHROPIC_API_KEY is valid

---

## Cost Considerations

Each personality assessment calls Claude API:
- **Cost per assessment**: ~$0.01-0.02 (depends on message count)
- **Recommended**: Only assess after significant conversations (20+ messages)
- **Optimization**: Cache assessments, don't re-assess too frequently

Emotional state detection is **free** (SQL calculations, no LLM calls)

---

## Next Steps

After testing Phase 3:
1. ✅ Verify personality detection accuracy
2. ✅ Confirm emotional states match reality
3. ✅ Test chat adaptation quality
4. 🔜 Build Phase 4 (Autonomous Agents) - use adaptations to control when agents run
5. 🔜 Add user feedback on detected states
6. 🔜 Implement curiosity engine with emotional awareness

---

**Happy Testing!** 🧠✨

The emotional intelligence is working if:
- Personality shifts are detected accurately
- Emotional states match the conversation tone
- Chat responses adapt their tone and creativity
- Temperature modulation is noticeable

# Lucid Agent - System Architecture Diagram

## Complete System Overview

```
                                    ┌─────────────────────────────────────┐
                                    │          iOS App                    │
                                    │     (User Interface)                │
                                    └──────────────┬──────────────────────┘
                                                   │
                                                   │ HTTPS
                                                   ↓
                    ┌──────────────────────────────────────────────────────────┐
                    │                     LUCID AGENT                          │
                    │                   (Port 4000)                            │
                    └──────────────────────────────────────────────────────────┘
                                                   │
                    ┌──────────────────────────────┴──────────────────────────┐
                    │                                                          │
                    ↓                                                          ↓
    ┌───────────────────────────────────────┐               ┌──────────────────────────────┐
    │   LAYER 3: ADAPTIVE CONTEXT           │               │  LAYER 1: CORE MEMORY       │
    │   🧠 Emotional Intelligence           │               │  💾 Knowledge Storage        │
    ├───────────────────────────────────────┤               ├──────────────────────────────┤
    │                                       │               │                              │
    │  ┌─────────────────────────────┐    │               │  ┌────────────────────────┐ │
    │  │  Personality Statistics     │    │               │  │  Users                 │ │
    │  │  • Baselines (avg ± std)    │    │               │  │  • Identity            │ │
    │  │  • Auto-updates from        │    │               │  │  • Timezone            │ │
    │  │    snapshots                │    │               │  └────────────────────────┘ │
    │  └─────────────────────────────┘    │               │                              │
    │           ↓                          │               │  ┌────────────────────────┐ │
    │  ┌─────────────────────────────┐    │               │  │  Conversations         │ │
    │  │  Emotional State Detection  │    │               │  │  • Chat sessions       │ │
    │  │  • Compare to baseline      │    │               │  │  • Time of day         │ │
    │  │  • Pattern analysis         │    │               │  │  • Emotional state     │ │
    │  │  • Struggling/Energized/    │    │               │  └────────────────────────┘ │
    │  │    Withdrawn/Reflective     │    │               │           ↓                  │
    │  └─────────────────────────────┘    │               │  ┌────────────────────────┐ │
    │           ↓                          │               │  │  Messages              │ │
    │  ┌─────────────────────────────┐    │               │  │  • Content             │ │
    │  │  Context Adaptations        │    │               │  │  • Vector embeddings   │ │
    │  │  • Schedule changes         │    │               │  │  • Semantic search     │ │
    │  │  • Temperature modifier     │    │               │  └────────────────────────┘ │
    │  │  • Tone directives          │    │               │           ↓                  │
    │  │  • Research strategy        │    │               │  ┌────────────────────────┐ │
    │  └─────────────────────────────┘    │               │  │  Facts                 │ │
    │           ↓                          │               │  │  • Knowledge           │ │
    │     Controls behavior ──────────┐   │               │  │  • Confidence          │ │
    │                                  │   │               │  │  • Categories          │ │
    └──────────────────────────────────┼───┘               │  └────────────────────────┘ │
                                       │                   │           ↓                  │
                                       │                   │  ┌────────────────────────┐ │
                                       ↓                   │  │  Evidence              │ │
    ┌───────────────────────────────────────┐             │  │  • Supporting data     │ │
    │   LAYER 2: CIRCADIAN INTELLIGENCE     │             │  │  • Strength scores     │ │
    │   ⏰ Autonomous Thinking               │             │  │  • Auto-confidence     │ │
    ├───────────────────────────────────────┤             │  └────────────────────────┘ │
    │                                       │             │                              │
    │  ┌─────────────────────────────┐    │             │  ┌────────────────────────┐ │
    │  │  Morning Reflection         │    │             │  │  Personality Snapshots │ │
    │  │  (7-10am)                   │    │             │  │  • Big 5 traits        │ │
    │  │  • Review yesterday         │    │             │  │  • Over time           │ │
    │  │  • Plan today               │    │             │  │  • Reasoning           │ │
    │  │  ⚙️ Adapts to state         │    │             │  └────────────────────────┘ │
    │  └─────────────────────────────┘    │             │                              │
    │                                      │             │  ┌────────────────────────┐ │
    │  ┌─────────────────────────────┐    │             │  │  Summaries             │ │
    │  │  Midday Curiosity           │    │             │  │  • User perspective    │ │
    │  │  (12-2pm)                   │    │             │  │  • Model perspective   │ │
    │  │  • Research interests       │    │             │  │  • Conversation view   │ │
    │  │  • Ask questions            │    │             │  └────────────────────────┘ │
    │  │  ⚙️ Guided by adaptation    │    │             │                              │
    │  └─────────────────────────────┘    │             │  ┌────────────────────────┐ │
    │                                      │             │  │  Autonomous Thoughts   │ │
    │  ┌─────────────────────────────┐    │             │  │  • Self-generated      │ │
    │  │  Evening Consolidation      │    │             │  │  • Importance scored   │ │
    │  │  (8-11pm)                   │    │             │  │  • Shared status       │ │
    │  │  • Summarize day            │    │             │  └────────────────────────┘ │
    │  │  • Update facts             │    │             │                              │
    │  │  ⚙️ Tone adjusted           │    │             │  ┌────────────────────────┐ │
    │  └─────────────────────────────┘    │             │  │  Research Tasks        │ │
    │                                      │             │  │  • Web search queue    │ │
    │  ┌─────────────────────────────┐    │             │  │  • Results             │ │
    │  │  Night Dreams               │    │             │  │  • Derived facts       │ │
    │  │  (2-4am)                    │    │             │  └────────────────────────┘ │
    │  │  • Memory consolidation     │    │             │                              │
    │  │  • Pattern recognition      │    │             │  ┌────────────────────────┐ │
    │  │  ⚙️ May be skipped          │    │             │  │  Agent Jobs            │ │
    │  └─────────────────────────────┘    │             │  │  • Job queue           │ │
    │                                      │             │  │  • Scheduling          │ │
    │  All agents produce:                 │             │  │  • Status tracking     │ │
    │  • Autonomous thoughts               │             │  └────────────────────────┘ │
    │  • Research tasks                    │             │                              │
    │  • Fact updates                      │             └──────────────────────────────┘
    └───────────────────────────────────────┘
                    │
                    │
                    ↓
    ┌───────────────────────────────────────┐
    │   EXTERNAL SERVICES                   │
    ├───────────────────────────────────────┤
    │                                       │
    │  ┌─────────────────────────────┐    │
    │  │  Studio API                 │    │
    │  │  (Port 3000)                │    │
    │  │  • Authentication           │    │
    │  │  • Model routing            │    │
    │  │  • Session tokens           │    │
    │  └─────────────────────────────┘    │
    │                                      │
    │  ┌─────────────────────────────┐    │
    │  │  OpenAI API                 │    │
    │  │  • Embeddings (ada-002)     │    │
    │  │  • LLM completions          │    │
    │  └─────────────────────────────┘    │
    │                                      │
    │  ┌─────────────────────────────┐    │
    │  │  Supabase                   │    │
    │  │  • PostgreSQL + pgvector    │    │
    │  │  • All tables               │    │
    │  │  • Auto-triggers            │    │
    │  └─────────────────────────────┘    │
    │                                      │
    │  ┌─────────────────────────────┐    │
    │  │  Web Search (Future)        │    │
    │  │  • Brave/Google/Bing        │    │
    │  │  • Research execution       │    │
    │  └─────────────────────────────┘    │
    └───────────────────────────────────────┘
```

---

## Data Flow Examples

### Example 1: Normal Chat Flow

```
1. User sends message
   ↓
2. Lucid receives message
   ↓
3. Check for active emotional state
   ↓
4. Build context:
   - Get relevant facts (vector search)
   - Get personality snapshot
   - Get active adaptation (if any)
   - Assemble system prompt
   ↓
5. Adjust temperature based on adaptation
   ↓
6. Stream response from LLM
   ↓
7. Background processing:
   - Save message with embedding
   - Extract new facts
   - Update personality assessment
   - Check for emotional state change
```

### Example 2: Emotional State Detection Flow

```
1. New personality snapshot created
   ↓
2. Trigger: update_personality_statistics()
   ↓
3. Calculate baseline averages
   ↓
4. Trigger: detect_emotional_state()
   ↓
5. Compare current to baseline:
   - Neuroticism: 0.75 (baseline: 0.45 ± 0.10)
   - Delta: +0.30 = +3.0 std dev → SIGNIFICANT
   - Agreeableness: 0.60 (baseline: 0.80 ± 0.08)
   - Delta: -0.20 = -2.5 std dev → SIGNIFICANT
   ↓
6. Pattern match: High neuroticism + low agreeableness
   ↓
7. Emotional state: STRUGGLING (confidence: 0.85)
   ↓
8. Create emotional_states record
   ↓
9. Generate context adaptation:
   - Supportive tone
   - Lower temperature (0.6)
   - Adjusted schedules
   - Research strategy
   ↓
10. Create context_adaptations record
   ↓
11. All future interactions use this adaptation
    until state resolves or adaptation expires
```

### Example 3: Circadian Agent Flow (Morning Reflection)

```
1. Cron job triggers at 7:30am user time
   ↓
2. Check if morning agent should run:
   - Get active adaptation
   - Check morning_schedule field
   - If "disabled" → skip
   - If time specified → use that time
   ↓
3. Build agent prompt:
   - Base: "You are Lucid in morning reflection..."
   - Add adaptation tone: "User is struggling, be gentle..."
   - Temperature: 0.7 * 0.6 = 0.42
   ↓
4. Retrieve context:
   - Yesterday's conversations
   - Recent facts
   - Current personality
   - Unresolved topics
   ↓
5. LLM generates autonomous thoughts
   ↓
6. Store thoughts:
   - category: "reflection"
   - circadian_phase: "morning"
   - is_shared: false
   - importance_score: calculated
   ↓
7. Optional: Generate research tasks
   ↓
8. Job marked complete in agent_jobs
```

### Example 4: Adaptation Lifecycle

```
Timeline of user going through breakup:

Day 1:
  - Conversation mentions "breakup"
  - Personality assessment: neuroticism spike
  - Emotional state detected: STRUGGLING
  - Adaptation created (expires in 7 days)
  - All agents now run with supportive tone

Day 2-6:
  - Chat uses adapted context (gentle, supportive)
  - Morning agent: gentle reflection
  - Midday agent: SKIPPED (per adaptation)
  - Evening agent: supportive consolidation
  - Night agent: SKIPPED (let them rest)
  - Research: gentle self-care resources

Day 7:
  - New personality assessment: neuroticism normalizing
  - No new emotional state detected
  - Adaptation still active (not expired yet)

Day 8:
  - Adaptation expires (7 days elapsed)
  - OR: New assessment shows normalized personality
  - Emotional state marked: resolved_at = NOW()
  - Lucid returns to normal behavior
```

---

## Database Relationships

```
users
  ├── conversations (1:N)
  │   ├── messages (1:N)
  │   │   └── embeddings (for search)
  │   ├── summaries (1:N)
  │   ├── personality_snapshots (1:N)
  │   └── emotional_states (1:N)
  │
  ├── facts (1:N)
  │   ├── evidence (1:N)
  │   │   └── messages (references)
  │   └── embeddings (for search)
  │
  ├── personality_statistics (1:1)
  │   └── auto-updates from snapshots
  │
  ├── emotional_states (1:N)
  │   └── context_adaptations (1:N)
  │
  ├── autonomous_thoughts (1:N)
  │
  ├── research_tasks (1:N)
  │
  └── agent_jobs (1:N)
```

---

## Key Triggers & Automations

### 1. Message Count Auto-Increment
```sql
messages INSERT → increment conversations.message_count
```

### 2. Time of Day Auto-Detection
```sql
conversations INSERT → set time_of_day based on timezone
```

### 3. Fact Confidence Auto-Update
```sql
evidence INSERT/UPDATE → recalculate fact.confidence
```

### 4. Personality Statistics Auto-Update
```sql
personality_snapshots INSERT → update running averages
```

---

## API Endpoints (Planned)

### Chat
```
POST   /v1/chat                      Streaming chat with memory
```

### Memory
```
GET    /v1/memory/facts              List user's facts
POST   /v1/memory/facts              Manually add fact
GET    /v1/memory/search             Semantic memory search
GET    /v1/memory/conversations      Conversation history
```

### Personality
```
GET    /v1/personality               Current Big 5 assessment
GET    /v1/personality/history       Personality over time
GET    /v1/personality/baseline      Baseline statistics
```

### Emotional Context (NEW)
```
GET    /v1/context/state             Current emotional state
GET    /v1/context/adaptation        Active adaptations
GET    /v1/context/history           Emotional state history
```

### Thoughts
```
GET    /v1/thoughts                  All autonomous thoughts
GET    /v1/thoughts/unshared         Thoughts not yet shown
POST   /v1/thoughts/:id/share        Mark thought as shared
```

### Research
```
POST   /v1/research                  Queue research task
GET    /v1/research/:id              Get results
GET    /v1/research                  List tasks
```

---

## Technology Stack

```
┌─────────────────────────────────────────┐
│  Frontend: iOS App (Swift)              │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────┴───────────────────────┐
│  Backend: Node.js + TypeScript          │
│  Framework: Express                     │
│  Language: TypeScript (strict mode)     │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────┴───────────────────────┐
│  Database: Supabase (PostgreSQL)        │
│  Extensions: pgvector                   │
│  Connection: Supabase client + pg pool  │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────┴───────────────────────┐
│  AI Services:                           │
│  • OpenAI (embeddings + completions)    │
│  • Studio API (auth + routing)          │
└─────────────────────────────────────────┘
```

---

This architecture makes Lucid **genuinely emotionally intelligent** - not just smart, but empathetic. 🧠💙

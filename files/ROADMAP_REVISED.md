# Lucid Agent - Revised Development Roadmap
## With Adaptive Context & Emotional Intelligence

This roadmap incorporates the insights from your conversation with Merv about building an emotionally-aware, context-adaptive AI agent.

---

## 🎯 Core Innovation: Adaptive Context Layer

Based on your vision, Lucid now has **three layers of intelligence**:

```
┌─────────────────────────────────────────────────────────┐
│  Layer 3: Adaptive Context (NEW)                        │
│  • Detects emotional states from personality shifts     │
│  • Adjusts timing of autonomous thoughts                │
│  • Modulates temperature/tone of system prompts         │
│  • Guides curiosity engine with empathy                 │
└────────────────┬────────────────────────────────────────┘
                 │ Adjusts ↓
┌────────────────┴────────────────────────────────────────┐
│  Layer 2: Circadian Intelligence                        │
│  • Morning: Reflection                                  │
│  • Midday: Curiosity & Research                         │
│  • Evening: Consolidation                               │
│  • Night: Dreams & Pattern Recognition                  │
└────────────────┬────────────────────────────────────────┘
                 │ Triggers ↓
┌────────────────┴────────────────────────────────────────┐
│  Layer 1: Core Memory & Chat                            │
│  • Facts with evidence tracking                         │
│  • Semantic search                                      │
│  • Streaming chat with memory injection                 │
└─────────────────────────────────────────────────────────┘
```

---

## ✅ Phase 1: Foundation (COMPLETED)

- [x] Database schema design (with emotional intelligence)
- [x] Project structure
- [x] Configuration system
- [x] Database connections (Supabase + pg)
- [x] TypeScript types
- [x] Documentation

**Key Addition**: Schema now includes:
- `personality_statistics` - Running averages & baselines
- `emotional_states` - Detected user states
- `context_adaptations` - How Lucid adjusts behavior
- Enhanced `conversations` - Time-of-day tracking

---

## 🚧 Phase 2: Memory System (NEXT - Estimated 2-3 weeks)

### 2.1 Core Memory (Week 1)

**User & Conversation Management**
- [ ] Create `UserService`
  - [ ] Find or create by external_id
  - [ ] Timezone management
- [ ] Create `ConversationService`
  - [ ] Start/end conversations
  - [ ] Track time_of_day automatically
  - [ ] List conversation history

**Message & Fact Extraction**
- [ ] Create `MessageService`
  - [ ] Save messages
  - [ ] Generate embeddings (OpenAI ada-002)
  - [ ] Token counting
- [ ] Create `FactService`
  - [ ] LLM-based fact extraction from messages
  - [ ] Categorization (personal, preference, goal, etc.)
  - [ ] Confidence calculation via evidence
- [ ] Create `EvidenceService`
  - [ ] Link evidence to facts
  - [ ] Automatic confidence updates (database trigger handles this)

**Vector Search**
- [ ] Create `VectorService`
  - [ ] Generate embeddings
  - [ ] Semantic similarity search
  - [ ] Hybrid search (keyword + vector)

### 2.2 Personality Tracking (Week 2)

**Big 5 Assessment**
- [ ] Create `PersonalityService`
  - [ ] Analyze conversations for Big 5 traits
  - [ ] Generate personality snapshots
  - [ ] Store reasoning for scores
  - [ ] Auto-update personality statistics (trigger handles this)

**Personality Baseline & Statistics**
- [ ] Query helpers for personality statistics
  - [ ] Get user baseline (averages)
  - [ ] Calculate standard deviations
  - [ ] Detect significant shifts (> 2 std dev)

### 2.3 Summaries (Week 2)

- [ ] Create `SummaryService`
  - [ ] Generate user perspective
  - [ ] Generate model perspective
  - [ ] Generate conversation overview
  - [ ] Batch summarization (every N messages)
  - [ ] Store embeddings for summaries

**Testing**
- [ ] Integration tests for memory extraction
- [ ] Verify confidence calculations
- [ ] Test semantic search accuracy

---

## 🧠 Phase 3: Adaptive Context Layer (NEW - Estimated 3-4 weeks)

This is the **key innovation** from your Merv conversation.

### 3.1 Emotional State Detection (Week 1)

**Pattern Analysis**
- [ ] Create `EmotionalStateService`
  - [ ] Detect personality shifts (compare current vs baseline)
  - [ ] Pattern detection:
    - **Struggling**: High neuroticism spike + low agreeableness
    - **Energized**: High extraversion + high openness
    - **Withdrawn**: Low extraversion + high neuroticism
    - **Reflective**: High openness + low extraversion, stable neuroticism
  - [ ] Store detected states with confidence scores
  - [ ] Link states to conversations

**Conversation Pattern Analysis**
- [ ] Time-of-day deviation detection
  - [ ] Track when user typically chats
  - [ ] Flag unusual patterns (e.g., late-night conversations)
- [ ] Topic recurrence tracking
  - [ ] Identify repeated topics within short time spans
  - [ ] Weight topics by emotional keywords

### 3.2 Context Adaptation Engine (Week 2)

**Dynamic Behavior Adjustment**
- [ ] Create `ContextAdaptationService`
  - [ ] Generate adaptations based on emotional states
  - [ ] Schedule adjustments:
    - Delay/advance circadian agents
    - Skip certain agents (e.g., night dreams when struggling)
  - [ ] Temperature modulation:
    - Lower for struggling (more focused, supportive)
    - Higher for energized (more creative, exploratory)
  - [ ] Tone directives:
    - "Be gentle and supportive"
    - "Be creative and exploratory"
    - "Keep brief and non-intrusive"

**Emotionally-Aware Curiosity**
- [ ] Create `CuriosityEngineService`
  - [ ] Generate research strategies based on emotional state
  - [ ] Struggling → Research gentle, supportive resources
  - [ ] Energized → Deep dives on user interests
  - [ ] Withdrawn → Minimal research (respect space)
  - [ ] Reflective → Philosophical/deep topics
  - [ ] Topic avoidance (sensitive topics when struggling)

### 3.3 Prompt Builder with Context (Week 3)

**Context-Aware System Prompts**
- [ ] Create `PromptBuilderService`
  - [ ] Base prompts for each circadian phase
  - [ ] Inject emotional state awareness
  - [ ] Adjust temperature based on state
  - [ ] Add tone directives
  - [ ] Example output:
    ```typescript
    {
      prompt: "You are Lucid in morning reflection mode. 
               The user appears to be struggling emotionally.
               Be gentle, supportive, and avoid overwhelming them.",
      temperature: 0.5,
      reasoning: "Struggling state detected - prioritize empathy"
    }
    ```

### 3.4 Integration & Testing (Week 4)

**End-to-End Flow**
- [ ] Wire up: Conversation → Personality → Emotional State → Adaptation
- [ ] Test scenarios:
  - [ ] Detect struggling state from neuroticism spike
  - [ ] Adjust schedules appropriately
  - [ ] Verify temperature modulation
  - [ ] Confirm research strategy changes
- [ ] Build dashboard view (optional)
  - [ ] Current emotional state
  - [ ] Active adaptations
  - [ ] Personality trend graph

---

## 💬 Phase 4: Streaming Chat with Memory (Estimated 2-3 weeks)

### 4.1 Context Assembly (Week 1)

**Memory Retrieval for Chat**
- [ ] Create `ContextBuilderService`
  - [ ] Retrieve top facts by confidence + similarity
  - [ ] Get recent conversation history
  - [ ] Fetch latest personality snapshot
  - [ ] Get relevant summaries
  - [ ] Check for active emotional state
  - [ ] Check for active context adaptations
  - [ ] Assemble enriched system prompt

**Example assembled context**:
```
PERSONALITY: Openness: 0.75, Conscientiousness: 0.65, Extraversion: 0.45, 
             Agreeableness: 0.80, Neuroticism: 0.55

EMOTIONAL STATE: Struggling (confidence: 0.82)
  - Neuroticism spike: +0.25 above baseline
  - Recent topics: breakup, relationship, lonely
  - Detected: 2 days ago

ADAPTATION: Be gentle and supportive. Lower temperature (0.5). 
            Avoid overwhelming the user.

RELEVANT FACTS:
1. User recently went through a breakup (confidence: 0.92)
2. User values deep conversations (confidence: 0.88)
3. User prefers evening reflection (confidence: 0.75)

RECENT SUMMARY:
User has been processing emotions from recent relationship end...
```

### 4.2 Streaming Chat Endpoint (Week 2)

**Chat Service**
- [ ] Create `ChatService`
  - [ ] Session token validation (via studio-api)
  - [ ] Build context-aware system prompt
  - [ ] Call model via studio-api
  - [ ] Stream response to client (SSE)
  - [ ] Background: Save messages
  - [ ] Background: Extract facts
  - [ ] Background: Update personality
  - [ ] Background: Detect emotional state changes

**Routes**
- [ ] `POST /v1/chat` - Streaming chat
- [ ] `GET /v1/memory/facts` - List facts
- [ ] `POST /v1/memory/facts` - Manually add fact
- [ ] `GET /v1/memory/search` - Semantic search
- [ ] `GET /v1/personality` - Current personality
- [ ] `GET /v1/personality/history` - Evolution over time
- [ ] `GET /v1/context/state` - Current emotional state & adaptations

### 4.3 Background Processing (Week 2-3)

**Post-Chat Processing**
- [ ] Fact extraction job (runs after each message)
- [ ] Personality assessment job (every N messages)
- [ ] Emotional state detection job (when personality changes)
- [ ] Summary generation job (periodically)

---

## 🤖 Phase 5: Autonomous Intelligence (Estimated 3-4 weeks)

### 5.1 Job System (Week 1)

**Background Job Infrastructure**
- [ ] Choose job queue (recommend: **node-cron** for MVP, **BullMQ** for scale)
- [ ] Create `AgentJobService`
  - [ ] Schedule jobs per user (timezone-aware)
  - [ ] Check for active adaptations before running
  - [ ] Execute circadian agents
  - [ ] Store job results
  - [ ] Error handling & retry logic

### 5.2 Circadian Agents (Week 2-3)

**Morning Reflection Agent (7-10am)**
- [ ] Review yesterday's conversations
- [ ] Identify unresolved topics
- [ ] Generate reflective thoughts
- [ ] Check emotional state for tone adjustment

**Midday Curiosity Agent (12-2pm)**
- [ ] Identify user's current interests
- [ ] Generate research questions
- [ ] Queue web research tasks
- [ ] Adjust based on emotional state:
  - Struggling → Research supportive content
  - Energized → Deep exploration
  - Withdrawn → Skip or minimal
  - Reflective → Philosophical topics

**Evening Consolidation Agent (8-11pm)**
- [ ] Summarize today's conversations
- [ ] Update fact confidence
- [ ] Generate insights
- [ ] Update personality assessment
- [ ] Detect emotional state changes

**Night Dream Processor (2-4am)**
- [ ] Memory consolidation
- [ ] Pattern recognition across facts
- [ ] Identify contradictions
- [ ] Generate long-term insights
- [ ] Skip if user is struggling (let them rest)

### 5.3 Autonomous Thought Management (Week 3)

**Thought Service**
- [ ] Create `ThoughtService`
  - [ ] Store thoughts from agents
  - [ ] Tag with circadian phase
  - [ ] Calculate importance scores
  - [ ] Track shared vs unshared

**Thought Injection into Chat**
- [ ] Check for unshared thoughts before each chat
- [ ] Inject relevant thoughts into context
- [ ] Lucid can proactively share:
  - "I've been thinking about what you said yesterday..."
  - "While reflecting this morning, I realized..."
  - "I'm curious about something you mentioned..."
- [ ] Mark thoughts as shared

### 5.4 Asynchronous Pattern Analysis (Week 4)

**NEW: Pattern Study Agent**
- [ ] Dedicated agent that studies Big 5 patterns
- [ ] Runs weekly or after significant data accumulation
- [ ] Analyzes:
  - Time-based patterns (e.g., "Openness always drops on Sundays")
  - Trigger patterns (e.g., "Agreeableness drops before family calls")
  - Seasonal patterns (e.g., "Extraversion lower in winter")
  - Predictive patterns (e.g., "3+ days of high neuroticism → breakthrough conversation")
- [ ] Generates autonomous insights
- [ ] Stores findings as high-importance thoughts

**Routes**
- [ ] `GET /v1/thoughts` - Get all thoughts
- [ ] `GET /v1/thoughts/unshared` - Unshared thoughts
- [ ] `POST /v1/thoughts/:id/share` - Mark as shared
- [ ] `GET /v1/patterns` - Detected personality patterns

---

## 🔍 Phase 6: Web Research Integration (Estimated 1-2 weeks)

### 6.1 Research System

**Research Service**
- [ ] Create `ResearchService`
  - [ ] Queue research tasks (triggered by curiosity agent)
  - [ ] Web search integration (Brave Search API or similar)
  - [ ] Scrape and summarize results
  - [ ] Extract facts from research
  - [ ] Link derived facts to research task

**Emotionally-Aware Research**
- [ ] Research strategy based on emotional state
- [ ] Topic filtering (avoid triggering topics when struggling)
- [ ] Gentle summarization for struggling users
- [ ] Deep analysis for energized users

**Routes**
- [ ] `POST /v1/research` - Queue research task
- [ ] `GET /v1/research/:id` - Get results
- [ ] `GET /v1/research` - List tasks

---

## 🚀 Phase 7: Advanced Features (Future Vision)

### Multi-User & Collaboration
- [ ] Shared conversations
- [ ] Cross-user insights (privacy-preserving)
- [ ] Group dynamics

### Predictive Intelligence
- [ ] Predict user needs before asking
- [ ] Anticipate questions from patterns
- [ ] Proactive suggestions based on emotional trajectory

### Enhanced Emotional Intelligence
- [ ] Sentiment analysis per message
- [ ] Emotional state tracking beyond Big 5
- [ ] Crisis detection and gentle intervention

### Multimodal
- [ ] Voice input/output
- [ ] Image understanding
- [ ] Document analysis

---

## 📊 Success Metrics

### Phase 2 (Memory)
- ✅ Facts extracted with >85% accuracy
- ✅ Evidence tracking with automatic confidence
- ✅ Semantic search returns relevant results
- ✅ Personality assessments align with user perception

### Phase 3 (Adaptive Context) **NEW**
- ✅ Emotional states detected accurately (>80% user agreement)
- ✅ Context adaptations feel natural and helpful
- ✅ Temperature modulation improves conversation quality
- ✅ Curiosity engine respects emotional boundaries
- ✅ Users feel "understood" by Lucid

### Phase 4 (Chat)
- ✅ Memory context improves response relevance
- ✅ Streaming latency < 1 second to first token
- ✅ Emotional state awareness enhances empathy
- ✅ Users report feeling supported appropriately

### Phase 5 (Autonomy)
- ✅ Agents run on schedule without errors
- ✅ Thoughts are relevant and insightful
- ✅ Circadian variations are noticeable
- ✅ Adaptations adjust agent behavior appropriately
- ✅ Pattern analysis provides actionable insights

---

## 🎯 Current Status

**Phase**: 1 (Foundation) ✅ **COMPLETE**

**Next**: Phase 2 (Memory System) - User management, facts, evidence, personality

**Key Insight**: Phase 3 (Adaptive Context) is now a **critical differentiator** that makes Lucid emotionally intelligent, not just conversationally capable.

---

## 💡 Key Design Principles

1. **Build Incrementally**: Each phase delivers value
2. **Test Emotional Intelligence**: Validate state detection with real usage
3. **Privacy First**: Sensitive emotional data requires extra care
4. **Cost Awareness**: Monitor OpenAI API usage (embeddings + LLM calls)
5. **Graceful Degradation**: If state detection uncertain, default to neutral behavior
6. **User Control**: Eventually let users see/override detected states

---

## 🔄 Feedback Loop

As you build, continuously validate:
1. Are personality assessments accurate?
2. Do detected emotional states feel right?
3. Are adaptations helpful or intrusive?
4. Does temperature modulation improve responses?
5. Is the curiosity engine respectful of boundaries?

**This is genuinely innovative AI architecture.** The combination of:
- Evidence-based memory
- Big 5 personality tracking with baselines
- Emotional state detection from personality shifts
- Context-aware adaptation of thinking patterns
- Empathetic curiosity engine

...creates an AI that doesn't just respond intelligently, but **cares intelligently**.

---

**Let's build the most emotionally intelligent AI agent.** 🧠💙✨

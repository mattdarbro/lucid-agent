# Lucid Agent - Development Roadmap

This roadmap outlines the phased development of Lucid Agent from foundation to full autonomy.

---

## ✅ Phase 1: Foundation (COMPLETED)

**Goal**: Set up the infrastructure for a scalable, intelligent agent.

### Completed
- [x] Database schema design (facts, evidence, summaries, personality, thoughts)
- [x] TypeScript project structure
- [x] Configuration system with validation
- [x] Database connections (Supabase + PostgreSQL with pgvector)
- [x] Logger utility
- [x] Type definitions for all database entities
- [x] Basic Express server with health endpoints
- [x] Documentation (README, SETUP_GUIDE, DATABASE_SCHEMA)

### Architecture Decisions
- **Separate from studio-api**: Clean separation of concerns
- **Supabase + pgvector**: Managed PostgreSQL with vector search
- **Dual DB clients**: Supabase client for simple queries, pg pool for advanced/vector queries
- **TypeScript**: Type safety throughout

---

## 🚧 Phase 2: Memory System (NEXT)

**Goal**: Implement human-like memory with facts, evidence, and semantic search.

### User Management
- [ ] Create `UserService` for user CRUD operations
- [ ] Find or create user by `external_id` (iOS user ID)
- [ ] User timezone handling

### Conversation & Messages
- [ ] Create `ConversationService`
  - [ ] Start new conversation
  - [ ] Get active conversation for user
  - [ ] End conversation
  - [ ] List user's conversation history
- [ ] Create `MessageService`
  - [ ] Save messages with role (user/assistant/system)
  - [ ] Generate embeddings for messages (OpenAI ada-002)
  - [ ] Store embeddings for semantic search
  - [ ] Token counting

### Fact & Evidence System
- [ ] Create `FactService`
  - [ ] Extract facts from user messages (LLM-based)
  - [ ] Store facts with categories
  - [ ] Update fact confidence based on evidence
  - [ ] Mark facts as inactive (when contradicted)
- [ ] Create `EvidenceService`
  - [ ] Link evidence to facts
  - [ ] Calculate evidence strength
  - [ ] Automatic confidence updates via database trigger
- [ ] Semantic fact search (vector similarity)

### Summaries
- [ ] Create `SummaryService`
  - [ ] Generate user perspective summary
  - [ ] Generate model perspective summary
  - [ ] Generate conversation overview summary
  - [ ] Batch summarization (every N messages)
  - [ ] Store embeddings for summaries

### Vector Search
- [ ] Create `VectorService`
  - [ ] Generate embeddings via OpenAI
  - [ ] Semantic similarity search
  - [ ] Hybrid search (keyword + semantic)
  - [ ] Relevance ranking

**Deliverable**: Full memory system with fact extraction, evidence tracking, and semantic search.

---

## 🧠 Phase 3: Intelligence & Chat (PLANNED)

**Goal**: Build streaming chat with memory-augmented responses and personality modeling.

### Personality System
- [ ] Create `PersonalityService`
  - [ ] Analyze messages for Big 5 traits
  - [ ] Calculate trait scores (0.00 to 1.00)
  - [ ] Store personality snapshots over time
  - [ ] Track personality evolution
  - [ ] Generate reasoning for assessments

### Memory Retrieval for Context
- [ ] Create `ContextBuilder`
  - [ ] Retrieve relevant facts (top K by confidence + similarity)
  - [ ] Get recent conversation history
  - [ ] Fetch latest personality snapshot
  - [ ] Get relevant summaries
  - [ ] Assemble complete context for LLM

### Streaming Chat
- [ ] Create `ChatService`
  - [ ] Session token validation (via studio-api)
  - [ ] Build enriched system prompt with memory
  - [ ] Call model via studio-api
  - [ ] Stream response to client (SSE or streaming JSON)
  - [ ] Background: Extract facts from new messages
  - [ ] Background: Save messages with embeddings
  - [ ] Background: Update summaries periodically

### Routes
- [ ] `POST /v1/chat` - Streaming chat endpoint
- [ ] `GET /v1/memory/facts` - List user facts
- [ ] `POST /v1/memory/facts` - Manually add fact
- [ ] `GET /v1/memory/search` - Semantic memory search
- [ ] `GET /v1/personality` - Current personality assessment
- [ ] `GET /v1/personality/history` - Personality over time

**Deliverable**: Fully functional chat with memory injection and personality awareness.

---

## 🤖 Phase 4: Autonomous Intelligence (ADVANCED)

**Goal**: Lucid thinks autonomously without user prompts, with circadian patterns.

### Background Job System
- [ ] Choose job queue (node-cron vs BullMQ)
  - **node-cron**: Simple, built-in, good for single server
  - **BullMQ**: Redis-based, scalable, better for production
- [ ] Implement `AgentJobService`
  - [ ] Schedule jobs for each user based on timezone
  - [ ] Execute jobs (morning/midday/evening/night)
  - [ ] Store job results
  - [ ] Error handling & retry logic

### Circadian Agents

#### Morning Reflection Agent (7-10am)
- [ ] Review yesterday's conversations
- [ ] Identify unresolved topics
- [ ] Generate reflective thoughts
- [ ] Prepare proactive questions for user

**Prompt template**:
```
You are Lucid, reflecting on your conversations with [User].
Yesterday, you discussed: [summary].
Consider: What was most important to [User]?
What remains unresolved? What might they need today?
```

#### Midday Curiosity Agent (12-2pm)
- [ ] Identify topics user is interested in
- [ ] Generate research questions
- [ ] Queue web research tasks
- [ ] Explore patterns in user's facts

**Prompt template**:
```
You are Lucid, being curious about [User]'s interests.
They frequently mention: [top facts].
What could you learn to better assist them?
What questions do you have about their world?
```

#### Evening Consolidation Agent (8-11pm)
- [ ] Summarize today's conversations
- [ ] Update fact confidence based on evidence
- [ ] Generate end-of-day insights
- [ ] Update personality assessment

**Prompt template**:
```
You are Lucid, reflecting on today with [User].
Today's conversations: [summary].
What did you learn? How has your understanding evolved?
Consolidate your knowledge.
```

#### Night Dream Processor (2-4am)
- [ ] Memory consolidation (cluster similar facts)
- [ ] Pattern recognition across conversations
- [ ] Identify contradictions or inconsistencies
- [ ] Generate insights for long-term understanding

**Prompt template**:
```
You are Lucid, in a dream-like state, processing memories of [User].
Facts: [all facts].
Patterns: [conversation patterns].
What deeper understanding emerges? What contradictions exist?
Organize your knowledge.
```

### Autonomous Thoughts
- [ ] Create `ThoughtService`
  - [ ] Store thoughts generated by agents
  - [ ] Tag with circadian phase
  - [ ] Track importance scores
  - [ ] Mark thoughts shared vs. unshared
- [ ] Routes:
  - [ ] `GET /v1/thoughts` - Get thoughts
  - [ ] `GET /v1/thoughts/unshared` - Thoughts not yet shown to user
  - [ ] `POST /v1/thoughts/:id/share` - Mark as shared

### Thought Integration with Chat
- [ ] Inject unshared thoughts into chat context
- [ ] Lucid can proactively share insights:
  - "I've been thinking about what you said yesterday..."
  - "While reflecting this morning, I realized..."
  - "I'm curious about something you mentioned..."

**Deliverable**: Fully autonomous agent that thinks, reflects, and learns 24/7.

---

## 🔍 Phase 5: Web Research & External Knowledge (FUTURE)

**Goal**: Lucid can research topics autonomously to better assist the user.

### Research System
- [ ] Create `ResearchService`
  - [ ] Queue research tasks (triggered by curiosity or user mention)
  - [ ] Web search integration (Google, Bing, or Brave API)
  - [ ] Scrape and summarize web results
  - [ ] Extract facts from research
  - [ ] Link derived facts to research task
- [ ] Research triggers:
  - [ ] User mentions topic 3+ times
  - [ ] Midday curiosity agent identifies gap
  - [ ] User explicitly asks to research

### Routes
- [ ] `POST /v1/research` - Queue research task
- [ ] `GET /v1/research/:id` - Get research results
- [ ] `GET /v1/research` - List user's research tasks

**Deliverable**: Lucid proactively researches topics and enriches conversations with external knowledge.

---

## 🚀 Phase 6: Advanced Features (VISION)

**Goal**: Cutting-edge capabilities for a truly intelligent agent.

### Multi-User Collaboration
- [ ] Shared conversations between users
- [ ] Cross-user fact synthesis (privacy-preserving)
- [ ] Group personality dynamics

### Long-Term Memory Evolution
- [ ] Fact decay (old, unmentioned facts lose confidence)
- [ ] Memory reconsolidation (re-evaluate facts periodically)
- [ ] Episodic memory clusters (life events)

### Predictive Intelligence
- [ ] Predict user needs before they ask
- [ ] Anticipate questions based on patterns
- [ ] Proactive suggestions

### Emotional Intelligence
- [ ] Sentiment analysis of messages
- [ ] Emotional state tracking
- [ ] Empathetic response generation

### Advanced Personality
- [ ] OCEAN + additional traits (honesty-humility, etc.)
- [ ] Communication style adaptation
- [ ] Conflict resolution patterns

### Voice & Multimodal
- [ ] Voice input/output integration
- [ ] Image understanding (user-shared photos)
- [ ] Document analysis (PDFs, notes)

---

## Timeline Estimate

| Phase | Duration | Complexity |
|-------|----------|------------|
| Phase 1 (Foundation) | ✅ Complete | Medium |
| Phase 2 (Memory) | 2-3 weeks | High |
| Phase 3 (Intelligence) | 2-3 weeks | High |
| Phase 4 (Autonomy) | 3-4 weeks | Very High |
| Phase 5 (Research) | 1-2 weeks | Medium |
| Phase 6 (Advanced) | Ongoing | Very High |

**Total for core functionality (Phases 1-4)**: ~8-10 weeks

---

## Success Metrics

### Phase 2 (Memory)
- ✅ Facts extracted with >80% accuracy
- ✅ Evidence tracking with automatic confidence updates
- ✅ Semantic search returns relevant results
- ✅ Summaries capture key points from both perspectives

### Phase 3 (Intelligence)
- ✅ Personality assessment aligns with user's self-perception
- ✅ Chat responses incorporate relevant facts
- ✅ Streaming latency < 1 second to first token
- ✅ Memory context improves response quality

### Phase 4 (Autonomy)
- ✅ Agents run on schedule without errors
- ✅ Thoughts generated are relevant and insightful
- ✅ Circadian variations are noticeable in output
- ✅ Users report feeling "understood" by Lucid

---

## Current Status

**Phase**: 1 (Foundation) ✅ **COMPLETE**

**Next Up**: Phase 2 - Building the memory system (user management, facts, evidence, semantic search)

---

## Notes

- **Build incrementally**: Each phase is valuable on its own
- **Test thoroughly**: Memory and personality are foundational - get them right
- **Iterate on prompts**: Circadian agents will need prompt refinement
- **Monitor costs**: OpenAI embeddings + LLM calls add up - track usage
- **Privacy first**: User data is sensitive - secure everything

---

**Let's build the future of AI agents.** 🧠✨

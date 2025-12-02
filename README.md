# Lucid Agent 🧠

An autonomous AI agent with human-like memory, circadian thinking patterns, and proactive intelligence.

## Vision

Lucid is designed to be a truly autonomous AI agent that:

- 🧠 **Remembers like a human** - Facts with evidence tracking, confidence levels, and semantic search
- 👥 **Understands perspective** - Dual summaries (user and model viewpoints) for deeper context
- 🎭 **Models personality** - Big 5 personality traits that evolve over time
- 🌅 **Thinks with circadian rhythms** - Different cognitive patterns for morning/midday/evening/night
- 🤔 **Is genuinely curious** - Proactive web research on topics of interest
- 💭 **Dreams** - Background memory consolidation and pattern recognition
- ⚡ **Responds quickly** - Separate from studio-api for focused intelligence

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      iOS App                            │
└────────────────┬────────────────────────────────────────┘
                 │
                 ↓
    ┌────────────────────────────┐
    │     lucid-agent (THIS)     │
    │      Port 4000             │
    ├────────────────────────────┤
    │ • Streaming chat           │
    │ • Memory & facts           │
    │ • Personality modeling     │
    │ • Autonomous thinking      │
    │ • Circadian agents         │
    └─────────────┬──────────────┘
                  │
         ┌────────┴────────┐
         ↓                 ↓
    ┌────────┐      ┌──────────┐
    │ Studio │      │ Supabase │
    │  API   │      │    DB    │
    └────────┘      └──────────┘
```

## Database Schema

The database is designed around these core tables:

### Memory System
- **`users`** - User identity and metadata
- **`conversations`** - Chat sessions
- **`messages`** - Individual messages with vector embeddings
- **`facts`** - Knowledge extracted from conversations
- **`evidence`** - Supporting evidence for each fact (with confidence)
- **`summaries`** - Dual summaries (user/model/overall perspectives)

### Intelligence System
- **`personality_snapshots`** - Big 5 personality traits over time
- **`autonomous_thoughts`** - Lucid's self-generated insights
- **`research_tasks`** - Web research queue and results
- **`agent_jobs`** - Background jobs (morning/midday/evening/night agents)

See [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) for full details.

## Setup

### 1. Prerequisites

- Node.js 18+
- A Supabase project (or PostgreSQL with pgvector)
- OpenAI API key (for embeddings)
- Anthropic API key (for chat/LLM)
- Tavily API key (optional, for web research)
- Studio API running (from `studio-api` project)

### 2. Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Wait for the database to initialize
3. Go to **SQL Editor** and run the contents of `schema.sql`
4. Verify pgvector extension is enabled:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```bash
# Supabase (from your project settings)
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-role-key

# Database URL (from Supabase settings > Database > Connection string > URI)
DATABASE_URL=postgresql://postgres:[password]@db.[project].supabase.co:5432/postgres

# OpenAI (for embeddings)
OPENAI_API_KEY=sk-...

# Anthropic (for chat/LLM)
ANTHROPIC_API_KEY=sk-ant-...

# Tavily (optional, for web research)
TAVILY_API_KEY=tvly-...

# Studio API (from your studio-api project)
STUDIO_API_URL=http://localhost:3000
STUDIO_APP_KEY=your-app-key-from-env

# Feature Flags
ENABLE_AUTONOMOUS_AGENTS=true
ENABLE_WEB_RESEARCH=true   # Requires TAVILY_API_KEY
ENABLE_DREAMS=true
```

### 4. Install Dependencies

```bash
npm install
```

### 5. Run Development Server

```bash
npm run dev
```

You should see:
```
🧠 Lucid agent running on 0.0.0.0:4000
📊 Health: http://localhost:4000/health
ℹ️  Info: http://localhost:4000/info
🔗 Studio API: http://localhost:3000
```

### 6. Deploy to Railway

1. Create a new Railway project
2. Connect to your GitHub repo (after you push this code)
3. Add environment variables from `.env`
4. Railway will auto-detect the build commands from `package.json`

## Development Roadmap

### ✅ Phase 1: Foundation (CURRENT)
- [x] Database schema design
- [x] Project structure
- [x] Configuration system
- [x] Database connections (Supabase + PostgreSQL)
- [x] TypeScript types
- [x] Logger utility
- [ ] Session validation with studio-api

### 🚧 Phase 2: Memory System
- [ ] User management service
- [ ] Conversation tracking
- [ ] Message storage with embeddings
- [ ] Fact extraction from conversations
- [ ] Evidence tracking and confidence calculation
- [ ] Vector search for semantic memory
- [ ] Dual summary generation

### 🔮 Phase 3: Intelligence
- [ ] Big 5 personality assessment
- [ ] Personality evolution tracking
- [ ] Memory injection for chat context
- [ ] Streaming chat endpoint
- [ ] Integration with studio-api for model calls

### 🤖 Phase 4: Autonomy
- [x] Background job system (cron-based)
- [x] Morning reflection agent (7am daily)
- [ ] Midday curiosity agent (12-2pm)
- [ ] Evening consolidation agent (8-11pm)
- [ ] Night dream processor (2-4am)
- [x] Circadian prompt templates
- [x] Web research integration (Tavily API)
- [x] Thought sharing with user

## API Endpoints (Planned)

### Chat
```
POST /v1/chat
- Streaming chat with memory injection
- Session token auth via studio-api
```

### Memory
```
GET  /v1/memory/facts - Get user's facts
POST /v1/memory/facts - Manually add a fact
GET  /v1/memory/conversations - List conversations
GET  /v1/memory/search - Semantic search across memories
```

### Personality
```
GET /v1/personality - Get current Big 5 assessment
GET /v1/personality/history - Personality evolution over time
```

### Thoughts
```
GET /v1/thoughts - Get Lucid's autonomous thoughts
GET /v1/thoughts/unshared - Thoughts not yet shared with user
POST /v1/thoughts/:id/share - Mark thought as shared
```

## Contributing

This is a personal research project, but contributions are welcome!

## License

MIT

---

**Built with ❤️ to explore the future of AI agents**

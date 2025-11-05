# Lucid Agent - Project Structure

```
lucid-agent/
├── README.md                    # Project overview and quick start
├── ROADMAP.md                   # Development phases and timeline
├── SETUP_GUIDE.md               # Step-by-step setup instructions
├── DATABASE_SCHEMA.md           # Detailed database design documentation
├── PROJECT_STRUCTURE.md         # This file
│
├── schema.sql                   # Database initialization script
├── package.json                 # Dependencies and scripts
├── tsconfig.json                # TypeScript configuration
├── .gitignore                   # Git ignore rules
├── .env.example                 # Environment variables template
├── .env                         # Actual environment variables (not in git)
│
└── src/                         # Source code
    ├── index.ts                 # Main entry point (Express server)
    ├── config.ts                # Configuration management
    ├── logger.ts                # Logging utility
    ├── db.ts                    # Database connections (Supabase + PostgreSQL)
    │
    ├── types/                   # TypeScript type definitions
    │   └── database.ts          # Database entity types
    │
    ├── services/               # Business logic (TO BE BUILT)
    │   ├── user.service.ts     # User management
    │   ├── conversation.service.ts
    │   ├── message.service.ts
    │   ├── fact.service.ts     # Fact extraction & storage
    │   ├── evidence.service.ts # Evidence tracking
    │   ├── summary.service.ts  # Dual summaries
    │   ├── personality.service.ts # Big 5 modeling
    │   ├── vector.service.ts   # Embeddings & semantic search
    │   ├── context.service.ts  # Memory retrieval for chat
    │   ├── chat.service.ts     # Streaming chat
    │   ├── thought.service.ts  # Autonomous thoughts
    │   └── research.service.ts # Web research
    │
    ├── agents/                 # Autonomous agents (TO BE BUILT)
    │   ├── morning.agent.ts    # 7-10am reflection
    │   ├── midday.agent.ts     # 12-2pm curiosity
    │   ├── evening.agent.ts    # 8-11pm consolidation
    │   └── night.agent.ts      # 2-4am dreams
    │
    ├── routes/                 # API endpoints (TO BE BUILT)
    │   ├── chat.route.ts       # POST /v1/chat
    │   ├── memory.route.ts     # /v1/memory/*
    │   ├── personality.route.ts # /v1/personality
    │   ├── thoughts.route.ts   # /v1/thoughts
    │   └── research.route.ts   # /v1/research
    │
    ├── middleware/             # Express middleware (TO BE BUILT)
    │   ├── auth.middleware.ts  # Session validation
    │   └── error.middleware.ts # Error handling
    │
    └── prompts/                # LLM prompt templates (TO BE BUILT)
        ├── fact-extraction.ts
        ├── personality.ts
        ├── summary.ts
        └── circadian/
            ├── morning.ts
            ├── midday.ts
            ├── evening.ts
            └── night.ts
```

## Key Files

### Configuration & Setup
- **`.env.example`**: Template for environment variables
- **`schema.sql`**: Complete database schema (run in Supabase)
- **`package.json`**: Dependencies and npm scripts

### Documentation
- **`README.md`**: Overview, architecture, and quick start
- **`SETUP_GUIDE.md`**: Step-by-step setup instructions
- **`DATABASE_SCHEMA.md`**: Detailed schema design and rationale
- **`ROADMAP.md`**: Development phases and features

### Core Application
- **`src/index.ts`**: Express server, routes, startup logic
- **`src/config.ts`**: Centralized configuration
- **`src/logger.ts`**: Colored logging utility
- **`src/db.ts`**: Supabase client + PostgreSQL pool

### Types
- **`src/types/database.ts`**: TypeScript types for all database entities

## Development Workflow

### Running Locally
```bash
npm run dev      # Start development server with hot reload
npm run build    # Compile TypeScript to dist/
npm start        # Run compiled production build
```

### Database
```bash
# Initialize database (run schema.sql in Supabase SQL editor)
# Or use migration script (when built):
npm run db:migrate
```

### Testing
```bash
# Health check
curl http://localhost:4000/health

# Info
curl http://localhost:4000/info
```

## Next Steps

1. **Build services** in `src/services/`
2. **Create routes** in `src/routes/`
3. **Implement agents** in `src/agents/`
4. **Test with iOS app**

## Architecture Notes

### Why Supabase + pg Pool?
- **Supabase client**: Easy for simple CRUD, built-in auth helpers
- **pg pool**: Required for raw SQL, vector search, transactions

### Why separate services?
- **Single Responsibility**: Each service focuses on one domain
- **Testable**: Easy to unit test in isolation
- **Reusable**: Services can call each other

### Why autonomous agents?
- **Circadian thinking**: Different cognitive modes at different times
- **Proactive intelligence**: Lucid thinks even when user isn't chatting
- **Memory consolidation**: Background processing improves future responses

---

**Current Status**: Foundation complete, ready for Phase 2 (Memory System)

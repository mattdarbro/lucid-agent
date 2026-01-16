# Lucid Simplified Design

*Design document from January 9, 2026 session*

## Vision

Lucid as an **informed witness** to Matt's flourishing - not just reflecting on conversations, but aware of actions, commitments, and plans. Simple enough for agents to route reliably.

---

## Core Metaphors (Keep)

| Metaphor | Purpose |
|----------|---------|
| **Room** | Presence, conversation |
| **Library** | Persistence, reading past thoughts |
| **Capture** | Quick input, no conversation needed (NEW) |

---

## Simplified Data Model

### Library Entry Types (4, down from 14)

| Type | Source | Examples |
|------|--------|----------|
| `reflection` | Lucid AL | Evening synthesis, deep thoughts |
| `insight` | User capture | "What if...", ideas |
| `tool_output` | Tools | Vision, Possibilities, State results |
| `briefing` | AL nudges | Daily briefing, weekly digest |

### Actions (NEW table)

```sql
CREATE TABLE actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'open', -- open, done, cancelled
  person_id UUID REFERENCES orbits(id), -- optional link to person
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);
```

### Facts (Simplified)

Remove category field. Just:
- content
- confidence
- last_mentioned_at

### Orbits (Keep as-is)

Already simple: name, relationship, notes, last_mentioned

---

## Capture System

### Endpoint

```
POST /v1/capture
Body: { "user_id": "...", "content": "Get eggs" }
Response: { "routed_to": "action", "summary": "Action: Get eggs" }
```

### AI Classification Prompt

```
Classify this capture into exactly ONE category:
- ACTION: Something to do (tasks, reminders, follow-ups)
- IDEA: A thought, insight, or reflection worth keeping
- FACT: Something true about the user (preferences, info)
- PERSON: Information about someone in user's life

Capture: "{content}"

Respond with JSON:
{
  "category": "ACTION" | "IDEA" | "FACT" | "PERSON",
  "summary": "brief cleaned-up version",
  "person_name": "if PERSON or ACTION mentions someone",
  "confidence": 0.0-1.0
}
```

### Routing Logic

```
If confidence < 0.7:
  → Ask for clarification (don't file)

If ACTION:
  → Create in actions table
  → Link to orbit if person mentioned

If IDEA:
  → Create library entry (type: insight)

If FACT:
  → Create in facts table

If PERSON:
  → Update or create orbit entry
```

---

## Autonomous Loops (AL)

### Built

| Loop | Job Type | Status |
|------|----------|--------|
| Evening Synthesis | `evening_consolidation` | ✅ Built |
| Morning Briefing | `morning_reflection` | ✅ Built |
| Weekly Digest | `afternoon_synthesis` | ✅ Built |
| Web Research | `midday_curiosity` | ✅ Built |

### Planned

| Loop | Job Type | Purpose |
|------|----------|---------|
| Night Dream | `night_dream` | Pattern recognition, weird connections |
| Document Reflection | `document_reflection` | Living Document maintenance |

### Evening Synthesis Loop (Reference)

4-step structure:
1. **NOTICE** - What stands out from conversation?
2. **CONNECT** - How does it relate to what you know?
3. **QUESTION** - What genuine question is forming?
4. **SYNTHESIZE** - Write something or "nothing today"

Output: Library entry (type: `reflection` or `consolidation`)

---

## Briefings

### Daily Briefing (~150 words)

```
Good morning.

Open actions:
• Call mom about birthday
• Follow up with Jake (contract)
• Get eggs

Yesterday you captured:
• "What if Lucid could track projects..."

Nothing time-sensitive today.
```

Stored as: Library entry (type: `briefing`, time_of_day: `morning`)

### Weekly Digest (Sunday, ~300 words)

```
Week in Review

Wins:
• [completed actions, insights]

Open loops:
• [ongoing actions]

Looking ahead:
• [time-sensitive items]

Ideas worth revisiting:
• [captured ideas from the week]
```

Stored as: Library entry (type: `briefing`, time_of_day: `afternoon`)

---

## Build Phases

| Phase | What | Status |
|-------|------|--------|
| **0** | Evening Synthesis AL | ✅ Done |
| **1** | Actions table + migration | ✅ Done |
| **2** | Capture endpoint + AI routing | ✅ Done |
| **3** | Morning Briefing AL | ✅ Done |
| **4** | Weekly Digest AL | ✅ Done |
| **5** | iOS Capture tab | 📱 Guide created |
| **6** | Additional AL loops (dreams, etc.) | 🔜 Planned |

---

## iOS Changes Needed

1. **Capture tab** - New tab with simple input field
2. **Briefing notifications** - Push when briefing ready
3. **Library type filtering** - Show/filter by entry type
4. **Actions view** - Optional, could just show in briefings

---

## Tools (Keep)

These remain as specialized features, not daily workflow:

- **Vision Appraisal** - Dream/goal exploration
- **State Check** - Guided life discovery
- **Possibilities** - Branching when stuck

Output goes to Library as `tool_output` type.

---

## Key Principles (from YouTube system)

1. One reliable human behavior (capture in one place)
2. Separate memory, compute, interface
3. Keep categories painfully small (4 categories)
4. Default to safe behavior (ask if uncertain)
5. Small, frequent, actionable outputs (briefings)
6. Design for restart, not perfection
7. Build core loop, then add modules

---

## File Locations

### Services
- AL Service: `src/services/autonomous-loop.service.ts`
- Background Jobs: `src/services/background-jobs.service.ts`
- Actions Service: `src/services/actions.service.ts`
- Capture Service: `src/services/capture.service.ts`

### Routes
- Capture: `POST /v1/capture`, `POST /v1/capture/force`, `POST /v1/capture/classify`
- Actions: `GET/POST /v1/actions`, `PATCH /v1/actions/:id`, etc.
- Manual AL triggers:
  - `POST /v1/sync/evening-synthesis`
  - `POST /v1/sync/morning-briefing`
  - `POST /v1/sync/weekly-digest`
  - `POST /v1/sync/web-research`

### iOS Guide
- `docs/IOS_CAPTURE_TAB_GUIDE.md` - Comprehensive iOS implementation guide

---

*Updated: January 9, 2026 - Phases 1-4 complete*

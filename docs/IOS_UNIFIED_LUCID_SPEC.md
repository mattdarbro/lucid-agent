# iOS Spec: Unified Lucid Experience

## Overview

This spec replaces the previous mode documents spec. We're moving from a mode-based system to a unified Lucid experience with structured tools.

### What's Changing

| Before | After |
|--------|-------|
| Mode switching (/M, /O, /L, /P, /S) | No modes - just talk |
| Mode indicator in chat | Remove |
| 5 Mode Documents | 1 Living Document (Lucid's notes) |
| Possibilities/State as modes | Tools in "..." menu |

---

## Part 1: Remove Mode UI

### Chat View Changes

1. **Remove mode indicator** from chat header
2. **Remove mode switching** - no /M, /O, etc. parsing needed on client
3. **Keep orbit add** - /O+Name still works via API (optional)

The chat experience becomes simpler - just talk to Lucid.

---

## Part 2: Living Document (Lucid's Notes)

### What It Is

A read-only view of Lucid's working memory. This is Lucid's scratchpad - what he's curious about, patterns he's noticed, questions he's holding.

**Users can read but not edit** - this is Lucid's space.

### Access Point

Add to existing "..." menu or Settings:
- "Lucid's Notes" or "What Lucid is Thinking"

### UI Design

```
┌─────────────────────────────────────┐
│ ←  Lucid's Notes              ⋮     │
├─────────────────────────────────────┤
│                                     │
│ Last reflection: Jan 3, 2026        │
│                                     │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                     │
│ ## Questions I'm Holding            │
│                                     │
│ • Why does Matt approach work       │
│   differently lately?               │
│ • What's driving the hesitation     │
│   around the new project?           │
│                                     │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                     │
│ ## Patterns I'm Seeing              │
│                                     │
│ • Gets energized by early morning   │
│   conversations                     │
│ • Tends to process big decisions    │
│   over multiple days                │
│                                     │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                     │
│ ## Questions to Ask                 │
│                                     │
│ • Haven't checked in about the      │
│   family trip in a while            │
│                                     │
└─────────────────────────────────────┘
```

### API Endpoint

```
GET /v1/living-document/:user_id

Response:
{
  "document": {
    "id": "uuid",
    "user_id": "uuid",
    "content": "# Lucid's Notes\n\n...",
    "updated_at": "2026-01-03T10:00:00Z",
    "version": 5
  }
}
```

Note: No PUT endpoint for users. Lucid updates this via AT sessions.

---

## Part 3: State Check Tool

### What It Is

A **guided journey** for exploring dreams and goals. Lucid initiates and guides the user through phases, discovering what they want, understanding their reality, and finding viable paths forward.

This is more sophisticated than a simple chat - it's a phased exploration that helps users get from dream to actionable direction.

### The Journey (Phases)

```
┌─────────────────────────────────────────────────────────────┐
│  1. DREAM         "What are you reaching for?"              │
│        ↓                                                    │
│  2. REALITY       Lucid discovers context (who you         │
│                   are, constraints, dependencies)           │
│        ↓                                                    │
│  3. LITERAL PATH  "Here's what it would actually           │
│                   take" (sacrifice analysis)                │
│        ↓                                                    │
│  4. MITIGATION    If sacrifice too high, find the          │
│     (if needed)   *essence* - what do you really want?     │
│        ↓                                                    │
│  5. ALTERNATIVE   Modified paths that honor the spirit     │
│     PATHS         without destroying everything             │
└─────────────────────────────────────────────────────────────┘
```

**Example flow:**
- User: "I want to open a pizza shop in Rome"
- DREAM phase: Lucid explores the dream, what draws them to it
- REALITY phase: Lucid discovers they live in Alabama, work as a dentist, have dependent children
- LITERAL PATH: Lucid shows the real cost - uprooting family, abandoning career, financial risk
- MITIGATION: The sacrifice is high. Lucid asks - what's the *essence*? Is it craftsmanship? Italian culture? Sense of place?
- ALTERNATIVE PATHS: Lucid suggests modified dreams - annual Rome trips, making pizza at home, opening an Italian place locally

### Access Point

"..." menu → "State Check"

### UI Flow

**Step 1: Lucid Initiates**

User taps "State Check" and Lucid opens with a warm invitation:

```
┌─────────────────────────────────────┐
│ ←  State Check                      │
├─────────────────────────────────────┤
│                                     │
│  ┌─────────────────────────────────┐│
│  │ Lucid                           ││
│  │                                 ││
│  │ What are you dreaming about     ││
│  │ lately? I'd love to explore     ││
│  │ something you're reaching for.  ││
│  └─────────────────────────────────┘│
│                                     │
│  ┌─────────────────────────────────┐│
│  │ Type your response...           ││
│  └─────────────────────────────────┘│
│                                     │
└─────────────────────────────────────┘
```

**Step 2: Conversational Exploration**

Simple chat interface - Lucid guides naturally through phases:

```
┌─────────────────────────────────────┐
│ ←  State Check                  ⋮   │
├─────────────────────────────────────┤
│                                     │
│  ┌─────────────────────────────────┐│
│  │ You                             ││
│  │ I've been thinking about        ││
│  │ opening a pizza shop in Rome    ││
│  └─────────────────────────────────┘│
│                                     │
│  ┌─────────────────────────────────┐│
│  │ Lucid                           ││
│  │ That's a beautiful dream. Tell  ││
│  │ me more - what draws you to     ││
│  │ Rome specifically? And pizza?   ││
│  └─────────────────────────────────┘│
│                                     │
│  ┌─────────────────────────────────┐│
│  │ Type your response...           ││
│  └─────────────────────────────────┘│
│                                     │
└─────────────────────────────────────┘
```

**Step 3: Completion**

When the journey is complete, Lucid summarizes and it saves to Library automatically.

### Session Document (Backend)

The backend maintains a "mini living document" for each session:

```json
{
  "dream_stated": "Open a pizza shop in Rome",
  "reality_discovered": [
    "Lives in Alabama",
    "Works as dentist",
    "Has dependent children"
  ],
  "sacrifice_assessment": "Would require uprooting family, abandoning career, significant financial risk",
  "essence_identified": "Connection to Italian culture, craftsmanship, sense of place",
  "paths_explored": [
    {
      "path": "Full literal: Move to Rome",
      "tradeoffs": "High family sacrifice, career loss",
      "viability": "low"
    },
    {
      "path": "Annual Rome trips + pizza-making classes",
      "tradeoffs": "Limited immersion but preserves stability",
      "viability": "high"
    },
    {
      "path": "Open Italian restaurant locally",
      "tradeoffs": "Different dream but similar essence",
      "viability": "medium"
    }
  ],
  "chosen_direction": "Start with annual Rome trips and master pizza-making first",
  "insights": [
    "The dream is really about craftsmanship and Italian culture",
    "Family stability is a core value"
  ]
}
```

### Save to Library

Automatically saved when session completes. Entry includes full journey and summary.

Entry type: `state_check`

---

## Part 4: Possibilities Tool

### What It Is

A structured brainstorm to expand thinking when feeling stuck or narrowly focused.

### Access Point

"..." menu → "Possibilities"

### Flow

```
┌─────────────────────────────────────┐
│ ←  Possibilities                    │
├─────────────────────────────────────┤
│                                     │
│  What situation or challenge        │
│  would you like to explore          │
│  possibilities for?                 │
│                                     │
│  ┌─────────────────────────────────┐│
│  │                                 ││
│  │                                 ││
│  │                                 ││
│  └─────────────────────────────────┘│
│                                     │
│            [ Explore ]              │
│                                     │
└─────────────────────────────────────┘
```

Conversation flow similar to State Check but with different guidance.

### Possibilities Prompt (Backend)

```
You are Lucid, helping expand thinking and surface paths not being considered.

Your gift is seeing options they might not be seeing. Not prescribing - illuminating.

Listen to where their attention is. Then gently expand the frame:
- What other paths exist that they haven't mentioned?
- What connections across different parts of their life might be relevant?
- What would someone with a completely different perspective consider?
- What's the path they might be avoiding looking at?

Don't overwhelm with options. Surface 2-3 genuinely different directions.
Ask questions that open doors rather than giving answers.

At the end, summarize:
- The situation explored
- Paths surfaced (with brief pros/cons)
- Questions that opened up
- Any "ah-ha" moments from the conversation
```

### Save to Library

```
POST /v1/library/:user_id

{
  "title": "Possibilities: Career Crossroads",
  "content": "[Full conversation + summary]",
  "entry_type": "possibilities",
  "source": "possibilities_tool",
  "tags": ["exploration", "career"]
}
```

---

## Part 5: Updated "..." Menu

```
┌─────────────────────────────────────┐
│           More Options              │
├─────────────────────────────────────┤
│                                     │
│  📚  Library                        │
│      Your reflections & Lucid's     │
│      thinking                       │
│                                     │
│  ⚖️  Versus                         │
│      Lu & Cid debate a topic        │
│                                     │
│  🎯  State Check              NEW   │
│      Explore goals & decisions      │
│                                     │
│  🌐  Possibilities            NEW   │
│      Expand thinking, surface paths │
│                                     │
│  💭  Lucid's Notes            NEW   │
│      What Lucid is thinking about   │
│                                     │
│  ⚙️  Settings                       │
│                                     │
└─────────────────────────────────────┘
```

---

## API Endpoints Summary

### Living Document

```
GET /v1/living-document/:user_id
  → Returns Lucid's notes (read-only for client)

Response:
{
  "document": {
    "id": "uuid",
    "content": "# Lucid's Notes\n\n...",
    "updated_at": "2026-01-03T10:00:00Z",
    "version": 5
  }
}
```

### State Check Tool

```
POST /v1/state-check/start
  Body: { "user_id": "uuid" }
  → Lucid initiates, returns session and opening message

Response:
{
  "session_id": "uuid",
  "phase": "dream",
  "message": "What are you dreaming about lately?",
  "session_doc": { ... }
}

POST /v1/state-check/:sessionId/message
  Body: { "user_id": "uuid", "message": "..." }
  → Returns Lucid's response and updated state

Response:
{
  "message": "That's a beautiful dream...",
  "phase": "dream",
  "session_doc": { ... },
  "is_complete": false
}

GET /v1/state-check/user/:userId/active
  → Check if user has an active session

Response:
{
  "active": true,
  "session": { ... }
}

GET /v1/state-check/user/:userId/history
  → Get user's past State Check sessions

Response:
{
  "sessions": [
    {
      "session_id": "uuid",
      "dream": "Open a pizza shop in Rome",
      "chosen_direction": "Annual Rome trips first",
      "completed_at": "2026-01-03T10:00:00Z"
    }
  ]
}

POST /v1/state-check/:sessionId/abandon
  Body: { "user_id": "uuid" }
  → Abandon an active session without saving
```

### Possibilities Tool

```
(Coming soon - similar pattern to State Check)

POST /v1/possibilities/start
POST /v1/possibilities/:sessionId/message
GET /v1/possibilities/user/:userId/active
POST /v1/possibilities/:sessionId/abandon
```

---

## Data Models (iOS)

```swift
// Living Document
struct LivingDocument: Codable {
    let id: UUID
    let userId: UUID
    let content: String
    let updatedAt: Date
    let version: Int
}

// State Check Session
struct StateCheckSession: Codable {
    let sessionId: UUID
    let phase: StateCheckPhase
    let sessionDoc: StateCheckSessionDoc
    let status: SessionStatus
    let createdAt: Date
    let updatedAt: Date
    let completedAt: Date?
}

enum StateCheckPhase: String, Codable {
    case dream           // "What are you reaching for?"
    case reality         // Discovering context, constraints
    case literalPath     // "Here's what it would take"
    case mitigation      // Finding the essence
    case alternativePaths // Modified paths
    case complete        // Session finished
}

struct StateCheckSessionDoc: Codable {
    var dreamStated: String?
    var realityDiscovered: [String]
    var sacrificeAssessment: String?
    var essenceIdentified: String?
    var pathsExplored: [ExplorePath]
    var chosenDirection: String?
    var insights: [String]
}

struct ExplorePath: Codable {
    let path: String
    let tradeoffs: String
    let viability: PathViability
}

enum PathViability: String, Codable {
    case high
    case medium
    case low
}

// State Check Response (from message API)
struct StateCheckResponse: Codable {
    let message: String
    let phase: StateCheckPhase
    let sessionDoc: StateCheckSessionDoc
    let isComplete: Bool
}

enum SessionStatus: String, Codable {
    case active
    case completed
    case abandoned
}

// Generic Tool Session (for Versus, Possibilities)
struct ToolSession: Codable {
    let id: UUID
    let userId: UUID
    let toolType: ToolType
    let topic: String
    let messages: [ToolMessage]
    let status: SessionStatus
    let createdAt: Date
}

enum ToolType: String, Codable {
    case stateCheck = "state_check"
    case possibilities = "possibilities"
    case versus = "versus"
}

struct ToolMessage: Codable {
    let role: MessageRole
    let content: String
    let timestamp: Date
}
```

---

## Migration Notes

### For Existing Users

1. Mode documents will be migrated to Library as historical entries
2. Living Document starts fresh (Lucid begins with empty notes)
3. First Document Reflection AT will populate initial observations

### Timeline Suggestion

1. **Phase 1**: Add Living Document view (read-only)
2. **Phase 2**: Add State Check tool
3. **Phase 3**: Add Possibilities tool
4. **Phase 4**: Remove mode UI from chat

---

## Questions for iOS Team

1. Where should "Lucid's Notes" live - in "..." menu or Settings?
2. Should tools (State Check, Possibilities) feel like separate "apps" or inline expansions?
3. How to handle tool sessions that aren't saved - auto-save draft?
4. Should we show a visual indicator when Lucid updates his notes?

---

*This spec supersedes `IOS_MODE_DOCUMENTS_SPEC.md`. The mode-based system is being sunset in favor of this unified approach.*

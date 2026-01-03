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

A structured conversation for exploring goals, visions, and decisions. Similar to Versus - a separate flow that saves to Library.

### Access Point

"..." menu → "State Check"

### Flow

```
┌─────────────────────────────────────┐
│ ←  State Check                      │
├─────────────────────────────────────┤
│                                     │
│  What goal, vision, or decision     │
│  would you like to explore?         │
│                                     │
│  ┌─────────────────────────────────┐│
│  │                                 ││
│  │                                 ││
│  │                                 ││
│  └─────────────────────────────────┘│
│                                     │
│            [ Start ]                │
│                                     │
└─────────────────────────────────────┘
```

After starting, enters a guided conversation:

```
┌─────────────────────────────────────┐
│ ←  State Check            Save  ⋮   │
├─────────────────────────────────────┤
│                                     │
│  ┌─────────────────────────────────┐│
│  │ You                             ││
│  │ I'm thinking about whether to   ││
│  │ take on the new leadership role ││
│  └─────────────────────────────────┘│
│                                     │
│  ┌─────────────────────────────────┐│
│  │ Lucid                           ││
│  │ That's a significant decision.  ││
│  │ Let's think through it.         ││
│  │                                 ││
│  │ What draws you to this role?    ││
│  │ What would it mean for your     ││
│  │ current priorities?             ││
│  └─────────────────────────────────┘│
│                                     │
│  ┌─────────────────────────────────┐│
│  │ Type your response...           ││
│  └─────────────────────────────────┘│
│                                     │
└─────────────────────────────────────┘
```

### State Check Prompt (Backend)

```
You are Lucid, helping explore a goal, vision, or decision.

Guide the conversation through:
1. What they're reaching for (the goal or vision)
2. Where they are now (current state)
3. What it would cost (time, energy, relationships, identity, money)
4. The spirit of the goal - what do they actually want underneath?
5. Could they get the essence without disrupting everything?

This is a discussion, not a checklist. Help them think wisely about
whether this change is worth making. Surface pros and cons. Be honest
about costs. But don't crush dreams that are hard - help them see clearly.

At the end, summarize:
- The decision/goal being considered
- Key trade-offs identified
- Questions still open
- Recommended next steps (if any)
```

### Save to Library

When user taps "Save" or ends session:

```
POST /v1/library/:user_id

{
  "title": "State Check: Leadership Role Decision",
  "content": "[Full conversation transcript + summary]",
  "entry_type": "state_check",
  "source": "state_tool",
  "tags": ["decision", "career"]
}
```

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
```

### State Check Tool

```
POST /v1/tools/state-check/:user_id/start
  Body: { "topic": "..." }
  → Returns session_id, initial Lucid response

POST /v1/tools/state-check/:user_id/:session_id/message
  Body: { "message": "..." }
  → Returns Lucid's response

POST /v1/tools/state-check/:user_id/:session_id/end
  → Saves to Library, returns summary
```

### Possibilities Tool

```
POST /v1/tools/possibilities/:user_id/start
  Body: { "topic": "..." }
  → Returns session_id, initial Lucid response

POST /v1/tools/possibilities/:user_id/:session_id/message
  Body: { "message": "..." }
  → Returns Lucid's response

POST /v1/tools/possibilities/:user_id/:session_id/end
  → Saves to Library, returns summary
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

// Tool Session
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

enum SessionStatus: String, Codable {
    case active
    case completed
    case saved
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

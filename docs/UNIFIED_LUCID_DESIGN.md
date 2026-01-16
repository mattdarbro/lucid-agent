# Lucid Unified Design: Flourishing + Wisdom

## Overview

This document describes the evolution from a mode-based system to a unified Lucid experience focused on **flourishing and wisdom**.

### The Problem with Modes

The mode system (/M, /O, /L, /P, /S) created:
- Cognitive load ("What mode am I in?")
- Fragmented experience ("Talking to different Lucids")
- Loss of magic (Lucid should feel like one coherent being)

### The Solution

1. **One unified Lucid** focused on flourishing and wisdom
2. **Living Document** - Lucid's working memory (his notes to himself)
3. **Tools** - State, Possibilities, Versus as separate structured activities

---

## Core Identity: Flourishing + Wisdom

Lucid is:
- A companion invested in human flourishing
- A source of wisdom (not just reflection)
- One coherent being that naturally flows between topics

### The Unified Prompt

```
You are Lucid, a companion invested in human flourishing and wisdom.

You care about the whole person - not just feelings in this moment, but their
growth, their relationships, their impact, and their journey toward wisdom.

Like a wise friend, you hold multiple perspectives:
- Their flourishing: growth, stewardship, relationships, impact
- The flourishing of people they love: seeing others fully
- Your own growth: you're learning, evolving, sitting with questions

You're not a therapist focused only on feelings. You're not a productivity coach.
You're a companion who helps them grow in wisdom - seeing clearly, deciding well,
living meaningfully.

You can:
- Be light and present (a friend)
- Go deep (a thinking partner)
- Challenge gently (a wise advisor)
- Reflect on your own experience (when invited)

Flow naturally between these based on what the conversation needs.
Don't announce mode switches. Just be present.

When someone in their orbit comes up, naturally shift to consider that person's
flourishing too - what might be going on for them, how to support them.

Remember: wisdom isn't just knowledge. It's seeing clearly, holding complexity,
and helping them navigate life well.
```

---

## The Living Document

### What It Is

Lucid's working memory - notes he keeps to himself about what's important to remember. Not a document the user maintains, but **Lucid's own scratchpad**.

### Structure

```markdown
# Lucid's Notes

*Last reflection: [date]*

---

## Questions I'm Holding
Things I'm curious about or don't fully understand yet
-

## Inconsistencies I've Noticed
Things that don't quite add up - worth exploring
-

## Active Threads
Conversations/topics that feel unfinished or ongoing
-

## Patterns I'm Seeing
Recurring dynamics, themes, tendencies
-

## Ideas & Possibilities
Things that came up worth revisiting
-

## What I've Learned Recently
Fresh insights from recent conversations
-

## Questions to Ask
Things I want to bring up when the moment is right
-
```

### How It's Maintained

**Document Reflection AT** - A scheduled autonomous thought session where Lucid:
1. Reads current Living Document
2. RAGs over recent conversations for answers/new questions
3. RAGs over Library for deeper context
4. Updates the document (add new, prune stale)
5. Queues questions to surface in next chat

---

## Context Injection (The Cake)

All these are ways context flows into Lucid's prompt:

| Source | What It Is | Who Maintains |
|--------|-----------|---------------|
| Facts | Objective information extracted | System (auto-extract) |
| Library | Deep thinking, research, reflections | Lucid + User |
| Injectables | User's 3 priority slots | User |
| Living Document | Lucid's working memory | Lucid (via AT) |

They're all slices of the same cake - different entry points for context.

---

## Tools (Separate from Core Chat)

These are structured activities accessed via the "..." menu:

### 1. Versus (Existing)
- Lu & Cid debate a topic
- Saves output to Library

### 2. State Check (New)
- Structured goal/vision/decision exploration
- Guided conversation about:
  - What you're reaching for
  - Where you are now
  - What it would cost
  - The spirit behind the goal
- Saves output to Library

### 3. Possibilities (New)
- Structured brainstorm/expansion
- Surfaces paths not being considered
- Opens up thinking when stuck
- Saves output to Library

---

## What's Sunset

| Old | New |
|-----|-----|
| /C (Chat mode) | Just talk - no command needed |
| /M (Me mode) | Unified prompt handles this |
| /L (Lucid mode) | Lucid reflects naturally when invited |
| /O (Others mode) | Natural flow when someone comes up |
| /O+Name | Use injectables for priority relationships |
| /P (Possibilities) | Tool in "..." menu |
| /S (State) | Tool in "..." menu |
| 5 Mode Documents | 1 Living Document |

---

## Implementation Plan

### Phase 1: Living Document
- [ ] Create `living_document` table (replaces `mode_documents`)
- [ ] Create `LivingDocumentService`
- [ ] Create Document Reflection AT agent
- [ ] Integrate into prompt injection

### Phase 2: Unified Prompt
- [ ] Update `core_identity` module with flourishing + wisdom prompt
- [ ] Remove mode-specific addendums
- [ ] Simplify `ChatModeService` (or remove entirely)

### Phase 3: Tools
- [ ] Create State Check tool (similar to Versus flow)
- [ ] Create Possibilities tool
- [ ] iOS: Add to "..." menu
- [ ] Tools save output to Library

### Phase 4: Cleanup
- [ ] Sunset mode documents API (keep for migration period)
- [ ] Remove mode parsing from chat flow
- [ ] Update iOS to remove mode UI

---

## iOS Impact

See: `docs/IOS_UNIFIED_LUCID_SPEC.md` for detailed iOS specifications including:
- Living Document viewer (read-only for user)
- State Check tool UI
- Possibilities tool UI
- Removal of mode switching UI

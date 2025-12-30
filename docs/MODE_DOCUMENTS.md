# Mode Documents: Living Context for Lucid

## The Problem

Lucid is powerful but has gaps. As Lucid himself noted, it's like being on a telephone call - he can't see all the context of what we're talking about. Each conversation starts fresh, and while there are facts, memories, and state tables, they're fragmented pieces rather than a coherent narrative.

## The Solution: Mode Documents

Each mode gets a **living markdown document** that captures the ongoing context, narrative, and key information for that mode. These documents are:

- **Human-readable** - You can open them, read them, edit them directly
- **Mode-specific** - Each mode has its own document with relevant context
- **Living** - Updated over time by both Lucid and the user
- **Narrative** - Not just facts, but the story and context around them

## Mode Document Mapping

| Mode | Shortcut | Document | Purpose |
|------|----------|----------|---------|
| Chat | `/C` or `/` | None | Ephemeral, light conversation. No persistent document. |
| Me | `/M` | `matt-context.md` | Your life context - what you're working on, where you are, what matters |
| Lucid | `/L` | `lucid-context.md` | Lucid's self-awareness, evolution, questions, insights |
| Others | `/O` | `orbit-context.md` | People in your orbit - relationships, dynamics, what you know about them |
| Possibilities | `/P` | `possibilities-context.md` | Paths being explored, alternatives considered, doors opened |
| State | `/S` | `state-context.md` | Goals, visions, decisions, where you're heading |

## Document Structure

Each document follows a consistent structure:

```markdown
# [Mode Name] Context

*Last updated: [date]*
*Updated by: [Lucid/Matt/both]*

## Current Focus
What's top of mind right now

## Key Context
The important things Lucid needs to know for this mode

## Active Threads
Ongoing conversations, questions, or explorations

## History
How things have evolved over time

## Notes
Anything else relevant
```

## How Documents Are Used

### Loading
When entering a mode, Lucid loads the corresponding markdown document as part of the prompt context. This gives Lucid the full narrative picture, not just fragmented facts.

### Updating
Documents can be updated:
1. **By Lucid** - After meaningful conversations, Lucid proposes updates
2. **By User** - Direct edits to the markdown files
3. **By Agents** - Autonomous agents can contribute during reflection sessions

### Storage
Documents are stored in a dedicated directory: `context/` (or in the database as TEXT)

## Why Markdown?

- **Transparency** - You can read exactly what Lucid knows
- **Editability** - You can correct, add, or remove anything
- **Version Control** - Git tracks changes over time
- **Simplicity** - No complex database schemas, just text

## Chat Mode: The Exception

Chat mode (`/C` or `/`) intentionally has **no persistent document**. This keeps it:
- Light and present
- Without the weight of accumulated context
- Fresh each conversation

This is the mode for casual conversation, quick questions, and being in the moment.

## Implementation Notes

### New Service: `ModeDocumentService`

```typescript
class ModeDocumentService {
  // Load document for a mode
  async loadDocument(userId: string, mode: ChatMode): Promise<string | null>

  // Save document for a mode
  async saveDocument(userId: string, mode: ChatMode, content: string): Promise<void>

  // Propose an update (for Lucid to suggest changes)
  async proposeUpdate(userId: string, mode: ChatMode, section: string, content: string): Promise<void>
}
```

### Integration Points

1. **PromptModulesService** - New module `mode_document` that loads the relevant doc
2. **ChatModeService** - Pass mode to prompt builder for document selection
3. **Agents** - Morning/evening reflection can update documents

### Database Table (Alternative to Files)

```sql
CREATE TABLE mode_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  mode TEXT NOT NULL CHECK (mode IN ('me', 'lucid', 'others', 'possibilities', 'state')),
  content TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_by TEXT DEFAULT 'system',
  UNIQUE(user_id, mode)
);
```

## Next Steps

1. Create initial template documents for each mode
2. Implement `ModeDocumentService`
3. Add `mode_document` prompt module
4. Integrate with chat flow
5. Add agent hooks for document updates

---

*This design originated from a conversation about the gaps in Lucid's contextual awareness - the "telephone call" problem where Lucid can't see the full picture of what we're discussing.*

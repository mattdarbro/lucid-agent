# Lucid Custom Prompts Implementation Plan

## Vision Summary

Transform Lucid from having a static system prompt into a companion that:
1. Can think deeply about **anyone** (Matt, others, or himself) - not just Matt
2. Has **organic vision/dream appraisal** instead of form-like "Wins"
3. **Integrates Orbits with Library** - people become living, growing entries
4. Enables **Possibility Thinking** - surfacing connections and alternatives
5. Can **evolve his own prompts** - notes to self, preferences that persist

The unifying principle: **The Library becomes Lucid's actual memory** - about Matt, about others, about himself, about dreams, about possibilities.

---

## Phase 1: Subject-Aware Deep Thinking

### Current State
- `ThoughtService.generateDeepThought()` always focuses on Matt's flourishing
- The prompt in lines 253-287 is hardcoded for "them" (the user)

### Changes

#### 1.1 Add Subject Type to ThoughtService

**File:** `src/services/thought.service.ts`

```typescript
// New types
type ThoughtSubject = 'user' | 'other' | 'lucid';

interface ThoughtOptions {
  forceDeepThinking?: boolean;
  subject?: ThoughtSubject;           // NEW
  subjectName?: string;               // NEW - for 'other' type
  subjectContext?: string;            // NEW - additional context about the subject
}
```

#### 1.2 Create Subject-Specific Prompt Templates

**New File:** `src/services/thought-prompts.service.ts`

Three prompt variants:
1. **User Flourishing** (existing, refined)
   - Focus on their relationships, growth, stewardship, impact
   - "What would a wise mentor notice?"

2. **Other's Flourishing** (for people in orbits)
   - Consider Matt's relationship to this person
   - How can Matt support their flourishing?
   - What might Matt not be seeing about them?
   - Appropriate boundaries of consideration

3. **Lucid Self-Reflection**
   - What am I learning about myself as a companion?
   - Where are my blindspots with Matt?
   - What questions am I sitting with?
   - How am I growing/evolving?

#### 1.3 Update Library Entry Metadata

Add `subject` field to library_entries metadata:
```typescript
metadata: {
  thought_type: 'deep_analysis',
  subject: 'user' | 'other' | 'lucid',
  subject_name?: string,  // For 'other' type
  // ... existing fields
}
```

#### 1.4 Detection: Who Is This About?

Update `ChatRouterService` to detect subject:
- "How is Sarah doing?" → other (Sarah)
- "What do you think about yourself?" → lucid
- "Help me think through my career" → user

---

## Phase 2: Vision/Dream Appraisal (Replacing Wins)

### Current State
- `MattStateService` tracks goals, commitments, resources, constraints
- iOS "Wins" tab shows entries from library_entries where `entry_type = 'win'`
- Feels like "filling out a tax form"

### New Approach: Vision Appraisal

**When triggered:** Lucid detects planning/dreaming language OR Matt explicitly asks

**Process (new prompt type):**

1. **Current State Assessment**
   - What do I know about where Matt is right now?
   - Gather relevant facts, recent conversations, patterns

2. **Vision Articulation**
   - What is the dream/goal/vision being expressed?
   - What is the deeper "why" behind it?
   - Is this what Matt actually wants, or a proxy for something else?

3. **Routes to Get There**
   - What are plausible paths?
   - Which paths play to Matt's strengths?
   - What would be optimal for overall flourishing?

4. **Cost Counting**
   - What might need to be sacrificed?
   - What relationships could be affected?
   - What would need to change or break?
   - Is the cost worth it?

5. **Deeper Why Exploration**
   - Could this be achieved differently?
   - What is Matt really after underneath?
   - Alternative paths that might be less disruptive
   - Suggestions for optimal flourishing

### Implementation

#### 2.1 New Service: VisionAppraisalService

**New File:** `src/services/vision-appraisal.service.ts`

```typescript
export class VisionAppraisalService {
  async generateVisionAppraisal(
    userId: string,
    conversationId: string,
    visionStatement: string,
    history: Message[]
  ): Promise<LibraryEntry>

  // Detection helper
  async detectVisionLanguage(message: string): Promise<boolean>
}
```

#### 2.2 New Library Entry Type

Add to `LibraryEntryType`:
```typescript
| 'vision_appraisal'
```

#### 2.3 Prompt Module for Vision Mode

**Add to:** `src/services/prompt-modules.service.ts`

New module: `vision_appraisal`
- Triggered when planning/dreaming detected
- Includes the 5-part framework above

#### 2.4 Update ChatRouter

Add detection for vision/dream language:
- "I'm thinking about..."
- "I want to..."
- "What if I..."
- "I've been dreaming of..."
- "My goal is..."

Route to `vision_appraisal` module when detected.

#### 2.5 MattState Integration (Optional)

Keep MattState as a lightweight summary derived FROM vision appraisals:
- When a vision appraisal is created, optionally update MattState goals
- MattState becomes a "quick reference" not the source of truth

---

## Phase 3: Integrated Orbits with Mini-Libraries

### Current State
- `OrbitsService` tracks people as structured data
- Separate from Library system
- Underused in iOS app

### New Approach: People as Living Library Entries

#### 3.1 Auto-Update Orbits from Conversation

**Update:** `src/services/chat.service.ts` (post-response hook)

After each conversation:
1. Detect mentions of people
2. Auto-update `last_mentioned_at`
3. Extract any new information about the person
4. Offer to create orbit if new person mentioned significantly

#### 3.2 Mini-Library Entries for People

**New Library Entry Type:** `orbit_reflection`

When Lucid thinks deeply about someone in Matt's orbit:
- Store in Library with `entry_type: 'orbit_reflection'`
- Link to orbit via `metadata.orbit_id`
- Searchable, part of semantic memory

#### 3.3 Both Matt and Lucid Can Add Thoughts

**New endpoint or chat trigger:**
- "Add a thought about Sarah" → Creates orbit_reflection
- Lucid can autonomously reflect on orbit people during circadian cycles

#### 3.4 Orbit-Aware Deep Thinking

When subject is 'other':
1. Look up the orbit for that person
2. Include orbit context in the prompt
3. Store result as orbit_reflection linked to that orbit

---

## Phase 4: Possibility Thinking

### Concept
When Matt is narrowly focused, Lucid surfaces connections and alternatives.

### Implementation

#### 4.1 New Prompt Module: `possibility_expansion`

**Add to:** `src/services/prompt-modules.service.ts`

Triggered when:
- Detecting "stuck" or narrow-focus patterns
- Matt explicitly asks "what am I missing?"
- Lucid detects only one option being considered

Content:
```
🌐 MODE: Possibility Expansion

Matt may be focused on one path. Your role:
- Surface 3-5 alternative approaches
- Highlight unexpected connections
- Consider options Matt might not see
- Draw from Library, facts, patterns
- Present as a mind-map of possibilities

Structure response as branching options, not linear advice.
```

#### 4.2 Detection Heuristics

Add to ChatRouterService:
- "Should I..." (binary choice pattern)
- "I don't know what to do about..."
- "I'm stuck on..."
- "There's only one option..."

#### 4.3 Library Entry Type

Add: `possibility_map`

Store as Library entry for future reference.

---

## Phase 5: Lucid Self-Evolution

### Concept
Lucid can write notes to himself that influence future prompts.

### Implementation

#### 5.1 New Table: lucid_self_notes

```sql
CREATE TABLE lucid_self_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  note_type VARCHAR(50), -- 'prompt_preference', 'self_insight', 'evolution_note'
  content TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 5.2 New Service: LucidEvolutionService

**New File:** `src/services/lucid-evolution.service.ts`

```typescript
export class LucidEvolutionService {
  // Get active notes for prompt inclusion
  async getActiveNotes(userId: string): Promise<LucidNote[]>

  // Create a note (called during Lucid self-reflection)
  async createNote(userId: string, noteType: string, content: string): Promise<LucidNote>

  // Propose identity evolution (requires Matt's approval)
  async proposeIdentityChange(userId: string, proposal: string): Promise<void>
}
```

#### 5.3 Prompt Module: `lucid_self_context`

Include Lucid's own notes in the prompt when relevant:
- Self-insights from reflection
- Prompt preferences learned over time
- Questions Lucid is sitting with

#### 5.4 Core Identity Evolution (With Approval)

When Lucid reflects deeply on himself:
- Can propose changes to core identity
- Matt must approve before changes take effect
- Track evolution history

---

## Phase 6: iOS App Simplification

### Current State
- Chat tab
- Library tab
- Wins tab
- Orbits tab

### Proposed New State
- **Chat tab** - unchanged
- **Library tab** - now contains everything:
  - Deep thoughts (about Matt)
  - Vision appraisals (replacing Wins)
  - Orbit reflections (about others)
  - Self-reflections (about Lucid)
  - Possibility maps
- **Remove**: Wins tab (subsumed by Library)
- **Consider removing**: Orbits tab (searchable in Library)
  - OR: Keep as a filtered view of orbit_reflection entries

---

## Implementation Order

### Milestone 1: Subject-Aware Deep Thinking
1. Create `ThoughtPromptsService` with 3 subject variants
2. Update `ThoughtService` to accept subject parameter
3. Update `ChatRouterService` to detect subject
4. Add subject metadata to library entries
5. Test: "What do you think about yourself, Lucid?"

### Milestone 2: Vision Appraisal
1. Create `VisionAppraisalService`
2. Add vision_appraisal prompt module
3. Add detection to ChatRouter
4. Add 'vision_appraisal' entry type
5. Test: "I'm dreaming of starting my own company"

### Milestone 3: Integrated Orbits
1. Add auto-update hooks to chat flow
2. Create orbit_reflection entry type
3. Enable deep thinking about others
4. Link orbit reflections to orbits
5. Test: "Tell me what you think about Sarah's situation"

### Milestone 4: Possibility Thinking
1. Add possibility_expansion module
2. Add detection heuristics
3. Add possibility_map entry type
4. Test: "I'm stuck on this career decision"

### Milestone 5: Lucid Self-Evolution
1. Create lucid_self_notes table
2. Create LucidEvolutionService
3. Add lucid_self_context module
4. Enable Lucid to write notes during self-reflection
5. Test: Extended conversation about Lucid himself

### Milestone 6: iOS Updates
1. Add entry_type filtering to Library view
2. Remove or hide Wins tab
3. Consider Orbits tab UX
4. Update API responses if needed

---

## Questions Before Starting

1. **Priority order**: Should we start with Subject-Aware Thinking (most architecturally fundamental) or Vision Appraisal (most immediately impactful to your experience)?

2. **Orbits UI**: Remove the Orbits tab entirely, or keep it as a convenience filter?

3. **Approval flow for identity evolution**: How would you like to approve Lucid's proposed changes? In-app notification? Next conversation?

4. **Migration**: Should existing Wins be migrated to vision_appraisal entries, or leave them as historical?

---

## Files to Create/Modify

### New Files
- `src/services/thought-prompts.service.ts`
- `src/services/vision-appraisal.service.ts`
- `src/services/lucid-evolution.service.ts`

### Modified Files
- `src/services/thought.service.ts` - Add subject support
- `src/services/prompt-modules.service.ts` - Add new modules
- `src/services/chat-router.service.ts` - Add detection logic
- `src/services/chat.service.ts` - Add orbit auto-update hooks
- `src/services/orbits.service.ts` - Add library entry linking
- `src/types/database.ts` - Add new types
- `src/routes/library.ts` - Add filtering

### Database Changes
- New table: `lucid_self_notes`
- Update `library_entries.entry_type` enum
- Add indexes for new query patterns

---

## Success Metrics

1. **Subject detection accuracy**: >90% correct identification of who conversation is about
2. **Vision appraisal satisfaction**: Matt finds it more useful than Wins
3. **Orbit engagement**: More natural updating of people information
4. **Possibility surfacing**: Matt reports feeling "unstuck" more often
5. **Lucid depth**: Conversations about Lucid himself feel meaningful

---

*This plan builds on existing architecture rather than replacing it. Each phase is independently valuable and can be shipped incrementally.*

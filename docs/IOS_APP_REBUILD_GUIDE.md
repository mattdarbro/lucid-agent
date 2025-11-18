# iOS App Rebuild Guide
## Conversational Insight System Integration

Last Updated: 2025-11-18

---

## Overview

This guide provides the architecture and API specifications for rebuilding the Lucid iOS app with the new **conversational insight system**. Instead of form-based check-ins, tasks now use **conversations** where users can chat with Lucid about their progress, and AI-generated **insights** can be discussed and refined.

## Core Concepts

### Three Types of Conversations

1. **General Chat** - Normal conversations with Lucid (existing functionality)
2. **Check-In Conversations** - Task-related discussions at different times of day
3. **Insight Review Conversations** - Discussing and refining AI-generated patterns

### The Flow

```
User creates task
    ↓
Task gets a primary conversation
    ↓
User opens task → Opens conversation → Chats (check-in)
    ↓
After 2-3 check-ins, Lucid generates insights
    ↓
User taps insight → Opens insight discussion → Refines interpretation
    ↓
All conversations feed back into Lucid's understanding (Big 5, facts, receptivity)
```

---

## Database Schema Changes

### Tasks Now Have Conversations

```sql
multi_day_research_tasks:
  - primary_conversation_id (NEW) - UUID of main conversation for this task
  - ... existing fields ...
```

### New Tables

#### `task_insights` - AI-Generated Patterns
```sql
{
  id: UUID,
  task_id: UUID,
  user_id: UUID,
  insight_text: "Pattern detected: Sunday energy (1.5/5) is 2.0 points lower than Monday (3.5/5)",
  confidence: 0.85,
  pattern_type: "temporal_mood" | "language_change" | "energy_correlation",
  supporting_evidence: { /* check-in IDs, stats */ },
  user_validated: null | true | false,
  user_refinement: "That's not anxiety, it's fatigue",
  status: "proposed" | "confirmed" | "rejected" | "refined"
}
```

#### `insight_interactions` - How Users Engage
```sql
{
  id: UUID,
  insight_id: UUID,
  user_id: UUID,
  reviewed_at: TIMESTAMP,
  time_of_day: "morning" | "afternoon" | "evening" | "late_night",
  action: "accepted" | "rejected" | "refined",
  refinement_text: "I think that's fatigue, not anxiety",
  energy_level: 1-5,
  mood: 1-5
}
```

#### `insight_receptivity_patterns` - Learning Preferences
```sql
{
  user_id: UUID,
  preferred_review_time: "morning", // When they engage with insights
  overall_acceptance_rate: 0.4,
  acceptance_by_time_of_day: { morning: 0.4, evening: 0.7 },
  challenge_rate: 0.8,
  requires_data: true, // Want numbers, not feelings
  successful_phrasing_patterns: [...],
  rejected_phrasing_patterns: [...]
}
```

---

## API Endpoints

### Task Management

#### Create Task (Updated)
```typescript
POST /v1/multi-day-tasks
{
  "user_id": "uuid",
  "title": "Going to work in the dental office",
  "description": "Optional description",
  "topic_category": "work",
  "check_in_times": ["morning", "evening"],
  "duration_days": 5
}

Response:
{
  "id": "task-uuid",
  "user_id": "uuid",
  "title": "...",
  "conversation_id": "conv-uuid", // ← NEW! Primary conversation for check-ins
  "primary_conversation_id": "conv-uuid",
  "status": "active",
  ...
}
```

#### Get Task
```typescript
GET /v1/multi-day-tasks/{task_id}

Response:
{
  "id": "task-uuid",
  "conversation_id": "conv-uuid", // Use this for check-in chats
  "primary_conversation_id": "conv-uuid",
  "title": "Going to work...",
  "check_ins": [...],
  ...
}
```

### Check-Ins (Now Conversations!)

Instead of posting a form, users **chat in the task's conversation**:

```typescript
// Open the task's conversation
GET /v1/conversations/{conversation_id}/messages

// User sends a message (check-in)
POST /v1/chat
{
  "conversation_id": "{conversation_id}", // Task's conversation
  "message": "Not looking forward to work this week...",
  "user_id": "uuid"
}

// Lucid responds with context of the task and previous check-ins
Response:
{
  "response": "That sounds heavy. What specifically about this week feels harder? Last time you mentioned feeling 'overwhelmed' on Sunday evenings...",
  "conversation_id": "uuid",
  "message_id": "uuid"
}
```

**Key Points:**
- Each task has a `conversation_id` for check-ins
- Check-ins happen via normal chat API
- Lucid has context of all previous check-ins (messages in that conversation)
- The conversation IS the check-in history

### Insight Generation

#### Trigger Insight Generation
```typescript
POST /v1/tasks/{task_id}/insights/generate

// Lucid analyzes check-ins and generates insights
Response:
{
  "insights": [
    {
      "id": "insight-uuid",
      "task_id": "task-uuid",
      "insight_text": "Pattern detected: Sunday 11 PM energy (1.5/5) is 2.0 points lower than Monday 8 AM (3.5/5). Based on 2 Sunday check-ins and 1 Monday check-in.",
      "confidence": 0.85,
      "pattern_type": "temporal_mood",
      "status": "proposed",
      "created_at": "2025-11-17T..."
    }
  ],
  "count": 1
}
```

#### Get Insights for Task
```typescript
GET /v1/tasks/{task_id}/insights

Response:
{
  "insights": [...],
  "count": 3
}
```

#### Get Pending Insights (Needs Review)
```typescript
GET /v1/users/{user_id}/insights/pending

Response:
{
  "insights": [
    {
      "id": "uuid",
      "task_title": "Going to work...",
      "insight_text": "...",
      "confidence": 0.85,
      "hours_pending": 12
    }
  ]
}
```

### Insight Validation

#### Quick Validate (Accept/Reject)
```typescript
POST /v1/insights/{insight_id}/validate
{
  "action": "accepted" | "rejected" | "refined",
  "refinement_text": "That's fatigue, not anxiety", // If action = refined
  "time_of_day": "morning", // When user reviewed it
  "energy_level": 4, // Optional
  "mood": 3 // Optional
}

Response:
{
  "insight": {
    "id": "uuid",
    "status": "confirmed", // or "rejected", "refined"
    "user_validated": true,
    "user_refinement": "That's fatigue, not anxiety"
  },
  "message": "Insight accepted"
}
```

#### Start Discussion About Insight
```typescript
POST /v1/insights/{insight_id}/start-discussion

// Creates a new conversation for discussing this insight
Response:
{
  "conversation": {
    "id": "conv-uuid", // Use this to chat about the insight
    "title": "Discussing insight",
    "conversation_context": "insight_review",
    "related_insight_id": "insight-uuid"
  },
  "insight": {...}
}

// Then user can chat about it:
POST /v1/chat
{
  "conversation_id": "conv-uuid",
  "message": "I don't think that's anxiety, I think it's fatigue"
}

// Lucid responds:
{
  "response": "That's a useful distinction. So the Sunday feeling is more fatigue than anxiety? That changes the interpretation - maybe the issue is rest, not dread."
}
```

---

## iOS App Architecture

### Recommended Structure

```
LucidApp/
├── Models/
│   ├── Task.swift
│   ├── Insight.swift
│   ├── Conversation.swift
│   └── Message.swift
├── ViewModels/
│   ├── TaskListViewModel.swift
│   ├── TaskDetailViewModel.swift (contains ChatViewModel)
│   ├── InsightListViewModel.swift
│   └── InsightReviewViewModel.swift
├── Views/
│   ├── Tasks/
│   │   ├── TaskListView.swift
│   │   ├── TaskDetailView.swift (shows conversation)
│   │   ├── CreateTaskView.swift
│   │   └── TaskHeaderView.swift
│   ├── Insights/
│   │   ├── InsightListView.swift
│   │   ├── InsightCardView.swift
│   │   └── InsightDiscussionView.swift (shows conversation)
│   ├── Chat/
│   │   ├── ChatView.swift (reusable for task & insight chats)
│   │   ├── MessageBubble.swift
│   │   └── ChatInputView.swift
│   └── Home/
│       └── HomeView.swift
└── Services/
    ├── APIClient.swift
    ├── TaskService.swift
    ├── InsightService.swift
    └── ConversationService.swift
```

### Key Views

#### TaskDetailView
```swift
struct TaskDetailView: View {
    let task: Task
    @StateObject var viewModel: TaskDetailViewModel

    var body: some View {
        VStack {
            // Task header with metadata
            TaskHeaderView(task: task)

            // The conversation (all check-ins)
            ScrollView {
                ForEach(viewModel.messages) { message in
                    MessageBubble(message: message)
                }
            }

            // Input for new check-in
            ChatInputView(onSend: viewModel.sendMessage)
        }
        .navigationTitle(task.title)
        .toolbar {
            ToolbarItem {
                Button("Insights") {
                    // Show insights for this task
                }
            }
        }
        .onAppear {
            viewModel.loadConversation(task.conversationId)
        }
    }
}
```

#### InsightListView
```swift
struct InsightListView: View {
    @StateObject var viewModel: InsightListViewModel

    var body: some View {
        List {
            Section("Pending Review") {
                ForEach(viewModel.pendingInsights) { insight in
                    InsightCardView(insight: insight)
                        .onTapGesture {
                            // Start discussion or quick validate
                            showInsightActions(insight)
                        }
                }
            }

            Section("Confirmed") {
                ForEach(viewModel.confirmedInsights) { insight in
                    InsightCardView(insight: insight)
                }
            }
        }
    }
}
```

#### InsightCardView
```swift
struct InsightCardView: View {
    let insight: Insight

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: patternIcon(insight.patternType))
                Text(insight.insightText)
                    .font(.body)
                Spacer()
                confidenceBadge(insight.confidence)
            }

            HStack {
                statusBadge(insight.status)
                Spacer()
                Text(insight.createdAt, style: .relative)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
    }

    func patternIcon(_ type: String) -> String {
        switch type {
        case "temporal_mood": return "clock.fill"
        case "language_change": return "text.bubble.fill"
        case "energy_correlation": return "bolt.fill"
        default: return "lightbulb.fill"
        }
    }
}
```

### Data Models

```swift
struct Task: Identifiable, Codable {
    let id: String
    let userId: String
    let title: String
    let description: String?
    let topicCategory: String?
    let status: String // "active", "paused", "completed"
    let conversationId: String // NEW! For check-in chats
    let primaryConversationId: String
    let createdAt: Date
    let metadata: TaskMetadata?

    struct TaskMetadata: Codable {
        let durationDays: Int
        let checkInTimes: [String] // ["morning", "evening"]
    }
}

struct Insight: Identifiable, Codable {
    let id: String
    let taskId: String
    let userId: String
    let insightText: String
    let confidence: Double // 0.0-1.0
    let patternType: String
    let supportingEvidence: [String: Any]?
    let userValidated: Bool?
    let userRefinement: String?
    let status: String // "proposed", "confirmed", "rejected", "refined"
    let createdAt: Date
    let reviewedAt: Date?
}

struct Conversation: Identifiable, Codable {
    let id: String
    let userId: String
    let title: String?
    let conversationContext: String? // "general", "task_check_in", "insight_review"
    let relatedTaskId: String?
    let relatedInsightId: String?
    let createdAt: Date
}
```

---

## User Experience Flows

### Flow 1: Creating a Task and First Check-In

```
1. User taps "New Task"
   ↓
2. Fills out form (title, category, duration)
   ↓
3. POST /v1/multi-day-tasks
   ← Response includes conversation_id
   ↓
4. Navigate to TaskDetailView
   ↓
5. User sees empty conversation
   ↓
6. User types: "Not looking forward to work this week"
   ↓
7. POST /v1/chat with conversation_id
   ↓
8. Lucid responds with follow-up questions
   ↓
9. Conversation continues (this IS the check-in)
```

### Flow 2: Insight Notification and Quick Validation

```
1. User opens app, sees badge on "Insights" tab
   ↓
2. Navigates to InsightListView
   ↓
3. Sees: "Pattern detected: Sunday energy lower..."
   ↓
4. Taps insight card
   ↓
5. Action sheet appears:
   - "I agree" → POST /validate {action: "accepted"}
   - "I disagree" → POST /validate {action: "rejected"}
   - "Discuss with Lucid" → POST /start-discussion → Navigate to chat
   ↓
6. If "Discuss", opens InsightDiscussionView
   ↓
7. User chats: "That's fatigue, not anxiety"
   ↓
8. Lucid refines understanding
   ↓
9. When satisfied, POST /validate {action: "refined", refinement_text: "..."}
```

### Flow 3: Viewing Task with Insights

```
TaskDetailView:
┌─────────────────────────────────┐
│ 📋 Going to work                │
│ Active • 5 days • 3 check-ins   │
├─────────────────────────────────┤
│ 💡 2 Insights [View All]        │
│ ┌─────────────────────────────┐ │
│ │ ⚠️ Sunday fatigue pattern   │ │
│ │ ✅ Energy-focus correlation │ │
│ └─────────────────────────────┘ │
├─────────────────────────────────┤
│ Chat History (Check-ins):      │
│                                 │
│ [You - Sunday 11 PM]            │
│ Not looking forward to work...  │
│                                 │
│ [Lucid]                         │
│ That sounds heavy. What         │
│ specifically feels harder?      │
│                                 │
│ [You]                           │
│ Facing the unknown...           │
│                                 │
│ [Input field with send button]  │
└─────────────────────────────────┘
```

---

## Implementation Checklist

### Phase 1: Core Task-Conversation Integration
- [ ] Update `Task` model to include `conversationId`
- [ ] Modify task creation to handle returned `conversation_id`
- [ ] Refactor `TaskDetailView` to show conversation instead of form
- [ ] Reuse existing `ChatView` for task conversations
- [ ] Test: Create task → open → chat → see messages persist

### Phase 2: Insight Generation
- [ ] Create `Insight` model
- [ ] Create `InsightService` for API calls
- [ ] Build `InsightListView` to show pending insights
- [ ] Add "Generate Insights" button to task detail
- [ ] Test: After 3 check-ins, generate insights, see patterns

### Phase 3: Insight Validation
- [ ] Add quick validate action sheet (accept/reject/discuss)
- [ ] Implement POST /validate endpoint calls
- [ ] Track time of day when reviewing insights
- [ ] Test: Accept insight → see status change to "confirmed"

### Phase 4: Insight Discussions
- [ ] Implement "Start Discussion" flow
- [ ] Create `InsightDiscussionView` (reuses ChatView)
- [ ] Show insight context at top of discussion
- [ ] After discussion, allow user to validate
- [ ] Test: Discuss insight → refine interpretation → validate

### Phase 5: Temporal Tracking
- [ ] Track and send `time_of_day` with all API calls
- [ ] Track `energy_level` and `mood` when validating insights
- [ ] Add subtle UI showing what time of day pattern was detected
- [ ] Test: Morning review vs. evening review behavior

### Phase 6: Polish
- [ ] Add insight badges/icons for different pattern types
- [ ] Add confidence indicators (visual)
- [ ] Add "Supporting Evidence" expandable section
- [ ] Add pull-to-refresh for pending insights
- [ ] Add push notifications for new insights (future)

---

## API Call Examples

### Complete Flow in Swift

```swift
class TaskService {
    let apiClient = APIClient()

    // 1. Create task
    func createTask(title: String, userId: String) async throws -> Task {
        let body = [
            "user_id": userId,
            "title": title,
            "check_in_times": ["morning", "evening"],
            "duration_days": 5
        ]

        let task: Task = try await apiClient.post("/v1/multi-day-tasks", body: body)
        return task
    }

    // 2. Chat in task (check-in)
    func sendCheckIn(conversationId: String, message: String, userId: String) async throws -> ChatResponse {
        let body = [
            "conversation_id": conversationId,
            "message": message,
            "user_id": userId
        ]

        let response: ChatResponse = try await apiClient.post("/v1/chat", body: body)
        return response
    }

    // 3. Generate insights
    func generateInsights(taskId: String) async throws -> [Insight] {
        let response: InsightsResponse = try await apiClient.post("/v1/tasks/\(taskId)/insights/generate")
        return response.insights
    }

    // 4. Validate insight
    func validateInsight(insightId: String, action: String, refinement: String? = nil) async throws -> Insight {
        let timeOfDay = getCurrentTimeOfDay() // "morning", "afternoon", etc.

        var body: [String: Any] = [
            "action": action,
            "time_of_day": timeOfDay
        ]

        if let refinement = refinement {
            body["refinement_text"] = refinement
        }

        let response: ValidateResponse = try await apiClient.post("/v1/insights/\(insightId)/validate", body: body)
        return response.insight
    }

    // 5. Start insight discussion
    func startInsightDiscussion(insightId: String) async throws -> Conversation {
        let response: DiscussionResponse = try await apiClient.post("/v1/insights/\(insightId)/start-discussion")
        return response.conversation
    }
}
```

---

## Testing Strategy

### Manual Testing Scenarios

1. **Basic Check-In Flow**
   - Create task "Test Task"
   - Open task detail → see empty conversation
   - Send message: "Feeling good today"
   - Verify Lucid responds with context
   - Send 2 more messages
   - Verify all messages persist

2. **Insight Generation**
   - Create task with varied check-ins (different times, different moods)
   - After 3 check-ins with different energy levels, trigger insight generation
   - Verify insights appear with correct pattern detection
   - Check that supporting evidence references correct check-ins

3. **Insight Validation - Accept**
   - Get pending insight
   - Tap insight → "I agree"
   - Verify status changes to "confirmed"
   - Verify insight moves to "Confirmed" section

4. **Insight Validation - Discuss**
   - Get pending insight
   - Tap insight → "Discuss with Lucid"
   - Chat: "I think that's fatigue, not anxiety"
   - Verify Lucid responds intelligently
   - Validate as "refined" with refinement text
   - Verify insight shows user's refinement

5. **Temporal Patterns**
   - Do check-ins at different real times of day
   - Generate insights
   - Review insights at morning vs. evening
   - Verify system learns preferred review time

---

## Migration Notes

### From Old App to New App

**What Changes:**
- ❌ No more check-in forms
- ✅ Check-ins are conversations
- ✅ Tasks automatically get conversations
- ✅ Insights are generated and discussable

**Data Migration:**
- Old check-ins stored in JSONB `check_ins` field remain accessible
- New check-ins are messages in task conversation
- No data loss - both coexist

**Backward Compatibility:**
- Old tasks without `conversation_id` will work (just won't have conversational check-ins)
- Can run migration to create conversations for existing tasks if needed

---

## Troubleshooting

### Common Issues

1. **Task created but no conversation_id**
   - Check migration 009 ran successfully
   - Verify `primary_conversation_id` column exists
   - Check backend logs for transaction errors

2. **Insights not generating**
   - Need at least 2 check-ins with energy/mood data
   - Check that check-ins have variation (different times, different scores)
   - Call `/generate` endpoint manually to trigger

3. **Chat not showing task context**
   - Verify you're using the task's `conversation_id`
   - Check that conversation's `related_task_id` is set
   - Backend should include task context in system prompt (feature pending)

4. **Insight validation not updating receptivity**
   - Ensure `time_of_day` is passed in validate call
   - Check `insight_receptivity_patterns` table exists
   - Verify user_id matches between insight and validation

---

## Future Enhancements

### Planned Features

1. **System Prompt with Task Context** (Not yet implemented)
   - Chat endpoint detects if conversation is task-related
   - Includes task title, previous check-ins in system prompt
   - Lucid knows it's doing a check-in, not general chat

2. **Automatic Insight Generation** (Not yet implemented)
   - Trigger after every 2-3 new check-ins automatically
   - Don't require manual "Generate Insights" button
   - Background job or webhook

3. **Push Notifications** (Not yet implemented)
   - Notify when new insight ready for review
   - Deliver at user's preferred review time (based on learned pattern)
   - "Lucid noticed a pattern in your 'Work' task"

4. **Insight Confidence Visualization**
   - Show confidence meter (0-100%)
   - Explain what contributes to confidence
   - "Based on 5 check-ins across 3 days"

5. **Multi-Modal Insight Evidence**
   - Show which specific messages support the insight
   - Highlight relevant quotes from check-ins
   - Timeline view of pattern emergence

---

## Summary

### Key Takeaways

1. **Check-ins are conversations** - Users chat with Lucid instead of filling forms
2. **Every task gets a conversation** - Automatically created, accessible via `conversation_id`
3. **Insights are discussable** - Not just accepted/rejected, but refined through dialogue
4. **All conversations teach Lucid** - General chat, check-ins, and insight reviews all contribute to personality model and fact extraction
5. **Temporal awareness** - System tracks when users engage and adapts framing accordingly

### Ready to Build?

1. Run migration: `009_conversational_insight_system.sql`
2. Update backend (already done)
3. Follow iOS implementation checklist above
4. Test each flow thoroughly
5. Deploy and iterate based on user feedback

---

**Questions?** Check the backend code in:
- `/src/services/insight-generation.service.ts`
- `/src/routes/task-insights.ts`
- `/src/services/multi-day-task.service.ts`

**Need help?** The backend is ready - focus on the iOS UI/UX to make this conversational experience shine!

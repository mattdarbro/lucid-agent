# iOS Capture Tab Implementation Guide

**Guide for implementing the Capture system on iOS**

---

## Overview

The Capture tab is the primary quick-input mechanism for Lucid's second brain system. Users can quickly capture thoughts, tasks, facts, and information about people - the AI classifies and routes them automatically.

### Key Features
- **Single text input** - No categorization needed by user
- **AI-powered classification** - Routes to ACTION, IDEA, FACT, or PERSON
- **Actions list** - View and manage open tasks/reminders
- **Morning Briefing** - Daily summary shown in the tab

---

## API Endpoints

### Capture System

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/capture` | POST | Main capture - AI classifies and routes |
| `/v1/capture/force` | POST | Force route after clarification |
| `/v1/capture/classify` | POST | Preview classification only |

### Actions System

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/actions/:user_id` | GET | List actions (with filters) |
| `/v1/actions/:user_id/open` | GET | Get open actions only |
| `/v1/actions/:user_id/counts` | GET | Get counts by status |
| `/v1/actions/:user_id` | POST | Create action manually |
| `/v1/actions/:user_id/action/:id/done` | PATCH | Mark as done |
| `/v1/actions/:user_id/action/:id/cancel` | PATCH | Cancel action |
| `/v1/actions/:user_id/action/:id/reopen` | PATCH | Reopen action |

### Briefings

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/sync/morning-briefing` | POST | Trigger morning briefing |
| `/v1/library?user_id=X&entry_type=briefing` | GET | Get recent briefings |

---

## Data Models

### Swift Models

```swift
// MARK: - Capture Models

enum CaptureCategory: String, Codable {
    case ACTION
    case IDEA
    case FACT
    case PERSON
}

struct CaptureResponse: Codable {
    let routed_to: String // "action", "idea", "fact", "person", "clarification"
    let summary: String
    let confidence: Double
    let record_id: String?
    let needs_clarification: Bool?
    let clarification_message: String?
}

struct CaptureClassification: Codable {
    let category: CaptureCategory
    let summary: String
    let person_name: String?
    let confidence: Double
}

// MARK: - Action Models

enum ActionStatus: String, Codable {
    case open
    case done
    case cancelled
}

enum ActionSource: String, Codable {
    case capture
    case conversation
    case briefing
}

struct Action: Identifiable, Codable {
    let id: UUID
    let user_id: UUID
    let content: String
    let summary: String?
    let status: ActionStatus
    let person_id: UUID?
    let source: ActionSource
    let created_at: Date
    let completed_at: Date?
    let updated_at: Date

    var displayText: String {
        summary ?? content
    }
}

struct ActionCounts: Codable {
    let open: Int
    let done: Int
    let cancelled: Int
    let total: Int
}

struct ActionsResponse: Codable {
    let actions: [Action]
    let count: Int
    let totals: ActionCounts
}

// MARK: - Briefing Models

struct LibraryEntry: Identifiable, Codable {
    let id: UUID
    let user_id: UUID
    let entry_type: String
    let title: String?
    let content: String
    let time_of_day: String?
    let created_at: Date
}

struct BriefingsResponse: Codable {
    let entries: [LibraryEntry]
    let count: Int
}
```

---

## Store Extension

Add to your `LucidStore`:

```swift
extension LucidStore {
    // MARK: - Capture

    @Published var openActions: [Action] = []
    @Published var actionCounts: ActionCounts?
    @Published var latestBriefing: LibraryEntry?
    @Published var isCaptureLoading = false
    @Published var lastCaptureResult: CaptureResponse?

    /// Submit a capture - AI classifies and routes automatically
    func capture(_ content: String) async throws -> CaptureResponse {
        isCaptureLoading = true
        defer { isCaptureLoading = false }

        let payload: [String: Any] = [
            "user_id": userId.uuidString,
            "content": content
        ]

        let result: CaptureResponse = try await apiClient.post("/v1/capture", body: payload)
        lastCaptureResult = result

        // Refresh actions if it was routed there
        if result.routed_to == "action" {
            try await loadOpenActions()
        }

        return result
    }

    /// Force route after clarification
    func forceCapture(_ content: String, category: CaptureCategory) async throws -> CaptureResponse {
        let payload: [String: Any] = [
            "user_id": userId.uuidString,
            "content": content,
            "category": category.rawValue
        ]

        let result: CaptureResponse = try await apiClient.post("/v1/capture/force", body: payload)

        if result.routed_to == "action" {
            try await loadOpenActions()
        }

        return result
    }

    /// Preview classification without storing
    func previewClassification(_ content: String) async throws -> CaptureClassification {
        let payload: [String: Any] = ["content": content]
        return try await apiClient.post("/v1/capture/classify", body: payload)
    }

    // MARK: - Actions

    func loadOpenActions() async throws {
        let response: ActionsResponse = try await apiClient.get(
            "/v1/actions/\(userId)/open"
        )
        openActions = response.actions
    }

    func loadActionCounts() async throws {
        actionCounts = try await apiClient.get("/v1/actions/\(userId)/counts")
    }

    func markActionDone(_ actionId: UUID) async throws {
        let _: Action = try await apiClient.patch(
            "/v1/actions/\(userId)/action/\(actionId)/done",
            body: [:]
        )
        // Update local state
        if let index = openActions.firstIndex(where: { $0.id == actionId }) {
            openActions.remove(at: index)
        }
        try await loadActionCounts()
    }

    func cancelAction(_ actionId: UUID) async throws {
        let _: Action = try await apiClient.patch(
            "/v1/actions/\(userId)/action/\(actionId)/cancel",
            body: [:]
        )
        if let index = openActions.firstIndex(where: { $0.id == actionId }) {
            openActions.remove(at: index)
        }
        try await loadActionCounts()
    }

    func reopenAction(_ actionId: UUID) async throws {
        let action: Action = try await apiClient.patch(
            "/v1/actions/\(userId)/action/\(actionId)/reopen",
            body: [:]
        )
        openActions.insert(action, at: 0)
        try await loadActionCounts()
    }

    // MARK: - Briefings

    func loadLatestBriefing() async throws {
        let response: BriefingsResponse = try await apiClient.get(
            "/v1/library?user_id=\(userId)&entry_type=briefing&limit=1"
        )
        latestBriefing = response.entries.first
    }

    func triggerMorningBriefing() async throws -> LibraryEntry? {
        struct BriefingResponse: Codable {
            let success: Bool
            let library_entry_id: UUID?
            let title: String?
        }

        let result: BriefingResponse = try await apiClient.post(
            "/v1/sync/morning-briefing",
            body: ["user_id": userId.uuidString]
        )

        if result.success {
            try await loadLatestBriefing()
        }

        return latestBriefing
    }
}
```

---

## Capture Tab UI

### Main Capture Tab View

```swift
struct CaptureTabView: View {
    @EnvironmentObject var store: LucidStore
    @State private var captureText = ""
    @State private var showClarification = false
    @State private var pendingContent = ""
    @State private var showSuccess = false
    @State private var successMessage = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    // Morning Briefing Card (if available)
                    if let briefing = store.latestBriefing,
                       isTodaysBriefing(briefing) {
                        BriefingCard(briefing: briefing)
                    }

                    // Quick Capture Input
                    CaptureInputSection(
                        text: $captureText,
                        isLoading: store.isCaptureLoading,
                        onSubmit: submitCapture
                    )

                    // Open Actions List
                    if !store.openActions.isEmpty {
                        OpenActionsSection(actions: store.openActions)
                    }

                    // Action Counts Summary
                    if let counts = store.actionCounts {
                        ActionCountsSummary(counts: counts)
                    }
                }
                .padding()
            }
            .navigationTitle("Capture")
            .refreshable {
                await refreshAll()
            }
            .task {
                await refreshAll()
            }
            .sheet(isPresented: $showClarification) {
                ClarificationSheet(
                    content: pendingContent,
                    onSelect: handleClarification
                )
            }
            .overlay {
                if showSuccess {
                    SuccessToast(message: successMessage)
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
        }
    }

    private func submitCapture() {
        guard !captureText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }

        let content = captureText
        captureText = ""

        Task {
            do {
                let result = try await store.capture(content)

                if result.needs_clarification == true {
                    pendingContent = content
                    showClarification = true
                } else {
                    showSuccessMessage(for: result)
                }
            } catch {
                // Handle error
                print("Capture failed: \(error)")
            }
        }
    }

    private func handleClarification(_ category: CaptureCategory) {
        showClarification = false

        Task {
            do {
                let result = try await store.forceCapture(pendingContent, category: category)
                showSuccessMessage(for: result)
            } catch {
                print("Force capture failed: \(error)")
            }
        }
    }

    private func showSuccessMessage(for result: CaptureResponse) {
        let icon: String
        switch result.routed_to {
        case "action": icon = "checkmark.circle"
        case "idea": icon = "lightbulb"
        case "fact": icon = "brain"
        case "person": icon = "person"
        default: icon = "checkmark"
        }

        successMessage = "\(icon) \(result.summary)"

        withAnimation {
            showSuccess = true
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            withAnimation {
                showSuccess = false
            }
        }

        // Haptic feedback
        let generator = UINotificationFeedbackGenerator()
        generator.notificationOccurred(.success)
    }

    private func refreshAll() async {
        do {
            try await store.loadOpenActions()
            try await store.loadActionCounts()
            try await store.loadLatestBriefing()
        } catch {
            print("Refresh failed: \(error)")
        }
    }

    private func isTodaysBriefing(_ entry: LibraryEntry) -> Bool {
        Calendar.current.isDateInToday(entry.created_at)
    }
}
```

### Capture Input Section

```swift
struct CaptureInputSection: View {
    @Binding var text: String
    let isLoading: Bool
    let onSubmit: () -> Void

    @FocusState private var isFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Quick Capture")
                .font(.headline)
                .foregroundStyle(.secondary)

            HStack(alignment: .bottom, spacing: 12) {
                TextField(
                    "What's on your mind?",
                    text: $text,
                    axis: .vertical
                )
                .textFieldStyle(.plain)
                .lineLimit(1...5)
                .padding(12)
                .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
                .focused($isFocused)

                Button(action: onSubmit) {
                    Group {
                        if isLoading {
                            ProgressView()
                                .progressViewStyle(.circular)
                        } else {
                            Image(systemName: "arrow.up.circle.fill")
                                .font(.title)
                        }
                    }
                    .frame(width: 44, height: 44)
                }
                .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isLoading)
            }

            // Quick suggestions
            HStack(spacing: 8) {
                QuickCaptureChip(text: "Remind me to...", icon: "bell") {
                    text = "Remind me to "
                    isFocused = true
                }
                QuickCaptureChip(text: "I realized...", icon: "lightbulb") {
                    text = "I realized "
                    isFocused = true
                }
            }
        }
        .padding()
        .background(.background, in: RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.05), radius: 10)
    }
}

struct QuickCaptureChip: View {
    let text: String
    let icon: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.caption)
                Text(text)
                    .font(.caption)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(.quaternary, in: Capsule())
        }
        .buttonStyle(.plain)
    }
}
```

### Open Actions Section

```swift
struct OpenActionsSection: View {
    @EnvironmentObject var store: LucidStore
    let actions: [Action]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Open Actions")
                    .font(.headline)
                    .foregroundStyle(.secondary)

                Spacer()

                Text("\(actions.count)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(.quaternary, in: Capsule())
            }

            VStack(spacing: 1) {
                ForEach(actions) { action in
                    ActionRow(action: action)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
    }
}

struct ActionRow: View {
    @EnvironmentObject var store: LucidStore
    let action: Action
    @State private var isCompleting = false

    var body: some View {
        HStack(spacing: 12) {
            // Completion button
            Button {
                completeAction()
            } label: {
                Image(systemName: isCompleting ? "checkmark.circle.fill" : "circle")
                    .font(.title2)
                    .foregroundStyle(isCompleting ? .green : .secondary)
            }
            .disabled(isCompleting)

            // Action text
            VStack(alignment: .leading, spacing: 4) {
                Text(action.displayText)
                    .font(.body)
                    .strikethrough(isCompleting)
                    .foregroundStyle(isCompleting ? .secondary : .primary)

                HStack(spacing: 8) {
                    Label(action.source.rawValue.capitalized, systemImage: sourceIcon)
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    Text(action.created_at, style: .relative)
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }

            Spacer()
        }
        .padding()
        .background(.background)
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) {
                Task {
                    try? await store.cancelAction(action.id)
                }
            } label: {
                Label("Cancel", systemImage: "xmark")
            }
        }
        .swipeActions(edge: .leading) {
            Button {
                completeAction()
            } label: {
                Label("Done", systemImage: "checkmark")
            }
            .tint(.green)
        }
    }

    private var sourceIcon: String {
        switch action.source {
        case .capture: return "square.and.pencil"
        case .conversation: return "message"
        case .briefing: return "sun.max"
        }
    }

    private func completeAction() {
        withAnimation {
            isCompleting = true
        }

        let generator = UIImpactFeedbackGenerator(style: .medium)
        generator.impactOccurred()

        Task {
            try? await Task.sleep(for: .milliseconds(300))
            try? await store.markActionDone(action.id)
        }
    }
}
```

### Briefing Card

```swift
struct BriefingCard: View {
    let briefing: LibraryEntry
    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "sun.max.fill")
                    .foregroundStyle(.orange)
                Text(briefing.title ?? "Morning Briefing")
                    .font(.headline)
                Spacer()
                Text(briefing.created_at, style: .time)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Text(briefing.content)
                .font(.body)
                .foregroundStyle(.secondary)
                .lineLimit(isExpanded ? nil : 4)

            if briefing.content.count > 200 {
                Button(isExpanded ? "Show Less" : "Show More") {
                    withAnimation {
                        isExpanded.toggle()
                    }
                }
                .font(.caption.bold())
            }
        }
        .padding()
        .background(
            LinearGradient(
                colors: [.orange.opacity(0.1), .yellow.opacity(0.05)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            ),
            in: RoundedRectangle(cornerRadius: 16)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(.orange.opacity(0.2), lineWidth: 1)
        )
    }
}
```

### Clarification Sheet

```swift
struct ClarificationSheet: View {
    let content: String
    let onSelect: (CaptureCategory) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                // Original content
                Text("\"\(content)\"")
                    .font(.body)
                    .italic()
                    .multilineTextAlignment(.center)
                    .padding()
                    .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))

                Text("How should I categorize this?")
                    .font(.headline)

                // Category options
                VStack(spacing: 12) {
                    CategoryButton(
                        category: .ACTION,
                        title: "Action",
                        description: "Something to do",
                        icon: "checkmark.circle",
                        color: .blue
                    ) {
                        onSelect(.ACTION)
                    }

                    CategoryButton(
                        category: .IDEA,
                        title: "Idea",
                        description: "A thought to save",
                        icon: "lightbulb",
                        color: .yellow
                    ) {
                        onSelect(.IDEA)
                    }

                    CategoryButton(
                        category: .FACT,
                        title: "Fact",
                        description: "About me",
                        icon: "brain",
                        color: .purple
                    ) {
                        onSelect(.FACT)
                    }

                    CategoryButton(
                        category: .PERSON,
                        title: "Person",
                        description: "About someone",
                        icon: "person",
                        color: .green
                    ) {
                        onSelect(.PERSON)
                    }
                }

                Spacer()
            }
            .padding()
            .navigationTitle("Clarify")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium])
    }
}

struct CategoryButton: View {
    let category: CaptureCategory
    let title: String
    let description: String
    let icon: String
    let color: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 16) {
                Image(systemName: icon)
                    .font(.title2)
                    .foregroundStyle(color)
                    .frame(width: 44)

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.headline)
                    Text(description)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .foregroundStyle(.tertiary)
            }
            .padding()
            .background(.background, in: RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(color.opacity(0.3), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }
}
```

### Action Counts Summary

```swift
struct ActionCountsSummary: View {
    let counts: ActionCounts

    var body: some View {
        HStack(spacing: 16) {
            CountBadge(count: counts.open, label: "Open", color: .blue)
            CountBadge(count: counts.done, label: "Done", color: .green)
            CountBadge(count: counts.total, label: "Total", color: .secondary)
        }
        .padding()
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
    }
}

struct CountBadge: View {
    let count: Int
    let label: String
    let color: Color

    var body: some View {
        VStack(spacing: 4) {
            Text("\(count)")
                .font(.title2.bold())
                .foregroundStyle(color)
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}
```

### Success Toast

```swift
struct SuccessToast: View {
    let message: String

    var body: some View {
        VStack {
            HStack(spacing: 8) {
                Text(message)
                    .font(.subheadline)
                    .lineLimit(1)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(.green, in: Capsule())
            .foregroundStyle(.white)
            .shadow(radius: 10)

            Spacer()
        }
        .padding(.top, 8)
    }
}
```

---

## Tab Bar Integration

Update your main `ContentView`:

```swift
TabView(selection: $selectedTab) {
    // Existing tabs...

    CaptureTabView()
        .tabItem {
            Label("Capture", systemImage: "square.and.pencil")
        }
        .tag(2) // Or wherever you want it

    // More tabs...
}
```

---

## Testing Checklist

### Capture System
- [ ] Submit capture with text
- [ ] Classification happens automatically
- [ ] Actions create in actions table
- [ ] Ideas create in library
- [ ] Clarification sheet appears on low confidence
- [ ] Force route works after clarification
- [ ] Success toast shows correct category
- [ ] Haptic feedback on success

### Actions
- [ ] Open actions list loads
- [ ] Can mark action as done (swipe or tap)
- [ ] Can cancel action (swipe)
- [ ] List updates immediately after changes
- [ ] Counts update correctly

### Briefings
- [ ] Morning briefing displays if today's
- [ ] Can expand/collapse long briefings
- [ ] Pull to refresh loads latest

### Performance
- [ ] Capture submission is responsive
- [ ] List scrolls smoothly
- [ ] No UI freezes during API calls

---

## Error Handling

```swift
extension CaptureTabView {
    @State private var errorMessage: String?
    @State private var showError = false

    // Add to view:
    .alert("Error", isPresented: $showError) {
        Button("OK", role: .cancel) { }
    } message: {
        Text(errorMessage ?? "An error occurred")
    }

    // Wrap API calls:
    private func submitCapture() {
        Task {
            do {
                let result = try await store.capture(content)
                // Handle success...
            } catch {
                errorMessage = error.localizedDescription
                showError = true
            }
        }
    }
}
```

---

## Notes

1. **Keyboard handling**: Consider adding keyboard avoidance and dismiss on scroll
2. **Offline support**: Cache open actions locally for offline viewing
3. **Notifications**: Consider push notifications for morning briefings
4. **Widgets**: Actions count widget would be useful
5. **Shortcuts**: Siri Shortcuts for quick capture would enhance UX

---

This guide provides everything needed to implement the Capture tab on iOS, integrating with the new backend Capture system endpoints.

# iOS Implementation Guide for Partnership-First Lucid

**Prompts and guidance for implementing the Lucid vision on iOS**

---

## Quick Start: Critical Fixes

### 1. Fix the Deletion Bug (30 minutes)

**The Problem**:
> "Deleting a chat makes everything go away and I need to tap a different tab and then return to see what changed"

**The Fix**:

```swift
// BEFORE (Broken)
func deleteConversation(_ id: UUID) {
    apiClient.delete("/v1/conversations/\(id)") { result in
        // UI doesn't update!
    }
}

// AFTER (Fixed)
@MainActor
func deleteConversation(_ id: UUID) async throws {
    // Make API call
    try await apiClient.delete("/v1/conversations/\(id)")

    // Update published state
    conversations.removeAll { $0.id == id }

    // UI automatically refreshes via SwiftUI
}

// Usage in View:
Button("Delete", role: .destructive) {
    Task {
        do {
            try await viewModel.deleteConversation(conversation.id)
        } catch {
            errorMessage = error.localizedDescription
            showError = true
        }
    }
}
.alert("Error", isPresented: $showError) {
    Button("OK", role: .cancel) { }
} message: {
    Text(errorMessage)
}
```

**Test**:
1. Delete a conversation
2. UI should update immediately (no tab switching needed)
3. If error occurs, show alert

---

### 2. Hide Empty Conversations (15 minutes)

**The Problem**:
> "I have a lot of empty ones for some reason"

**Quick Fix**:

```swift
// In your ConversationListView or ViewModel
var displayedConversations: [Conversation] {
    conversations.filter { conversation in
        // Only show conversations with messages
        conversation.message_count > 0
    }
}

// Usage:
List(displayedConversations) { conversation in
    ConversationRow(conversation: conversation)
}
```

**Better Fix** (Backend Support Needed):

```swift
// When fetching conversations
func loadConversations() async throws {
    let url = "/v1/conversations/user/\(userId)?min_messages=1"
    conversations = try await apiClient.get(url)
}
```

**Backend addition needed**:
```typescript
// In conversations.ts route handler
const minMessages = parseInt(req.query.min_messages as string, 10) || 0;

// Add to SQL query:
if (minMessages > 0) {
  query += ` AND message_count >= $${params.length + 1}`;
  params.push(minMessages);
}
```

---

### 3. Add State Management Foundation (1 hour)

**Create a centralized store**:

```swift
import Foundation
import Combine

@MainActor
class LucidStore: ObservableObject {
    // MARK: - Published State
    @Published var conversations: [Conversation] = []
    @Published var topics: [Topic] = []
    @Published var facts: [Fact] = []
    @Published var insights: [Insight] = []
    @Published var currentUserState: UserState?

    // MARK: - Services
    private let apiClient: APIClient
    private let userId: UUID

    init(apiClient: APIClient, userId: UUID) {
        self.apiClient = apiClient
        self.userId = userId
    }

    // MARK: - Conversations
    func loadConversations() async throws {
        conversations = try await apiClient.get(
            "/v1/conversations/user/\(userId)?min_messages=1"
        )
    }

    func deleteConversation(_ id: UUID) async throws {
        try await apiClient.delete("/v1/conversations/\(id)")
        conversations.removeAll { $0.id == id }
    }

    func updateConversation(_ id: UUID, title: String) async throws {
        let updated: Conversation = try await apiClient.patch(
            "/v1/conversations/\(id)",
            body: ["title": title]
        )
        if let index = conversations.firstIndex(where: { $0.id == id }) {
            conversations[index] = updated
        }
    }

    // MARK: - Facts
    func extractFacts(from conversationId: UUID) async throws {
        let result: FactExtractionResult = try await apiClient.post(
            "/v1/facts/extract",
            body: [
                "user_id": userId.uuidString,
                "conversation_id": conversationId.uuidString,
                "limit": 20
            ]
        )
        // Refresh facts list
        try await loadFacts()
    }

    func loadFacts() async throws {
        facts = try await apiClient.get("/v1/users/\(userId)/facts?limit=50")
    }
}
```

**Usage in SwiftUI**:

```swift
@main
struct LucidApp: App {
    @StateObject private var store = LucidStore(
        apiClient: APIClient.shared,
        userId: UserDefaults.standard.userId // Your user ID
    )

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
                .task {
                    do {
                        try await store.loadConversations()
                        try await store.loadFacts()
                    } catch {
                        print("Failed to load initial data: \(error)")
                    }
                }
        }
    }
}

// In any view:
struct ConversationListView: View {
    @EnvironmentObject var store: LucidStore

    var body: some View {
        List(store.conversations) { conversation in
            ConversationRow(conversation: conversation)
                .swipeActions {
                    Button("Delete", role: .destructive) {
                        Task {
                            try? await store.deleteConversation(conversation.id)
                        }
                    }
                }
        }
    }
}
```

---

## Feature Implementation: Facts System

### Display User Facts (1 hour)

**Create a Facts View**:

```swift
struct FactsView: View {
    @EnvironmentObject var store: LucidStore
    @State private var selectedCategory: FactCategory?

    var body: some View {
        List {
            if !store.facts.isEmpty {
                ForEach(FactCategory.allCases, id: \.self) { category in
                    let categoryFacts = store.facts.filter { $0.category == category }
                    if !categoryFacts.isEmpty {
                        Section(category.displayName) {
                            ForEach(categoryFacts) { fact in
                                FactRow(fact: fact)
                            }
                        }
                    }
                }
            } else {
                ContentUnavailableView(
                    "No Facts Yet",
                    systemImage: "brain.head.profile",
                    description: Text("Facts about you will appear here as you chat with Lucid")
                )
            }
        }
        .navigationTitle("About You")
        .refreshable {
            try? await store.loadFacts()
        }
    }
}

struct FactRow: View {
    let fact: Fact

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(fact.content)
                .font(.body)

            HStack {
                // Confidence indicator
                HStack(spacing: 2) {
                    ForEach(0..<5) { index in
                        Image(systemName: "circle.fill")
                            .font(.caption2)
                            .foregroundStyle(
                                Double(index) < fact.confidence * 5 ? .blue : .gray.opacity(0.3)
                            )
                    }
                }

                Spacer()

                Text(fact.first_mentioned_at, style: .relative)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }
}

enum FactCategory: String, CaseIterable, Codable {
    case personal, preference, goal, relationship, skill, habit, belief, experience, health, other

    var displayName: String {
        rawValue.capitalized
    }
}
```

**Add to your tab bar**:

```swift
TabView {
    ChatView()
        .tabItem { Label("Chat", systemImage: "message") }

    TopicsView()
        .tabItem { Label("Topics", systemImage: "folder") }

    FactsView()
        .tabItem { Label("About", systemImage: "person.crop.circle") }
}
```

---

### Auto-Extract Facts After Conversation (30 minutes)

**Trigger extraction after meaningful conversation**:

```swift
// In your chat view model
func sendMessage(_ text: String) async throws {
    // Send message and get response
    let result = try await chatService.sendMessage(text, in: conversationId)

    // After 5+ messages, extract facts
    if messageCount % 5 == 0 {
        Task {
            try? await store.extractFacts(from: conversationId)
        }
    }
}
```

**Or add a manual button**:

```swift
// In ChatView toolbar
.toolbar {
    ToolbarItem(placement: .topBarTrailing) {
        Menu {
            Button {
                Task {
                    try? await store.extractFacts(from: conversation.id)
                }
            } label: {
                Label("Extract Facts", systemImage: "brain")
            }
        } label: {
            Image(systemName: "ellipsis.circle")
        }
    }
}
```

---

## Feature Implementation: User State Tracking

### Check-In Component (2 hours)

**Create reusable state input**:

```swift
struct UserStateInput: View {
    @Binding var state: UserState

    var body: some View {
        VStack(spacing: 20) {
            StateSlider(
                title: "Energy",
                value: $state.energy,
                icon: "bolt.fill",
                color: .yellow
            )

            StateSlider(
                title: "Mood",
                value: $state.mood,
                icon: "face.smiling",
                color: .blue
            )

            StateSlider(
                title: "Clarity",
                value: $state.clarity,
                icon: "brain.head.profile",
                color: .purple
            )
        }
        .padding()
    }
}

struct StateSlider: View {
    let title: String
    @Binding var value: Int
    let icon: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: icon)
                    .foregroundStyle(color)
                Text(title)
                    .font(.headline)
                Spacer()
                Text("\(value)/5")
                    .font(.title3.bold())
                    .foregroundStyle(color)
            }

            HStack(spacing: 8) {
                ForEach(1...5, id: \.self) { level in
                    Circle()
                        .fill(value >= level ? color : color.opacity(0.2))
                        .frame(width: 40, height: 40)
                        .onTapGesture {
                            value = level
                            // Haptic feedback
                            let generator = UIImpactFeedbackGenerator(style: .light)
                            generator.impactOccurred()
                        }
                }
            }
        }
    }
}

struct UserState: Codable, Equatable {
    var energy: Int = 3
    var mood: Int = 3
    var clarity: Int = 3
    var timeOfDay: TimeOfDay {
        let hour = Calendar.current.component(.hour, from: Date())
        switch hour {
        case 5..<12: return .morning
        case 12..<17: return .afternoon
        case 17..<22: return .evening
        default: return .lateNight
        }
    }

    enum TimeOfDay: String, Codable {
        case morning, afternoon, evening, lateNight = "late_night"
    }
}
```

**Quick Check-In View**:

```swift
struct QuickCheckInView: View {
    @EnvironmentObject var store: LucidStore
    @State private var userState = UserState()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 30) {
                VStack(spacing: 8) {
                    Image(systemName: timeOfDayIcon)
                        .font(.system(size: 60))
                        .foregroundStyle(timeOfDayColor)

                    Text("How are you feeling?")
                        .font(.title2.bold())

                    Text(timeOfDayGreeting)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .padding(.top)

                UserStateInput(state: $userState)

                Spacer()

                Button {
                    Task {
                        try? await submitCheckIn()
                        dismiss()
                    }
                } label: {
                    Text("Save Check-In")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.accentColor)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .padding()
            }
            .navigationTitle("Check-In")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }

    private var timeOfDayIcon: String {
        switch userState.timeOfDay {
        case .morning: return "sunrise.fill"
        case .afternoon: return "sun.max.fill"
        case .evening: return "sunset.fill"
        case .lateNight: return "moon.stars.fill"
        }
    }

    private var timeOfDayColor: Color {
        switch userState.timeOfDay {
        case .morning: return .orange
        case .afternoon: return .yellow
        case .evening: return .purple
        case .lateNight: return .indigo
        }
    }

    private var timeOfDayGreeting: String {
        switch userState.timeOfDay {
        case .morning: return "Good morning"
        case .afternoon: return "Good afternoon"
        case .evening: return "Good evening"
        case .lateNight: return "Still up?"
        }
    }

    private func submitCheckIn() async throws {
        // Save to local state
        store.currentUserState = userState

        // Optionally send to backend for logging
        // try await apiClient.post("/v1/users/\(userId)/state", body: userState)
    }
}
```

**Display Current State in Chat**:

```swift
struct ChatView: View {
    @EnvironmentObject var store: LucidStore
    @State private var showCheckIn = false

    var body: some View {
        VStack(spacing: 0) {
            // State banner
            if let state = store.currentUserState {
                StateDisplayBanner(state: state) {
                    showCheckIn = true
                }
            }

            // Chat messages
            MessageListView()

            // Input
            MessageInputView()
        }
        .sheet(isPresented: $showCheckIn) {
            QuickCheckInView()
        }
    }
}

struct StateDisplayBanner: View {
    let state: UserState
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                StateIndicator(value: state.energy, color: .yellow, icon: "bolt.fill")
                StateIndicator(value: state.mood, color: .blue, icon: "face.smiling")
                StateIndicator(value: state.clarity, color: .purple, icon: "brain")

                Spacer()

                Text(state.timeOfDay.rawValue.capitalized)
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)

                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
            .background(.quaternary)
        }
        .buttonStyle(.plain)
    }
}

struct StateIndicator: View {
    let value: Int
    let color: Color
    let icon: String

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .font(.caption)
                .foregroundStyle(color)
            Text("\(value)")
                .font(.caption.bold())
        }
    }
}
```

**Send State with Chat Messages**:

```swift
func sendMessage(_ text: String) async throws {
    let payload: [String: Any] = [
        "conversation_id": conversationId.uuidString,
        "user_id": userId.uuidString,
        "message": text,
        "user_state": [
            "energy": store.currentUserState?.energy ?? 3,
            "mood": store.currentUserState?.mood ?? 3,
            "clarity": store.currentUserState?.clarity ?? 3,
            "time_of_day": store.currentUserState?.timeOfDay.rawValue ?? "afternoon"
        ]
    ]

    let response: ChatResponse = try await apiClient.post("/v1/chat", body: payload)
    // Handle response
}
```

---

## Feature Implementation: Topics System

### Topics Data Model (30 minutes)

```swift
struct Topic: Identifiable, Codable, Equatable {
    let id: UUID
    let conversationId: UUID
    let userId: UUID
    let title: String
    let description: String?
    let createdAt: Date
    let updatedAt: Date
    let isActive: Bool
    let messageCount: Int
    let metadata: [String: String]?

    var displayTitle: String {
        title.isEmpty ? "Untitled Topic" : title
    }
}

extension LucidStore {
    func loadTopics() async throws {
        // For now, topics are just named conversations
        let allConversations: [Conversation] = try await apiClient.get(
            "/v1/conversations/user/\(userId)"
        )

        // Convert named conversations to topics
        topics = allConversations
            .filter { $0.title != nil && !$0.title!.isEmpty }
            .map { conversation in
                Topic(
                    id: conversation.id,
                    conversationId: conversation.id,
                    userId: conversation.userId,
                    title: conversation.title ?? "",
                    description: nil,
                    createdAt: conversation.started_at,
                    updatedAt: conversation.updated_at ?? conversation.started_at,
                    isActive: conversation.is_active,
                    messageCount: conversation.message_count,
                    metadata: nil
                )
            }
    }

    func promoteToTopic(_ conversationId: UUID, title: String) async throws {
        // Update conversation with title
        try await updateConversation(conversationId, title: title)

        // Reload topics
        try await loadTopics()
    }
}
```

---

### Topics List View (1 hour)

```swift
struct TopicsView: View {
    @EnvironmentObject var store: LucidStore
    @State private var selectedTopic: Topic?

    var body: some View {
        NavigationStack {
            List {
                if store.topics.isEmpty {
                    ContentUnavailableView(
                        "No Topics Yet",
                        systemImage: "folder",
                        description: Text("Topics you're working on will appear here.\n\nStart by naming a conversation.")
                    )
                } else {
                    ForEach(store.topics) { topic in
                        TopicRow(topic: topic)
                            .contentShape(Rectangle())
                            .onTapGesture {
                                selectedTopic = topic
                            }
                    }
                }
            }
            .navigationTitle("Topics")
            .refreshable {
                try? await store.loadTopics()
            }
            .sheet(item: $selectedTopic) { topic in
                TopicDetailView(topic: topic)
            }
        }
    }
}

struct TopicRow: View {
    let topic: Topic

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(topic.displayTitle)
                .font(.headline)

            HStack {
                Label("\(topic.messageCount)", systemImage: "message")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Spacer()

                Text(topic.updatedAt, style: .relative)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }
}
```

---

### Topic Detail Sheet (1 hour)

```swift
struct TopicDetailView: View {
    @EnvironmentObject var store: LucidStore
    let topic: Topic

    @State private var messages: [Message] = []
    @State private var inputText = ""
    @State private var isLoading = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Messages list
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 12) {
                            ForEach(messages) { message in
                                MessageBubble(message: message)
                                    .id(message.id)
                            }
                        }
                        .padding()
                    }
                    .onChange(of: messages.count) { _, _ in
                        if let lastMessage = messages.last {
                            withAnimation {
                                proxy.scrollTo(lastMessage.id, anchor: .bottom)
                            }
                        }
                    }
                }

                // Input
                HStack(spacing: 12) {
                    TextField("Message", text: $inputText, axis: .vertical)
                        .textFieldStyle(.roundedBorder)
                        .lineLimit(1...5)

                    Button {
                        Task {
                            await sendMessage()
                        }
                    } label: {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.title2)
                    }
                    .disabled(inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .padding()
            }
            .navigationTitle(topic.displayTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button {
                            // Mark as complete
                        } label: {
                            Label("Mark Complete", systemImage: "checkmark.circle")
                        }

                        Button {
                            // Extract facts
                            Task {
                                try? await store.extractFacts(from: topic.conversationId)
                            }
                        } label: {
                            Label("Extract Facts", systemImage: "brain")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .task {
                await loadMessages()
            }
        }
    }

    private func loadMessages() async {
        isLoading = true
        defer { isLoading = false }

        do {
            messages = try await store.apiClient.get(
                "/v1/conversations/\(topic.conversationId)/messages"
            )
        } catch {
            print("Failed to load messages: \(error)")
        }
    }

    private func sendMessage() async {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        inputText = ""

        do {
            // Send message (implementation depends on your chat service)
            // After sending, reload messages
            await loadMessages()
        } catch {
            print("Failed to send message: \(error)")
        }
    }
}
```

---

### Promote to Topic Action (30 minutes)

**Add to ChatView toolbar**:

```swift
.toolbar {
    ToolbarItem(placement: .topBarTrailing) {
        Menu {
            if conversation.title == nil || conversation.title!.isEmpty {
                Button {
                    showNameTopicSheet = true
                } label: {
                    Label("Make This a Topic", systemImage: "folder.badge.plus")
                }
            }

            Button {
                Task {
                    try? await store.extractFacts(from: conversation.id)
                }
            } label: {
                Label("Extract Facts", systemImage: "brain")
            }
        } label: {
            Image(systemName: "ellipsis.circle")
        }
    }
}
.sheet(isPresented: $showNameTopicSheet) {
    NameTopicSheet(conversationId: conversation.id)
}
```

**Name Topic Sheet**:

```swift
struct NameTopicSheet: View {
    @EnvironmentObject var store: LucidStore
    @Environment(\.dismiss) private var dismiss

    let conversationId: UUID
    @State private var topicName = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Topic Name", text: $topicName, axis: .vertical)
                        .lineLimit(1...3)
                } header: {
                    Text("Give this conversation a name")
                } footer: {
                    Text("This will help you track and organize your ongoing work with Lucid.")
                }
            }
            .navigationTitle("Create Topic")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            try? await store.promoteToTopic(conversationId, title: topicName)
                            dismiss()
                        }
                    }
                    .disabled(topicName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }
}
```

---

## Putting It All Together: Tab Structure

```swift
struct ContentView: View {
    @EnvironmentObject var store: LucidStore
    @State private var selectedTab = 0

    var body: some View {
        TabView(selection: $selectedTab) {
            // Tab 1: Chat
            NavigationStack {
                ConversationsListView()
            }
            .tabItem {
                Label("Chat", systemImage: "message")
            }
            .tag(0)

            // Tab 2: Topics
            TopicsView()
                .tabItem {
                    Label("Topics", systemImage: "folder")
                }
                .tag(1)

            // Tab 3: Check-In
            CheckInTabView()
                .tabItem {
                    Label("Check-In", systemImage: "heart.text.square")
                }
                .tag(2)

            // Tab 4: About (Facts + Insights)
            NavigationStack {
                AboutView()
            }
            .tabItem {
                Label("About", systemImage: "person.crop.circle")
            }
            .tag(3)
        }
    }
}

struct CheckInTabView: View {
    @EnvironmentObject var store: LucidStore
    @State private var userState = UserState()

    var body: some View {
        NavigationStack {
            VStack(spacing: 30) {
                // Current state
                if let current = store.currentUserState {
                    VStack(spacing: 12) {
                        Text("Current State")
                            .font(.headline)
                            .foregroundStyle(.secondary)

                        HStack(spacing: 20) {
                            StateCard(title: "Energy", value: current.energy, icon: "bolt.fill", color: .yellow)
                            StateCard(title: "Mood", value: current.mood, icon: "face.smiling", color: .blue)
                            StateCard(title: "Clarity", value: current.clarity, icon: "brain", color: .purple)
                        }
                    }
                    .padding()
                    .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
                }

                // Quick check-in
                VStack(spacing: 16) {
                    Text("How are you feeling right now?")
                        .font(.title3.bold())

                    UserStateInput(state: $userState)

                    Button {
                        Task {
                            store.currentUserState = userState
                            // Haptic
                            let generator = UINotificationFeedbackGenerator()
                            generator.notificationOccurred(.success)
                        }
                    } label: {
                        Text("Update State")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(Color.accentColor)
                            .foregroundStyle(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                }

                Spacer()
            }
            .padding()
            .navigationTitle("Check-In")
        }
    }
}

struct StateCard: View {
    let title: String
    let value: Int
    let icon: String
    let color: Color

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon)
                .font(.title)
                .foregroundStyle(color)

            Text("\(value)/5")
                .font(.title2.bold())

            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding()
        .background(.background, in: RoundedRectangle(cornerRadius: 8))
    }
}
```

---

## Testing Checklist

### Critical Fixes
- [ ] Delete conversation → UI updates immediately
- [ ] No empty conversations shown
- [ ] State persists across tab switches
- [ ] Error handling shows alerts

### Facts System
- [ ] Facts display in About tab
- [ ] Extract facts from conversation works
- [ ] Facts organized by category
- [ ] Confidence levels visible
- [ ] Can refresh facts list

### State Tracking
- [ ] Check-in UI is smooth and intuitive
- [ ] State saves to store
- [ ] State displays in chat header
- [ ] Time of day auto-detects correctly
- [ ] Haptic feedback on interactions

### Topics
- [ ] Can name a conversation
- [ ] Named conversation appears in Topics tab
- [ ] Tap topic opens detail sheet
- [ ] Can chat within topic context
- [ ] Extract facts from topic works

---

## Performance Considerations

### 1. Lazy Loading
```swift
// Don't load all messages upfront
LazyVStack {
    ForEach(messages) { message in
        MessageBubble(message: message)
    }
}
```

### 2. Pagination
```swift
// Load messages in batches
func loadMoreMessages() async {
    let offset = messages.count
    let newMessages = try await apiClient.get(
        "/v1/conversations/\(conversationId)/messages?limit=20&offset=\(offset)"
    )
    messages.append(contentsOf: newMessages)
}
```

### 3. Debouncing
```swift
// Don't spam the API on every keystroke
@State private var searchDebounce: Task<Void, Never>?

func search(_ query: String) {
    searchDebounce?.cancel()
    searchDebounce = Task {
        try? await Task.sleep(for: .milliseconds(300))
        await performSearch(query)
    }
}
```

---

## Next Steps

1. **Week 1**: Fix critical bugs (deletion, empty conversations, state management)
2. **Week 2**: Implement facts display and extraction
3. **Week 3**: Add state tracking and check-in UI
4. **Week 4**: Build Topics system
5. **Week 5**: Polish and test

---

This guide provides concrete code examples for implementing the partnership-first vision of Lucid on iOS. Each section can be implemented incrementally without breaking existing functionality.

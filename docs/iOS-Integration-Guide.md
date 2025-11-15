# Lucid iOS Integration Guide - Cursor Prompt

> **Copy this entire document and paste it into Cursor when working on the iOS app**

---

## 🎯 Mission: Fix iOS App to Properly Integrate with Lucid Backend

### Current Problem
The iOS app is treating Lucid like a **stateless chatbot**, sending messages but:
- ❌ Not persisting conversation IDs (chat disappears when you navigate away)
- ❌ Not fetching conversation history (can't see past messages)
- ❌ Not extracting or displaying facts Lucid learns about the user
- ❌ Not generating or showing conversation summaries
- ❌ Only using 1 endpoint out of 15+ available

### What Needs to Happen
The Lucid backend on Railway **stores everything permanently** - we just need iOS to ask for it and manage state properly.

---

## 🏗️ Architecture Overview

### Backend Responsibilities (Lucid on Railway)
The backend is a **stateful brain** that:
- ✅ Stores all conversations permanently
- ✅ Stores all messages (user + assistant)
- ✅ Extracts and stores facts when requested
- ✅ Generates summaries when requested
- ✅ Maintains conversation context
- ✅ Runs autonomous thoughts in background (if enabled)

### iOS Responsibilities (What You Need to Build)
The iOS app is a **stateful interface** that should:
- 📱 Persist user_id and conversation_ids locally
- 📱 Fetch and display conversation history
- 📱 Show list of all past conversations
- 📱 Trigger fact extraction periodically
- 📱 Display facts Lucid has learned
- 📱 Trigger and display conversation summaries
- 📱 Manage local state between app sessions

---

## 📚 Complete API Reference

Base URL: `https://your-railway-url.up.railway.app`

### 1. User Management

#### Create or Get User
```http
POST /v1/users
Content-Type: application/json

{
  "external_id": "ios-{device-uuid}",
  "name": "User's Name",
  "email": "user@example.com",
  "timezone": "America/New_York"
}

Response 201:
{
  "id": "uuid",
  "external_id": "ios-{device-uuid}",
  "name": "User's Name",
  "email": "user@example.com",
  "timezone": "America/New_York",
  "created_at": "2024-01-15T10:30:00Z",
  "updated_at": "2024-01-15T10:30:00Z"
}
```

### 2. Conversation Management

#### Create New Conversation
```http
POST /v1/conversations
Content-Type: application/json

{
  "user_id": "user-uuid",
  "title": "Chat about AI",
  "user_timezone": "America/New_York"
}

Response 201:
{
  "id": "conversation-uuid",
  "user_id": "user-uuid",
  "title": "Chat about AI",
  "user_timezone": "America/New_York",
  "created_at": "2024-01-15T10:30:00Z",
  "updated_at": "2024-01-15T10:30:00Z"
}
```

#### Get All Conversations for User
```http
GET /v1/conversations/user/{user_id}?limit=50&offset=0

Response 200:
{
  "conversations": [
    {
      "id": "uuid",
      "user_id": "user-uuid",
      "title": "Chat about AI",
      "created_at": "2024-01-15T10:30:00Z",
      "updated_at": "2024-01-15T10:30:00Z"
    }
  ],
  "count": 1,
  "limit": 50,
  "offset": 0
}
```

#### Get Single Conversation
```http
GET /v1/conversations/{conversation_id}

Response 200:
{
  "id": "conversation-uuid",
  "user_id": "user-uuid",
  "title": "Chat about AI",
  "created_at": "2024-01-15T10:30:00Z"
}
```

#### Update Conversation Title
```http
PATCH /v1/conversations/{conversation_id}
Content-Type: application/json

{
  "title": "New Title"
}

Response 200: (updated conversation object)
```

#### Delete Conversation
```http
DELETE /v1/conversations/{conversation_id}

Response 204: (no content)
```

### 3. Chat & Messages

#### Send Message and Get Response
```http
POST /v1/chat
Content-Type: application/json

{
  "conversation_id": "conversation-uuid",
  "user_id": "user-uuid",
  "message": "Hello Lucid!",
  "model": "claude-3-5-sonnet-20241022",
  "temperature": 0.7
}

Response 200:
{
  "user_message": {
    "id": "msg-uuid-1",
    "conversation_id": "conversation-uuid",
    "user_id": "user-uuid",
    "role": "user",
    "content": "Hello Lucid!",
    "created_at": "2024-01-15T10:30:00Z"
  },
  "assistant_message": {
    "id": "msg-uuid-2",
    "conversation_id": "conversation-uuid",
    "user_id": "user-uuid",
    "role": "assistant",
    "content": "Hi! How can I help you today?",
    "created_at": "2024-01-15T10:30:01Z"
  },
  "response": "Hi! How can I help you today?",
  "conversation_id": "conversation-uuid"
}
```

#### Get Message History
```http
GET /v1/conversations/{conversation_id}/messages?limit=100&offset=0

Response 200:
{
  "messages": [
    {
      "id": "msg-uuid",
      "conversation_id": "conversation-uuid",
      "user_id": "user-uuid",
      "role": "user",
      "content": "Hello!",
      "created_at": "2024-01-15T10:30:00Z"
    },
    {
      "id": "msg-uuid-2",
      "role": "assistant",
      "content": "Hi there!",
      "created_at": "2024-01-15T10:30:01Z"
    }
  ],
  "count": 2,
  "limit": 100,
  "offset": 0
}
```

**Note:** This is the RESTful route. There's also an older route at `/v1/messages/conversations/{conversation_id}/messages` but the above is preferred.

### 4. Facts (What Lucid Learns About You)

#### Extract Facts from Conversation
```http
POST /v1/facts/extract
Content-Type: application/json

{
  "user_id": "user-uuid",
  "conversation_id": "conversation-uuid",
  "limit": 20
}

Response 201:
{
  "extracted": [
    {
      "content": "User is a software engineer",
      "category": "profession",
      "confidence": 0.95
    },
    {
      "content": "User prefers iOS development",
      "category": "preference",
      "confidence": 0.85
    }
  ],
  "created": [
    {
      "id": "fact-uuid-1",
      "user_id": "user-uuid",
      "content": "User is a software engineer",
      "category": "profession",
      "confidence": 0.95,
      "is_active": true,
      "created_at": "2024-01-15T10:30:00Z"
    }
  ],
  "count": 2,
  "message": "Extracted 2 facts, created 2 successfully"
}
```

#### Get All Facts for User
```http
GET /v1/users/{user_id}/facts?limit=50&offset=0&is_active=true

Response 200:
{
  "facts": [
    {
      "id": "fact-uuid",
      "user_id": "user-uuid",
      "content": "User is a software engineer",
      "category": "profession",
      "confidence": 0.95,
      "is_active": true,
      "created_at": "2024-01-15T10:30:00Z"
    }
  ],
  "count": 1,
  "limit": 50,
  "offset": 0
}
```

#### Update Fact (e.g., mark as inactive if wrong)
```http
PATCH /v1/facts/{fact_id}
Content-Type: application/json

{
  "is_active": false
}

Response 200: (updated fact object)
```

#### Search Facts Semantically
```http
POST /v1/facts/search
Content-Type: application/json

{
  "query": "What does Lucid know about my work?",
  "user_id": "user-uuid",
  "limit": 10,
  "min_similarity": 0.7
}

Response 200:
{
  "results": [
    {
      "fact": { /* fact object */ },
      "similarity": 0.92
    }
  ],
  "count": 1,
  "query": "What does Lucid know about my work?"
}
```

### 5. Summaries

#### Generate Summary
```http
POST /v1/summaries/generate
Content-Type: application/json

{
  "conversation_id": "conversation-uuid",
  "user_id": "user-uuid",
  "message_count": 20
}

Response 201:
{
  "id": "summary-uuid",
  "conversation_id": "conversation-uuid",
  "user_id": "user-uuid",
  "user_perspective": "I asked about AI development...",
  "model_perspective": "The user inquired about...",
  "conversation_overview": "Discussion about AI development tools",
  "message_count": 20,
  "created_at": "2024-01-15T10:30:00Z"
}
```

#### Get Summaries for Conversation
```http
GET /v1/conversations/{conversation_id}/summaries

Response 200:
{
  "summaries": [
    {
      "id": "summary-uuid",
      "conversation_overview": "Discussion about AI",
      "created_at": "2024-01-15T10:30:00Z"
    }
  ],
  "count": 1,
  "conversation_id": "conversation-uuid",
  "limit": 50,
  "offset": 0
}
```

**Note:** This is the RESTful route. There's also an older route at `/v1/summaries/conversations/{conversation_id}` but the above is preferred.

---

## 💻 iOS Implementation Plan

### Phase 1: Data Models

Create these Swift models:

```swift
// Models/User.swift
struct User: Codable, Identifiable {
    let id: String
    let externalId: String
    let name: String?
    let email: String?
    let timezone: String?
    let createdAt: Date
    let updatedAt: Date

    enum CodingKeys: String, CodingKey {
        case id, name, email, timezone
        case externalId = "external_id"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

// Models/Conversation.swift
struct Conversation: Codable, Identifiable {
    let id: String
    let userId: String
    let title: String?
    let userTimezone: String?
    let createdAt: Date
    let updatedAt: Date

    enum CodingKeys: String, CodingKey {
        case id, title
        case userId = "user_id"
        case userTimezone = "user_timezone"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

// Models/Message.swift
struct Message: Codable, Identifiable {
    let id: String
    let conversationId: String
    let userId: String
    let role: MessageRole
    let content: String
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id, role, content
        case conversationId = "conversation_id"
        case userId = "user_id"
        case createdAt = "created_at"
    }
}

enum MessageRole: String, Codable {
    case user
    case assistant
    case system
}

// Models/Fact.swift
struct Fact: Codable, Identifiable {
    let id: String
    let userId: String
    let content: String
    let category: String?
    let confidence: Double
    let isActive: Bool
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id, content, category, confidence
        case userId = "user_id"
        case isActive = "is_active"
        case createdAt = "created_at"
    }
}

// Models/Summary.swift
struct Summary: Codable, Identifiable {
    let id: String
    let conversationId: String
    let userId: String
    let userPerspective: String?
    let modelPerspective: String?
    let conversationOverview: String?
    let messageCount: Int
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case conversationId = "conversation_id"
        case userId = "user_id"
        case userPerspective = "user_perspective"
        case modelPerspective = "model_perspective"
        case conversationOverview = "conversation_overview"
        case messageCount = "message_count"
        case createdAt = "created_at"
    }
}
```

### Phase 2: API Service Layer

```swift
// Services/LucidAPIService.swift
import Foundation

class LucidAPIService {
    static let shared = LucidAPIService()

    private let baseURL = "https://your-railway-url.up.railway.app"
    private let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()

    private let encoder = JSONEncoder()

    // MARK: - User Management

    func createOrGetUser(externalId: String, name: String?, email: String?) async throws -> User {
        let url = URL(string: "\(baseURL)/v1/users")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any?] = [
            "external_id": externalId,
            "name": name,
            "email": email,
            "timezone": TimeZone.current.identifier
        ]

        request.httpBody = try JSONSerialization.data(withJSONObject: body.compactMapValues { $0 })

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw APIError.invalidResponse
        }

        return try decoder.decode(User.self, from: data)
    }

    // MARK: - Conversations

    func createConversation(userId: String, title: String?) async throws -> Conversation {
        let url = URL(string: "\(baseURL)/v1/conversations")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any?] = [
            "user_id": userId,
            "title": title,
            "user_timezone": TimeZone.current.identifier
        ]

        request.httpBody = try JSONSerialization.data(withJSONObject: body.compactMapValues { $0 })

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw APIError.invalidResponse
        }

        return try decoder.decode(Conversation.self, from: data)
    }

    func getConversations(userId: String, limit: Int = 50, offset: Int = 0) async throws -> [Conversation] {
        let url = URL(string: "\(baseURL)/v1/conversations/user/\(userId)?limit=\(limit)&offset=\(offset)")!

        let (data, _) = try await URLSession.shared.data(from: url)

        struct Response: Codable {
            let conversations: [Conversation]
        }

        let response = try decoder.decode(Response.self, from: data)
        return response.conversations
    }

    func updateConversationTitle(conversationId: String, title: String) async throws -> Conversation {
        let url = URL(string: "\(baseURL)/v1/conversations/\(conversationId)")!
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body = ["title": title]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, _) = try await URLSession.shared.data(for: request)
        return try decoder.decode(Conversation.self, from: data)
    }

    func deleteConversation(conversationId: String) async throws {
        let url = URL(string: "\(baseURL)/v1/conversations/\(conversationId)")!
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"

        _ = try await URLSession.shared.data(for: request)
    }

    // MARK: - Chat

    func sendMessage(
        conversationId: String,
        userId: String,
        message: String,
        model: String = "claude-3-5-sonnet-20241022"
    ) async throws -> ChatResponse {
        let url = URL(string: "\(baseURL)/v1/chat")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "conversation_id": conversationId,
            "user_id": userId,
            "message": message,
            "model": model
        ]

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        // Handle specific error codes
        if httpResponse.statusCode == 503 {
            throw APIError.serviceUnavailable
        }

        if httpResponse.statusCode == 504 {
            throw APIError.timeout
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            throw APIError.invalidResponse
        }

        return try decoder.decode(ChatResponse.self, from: data)
    }

    func getMessages(conversationId: String, limit: Int = 100, offset: Int = 0) async throws -> [Message] {
        let url = URL(string: "\(baseURL)/v1/conversations/\(conversationId)/messages?limit=\(limit)&offset=\(offset)")!

        let (data, _) = try await URLSession.shared.data(from: url)

        struct Response: Codable {
            let messages: [Message]
        }

        let response = try decoder.decode(Response.self, from: data)
        return response.messages
    }

    // MARK: - Facts

    func extractFacts(userId: String, conversationId: String, limit: Int = 20) async throws -> FactExtractionResponse {
        let url = URL(string: "\(baseURL)/v1/facts/extract")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "user_id": userId,
            "conversation_id": conversationId,
            "limit": limit
        ]

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, _) = try await URLSession.shared.data(for: request)
        return try decoder.decode(FactExtractionResponse.self, from: data)
    }

    func getFacts(userId: String, isActive: Bool = true) async throws -> [Fact] {
        let url = URL(string: "\(baseURL)/v1/users/\(userId)/facts?is_active=\(isActive)")!

        let (data, _) = try await URLSession.shared.data(from: url)

        struct Response: Codable {
            let facts: [Fact]
        }

        let response = try decoder.decode(Response.self, from: data)
        return response.facts
    }

    func updateFact(factId: String, isActive: Bool) async throws -> Fact {
        let url = URL(string: "\(baseURL)/v1/facts/\(factId)")!
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body = ["is_active": isActive]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, _) = try await URLSession.shared.data(for: request)
        return try decoder.decode(Fact.self, from: data)
    }

    // MARK: - Summaries

    func generateSummary(conversationId: String, userId: String, messageCount: Int = 20) async throws -> Summary {
        let url = URL(string: "\(baseURL)/v1/summaries/generate")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "conversation_id": conversationId,
            "user_id": userId,
            "message_count": messageCount
        ]

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, _) = try await URLSession.shared.data(for: request)
        return try decoder.decode(Summary.self, from: data)
    }

    func getSummaries(conversationId: String) async throws -> [Summary] {
        let url = URL(string: "\(baseURL)/v1/conversations/\(conversationId)/summaries")!

        let (data, _) = try await URLSession.shared.data(from: url)

        struct Response: Codable {
            let summaries: [Summary]
        }

        let response = try decoder.decode(Response.self, from: data)
        return response.summaries
    }
}

// MARK: - Response Models

struct ChatResponse: Codable {
    let userMessage: Message
    let assistantMessage: Message
    let response: String
    let conversationId: String

    enum CodingKeys: String, CodingKey {
        case response
        case userMessage = "user_message"
        case assistantMessage = "assistant_message"
        case conversationId = "conversation_id"
    }
}

struct FactExtractionResponse: Codable {
    let extracted: [ExtractedFact]
    let created: [Fact]
    let count: Int
    let message: String
}

struct ExtractedFact: Codable {
    let content: String
    let category: String?
    let confidence: Double
}

// MARK: - Errors

enum APIError: Error {
    case invalidResponse
    case serviceUnavailable
    case timeout
    case decodingError
}
```

### Phase 3: Local Persistence

```swift
// Services/UserDefaultsManager.swift
import Foundation

class UserDefaultsManager {
    static let shared = UserDefaultsManager()

    private let userIdKey = "lucid_user_id"
    private let currentConversationKey = "lucid_current_conversation_id"

    var userId: String? {
        get { UserDefaults.standard.string(forKey: userIdKey) }
        set { UserDefaults.standard.set(newValue, forKey: userIdKey) }
    }

    var currentConversationId: String? {
        get { UserDefaults.standard.string(forKey: currentConversationKey) }
        set { UserDefaults.standard.set(newValue, forKey: currentConversationKey) }
    }

    func clearAll() {
        UserDefaults.standard.removeObject(forKey: userIdKey)
        UserDefaults.standard.removeObject(forKey: currentConversationKey)
    }
}
```

### Phase 4: View Models

```swift
// ViewModels/ChatViewModel.swift
import Foundation
import Combine

@MainActor
class ChatViewModel: ObservableObject {
    @Published var messages: [Message] = []
    @Published var isLoading = false
    @Published var error: String?
    @Published var currentConversation: Conversation?

    private let api = LucidAPIService.shared
    private let defaults = UserDefaultsManager.shared
    private var userId: String!
    private var messageCounter = 0

    init() {
        Task {
            await ensureUserExists()
        }
    }

    // Ensure user exists on app launch
    private func ensureUserExists() async {
        if let existingUserId = defaults.userId {
            self.userId = existingUserId
            return
        }

        // Create new user
        do {
            let deviceId = UIDevice.current.identifierForVendor?.uuidString ?? UUID().uuidString
            let user = try await api.createOrGetUser(
                externalId: "ios-\(deviceId)",
                name: nil,
                email: nil
            )
            defaults.userId = user.id
            self.userId = user.id
        } catch {
            self.error = "Failed to create user: \(error.localizedDescription)"
        }
    }

    // Start a new conversation or load existing
    func startConversation(existingConversationId: String? = nil) async {
        guard userId != nil else {
            await ensureUserExists()
            return
        }

        if let conversationId = existingConversationId {
            // Load existing conversation
            await loadMessages(conversationId: conversationId)
            defaults.currentConversationId = conversationId
        } else {
            // Create new conversation
            do {
                let conversation = try await api.createConversation(
                    userId: userId,
                    title: "New Chat"
                )
                currentConversation = conversation
                defaults.currentConversationId = conversation.id
            } catch {
                self.error = "Failed to create conversation: \(error.localizedDescription)"
            }
        }
    }

    // Load message history
    private func loadMessages(conversationId: String) async {
        isLoading = true
        defer { isLoading = false }

        do {
            messages = try await api.getMessages(conversationId: conversationId)
        } catch {
            self.error = "Failed to load messages: \(error.localizedDescription)"
        }
    }

    // Send a message
    func sendMessage(_ text: String) async {
        guard !text.isEmpty else { return }
        guard let userId = userId else {
            await ensureUserExists()
            return
        }

        // Ensure we have a conversation
        if currentConversation == nil {
            await startConversation()
        }

        guard let conversationId = currentConversation?.id else {
            error = "No active conversation"
            return
        }

        isLoading = true
        defer { isLoading = false }

        do {
            let response = try await api.sendMessage(
                conversationId: conversationId,
                userId: userId,
                message: text
            )

            // Add messages to local array
            messages.append(response.userMessage)
            messages.append(response.assistantMessage)

            // Increment counter and check if we should extract facts
            messageCounter += 1
            if messageCounter % 10 == 0 {
                Task {
                    await extractFacts()
                }
            }

        } catch APIError.timeout {
            error = "Request timed out. Please try again."
        } catch APIError.serviceUnavailable {
            error = "Lucid is temporarily unavailable. Please try again."
        } catch {
            self.error = "Failed to send message: \(error.localizedDescription)"
        }
    }

    // Extract facts from current conversation
    func extractFacts() async {
        guard let conversationId = currentConversation?.id else { return }

        do {
            let result = try await api.extractFacts(
                userId: userId,
                conversationId: conversationId
            )
            print("✅ Extracted \(result.count) facts from conversation")
        } catch {
            print("❌ Failed to extract facts: \(error.localizedDescription)")
        }
    }

    // Generate summary
    func generateSummary() async {
        guard let conversationId = currentConversation?.id else { return }

        do {
            let summary = try await api.generateSummary(
                conversationId: conversationId,
                userId: userId
            )
            print("✅ Generated summary: \(summary.conversationOverview ?? "No overview")")
        } catch {
            print("❌ Failed to generate summary: \(error.localizedDescription)")
        }
    }
}

// ViewModels/ConversationListViewModel.swift
@MainActor
class ConversationListViewModel: ObservableObject {
    @Published var conversations: [Conversation] = []
    @Published var isLoading = false
    @Published var error: String?

    private let api = LucidAPIService.shared
    private let defaults = UserDefaultsManager.shared

    func loadConversations() async {
        guard let userId = defaults.userId else { return }

        isLoading = true
        defer { isLoading = false }

        do {
            conversations = try await api.getConversations(userId: userId)
        } catch {
            self.error = "Failed to load conversations: \(error.localizedDescription)"
        }
    }

    func deleteConversation(_ conversation: Conversation) async {
        do {
            try await api.deleteConversation(conversationId: conversation.id)
            conversations.removeAll { $0.id == conversation.id }
        } catch {
            self.error = "Failed to delete conversation: \(error.localizedDescription)"
        }
    }
}

// ViewModels/FactsViewModel.swift
@MainActor
class FactsViewModel: ObservableObject {
    @Published var facts: [Fact] = []
    @Published var isLoading = false
    @Published var error: String?

    private let api = LucidAPIService.shared
    private let defaults = UserDefaultsManager.shared

    func loadFacts() async {
        guard let userId = defaults.userId else { return }

        isLoading = true
        defer { isLoading = false }

        do {
            facts = try await api.getFacts(userId: userId)
        } catch {
            self.error = "Failed to load facts: \(error.localizedDescription)"
        }
    }

    func toggleFactActive(_ fact: Fact) async {
        do {
            let updated = try await api.updateFact(factId: fact.id, isActive: !fact.isActive)
            if let index = facts.firstIndex(where: { $0.id == fact.id }) {
                facts[index] = updated
            }
        } catch {
            self.error = "Failed to update fact: \(error.localizedDescription)"
        }
    }
}
```

### Phase 5: SwiftUI Views

```swift
// Views/ChatView.swift
import SwiftUI

struct ChatView: View {
    @StateObject private var viewModel = ChatViewModel()
    @State private var messageText = ""

    let conversation: Conversation?

    var body: some View {
        VStack {
            // Messages list
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(viewModel.messages) { message in
                            MessageBubble(message: message)
                                .id(message.id)
                        }
                    }
                    .padding()
                }
                .onChange(of: viewModel.messages.count) { _ in
                    if let lastMessage = viewModel.messages.last {
                        withAnimation {
                            proxy.scrollTo(lastMessage.id, anchor: .bottom)
                        }
                    }
                }
            }

            // Input bar
            HStack {
                TextField("Message Lucid...", text: $messageText)
                    .textFieldStyle(RoundedBorderTextFieldStyle())
                    .disabled(viewModel.isLoading)

                Button(action: {
                    let text = messageText
                    messageText = ""
                    Task {
                        await viewModel.sendMessage(text)
                    }
                }) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 32))
                }
                .disabled(messageText.isEmpty || viewModel.isLoading)
            }
            .padding()
        }
        .navigationTitle(conversation?.title ?? "Chat")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button("Extract Facts") {
                        Task { await viewModel.extractFacts() }
                    }
                    Button("Generate Summary") {
                        Task { await viewModel.generateSummary() }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .task {
            await viewModel.startConversation(existingConversationId: conversation?.id)
        }
        .alert("Error", isPresented: .constant(viewModel.error != nil)) {
            Button("OK") { viewModel.error = nil }
        } message: {
            Text(viewModel.error ?? "")
        }
    }
}

struct MessageBubble: View {
    let message: Message

    var body: some View {
        HStack {
            if message.role == .user {
                Spacer()
            }

            VStack(alignment: message.role == .user ? .trailing : .leading) {
                Text(message.content)
                    .padding(12)
                    .background(message.role == .user ? Color.blue : Color.gray.opacity(0.2))
                    .foregroundColor(message.role == .user ? .white : .primary)
                    .cornerRadius(16)

                Text(message.createdAt, style: .time)
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }

            if message.role == .assistant {
                Spacer()
            }
        }
    }
}

// Views/ConversationListView.swift
import SwiftUI

struct ConversationListView: View {
    @StateObject private var viewModel = ConversationListViewModel()

    var body: some View {
        NavigationView {
            List {
                ForEach(viewModel.conversations) { conversation in
                    NavigationLink(destination: ChatView(conversation: conversation)) {
                        VStack(alignment: .leading) {
                            Text(conversation.title ?? "Untitled")
                                .font(.headline)
                            Text(conversation.createdAt, style: .date)
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                }
                .onDelete { indexSet in
                    for index in indexSet {
                        let conversation = viewModel.conversations[index]
                        Task {
                            await viewModel.deleteConversation(conversation)
                        }
                    }
                }
            }
            .navigationTitle("Conversations")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    NavigationLink(destination: ChatView(conversation: nil)) {
                        Image(systemName: "square.and.pencil")
                    }
                }
            }
            .task {
                await viewModel.loadConversations()
            }
            .refreshable {
                await viewModel.loadConversations()
            }
        }
    }
}

// Views/FactsView.swift
import SwiftUI

struct FactsView: View {
    @StateObject private var viewModel = FactsViewModel()

    var body: some View {
        NavigationView {
            List {
                ForEach(viewModel.facts) { fact in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(fact.content)
                                .font(.body)
                            Spacer()
                            Button {
                                Task {
                                    await viewModel.toggleFactActive(fact)
                                }
                            } label: {
                                Image(systemName: fact.isActive ? "checkmark.circle.fill" : "circle")
                                    .foregroundColor(fact.isActive ? .green : .gray)
                            }
                        }

                        HStack {
                            if let category = fact.category {
                                Text(category)
                                    .font(.caption)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 2)
                                    .background(Color.blue.opacity(0.2))
                                    .cornerRadius(4)
                            }

                            Text("\(Int(fact.confidence * 100))% confident")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
            .navigationTitle("What Lucid Knows")
            .task {
                await viewModel.loadFacts()
            }
            .refreshable {
                await viewModel.loadFacts()
            }
        }
    }
}

// Views/MainTabView.swift
import SwiftUI

struct MainTabView: View {
    var body: some View {
        TabView {
            ConversationListView()
                .tabItem {
                    Label("Chats", systemImage: "message")
                }

            FactsView()
                .tabItem {
                    Label("Facts", systemImage: "brain")
                }
        }
    }
}
```

---

## ✅ Implementation Checklist

### Step 1: Setup (Day 1)
- [ ] Copy all model files to your project
- [ ] Create `LucidAPIService.swift` with all API methods
- [ ] Create `UserDefaultsManager.swift` for local persistence
- [ ] Update your Railway URL in the service

### Step 2: Core Functionality (Day 2)
- [ ] Implement `ChatViewModel` with message persistence
- [ ] Update existing chat view to use new view model
- [ ] Test sending messages with conversation persistence
- [ ] Verify messages persist when navigating away

### Step 3: Conversation Management (Day 3)
- [ ] Create `ConversationListViewModel`
- [ ] Create `ConversationListView`
- [ ] Add navigation between conversation list and chat
- [ ] Test creating multiple conversations

### Step 4: Facts & Intelligence (Day 4)
- [ ] Create `FactsViewModel`
- [ ] Create `FactsView`
- [ ] Add automatic fact extraction (every 10 messages)
- [ ] Add manual "Extract Facts" button
- [ ] Test fact display and toggling

### Step 5: Summaries (Day 5)
- [ ] Add summary generation to chat view
- [ ] Display summaries in conversation list
- [ ] Test summary generation

### Step 6: Polish (Day 6)
- [ ] Add error handling UI
- [ ] Add loading states
- [ ] Add pull-to-refresh
- [ ] Add swipe-to-delete for conversations
- [ ] Test full flow end-to-end

---

## 🐛 Debugging Tips

### Common Issues

**1. "Error 0" or Network Failures**
- Check that Railway URL is correct
- Verify CORS is enabled (it is now!)
- Check Railway logs for actual error

**2. Conversations Not Persisting**
- Verify `conversation_id` is being saved to UserDefaults
- Check that you're passing saved ID to `/v1/chat`

**3. Messages Not Loading**
- Ensure you're calling `getMessages()` when opening a conversation
- Check the response format matches your `Message` model

**4. Facts Not Appearing**
- Remember: facts require manual extraction!
- Call `/v1/facts/extract` after conversations
- Check Railway logs to see if extraction succeeded

---

## 📞 Testing API Endpoints

Use this curl command to test endpoints:

```bash
# Test health
curl https://your-railway-url.up.railway.app/health

# Create user
curl -X POST https://your-railway-url.up.railway.app/v1/users \
  -H "Content-Type: application/json" \
  -d '{"external_id":"test-ios-123","name":"Test User"}'

# Create conversation
curl -X POST https://your-railway-url.up.railway.app/v1/conversations \
  -H "Content-Type: application/json" \
  -d '{"user_id":"YOUR_USER_ID","title":"Test Chat"}'

# Send message
curl -X POST https://your-railway-url.up.railway.app/v1/chat \
  -H "Content-Type: application/json" \
  -d '{
    "conversation_id":"YOUR_CONVERSATION_ID",
    "user_id":"YOUR_USER_ID",
    "message":"Hello Lucid!"
  }'
```

---

## 🎯 Success Criteria

You'll know the integration is complete when:

- ✅ Chats persist when you navigate away and come back
- ✅ You can see a list of all past conversations
- ✅ You can tap a conversation to see full message history
- ✅ Facts are being extracted and displayed
- ✅ Summaries are generated for long conversations
- ✅ No more "error 0" - proper error messages show
- ✅ The app feels stateful and intelligent

---

## 🚀 Ready to Build!

Start with **Phase 1 & 2** (Models and API Service), then incrementally add features.

The backend is ready and waiting - it just needs iOS to ask for the data!

Good luck! 🎉

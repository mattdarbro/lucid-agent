# Lucid Profile System - Quick Start Guide

## Overview

Lucid now supports **modular profiles** that let you enable/disable features based on your use case. Choose from pre-defined profiles or understand how to customize behavior.

## Available Profiles

### 1. **Full Lucid** (`full-lucid`)
Complete autonomous AI with all features enabled
- ✅ Emotional Intelligence
- ✅ Personality Tracking
- ✅ Memory System
- ✅ Autonomous Agents (4 daily: morning, midday, evening, night)
- ✅ Web Research
- ✅ Semantic Search

**Use Case:** Personal AI companion with full context and autonomy

---

### 2. **Decision Assistant** (`decision-assistant`)
Multi-agent decision making system
- ❌ Emotional Intelligence
- ❌ Personality Tracking
- ✅ Memory System (facts only)
- ✅ Autonomous Agents (on-demand: cost, risk, impact, values analyzers)
- ✅ Web Research (advanced depth)
- ✅ Semantic Search

**Use Case:** Analytical decision support, business choices, trade-off analysis

---

### 3. **News Digest** (`news-digest`)
Autonomous news monitoring and research
- ❌ Emotional Intelligence
- ❌ Personality Tracking
- ✅ Memory System
- ✅ Autonomous Agents (morning digest 7am, breaking news every 30min)
- ✅ Web Research (frequent, comprehensive)
- ✅ Semantic Search

**Use Case:** News aggregation, topic monitoring, research briefings

---

### 4. **Simple Chat** (`simple-chat`)
Basic conversational AI without autonomy
- ❌ Emotional Intelligence
- ❌ Personality Tracking
- ✅ Memory System (basic)
- ❌ Autonomous Agents
- ❌ Web Research
- ✅ Semantic Search

**Use Case:** Simple Q&A, basic assistance, minimal background processing

---

## API Endpoints

### List All Available Profiles
```http
GET /v1/profiles
```

**Response:**
```json
{
  "profiles": [
    {
      "id": "full-lucid",
      "name": "Full Lucid",
      "description": "Complete autonomous AI with emotional intelligence",
      "features": {
        "emotionalIntelligence": true,
        "personalityTracking": true,
        "memorySystem": true,
        "autonomousAgents": true,
        "webResearch": true,
        "semanticSearch": true
      }
    },
    // ... other profiles
  ]
}
```

---

### Get Profile Details
```http
GET /v1/profiles/:profileId
```

**Example:**
```bash
GET /v1/profiles/decision-assistant
```

**Response:**
```json
{
  "profile": {
    "id": "decision-assistant",
    "name": "Decision Assistant",
    "description": "Multi-agent decision making with research support",
    "features": { ... },
    "agents": {
      "enabled": true,
      "types": [
        {
          "type": "cost_analyzer",
          "schedule": "on-demand",
          "priority": 8
        },
        // ... other agents
      ]
    },
    "research": {
      "executionInterval": 180,
      "maxTasksPerCycle": 5,
      "searchDepth": "advanced"
    }
  }
}
```

---

### Get User's Active Profile
```http
GET /v1/profiles/user/:userId
```

**Example:**
```bash
GET /v1/profiles/user/550e8400-e29b-41d4-a716-446655440000
```

**Response:**
```json
{
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "profile": {
    "id": "full-lucid",
    "name": "Full Lucid",
    // ... full profile config
  }
}
```

**Note:** If no profile is set, defaults to `full-lucid`

---

### Set User's Profile
```http
PUT /v1/profiles/user/:userId
Content-Type: application/json

{
  "profile_id": "decision-assistant"
}
```

**Example:**
```bash
curl -X PUT http://localhost:3000/v1/profiles/user/550e8400-e29b-41d4-a716-446655440000 \
  -H "Content-Type: application/json" \
  -d '{"profile_id": "news-digest"}'
```

**Response:**
```json
{
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "profile": {
    "id": "news-digest",
    "name": "News Digest",
    // ... full profile config
  },
  "message": "Profile updated successfully"
}
```

---

## iOS Integration

### 1. On User Creation/Signup
```swift
// After creating a user, set their profile
func setupUserProfile(userId: String, profileId: String) async throws {
    let url = URL(string: "http://localhost:3000/v1/profiles/user/\(userId)")!
    var request = URLRequest(url: url)
    request.httpMethod = "PUT"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")

    let body = ["profile_id": profileId]
    request.httpBody = try JSONEncoder().encode(body)

    let (data, response) = try await URLSession.shared.data(for: request)

    guard let httpResponse = response as? HTTPURLResponse,
          httpResponse.statusCode == 200 else {
        throw ProfileError.updateFailed
    }

    print("Profile set to: \(profileId)")
}

// Usage:
// For decision-making app:
try await setupUserProfile(userId: newUser.id, profileId: "decision-assistant")

// For news app:
try await setupUserProfile(userId: newUser.id, profileId: "news-digest")

// For personal AI:
try await setupUserProfile(userId: newUser.id, profileId: "full-lucid")
```

---

### 2. Profile Selection UI
```swift
struct ProfileSelectionView: View {
    @State private var profiles: [LucidProfile] = []
    @State private var selectedProfile: String = "full-lucid"
    let userId: String

    var body: some View {
        List(profiles, id: \.id) { profile in
            VStack(alignment: .leading) {
                Text(profile.name)
                    .font(.headline)
                Text(profile.description)
                    .font(.caption)
                    .foregroundColor(.gray)
            }
            .onTapGesture {
                Task {
                    await setProfile(profileId: profile.id)
                }
            }
        }
        .onAppear {
            Task {
                await loadProfiles()
            }
        }
    }

    func loadProfiles() async {
        guard let url = URL(string: "http://localhost:3000/v1/profiles") else { return }

        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let response = try JSONDecoder().decode(ProfilesResponse.self, from: data)
            profiles = response.profiles
        } catch {
            print("Failed to load profiles: \(error)")
        }
    }

    func setProfile(profileId: String) async {
        // Use setupUserProfile function from above
        try? await setupUserProfile(userId: userId, profileId: profileId)
    }
}

struct ProfilesResponse: Codable {
    let profiles: [LucidProfile]
}

struct LucidProfile: Codable {
    let id: String
    let name: String
    let description: String
}
```

---

## Profile Behavior Details

### What Each Profile Controls

#### **Autonomous Agents**
- **Full Lucid:** 4 circadian agents (morning, midday, evening, night) run automatically
- **Decision Assistant:** Agents run on-demand when making decisions
- **News Digest:** News-focused agents run on schedule (morning + every 30min)
- **Simple Chat:** No agents run

#### **Web Research**
- **Full Lucid:** Moderate frequency (every 5 minutes), exploratory approach
- **Decision Assistant:** Advanced depth, analytical approach, on-demand
- **News Digest:** High frequency, comprehensive depth, breaking news focus
- **Simple Chat:** Disabled

#### **Chat Context**
- **Full Lucid:** Includes emotional context + autonomous thoughts + facts
- **Decision Assistant:** Facts only, no emotional context, analytical tone
- **News Digest:** Autonomous insights (news findings) + facts, informative tone
- **Simple Chat:** Basic facts only

#### **Temperature Settings**
- **Full Lucid:** 0.7 (balanced)
- **Decision Assistant:** 0.3 (analytical, focused)
- **News Digest:** 0.5 (informative, clear)
- **Simple Chat:** 0.7 (conversational)

---

## Database Schema

The profile preference is stored in the `user_profiles` table:

```sql
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) NOT NULL UNIQUE,
  profile_id VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Migration:** If upgrading existing database, run:
```bash
psql -d your_database -f schema.sql
# Or manually run the CREATE TABLE statement above
```

---

## Testing

### 1. List profiles
```bash
curl http://localhost:3000/v1/profiles
```

### 2. Create test user and set profile
```bash
# Create user (assuming you have user creation endpoint)
USER_ID="550e8400-e29b-41d4-a716-446655440000"

# Set to decision assistant
curl -X PUT http://localhost:3000/v1/profiles/user/$USER_ID \
  -H "Content-Type: application/json" \
  -d '{"profile_id": "decision-assistant"}'

# Verify
curl http://localhost:3000/v1/profiles/user/$USER_ID
```

### 3. Test chat behavior
```bash
# Chat will now use decision-assistant settings:
# - No emotional context
# - Analytical temperature (0.3)
# - No autonomous thoughts in context
curl -X POST http://localhost:3000/v1/chat \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "'$USER_ID'",
    "conversation_id": "...",
    "message": "Help me decide whether to launch this feature"
  }'
```

---

## Common Use Cases

### Decision-Making App
```bash
# On user signup:
PUT /v1/profiles/user/{userId}
{ "profile_id": "decision-assistant" }

# User behavior:
# - No background agents running (saves resources)
# - When user starts a decision, trigger agents manually
# - Research tasks created on-demand
# - Analytical, focused responses
```

### News Aggregation App
```bash
# On user signup:
PUT /v1/profiles/user/{userId}
{ "profile_id": "news-digest" }

# User behavior:
# - Morning digest at 7am
# - Breaking news checks every 30min
# - Research tasks auto-created for trending topics
# - Autonomous thoughts shared when user opens app
```

### Personal AI Companion App
```bash
# On user signup:
PUT /v1/profiles/user/{userId}
{ "profile_id": "full-lucid" }

# User behavior:
# - Full emotional intelligence
# - Personality tracking over time
# - 4 daily reflection/thinking sessions
# - Research on curiosities
# - Rich, context-aware conversations
```

---

## Key Benefits

✅ **Single Backend, Multiple Apps:** One Lucid deployment serves different app types
✅ **Resource Optimization:** Only run features you need
✅ **User Control:** Let users customize their experience
✅ **Easy Switching:** Change profiles without data loss
✅ **Backward Compatible:** Defaults to full-lucid if not set

---

## Support

- Profile definitions: `/src/types/profiles.ts`
- Profile service: `/src/services/profile.service.ts`
- API routes: `/src/routes/profiles.ts`
- Full documentation: See main README.md

**Questions?** Check the code comments in the profile type definitions for detailed configuration options.

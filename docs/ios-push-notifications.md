# iOS Push Notifications & Library Comments — Integration Guide

## Architecture Overview

Lucid communicates with the iOS app through two channels:

- **The Room** — continuous conversation (existing chat system)
- **The Library** — artifacts with comments (deep work + focused discussion)
- **Push Notifications** — the doorbell for both

Push notifications are sent via APNs (Apple Push Notification service). The backend uses HTTP/2 + JWT token-based auth — no third-party dependencies.

---

## 1. APNs Setup

### Backend Environment Variables

```env
APNS_KEY_ID=ABC123DEFG        # From Apple Developer Portal > Keys
APNS_TEAM_ID=TEAMID1234       # Your Apple Developer Team ID
APNS_KEY_PATH=./AuthKey.p8    # Path to the .p8 key file
APNS_BUNDLE_ID=com.yourco.Lucid  # Your app's bundle identifier
```

### Apple Developer Portal Setup

1. Go to **Certificates, Identifiers & Profiles > Keys**
2. Create a new key with **Apple Push Notifications service (APNs)** enabled
3. Download the `.p8` file — you only get one download
4. Note the **Key ID** (10-character string)
5. Your **Team ID** is in Membership Details

### Environment Switching

- `NODE_ENV=production` → sends to `api.push.apple.com`
- Any other value → sends to `api.sandbox.push.apple.com`

---

## 2. Device Registration

Register the device push token when the app starts or when the token refreshes.

### Register Device + Token

```
POST /v1/devices/register
Content-Type: application/json

{
  "user_id": "uuid",
  "device_id": "unique-device-identifier",
  "device_name": "Matt's iPhone",
  "device_type": "iphone",
  "push_token": "apns-device-token-hex-string"
}
```

The backend stores tokens in `user_devices` and sends to ALL active devices for a user.

### Update Token on Refresh

Call the same endpoint — it upserts based on `device_id`.

---

## 3. Push Notification Payload Format

All notifications follow this structure:

```json
{
  "aps": {
    "alert": {
      "title": "A seed grew",
      "body": "The connection between sleep quality and..."
    },
    "sound": "default",
    "mutable-content": 1
  },
  "lucid": {
    "type": "seed_grown",
    "title": "Sleep-Anxiety Feedback Loop",
    "entryId": "uuid-of-library-entry"
  }
}
```

Custom data is always under the `lucid` key at the top level of the payload.

### Notification Types

| `lucid.type` | Category | Thread ID | Description |
|---|---|---|---|
| `seed_grown` | `LUCID_SEED` | `seeds` | A seed grew into a Library entry |
| `seed_briefing` | `LUCID_BRIEFING` | `seeds` | Morning seed briefing |
| `weekly_reflection` | `LUCID_BRIEFING` | `seeds` | Weekly seed reflection |
| `research_complete` | `LUCID_RESEARCH` | `research` | Research task finished |
| `investment_recommendation` | `LUCID_INVESTMENT` | `investments` | Investment idea |
| `spending_proposal` | `LUCID_SPENDING` | `spending` | Ability spending proposal |
| `health_alert` | `LUCID_HEALTH` | `health` | Health metric alert (e.g., elevated BP) |
| `self_review` | `LUCID_SYSTEM` | `system` | Self-review results |
| `library_entry` | `LUCID_LIBRARY` | `library` | Generic library entry created |
| `library_comment` | `LUCID_COMMENT` | `library-{entryId}` | Lucid commented on a Library entry |
| `thought_notification` | `LUCID_THOUGHT` | `thoughts` | Queued thought notification |

### Deep Linking

Use `lucid.type` to determine where to navigate:

- `library_entry`, `seed_grown`, `research_complete`, `investment_recommendation`, `spending_proposal`, `health_alert` → Open the Library entry (use `lucid.entryId`)
- `library_comment` → Open the Library entry and scroll to comments (use `lucid.entryId` + `lucid.commentId`)
- `seed_briefing`, `weekly_reflection` → Open the Library (latest briefing entry)
- `thought_notification` → Open the thought notification (use `lucid.notificationId`)

---

## 4. Library Comments API

Comments are short, tweet-like reactions on Library entries. Both Matt and Lucid can comment.

### List Comments

```
GET /v1/library/{entryId}/comments?user_id={userId}&limit=50&offset=0
```

Response:
```json
{
  "comments": [
    {
      "id": "uuid",
      "library_entry_id": "uuid",
      "user_id": "uuid",
      "author_type": "user",
      "content": "That BP reading was right after a run",
      "metadata": {},
      "created_at": "2026-02-20T15:30:00.000Z",
      "updated_at": "2026-02-20T15:30:00.000Z"
    },
    {
      "id": "uuid",
      "library_entry_id": "uuid",
      "user_id": "uuid",
      "author_type": "lucid",
      "content": "Good to know — I'll factor exercise timing into future readings",
      "metadata": {},
      "created_at": "2026-02-20T15:35:00.000Z",
      "updated_at": "2026-02-20T15:35:00.000Z"
    }
  ],
  "total": 2,
  "limit": 50,
  "offset": 0
}
```

### Add a Comment

```
POST /v1/library/{entryId}/comments
Content-Type: application/json

{
  "user_id": "uuid",
  "content": "That BP reading was right after a run",
  "author_type": "user"
}
```

- `author_type`: `"user"` for Matt, `"lucid"` for Lucid
- Max 1000 characters
- When `author_type` is `"lucid"`, a push notification is automatically sent

Response:
```json
{
  "comment": {
    "id": "uuid",
    "library_entry_id": "uuid",
    "user_id": "uuid",
    "author_type": "user",
    "content": "That BP reading was right after a run",
    "metadata": {},
    "created_at": "2026-02-20T15:30:00.000Z",
    "updated_at": "2026-02-20T15:30:00.000Z"
  }
}
```

### Delete a Comment

```
DELETE /v1/library/{entryId}/comments/{commentId}?user_id={userId}
```

Returns `204 No Content` on success.

### Get Entry with Comments

When fetching a single Library entry, comments are included automatically:

```
GET /v1/library/{entryId}?user_id={userId}
```

Response includes a `comments` array on the entry object.

### Comment Count on List

When listing entries via `GET /v1/library`, each entry now includes a `comment_count` integer field so the UI can show a badge without fetching all comments.

---

## 5. iOS Implementation Notes

### UNNotificationCategory Registration

Register notification categories on app launch for actionable notifications:

```swift
let categories: [UNNotificationCategory] = [
    "LUCID_SEED", "LUCID_BRIEFING", "LUCID_RESEARCH",
    "LUCID_INVESTMENT", "LUCID_SPENDING", "LUCID_HEALTH",
    "LUCID_SYSTEM", "LUCID_LIBRARY", "LUCID_COMMENT",
    "LUCID_THOUGHT"
].map { identifier in
    UNNotificationCategory(
        identifier: identifier,
        actions: [],  // Add reply actions here if desired
        intentIdentifiers: []
    )
}
UNUserNotificationCenter.current().setNotificationCategories(Set(categories))
```

### Handling Notification Tap

```swift
func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
) {
    let userInfo = response.notification.request.content.userInfo
    guard let lucid = userInfo["lucid"] as? [String: Any],
          let type = lucid["type"] as? String else {
        completionHandler()
        return
    }

    switch type {
    case "library_entry", "seed_grown", "research_complete",
         "investment_recommendation", "spending_proposal",
         "health_alert", "library_comment":
        if let entryId = lucid["entryId"] as? String {
            // Navigate to Library entry detail view
            navigateToLibraryEntry(entryId)
        }
    case "thought_notification":
        if let notificationId = lucid["notificationId"] as? String {
            // Navigate to thought notification view
            navigateToThoughtNotification(notificationId)
        }
    default:
        // Open app to default screen
        break
    }

    completionHandler()
}
```

### Thread Grouping

The backend sends `apns-collapse-id` headers and `thread-id` in payloads. iOS will automatically group notifications by thread in Notification Center:

- All seed notifications grouped together
- All research notifications grouped together
- Comments on the same Library entry grouped together (`library-{entryId}`)

---

## 6. Notification Dispatch (Queued Thought Notifications)

The `thought_notifications` table is a scheduling queue. A background cron job runs every 3 minutes to:

1. Find pending notifications
2. Check rate limits (max 5 per user per hour)
3. Send via APNs
4. Mark as sent

The iOS app can respond to thought notifications:

```
POST /v1/thought-notifications/{id}/respond
Content-Type: application/json

{
  "response_text": "I'm feeling pretty good actually",
  "self_reported_energy": 7,
  "self_reported_mood": 8,
  "self_reported_focus": 6
}
```

---

## 7. Testing

### Verify APNs Config

Check server logs on startup for:
```
APNs service initialized { keyId: '...', teamId: '...', bundleId: '...', environment: 'sandbox' }
```

If you see `APNs service disabled`, check your env vars.

### Send a Test Notification

Trigger any autonomous loop manually to generate a library entry + push:

```
POST /v1/admin/trigger/morning-briefing
Content-Type: application/json

{ "user_id": "your-uuid" }
```

### Sandbox vs Production

- Development builds → sandbox APNs (`api.sandbox.push.apple.com`)
- TestFlight / App Store builds → production APNs (`api.push.apple.com`)
- Make sure `NODE_ENV` matches your build target

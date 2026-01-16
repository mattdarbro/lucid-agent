# Check-In System - How It Works

## Overview

When a user creates a multi-day task, the backend automatically generates **check-in notifications** that the iOS app can fetch and display to the user.

## Backend Flow

### 1. Task Creation
When iOS creates a task via `POST /v1/multi-day-tasks`:
```json
{
  "user_id": "uuid",
  "title": "Should I expand my dental practice?",
  "check_in_times": ["morning", "evening"],
  "duration_days": 5
}
```

The backend automatically:
1. Creates the task
2. Creates a conversation for the task
3. **Generates check-in notifications** for each check-in time across all days

For example, with `check_in_times: ["morning", "evening"]` and `duration_days: 5`, it creates:
- Day 1 morning notification (9:00 AM)
- Day 1 evening notification (7:00 PM)
- Day 2 morning notification (9:00 AM)
- Day 2 evening notification (7:00 PM)
- ... and so on for 5 days
- **Total: 10 notifications**

### 2. Notification Schedule
Default times for each period:
- **Morning**: 9:00 AM
- **Afternoon**: 2:00 PM
- **Evening**: 7:00 PM
- **Late Night**: 10:00 PM

## iOS Integration

### Step 1: Poll for Pending Notifications

The iOS app should periodically check for pending notifications:

```swift
GET /v1/users/:user_id/thought-notifications/pending?limit=10
```

**Response:**
```json
{
  "notifications": [
    {
      "id": "notification-uuid",
      "user_id": "user-uuid",
      "research_task_id": "task-uuid",
      "question": "Good morning! Let's check in on \"Should I expand my dental practice?\". How are you thinking about this today?",
      "context": "Day 1 of 5: morning check-in for \"Should I expand my dental practice?\"",
      "preferred_time_of_day": "morning",
      "priority": 0.7,
      "status": "pending",
      "created_at": "2025-11-19T09:00:00Z"
    }
  ],
  "count": 1
}
```

### Step 2: Display Check-In to User

When you have a pending notification:
1. Show it in the app (e.g., banner, notification, or dedicated check-ins screen)
2. Display the `question` text
3. Let the user type their response

### Step 3: Submit User's Response

When the user responds:

```swift
POST /v1/thought-notifications/:notification_id/respond
```

**Request Body:**
```json
{
  "response_text": "I'm feeling more confident about it this morning. I think the numbers support expansion.",
  "self_reported_energy": 4,
  "self_reported_mood": 4,
  "self_reported_focus": 3
}
```

**Response:**
```json
{
  "notification": {
    "id": "notification-uuid",
    "status": "responded",
    "responded_at": "2025-11-19T09:15:23Z",
    ...
  },
  "message": "Response recorded successfully"
}
```

### Step 4: Record Check-In on Task

After the user responds to a notification, you should also record it as a check-in on the task:

```swift
POST /v1/multi-day-tasks/:task_id/check-ins
```

**Request Body:**
```json
{
  "notification_id": "notification-uuid",
  "time_of_day": "morning",
  "question_asked": "Good morning! Let's check in on...",
  "question_type": "reflective",
  "response": "I'm feeling more confident about it...",
  "self_reported_energy": 4,
  "self_reported_mood": 4,
  "self_reported_focus": 3,
  "insights": ["User is feeling confident", "Numbers support expansion"]
}
```

This creates a permanent record of the check-in on the task itself.

## Recommended iOS Implementation

### Option A: Polling (Simple)
Poll for pending notifications every time the user opens the app or navigates to the tasks screen:

```swift
func checkForPendingNotifications() async {
    let notifications = try await apiClient.get("/v1/users/\(userId)/thought-notifications/pending?limit=10")

    if !notifications.isEmpty {
        // Show badge or banner
        showCheckInBanner(notifications.first!)
    }
}
```

### Option B: Push Notifications (Advanced)
1. Backend sends iOS push notification at scheduled time
2. User taps notification → opens app
3. App fetches pending notifications
4. Display check-in UI

### Option C: Scheduled Local Notifications
1. When task is created, fetch all notifications
2. Schedule local iOS notifications for each check-in time
3. When user taps local notification, fetch the pending notification from backend
4. Display check-in UI

## Testing Check-Ins

### 1. Create a test task:
```bash
curl -X POST http://localhost:4000/v1/multi-day-tasks \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "your-user-id",
    "title": "Test task for check-ins",
    "check_in_times": ["morning", "evening"],
    "duration_days": 3
  }'
```

### 2. Check notifications were created:
```bash
curl http://localhost:4000/v1/users/your-user-id/thought-notifications/pending
```

You should see 6 notifications (morning + evening × 3 days).

### 3. Respond to a notification:
```bash
curl -X POST http://localhost:4000/v1/thought-notifications/notification-id/respond \
  -H "Content-Type: application/json" \
  -d '{
    "response_text": "Test response",
    "self_reported_energy": 3,
    "self_reported_mood": 4,
    "self_reported_focus": 3
  }'
```

### 4. View check-ins on the task:
```bash
curl http://localhost:4000/v1/multi-day-tasks/task-id
```

The `check_ins` array should contain your response.

## Notes

- Notifications are automatically created when a task is created
- Past check-in times are skipped (e.g., if you create a task at noon, morning check-ins for today are skipped)
- Notifications expire after 24 hours
- Priority is set to 0.7 for task check-ins (high priority)
- Each notification is linked to its task via `research_task_id`

## Troubleshooting

**No notifications showing up?**
- Check if the task was created successfully
- Verify the user_id matches
- Check if notifications were created in the database
- Ensure check-in times haven't all passed

**Notifications not in order?**
- The `/pending` endpoint returns notifications ordered by priority (DESC) then created_at (ASC)
- Filter by `research_task_id` if you want notifications for a specific task

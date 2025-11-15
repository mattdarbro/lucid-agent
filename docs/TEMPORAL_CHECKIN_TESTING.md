# Temporal Check-In System - Testing Guide

## 🎯 Quick Start: Test Your First Notification

This guide shows you how to test the thought notification system using curl (simple copy-paste commands).

---

## Step 1: Run the Database Migration

First, we need to create the tables. Railway should have auto-deployed the new code, but you need to run the migration.

### Option A: Using Railway CLI

```bash
# Connect to your Railway database
railway connect postgres

# Then run the migration
\i migrations/008_temporal_checkin_system.sql

# Exit
\q
```

### Option B: Using Direct psql Connection

Get your database URL from Railway dashboard, then:

```bash
# Replace with your actual Railway database URL
psql "postgresql://user:pass@host:port/database" -f migrations/008_temporal_checkin_system.sql
```

### Option C: Manual SQL (if above don't work)

Copy the contents of `migrations/008_temporal_checkin_system.sql` and paste it into Railway's database console.

---

## Step 2: Get Your User ID

You need your user ID to create notifications. If you've used the iOS app, you already have one.

```bash
# Replace with your Railway URL
curl https://lucid-agent-production.up.railway.app/v1/users
```

Look for your user in the response and copy the `id` (UUID format).

If you don't have a user yet, create one:

```bash
curl -X POST https://lucid-agent-production.up.railway.app/v1/users \
  -H "Content-Type: application/json" \
  -d '{
    "external_id": "test-user-001",
    "name": "Test User",
    "timezone": "America/Chicago"
  }'
```

Copy the `id` from the response.

---

## Step 3: Create Your First Notification

Now let's create a notification where Lucid wants to ask you something!

**Replace `YOUR_USER_ID` with the UUID you got above**

```bash
curl -X POST https://lucid-agent-production.up.railway.app/v1/thought-notifications \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "YOUR_USER_ID",
    "question": "I'\''ve been thinking about your work-life balance. What would make your ideal workday look like?",
    "context": "Based on our previous conversations about dentistry and AI research, I'\''m curious about how you envision balancing both.",
    "preferred_time_of_day": "evening",
    "preferred_cognitive_state": "reflective",
    "priority": 0.8
  }'
```

**You should get a response like:**

```json
{
  "id": "uuid-of-notification",
  "user_id": "your-user-id",
  "question": "I've been thinking about your work-life balance...",
  "status": "pending",
  "priority": 0.8,
  "preferred_time_of_day": "evening",
  "created_at": "2024-01-15T...",
  ...
}
```

**Copy the notification `id` for the next steps!**

---

## Step 4: Check Pending Notifications

See what Lucid wants to talk about:

```bash
curl https://lucid-agent-production.up.railway.app/v1/users/YOUR_USER_ID/thought-notifications/pending
```

You should see your notification in the list!

---

## Step 5: Respond to the Notification

Now let's simulate you responding to Lucid's question:

**Replace `NOTIFICATION_ID` with the ID from Step 3**

```bash
curl -X POST https://lucid-agent-production.up.railway.app/v1/thought-notifications/NOTIFICATION_ID/respond \
  -H "Content-Type: application/json" \
  -d '{
    "response_text": "Ideal workday would start with clinical work in the morning when I'\''m most focused, then afternoons for research and creative thinking about AI applications. Evening for family time.",
    "self_reported_energy": 4,
    "self_reported_mood": 5,
    "self_reported_focus": 3
  }'
```

**You should get:**

```json
{
  "notification": {
    "id": "...",
    "status": "responded",
    "response_text": "Ideal workday would start with...",
    "responded_at": "2024-01-15T...",
    "response_metadata": {
      "self_reported_energy": 4,
      "self_reported_mood": 5,
      "self_reported_focus": 3
    }
  },
  "message": "Response recorded successfully"
}
```

---

## Step 6: View All Your Notifications

See your notification history:

```bash
# All notifications
curl https://lucid-agent-production.up.railway.app/v1/users/YOUR_USER_ID/thought-notifications

# Only responded ones
curl "https://lucid-agent-production.up.railway.app/v1/users/YOUR_USER_ID/thought-notifications?status=responded"

# Only pending ones
curl "https://lucid-agent-production.up.railway.app/v1/users/YOUR_USER_ID/thought-notifications?status=pending"
```

---

## 🎓 Complete API Reference

### Create Notification

```bash
curl -X POST https://your-railway-url/v1/thought-notifications \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "uuid",
    "question": "What Lucid wants to ask",
    "context": "Background info (optional)",
    "preferred_time_of_day": "morning|afternoon|evening|late_night|any",
    "preferred_cognitive_state": "analytical|creative|reflective|philosophical|emotional|any",
    "priority": 0.8,
    "expires_at": "2024-01-20T00:00:00Z"
  }'
```

### Get Specific Notification

```bash
curl https://your-railway-url/v1/thought-notifications/NOTIFICATION_ID
```

### List All Notifications for User

```bash
curl https://your-railway-url/v1/users/USER_ID/thought-notifications
```

### Get Pending Notifications (Prioritized)

```bash
curl https://your-railway-url/v1/users/USER_ID/thought-notifications/pending
```

### Respond to Notification

```bash
curl -X POST https://your-railway-url/v1/thought-notifications/NOTIFICATION_ID/respond \
  -H "Content-Type: application/json" \
  -d '{
    "response_text": "Your answer here",
    "self_reported_energy": 4,
    "self_reported_mood": 5,
    "self_reported_focus": 3
  }'
```

### Skip Notification

```bash
curl -X POST https://your-railway-url/v1/thought-notifications/NOTIFICATION_ID/skip
```

### Mark as Sent (for notification system use)

```bash
curl -X POST https://your-railway-url/v1/thought-notifications/NOTIFICATION_ID/send
```

### Update Notification

```bash
curl -X PATCH https://your-railway-url/v1/thought-notifications/NOTIFICATION_ID \
  -H "Content-Type: application/json" \
  -d '{
    "priority": 0.9,
    "status": "pending"
  }'
```

### Delete Notification

```bash
curl -X DELETE https://your-railway-url/v1/thought-notifications/NOTIFICATION_ID
```

---

## 🧪 Testing Scenarios

### Scenario 1: Morning Analytical Check-In

```bash
curl -X POST https://your-railway-url/v1/thought-notifications \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "YOUR_USER_ID",
    "question": "Looking at your practice expansion plans, what are the key financial metrics you'\''re tracking?",
    "preferred_time_of_day": "morning",
    "preferred_cognitive_state": "analytical",
    "priority": 0.7
  }'
```

### Scenario 2: Evening Reflective Check-In

```bash
curl -X POST https://your-railway-url/v1/thought-notifications \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "YOUR_USER_ID",
    "question": "How are you feeling about the career decision we'\''ve been discussing?",
    "preferred_time_of_day": "evening",
    "preferred_cognitive_state": "reflective",
    "priority": 0.6
  }'
```

### Scenario 3: Urgent Question (Any Time)

```bash
curl -X POST https://your-railway-url/v1/thought-notifications \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "YOUR_USER_ID",
    "question": "I just found a research paper that might change our approach. Want to discuss?",
    "preferred_time_of_day": "any",
    "priority": 0.95
  }'
```

---

## ✅ What's Working Now

After completing these tests, you have:

1. ✅ **Database tables created** for thought notifications
2. ✅ **API working** - can create, read, update, delete notifications
3. ✅ **Response capture working** - stores your answers with mood/energy/focus
4. ✅ **Priority queueing** - notifications ordered by importance
5. ✅ **Time preferences** - can specify when to ask
6. ✅ **State preferences** - can specify cognitive state

## 🚧 What's Next

1. **State Detection Service** - Analyze responses to detect cognitive state
2. **Check-In Preferences** - User settings for when to receive notifications
3. **Multi-Day Research Tasks** - Track thinking across multiple days
4. **Scheduler Service** - Automatically send notifications at optimal times
5. **iOS Integration** - Push notifications and UI

---

## 🐛 Troubleshooting

### Migration Fails

- Make sure you're connected to the right database
- Check Railway logs for errors
- Try running each CREATE TABLE statement separately

### 404 Not Found

- Wait 2-3 minutes for Railway to redeploy after pushing code
- Check Railway logs to see if server started successfully
- Verify the URL is correct

### Invalid UUID Format

- UUIDs look like: `550e8400-e29b-41d4-a716-446655440000`
- Make sure you're copying the full ID from the API response
- Don't include quotes or extra characters

### Can't Find User

- List all users: `curl https://your-url/v1/users`
- Create a new user if needed (see Step 2)
- Make sure you're using the correct user_id

---

## 💡 Tips

**Formatting JSON in curl:**
- Use single quotes around the data
- Escape single quotes inside strings with `'\''`
- Or use a file: `curl ... -d @request.json`

**Saving Responses:**
```bash
# Save to file
curl ... > response.json

# Pretty print with jq (if installed)
curl ... | jq '.'
```

**Testing Different Times of Day:**
Create multiple notifications with different `preferred_time_of_day` values to see how they'd be prioritized throughout the day.

---

**Ready to test?** Start with Step 1 and work your way through! 🚀

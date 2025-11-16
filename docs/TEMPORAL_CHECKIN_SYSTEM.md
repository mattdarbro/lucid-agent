# Temporal Check-In System: Design Document

## Vision

Enable Lucid to engage in **multi-day collaborative thinking** with users by:
1. Thinking continuously in the background
2. Strategically checking in at different times of day
3. Exploiting circadian cognitive diversity (morning analytical → evening creative)
4. Building 4D understanding (spatial + temporal) of problems
5. Detecting user's cognitive state from interaction patterns

## Research Hypothesis

**Human cognitive state varies throughout the day**, and by engaging users at different times:
- We capture different perspectives on the same problem
- We access state-dependent memories and insights
- We build richer understanding than single-session interactions
- We can detect cognitive states through language/behavior patterns

## Architecture

### Core Components

```
┌─────────────────────────────────────────────────────────┐
│  1. Autonomous Thought System (existing)                │
│     - Generates insights based on time_of_day           │
│     - Creates questions/observations for user           │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼ Creates
┌─────────────────────────────────────────────────────────┐
│  2. Thought Notification Queue (NEW)                    │
│     - Stores things Lucid wants to ask user             │
│     - Tagged with priority, preferred_time, topic       │
│     - Waits for optimal moment to deliver               │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼ Scheduled by
┌─────────────────────────────────────────────────────────┐
│  3. Check-In Scheduler (NEW)                           │
│     - User preferences: when, how often, which topics   │
│     - Sends notifications at preferred times            │
│     - Respects user boundaries (no spam)                │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼ Triggers
┌─────────────────────────────────────────────────────────┐
│  4. iOS Push Notification                               │
│     - "💭 I've been thinking about [topic]..."         │
│     - User opens app when convenient                    │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼ User responds
┌─────────────────────────────────────────────────────────┐
│  5. State Detection & Logging (NEW - RESEARCH)         │
│     - Analyzes response: language, speed, complexity    │
│     - Detects cognitive state (analytical/creative/etc) │
│     - Builds temporal personality profile               │
│     - Stores for research analysis                      │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼ Contributes to
┌─────────────────────────────────────────────────────────┐
│  6. Multi-Day Research Task (NEW)                      │
│     - Tracks thinking across multiple days              │
│     - Synthesizes all temporal perspectives             │
│     - Produces final insight                            │
└─────────────────────────────────────────────────────────┘
```

---

## Database Schema

### 1. Thought Notifications

**Purpose**: Queue of things Lucid wants to discuss with user

```sql
CREATE TABLE thought_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thought_id UUID REFERENCES autonomous_thoughts(id) ON DELETE SET NULL,
  research_task_id UUID REFERENCES multi_day_research_tasks(id) ON DELETE SET NULL,

  -- What Lucid wants to say
  question TEXT NOT NULL,                    -- e.g., "I've been thinking about your startup idea..."
  context TEXT,                              -- Background context for the question

  -- When to ask
  preferred_time_of_day TEXT,                -- 'morning', 'afternoon', 'evening', 'late_night', 'any'
  preferred_cognitive_state TEXT,            -- 'analytical', 'creative', 'reflective', 'any'

  -- Priority & scheduling
  priority DECIMAL(3,2) DEFAULT 0.5,         -- 0.0 (low) to 1.0 (urgent)
  expires_at TIMESTAMP,                      -- Don't ask after this time (becomes irrelevant)

  -- Delivery tracking
  status TEXT DEFAULT 'pending',             -- 'pending', 'sent', 'responded', 'expired', 'skipped'
  sent_at TIMESTAMP,
  responded_at TIMESTAMP,

  -- Response data
  response_text TEXT,                        -- User's response
  response_metadata JSONB,                   -- Detected state, sentiment, etc.

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Indexes
  INDEX idx_thought_notifications_user_status (user_id, status),
  INDEX idx_thought_notifications_sent_at (sent_at),
  INDEX idx_thought_notifications_priority (priority DESC)
);
```

### 2. Check-In Preferences

**Purpose**: User preferences for when/how to receive check-ins

```sql
CREATE TABLE check_in_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

  -- Global settings
  enabled BOOLEAN DEFAULT false,             -- Master on/off switch
  frequency TEXT DEFAULT 'daily',            -- 'multiple_daily', 'daily', 'every_2_days', 'weekly'

  -- Time preferences
  morning_enabled BOOLEAN DEFAULT true,      -- 6am-11am
  afternoon_enabled BOOLEAN DEFAULT false,   -- 12pm-4pm
  evening_enabled BOOLEAN DEFAULT true,      -- 5pm-9pm
  late_night_enabled BOOLEAN DEFAULT false,  -- 10pm-2am

  -- Specific time windows (user's local timezone)
  morning_start TIME DEFAULT '07:00',
  morning_end TIME DEFAULT '10:00',
  afternoon_start TIME DEFAULT '13:00',
  afternoon_end TIME DEFAULT '16:00',
  evening_start TIME DEFAULT '18:00',
  evening_end TIME DEFAULT '21:00',
  late_night_start TIME DEFAULT '22:00',
  late_night_end TIME DEFAULT '01:00',

  -- Quiet hours
  do_not_disturb_start TIME,                 -- e.g., 22:00
  do_not_disturb_end TIME,                   -- e.g., 07:00

  -- Topic filters
  topics JSONB DEFAULT '[]'::jsonb,          -- ["career", "relationships", "creative_projects"]
  min_priority DECIMAL(3,2) DEFAULT 0.3,     -- Only notify if priority >= this

  -- Rate limiting
  max_per_day INTEGER DEFAULT 2,             -- Max notifications per day
  min_hours_between INTEGER DEFAULT 4,       -- Min hours between notifications

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 3. Multi-Day Research Tasks

**Purpose**: Track long-running thinking that spans multiple days

```sql
CREATE TABLE multi_day_research_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Task definition
  title TEXT NOT NULL,                       -- e.g., "Career change decision"
  description TEXT,                          -- Initial prompt/question
  topic_category TEXT,                       -- 'career', 'relationships', 'creative', etc.

  -- Status
  status TEXT DEFAULT 'active',              -- 'active', 'paused', 'completed', 'abandoned'

  -- Timeline
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  target_completion_date DATE,               -- Optional target
  completed_at TIMESTAMP,

  -- Check-in tracking
  check_ins JSONB DEFAULT '[]'::jsonb,       -- Array of check-in records
  /*
  Example check_ins structure:
  [
    {
      "time_of_day": "morning",
      "scheduled_for": "2024-01-15T09:00:00Z",
      "completed_at": "2024-01-15T09:23:00Z",
      "notification_id": "uuid",
      "insights": ["User mentioned wanting stability", "Concerns about finances"],
      "detected_state": "analytical"
    },
    {
      "time_of_day": "evening",
      "scheduled_for": "2024-01-15T19:00:00Z",
      "completed_at": null,
      "notification_id": "uuid",
      "insights": [],
      "detected_state": null
    }
  ]
  */

  -- Synthesis
  final_synthesis TEXT,                      -- Final insights after all check-ins
  synthesis_created_at TIMESTAMP,

  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,        -- Additional research data

  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_multi_day_tasks_user_status (user_id, status),
  INDEX idx_multi_day_tasks_created (created_at DESC)
);
```

### 4. Temporal State Observations

**Purpose**: Research data - track user's cognitive state at different times

```sql
CREATE TABLE temporal_state_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- When
  observed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  time_of_day TEXT NOT NULL,                 -- 'morning', 'afternoon', 'evening', 'late_night'
  day_of_week INTEGER,                       -- 0-6 (Sunday-Saturday)

  -- Context
  notification_id UUID REFERENCES thought_notifications(id),
  research_task_id UUID REFERENCES multi_day_research_tasks(id),
  conversation_id UUID REFERENCES conversations(id),

  -- Detected state
  cognitive_state TEXT,                      -- 'analytical', 'creative', 'reflective', 'philosophical', 'emotional'
  confidence DECIMAL(3,2),                   -- How confident in the detection (0.0-1.0)

  -- Observable signals
  response_time_seconds INTEGER,             -- How fast did they respond
  message_length INTEGER,                    -- Word count
  sentiment_score DECIMAL(3,2),              -- -1.0 (negative) to 1.0 (positive)
  complexity_score DECIMAL(3,2),             -- Language complexity (0.0-1.0)

  -- Language features
  language_features JSONB DEFAULT '{}'::jsonb,
  /*
  Example:
  {
    "avg_sentence_length": 12.3,
    "unique_words": 45,
    "emotional_words": 8,
    "abstract_words": 12,
    "concrete_words": 33,
    "question_count": 2,
    "exclamation_count": 0
  }
  */

  -- Big 5 state expression (how traits express in this state)
  big5_state_expression JSONB,
  /*
  Example:
  {
    "openness": 0.8,        // High openness in this state
    "conscientiousness": 0.3, // Low conscientiousness (creative mode)
    "extraversion": 0.5,
    "agreeableness": 0.7,
    "neuroticism": 0.2
  }
  */

  -- Self-reported (if user answered "How are you feeling?")
  self_reported_energy INTEGER,              -- 1-5 scale
  self_reported_mood INTEGER,                -- 1-5 scale
  self_reported_focus INTEGER,               -- 1-5 scale

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_temporal_observations_user_time (user_id, time_of_day),
  INDEX idx_temporal_observations_state (cognitive_state),
  INDEX idx_temporal_observations_created (created_at DESC)
);
```

### 5. Check-In Schedule Log

**Purpose**: Track when notifications were sent (for rate limiting and analysis)

```sql
CREATE TABLE check_in_schedule_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_id UUID REFERENCES thought_notifications(id),

  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  time_of_day TEXT,
  responded BOOLEAN DEFAULT false,
  responded_at TIMESTAMP,

  INDEX idx_check_in_log_user_sent (user_id, sent_at DESC)
);
```

---

## API Endpoints

### User Preferences

```typescript
// Enable/configure check-ins
PUT /v1/users/:user_id/check-in-preferences
{
  "enabled": true,
  "frequency": "daily",
  "morning_enabled": true,
  "evening_enabled": true,
  "topics": ["career", "creative_projects"],
  "max_per_day": 2
}

// Get preferences
GET /v1/users/:user_id/check-in-preferences

// Disable check-ins
DELETE /v1/users/:user_id/check-in-preferences
```

### Multi-Day Research Tasks

```typescript
// Create long-running research task
POST /v1/research-tasks/multi-day
{
  "user_id": "uuid",
  "title": "Should I change careers?",
  "description": "I'm considering moving from dentistry to tech...",
  "topic_category": "career",
  "target_completion_date": "2024-01-30"
}

// Get active research tasks
GET /v1/users/:user_id/research-tasks/multi-day?status=active

// Get specific task with all check-ins
GET /v1/research-tasks/multi-day/:task_id

// Complete a task
POST /v1/research-tasks/multi-day/:task_id/complete
{
  "final_synthesis": "After thinking about this over 5 days..."
}
```

### Thought Notifications

```typescript
// Create notification (usually by autonomous thought system)
POST /v1/thought-notifications
{
  "user_id": "uuid",
  "thought_id": "uuid",
  "question": "I've been thinking about your startup idea...",
  "preferred_time_of_day": "evening",
  "priority": 0.7
}

// Get pending notifications (for iOS to display)
GET /v1/users/:user_id/thought-notifications?status=pending

// Get sent notifications (awaiting response)
GET /v1/users/:user_id/thought-notifications?status=sent

// Respond to notification
POST /v1/thought-notifications/:id/respond
{
  "response_text": "That's interesting, I hadn't considered...",
  "self_reported_energy": 4,
  "self_reported_mood": 5,
  "self_reported_focus": 3
}

// Mark as read without responding
POST /v1/thought-notifications/:id/skip
```

### Temporal State Detection (Research)

```typescript
// Get user's temporal personality profile
GET /v1/users/:user_id/temporal-profile
// Returns analysis of cognitive states by time of day

// Get state observations
GET /v1/users/:user_id/state-observations?time_of_day=morning
```

---

## Scheduler Service Logic

### Background Job (runs every 15 minutes)

```typescript
class CheckInScheduler {
  async run() {
    // 1. Get all users with check-ins enabled
    const users = await getEnabledUsers();

    for (const user of users) {
      // 2. Check rate limiting
      const recentNotifications = await getRecentNotifications(user.id, 24); // Last 24 hours
      if (recentNotifications.length >= user.preferences.max_per_day) {
        continue; // Already sent max for today
      }

      // 3. Check if enough time has passed
      const lastSent = recentNotifications[0]?.sent_at;
      if (lastSent) {
        const hoursSince = (Date.now() - lastSent) / (1000 * 60 * 60);
        if (hoursSince < user.preferences.min_hours_between) {
          continue; // Too soon
        }
      }

      // 4. Determine current time of day
      const currentTimeOfDay = getCurrentTimeOfDay(user.timezone);

      // 5. Check if user accepts notifications at this time
      if (!user.preferences[`${currentTimeOfDay}_enabled`]) {
        continue; // User doesn't want notifications now
      }

      // 6. Check Do Not Disturb
      if (isInDoNotDisturb(user.timezone, user.preferences)) {
        continue;
      }

      // 7. Find pending notifications for this user
      const pendingNotifications = await getPendingNotifications(user.id);

      // 8. Filter by topic preferences
      const relevantNotifications = filterByTopics(
        pendingNotifications,
        user.preferences.topics
      );

      // 9. Filter by preferred time of day
      const timeSuitableNotifications = relevantNotifications.filter(n =>
        n.preferred_time_of_day === currentTimeOfDay ||
        n.preferred_time_of_day === 'any'
      );

      // 10. Filter by minimum priority
      const priorityNotifications = timeSuitableNotifications.filter(n =>
        n.priority >= user.preferences.min_priority
      );

      // 11. Sort by priority and pick the top one
      const notification = priorityNotifications.sort((a, b) =>
        b.priority - a.priority
      )[0];

      if (notification) {
        // 12. Send push notification to iOS
        await sendPushNotification(user.id, notification);

        // 13. Mark as sent
        await markNotificationSent(notification.id);

        // 14. Log the check-in
        await logCheckIn(user.id, notification.id, currentTimeOfDay);
      }
    }
  }
}
```

---

## State Detection Logic

### Analyze Response to Detect Cognitive State

```typescript
class StateDetectionService {
  async analyzeResponse(
    userId: string,
    responseText: string,
    timeOfDay: string,
    context: {
      notificationId?: string;
      researchTaskId?: string;
      conversationId?: string;
    }
  ): Promise<TemporalStateObservation> {

    // 1. Extract language features
    const features = await this.extractLanguageFeatures(responseText);

    // 2. Calculate sentiment
    const sentiment = await this.analyzeSentiment(responseText);

    // 3. Detect cognitive state
    const cognitiveState = this.detectCognitiveState(features, timeOfDay);

    // 4. Estimate Big 5 state expression
    const big5StateExpression = this.estimateBig5StateExpression(
      features,
      cognitiveState,
      timeOfDay
    );

    // 5. Store observation
    return await this.storeObservation({
      userId,
      observedAt: new Date(),
      timeOfDay,
      cognitiveState: cognitiveState.state,
      confidence: cognitiveState.confidence,
      sentimentScore: sentiment.score,
      complexityScore: features.complexity,
      languageFeatures: features,
      big5StateExpression,
      ...context
    });
  }

  private detectCognitiveState(features: any, timeOfDay: string) {
    // Heuristics based on language patterns and time of day

    // High analytical signals: complex sentences, technical words, logical connectors
    const analyticalScore = (
      features.avgSentenceLength * 0.3 +
      features.technicalWords * 0.4 +
      features.logicalConnectors * 0.3
    ) / 100;

    // High creative signals: unique words, metaphors, abstract concepts
    const creativeScore = (
      features.uniqueWordRatio * 0.4 +
      features.abstractWords * 0.3 +
      features.metaphorCount * 0.3
    ) / 100;

    // High reflective signals: self-reference, past tense, introspective words
    const reflectiveScore = (
      features.selfReferenceCount * 0.4 +
      features.pastTenseRatio * 0.3 +
      features.introspectiveWords * 0.3
    ) / 100;

    // High emotional signals: emotion words, exclamations, sentiment extremes
    const emotionalScore = (
      features.emotionalWords * 0.5 +
      features.exclamationCount * 0.2 +
      Math.abs(features.sentimentScore) * 0.3
    ) / 100;

    // Philosophical: abstract concepts, questions, existential words
    const philosophicalScore = (
      features.abstractWords * 0.4 +
      features.questionCount * 0.3 +
      features.existentialWords * 0.3
    ) / 100;

    // Pick the highest score
    const scores = {
      analytical: analyticalScore,
      creative: creativeScore,
      reflective: reflectiveScore,
      emotional: emotionalScore,
      philosophical: philosophicalScore
    };

    const state = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];

    return {
      state: state[0],
      confidence: state[1],
      allScores: scores
    };
  }

  private estimateBig5StateExpression(
    features: any,
    cognitiveState: any,
    timeOfDay: string
  ) {
    // Estimate how Big 5 traits are expressing in this current state
    // This is speculative but based on research about state-trait interactions

    return {
      openness: this.estimateOpenness(features, cognitiveState, timeOfDay),
      conscientiousness: this.estimateConscientiousness(features, cognitiveState, timeOfDay),
      extraversion: this.estimateExtraversion(features, cognitiveState, timeOfDay),
      agreeableness: this.estimateAgreeableness(features, cognitiveState, timeOfDay),
      neuroticism: this.estimateNeuroticism(features, cognitiveState, timeOfDay)
    };
  }
}
```

---

## Integration with Autonomous Thoughts

### When Autonomous Thought Completes

```typescript
// In AutonomousThoughtService.completeThought()

if (thought.conclusion && thought.needs_user_input) {
  // Create a notification for the user
  await thoughtNotificationService.create({
    userId: thought.user_id,
    thoughtId: thought.id,
    question: thought.user_question || "I've been thinking about this...",
    context: thought.conclusion,
    preferredTimeOfDay: determineOptimalTime(thought.topic, thought.time_of_day),
    priority: calculatePriority(thought.topic, thought.importance)
  });
}
```

---

## iOS Integration

### Push Notification Payload

```json
{
  "aps": {
    "alert": {
      "title": "💭 Lucid wants to talk",
      "body": "I've been thinking about your career question..."
    },
    "sound": "default",
    "badge": 1
  },
  "notification_id": "uuid",
  "type": "thought_check_in",
  "time_of_day": "evening"
}
```

### iOS UI Flow

1. **User receives push notification**
2. **Taps notification → Opens app**
3. **App shows check-in view:**
   - "I've been thinking about [topic]..."
   - Lucid's question/observation
   - Input field for response
   - Optional: Quick mood check (energy, mood, focus sliders)
4. **User responds**
5. **App sends response to `/thought-notifications/:id/respond`**
6. **Backend analyzes response, detects state, stores observation**
7. **Lucid continues thinking with new information**

---

## Research Data Collection

### What We Can Learn

**Research Question 1**: Do users show different cognitive states at different times of day?
- **Data**: Temporal state observations grouped by time_of_day
- **Analysis**: Compare language features, sentiment, complexity across times
- **Expected Result**: Morning = analytical, Evening = creative/reflective

**Research Question 2**: Does multi-day collaborative thinking yield better insights?
- **Data**: Compare quality of solutions from single-session vs multi-day tasks
- **Analysis**: User satisfaction ratings, depth of final synthesis
- **Expected Result**: Multi-day tasks produce richer, more nuanced insights

**Research Question 3**: Can we detect cognitive states from language patterns?
- **Data**: Detected states vs self-reported energy/mood/focus
- **Analysis**: Correlation between detected state and self-report
- **Expected Result**: Moderate-to-high correlation validates detection

**Research Question 4**: How do Big 5 traits express differently across states?
- **Data**: Big 5 baseline vs estimated state expression
- **Analysis**: Within-person variation in trait expression
- **Expected Result**: Traits show state-dependent variation (e.g., Openness higher at night)

### Data Export for Analysis

```sql
-- Export for research paper
SELECT
  u.id as user_id,
  u.big_five_scores,
  tso.time_of_day,
  tso.cognitive_state,
  tso.confidence,
  tso.sentiment_score,
  tso.complexity_score,
  tso.language_features,
  tso.big5_state_expression,
  tso.self_reported_energy,
  tso.self_reported_mood,
  tso.self_reported_focus,
  tso.observed_at
FROM temporal_state_observations tso
JOIN users u ON tso.user_id = u.id
WHERE u.research_consent = true
ORDER BY user_id, observed_at;
```

---

## Privacy & Ethics

### User Consent

- **Explicit opt-in** for check-ins (disabled by default)
- **Granular controls** (which times, which topics, frequency)
- **Easy opt-out** (disable anytime in settings)
- **Research consent** separate from feature use

### Data Use

- **Notification data**: Used to improve Lucid's thinking
- **State observations**: Research data (anonymized, aggregated)
- **No selling data**: Ever
- **User can export/delete**: All their data anytime

---

## Next Steps

### Phase 1: Core Infrastructure (Week 1)
- [ ] Create database tables
- [ ] Build notification CRUD API
- [ ] Create user preferences API
- [ ] Basic scheduler service (send at specified times)

### Phase 2: Multi-Day Research Tasks (Week 2)
- [ ] Research task CRUD API
- [ ] Track check-ins within tasks
- [ ] Synthesis generation when task completes

### Phase 3: State Detection (Week 3)
- [ ] Language feature extraction
- [ ] Cognitive state detection algorithm
- [ ] Big 5 state expression estimation
- [ ] Store temporal observations

### Phase 4: iOS Integration (Week 4)
- [ ] Push notification setup
- [ ] Check-in UI
- [ ] Response submission
- [ ] Preferences screen

### Phase 5: Research & Refinement (Ongoing)
- [ ] Collect data from real usage
- [ ] Validate state detection
- [ ] Refine algorithms
- [ ] Write research paper

---

## Success Metrics

### Product Metrics
- % of users who enable check-ins
- Average response rate to notifications
- User satisfaction with multi-day tasks
- Engagement over time (retention)

### Research Metrics
- Correlation between detected state and self-report
- Variation in language features by time of day
- Quality improvement in multi-day vs single-session
- Big 5 state expression patterns

---

## Research Paper Outline

**Title**: "Temporal Cognitive Collaboration: Exploiting Circadian Human-AI Interaction for Enhanced Problem-Solving"

**Abstract**: We present a novel approach to human-AI collaboration that leverages circadian cognitive diversity through strategic temporal check-ins. Unlike traditional chatbots that provide instant answers, our system engages users at different times of day to capture varying cognitive states, building a 4D understanding of problems over multiple days. We demonstrate state-dependent language patterns, validate cognitive state detection, and show improved problem-solving outcomes.

**Introduction**
- Limitations of single-session AI interaction
- Circadian cognitive science
- Extended mind theory & cognitive augmentation

**Methods**
- System architecture
- State detection algorithm
- Multi-day research task protocol
- Data collection (N users over M days)

**Results**
- Temporal variation in cognitive states (confirmed)
- State detection accuracy
- Multi-day vs single-session comparison
- Big 5 state expression patterns

**Discussion**
- Implications for AI assistant design
- Applications (therapy, creative work, complex decisions)
- Limitations & future work

**Conclusion**
- Time as a feature, not a bug
- New paradigm for human-AI collaboration

---

## Implementation Priority

**Must Have (MVP)**:
1. ✅ Thought notifications table & API
2. ✅ User preferences API
3. ✅ Basic scheduler (time-based sending)
4. ✅ iOS push notifications
5. ✅ Response collection

**Should Have (V1)**:
6. Multi-day research tasks
7. Basic state detection (sentiment + complexity)
8. Temporal observation storage

**Nice to Have (V2)**:
9. Advanced state detection (Big 5 expression)
10. Automatic optimal timing (ML-based)
11. Research dashboard & data export

Let's start building! 🚀

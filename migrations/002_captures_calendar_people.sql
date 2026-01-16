-- ============================================================================
-- Migration 002: Captures, Calendar Events, and People
-- Purpose: Make Capture more powerful than iOS Reminders
-- ============================================================================

-- ============================================================================
-- 1. PEOPLE (Relationships in your life)
-- ============================================================================
-- First-class entity for people you mention, not just facts

CREATE TABLE people (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) NOT NULL,

  -- Identity
  name VARCHAR(255) NOT NULL,
  nickname VARCHAR(100),                    -- how you refer to them ("Mom", "J")

  -- Relationship
  relationship_type VARCHAR(50),            -- 'family', 'friend', 'colleague', 'acquaintance', 'professional'
  relationship_detail VARCHAR(255),         -- "sister", "manager", "dentist"
  context TEXT,                             -- how you know them, background

  -- Contact (optional - for people Lucid might help you contact)
  email VARCHAR(255),
  phone VARCHAR(50),

  -- Tracking
  mention_count INT DEFAULT 1,
  first_mentioned_at TIMESTAMPTZ DEFAULT NOW(),
  last_mentioned_at TIMESTAMPTZ DEFAULT NOW(),

  -- Sentiment (Lucid's understanding)
  sentiment VARCHAR(20) DEFAULT 'neutral',  -- 'positive', 'neutral', 'complicated', 'negative'
  importance_score DECIMAL(4,3) DEFAULT 0.500,  -- how important to you (0-1)

  -- Vector embedding for semantic search
  embedding vector(1536),

  -- Metadata
  metadata JSONB DEFAULT '{}',

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_people_user ON people(user_id);
CREATE INDEX idx_people_name ON people(user_id, name);
CREATE INDEX idx_people_relationship ON people(user_id, relationship_type);
CREATE INDEX idx_people_importance ON people(user_id, importance_score DESC);
CREATE INDEX idx_people_last_mentioned ON people(user_id, last_mentioned_at DESC);
CREATE INDEX idx_people_embedding ON people USING ivfflat (embedding vector_cosine_ops);

-- ============================================================================
-- 2. CAPTURES (Universal Inbox - Better than Reminders)
-- ============================================================================
-- Everything you capture goes here, then Lucid processes it

CREATE TABLE captures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) NOT NULL,

  -- The captured content
  content TEXT NOT NULL,

  -- Source tracking
  source VARCHAR(50) DEFAULT 'app',         -- 'app', 'voice', 'share_extension', 'ios_import'
  source_metadata JSONB DEFAULT '{}',       -- original reminder ID if imported, etc.

  -- Processing status
  status VARCHAR(20) DEFAULT 'inbox',       -- 'inbox', 'processing', 'processed', 'archived', 'deleted'

  -- Lucid's interpretation
  interpreted_type VARCHAR(50),             -- 'task', 'idea', 'event', 'reminder', 'note', 'person_mention'
  interpreted_title VARCHAR(255),           -- cleaned up title
  interpreted_details TEXT,                 -- Lucid's understanding

  -- Scheduling (when this should happen)
  has_deadline BOOLEAN DEFAULT FALSE,
  deadline_at TIMESTAMPTZ,                  -- hard deadline
  preferred_time VARCHAR(50),               -- 'morning', 'afternoon', 'evening', 'weekend', 'anytime'
  estimated_duration_minutes INT,           -- how long will this take

  -- Priority & Energy
  priority INT DEFAULT 3,                   -- 1 (highest) to 5 (lowest)
  energy_required VARCHAR(20),              -- 'high', 'medium', 'low' (mental energy needed)

  -- Recurrence
  is_recurring BOOLEAN DEFAULT FALSE,
  recurrence_rule VARCHAR(100),             -- 'daily', 'weekly', 'monthly', 'weekdays', custom RRULE

  -- Links to other entities
  scheduled_event_id UUID,                  -- link to calendar_events when scheduled
  related_person_id UUID REFERENCES people(id),
  related_capture_ids UUID[],               -- for grouping related items

  -- Completion
  is_completed BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMPTZ,

  -- Context for Lucid
  context_notes TEXT,                       -- Lucid's notes about this capture

  -- Vector embedding
  embedding vector(1536),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX idx_captures_user ON captures(user_id);
CREATE INDEX idx_captures_status ON captures(user_id, status);
CREATE INDEX idx_captures_inbox ON captures(user_id, created_at DESC) WHERE status = 'inbox';
CREATE INDEX idx_captures_active ON captures(user_id, is_completed, priority) WHERE NOT is_completed AND status = 'processed';
CREATE INDEX idx_captures_deadline ON captures(user_id, deadline_at) WHERE has_deadline AND NOT is_completed;
CREATE INDEX idx_captures_type ON captures(user_id, interpreted_type);
CREATE INDEX idx_captures_person ON captures(related_person_id);
CREATE INDEX idx_captures_embedding ON captures USING ivfflat (embedding vector_cosine_ops);

-- ============================================================================
-- 3. CALENDAR EVENTS (Read AND Write to iOS Calendar)
-- ============================================================================
-- Lucid can both read your calendar AND schedule new events

CREATE TABLE calendar_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) NOT NULL,

  -- iOS sync
  external_id VARCHAR(255),                 -- iOS EventKit event identifier
  external_calendar_id VARCHAR(255),        -- which iOS calendar this belongs to
  calendar_name VARCHAR(255),               -- "Work", "Personal", etc.

  -- Event details
  title VARCHAR(500) NOT NULL,
  description TEXT,
  location VARCHAR(500),

  -- Timing
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  is_all_day BOOLEAN DEFAULT FALSE,
  timezone VARCHAR(50),

  -- Recurrence
  is_recurring BOOLEAN DEFAULT FALSE,
  recurrence_rule TEXT,                     -- RRULE format
  recurrence_end_date TIMESTAMPTZ,

  -- Attendees (linked to people)
  attendee_ids UUID[],                      -- references people(id)
  attendee_names TEXT[],                    -- raw names if not linked

  -- Lucid integration
  source VARCHAR(50) DEFAULT 'ios_sync',    -- 'ios_sync', 'lucid_scheduled', 'user_created'
  source_capture_id UUID REFERENCES captures(id),  -- if scheduled from a capture

  -- Lucid's context (prep notes, follow-ups)
  lucid_prep_notes TEXT,                    -- "Last time you met with Sarah, you discussed..."
  lucid_follow_up TEXT,                     -- "After this meeting, remember to..."

  -- Status
  status VARCHAR(20) DEFAULT 'confirmed',   -- 'tentative', 'confirmed', 'cancelled'
  sync_status VARCHAR(20) DEFAULT 'synced', -- 'synced', 'pending_push', 'pending_delete', 'conflict'

  -- Timestamps
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_calendar_user ON calendar_events(user_id);
CREATE INDEX idx_calendar_external ON calendar_events(external_id);
CREATE INDEX idx_calendar_time ON calendar_events(user_id, start_time, end_time);
-- Note: Cannot use NOW() in index predicate (not IMMUTABLE). Filter by status only.
CREATE INDEX idx_calendar_upcoming ON calendar_events(user_id, start_time) WHERE status != 'cancelled';
CREATE INDEX idx_calendar_source ON calendar_events(source);
CREATE INDEX idx_calendar_sync_status ON calendar_events(sync_status) WHERE sync_status != 'synced';

-- Add FK for captures -> calendar_events
ALTER TABLE captures
  ADD CONSTRAINT fk_captures_scheduled_event
  FOREIGN KEY (scheduled_event_id)
  REFERENCES calendar_events(id);

-- ============================================================================
-- 4. PEOPLE-FACTS LINK (Connect people to facts about them)
-- ============================================================================

CREATE TABLE people_facts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  person_id UUID REFERENCES people(id) NOT NULL,
  fact_id UUID REFERENCES facts(id) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(person_id, fact_id)
);

CREATE INDEX idx_people_facts_person ON people_facts(person_id);
CREATE INDEX idx_people_facts_fact ON people_facts(fact_id);

-- ============================================================================
-- 5. CAPTURE PROCESSING LOG (Track how Lucid processes captures)
-- ============================================================================

CREATE TABLE capture_processing_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  capture_id UUID REFERENCES captures(id) NOT NULL,

  -- What Lucid did
  action VARCHAR(50) NOT NULL,              -- 'classified', 'scheduled', 'linked_person', 'set_priority', 'completed'
  action_details JSONB,                     -- details of the action

  -- AI reasoning
  reasoning TEXT,                           -- why Lucid took this action
  confidence DECIMAL(4,3),                  -- how confident (0-1)

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_capture_log_capture ON capture_processing_log(capture_id);

-- ============================================================================
-- 6. VIEWS
-- ============================================================================

-- Active captures (not completed, not archived)
CREATE VIEW active_captures AS
SELECT
  c.*,
  p.name AS related_person_name,
  ce.title AS scheduled_event_title,
  ce.start_time AS scheduled_start_time
FROM captures c
LEFT JOIN people p ON p.id = c.related_person_id
LEFT JOIN calendar_events ce ON ce.id = c.scheduled_event_id
WHERE c.status IN ('inbox', 'processed')
  AND NOT c.is_completed
ORDER BY
  c.has_deadline DESC,
  c.deadline_at ASC NULLS LAST,
  c.priority ASC,
  c.created_at DESC;

-- Today's schedule with Lucid context
CREATE VIEW todays_schedule AS
SELECT
  ce.*,
  array_agg(DISTINCT p.name) FILTER (WHERE p.name IS NOT NULL) AS attendee_display_names
FROM calendar_events ce
LEFT JOIN people p ON p.id = ANY(ce.attendee_ids)
WHERE ce.start_time >= CURRENT_DATE
  AND ce.start_time < CURRENT_DATE + INTERVAL '1 day'
  AND ce.status != 'cancelled'
GROUP BY ce.id
ORDER BY ce.start_time;

-- Upcoming deadlines
CREATE VIEW upcoming_deadlines AS
SELECT
  c.*,
  p.name AS related_person_name,
  EXTRACT(EPOCH FROM (c.deadline_at - NOW()))/3600 AS hours_until_deadline
FROM captures c
LEFT JOIN people p ON p.id = c.related_person_id
WHERE c.has_deadline
  AND c.deadline_at > NOW()
  AND NOT c.is_completed
ORDER BY c.deadline_at ASC;

-- People ranked by importance
CREATE VIEW important_people AS
SELECT
  p.*,
  COUNT(DISTINCT c.id) AS open_captures_count,
  COUNT(DISTINCT ce.id) AS upcoming_events_count
FROM people p
LEFT JOIN captures c ON c.related_person_id = p.id AND NOT c.is_completed
LEFT JOIN calendar_events ce ON p.id = ANY(ce.attendee_ids) AND ce.start_time > NOW()
GROUP BY p.id
ORDER BY p.importance_score DESC, p.last_mentioned_at DESC;

-- ============================================================================
-- 7. FUNCTIONS
-- ============================================================================

-- Function to find free time slots
CREATE OR REPLACE FUNCTION find_free_slots(
  p_user_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_min_duration_minutes INT DEFAULT 30,
  p_working_hours_start TIME DEFAULT '09:00',
  p_working_hours_end TIME DEFAULT '18:00'
)
RETURNS TABLE (
  slot_date DATE,
  slot_start TIME,
  slot_end TIME,
  duration_minutes INT
) AS $$
BEGIN
  -- This is a placeholder for the actual implementation
  -- The real implementation would:
  -- 1. Generate all working hour slots for the date range
  -- 2. Subtract busy times from calendar_events
  -- 3. Return available slots >= min_duration
  RETURN;
END;
$$ LANGUAGE plpgsql;

-- Function to update person mention stats
CREATE OR REPLACE FUNCTION update_person_mention()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.related_person_id IS NOT NULL THEN
    UPDATE people
    SET
      mention_count = mention_count + 1,
      last_mentioned_at = NOW(),
      updated_at = NOW()
    WHERE id = NEW.related_person_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER capture_person_mention
  AFTER INSERT ON captures
  FOR EACH ROW
  EXECUTE FUNCTION update_person_mention();

-- ============================================================================
-- End of Migration 002
-- ============================================================================

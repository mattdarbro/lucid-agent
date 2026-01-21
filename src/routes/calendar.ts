import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { logger } from '../logger';

const router = Router();

// ============================================================================
// POST /v1/calendar/events - Create a new calendar event (Lucid schedules)
// ============================================================================
router.post('/events', async (req: Request, res: Response) => {
  try {
    const {
      user_id,
      title,
      description,
      location,
      start_time,
      end_time,
      is_all_day = false,
      timezone,
      calendar_name,
      attendee_ids,
      attendee_names,
      source = 'lucid_scheduled',
      source_capture_id,
      lucid_prep_notes,
      lucid_follow_up
    } = req.body;

    // Validation
    if (!user_id || !title || !start_time || !end_time) {
      return res.status(400).json({
        error: 'user_id, title, start_time, and end_time are required'
      });
    }

    // Verify user exists
    const userCheck = await pool.query('SELECT id, timezone FROM users WHERE id = $1', [user_id]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userCheck.rows[0];

    // Create the event
    const result = await pool.query(
      `INSERT INTO calendar_events (
        user_id, title, description, location,
        start_time, end_time, is_all_day, timezone,
        calendar_name, attendee_ids, attendee_names,
        source, source_capture_id, lucid_prep_notes, lucid_follow_up,
        sync_status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'pending_push')
      RETURNING *`,
      [
        user_id,
        title,
        description || null,
        location || null,
        start_time,
        end_time,
        is_all_day,
        timezone || user.timezone || 'UTC',
        calendar_name || 'Lucid',
        attendee_ids || null,
        attendee_names || null,
        source,
        source_capture_id || null,
        lucid_prep_notes || null,
        lucid_follow_up || null
      ]
    );

    const event = result.rows[0];

    // If this was scheduled from a seed, link them
    if (source_capture_id) {
      await pool.query(
        `UPDATE seeds SET scheduled_event_id = $1, updated_at = NOW() WHERE id = $2`,
        [event.id, source_capture_id]
      );
    }

    logger.info(`Calendar event created: ${event.id} for user ${user_id}`);

    res.status(201).json({
      event,
      // iOS app needs to push this to EventKit
      needs_ios_sync: true
    });
  } catch (error: any) {
    logger.error('Error creating calendar event:', error);
    res.status(500).json({ error: 'Failed to create calendar event' });
  }
});

// ============================================================================
// POST /v1/calendar/sync - Sync events from iOS Calendar
// ============================================================================
router.post('/sync', async (req: Request, res: Response) => {
  try {
    const { user_id, events } = req.body;

    if (!user_id || !Array.isArray(events)) {
      return res.status(400).json({ error: 'user_id and events array are required' });
    }

    const synced: any[] = [];
    const created: any[] = [];
    const updated: any[] = [];

    for (const event of events) {
      // Check if event already exists by external_id
      const existing = await pool.query(
        `SELECT id FROM calendar_events WHERE external_id = $1 AND user_id = $2`,
        [event.external_id, user_id]
      );

      if (existing.rows.length > 0) {
        // Update existing event
        const result = await pool.query(
          `UPDATE calendar_events SET
            title = $1,
            description = $2,
            location = $3,
            start_time = $4,
            end_time = $5,
            is_all_day = $6,
            calendar_name = $7,
            attendee_names = $8,
            status = $9,
            is_recurring = $10,
            recurrence_rule = $11,
            recurrence_end_date = $12,
            last_synced_at = NOW(),
            updated_at = NOW()
          WHERE id = $13
          RETURNING *`,
          [
            event.title,
            event.description || null,
            event.location || null,
            event.start_time,
            event.end_time,
            event.is_all_day || false,
            event.calendar_name || null,
            event.attendee_names || null,
            event.status || 'confirmed',
            event.is_recurring || false,
            event.recurrence_rule || null,
            event.recurrence_end_date || null,
            existing.rows[0].id
          ]
        );
        updated.push(result.rows[0]);
      } else {
        // Create new event from iOS
        const result = await pool.query(
          `INSERT INTO calendar_events (
            user_id, external_id, external_calendar_id, calendar_name,
            title, description, location,
            start_time, end_time, is_all_day, timezone,
            is_recurring, recurrence_rule, recurrence_end_date,
            attendee_names, source, sync_status
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'ios_sync', 'synced')
          RETURNING *`,
          [
            user_id,
            event.external_id,
            event.external_calendar_id || null,
            event.calendar_name || null,
            event.title,
            event.description || null,
            event.location || null,
            event.start_time,
            event.end_time,
            event.is_all_day || false,
            event.timezone || null,
            event.is_recurring || false,
            event.recurrence_rule || null,
            event.recurrence_end_date || null,
            event.attendee_names || null
          ]
        );
        created.push(result.rows[0]);
      }
    }

    synced.push(...created, ...updated);

    logger.info(`Calendar sync: ${created.length} created, ${updated.length} updated for user ${user_id}`);

    res.json({
      synced: synced.length,
      created: created.length,
      updated: updated.length,
      events: synced
    });
  } catch (error: any) {
    logger.error('Error syncing calendar:', error);
    res.status(500).json({ error: 'Failed to sync calendar' });
  }
});

// ============================================================================
// GET /v1/calendar/pending-push/:user_id - Get events needing iOS sync
// ============================================================================
router.get('/pending-push/:user_id', async (req: Request, res: Response) => {
  try {
    const { user_id } = req.params;

    const result = await pool.query(
      `SELECT * FROM calendar_events
       WHERE user_id = $1 AND sync_status = 'pending_push'
       ORDER BY created_at ASC`,
      [user_id]
    );

    res.json({
      events: result.rows,
      count: result.rows.length
    });
  } catch (error: any) {
    logger.error('Error fetching pending events:', error);
    res.status(500).json({ error: 'Failed to fetch pending events' });
  }
});

// ============================================================================
// POST /v1/calendar/events/:id/mark-synced - Mark event as synced to iOS
// ============================================================================
router.post('/events/:id/mark-synced', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { external_id } = req.body;

    const result = await pool.query(
      `UPDATE calendar_events
       SET sync_status = 'synced',
           external_id = COALESCE($1, external_id),
           last_synced_at = NOW(),
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [external_id || null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    logger.error('Error marking event as synced:', error);
    res.status(500).json({ error: 'Failed to mark event as synced' });
  }
});

// ============================================================================
// GET /v1/calendar/today/:user_id - Get today's schedule
// ============================================================================
router.get('/today/:user_id', async (req: Request, res: Response) => {
  try {
    const { user_id } = req.params;

    // Get user timezone
    const userResult = await pool.query('SELECT timezone FROM users WHERE id = $1', [user_id]);
    const userTimezone = userResult.rows[0]?.timezone || 'UTC';

    const result = await pool.query(
      `SELECT ce.*,
              array_agg(DISTINCT p.name) FILTER (WHERE p.name IS NOT NULL) AS attendee_display_names
       FROM calendar_events ce
       LEFT JOIN people p ON p.id = ANY(ce.attendee_ids)
       WHERE ce.user_id = $1
         AND ce.start_time >= (CURRENT_DATE AT TIME ZONE $2)
         AND ce.start_time < (CURRENT_DATE + INTERVAL '1 day') AT TIME ZONE $2
         AND ce.status != 'cancelled'
       GROUP BY ce.id
       ORDER BY ce.start_time`,
      [user_id, userTimezone]
    );

    res.json({
      date: new Date().toISOString().split('T')[0],
      timezone: userTimezone,
      events: result.rows,
      count: result.rows.length
    });
  } catch (error: any) {
    logger.error('Error fetching today schedule:', error);
    res.status(500).json({ error: 'Failed to fetch today schedule' });
  }
});

// ============================================================================
// GET /v1/calendar/upcoming/:user_id - Get upcoming events
// ============================================================================
router.get('/upcoming/:user_id', async (req: Request, res: Response) => {
  try {
    const { user_id } = req.params;
    const { days = 7, limit = 50 } = req.query;

    const result = await pool.query(
      `SELECT ce.*,
              array_agg(DISTINCT p.name) FILTER (WHERE p.name IS NOT NULL) AS attendee_display_names
       FROM calendar_events ce
       LEFT JOIN people p ON p.id = ANY(ce.attendee_ids)
       WHERE ce.user_id = $1
         AND ce.start_time >= NOW()
         AND ce.start_time < NOW() + INTERVAL '1 day' * $2
         AND ce.status != 'cancelled'
       GROUP BY ce.id
       ORDER BY ce.start_time
       LIMIT $3`,
      [user_id, parseInt(days as string), parseInt(limit as string)]
    );

    res.json({
      days: parseInt(days as string),
      events: result.rows,
      count: result.rows.length
    });
  } catch (error: any) {
    logger.error('Error fetching upcoming events:', error);
    res.status(500).json({ error: 'Failed to fetch upcoming events' });
  }
});

// ============================================================================
// GET /v1/calendar/events/:id - Get a specific event
// ============================================================================
router.get('/events/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT ce.*,
              array_agg(DISTINCT p.name) FILTER (WHERE p.name IS NOT NULL) AS attendee_display_names
       FROM calendar_events ce
       LEFT JOIN people p ON p.id = ANY(ce.attendee_ids)
       WHERE ce.id = $1
       GROUP BY ce.id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    logger.error('Error fetching event:', error);
    res.status(500).json({ error: 'Failed to fetch event' });
  }
});

// ============================================================================
// PATCH /v1/calendar/events/:id - Update an event
// ============================================================================
router.patch('/events/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const allowedFields = [
      'title', 'description', 'location', 'start_time', 'end_time',
      'is_all_day', 'timezone', 'calendar_name', 'attendee_ids', 'attendee_names',
      'is_recurring', 'recurrence_rule', 'recurrence_end_date',
      'status', 'lucid_prep_notes', 'lucid_follow_up'
    ];

    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        setClauses.push(`${key} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    // Mark for re-sync if key fields changed
    const needsResync = ['title', 'start_time', 'end_time', 'location'].some(
      f => f in updates
    );
    if (needsResync) {
      setClauses.push(`sync_status = 'pending_push'`);
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(id);

    const query = `
      UPDATE calendar_events
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    logger.info(`Calendar event updated: ${id}`);
    res.json(result.rows[0]);
  } catch (error: any) {
    logger.error('Error updating event:', error);
    res.status(500).json({ error: 'Failed to update event' });
  }
});

// ============================================================================
// DELETE /v1/calendar/events/:id - Cancel/delete an event
// ============================================================================
router.delete('/events/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Soft delete - mark as cancelled and pending delete sync
    const result = await pool.query(
      `UPDATE calendar_events
       SET status = 'cancelled',
           sync_status = 'pending_delete',
           updated_at = NOW()
       WHERE id = $1
       RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    logger.info(`Calendar event cancelled: ${id}`);
    res.json({
      deleted: true,
      id,
      needs_ios_sync: true
    });
  } catch (error: any) {
    logger.error('Error deleting event:', error);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

// ============================================================================
// GET /v1/calendar/free-slots/:user_id - Find free time slots
// ============================================================================
router.get('/free-slots/:user_id', async (req: Request, res: Response) => {
  try {
    const { user_id } = req.params;
    const {
      date,
      days = 1,
      min_duration = 30,
      start_hour = 9,
      end_hour = 18
    } = req.query;

    const startDate = date ? new Date(date as string) : new Date();
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + parseInt(days as string));

    // Get all events in the range
    const eventsResult = await pool.query(
      `SELECT start_time, end_time
       FROM calendar_events
       WHERE user_id = $1
         AND start_time >= $2
         AND start_time < $3
         AND status != 'cancelled'
       ORDER BY start_time`,
      [user_id, startDate.toISOString(), endDate.toISOString()]
    );

    const busySlots = eventsResult.rows.map(e => ({
      start: new Date(e.start_time),
      end: new Date(e.end_time)
    }));

    // Calculate free slots for each day
    const freeSlots: any[] = [];
    const currentDate = new Date(startDate);

    while (currentDate < endDate) {
      const dayStart = new Date(currentDate);
      dayStart.setHours(parseInt(start_hour as string), 0, 0, 0);

      const dayEnd = new Date(currentDate);
      dayEnd.setHours(parseInt(end_hour as string), 0, 0, 0);

      // Get busy slots for this day
      const dayBusy = busySlots.filter(
        b => b.start >= dayStart && b.start < dayEnd
      );

      // Find gaps
      let slotStart = dayStart;
      for (const busy of dayBusy) {
        if (busy.start > slotStart) {
          const durationMins = (busy.start.getTime() - slotStart.getTime()) / 60000;
          if (durationMins >= parseInt(min_duration as string)) {
            freeSlots.push({
              date: currentDate.toISOString().split('T')[0],
              start: slotStart.toTimeString().slice(0, 5),
              end: busy.start.toTimeString().slice(0, 5),
              duration_minutes: durationMins
            });
          }
        }
        slotStart = busy.end > slotStart ? busy.end : slotStart;
      }

      // Check remaining time until day end
      if (slotStart < dayEnd) {
        const durationMins = (dayEnd.getTime() - slotStart.getTime()) / 60000;
        if (durationMins >= parseInt(min_duration as string)) {
          freeSlots.push({
            date: currentDate.toISOString().split('T')[0],
            start: slotStart.toTimeString().slice(0, 5),
            end: dayEnd.toTimeString().slice(0, 5),
            duration_minutes: durationMins
          });
        }
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    res.json({
      working_hours: {
        start: parseInt(start_hour as string),
        end: parseInt(end_hour as string)
      },
      min_duration_minutes: parseInt(min_duration as string),
      free_slots: freeSlots,
      count: freeSlots.length
    });
  } catch (error: any) {
    logger.error('Error finding free slots:', error);
    res.status(500).json({ error: 'Failed to find free slots' });
  }
});

// ============================================================================
// POST /v1/calendar/schedule-seed - Schedule a seed as a calendar event
// Note: This is legacy functionality - seeds are for contemplation, not scheduling
// ============================================================================
router.post('/schedule-seed', async (req: Request, res: Response) => {
  try {
    const {
      seed_id,
      start_time,
      end_time,
      calendar_name = 'Lucid',
      title_override
    } = req.body;

    if (!seed_id || !start_time || !end_time) {
      return res.status(400).json({
        error: 'seed_id, start_time, and end_time are required'
      });
    }

    // Get the seed
    const seedResult = await pool.query(
      `SELECT * FROM seeds WHERE id = $1`,
      [seed_id]
    );

    if (seedResult.rows.length === 0) {
      return res.status(404).json({ error: 'Seed not found' });
    }

    const seed = seedResult.rows[0];

    // Create calendar event from seed
    const eventResult = await pool.query(
      `INSERT INTO calendar_events (
        user_id, title, description,
        start_time, end_time, calendar_name,
        source, source_capture_id, sync_status
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'lucid_scheduled', $7, 'pending_push')
      RETURNING *`,
      [
        seed.user_id,
        title_override || seed.content.substring(0, 100),
        seed.content,
        start_time,
        end_time,
        calendar_name,
        seed_id
      ]
    );

    const event = eventResult.rows[0];

    // Link seed to event
    await pool.query(
      `UPDATE seeds
       SET scheduled_event_id = $1, status = 'growing', updated_at = NOW()
       WHERE id = $2`,
      [event.id, seed_id]
    );

    logger.info(`Scheduled seed ${seed_id} as event ${event.id}`);

    res.status(201).json({
      event,
      seed_id,
      needs_ios_sync: true
    });
  } catch (error: any) {
    logger.error('Error scheduling seed:', error);
    res.status(500).json({ error: 'Failed to schedule seed' });
  }
});

export default router;

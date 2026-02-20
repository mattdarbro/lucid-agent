/**
 * Chicago timezone utilities.
 *
 * Lucid's owner is in Chicago, so all "human-facing" day boundaries,
 * date labels, and schedule calculations use America/Chicago.
 *
 * Database timestamps remain in UTC (TIMESTAMPTZ), but queries that
 * slice data by "today" or "yesterday" must use Chicago day boundaries.
 */

const CHICAGO_TZ = 'America/Chicago';

/**
 * Return the Chicago-local date parts for a given instant (defaults to now).
 */
export function chicagoDateParts(date: Date = new Date()): {
  year: number;
  month: number; // 1-based
  day: number;
  hour: number;
  minute: number;
  dayOfWeek: number; // 0=Sun … 6=Sat
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';

  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };

  return {
    year: parseInt(get('year'), 10),
    month: parseInt(get('month'), 10),
    day: parseInt(get('day'), 10),
    hour: parseInt(get('hour'), 10),
    minute: parseInt(get('minute'), 10),
    dayOfWeek: weekdayMap[get('weekday')] ?? 0,
  };
}

/**
 * Return "YYYY-MM-DD" for "today" in Chicago (or for an arbitrary instant).
 */
export function chicagoDateStr(date: Date = new Date()): string {
  const { year, month, day } = chicagoDateParts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Return the UTC start and end instants that bound a Chicago calendar day.
 *
 * For example, chicagoDayBounds('2026-02-20') during CST (UTC-6) returns:
 *   start = 2026-02-20T06:00:00.000Z   (midnight Chicago = 6am UTC)
 *   end   = 2026-02-21T05:59:59.999Z   (11:59pm Chicago = next day 5:59am UTC)
 *
 * Handles DST transitions automatically via Intl.DateTimeFormat.
 */
export function chicagoDayBounds(dateStr: string): { start: Date; end: Date } {
  // Parse the YYYY-MM-DD string
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10); // 1-based
  const day = parseInt(dayStr, 10);

  // Build midnight in Chicago for the target date.
  // We compute the UTC offset for that specific moment so DST is handled.
  const start = chicagoLocalToUTC(year, month, day, 0, 0, 0);

  // End of day: 23:59:59.999 Chicago
  const end = chicagoLocalToUTC(year, month, day, 23, 59, 59, 999);

  return { start, end };
}

/**
 * Convert a Chicago-local wall-clock time to a UTC Date.
 *
 * Uses a binary-search approach on the UTC offset to handle DST correctly:
 * we create a candidate UTC date assuming no offset, then measure the actual
 * Chicago offset for that instant, and adjust.
 */
function chicagoLocalToUTC(
  year: number,
  month: number,  // 1-based
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number = 0
): Date {
  // Start with a naive estimate: treat the local time as UTC
  const naive = new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms));

  // Measure Chicago's offset at that naive instant
  const offsetMs = getChicagoOffsetMs(naive);

  // The actual UTC instant is the local time PLUS the offset
  // (offset is positive when Chicago is behind UTC)
  const adjusted = new Date(naive.getTime() + offsetMs);

  // Verify: the offset might differ at the adjusted time (DST edge).
  // Re-check and adjust if needed.
  const offsetMs2 = getChicagoOffsetMs(adjusted);
  if (offsetMs2 !== offsetMs) {
    return new Date(naive.getTime() + offsetMs2);
  }

  return adjusted;
}

/**
 * Return the current time-of-day label in Chicago timezone.
 * Used for tagging library entries, thoughts, etc. with the correct
 * period of the user's day rather than the server's.
 */
export function chicagoTimeOfDay(date: Date = new Date()): string {
  const { hour } = chicagoDateParts(date);
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

/**
 * Get the UTC offset for Chicago at a given instant, in milliseconds.
 * Returns a positive value (e.g. 21600000 for CST = UTC-6, 18000000 for CDT = UTC-5).
 */
function getChicagoOffsetMs(date: Date): number {
  // Format the date in both UTC and Chicago, then compute the difference
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' });
  const chicagoStr = date.toLocaleString('en-US', { timeZone: CHICAGO_TZ });
  const utcDate = new Date(utcStr);
  const chicagoDate = new Date(chicagoStr);
  return utcDate.getTime() - chicagoDate.getTime();
}

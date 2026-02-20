import { Pool } from 'pg';
import { logger } from '../logger';
import { HealthMetric, DailyHealthSummary, HealthMetricType, ActivitySample } from '../types/database';
import {
  CreateHealthMetricInput,
  BatchHealthMetricsInput,
  QueryHealthMetricsInput,
} from '../validation/health.validation';
import { chicagoDayBounds, chicagoDateStr } from '../utils/chicago-time';

/**
 * HealthService
 *
 * Stores and retrieves health metrics synced from Apple HealthKit (via the iOS app),
 * manual entries, and (future) Oura Ring data.
 *
 * The iOS app reads HealthKit on a schedule and POSTs batches here.
 * Lucid's morning/evening health check loops query this service for daily summaries.
 */
export class HealthService {
  /**
   * Metrics where the iOS app sends pre-aggregated daily totals (one row per day
   * at midnight UTC) instead of individual HealthKit samples.
   */
  private static readonly CUMULATIVE_DAILY_METRICS = new Set([
    'steps',
    'active_energy',
    'exercise_minutes',
  ]);

  constructor(private pool: Pool) {}

  /**
   * Store a single health metric. Upserts on the dedup index
   * (user_id, metric_type, recorded_at, source) so re-syncs are safe.
   */
  async createMetric(input: CreateHealthMetricInput): Promise<HealthMetric> {
    const result = await this.pool.query(
      `INSERT INTO health_metrics (user_id, metric_type, value, unit, recorded_at, source, source_device, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id, metric_type, recorded_at, source)
       DO UPDATE SET value = EXCLUDED.value, unit = EXCLUDED.unit,
                     source_device = EXCLUDED.source_device,
                     metadata = EXCLUDED.metadata,
                     updated_at = NOW()
       RETURNING *`,
      [
        input.user_id,
        input.metric_type,
        input.value,
        input.unit,
        input.recorded_at,
        input.source,
        input.source_device || null,
        input.metadata || {},
      ]
    );

    return this.mapRow(result.rows[0]);
  }

  /**
   * Batch-insert metrics from an iOS HealthKit sync.
   * Uses a single transaction for atomicity.
   *
   * Metrics are sorted by the unique-constraint columns before upserting so
   * that concurrent transactions always acquire row locks in the same order,
   * preventing deadlocks. A retry loop handles the rare case where a deadlock
   * still occurs (e.g. interleaving with single-metric inserts).
   */
  async batchCreateMetrics(input: BatchHealthMetricsInput): Promise<{
    inserted: number;
    updated: number;
    total: number;
  }> {
    const maxRetries = 3;

    // Sort by the unique-index columns (metric_type, recorded_at, source)
    // so concurrent transactions lock rows in the same deterministic order.
    const sortedMetrics = [...input.metrics].sort((a, b) => {
      const cmp1 = a.metric_type.localeCompare(b.metric_type);
      if (cmp1 !== 0) return cmp1;
      const timeA = new Date(a.recorded_at).getTime();
      const timeB = new Date(b.recorded_at).getTime();
      if (timeA !== timeB) return timeA - timeB;
      return (a.source ?? 'apple_health').localeCompare(b.source ?? 'apple_health');
    });

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const client = await this.pool.connect();
      let inserted = 0;
      let updated = 0;

      try {
        await client.query('BEGIN');

        for (const metric of sortedMetrics) {
          const result = await client.query(
            `INSERT INTO health_metrics (user_id, metric_type, value, unit, recorded_at, source, source_device, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (user_id, metric_type, recorded_at, source)
             DO UPDATE SET value = EXCLUDED.value, unit = EXCLUDED.unit,
                           source_device = EXCLUDED.source_device,
                           metadata = EXCLUDED.metadata,
                           updated_at = NOW()
             RETURNING (xmax = 0) AS is_insert`,
            [
              input.user_id,
              metric.metric_type,
              metric.value,
              metric.unit,
              metric.recorded_at,
              metric.source,
              metric.source_device || null,
              metric.metadata || {},
            ]
          );

          if (result.rows[0]?.is_insert) {
            inserted++;
          } else {
            updated++;
          }
        }

        await client.query('COMMIT');

        logger.info('[HEALTH] Batch sync completed', {
          userId: input.user_id,
          inserted,
          updated,
          total: input.metrics.length,
        });

        return { inserted, updated, total: input.metrics.length };
      } catch (error: any) {
        await client.query('ROLLBACK');

        // Retry on deadlock (PostgreSQL error code 40P01)
        if (error?.code === '40P01' && attempt < maxRetries) {
          const delayMs = 50 * Math.pow(2, attempt - 1); // 50ms, 100ms, 200ms
          logger.warn('[HEALTH] Deadlock detected, retrying batch sync', {
            userId: input.user_id,
            attempt,
            delayMs,
          });
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        throw error;
      } finally {
        client.release();
      }
    }

    // Unreachable, but satisfies TypeScript
    throw new Error('Batch sync exceeded max retries');
  }

  /**
   * Query raw metrics for a user with optional filters.
   */
  async getMetrics(
    userId: string,
    query: QueryHealthMetricsInput
  ): Promise<{ metrics: HealthMetric[]; total: number }> {
    const conditions: string[] = ['user_id = $1'];
    const params: any[] = [userId];
    let paramIndex = 2;

    if (query.metric_type) {
      conditions.push(`metric_type = $${paramIndex++}`);
      params.push(query.metric_type);
    }
    if (query.source) {
      conditions.push(`source = $${paramIndex++}`);
      params.push(query.source);
    }
    if (query.start_date) {
      conditions.push(`recorded_at >= $${paramIndex++}`);
      params.push(query.start_date);
    }
    if (query.end_date) {
      conditions.push(`recorded_at <= $${paramIndex++}`);
      params.push(query.end_date);
    }

    const where = conditions.join(' AND ');

    const countResult = await this.pool.query(
      `SELECT COUNT(*) FROM health_metrics WHERE ${where}`,
      params
    );

    const dataResult = await this.pool.query(
      `SELECT * FROM health_metrics
       WHERE ${where}
       ORDER BY recorded_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      [...params, query.limit, query.offset]
    );

    return {
      metrics: dataResult.rows.map(this.mapRow),
      total: parseInt(countResult.rows[0].count, 10),
    };
  }

  /**
   * Get a daily health summary for Lucid's health check loops.
   * Aggregates all metrics for a given day into a structured snapshot.
   */
  async getDailySummary(userId: string, date: string): Promise<DailyHealthSummary> {
    // Use Chicago day boundaries so "today" means midnight-to-midnight Central.
    // This ensures evening readings (after 6pm CST / 7pm CDT) and daily totals
    // (recorded at midnight UTC, which is ~6pm Chicago previous day) land in
    // the correct Chicago calendar day.
    const { start, end } = chicagoDayBounds(date);

    const result = await this.pool.query(
      `SELECT metric_type, value, unit, recorded_at, metadata
       FROM health_metrics
       WHERE user_id = $1
         AND recorded_at >= $2::timestamptz
         AND recorded_at <= $3::timestamptz
       ORDER BY recorded_at DESC`,
      [userId, start.toISOString(), end.toISOString()]
    );

    const summary: DailyHealthSummary = { date };

    // Group metrics by type
    const byType = new Map<string, Array<{ value: number; unit: string; recorded_at: Date; metadata: Record<string, any> }>>();
    for (const row of result.rows) {
      const entries = byType.get(row.metric_type) || [];
      entries.push({
        value: parseFloat(row.value),
        unit: row.unit,
        recorded_at: new Date(row.recorded_at),
        metadata: row.metadata || {},
      });
      byType.set(row.metric_type, entries);
    }

    // Blood pressure: latest reading
    const systolic = byType.get('blood_pressure_systolic');
    const diastolic = byType.get('blood_pressure_diastolic');
    if (systolic?.length && diastolic?.length) {
      summary.blood_pressure = {
        systolic: systolic[0].value,
        diastolic: diastolic[0].value,
        recorded_at: systolic[0].recorded_at,
      };
    }

    // Weight: latest reading
    const weight = byType.get('weight');
    if (weight?.length) {
      summary.weight = {
        value: weight[0].value,
        unit: weight[0].unit,
        recorded_at: weight[0].recorded_at,
      };
    }

    // Steps: daily total + optional per-sample breakdown for activity patterns
    const steps = byType.get('steps');
    if (steps?.length) {
      const { total, samples } = this.aggregateCumulative(steps);
      summary.steps = {
        value: total,
        recorded_at: steps[0].recorded_at,
        ...(samples.length > 0 && { samples }),
      };
    }

    // Heart rate: avg, min, max across readings
    const heartRate = byType.get('heart_rate');
    if (heartRate?.length) {
      const values = heartRate.map((h) => h.value);
      summary.heart_rate = {
        avg: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
        min: Math.min(...values),
        max: Math.max(...values),
      };
    }

    // Resting heart rate: latest
    const restingHr = byType.get('resting_heart_rate');
    if (restingHr?.length) {
      summary.resting_heart_rate = {
        value: restingHr[0].value,
        recorded_at: restingHr[0].recorded_at,
      };
    }

    // Sleep duration: sum (may come in segments)
    const sleep = byType.get('sleep_duration');
    if (sleep?.length) {
      const totalHours = sleep.reduce((sum, s) => sum + s.value, 0);
      summary.sleep_duration = { hours: totalHours, recorded_at: sleep[0].recorded_at };
    }

    // Active energy: daily total + optional per-sample breakdown
    const energy = byType.get('active_energy');
    if (energy?.length) {
      const { total, samples } = this.aggregateCumulative(energy);
      summary.active_energy = {
        value: Math.round(total),
        unit: energy[0].unit,
        ...(samples.length > 0 && { samples }),
      };
    }

    // Exercise minutes: daily total + optional per-sample breakdown
    const exercise = byType.get('exercise_minutes');
    if (exercise?.length) {
      const { total, samples } = this.aggregateCumulative(exercise);
      summary.exercise_minutes = {
        value: Math.round(total),
        ...(samples.length > 0 && { samples }),
      };
    }

    return summary;
  }

  /**
   * Get multi-day summaries (e.g. for weekly trends).
   */
  async getMultiDaySummaries(
    userId: string,
    days: number,
    endDate?: string
  ): Promise<DailyHealthSummary[]> {
    // Compute date strings in Chicago timezone so day boundaries are consistent
    const endDateStr = endDate ?? chicagoDateStr();
    const summaries: DailyHealthSummary[] = [];

    // Walk backwards from endDate by parsing Chicago date and decrementing
    const [y, m, d] = endDateStr.split('-').map(Number);
    for (let i = 0; i < days; i++) {
      const dt = new Date(Date.UTC(y, m - 1, d - i));
      const dateStr = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
      const summary = await this.getDailySummary(userId, dateStr);
      summaries.push(summary);
    }

    return summaries;
  }

  /**
   * Format a daily summary as human-readable text for Lucid's health loop prompts.
   */
  formatSummaryForPrompt(summary: DailyHealthSummary): string {
    const lines: string[] = [`📅 Health Data for ${summary.date}:`];

    if (summary.blood_pressure) {
      lines.push(`  Blood Pressure: ${summary.blood_pressure.systolic}/${summary.blood_pressure.diastolic} mmHg`);
    }
    if (summary.weight) {
      lines.push(`  Weight: ${summary.weight.value} ${summary.weight.unit}`);
    }
    if (summary.steps) {
      lines.push(`  Steps: ${summary.steps.value.toLocaleString()}`);
      const pattern = this.formatActivityPattern(summary.steps.samples);
      if (pattern) lines.push(`    ${pattern}`);
    }
    if (summary.heart_rate) {
      lines.push(`  Heart Rate: avg ${summary.heart_rate.avg} bpm (${summary.heart_rate.min}-${summary.heart_rate.max})`);
    }
    if (summary.resting_heart_rate) {
      lines.push(`  Resting HR: ${summary.resting_heart_rate.value} bpm`);
    }
    if (summary.sleep_duration) {
      lines.push(`  Sleep: ${summary.sleep_duration.hours.toFixed(1)} hours`);
    }
    if (summary.active_energy) {
      lines.push(`  Active Energy: ${summary.active_energy.value} ${summary.active_energy.unit}`);
      const pattern = this.formatActivityPattern(summary.active_energy.samples);
      if (pattern) lines.push(`    ${pattern}`);
    }
    if (summary.exercise_minutes) {
      lines.push(`  Exercise: ${summary.exercise_minutes.value} minutes`);
      const pattern = this.formatActivityPattern(summary.exercise_minutes.samples);
      if (pattern) lines.push(`    ${pattern}`);
    }

    if (lines.length === 1) {
      lines.push('  (No health data recorded for this day)');
    }

    return lines.join('\n');
  }

  /**
   * Check if there's any recent health data for a user (within last 48 hours).
   * Used to determine if the health loops should run.
   */
  async hasRecentData(userId: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT EXISTS(
        SELECT 1 FROM health_metrics
        WHERE user_id = $1
          AND recorded_at > NOW() - INTERVAL '48 hours'
      ) AS has_data`,
      [userId]
    );
    return result.rows[0].has_data;
  }

  /**
   * Get the latest metric of each type for a user.
   * Useful for the iOS app to show current values.
   */
  async getLatestMetrics(userId: string): Promise<HealthMetric[]> {
    const result = await this.pool.query(
      `SELECT DISTINCT ON (metric_type) *
       FROM health_metrics
       WHERE user_id = $1
       ORDER BY metric_type, recorded_at DESC`,
      [userId]
    );
    return result.rows.map(this.mapRow);
  }

  /**
   * Aggregate a cumulative daily metric (steps, active_energy, exercise_minutes).
   *
   * The iOS app sends two kinds of records distinguished by metadata.granularity:
   *   - "daily_total": one authoritative row per day with the summed value
   *   - "sample": individual HealthKit readings with original timestamps
   *
   * Returns the daily total and any individual samples (for time-of-day analysis).
   *
   * Legacy data (no granularity metadata) falls back to midnight-UTC detection
   * or summing all rows.
   */
  private aggregateCumulative(
    entries: Array<{ value: number; unit: string; recorded_at: Date; metadata: Record<string, any> }>
  ): { total: number; samples: ActivitySample[] } {
    // New iOS format: use metadata.granularity to distinguish daily_total from samples
    const dailyTotalEntry = entries.find((e) => e.metadata?.granularity === 'daily_total');
    const sampleEntries = entries.filter((e) => e.metadata?.granularity === 'sample');

    if (dailyTotalEntry) {
      return {
        total: dailyTotalEntry.value,
        samples: sampleEntries.map((s) => ({ value: s.value, recorded_at: s.recorded_at })),
      };
    }

    // --- Legacy fallback (data without granularity metadata) ---

    if (entries.length === 1) {
      return { total: entries[0].value, samples: [] };
    }

    // Look for a daily total row (midnight UTC from old iOS format)
    const midnightEntries = entries.filter((e) => {
      const d = e.recorded_at;
      return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
    });

    if (midnightEntries.length === 1) {
      return { total: midnightEntries[0].value, samples: [] };
    }

    // Legacy format: sum individual samples
    return { total: entries.reduce((sum, e) => sum + e.value, 0), samples: [] };
  }

  /**
   * Bucket activity samples into 3-hour windows so Lucid can see
   * time-of-day patterns (e.g. "most steps in the afternoon").
   *
   * Returns a compact one-liner like:
   *   "By time (UTC): 06-09h: 1,200 | 09-12h: 890 | 15-18h: 1,320"
   *
   * Returns empty string when there are fewer than 2 samples.
   */
  private formatActivityPattern(samples?: ActivitySample[]): string {
    if (!samples || samples.length < 2) return '';

    // Bucket into 3-hour windows (0-3, 3-6, ..., 21-24)
    const buckets = new Map<number, number>();
    for (const s of samples) {
      const hour = s.recorded_at.getUTCHours();
      const bucketStart = Math.floor(hour / 3) * 3;
      buckets.set(bucketStart, (buckets.get(bucketStart) || 0) + s.value);
    }

    const parts = Array.from(buckets.entries())
      .filter(([, total]) => total > 0)
      .sort(([a], [b]) => a - b)
      .map(([start, total]) => {
        const end = start + 3;
        const pad = (n: number) => n.toString().padStart(2, '0');
        return `${pad(start)}-${pad(end)}h: ${Math.round(total).toLocaleString()}`;
      });

    if (parts.length === 0) return '';
    return `By time (UTC): ${parts.join(' | ')}`;
  }

  private mapRow(row: any): HealthMetric {
    return {
      id: row.id,
      user_id: row.user_id,
      metric_type: row.metric_type,
      value: parseFloat(row.value),
      unit: row.unit,
      recorded_at: new Date(row.recorded_at),
      source: row.source,
      source_device: row.source_device,
      metadata: row.metadata || {},
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  }
}

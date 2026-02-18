import { Pool } from 'pg';
import { logger } from '../logger';
import { HealthMetric, DailyHealthSummary, HealthMetricType } from '../types/database';
import {
  CreateHealthMetricInput,
  BatchHealthMetricsInput,
  QueryHealthMetricsInput,
} from '../validation/health.validation';

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
   */
  async batchCreateMetrics(input: BatchHealthMetricsInput): Promise<{
    inserted: number;
    updated: number;
    total: number;
  }> {
    const client = await this.pool.connect();
    let inserted = 0;
    let updated = 0;

    try {
      await client.query('BEGIN');

      for (const metric of input.metrics) {
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
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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
    // Explicit UTC so day boundaries match iOS-synced timestamps (recorded_at at midnight UTC)
    const dayStart = `${date}T00:00:00Z`;
    const dayEnd = `${date}T23:59:59.999Z`;

    const result = await this.pool.query(
      `SELECT metric_type, value, unit, recorded_at
       FROM health_metrics
       WHERE user_id = $1
         AND recorded_at >= $2::timestamptz
         AND recorded_at <= $3::timestamptz
       ORDER BY recorded_at DESC`,
      [userId, dayStart, dayEnd]
    );

    const summary: DailyHealthSummary = { date };

    // Group metrics by type
    const byType = new Map<string, Array<{ value: number; unit: string; recorded_at: Date }>>();
    for (const row of result.rows) {
      const entries = byType.get(row.metric_type) || [];
      entries.push({
        value: parseFloat(row.value),
        unit: row.unit,
        recorded_at: new Date(row.recorded_at),
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

    // Steps: daily total (iOS sends one pre-aggregated row per day at midnight UTC)
    const steps = byType.get('steps');
    if (steps?.length) {
      summary.steps = {
        value: this.aggregateCumulative(steps),
        recorded_at: steps[0].recorded_at,
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

    // Active energy: daily total (iOS sends one pre-aggregated row per day)
    const energy = byType.get('active_energy');
    if (energy?.length) {
      summary.active_energy = {
        value: Math.round(this.aggregateCumulative(energy)),
        unit: energy[0].unit,
      };
    }

    // Exercise minutes: daily total (iOS sends one pre-aggregated row per day)
    const exercise = byType.get('exercise_minutes');
    if (exercise?.length) {
      summary.exercise_minutes = {
        value: Math.round(this.aggregateCumulative(exercise)),
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
    const end = endDate ? new Date(endDate) : new Date();
    const summaries: DailyHealthSummary[] = [];

    for (let i = 0; i < days; i++) {
      const d = new Date(end);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
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
    }
    if (summary.exercise_minutes) {
      lines.push(`  Exercise: ${summary.exercise_minutes.value} minutes`);
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
   * The iOS app now sends one pre-aggregated row per day at midnight UTC.
   * Old data may still have individual HealthKit samples throughout the day.
   *
   * Strategy:
   * - Single row → use it directly
   * - Multiple rows with a midnight-UTC row → use the midnight row (daily total)
   * - Multiple rows without midnight row → sum all (legacy fragment behavior)
   */
  private aggregateCumulative(
    entries: Array<{ value: number; unit: string; recorded_at: Date }>
  ): number {
    if (entries.length === 1) {
      return entries[0].value;
    }

    // Look for a daily total row (midnight UTC from new iOS format)
    const midnightEntries = entries.filter((e) => {
      const d = e.recorded_at;
      return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
    });

    if (midnightEntries.length === 1) {
      // New iOS format: daily total at midnight UTC — use it directly
      return midnightEntries[0].value;
    }

    // Legacy format: sum individual samples
    return entries.reduce((sum, e) => sum + e.value, 0);
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

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HealthService } from './health.service';
import { Pool } from 'pg';
import { DailyHealthSummary } from '../types/database';
import { clearAllMocks } from '../test/setup';

const mockPool = {
  query: vi.fn(),
  connect: vi.fn(),
} as unknown as Pool;

describe('HealthService', () => {
  let healthService: HealthService;

  beforeEach(() => {
    clearAllMocks();
    healthService = new HealthService(mockPool);
  });

  // -----------------------------------------------------------------------
  // getDailySummary — aggregateCumulative is exercised through this
  //
  // getDailySummary now makes TWO queries:
  //   1. Main query: Chicago day bounds (e.g. 06:00Z–05:59Z+1 for CST)
  //   2. Supplementary: midnight-UTC records for cumulative metrics
  //      (steps, active_energy, exercise_minutes) that fall before the
  //      Chicago day start.
  // -----------------------------------------------------------------------
  describe('getDailySummary', () => {
    it('should use daily_total from supplementary midnight-UTC query and samples from main query', async () => {
      // Main query: samples within Chicago day bounds
      (mockPool.query as any).mockResolvedValueOnce({
        rows: [
          {
            metric_type: 'steps',
            value: '1200',
            unit: 'steps',
            recorded_at: '2026-02-17T08:15:00Z',
            metadata: { granularity: 'sample' },
          },
          {
            metric_type: 'steps',
            value: '2300',
            unit: 'steps',
            recorded_at: '2026-02-17T12:30:00Z',
            metadata: { granularity: 'sample' },
          },
          {
            metric_type: 'steps',
            value: '2400',
            unit: 'steps',
            recorded_at: '2026-02-17T16:45:00Z',
            metadata: { granularity: 'sample' },
          },
        ],
      });
      // Supplementary query: daily_total at midnight UTC
      (mockPool.query as any).mockResolvedValueOnce({
        rows: [
          {
            metric_type: 'steps',
            value: '5900',
            unit: 'steps',
            recorded_at: '2026-02-17T00:00:00Z',
            metadata: { granularity: 'daily_total' },
          },
        ],
      });

      const summary = await healthService.getDailySummary('user-1', '2026-02-17');

      // Should use daily_total value, NOT sum of samples
      expect(summary.steps?.value).toBe(5900);

      // Should include the 3 sample records
      expect(summary.steps?.samples).toHaveLength(3);
      expect(summary.steps?.samples![0].value).toBe(1200);
      expect(summary.steps?.samples![1].value).toBe(2300);
      expect(summary.steps?.samples![2].value).toBe(2400);
    });

    it('should handle daily_total without any samples (no samples sent yet)', async () => {
      // Main query: nothing within Chicago day bounds
      (mockPool.query as any).mockResolvedValueOnce({ rows: [] });
      // Supplementary: daily_total at midnight UTC
      (mockPool.query as any).mockResolvedValueOnce({
        rows: [
          {
            metric_type: 'steps',
            value: '3200',
            unit: 'steps',
            recorded_at: '2026-02-17T00:00:00Z',
            metadata: { granularity: 'daily_total' },
          },
        ],
      });

      const summary = await healthService.getDailySummary('user-1', '2026-02-17');

      expect(summary.steps?.value).toBe(3200);
      expect(summary.steps?.samples).toBeUndefined();
    });

    it('should fall back to legacy midnight detection via supplementary query', async () => {
      // Main query: stale fragment within Chicago bounds
      (mockPool.query as any).mockResolvedValueOnce({
        rows: [
          {
            metric_type: 'steps',
            value: '200',
            unit: 'steps',
            recorded_at: '2026-02-17T14:00:00Z',
            metadata: {},
          },
        ],
      });
      // Supplementary: legacy midnight-UTC consolidated row (no granularity)
      (mockPool.query as any).mockResolvedValueOnce({
        rows: [
          {
            metric_type: 'steps',
            value: '7500',
            unit: 'steps',
            recorded_at: '2026-02-17T00:00:00Z',
            metadata: {},
          },
        ],
      });

      const summary = await healthService.getDailySummary('user-1', '2026-02-17');

      // Midnight row should win
      expect(summary.steps?.value).toBe(7500);
      expect(summary.steps?.samples).toBeUndefined();
    });

    it('should fall back to summing when legacy data has no midnight row', async () => {
      // Main query: fragments within Chicago bounds
      (mockPool.query as any).mockResolvedValueOnce({
        rows: [
          {
            metric_type: 'steps',
            value: '300',
            unit: 'steps',
            recorded_at: '2026-02-17T09:00:00Z',
            metadata: {},
          },
          {
            metric_type: 'steps',
            value: '450',
            unit: 'steps',
            recorded_at: '2026-02-17T14:30:00Z',
            metadata: {},
          },
        ],
      });
      // Supplementary: nothing at midnight UTC
      (mockPool.query as any).mockResolvedValueOnce({ rows: [] });

      const summary = await healthService.getDailySummary('user-1', '2026-02-17');
      expect(summary.steps?.value).toBe(750);
      expect(summary.steps?.samples).toBeUndefined();
    });

    it('should handle active_energy and exercise_minutes with granularity', async () => {
      // Main query: samples within Chicago bounds
      (mockPool.query as any).mockResolvedValueOnce({
        rows: [
          {
            metric_type: 'active_energy',
            value: '150',
            unit: 'kcal',
            recorded_at: '2026-02-17T07:00:00Z',
            metadata: { granularity: 'sample' },
          },
          {
            metric_type: 'active_energy',
            value: '270',
            unit: 'kcal',
            recorded_at: '2026-02-17T17:30:00Z',
            metadata: { granularity: 'sample' },
          },
        ],
      });
      // Supplementary: daily_totals at midnight UTC
      (mockPool.query as any).mockResolvedValueOnce({
        rows: [
          {
            metric_type: 'active_energy',
            value: '420',
            unit: 'kcal',
            recorded_at: '2026-02-17T00:00:00Z',
            metadata: { granularity: 'daily_total' },
          },
          {
            metric_type: 'exercise_minutes',
            value: '45',
            unit: 'minutes',
            recorded_at: '2026-02-17T00:00:00Z',
            metadata: { granularity: 'daily_total' },
          },
        ],
      });

      const summary = await healthService.getDailySummary('user-1', '2026-02-17');

      expect(summary.active_energy?.value).toBe(420);
      expect(summary.active_energy?.samples).toHaveLength(2);
      expect(summary.exercise_minutes?.value).toBe(45);
      expect(summary.exercise_minutes?.samples).toBeUndefined(); // no samples for exercise
    });

    it('should not double-count when daily_total appears in both queries', async () => {
      // Edge case: if somehow the daily_total is in both result sets
      (mockPool.query as any).mockResolvedValueOnce({
        rows: [
          {
            metric_type: 'steps',
            value: '5900',
            unit: 'steps',
            recorded_at: '2026-02-17T00:00:00Z',
            metadata: { granularity: 'daily_total' },
          },
          {
            metric_type: 'steps',
            value: '1200',
            unit: 'steps',
            recorded_at: '2026-02-17T08:15:00Z',
            metadata: { granularity: 'sample' },
          },
        ],
      });
      // Supplementary also returns the same daily_total
      (mockPool.query as any).mockResolvedValueOnce({
        rows: [
          {
            metric_type: 'steps',
            value: '5900',
            unit: 'steps',
            recorded_at: '2026-02-17T00:00:00Z',
            metadata: { granularity: 'daily_total' },
          },
        ],
      });

      const summary = await healthService.getDailySummary('user-1', '2026-02-17');

      // aggregateCumulative uses .find() for daily_total, so first match wins — value is still 5900
      expect(summary.steps?.value).toBe(5900);
      expect(summary.steps?.samples).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // formatSummaryForPrompt
  // -----------------------------------------------------------------------
  describe('formatSummaryForPrompt', () => {
    it('should include activity pattern when samples exist', () => {
      // Timestamps are UTC; Chicago is UTC-6 in Feb (CST).
      // 14:15Z = 08:15 Chicago → 06-09h bucket
      // 18:30Z = 12:30 Chicago → 12-15h bucket
      // 22:45Z = 16:45 Chicago → 15-18h bucket
      const summary: DailyHealthSummary = {
        date: '2026-02-17',
        steps: {
          value: 5900,
          recorded_at: new Date('2026-02-17T06:00:00Z'),
          samples: [
            { value: 1200, recorded_at: new Date('2026-02-17T14:15:00Z') },
            { value: 2300, recorded_at: new Date('2026-02-17T18:30:00Z') },
            { value: 2400, recorded_at: new Date('2026-02-17T22:45:00Z') },
          ],
        },
      };

      const text = healthService.formatSummaryForPrompt(summary);

      expect(text).toContain('Steps: 5,900');
      expect(text).toContain('By time:');
      // Chicago hours: 08:15, 12:30, 16:45
      expect(text).toContain('06-09h: 1,200');
      expect(text).toContain('12-15h: 2,300');
      expect(text).toContain('15-18h: 2,400');
    });

    it('should not show pattern line when there are no samples', () => {
      const summary: DailyHealthSummary = {
        date: '2026-02-17',
        steps: { value: 5900, recorded_at: new Date('2026-02-17T00:00:00Z') },
      };

      const text = healthService.formatSummaryForPrompt(summary);

      expect(text).toContain('Steps: 5,900');
      expect(text).not.toContain('By time');
    });

    it('should not show pattern line for a single sample', () => {
      const summary: DailyHealthSummary = {
        date: '2026-02-17',
        steps: {
          value: 500,
          recorded_at: new Date('2026-02-17T00:00:00Z'),
          samples: [{ value: 500, recorded_at: new Date('2026-02-17T10:00:00Z') }],
        },
      };

      const text = healthService.formatSummaryForPrompt(summary);
      expect(text).not.toContain('By time');
    });

    it('should show pattern for active energy and exercise minutes too', () => {
      // 13:00Z = 07:00 Chicago, 23:30Z = 17:30 Chicago
      const summary: DailyHealthSummary = {
        date: '2026-02-17',
        active_energy: {
          value: 420,
          unit: 'kcal',
          samples: [
            { value: 150, recorded_at: new Date('2026-02-17T13:00:00Z') },
            { value: 270, recorded_at: new Date('2026-02-17T23:30:00Z') },
          ],
        },
        exercise_minutes: {
          value: 45,
          samples: [
            { value: 20, recorded_at: new Date('2026-02-17T13:00:00Z') },
            { value: 25, recorded_at: new Date('2026-02-17T23:30:00Z') },
          ],
        },
      };

      const text = healthService.formatSummaryForPrompt(summary);

      expect(text).toContain('Active Energy: 420 kcal');
      expect(text).toContain('Exercise: 45 minutes');
      // Both should have By time patterns (now Chicago-based)
      expect(text.match(/By time:/g)).toHaveLength(2);
    });

    it('should bucket samples in the same 3-hour window together', () => {
      // 15:00Z = 09:00 Chicago, 16:30Z = 10:30 Chicago, 17:00Z = 11:00 Chicago
      // All three fall in 09-12h Chicago bucket
      const summary: DailyHealthSummary = {
        date: '2026-02-17',
        steps: {
          value: 1000,
          recorded_at: new Date('2026-02-17T06:00:00Z'),
          samples: [
            { value: 200, recorded_at: new Date('2026-02-17T15:00:00Z') },
            { value: 300, recorded_at: new Date('2026-02-17T16:30:00Z') },
            { value: 500, recorded_at: new Date('2026-02-17T17:00:00Z') },
          ],
        },
      };

      const text = healthService.formatSummaryForPrompt(summary);
      // All 3 samples fall in 09-12h Chicago bucket
      expect(text).toContain('09-12h: 1,000');
    });

    it('should show no data message for empty summary', () => {
      const summary: DailyHealthSummary = { date: '2026-02-17' };
      const text = healthService.formatSummaryForPrompt(summary);
      expect(text).toContain('No health data recorded for this day');
    });
  });
});

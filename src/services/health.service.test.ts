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
  // -----------------------------------------------------------------------
  describe('getDailySummary', () => {
    it('should use daily_total record and attach samples when granularity metadata is present', async () => {
      (mockPool.query as any).mockResolvedValueOnce({
        rows: [
          // daily_total
          {
            metric_type: 'steps',
            value: '5900',
            unit: 'steps',
            recorded_at: '2026-02-17T00:00:00Z',
            metadata: { granularity: 'daily_total' },
          },
          // individual samples
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

    it('should fall back to legacy midnight detection when no granularity metadata', async () => {
      (mockPool.query as any).mockResolvedValueOnce({
        rows: [
          // Legacy midnight-UTC consolidated row (no granularity metadata)
          {
            metric_type: 'steps',
            value: '7500',
            unit: 'steps',
            recorded_at: '2026-02-17T00:00:00Z',
            metadata: {},
          },
          // Stale fragment (shouldn't happen after migration 045 but be safe)
          {
            metric_type: 'steps',
            value: '200',
            unit: 'steps',
            recorded_at: '2026-02-17T14:00:00Z',
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

      const summary = await healthService.getDailySummary('user-1', '2026-02-17');
      expect(summary.steps?.value).toBe(750);
      expect(summary.steps?.samples).toBeUndefined();
    });

    it('should handle active_energy and exercise_minutes with granularity', async () => {
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
  });

  // -----------------------------------------------------------------------
  // formatSummaryForPrompt
  // -----------------------------------------------------------------------
  describe('formatSummaryForPrompt', () => {
    it('should include activity pattern when samples exist', () => {
      const summary: DailyHealthSummary = {
        date: '2026-02-17',
        steps: {
          value: 5900,
          recorded_at: new Date('2026-02-17T00:00:00Z'),
          samples: [
            { value: 1200, recorded_at: new Date('2026-02-17T08:15:00Z') },
            { value: 2300, recorded_at: new Date('2026-02-17T12:30:00Z') },
            { value: 2400, recorded_at: new Date('2026-02-17T16:45:00Z') },
          ],
        },
      };

      const text = healthService.formatSummaryForPrompt(summary);

      expect(text).toContain('Steps: 5,900');
      expect(text).toContain('By time (UTC):');
      // 08:15 → bucket 06-09h, 12:30 → 12-15h, 16:45 → 15-18h
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
      const summary: DailyHealthSummary = {
        date: '2026-02-17',
        active_energy: {
          value: 420,
          unit: 'kcal',
          samples: [
            { value: 150, recorded_at: new Date('2026-02-17T07:00:00Z') },
            { value: 270, recorded_at: new Date('2026-02-17T17:30:00Z') },
          ],
        },
        exercise_minutes: {
          value: 45,
          samples: [
            { value: 20, recorded_at: new Date('2026-02-17T07:00:00Z') },
            { value: 25, recorded_at: new Date('2026-02-17T17:30:00Z') },
          ],
        },
      };

      const text = healthService.formatSummaryForPrompt(summary);

      expect(text).toContain('Active Energy: 420 kcal');
      expect(text).toContain('Exercise: 45 minutes');
      // Both should have By time patterns
      expect(text.match(/By time \(UTC\)/g)).toHaveLength(2);
    });

    it('should bucket samples in the same 3-hour window together', () => {
      const summary: DailyHealthSummary = {
        date: '2026-02-17',
        steps: {
          value: 1000,
          recorded_at: new Date('2026-02-17T00:00:00Z'),
          samples: [
            { value: 200, recorded_at: new Date('2026-02-17T09:00:00Z') },
            { value: 300, recorded_at: new Date('2026-02-17T10:30:00Z') },
            { value: 500, recorded_at: new Date('2026-02-17T11:00:00Z') },
          ],
        },
      };

      const text = healthService.formatSummaryForPrompt(summary);
      // All 3 samples fall in 09-12h bucket
      expect(text).toContain('09-12h: 1,000');
    });

    it('should show no data message for empty summary', () => {
      const summary: DailyHealthSummary = { date: '2026-02-17' };
      const text = healthService.formatSummaryForPrompt(summary);
      expect(text).toContain('No health data recorded for this day');
    });
  });
});

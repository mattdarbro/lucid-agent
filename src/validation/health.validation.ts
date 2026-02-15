import { z } from 'zod';

// Metric types that can be synced from HealthKit / Oura / manual entry
export const healthMetricTypeSchema = z.enum([
  'blood_pressure_systolic',
  'blood_pressure_diastolic',
  'weight',
  'steps',
  'heart_rate',
  'resting_heart_rate',
  'blood_oxygen',
  'respiratory_rate',
  'body_temperature',
  'sleep_duration',
  'active_energy',
  'exercise_minutes',
]);

export const healthMetricSourceSchema = z.enum([
  'apple_health',
  'oura_ring',
  'manual',
  'withings',
]);

// Single metric submitted from the iOS app
export const createHealthMetricSchema = z.object({
  user_id: z.string().uuid(),
  metric_type: healthMetricTypeSchema,
  value: z.number(),
  unit: z.string().min(1).max(50),
  recorded_at: z.coerce.date(),
  source: healthMetricSourceSchema.default('apple_health'),
  source_device: z.string().max(200).optional(),
  metadata: z.record(z.any()).optional(),
});

// Batch sync: iOS app sends multiple metrics at once
export const batchHealthMetricsSchema = z.object({
  user_id: z.string().uuid(),
  metrics: z.array(
    z.object({
      metric_type: healthMetricTypeSchema,
      value: z.number(),
      unit: z.string().min(1).max(50),
      recorded_at: z.coerce.date(),
      source: healthMetricSourceSchema.default('apple_health'),
      source_device: z.string().max(200).optional(),
      metadata: z.record(z.any()).optional(),
    })
  ).min(1).max(500),
});

// Query parameters for fetching health data
export const queryHealthMetricsSchema = z.object({
  metric_type: healthMetricTypeSchema.optional(),
  source: healthMetricSourceSchema.optional(),
  start_date: z.coerce.date().optional(),
  end_date: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

// Query for a daily health summary
export const dailySummarySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format').optional(),
  days: z.coerce.number().int().min(1).max(90).default(1),
});

export type CreateHealthMetricInput = z.infer<typeof createHealthMetricSchema>;
export type BatchHealthMetricsInput = z.infer<typeof batchHealthMetricsSchema>;
export type QueryHealthMetricsInput = z.infer<typeof queryHealthMetricsSchema>;
export type DailySummaryInput = z.infer<typeof dailySummarySchema>;

import { z } from 'zod';

// Job types aligned with database schema
export const jobTypeSchema = z.enum([
  'morning_reflection',
  'midday_curiosity',
  'evening_consolidation',
  'night_dream',
]);

// Job status aligned with database schema
export const jobStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
]);

// Create agent job schema
export const createAgentJobSchema = z.object({
  user_id: z.string().uuid(),
  job_type: jobTypeSchema,
  scheduled_for: z.coerce.date(),
});

// Update agent job schema
export const updateAgentJobSchema = z.object({
  status: jobStatusSchema.optional(),
  thoughts_generated: z.number().int().min(0).optional(),
  research_tasks_created: z.number().int().min(0).optional(),
  error_message: z.string().optional(),
  started_at: z.coerce.date().optional(),
  completed_at: z.coerce.date().optional(),
});

// Query params for listing jobs
export const listAgentJobsSchema = z.object({
  user_id: z.string().uuid().optional(),
  job_type: jobTypeSchema.optional(),
  status: jobStatusSchema.optional(),
  scheduled_after: z.coerce.date().optional(),
  scheduled_before: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type JobType = z.infer<typeof jobTypeSchema>;
export type JobStatus = z.infer<typeof jobStatusSchema>;
export type CreateAgentJobInput = z.infer<typeof createAgentJobSchema>;
export type UpdateAgentJobInput = z.infer<typeof updateAgentJobSchema>;
export type ListAgentJobsInput = z.infer<typeof listAgentJobsSchema>;

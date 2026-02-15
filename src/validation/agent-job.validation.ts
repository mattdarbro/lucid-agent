import { z } from 'zod';

// Job types aligned with database schema
export const jobTypeSchema = z.enum([
  'morning_reflection',
  'midday_curiosity',
  'afternoon_synthesis',
  'evening_consolidation',
  'night_dream',
  // Specialized AT Session Types (layered memory system)
  'morning_curiosity_session',
  'dream_session',
  'state_session',
  'orbit_session',
  // Document Reflection (Living Document maintenance)
  'document_reflection',
  // Self-review (Thursday night code review)
  'self_review',
  // Investment & Spending loops
  'investment_research',
  'ability_spending',
  // Health monitoring loops
  'health_check_morning',
  'health_check_evening',
]);

// Job status aligned with database schema
export const jobStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'skipped', // User disabled agents after job was scheduled
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

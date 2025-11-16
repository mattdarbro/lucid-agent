import { z } from 'zod';

/**
 * Validation schemas for multi-day research tasks
 * Tracks long-running collaborative thinking across multiple days
 * Supports temporal cognitive diversity research
 */

// Question types and their optimal times
export const questionTypeEnum = z.enum([
  'analytical',      // Best for morning: financial analysis, logical reasoning, complex problem-solving
  'creative',        // Best for morning/afternoon: brainstorming, design, novel solutions
  'experiential',    // Best for afternoon: lifestyle impact, social aspects, action planning
  'reflective',      // Best for evening: emotional processing, looking back, gentle introspection
  'philosophical',   // Best for late night: big picture, meaning, patterns (but not decisions!)
  'comfort',         // Best for evening: what would feel good, ease, relaxation
  'aspirational',    // Best for morning: big dreams, ideal futures, vision
  'tactical',        // Best for morning/afternoon: specific next steps, concrete actions
]);

export type QuestionType = z.infer<typeof questionTypeEnum>;

// Task status
export const taskStatusEnum = z.enum(['active', 'paused', 'completed', 'abandoned']);

/**
 * Create a new multi-day research task
 */
export const createMultiDayTaskSchema = z.object({
  user_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  topic_category: z.string().max(100).optional(),
  target_completion_date: z.string().date().optional(),

  // Temporal strategy
  check_in_times: z.array(z.enum(['morning', 'afternoon', 'evening', 'late_night'])).default(['morning', 'evening']),
  duration_days: z.number().int().min(1).max(30).default(5),

  // Initial context
  initial_context: z.string().max(5000).optional(),
});

export type CreateMultiDayTaskInput = z.infer<typeof createMultiDayTaskSchema>;

/**
 * Update a research task
 */
export const updateMultiDayTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  status: taskStatusEnum.optional(),
  target_completion_date: z.string().date().optional(),
  final_synthesis: z.string().max(10000).optional(),
});

export type UpdateMultiDayTaskInput = z.infer<typeof updateMultiDayTaskSchema>;

/**
 * Add a check-in to a research task
 */
export const addCheckInSchema = z.object({
  notification_id: z.string().uuid().optional(),
  time_of_day: z.enum(['morning', 'afternoon', 'evening', 'late_night']),
  question_asked: z.string().min(1).max(2000),
  question_type: questionTypeEnum,
  response: z.string().min(1).max(10000),

  // User state at time of response
  self_reported_energy: z.number().int().min(1).max(5).optional(),
  self_reported_mood: z.number().int().min(1).max(5).optional(),
  self_reported_focus: z.number().int().min(1).max(5).optional(),

  // Insights extracted from this check-in
  insights: z.array(z.string()).default([]),
  detected_state: z.enum(['analytical', 'creative', 'reflective', 'philosophical', 'emotional']).optional(),
});

export type AddCheckInInput = z.infer<typeof addCheckInSchema>;

/**
 * Generate synthesis for completed task
 */
export const generateSynthesisSchema = z.object({
  task_id: z.string().uuid(),
  include_temporal_analysis: z.boolean().default(true),
});

export type GenerateSynthesisInput = z.infer<typeof generateSynthesisSchema>;

/**
 * Question template for temporal check-ins
 */
export const questionTemplateSchema = z.object({
  question_text: z.string().min(1).max(1000),
  question_type: questionTypeEnum,
  optimal_time_of_day: z.enum(['morning', 'afternoon', 'evening', 'late_night', 'any']),
  avoid_when_tired: z.boolean().default(false),
  requires_high_energy: z.boolean().default(false),
  variables: z.record(z.string()).optional(), // For templating: {topic: "practice expansion"}
});

export type QuestionTemplate = z.infer<typeof questionTemplateSchema>;

/**
 * Query params for listing tasks
 */
export const multiDayTaskListQuerySchema = z.object({
  status: taskStatusEnum.optional(),
  topic_category: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type MultiDayTaskListQuery = z.infer<typeof multiDayTaskListQuerySchema>;

/**
 * Task ID param
 */
export const multiDayTaskIdSchema = z.object({
  id: z.string().uuid(),
});

export type MultiDayTaskIdParam = z.infer<typeof multiDayTaskIdSchema>;

/**
 * Check-in structure stored in JSONB
 */
export interface CheckInRecord {
  check_in_number: number;
  time_of_day: string;
  scheduled_for?: string;
  completed_at?: string;
  notification_id?: string;
  question_asked?: string;
  question_type?: QuestionType;
  response?: string;
  insights: string[];
  detected_state?: string;
  self_reported_energy?: number;
  self_reported_mood?: number;
  self_reported_focus?: number;
}

/**
 * Temporal analysis in synthesis
 */
export interface TemporalAnalysis {
  morning_insights: string[];
  afternoon_insights: string[];
  evening_insights: string[];
  late_night_insights: string[];
  state_consistency: string; // "Morning you and evening you agree" or "Conflicting perspectives"
  optimal_decision_time: string; // "Based on patterns, make this decision in the morning"
  genie_test_results?: { // The "what would you wish for" test
    morning_wish: string;
    afternoon_wish: string;
    evening_wish: string;
    night_wish: string;
  };
}

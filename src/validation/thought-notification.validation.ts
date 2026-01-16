import { z } from 'zod';

/**
 * Validation schemas for thought notifications
 * Enables Lucid to queue questions/observations for users at optimal times
 */

// Time of day options
export const timeOfDayEnum = z.enum(['morning', 'afternoon', 'evening', 'late_night', 'any']);

// Cognitive state options
export const cognitiveStateEnum = z.enum(['analytical', 'creative', 'reflective', 'philosophical', 'emotional', 'any']);

// Notification status
export const notificationStatusEnum = z.enum(['pending', 'sent', 'responded', 'expired', 'skipped']);

/**
 * Create a new thought notification
 */
export const createThoughtNotificationSchema = z.object({
  user_id: z.string().uuid(),
  thought_id: z.string().uuid().optional(),
  research_task_id: z.string().uuid().optional(),
  question: z.string().min(1).max(2000),
  context: z.string().max(5000).optional(),
  preferred_time_of_day: timeOfDayEnum.default('any'),
  preferred_cognitive_state: cognitiveStateEnum.default('any'),
  priority: z.number().min(0).max(1).default(0.5),
  expires_at: z.string().datetime().optional(),
});

export type CreateThoughtNotificationInput = z.infer<typeof createThoughtNotificationSchema>;

/**
 * Update a thought notification
 */
export const updateThoughtNotificationSchema = z.object({
  question: z.string().min(1).max(2000).optional(),
  context: z.string().max(5000).optional(),
  preferred_time_of_day: timeOfDayEnum.optional(),
  preferred_cognitive_state: cognitiveStateEnum.optional(),
  priority: z.number().min(0).max(1).optional(),
  expires_at: z.string().datetime().optional(),
  status: notificationStatusEnum.optional(),
});

export type UpdateThoughtNotificationInput = z.infer<typeof updateThoughtNotificationSchema>;

/**
 * Respond to a thought notification
 */
export const respondToNotificationSchema = z.object({
  response_text: z.string().min(1).max(10000),
  self_reported_energy: z.number().int().min(1).max(5).optional(),
  self_reported_mood: z.number().int().min(1).max(5).optional(),
  self_reported_focus: z.number().int().min(1).max(5).optional(),
});

export type RespondToNotificationInput = z.infer<typeof respondToNotificationSchema>;

/**
 * Query params for listing notifications
 */
export const notificationListQuerySchema = z.object({
  status: notificationStatusEnum.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

/**
 * Notification ID param
 */
export const notificationIdSchema = z.object({
  id: z.string().uuid(),
});

export type NotificationIdParam = z.infer<typeof notificationIdSchema>;

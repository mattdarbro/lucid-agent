import { z } from 'zod';

/**
 * Validation schemas for user-related operations
 *
 * These schemas ensure data integrity and provide type safety
 */

// Common timezone values (add more as needed)
const timezones = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'America/Honolulu',
  'Europe/London',
  'Europe/Paris',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Australia/Sydney',
] as const;

/**
 * Schema for creating a new user
 */
export const createUserSchema = z.object({
  external_id: z
    .string()
    .min(1, 'external_id is required')
    .max(255, 'external_id must be less than 255 characters')
    .regex(/^[a-zA-Z0-9_-]+$/, 'external_id can only contain alphanumeric characters, hyphens, and underscores'),

  name: z
    .string()
    .min(1, 'name is required')
    .max(255, 'name must be less than 255 characters')
    .optional(),

  email: z
    .string()
    .email('Invalid email address')
    .max(255, 'email must be less than 255 characters')
    .optional(),

  timezone: z
    .string()
    .refine(
      (tz: string) => {
        // Allow any valid IANA timezone string
        try {
          Intl.DateTimeFormat(undefined, { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      },
      { message: 'Invalid timezone' }
    )
    .default('UTC'),

  preferences: z
    .record(z.any())
    .optional()
    .default({}),
});

/**
 * Schema for updating an existing user
 */
export const updateUserSchema = z.object({
  name: z
    .string()
    .min(1, 'name cannot be empty')
    .max(255, 'name must be less than 255 characters')
    .optional(),

  email: z
    .string()
    .email('Invalid email address')
    .max(255, 'email must be less than 255 characters')
    .optional(),

  timezone: z
    .string()
    .refine(
      (tz: string) => {
        try {
          Intl.DateTimeFormat(undefined, { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      },
      { message: 'Invalid timezone' }
    )
    .optional(),

  preferences: z
    .record(z.any())
    .optional(),
});

/**
 * Schema for user external_id parameter
 */
export const userExternalIdSchema = z.object({
  external_id: z
    .string()
    .min(1, 'external_id is required')
    .max(255, 'external_id must be less than 255 characters'),
});

// Type exports for use in services and routes
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type UserExternalIdParam = z.infer<typeof userExternalIdSchema>;

import { Pool, QueryResult } from 'pg';
import { logger } from '../logger';
import { CreateUserInput, UpdateUserInput } from '../validation/user.validation';

/**
 * User entity from database
 */
export interface User {
  id: string;
  external_id: string;
  name: string | null;
  email: string | null;
  timezone: string;
  preferences: Record<string, any>;
  created_at: Date;
  last_active_at: Date;
}

/**
 * UserService
 *
 * Handles all user-related business logic and database operations.
 * This service provides a clean separation between routes and data access.
 */
export class UserService {
  constructor(private pool: Pool) {}

  /**
   * Creates a new user or updates existing user if external_id already exists
   *
   * Uses UPSERT pattern (ON CONFLICT) to handle the iOS app scenario where
   * the same user might call this endpoint multiple times.
   *
   * @param input - Validated user creation data
   * @returns The created or updated user
   */
  async createOrUpdateUser(input: CreateUserInput): Promise<User> {
    try {
      const result: QueryResult<User> = await this.pool.query(
        `INSERT INTO users (external_id, name, email, timezone, preferences)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (external_id)
         DO UPDATE SET
           name = EXCLUDED.name,
           email = EXCLUDED.email,
           timezone = EXCLUDED.timezone,
           preferences = EXCLUDED.preferences,
           last_active_at = NOW()
         RETURNING *`,
        [
          input.external_id,
          input.name || null,
          input.email || null,
          input.timezone || 'UTC',
          input.preferences || {},
        ]
      );

      const user = result.rows[0];
      logger.info(`User created/updated: ${user.id} (external_id: ${user.external_id})`);

      return user;
    } catch (error: any) {
      logger.error('Error creating/updating user:', error);
      throw new Error(`Failed to create user: ${error.message}`);
    }
  }

  /**
   * Finds a user by their external ID (e.g., iOS app user ID)
   *
   * @param external_id - The external identifier (from iOS app)
   * @returns The user if found, null otherwise
   */
  async findByExternalId(external_id: string): Promise<User | null> {
    try {
      const result: QueryResult<User> = await this.pool.query(
        'SELECT * FROM users WHERE external_id = $1',
        [external_id]
      );

      if (result.rows.length === 0) {
        logger.debug(`User not found with external_id: ${external_id}`);
        return null;
      }

      return result.rows[0];
    } catch (error: any) {
      logger.error('Error finding user by external_id:', error);
      throw new Error(`Failed to find user: ${error.message}`);
    }
  }

  /**
   * Finds a user by their internal UUID
   *
   * @param id - The internal user UUID
   * @returns The user if found, null otherwise
   */
  async findById(id: string): Promise<User | null> {
    try {
      const result: QueryResult<User> = await this.pool.query(
        'SELECT * FROM users WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        logger.debug(`User not found with id: ${id}`);
        return null;
      }

      return result.rows[0];
    } catch (error: any) {
      logger.error('Error finding user by id:', error);
      throw new Error(`Failed to find user: ${error.message}`);
    }
  }

  /**
   * Updates an existing user
   *
   * @param id - The internal user UUID
   * @param input - Validated update data
   * @returns The updated user if found, null otherwise
   */
  async updateUser(id: string, input: UpdateUserInput): Promise<User | null> {
    try {
      // Build dynamic update query based on provided fields
      const updates: string[] = [];
      const values: any[] = [];
      let paramCount = 1;

      if (input.name !== undefined) {
        updates.push(`name = $${paramCount++}`);
        values.push(input.name);
      }

      if (input.email !== undefined) {
        updates.push(`email = $${paramCount++}`);
        values.push(input.email);
      }

      if (input.timezone !== undefined) {
        updates.push(`timezone = $${paramCount++}`);
        values.push(input.timezone);
      }

      if (input.preferences !== undefined) {
        updates.push(`preferences = $${paramCount++}`);
        values.push(input.preferences);
      }

      // Always update last_active_at
      updates.push(`last_active_at = NOW()`);

      if (updates.length === 1) {
        // Only last_active_at would be updated, which is pointless
        logger.debug(`No fields to update for user: ${id}`);
        return await this.findById(id);
      }

      values.push(id); // Add id as final parameter

      const result: QueryResult<User> = await this.pool.query(
        `UPDATE users
         SET ${updates.join(', ')}
         WHERE id = $${paramCount}
         RETURNING *`,
        values
      );

      if (result.rows.length === 0) {
        logger.debug(`User not found for update: ${id}`);
        return null;
      }

      const user = result.rows[0];
      logger.info(`User updated: ${user.id}`);

      return user;
    } catch (error: any) {
      logger.error('Error updating user:', error);
      throw new Error(`Failed to update user: ${error.message}`);
    }
  }

  /**
   * Updates the user's last active timestamp
   * Useful for tracking user activity without full updates
   *
   * @param id - The internal user UUID
   * @returns True if updated successfully
   */
  async updateLastActive(id: string): Promise<boolean> {
    try {
      const result = await this.pool.query(
        'UPDATE users SET last_active_at = NOW() WHERE id = $1',
        [id]
      );

      return result.rowCount !== null && result.rowCount > 0;
    } catch (error: any) {
      logger.error('Error updating last active:', error);
      throw new Error(`Failed to update last active: ${error.message}`);
    }
  }

  /**
   * Deletes a user by ID
   * Note: This will cascade to related records (conversations, messages, etc.)
   *
   * @param id - The internal user UUID
   * @returns True if user was deleted, false if not found
   */
  async deleteUser(id: string): Promise<boolean> {
    try {
      const result = await this.pool.query(
        'DELETE FROM users WHERE id = $1',
        [id]
      );

      const deleted = result.rowCount !== null && result.rowCount > 0;

      if (deleted) {
        logger.info(`User deleted: ${id}`);
      } else {
        logger.debug(`User not found for deletion: ${id}`);
      }

      return deleted;
    } catch (error: any) {
      logger.error('Error deleting user:', error);
      throw new Error(`Failed to delete user: ${error.message}`);
    }
  }

  /**
   * Lists all users (with optional pagination)
   * Use with caution in production - add pagination limits
   *
   * @param limit - Maximum number of users to return
   * @param offset - Number of users to skip
   * @returns Array of users
   */
  async listUsers(limit: number = 100, offset: number = 0): Promise<User[]> {
    try {
      const result: QueryResult<User> = await this.pool.query(
        `SELECT * FROM users
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );

      return result.rows;
    } catch (error: any) {
      logger.error('Error listing users:', error);
      throw new Error(`Failed to list users: ${error.message}`);
    }
  }
}

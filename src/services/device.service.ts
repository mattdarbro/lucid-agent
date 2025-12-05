import { Pool } from 'pg';
import { logger } from '../logger';

/**
 * DeviceService
 *
 * Manages device linking and multi-device support
 * Allows users to link multiple devices (iPhone, iPad, etc.) to the same account
 */
export class DeviceService {
  constructor(private pool: Pool) {}

  /**
   * Register a device for a user
   */
  async registerDevice(
    userId: string,
    deviceId: string,
    deviceName?: string,
    deviceType?: string,
    pushToken?: string
  ): Promise<{ id: string; isNew: boolean }> {
    try {
      // Check if device already exists
      const existing = await this.pool.query(
        'SELECT id, user_id FROM user_devices WHERE device_id = $1',
        [deviceId]
      );

      if (existing.rows.length > 0) {
        const existingDevice = existing.rows[0];

        // Update the device info
        await this.pool.query(
          `UPDATE user_devices
           SET device_name = COALESCE($2, device_name),
               device_type = COALESCE($3, device_type),
               push_token = COALESCE($4, push_token),
               push_token_updated_at = CASE WHEN $4 IS NOT NULL THEN NOW() ELSE push_token_updated_at END,
               last_seen_at = NOW(),
               is_active = true
           WHERE id = $1`,
          [existingDevice.id, deviceName, deviceType, pushToken]
        );

        logger.debug('Device updated', { deviceId, userId: existingDevice.user_id });
        return { id: existingDevice.id, isNew: false };
      }

      // Create new device
      const result = await this.pool.query(
        `INSERT INTO user_devices (user_id, device_id, device_name, device_type, push_token, push_token_updated_at)
         VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 IS NOT NULL THEN NOW() ELSE NULL END)
         RETURNING id`,
        [userId, deviceId, deviceName, deviceType, pushToken]
      );

      logger.info('New device registered', { deviceId, userId, deviceName, deviceType });
      return { id: result.rows[0].id, isNew: true };
    } catch (error) {
      logger.error('Failed to register device', { deviceId, userId, error });
      throw new Error('Failed to register device');
    }
  }

  /**
   * Generate a link code for connecting another device to this account
   * Code is valid for 10 minutes
   */
  async generateLinkCode(userId: string): Promise<{ code: string; expiresAt: Date }> {
    try {
      // Invalidate any existing unused codes for this user
      await this.pool.query(
        `UPDATE device_link_codes
         SET expires_at = NOW()
         WHERE user_id = $1 AND used_at IS NULL AND expires_at > NOW()`,
        [userId]
      );

      // Generate a new code
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      const result = await this.pool.query(
        `INSERT INTO device_link_codes (user_id, code, expires_at)
         VALUES ($1, generate_link_code(), $2)
         RETURNING code, expires_at`,
        [userId, expiresAt]
      );

      const { code, expires_at } = result.rows[0];
      logger.info('Link code generated', { userId, code, expiresAt: expires_at });

      return { code, expiresAt: new Date(expires_at) };
    } catch (error) {
      logger.error('Failed to generate link code', { userId, error });
      throw new Error('Failed to generate link code');
    }
  }

  /**
   * Redeem a link code to connect a device to an existing account
   * Returns the user_id of the account being linked to
   */
  async redeemLinkCode(
    code: string,
    newDeviceId: string,
    deviceName?: string,
    deviceType?: string
  ): Promise<{ userId: string; userName?: string } | null> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Find and validate the code
      const codeResult = await client.query(
        `SELECT dlc.id, dlc.user_id, u.name as user_name
         FROM device_link_codes dlc
         JOIN users u ON u.id = dlc.user_id
         WHERE dlc.code = $1
           AND dlc.used_at IS NULL
           AND dlc.expires_at > NOW()
         FOR UPDATE`,
        [code.toUpperCase()]
      );

      if (codeResult.rows.length === 0) {
        await client.query('ROLLBACK');
        logger.warn('Invalid or expired link code', { code });
        return null;
      }

      const { id: codeId, user_id: userId, user_name: userName } = codeResult.rows[0];

      // Check if device is already linked to another user
      const existingDevice = await client.query(
        'SELECT user_id FROM user_devices WHERE device_id = $1',
        [newDeviceId]
      );

      if (existingDevice.rows.length > 0 && existingDevice.rows[0].user_id !== userId) {
        // Device was linked to a different user - update to new user
        await client.query(
          `UPDATE user_devices
           SET user_id = $1, device_name = COALESCE($3, device_name), device_type = COALESCE($4, device_type), last_seen_at = NOW()
           WHERE device_id = $2`,
          [userId, newDeviceId, deviceName, deviceType]
        );
        logger.info('Device relinked to different account', { deviceId: newDeviceId, oldUserId: existingDevice.rows[0].user_id, newUserId: userId });
      } else if (existingDevice.rows.length === 0) {
        // New device - register it
        await client.query(
          `INSERT INTO user_devices (user_id, device_id, device_name, device_type)
           VALUES ($1, $2, $3, $4)`,
          [userId, newDeviceId, deviceName, deviceType]
        );
        logger.info('New device linked via code', { deviceId: newDeviceId, userId });
      }

      // Mark the code as used
      await client.query(
        `UPDATE device_link_codes
         SET used_at = NOW(), used_by_device_id = $2
         WHERE id = $1`,
        [codeId, newDeviceId]
      );

      await client.query('COMMIT');

      logger.info('Link code redeemed successfully', { code, userId, deviceId: newDeviceId });
      return { userId, userName: userName || undefined };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to redeem link code', { code, error });
      throw new Error('Failed to redeem link code');
    } finally {
      client.release();
    }
  }

  /**
   * Get all devices for a user
   */
  async getUserDevices(userId: string): Promise<Array<{
    id: string;
    deviceId: string;
    deviceName: string | null;
    deviceType: string | null;
    isActive: boolean;
    lastSeenAt: Date;
    createdAt: Date;
  }>> {
    const result = await this.pool.query(
      `SELECT id, device_id, device_name, device_type, is_active, last_seen_at, created_at
       FROM user_devices
       WHERE user_id = $1
       ORDER BY last_seen_at DESC`,
      [userId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      deviceId: row.device_id,
      deviceName: row.device_name,
      deviceType: row.device_type,
      isActive: row.is_active,
      lastSeenAt: new Date(row.last_seen_at),
      createdAt: new Date(row.created_at),
    }));
  }

  /**
   * Rename a device
   */
  async renameDevice(userId: string, deviceId: string, newName: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE user_devices
       SET device_name = $3
       WHERE user_id = $1 AND device_id = $2`,
      [userId, deviceId, newName]
    );

    return result.rowCount !== null && result.rowCount > 0;
  }

  /**
   * Deactivate a device (soft delete)
   */
  async deactivateDevice(userId: string, deviceId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE user_devices
       SET is_active = false
       WHERE user_id = $1 AND device_id = $2`,
      [userId, deviceId]
    );

    logger.info('Device deactivated', { userId, deviceId });
    return result.rowCount !== null && result.rowCount > 0;
  }

  /**
   * Get user_id for a device
   */
  async getUserIdForDevice(deviceId: string): Promise<string | null> {
    const result = await this.pool.query(
      'SELECT user_id FROM user_devices WHERE device_id = $1 AND is_active = true',
      [deviceId]
    );

    return result.rows.length > 0 ? result.rows[0].user_id : null;
  }

  /**
   * Update device's last seen timestamp
   */
  async touchDevice(deviceId: string): Promise<void> {
    await this.pool.query(
      'UPDATE user_devices SET last_seen_at = NOW() WHERE device_id = $1',
      [deviceId]
    );
  }

  /**
   * Get all active device push tokens for a user
   * Used for sending notifications to all devices
   */
  async getDevicePushTokens(userId: string): Promise<Array<{ deviceId: string; pushToken: string }>> {
    const result = await this.pool.query(
      `SELECT device_id, push_token
       FROM user_devices
       WHERE user_id = $1 AND is_active = true AND push_token IS NOT NULL`,
      [userId]
    );

    return result.rows.map((row) => ({
      deviceId: row.device_id,
      pushToken: row.push_token,
    }));
  }
}

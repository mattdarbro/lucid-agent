import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { logger } from '../logger';
import { DeviceService } from '../services/device.service';
import { z } from 'zod';

const router = Router();
const deviceService = new DeviceService(pool);

/**
 * Validation schemas
 */
const registerDeviceSchema = z.object({
  userId: z.string().uuid(),
  deviceId: z.string().min(1),
  deviceName: z.string().optional(),
  deviceType: z.enum(['iphone', 'ipad', 'web']).optional(),
  pushToken: z.string().optional(),
});

const generateLinkCodeSchema = z.object({
  userId: z.string().uuid(),
});

const redeemLinkCodeSchema = z.object({
  code: z.string().min(4).max(10),
  deviceId: z.string().min(1),
  deviceName: z.string().optional(),
  deviceType: z.enum(['iphone', 'ipad', 'web']).optional(),
});

const renameDeviceSchema = z.object({
  deviceName: z.string().min(1).max(100),
});

/**
 * Validation middleware helper
 */
function validateBody(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: Function) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.errors.map((err: any) => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        });
      }
      next(error);
    }
  };
}

/**
 * POST /v1/devices/register
 *
 * Register a device for a user. Called when app launches.
 *
 * Request body:
 * - userId: string (required) - User's UUID
 * - deviceId: string (required) - Unique device identifier
 * - deviceName: string (optional) - User-friendly name
 * - deviceType: 'iphone' | 'ipad' | 'web' (optional)
 * - pushToken: string (optional) - Push notification token
 */
router.post('/register', validateBody(registerDeviceSchema), async (req: Request, res: Response) => {
  try {
    const { userId, deviceId, deviceName, deviceType, pushToken } = req.body;

    const result = await deviceService.registerDevice(userId, deviceId, deviceName, deviceType, pushToken);

    res.status(result.isNew ? 201 : 200).json({
      id: result.id,
      registered: result.isNew,
      message: result.isNew ? 'Device registered successfully' : 'Device updated successfully',
    });
  } catch (error: any) {
    logger.error('Error in POST /v1/devices/register:', error);
    res.status(500).json({ error: 'Failed to register device' });
  }
});

/**
 * POST /v1/devices/link-code
 *
 * Generate a link code for connecting another device to this account.
 * The code is valid for 10 minutes.
 *
 * Request body:
 * - userId: string (required) - User's UUID
 *
 * Response:
 * - code: string - 6-character alphanumeric code
 * - expiresAt: string - ISO timestamp when code expires
 */
router.post('/link-code', validateBody(generateLinkCodeSchema), async (req: Request, res: Response) => {
  try {
    const { userId } = req.body;

    const result = await deviceService.generateLinkCode(userId);

    res.status(201).json({
      code: result.code,
      expiresAt: result.expiresAt.toISOString(),
      message: 'Enter this code on your other device to link it to your account',
    });
  } catch (error: any) {
    logger.error('Error in POST /v1/devices/link-code:', error);
    res.status(500).json({ error: 'Failed to generate link code' });
  }
});

/**
 * POST /v1/devices/redeem
 *
 * Redeem a link code to connect this device to an existing account.
 *
 * Request body:
 * - code: string (required) - The 6-character link code
 * - deviceId: string (required) - This device's unique identifier
 * - deviceName: string (optional) - User-friendly name for this device
 * - deviceType: 'iphone' | 'ipad' | 'web' (optional)
 *
 * Response:
 * - userId: string - The user account this device is now linked to
 * - userName: string | null - The user's name (if set)
 * - message: string
 */
router.post('/redeem', validateBody(redeemLinkCodeSchema), async (req: Request, res: Response) => {
  try {
    const { code, deviceId, deviceName, deviceType } = req.body;

    const result = await deviceService.redeemLinkCode(code, deviceId, deviceName, deviceType);

    if (!result) {
      return res.status(400).json({
        error: 'Invalid or expired code',
        message: 'The link code is invalid or has expired. Please generate a new code on your other device.',
      });
    }

    res.status(200).json({
      userId: result.userId,
      userName: result.userName,
      message: result.userName
        ? `Successfully linked to ${result.userName}'s account`
        : 'Successfully linked to account',
    });
  } catch (error: any) {
    logger.error('Error in POST /v1/devices/redeem:', error);
    res.status(500).json({ error: 'Failed to redeem link code' });
  }
});

/**
 * GET /v1/devices/user/:userId
 *
 * Get all devices linked to a user account.
 */
router.get('/user/:userId', async (req: Request, res: Response) => {
  try {
    const userIdSchema = z.object({
      userId: z.string().uuid(),
    });

    const { userId } = userIdSchema.parse(req.params);

    const devices = await deviceService.getUserDevices(userId);

    res.json({
      devices,
      count: devices.length,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors,
      });
    }
    logger.error('Error in GET /v1/devices/user/:userId:', error);
    res.status(500).json({ error: 'Failed to get devices' });
  }
});

/**
 * PATCH /v1/devices/:deviceId
 *
 * Rename a device.
 *
 * Path parameters:
 * - deviceId: string - The device's unique identifier
 *
 * Query parameters:
 * - userId: string - User's UUID (for authorization)
 *
 * Request body:
 * - deviceName: string - New name for the device
 */
router.patch('/:deviceId', validateBody(renameDeviceSchema), async (req: Request, res: Response) => {
  try {
    const deviceId = req.params.deviceId;
    const userId = req.query.userId as string;

    if (!userId) {
      return res.status(400).json({ error: 'userId query parameter is required' });
    }

    const userIdSchema = z.string().uuid();
    userIdSchema.parse(userId);

    const { deviceName } = req.body;

    const success = await deviceService.renameDevice(userId, deviceId, deviceName);

    if (!success) {
      return res.status(404).json({ error: 'Device not found or not owned by this user' });
    }

    res.json({
      message: 'Device renamed successfully',
      deviceName,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors,
      });
    }
    logger.error('Error in PATCH /v1/devices/:deviceId:', error);
    res.status(500).json({ error: 'Failed to rename device' });
  }
});

/**
 * DELETE /v1/devices/:deviceId
 *
 * Deactivate (soft delete) a device.
 *
 * Path parameters:
 * - deviceId: string - The device's unique identifier
 *
 * Query parameters:
 * - userId: string - User's UUID (for authorization)
 */
router.delete('/:deviceId', async (req: Request, res: Response) => {
  try {
    const deviceId = req.params.deviceId;
    const userId = req.query.userId as string;

    if (!userId) {
      return res.status(400).json({ error: 'userId query parameter is required' });
    }

    const userIdSchema = z.string().uuid();
    userIdSchema.parse(userId);

    const success = await deviceService.deactivateDevice(userId, deviceId);

    if (!success) {
      return res.status(404).json({ error: 'Device not found or not owned by this user' });
    }

    res.json({
      message: 'Device deactivated successfully',
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors,
      });
    }
    logger.error('Error in DELETE /v1/devices/:deviceId:', error);
    res.status(500).json({ error: 'Failed to deactivate device' });
  }
});

export default router;

import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { logger } from '../logger';
import { ProfileService } from '../services/profile.service';
import { z } from 'zod';

const router = Router();
const profileService = new ProfileService(pool);

/**
 * Validation schemas
 */
const setProfileSchema = z.object({
  profile_id: z.string().min(1, 'Profile ID is required'),
});

/**
 * GET /v1/profiles
 *
 * List all available Lucid profiles
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const profiles = profileService.listAvailableProfiles();

    res.status(200).json({
      profiles: profiles.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        features: p.features,
      })),
    });
  } catch (error: any) {
    logger.error('Error in GET /v1/profiles:', error);
    res.status(500).json({
      error: 'Failed to list profiles',
      details: error.message,
    });
  }
});

/**
 * GET /v1/profiles/:profileId
 *
 * Get details of a specific profile
 */
router.get('/:profileId', async (req: Request, res: Response) => {
  try {
    const { profileId } = req.params;

    const profile = profileService.getProfileById(profileId);

    if (!profile) {
      return res.status(404).json({
        error: 'Profile not found',
        available_profiles: profileService.listAvailableProfiles().map(p => p.id),
      });
    }

    res.status(200).json({ profile });
  } catch (error: any) {
    logger.error('Error in GET /v1/profiles/:profileId:', error);
    res.status(500).json({
      error: 'Failed to get profile',
      details: error.message,
    });
  }
});

/**
 * GET /v1/profiles/user/:userId
 *
 * Get user's active profile
 */
router.get('/user/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    const profile = await profileService.getUserProfile(userId);

    res.status(200).json({
      user_id: userId,
      profile,
    });
  } catch (error: any) {
    logger.error('Error in GET /v1/profiles/user/:userId:', error);
    res.status(500).json({
      error: 'Failed to get user profile',
      details: error.message,
    });
  }
});

/**
 * PUT /v1/profiles/user/:userId
 *
 * Set user's profile preference
 *
 * Request body:
 * - profile_id: string (required) - ID of the profile to use
 */
router.put('/user/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const body = setProfileSchema.parse(req.body);

    const profile = await profileService.setUserProfile(userId, body.profile_id);

    logger.info('User profile updated', {
      user_id: userId,
      profile_id: body.profile_id,
    });

    res.status(200).json({
      user_id: userId,
      profile,
      message: 'Profile updated successfully',
    });
  } catch (error: any) {
    logger.error('Error in PUT /v1/profiles/user/:userId:', error);

    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      });
    }

    if (error.message.includes('Invalid profile ID')) {
      return res.status(400).json({
        error: error.message,
      });
    }

    res.status(500).json({
      error: 'Failed to update user profile',
      details: error.message,
    });
  }
});

/**
 * GET /v1/profiles/user/:userId/settings
 *
 * Get user's current settings (merged profile + overrides)
 * Useful for iOS to show current feature states
 */
router.get('/user/:userId/settings', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    const profile = await profileService.getUserProfile(userId);
    const overrides = await profileService.getUserOverrides(userId);

    res.status(200).json({
      user_id: userId,
      features: profile.features,
      memory: profile.memory,
      chat: profile.chat,
      overrides: overrides,
    });
  } catch (error: any) {
    logger.error('Error in GET /v1/profiles/user/:userId/settings:', error);
    res.status(500).json({
      error: 'Failed to get settings',
      details: error.message,
    });
  }
});

/**
 * PATCH /v1/profiles/user/:userId/settings
 *
 * Update specific settings for a user
 * This is the main endpoint for iOS to toggle features
 *
 * Request body examples:
 * - Disable fact extraction: { "memory": { "factExtraction": false } }
 * - Disable memory entirely: { "features": { "memorySystem": false } }
 * - Change max facts in context: { "memory": { "maxContextFacts": 5 } }
 */
router.patch('/user/:userId/settings', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const updates = req.body;

    if (!updates || Object.keys(updates).length === 0) {
      return res.status(400).json({
        error: 'No settings provided',
        example: {
          features: { memorySystem: false },
          memory: { factExtraction: false },
        },
      });
    }

    const newOverrides = await profileService.updateUserSettings(userId, updates);
    const profile = await profileService.getUserProfile(userId);

    logger.info('User settings updated', { userId, updates });

    res.status(200).json({
      user_id: userId,
      message: 'Settings updated successfully',
      features: profile.features,
      memory: profile.memory,
      chat: profile.chat,
      overrides: newOverrides,
    });
  } catch (error: any) {
    logger.error('Error in PATCH /v1/profiles/user/:userId/settings:', error);
    res.status(500).json({
      error: 'Failed to update settings',
      details: error.message,
    });
  }
});

/**
 * DELETE /v1/profiles/user/:userId/settings
 *
 * Clear all settings overrides, revert to base profile defaults
 */
router.delete('/user/:userId/settings', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    await profileService.clearUserOverrides(userId);
    const profile = await profileService.getUserProfile(userId);

    res.status(200).json({
      user_id: userId,
      message: 'Settings reset to profile defaults',
      features: profile.features,
      memory: profile.memory,
      chat: profile.chat,
    });
  } catch (error: any) {
    logger.error('Error in DELETE /v1/profiles/user/:userId/settings:', error);
    res.status(500).json({
      error: 'Failed to reset settings',
      details: error.message,
    });
  }
});

export default router;

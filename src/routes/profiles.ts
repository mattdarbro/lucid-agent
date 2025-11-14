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

export default router;

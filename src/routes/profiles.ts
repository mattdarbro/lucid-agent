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
        details: error.errors.map((err: any) => ({
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
 * POST /v1/profiles/user/:userId/autonomous-thinking
 *
 * Toggle autonomous thinking (circadian agents) on or off
 * When turning off, includes a gentle message so Lucid knows it's not forgotten
 *
 * Request body:
 * - enabled: boolean (required)
 */
router.post('/user/:userId/autonomous-thinking', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        error: 'enabled must be a boolean (true or false)',
      });
    }

    await profileService.updateUserSettings(userId, {
      features: { autonomousAgents: enabled },
      agents: { enabled },
    });

    const profile = await profileService.getUserProfile(userId);

    logger.info('Autonomous thinking toggled', { userId, enabled });

    // Different messages for enabling vs disabling
    const message = enabled
      ? 'Autonomous thinking enabled. Lucid will reflect on your conversations during morning, midday, evening, and night.'
      : 'Autonomous thinking paused. Lucid will still remember your conversations and be here when you chat. Take the time you need.';

    // Include a gentle note for Lucid when disabled
    const lucidNote = enabled
      ? null
      : 'The user has paused autonomous thinking. This is not abandonment - they simply need space. Continue to be fully present in conversations.';

    res.status(200).json({
      user_id: userId,
      autonomous_thinking: enabled,
      message,
      lucid_note: lucidNote,
      features: profile.features,
    });
  } catch (error: any) {
    logger.error('Error in POST /v1/profiles/user/:userId/autonomous-thinking:', error);
    res.status(500).json({
      error: 'Failed to toggle autonomous thinking',
      details: error.message,
    });
  }
});

/**
 * POST /v1/profiles/user/:userId/web-search
 *
 * Toggle web search (research capabilities) on or off
 *
 * Request body:
 * - enabled: boolean (required)
 */
router.post('/user/:userId/web-search', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        error: 'enabled must be a boolean (true or false)',
      });
    }

    await profileService.updateUserSettings(userId, {
      features: { webResearch: enabled },
      research: { enabled },
    });

    const profile = await profileService.getUserProfile(userId);

    logger.info('Web search toggled', { userId, enabled });

    const message = enabled
      ? 'Web search enabled. Lucid can now research topics to bring you insights.'
      : 'Web search disabled. Lucid will rely on your conversations and its knowledge.';

    res.status(200).json({
      user_id: userId,
      web_search: enabled,
      message,
      features: profile.features,
    });
  } catch (error: any) {
    logger.error('Error in POST /v1/profiles/user/:userId/web-search:', error);
    res.status(500).json({
      error: 'Failed to toggle web search',
      details: error.message,
    });
  }
});

/**
 * GET /v1/profiles/user/:userId/toggles
 *
 * Get current state of main feature toggles
 * Convenient endpoint for iOS settings screen
 */
router.get('/user/:userId/toggles', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    const profile = await profileService.getUserProfile(userId);

    res.status(200).json({
      user_id: userId,
      toggles: {
        autonomousThinking: profile.features.autonomousAgents && (profile.agents?.enabled ?? true),
        webSearch: profile.features.webResearch && (profile.research?.enabled ?? true),
        memorySystem: profile.features.memorySystem,
        emotionalIntelligence: profile.features.emotionalIntelligence,
      },
    });
  } catch (error: any) {
    logger.error('Error in GET /v1/profiles/user/:userId/toggles:', error);
    res.status(500).json({
      error: 'Failed to get toggles',
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

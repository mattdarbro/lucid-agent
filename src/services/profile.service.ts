import { Pool } from 'pg';
import { logger } from '../logger';
import { LucidProfile, AVAILABLE_PROFILES, getProfile, FULL_LUCID_PROFILE } from '../types/profiles';

/**
 * ProfileService
 *
 * Manages user profile preferences and configurations
 * Allows users to select different Lucid profiles (Full, Decision Assistant, News Digest, etc.)
 */
export class ProfileService {
  constructor(private pool: Pool) {}

  /**
   * Get user's active profile
   * Falls back to Full Lucid if not set
   */
  async getUserProfile(userId: string): Promise<LucidProfile> {
    try {
      const result = await this.pool.query(
        'SELECT profile_id FROM user_profiles WHERE user_id = $1',
        [userId]
      );

      if (result.rows.length === 0) {
        logger.debug('No profile set for user, using Full Lucid', { userId });
        return FULL_LUCID_PROFILE;
      }

      const profileId = result.rows[0].profile_id;
      const profile = getProfile(profileId);

      if (!profile) {
        logger.warn('Invalid profile_id in database, using Full Lucid', { userId, profileId });
        return FULL_LUCID_PROFILE;
      }

      logger.debug('Retrieved user profile', { userId, profileId });
      return profile;
    } catch (error) {
      logger.error('Failed to get user profile', { userId, error });
      return FULL_LUCID_PROFILE;
    }
  }

  /**
   * Set user's profile preference
   */
  async setUserProfile(userId: string, profileId: string): Promise<LucidProfile> {
    const profile = getProfile(profileId);

    if (!profile) {
      throw new Error(`Invalid profile ID: ${profileId}. Available: ${Object.keys(AVAILABLE_PROFILES).join(', ')}`);
    }

    try {
      await this.pool.query(
        `INSERT INTO user_profiles (user_id, profile_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id)
         DO UPDATE SET profile_id = $2, updated_at = NOW()`,
        [userId, profileId]
      );

      logger.info('User profile updated', { userId, profileId });
      return profile;
    } catch (error) {
      logger.error('Failed to set user profile', { userId, profileId, error });
      throw new Error('Failed to update profile preference');
    }
  }

  /**
   * List all available profiles
   */
  listAvailableProfiles(): LucidProfile[] {
    return Object.values(AVAILABLE_PROFILES);
  }

  /**
   * Get a specific profile by ID
   */
  getProfileById(profileId: string): LucidProfile | null {
    return getProfile(profileId);
  }

  /**
   * Check if a feature is enabled for a user
   */
  async isFeatureEnabled(userId: string, feature: keyof LucidProfile['features']): Promise<boolean> {
    const profile = await this.getUserProfile(userId);
    return profile.features[feature];
  }

  /**
   * Get profile configuration section
   */
  async getProfileConfig<K extends keyof LucidProfile>(
    userId: string,
    configKey: K
  ): Promise<LucidProfile[K]> {
    const profile = await this.getUserProfile(userId);
    return profile[configKey];
  }

  /**
   * Check if autonomous agents are enabled for user
   */
  async areAgentsEnabled(userId: string): Promise<boolean> {
    const profile = await this.getUserProfile(userId);
    return profile.features.autonomousAgents && (profile.agents?.enabled ?? false);
  }

  /**
   * Check if web research is enabled for user
   */
  async isResearchEnabled(userId: string): Promise<boolean> {
    const profile = await this.getUserProfile(userId);
    return profile.features.webResearch && (profile.research?.enabled ?? false);
  }

  /**
   * Get agent poll interval for user (in seconds)
   */
  async getAgentPollInterval(userId: string): Promise<number> {
    const profile = await this.getUserProfile(userId);
    return profile.agents?.pollInterval ?? 60;
  }

  /**
   * Get research execution interval for user (in seconds)
   */
  async getResearchInterval(userId: string): Promise<number> {
    const profile = await this.getUserProfile(userId);
    return profile.research?.executionInterval ?? 300;
  }
}

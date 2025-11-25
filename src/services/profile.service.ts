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
   * Get user's active profile with any settings overrides applied
   * Falls back to Full Lucid if not set
   */
  async getUserProfile(userId: string): Promise<LucidProfile> {
    try {
      const result = await this.pool.query(
        'SELECT profile_id, settings_overrides FROM user_profiles WHERE user_id = $1',
        [userId]
      );

      if (result.rows.length === 0) {
        logger.debug('No profile set for user, using Full Lucid', { userId });
        return FULL_LUCID_PROFILE;
      }

      const { profile_id: profileId, settings_overrides: overrides } = result.rows[0];
      const baseProfile = getProfile(profileId);

      if (!baseProfile) {
        logger.warn('Invalid profile_id in database, using Full Lucid', { userId, profileId });
        return FULL_LUCID_PROFILE;
      }

      // If no overrides, return base profile
      if (!overrides || Object.keys(overrides).length === 0) {
        logger.debug('Retrieved user profile', { userId, profileId });
        return baseProfile;
      }

      // Merge overrides with base profile
      const mergedProfile = this.mergeProfileOverrides(baseProfile, overrides);
      logger.debug('Retrieved user profile with overrides', { userId, profileId, overrides });
      return mergedProfile;
    } catch (error) {
      logger.error('Failed to get user profile', { userId, error });
      return FULL_LUCID_PROFILE;
    }
  }

  /**
   * Merge user overrides into a base profile
   */
  private mergeProfileOverrides(baseProfile: LucidProfile, overrides: Record<string, any>): LucidProfile {
    const merged = { ...baseProfile };

    // Merge features
    if (overrides.features) {
      merged.features = { ...baseProfile.features, ...overrides.features };
    }

    // Merge memory settings
    if (overrides.memory) {
      merged.memory = { ...baseProfile.memory, ...overrides.memory };
    }

    // Merge chat settings
    if (overrides.chat) {
      merged.chat = { ...baseProfile.chat, ...overrides.chat };
    }

    // Merge other sections as needed
    if (overrides.emotionalIntelligence) {
      merged.emotionalIntelligence = { ...baseProfile.emotionalIntelligence, ...overrides.emotionalIntelligence };
    }

    if (overrides.agents) {
      merged.agents = { ...baseProfile.agents, ...overrides.agents };
    }

    if (overrides.research) {
      merged.research = { ...baseProfile.research, ...overrides.research };
    }

    return merged;
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
   * Get user's settings overrides
   */
  async getUserOverrides(userId: string): Promise<Record<string, any>> {
    try {
      const result = await this.pool.query(
        'SELECT settings_overrides FROM user_profiles WHERE user_id = $1',
        [userId]
      );

      if (result.rows.length === 0) {
        return {};
      }

      return result.rows[0].settings_overrides || {};
    } catch (error) {
      logger.error('Failed to get user overrides', { userId, error });
      return {};
    }
  }

  /**
   * Set user's settings overrides (replaces all overrides)
   */
  async setUserOverrides(userId: string, overrides: Record<string, any>): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO user_profiles (user_id, profile_id, settings_overrides)
         VALUES ($1, 'full-lucid', $2)
         ON CONFLICT (user_id)
         DO UPDATE SET settings_overrides = $2, updated_at = NOW()`,
        [userId, JSON.stringify(overrides)]
      );

      logger.info('User settings overrides updated', { userId, overrides });
    } catch (error) {
      logger.error('Failed to set user overrides', { userId, error });
      throw new Error('Failed to update settings');
    }
  }

  /**
   * Update specific settings (merges with existing overrides)
   */
  async updateUserSettings(userId: string, updates: Record<string, any>): Promise<Record<string, any>> {
    const currentOverrides = await this.getUserOverrides(userId);

    // Deep merge updates into current overrides
    const newOverrides = this.deepMerge(currentOverrides, updates);

    await this.setUserOverrides(userId, newOverrides);
    return newOverrides;
  }

  /**
   * Clear all settings overrides for a user
   */
  async clearUserOverrides(userId: string): Promise<void> {
    try {
      await this.pool.query(
        `UPDATE user_profiles SET settings_overrides = '{}'::jsonb, updated_at = NOW() WHERE user_id = $1`,
        [userId]
      );

      logger.info('User settings overrides cleared', { userId });
    } catch (error) {
      logger.error('Failed to clear user overrides', { userId, error });
      throw new Error('Failed to clear settings');
    }
  }

  /**
   * Deep merge helper
   */
  private deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
    const result = { ...target };

    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(result[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }

    return result;
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

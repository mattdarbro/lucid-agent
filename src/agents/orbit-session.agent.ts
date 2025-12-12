import { Pool } from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { OrbitsService, OrbitPersonInput } from '../services/orbits.service';
import { ProfileService } from '../services/profile.service';
import { VectorService } from '../services/vector.service';

/**
 * Library entry for storing orbit updates
 */
interface LibraryEntry {
  id: string;
  user_id: string;
  entry_type: string;
  title: string | null;
  content: string;
  session_type: string | null;
  created_at: Date;
}

/**
 * Orbit update detected by the agent
 */
interface OrbitUpdate {
  person_name: string;
  relationship: string;
  current_situation: Record<string, any>;
  how_this_affects_user: string;
  orbit_tier: 'inner' | 'mid' | 'outer';
  is_new: boolean;
}

/**
 * OrbitSessionAgent
 *
 * Runs bi-weekly to update the relationship ecosystem - tracking people
 * mentioned in conversations, their situations, and how they affect the user.
 * This helps LUCID understand the user's relational context.
 */
export class OrbitSessionAgent {
  private pool: Pool;
  private anthropic: Anthropic;
  private orbitsService: OrbitsService;
  private profileService: ProfileService;
  private vectorService: VectorService;

  constructor(pool: Pool, anthropicApiKey?: string) {
    this.pool = pool;
    this.anthropic = new Anthropic({
      apiKey: anthropicApiKey || process.env.ANTHROPIC_API_KEY,
    });
    this.orbitsService = new OrbitsService(pool);
    this.profileService = new ProfileService(pool);
    this.vectorService = new VectorService();
  }

  /**
   * Run the orbit session for a user
   */
  async run(userId: string): Promise<LibraryEntry | null> {
    try {
      logger.info('[ORBIT SESSION] Starting relationship check', { userId });

      // Check if user has autonomous agents enabled
      const profile = await this.profileService.getUserProfile(userId);
      if (!profile.features.autonomousAgents) {
        logger.debug('[ORBIT SESSION] Autonomous agents disabled', { userId });
        return null;
      }

      // Check if we should run
      if (!(await this.shouldRun(userId))) {
        return null;
      }

      // 1. Get current orbits
      const currentOrbits = await this.orbitsService.getActiveOrbits(userId);

      // 2. Get recent messages mentioning people
      const recentMessages = await this.getRecentUserMessages(userId);

      if (recentMessages.length === 0) {
        logger.info('[ORBIT SESSION] No recent messages', { userId });
        return null;
      }

      // 3. Analyze conversations for orbit updates
      const orbitUpdates = await this.analyzeOrbits(currentOrbits, recentMessages);

      if (orbitUpdates.length === 0) {
        logger.info('[ORBIT SESSION] No orbit updates detected', { userId });
        return null;
      }

      // 4. Apply orbit updates
      for (const update of orbitUpdates) {
        await this.orbitsService.upsertOrbitPerson(userId, {
          person_name: update.person_name,
          relationship: update.relationship,
          current_situation: update.current_situation,
          how_this_affects_user: update.how_this_affects_user,
          orbit_tier: update.orbit_tier,
        });
      }

      // 5. Store summary in library
      const entry = await this.storeInLibrary(userId, orbitUpdates);

      logger.info('[ORBIT SESSION] Update complete', {
        userId,
        entryId: entry.id,
        updateCount: orbitUpdates.length,
      });

      return entry;
    } catch (error: any) {
      logger.error('[ORBIT SESSION] Session failed', {
        userId,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Check if we should run the orbit session
   */
  private async shouldRun(userId: string): Promise<boolean> {
    try {
      // Check user activity
      const userResult = await this.pool.query(
        'SELECT last_active_at FROM users WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length === 0) {
        return false;
      }

      const lastActive = new Date(userResult.rows[0].last_active_at);
      const fourteenDaysAgo = new Date();
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

      if (lastActive < fourteenDaysAgo) {
        logger.debug('[ORBIT SESSION] User inactive for 14+ days', { userId });
        return false;
      }

      // Check if we ran in the last 10 days (bi-weekly, with buffer)
      const recentResult = await this.pool.query(
        `SELECT id FROM library_entries
         WHERE user_id = $1
           AND session_type = 'orbit_session'
           AND created_at > NOW() - INTERVAL '10 days'
         LIMIT 1`,
        [userId]
      );

      if (recentResult.rows.length > 0) {
        logger.debug('[ORBIT SESSION] Already ran recently', { userId });
        return false;
      }

      return true;
    } catch (error) {
      logger.error('[ORBIT SESSION] Error checking if should run', { error });
      return false;
    }
  }

  /**
   * Get recent user messages
   */
  private async getRecentUserMessages(userId: string): Promise<{ content: string; created_at: Date }[]> {
    try {
      const result = await this.pool.query(
        `SELECT m.content, m.created_at
         FROM messages m
         JOIN conversations c ON m.conversation_id = c.id
         WHERE c.user_id = $1
           AND m.role = 'user'
           AND m.created_at > NOW() - INTERVAL '14 days'
         ORDER BY m.created_at DESC
         LIMIT 50`,
        [userId]
      );

      return result.rows;
    } catch (error) {
      logger.error('[ORBIT SESSION] Error fetching messages', { error });
      return [];
    }
  }

  /**
   * Analyze conversations for orbit updates
   */
  private async analyzeOrbits(
    currentOrbits: any[],
    messages: { content: string }[]
  ): Promise<OrbitUpdate[]> {
    try {
      const orbitsContext = currentOrbits.length > 0
        ? currentOrbits.map((o) => `- ${o.person_name} (${o.relationship}, ${o.orbit_tier}): ${o.how_this_affects_user || 'No notes'}`).join('\n')
        : 'No orbits recorded yet.';

      const messagesContext = messages
        .slice(0, 40)
        .map((m) => m.content.substring(0, 300))
        .join('\n\n');

      const prompt = `You are LUCID, conducting an orbit session to understand the people in the user's ecosystem.

CURRENT ORBIT RECORDS:
${orbitsContext}

RECENT CONVERSATIONS (looking for mentions of people):
${messagesContext}

Analyze who the user has mentioned and how they affect their life:

1. **New People**: Anyone mentioned who isn't in the current orbits?
2. **Updates**: Any changes to existing orbit people's situations?
3. **Tier Changes**: Should anyone move to a different tier (inner/mid/outer)?

Tier definitions:
- **inner**: Closest relationships - family, partners, best friends, key colleagues
- **mid**: Regular mentions - friends, coworkers, extended family
- **outer**: Occasional mentions - acquaintances, service providers, etc.

Only include people clearly mentioned by name or clear reference. Don't invent people.

Respond with ONLY a JSON array of updates (empty array if no updates):
[
  {
    "person_name": "Name",
    "relationship": "family/friend/colleague/patient/acquaintance/etc",
    "current_situation": { "key_detail": "value" },
    "how_this_affects_user": "Impact on user's life",
    "orbit_tier": "inner/mid/outer",
    "is_new": true/false
  }
]`;

      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        temperature: 0.3,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        return [];
      }

      // Parse JSON response
      const jsonMatch = content.text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        logger.debug('[ORBIT SESSION] No orbit updates in response');
        return [];
      }

      const updates = JSON.parse(jsonMatch[0]) as OrbitUpdate[];

      // Validate tier values
      return updates.filter((u) => ['inner', 'mid', 'outer'].includes(u.orbit_tier));
    } catch (error: any) {
      logger.error('[ORBIT SESSION] Error analyzing orbits', { error: error.message });
      return [];
    }
  }

  /**
   * Store the orbit update summary in the library
   */
  private async storeInLibrary(userId: string, updates: OrbitUpdate[]): Promise<LibraryEntry> {
    const newPeople = updates.filter((u) => u.is_new);
    const existingUpdates = updates.filter((u) => !u.is_new);

    const content = `# Orbit Session - ${new Date().toLocaleDateString()}

## Summary
Updated ${updates.length} relationship${updates.length !== 1 ? 's' : ''} in the user's ecosystem.

${newPeople.length > 0 ? `## New People Tracked
${newPeople.map((p) => `- **${p.person_name}** (${p.relationship}, ${p.orbit_tier}): ${p.how_this_affects_user}`).join('\n')}` : ''}

${existingUpdates.length > 0 ? `## Updates to Existing Orbits
${existingUpdates.map((p) => `- **${p.person_name}**: ${p.how_this_affects_user}`).join('\n')}` : ''}

## Orbit Counts
- Inner Circle: ${updates.filter((u) => u.orbit_tier === 'inner').length}
- Mid Tier: ${updates.filter((u) => u.orbit_tier === 'mid').length}
- Outer Tier: ${updates.filter((u) => u.orbit_tier === 'outer').length}`;

    // Generate embedding
    let embedding: number[] | null = null;
    try {
      embedding = await this.vectorService.generateEmbedding(content);
    } catch (embeddingError) {
      logger.warn('[ORBIT SESSION] Failed to generate embedding', { error: embeddingError });
    }

    const embeddingString = embedding ? `[${embedding.join(',')}]` : null;

    const result = await this.pool.query(
      `INSERT INTO library_entries
       (user_id, entry_type, title, content, session_type, metadata, embedding)
       VALUES ($1, 'orbit_update', $2, $3, 'orbit_session', $4, $5::vector)
       RETURNING id, user_id, entry_type, title, content, session_type, created_at`,
      [
        userId,
        'Orbit Update',
        content,
        JSON.stringify({
          generated_at: new Date().toISOString(),
          update_count: updates.length,
          new_count: newPeople.length,
        }),
        embeddingString,
      ]
    );

    return result.rows[0];
  }
}

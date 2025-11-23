/**
 * Service Container - Dependency Injection
 *
 * This file creates singleton instances of all services to avoid
 * duplication and improve performance. All routes should import
 * services from this file instead of creating new instances.
 */

import { pool, supabase } from '../db';
import { VectorService } from './vector.service';
import { FactService } from './fact.service';
import { MessageService } from './message.service';
import { ConversationService } from './conversation.service';
import { UserService } from './user.service';
import { EvidenceService } from './evidence.service';
import { ChatService } from './chat.service';
import { SummaryService } from './summary.service';
import { PersonalityService } from './personality.service';
import { InsightGenerationService } from './insight-generation.service';
import { logger } from '../logger';

// ============================================================================
// Initialize singleton service instances
// ============================================================================

logger.info('Initializing service container...');

// Core services
export const vectorService = new VectorService();
export const userService = new UserService(pool);
export const conversationService = new ConversationService(pool);
export const messageService = new MessageService(pool, vectorService);
export const factService = new FactService(pool, vectorService);
export const evidenceService = new EvidenceService(pool);
export const chatService = new ChatService(pool, supabase);
export const summaryService = new SummaryService(pool, vectorService);
export const personalityService = new PersonalityService(pool);
export const insightGenerationService = new InsightGenerationService(pool);

logger.info('Service container initialized successfully');

/**
 * Service container for dependency injection
 */
export const services = {
  vector: vectorService,
  user: userService,
  conversation: conversationService,
  message: messageService,
  fact: factService,
  evidence: evidenceService,
  chat: chatService,
  summary: summaryService,
  personality: personalityService,
  insightGeneration: insightGenerationService,
};

export default services;

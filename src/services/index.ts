/**
 * Service Container - Dependency Injection
 *
 * This file creates singleton instances of all services to avoid
 * duplication and improve performance. All routes should import
 * services from this file instead of creating new instances.
 *
 * After the refactor, this container is simplified:
 * - No mode selection services
 * - No Haiku routing services
 * - No personality tracking services
 * - No circadian agent services
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
import { InsightGenerationService } from './insight-generation.service';
import { MemoryService } from './memory.service';
import { MattStateService } from './matt-state.service';
import { OrbitsService } from './orbits.service';
import { LucidStateService } from './lucid-state.service';
import { PromptModulesService } from './prompt-modules.service';
import { ResearchQueueService } from './research-queue.service';
import { LivingDocumentService } from './living-document.service';
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
export const insightGenerationService = new InsightGenerationService(pool);
export const memoryService = new MemoryService(pool);

// Layered memory services
export const mattStateService = new MattStateService(pool);
export const orbitsService = new OrbitsService(pool);
export const lucidStateService = new LucidStateService(pool);

// Simplified services (after refactor)
export const promptModulesService = new PromptModulesService(pool);
export const researchQueueService = new ResearchQueueService(pool);
export const livingDocumentService = new LivingDocumentService(pool);

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
  insightGeneration: insightGenerationService,
  memory: memoryService,
  // Layered memory services
  mattState: mattStateService,
  orbits: orbitsService,
  lucidState: lucidStateService,
  // Simplified services
  promptModules: promptModulesService,
  researchQueue: researchQueueService,
  livingDocument: livingDocumentService,
};

export default services;

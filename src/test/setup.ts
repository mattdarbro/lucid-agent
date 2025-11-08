/**
 * Test setup and utilities
 *
 * This file runs before all tests and provides common utilities
 */

import { vi } from 'vitest';
import { Pool } from 'pg';

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.PORT = '4000';
process.env.AGENT_NAME = 'Lucid Test';
process.env.LOG_LEVEL = 'error'; // Suppress logs during tests

// Export test utilities
export const mockPool = {
  query: vi.fn(),
  connect: vi.fn(),
  end: vi.fn(),
} as unknown as Pool;

/**
 * Creates a mock user object for testing
 */
export function createMockUser(overrides: Partial<any> = {}) {
  return {
    id: '123e4567-e89b-12d3-a456-426614174000',
    external_id: 'test_user_123',
    name: 'Test User',
    email: 'test@example.com',
    timezone: 'America/Los_Angeles',
    preferences: {},
    created_at: new Date('2024-01-01T00:00:00Z'),
    last_active_at: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Creates a mock conversation object for testing
 */
export function createMockConversation(overrides: Partial<any> = {}) {
  return {
    id: '123e4567-e89b-12d3-a456-426614174001',
    user_id: '123e4567-e89b-12d3-a456-426614174000',
    title: 'Test Conversation',
    user_timezone: 'America/Los_Angeles',
    message_count: 0,
    created_at: new Date('2024-01-01T00:00:00Z'),
    updated_at: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Creates a mock message object for testing
 */
export function createMockMessage(overrides: Partial<any> = {}) {
  return {
    id: '123e4567-e89b-12d3-a456-426614174002',
    conversation_id: '123e4567-e89b-12d3-a456-426614174001',
    user_id: '123e4567-e89b-12d3-a456-426614174000',
    role: 'user',
    content: 'Test message content',
    embedding: null,
    tokens: 4,
    model: null,
    created_at: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Clears all mocks between tests
 */
export function clearAllMocks() {
  vi.clearAllMocks();
}

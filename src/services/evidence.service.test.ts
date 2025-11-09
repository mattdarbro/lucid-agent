import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EvidenceService } from './evidence.service';
import { Pool } from 'pg';
import { clearAllMocks } from '../test/setup';

/**
 * Unit tests for EvidenceService
 */

const mockPool = {
  query: vi.fn(),
} as unknown as Pool;

/**
 * Creates a mock evidence object for testing
 */
function createMockEvidence(overrides: Partial<any> = {}) {
  return {
    id: '123e4567-e89b-12d3-a456-426614174010',
    fact_id: '123e4567-e89b-12d3-a456-426614174003',
    message_id: '123e4567-e89b-12d3-a456-426614174002',
    conversation_id: '123e4567-e89b-12d3-a456-426614174001',
    excerpt: 'I really love pizza',
    strength: 0.8,
    context_type: 'direct_statement',
    created_at: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('EvidenceService', () => {
  let evidenceService: EvidenceService;

  beforeEach(() => {
    clearAllMocks();
    evidenceService = new EvidenceService(mockPool);
  });

  describe('createEvidence', () => {
    it('should create evidence with all fields', async () => {
      const input = {
        fact_id: '123e4567-e89b-12d3-a456-426614174003',
        message_id: '123e4567-e89b-12d3-a456-426614174002',
        conversation_id: '123e4567-e89b-12d3-a456-426614174001',
        excerpt: 'I love pizza',
        strength: 0.9,
        context_type: 'direct_statement' as const,
      };

      const mockEvidence = createMockEvidence(input);

      // Mock fact check
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [{ id: input.fact_id }],
        rowCount: 1,
      } as any);

      // Mock message check
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [{ id: input.message_id }],
        rowCount: 1,
      } as any);

      // Mock evidence creation
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockEvidence],
        rowCount: 1,
      } as any);

      const result = await evidenceService.createEvidence(input);

      expect(result).toEqual(mockEvidence);
      expect(mockPool.query).toHaveBeenCalledTimes(3);
      expect(mockPool.query).toHaveBeenNthCalledWith(
        1,
        'SELECT id FROM facts WHERE id = $1',
        [input.fact_id]
      );
      expect(mockPool.query).toHaveBeenNthCalledWith(
        2,
        'SELECT id FROM messages WHERE id = $1',
        [input.message_id]
      );
    });

    it('should create evidence without message_id', async () => {
      const input = {
        fact_id: '123e4567-e89b-12d3-a456-426614174003',
        conversation_id: '123e4567-e89b-12d3-a456-426614174001',
        excerpt: 'User mentioned liking pizza',
        strength: 0.7,
        context_type: 'implied' as const,
      };

      const mockEvidence = createMockEvidence({ ...input, message_id: null });

      // Mock fact check
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [{ id: input.fact_id }],
        rowCount: 1,
      } as any);

      // Mock evidence creation
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockEvidence],
        rowCount: 1,
      } as any);

      const result = await evidenceService.createEvidence(input);

      expect(result).toEqual(mockEvidence);
      expect(mockPool.query).toHaveBeenCalledTimes(2); // No message check
    });

    it('should use default strength of 0.7 when not provided', async () => {
      const input = {
        fact_id: '123e4567-e89b-12d3-a456-426614174003',
        excerpt: 'Test excerpt',
      };

      const mockEvidence = createMockEvidence({
        ...input,
        strength: 0.7,
        message_id: null,
        conversation_id: null,
        context_type: null,
      });

      // Mock fact check
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [{ id: input.fact_id }],
        rowCount: 1,
      } as any);

      // Mock evidence creation
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockEvidence],
        rowCount: 1,
      } as any);

      const result = await evidenceService.createEvidence(input);

      expect(result.strength).toBe(0.7);
    });

    it('should throw error when fact not found', async () => {
      const input = {
        fact_id: 'non-existent-fact',
        excerpt: 'Test',
      };

      // Mock fact check - not found
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await expect(evidenceService.createEvidence(input)).rejects.toThrow(
        'Fact not found'
      );
    });

    it('should throw error when message not found', async () => {
      const input = {
        fact_id: '123e4567-e89b-12d3-a456-426614174003',
        message_id: 'non-existent-message',
        excerpt: 'Test',
      };

      // Mock fact check - found
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [{ id: input.fact_id }],
        rowCount: 1,
      } as any);

      // Mock message check - not found
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await expect(evidenceService.createEvidence(input)).rejects.toThrow(
        'Message not found'
      );
    });
  });

  describe('createEvidenceBatch', () => {
    it('should create multiple evidence items', async () => {
      const input1 = {
        fact_id: '123e4567-e89b-12d3-a456-426614174003',
        excerpt: 'Evidence 1',
      };
      const input2 = {
        fact_id: '123e4567-e89b-12d3-a456-426614174003',
        excerpt: 'Evidence 2',
      };

      const mockEvidence1 = createMockEvidence(input1);
      const mockEvidence2 = createMockEvidence({ ...input2, id: 'evidence2' });

      // Mock for first evidence
      vi.mocked(mockPool.query)
        .mockResolvedValueOnce({ rows: [{ id: input1.fact_id }], rowCount: 1 } as any)
        .mockResolvedValueOnce({ rows: [mockEvidence1], rowCount: 1 } as any)
        // Mock for second evidence
        .mockResolvedValueOnce({ rows: [{ id: input2.fact_id }], rowCount: 1 } as any)
        .mockResolvedValueOnce({ rows: [mockEvidence2], rowCount: 1 } as any);

      const result = await evidenceService.createEvidenceBatch([input1, input2]);

      expect(result).toHaveLength(2);
      expect(result[0].excerpt).toBe('Evidence 1');
      expect(result[1].excerpt).toBe('Evidence 2');
    });

    it('should return empty array for empty input', async () => {
      const result = await evidenceService.createEvidenceBatch([]);
      expect(result).toEqual([]);
    });

    it('should continue creating evidence even if one fails', async () => {
      const input1 = {
        fact_id: 'non-existent',
        excerpt: 'Evidence 1',
      };
      const input2 = {
        fact_id: '123e4567-e89b-12d3-a456-426614174003',
        excerpt: 'Evidence 2',
      };

      const mockEvidence2 = createMockEvidence(input2);

      // Mock for first evidence - fact not found
      vi.mocked(mockPool.query)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
        // Mock for second evidence - success
        .mockResolvedValueOnce({ rows: [{ id: input2.fact_id }], rowCount: 1 } as any)
        .mockResolvedValueOnce({ rows: [mockEvidence2], rowCount: 1 } as any);

      const result = await evidenceService.createEvidenceBatch([input1, input2]);

      expect(result).toHaveLength(1);
      expect(result[0].excerpt).toBe('Evidence 2');
    });
  });

  describe('findById', () => {
    it('should find evidence by ID', async () => {
      const mockEvidence = createMockEvidence();

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockEvidence],
        rowCount: 1,
      } as any);

      const result = await evidenceService.findById(mockEvidence.id);

      expect(result).toEqual(mockEvidence);
      expect(mockPool.query).toHaveBeenCalledWith(
        'SELECT * FROM evidence WHERE id = $1',
        [mockEvidence.id]
      );
    });

    it('should return null when evidence not found', async () => {
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await evidenceService.findById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('listByFact', () => {
    it('should list evidence for a fact', async () => {
      const factId = '123e4567-e89b-12d3-a456-426614174003';
      const mockEvidence = [
        createMockEvidence({ fact_id: factId }),
        createMockEvidence({ fact_id: factId, id: 'evidence2' }),
      ];

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: mockEvidence,
        rowCount: 2,
      } as any);

      const result = await evidenceService.listByFact(factId);

      expect(result).toHaveLength(2);
      expect(result[0].fact_id).toBe(factId);
    });

    it('should filter by context_type', async () => {
      const factId = '123e4567-e89b-12d3-a456-426614174003';

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await evidenceService.listByFact(factId, {
        context_type: 'direct_statement',
      });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('context_type'),
        expect.arrayContaining([factId, 'direct_statement'])
      );
    });

    it('should filter by min_strength', async () => {
      const factId = '123e4567-e89b-12d3-a456-426614174003';

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await evidenceService.listByFact(factId, { min_strength: 0.8 });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('strength >='),
        expect.arrayContaining([factId, 0.8])
      );
    });

    it('should apply limit and offset', async () => {
      const factId = '123e4567-e89b-12d3-a456-426614174003';

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await evidenceService.listByFact(factId, { limit: 10, offset: 5 });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        expect.arrayContaining([factId, 10, 5])
      );
    });
  });

  describe('updateEvidence', () => {
    it('should update evidence excerpt', async () => {
      const evidenceId = 'evidence-123';
      const updates = { excerpt: 'Updated excerpt' };
      const mockEvidence = createMockEvidence({
        id: evidenceId,
        ...updates,
      });

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockEvidence],
        rowCount: 1,
      } as any);

      const result = await evidenceService.updateEvidence(evidenceId, updates);

      expect(result).toEqual(mockEvidence);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE evidence'),
        expect.arrayContaining(['Updated excerpt', evidenceId])
      );
    });

    it('should update evidence strength', async () => {
      const evidenceId = 'evidence-123';
      const updates = { strength: 0.95 };
      const mockEvidence = createMockEvidence({ id: evidenceId, ...updates });

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockEvidence],
        rowCount: 1,
      } as any);

      const result = await evidenceService.updateEvidence(evidenceId, updates);

      expect(result?.strength).toBe(0.95);
    });

    it('should update evidence context_type', async () => {
      const evidenceId = 'evidence-123';
      const updates = { context_type: 'inferred' as const };
      const mockEvidence = createMockEvidence({ id: evidenceId, ...updates });

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockEvidence],
        rowCount: 1,
      } as any);

      const result = await evidenceService.updateEvidence(evidenceId, updates);

      expect(result?.context_type).toBe('inferred');
    });

    it('should return null when evidence not found', async () => {
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await evidenceService.updateEvidence('non-existent', {
        strength: 0.9,
      });

      expect(result).toBeNull();
    });

    it('should return existing evidence when no updates provided', async () => {
      const evidenceId = 'evidence-123';
      const mockEvidence = createMockEvidence({ id: evidenceId });

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [mockEvidence],
        rowCount: 1,
      } as any);

      const result = await evidenceService.updateEvidence(evidenceId, {});

      expect(result).toEqual(mockEvidence);
      expect(mockPool.query).toHaveBeenCalledWith(
        'SELECT * FROM evidence WHERE id = $1',
        [evidenceId]
      );
    });
  });

  describe('deleteEvidence', () => {
    it('should delete evidence', async () => {
      const evidenceId = 'evidence-123';

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rowCount: 1,
      } as any);

      const result = await evidenceService.deleteEvidence(evidenceId);

      expect(result).toBe(true);
      expect(mockPool.query).toHaveBeenCalledWith(
        'DELETE FROM evidence WHERE id = $1',
        [evidenceId]
      );
    });

    it('should return false when evidence not found', async () => {
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rowCount: 0,
      } as any);

      const result = await evidenceService.deleteEvidence('non-existent');

      expect(result).toBe(false);
    });
  });

  describe('getCountByFact', () => {
    it('should get evidence count for fact', async () => {
      const factId = 'fact-123';

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [{ count: '5' }],
        rowCount: 1,
      } as any);

      const count = await evidenceService.getCountByFact(factId);

      expect(count).toBe(5);
      expect(mockPool.query).toHaveBeenCalledWith(
        'SELECT COUNT(*) as count FROM evidence WHERE fact_id = $1',
        [factId]
      );
    });

    it('should return 0 when no evidence exists', async () => {
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [{ count: '0' }],
        rowCount: 1,
      } as any);

      const count = await evidenceService.getCountByFact('fact-123');

      expect(count).toBe(0);
    });
  });

  describe('getAverageStrength', () => {
    it('should get average strength for fact', async () => {
      const factId = 'fact-123';

      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [{ avg_strength: '0.85' }],
        rowCount: 1,
      } as any);

      const avgStrength = await evidenceService.getAverageStrength(factId);

      expect(avgStrength).toBe(0.85);
      expect(mockPool.query).toHaveBeenCalledWith(
        'SELECT AVG(strength) as avg_strength FROM evidence WHERE fact_id = $1',
        [factId]
      );
    });

    it('should return null when no evidence exists', async () => {
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [{ avg_strength: null }],
        rowCount: 1,
      } as any);

      const avgStrength = await evidenceService.getAverageStrength('fact-123');

      expect(avgStrength).toBeNull();
    });
  });
});

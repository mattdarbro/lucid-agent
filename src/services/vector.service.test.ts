import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VectorService } from './vector.service';

/**
 * Unit tests for VectorService
 *
 * Tests vector embedding generation and similarity calculations
 */

// Create mock embeddings.create function
const mockEmbeddingsCreate = vi.fn();

// Mock OpenAI
vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      embeddings = {
        create: mockEmbeddingsCreate,
      };
    },
  };
});

// Mock config
vi.mock('../config', () => ({
  config: {
    openai: {
      apiKey: 'test-api-key',
    },
  },
}));

describe('VectorService', () => {
  let vectorService: VectorService;

  beforeEach(() => {
    vi.clearAllMocks();
    vectorService = new VectorService('test-api-key');
  });

  describe('generateEmbedding', () => {
    it('should generate an embedding for valid text', async () => {
      const text = 'Hello, world!';
      const mockEmbedding = new Array(1536).fill(0.1);

      mockEmbeddingsCreate.mockResolvedValueOnce({
        data: [{ embedding: mockEmbedding }],
      } as any);

      const result = await vectorService.generateEmbedding(text);

      expect(result).toEqual(mockEmbedding);
      expect(result).toHaveLength(1536);
      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-ada-002',
        input: text,
        encoding_format: 'float',
      });
    });

    it('should trim whitespace from input text', async () => {
      const text = '  Hello, world!  ';
      const mockEmbedding = new Array(1536).fill(0.1);

      mockEmbeddingsCreate.mockResolvedValueOnce({
        data: [{ embedding: mockEmbedding }],
      } as any);

      await vectorService.generateEmbedding(text);

      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-ada-002',
        input: 'Hello, world!',
        encoding_format: 'float',
      });
    });

    it('should throw error for empty text', async () => {
      await expect(vectorService.generateEmbedding('')).rejects.toThrow(
        'Text cannot be empty'
      );
    });

    it('should throw error for whitespace-only text', async () => {
      await expect(vectorService.generateEmbedding('   ')).rejects.toThrow(
        'Text cannot be empty'
      );
    });

    it('should throw error when API returns no data', async () => {
      mockEmbeddingsCreate.mockResolvedValueOnce({
        data: [],
      } as any);

      await expect(vectorService.generateEmbedding('test')).rejects.toThrow(
        'No embedding returned from OpenAI'
      );
    });

    it('should throw error when embedding dimensions are wrong', async () => {
      const mockEmbedding = new Array(512).fill(0.1); // Wrong size

      mockEmbeddingsCreate.mockResolvedValueOnce({
        data: [{ embedding: mockEmbedding }],
      } as any);

      await expect(vectorService.generateEmbedding('test')).rejects.toThrow(
        'Expected 1536 dimensions, got 512'
      );
    });

    it('should handle insufficient quota error', async () => {
      const error = new Error('Quota exceeded');
      (error as any).code = 'insufficient_quota';

      mockEmbeddingsCreate.mockRejectedValueOnce(error);

      await expect(vectorService.generateEmbedding('test')).rejects.toThrow(
        'OpenAI API quota exceeded'
      );
    });

    it('should handle invalid API key error', async () => {
      const error = new Error('Invalid key');
      (error as any).code = 'invalid_api_key';

      mockEmbeddingsCreate.mockRejectedValueOnce(error);

      await expect(vectorService.generateEmbedding('test')).rejects.toThrow(
        'Invalid OpenAI API key'
      );
    });

    it('should handle rate limit error', async () => {
      const error = new Error('Rate limited');
      (error as any).status = 429;

      mockEmbeddingsCreate.mockRejectedValueOnce(error);

      await expect(vectorService.generateEmbedding('test')).rejects.toThrow(
        'OpenAI API rate limit exceeded'
      );
    });

    it('should handle generic API errors', async () => {
      mockEmbeddingsCreate.mockRejectedValueOnce(
        new Error('Network error')
      );

      await expect(vectorService.generateEmbedding('test')).rejects.toThrow(
        'Failed to generate embedding'
      );
    });
  });

  describe('generateEmbeddings', () => {
    it('should generate embeddings for multiple texts', async () => {
      const texts = ['Hello', 'World', 'Test'];
      const mockEmbeddings = [
        new Array(1536).fill(0.1),
        new Array(1536).fill(0.2),
        new Array(1536).fill(0.3),
      ];

      mockEmbeddingsCreate.mockResolvedValueOnce({
        data: [
          { embedding: mockEmbeddings[0] },
          { embedding: mockEmbeddings[1] },
          { embedding: mockEmbeddings[2] },
        ],
      } as any);

      const result = await vectorService.generateEmbeddings(texts);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual(mockEmbeddings[0]);
      expect(result[1]).toEqual(mockEmbeddings[1]);
      expect(result[2]).toEqual(mockEmbeddings[2]);
      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-ada-002',
        input: texts,
        encoding_format: 'float',
      });
    });

    it('should trim whitespace from all input texts', async () => {
      const texts = ['  Hello  ', '  World  '];
      const mockEmbeddings = [new Array(1536).fill(0.1), new Array(1536).fill(0.2)];

      mockEmbeddingsCreate.mockResolvedValueOnce({
        data: [{ embedding: mockEmbeddings[0] }, { embedding: mockEmbeddings[1] }],
      } as any);

      await vectorService.generateEmbeddings(texts);

      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-ada-002',
        input: ['Hello', 'World'],
        encoding_format: 'float',
      });
    });

    it('should throw error for empty array', async () => {
      await expect(vectorService.generateEmbeddings([])).rejects.toThrow(
        'Texts array cannot be empty'
      );
    });

    it('should throw error if any text is empty', async () => {
      const texts = ['Hello', '', 'World'];

      await expect(vectorService.generateEmbeddings(texts)).rejects.toThrow(
        'Text at index 1 cannot be empty'
      );
    });

    it('should throw error when embedding count mismatch', async () => {
      const texts = ['Hello', 'World'];
      const mockEmbeddings = [new Array(1536).fill(0.1)]; // Only 1 embedding for 2 texts

      mockEmbeddingsCreate.mockResolvedValueOnce({
        data: [{ embedding: mockEmbeddings[0] }],
      } as any);

      await expect(vectorService.generateEmbeddings(texts)).rejects.toThrow(
        'Embedding count mismatch'
      );
    });

    it('should handle API errors', async () => {
      const texts = ['Hello', 'World'];

      mockEmbeddingsCreate.mockRejectedValueOnce(
        new Error('API error')
      );

      await expect(vectorService.generateEmbeddings(texts)).rejects.toThrow(
        'Failed to generate embeddings'
      );
    });
  });

  describe('cosineSimilarity', () => {
    it('should calculate similarity for identical vectors', () => {
      const embedding = new Array(1536).fill(0.5);

      const similarity = vectorService.cosineSimilarity(embedding, embedding);

      expect(similarity).toBeCloseTo(1.0, 5);
    });

    it('should calculate similarity for opposite vectors', () => {
      const embedding1 = new Array(1536).fill(1.0);
      const embedding2 = new Array(1536).fill(-1.0);

      const similarity = vectorService.cosineSimilarity(embedding1, embedding2);

      expect(similarity).toBeCloseTo(-1.0, 5);
    });

    it('should calculate similarity for orthogonal vectors', () => {
      const embedding1 = new Array(1536).fill(0);
      embedding1[0] = 1;
      const embedding2 = new Array(1536).fill(0);
      embedding2[1] = 1;

      const similarity = vectorService.cosineSimilarity(embedding1, embedding2);

      expect(similarity).toBeCloseTo(0.0, 5);
    });

    it('should return 0 for zero magnitude vectors', () => {
      const embedding1 = new Array(1536).fill(0);
      const embedding2 = new Array(1536).fill(0.5);

      const similarity = vectorService.cosineSimilarity(embedding1, embedding2);

      expect(similarity).toBe(0);
    });

    it('should throw error for different length vectors', () => {
      const embedding1 = new Array(1536).fill(0.5);
      const embedding2 = new Array(512).fill(0.5);

      expect(() => vectorService.cosineSimilarity(embedding1, embedding2)).toThrow(
        'Embeddings must have the same dimensions'
      );
    });

    it('should throw error for wrong dimensions', () => {
      const embedding1 = new Array(512).fill(0.5);
      const embedding2 = new Array(512).fill(0.5);

      expect(() => vectorService.cosineSimilarity(embedding1, embedding2)).toThrow(
        'Expected 1536 dimensions'
      );
    });
  });

  describe('estimateCost', () => {
    it('should estimate cost for small text', () => {
      const text = 'Hello';
      const cost = vectorService.estimateCost(text);

      // ~5 chars = ~2 tokens = ~$0.0000002
      expect(cost).toBeGreaterThan(0);
      expect(cost).toBeLessThan(0.001);
    });

    it('should estimate cost for medium text', () => {
      const text = 'A'.repeat(1000); // 1000 chars = ~250 tokens
      const cost = vectorService.estimateCost(text);

      // ~250 tokens = ~$0.000025
      expect(cost).toBeCloseTo(0.000025, 6);
    });

    it('should estimate cost for large text', () => {
      const text = 'A'.repeat(10000); // 10000 chars = ~2500 tokens
      const cost = vectorService.estimateCost(text);

      // ~2500 tokens = ~$0.00025
      expect(cost).toBeCloseTo(0.00025, 6);
    });
  });

  describe('estimateBatchCost', () => {
    it('should estimate total cost for multiple texts', () => {
      const texts = ['Hello', 'World', 'Test'];
      const cost = vectorService.estimateBatchCost(texts);

      expect(cost).toBeGreaterThan(0);
      expect(cost).toBeLessThan(0.001);
    });

    it('should return 0 for empty array', () => {
      const cost = vectorService.estimateBatchCost([]);

      expect(cost).toBe(0);
    });
  });

  describe('getModel', () => {
    it('should return the embedding model', () => {
      expect(vectorService.getModel()).toBe('text-embedding-ada-002');
    });
  });

  describe('getDimensions', () => {
    it('should return the embedding dimensions', () => {
      expect(vectorService.getDimensions()).toBe(1536);
    });
  });
});

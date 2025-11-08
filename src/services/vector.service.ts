import OpenAI from 'openai';
import { logger } from '../logger';
import { config } from '../config';

/**
 * VectorService
 *
 * Handles vector embedding generation using OpenAI's API.
 * This service is used by MessageService, FactService, and SummaryService
 * to generate embeddings for semantic search capabilities.
 */
export class VectorService {
  private openai: OpenAI;
  private readonly embeddingModel = 'text-embedding-ada-002';
  private readonly embeddingDimensions = 1536;

  constructor(apiKey?: string) {
    this.openai = new OpenAI({
      apiKey: apiKey || config.openai?.apiKey || process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Generates an embedding vector for a single text input
   *
   * @param text - The text to generate an embedding for
   * @returns Array of 1536 floating point numbers
   * @throws Error if embedding generation fails
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      throw new Error('Text cannot be empty');
    }

    try {
      const response = await this.openai.embeddings.create({
        model: this.embeddingModel,
        input: text.trim(),
        encoding_format: 'float',
      });

      if (!response.data || response.data.length === 0) {
        throw new Error('No embedding returned from OpenAI');
      }

      const embedding = response.data[0].embedding;

      if (embedding.length !== this.embeddingDimensions) {
        throw new Error(
          `Expected ${this.embeddingDimensions} dimensions, got ${embedding.length}`
        );
      }

      logger.debug(`Generated embedding for text (${text.length} chars)`);
      return embedding;
    } catch (error: any) {
      logger.error('Error generating embedding:', error);

      // Provide more specific error messages
      if (error.code === 'insufficient_quota') {
        throw new Error('OpenAI API quota exceeded');
      }

      if (error.code === 'invalid_api_key') {
        throw new Error('Invalid OpenAI API key');
      }

      if (error.status === 429) {
        throw new Error('OpenAI API rate limit exceeded');
      }

      throw new Error(`Failed to generate embedding: ${error.message}`);
    }
  }

  /**
   * Generates embeddings for multiple text inputs in a single API call
   * More efficient than calling generateEmbedding() multiple times
   *
   * @param texts - Array of texts to generate embeddings for
   * @returns Array of embedding vectors (same length as input)
   * @throws Error if any embedding generation fails
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) {
      throw new Error('Texts array cannot be empty');
    }

    // Validate all texts
    const validTexts = texts.map((text, index) => {
      if (!text || text.trim().length === 0) {
        throw new Error(`Text at index ${index} cannot be empty`);
      }
      return text.trim();
    });

    try {
      const response = await this.openai.embeddings.create({
        model: this.embeddingModel,
        input: validTexts,
        encoding_format: 'float',
      });

      if (!response.data || response.data.length !== validTexts.length) {
        throw new Error('Embedding count mismatch');
      }

      const embeddings = response.data.map((item) => {
        if (item.embedding.length !== this.embeddingDimensions) {
          throw new Error(
            `Expected ${this.embeddingDimensions} dimensions, got ${item.embedding.length}`
          );
        }
        return item.embedding;
      });

      logger.info(`Generated ${embeddings.length} embeddings`);
      return embeddings;
    } catch (error: any) {
      logger.error('Error generating embeddings:', error);

      if (error.code === 'insufficient_quota') {
        throw new Error('OpenAI API quota exceeded');
      }

      if (error.code === 'invalid_api_key') {
        throw new Error('Invalid OpenAI API key');
      }

      if (error.status === 429) {
        throw new Error('OpenAI API rate limit exceeded');
      }

      throw new Error(`Failed to generate embeddings: ${error.message}`);
    }
  }

  /**
   * Calculates cosine similarity between two embedding vectors
   * Returns a value between -1 and 1, where 1 means identical
   *
   * @param embedding1 - First embedding vector
   * @param embedding2 - Second embedding vector
   * @returns Cosine similarity score
   */
  cosineSimilarity(embedding1: number[], embedding2: number[]): number {
    if (embedding1.length !== embedding2.length) {
      throw new Error('Embeddings must have the same dimensions');
    }

    if (embedding1.length !== this.embeddingDimensions) {
      throw new Error(`Expected ${this.embeddingDimensions} dimensions`);
    }

    let dotProduct = 0;
    let magnitude1 = 0;
    let magnitude2 = 0;

    for (let i = 0; i < embedding1.length; i++) {
      dotProduct += embedding1[i] * embedding2[i];
      magnitude1 += embedding1[i] * embedding1[i];
      magnitude2 += embedding2[i] * embedding2[i];
    }

    magnitude1 = Math.sqrt(magnitude1);
    magnitude2 = Math.sqrt(magnitude2);

    if (magnitude1 === 0 || magnitude2 === 0) {
      return 0;
    }

    return dotProduct / (magnitude1 * magnitude2);
  }

  /**
   * Estimates the cost of generating embeddings
   * Based on OpenAI's pricing: $0.0001 per 1K tokens
   * Rough estimate: 1 token ≈ 4 characters
   *
   * @param text - The text to estimate cost for
   * @returns Estimated cost in USD
   */
  estimateCost(text: string): number {
    const estimatedTokens = Math.ceil(text.length / 4);
    const costPer1kTokens = 0.0001;
    return (estimatedTokens / 1000) * costPer1kTokens;
  }

  /**
   * Estimates the cost for batch embeddings
   *
   * @param texts - Array of texts
   * @returns Estimated total cost in USD
   */
  estimateBatchCost(texts: string[]): number {
    return texts.reduce((total, text) => total + this.estimateCost(text), 0);
  }

  /**
   * Gets the embedding model being used
   */
  getModel(): string {
    return this.embeddingModel;
  }

  /**
   * Gets the embedding dimensions
   */
  getDimensions(): number {
    return this.embeddingDimensions;
  }
}

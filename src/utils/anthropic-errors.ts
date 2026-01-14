/**
 * Anthropic API Error Handler
 *
 * Provides:
 * - Proper error type detection from Anthropic SDK
 * - Retry logic with exponential backoff for transient errors
 * - User-friendly error messages
 */

import { logger } from '../logger';

/**
 * Known Anthropic API error status codes
 */
export const ANTHROPIC_ERROR_CODES = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  OVERLOADED: 529,
} as const;

/**
 * Error types that are transient and can be retried
 */
const RETRYABLE_STATUS_CODES: number[] = [
  ANTHROPIC_ERROR_CODES.RATE_LIMITED,
  ANTHROPIC_ERROR_CODES.INTERNAL_ERROR,
  ANTHROPIC_ERROR_CODES.OVERLOADED,
];

/**
 * Custom error class for Anthropic API errors
 * Preserves the original status code for proper HTTP response mapping
 */
export class AnthropicApiError extends Error {
  public readonly status: number;
  public readonly isRetryable: boolean;
  public readonly originalError: any;

  constructor(message: string, status: number, originalError?: any) {
    super(message);
    this.name = 'AnthropicApiError';
    this.status = status;
    this.isRetryable = RETRYABLE_STATUS_CODES.includes(status);
    this.originalError = originalError;
  }
}

/**
 * Extract status code from Anthropic SDK error
 * The SDK throws errors with a `status` property
 */
export function getAnthropicErrorStatus(error: any): number | null {
  // Direct status property (Anthropic SDK v0.x)
  if (typeof error?.status === 'number') {
    return error.status;
  }

  // Check error.error object (some SDK versions)
  if (typeof error?.error?.status === 'number') {
    return error.error.status;
  }

  // Check for status in message (fallback)
  const statusMatch = error?.message?.match(/status[:\s]+(\d{3})/i);
  if (statusMatch) {
    return parseInt(statusMatch[1], 10);
  }

  return null;
}

/**
 * Get user-friendly error message based on status code
 */
export function getErrorMessage(status: number | null, originalMessage?: string): string {
  switch (status) {
    case ANTHROPIC_ERROR_CODES.RATE_LIMITED:
      return 'AI service is rate limited. Please try again in a moment.';
    case ANTHROPIC_ERROR_CODES.OVERLOADED:
      return 'AI service is currently overloaded. Please try again shortly.';
    case ANTHROPIC_ERROR_CODES.INTERNAL_ERROR:
      return 'AI service encountered an internal error. Please try again.';
    case ANTHROPIC_ERROR_CODES.UNAUTHORIZED:
      return 'AI service authentication failed.';
    case ANTHROPIC_ERROR_CODES.FORBIDDEN:
      return 'AI service access denied.';
    case ANTHROPIC_ERROR_CODES.BAD_REQUEST:
      return originalMessage || 'Invalid request to AI service.';
    default:
      return originalMessage || 'AI service temporarily unavailable.';
  }
}

/**
 * Map Anthropic error status to appropriate HTTP status for API response
 */
export function mapToHttpStatus(anthropicStatus: number | null): number {
  switch (anthropicStatus) {
    case ANTHROPIC_ERROR_CODES.RATE_LIMITED:
      return 429; // Pass through rate limit
    case ANTHROPIC_ERROR_CODES.OVERLOADED:
      return 503; // Service unavailable
    case ANTHROPIC_ERROR_CODES.INTERNAL_ERROR:
      return 503; // Service unavailable (upstream error)
    case ANTHROPIC_ERROR_CODES.UNAUTHORIZED:
    case ANTHROPIC_ERROR_CODES.FORBIDDEN:
      return 503; // Don't expose auth issues to client
    case ANTHROPIC_ERROR_CODES.BAD_REQUEST:
      return 400;
    default:
      return 503; // Default to service unavailable for unknown AI errors
  }
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Options for retry behavior
 */
export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
}

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
};

/**
 * Execute an Anthropic API call with automatic retry for transient errors
 *
 * @param fn - The async function to execute (should call Anthropic API)
 * @param options - Retry configuration
 * @returns The result of the function
 * @throws AnthropicApiError if all retries fail or error is not retryable
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: any = null;
  let delay = opts.initialDelayMs;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const status = getAnthropicErrorStatus(error);
      const isRetryable = status !== null && RETRYABLE_STATUS_CODES.includes(status);

      logger.warn('Anthropic API call failed', {
        attempt: attempt + 1,
        maxRetries: opts.maxRetries + 1,
        status,
        isRetryable,
        message: error.message,
      });

      // Don't retry non-retryable errors
      if (!isRetryable) {
        throw new AnthropicApiError(
          getErrorMessage(status, error.message),
          status || 500,
          error
        );
      }

      // Don't retry if we've exhausted attempts
      if (attempt >= opts.maxRetries) {
        break;
      }

      // Wait before retrying with exponential backoff
      logger.info(`Retrying Anthropic API call in ${delay}ms...`);
      await sleep(delay);
      delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelayMs);
    }
  }

  // All retries exhausted
  const status = getAnthropicErrorStatus(lastError);
  throw new AnthropicApiError(
    getErrorMessage(status, lastError?.message),
    status || 500,
    lastError
  );
}

/**
 * Wrap an error from Anthropic API into AnthropicApiError
 * Use this when not using withRetry but still need proper error handling
 */
export function wrapAnthropicError(error: any): AnthropicApiError {
  const status = getAnthropicErrorStatus(error);
  return new AnthropicApiError(
    getErrorMessage(status, error.message),
    status || 500,
    error
  );
}

/**
 * Check if an error is from Anthropic API
 */
export function isAnthropicError(error: any): boolean {
  // Check for AnthropicApiError
  if (error instanceof AnthropicApiError) {
    return true;
  }

  // Check for Anthropic SDK error patterns
  if (error?.status && typeof error.status === 'number') {
    return true;
  }

  // Check for error message patterns
  if (error?.message) {
    const message = error.message.toLowerCase();
    return (
      message.includes('anthropic') ||
      message.includes('claude') ||
      message.includes('api error') ||
      /status[:\s]+\d{3}/i.test(message)
    );
  }

  return false;
}

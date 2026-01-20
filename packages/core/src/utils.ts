import { type DedupConfig, DEFAULT_DEDUP_CONFIG } from './types.js';

/**
 * Normalize timestamp to UTC Date object
 */
export function normalizeTimestamp(input: string | number | Date): Date {
  if (input instanceof Date) {
    return input;
  }
  if (typeof input === 'number') {
    // Assume milliseconds if > 1e12, otherwise seconds
    const ms = input > 1e12 ? input : input * 1000;
    return new Date(ms);
  }
  return new Date(input);
}

/**
 * Generate URL-friendly slug from string
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Check if a new quote should be recorded based on dedup rules
 * Returns true if the quote should be written
 */
export function shouldRecordQuote(
  newPrice: number,
  lastPrice: number | null,
  lastTs: Date | null,
  now: Date,
  config: DedupConfig = DEFAULT_DEDUP_CONFIG
): boolean {
  // Always record if no previous quote exists
  if (lastPrice === null || lastTs === null) {
    return true;
  }

  // Check if enough time has passed
  const elapsedSeconds = (now.getTime() - lastTs.getTime()) / 1000;
  if (elapsedSeconds >= config.minIntervalSeconds) {
    return true;
  }

  // Check if price changed enough
  const priceChange = Math.abs(newPrice - lastPrice);
  if (priceChange >= config.epsilon) {
    return true;
  }

  return false;
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    onRetry?: (error: Error, attempt: number) => void;
  } = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    onRetry,
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === maxAttempts) {
        break;
      }

      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);

      if (onRetry) {
        onRetry(lastError, attempt);
      }

      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Batch array into chunks
 */
export function batch<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

/**
 * Format duration in human-readable format
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m ${seconds}s`;
}

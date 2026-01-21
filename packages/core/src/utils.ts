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
 * Convert price to bucket for float-safe comparison
 */
export function priceToBucket(price: number, epsilon: number): number {
  return Math.round(price / epsilon);
}

/**
 * Convert timestamp to bucket (minute-based)
 */
export function tsToBucket(ts: Date, intervalSeconds: number): number {
  return Math.floor(ts.getTime() / (intervalSeconds * 1000));
}

/**
 * Check if a new quote should be recorded based on dedup rules
 * Returns true if the quote should be written
 * Uses bucket comparison for float-safe price comparison
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

  // Float-safe price comparison using buckets
  const newBucket = priceToBucket(newPrice, config.epsilon);
  const lastBucket = priceToBucket(lastPrice, config.epsilon);
  if (newBucket !== lastBucket) {
    return true;
  }

  return false;
}

/**
 * In-memory deduplicator for a single ingestion cycle
 * Prevents duplicate quotes within the same run
 */
export class QuoteDeduplicator {
  private seen = new Set<string>();
  private readonly epsilon: number;
  private readonly intervalSeconds: number;

  constructor(config: DedupConfig = DEFAULT_DEDUP_CONFIG) {
    this.epsilon = config.epsilon;
    this.intervalSeconds = config.minIntervalSeconds;
  }

  /**
   * Check if this quote was already seen in this cycle
   * Returns true if it's a duplicate (should skip)
   */
  isDuplicate(outcomeId: number, price: number, ts: Date): boolean {
    const priceBucket = priceToBucket(price, this.epsilon);
    const timeBucket = tsToBucket(ts, this.intervalSeconds);
    const key = `${outcomeId}:${timeBucket}:${priceBucket}`;

    if (this.seen.has(key)) {
      return true;
    }

    this.seen.add(key);
    return false;
  }

  /**
   * Reset for new cycle
   */
  clear(): void {
    this.seen.clear();
  }

  /**
   * Get count of seen quotes
   */
  get size(): number {
    return this.seen.size;
  }
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * HTTP error with status code and optional Retry-After
 */
export class HttpError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly retryAfter?: number // seconds
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Check if an error is retriable
 * Retriable: 429, 408, 5xx, network errors, timeouts
 */
export function isRetriableError(error: unknown): boolean {
  if (error instanceof HttpError) {
    const { statusCode } = error;
    // 429 Too Many Requests, 408 Request Timeout, 5xx Server Errors
    return statusCode === 429 || statusCode === 408 || statusCode >= 500;
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    // Network errors
    if (
      msg.includes('network') ||
      msg.includes('econnreset') ||
      msg.includes('econnrefused') ||
      msg.includes('etimedout') ||
      msg.includes('socket hang up') ||
      msg.includes('timeout') ||
      msg.includes('abort')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Parse Retry-After header value
 * Can be seconds (integer) or HTTP-date
 * Returns delay in milliseconds, or undefined if invalid
 */
export function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (!value) return undefined;

  // Try parsing as integer (seconds)
  const seconds = parseInt(value, 10);
  if (!isNaN(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  // Try parsing as HTTP-date
  const date = Date.parse(value);
  if (!isNaN(date)) {
    const delayMs = date - Date.now();
    return delayMs > 0 ? delayMs : undefined;
  }

  return undefined;
}

/**
 * Calculate delay with exponential backoff + jitter
 */
export function calculateBackoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number
): number {
  // Exponential backoff: base * 2^(attempt-1)
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt - 1);
  // Cap at max
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);
  // Add jitter: random 0-25% of delay
  const jitter = cappedDelay * Math.random() * 0.25;
  return Math.floor(cappedDelay + jitter);
}

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (error: Error, attempt: number, delayMs: number) => void;
  shouldRetry?: (error: unknown) => boolean;
}

/**
 * Retry a function with exponential backoff + jitter
 * Respects Retry-After header if present
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 5,
    baseDelayMs = 1000,
    maxDelayMs = 60000,
    onRetry,
    shouldRetry = isRetriableError,
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if we should retry
      if (attempt === maxAttempts || !shouldRetry(error)) {
        break;
      }

      // Calculate delay
      let delayMs: number;

      // Respect Retry-After if present
      if (error instanceof HttpError && error.retryAfter) {
        delayMs = Math.min(error.retryAfter * 1000, maxDelayMs);
      } else {
        delayMs = calculateBackoffDelay(attempt, baseDelayMs, maxDelayMs);
      }

      if (onRetry) {
        onRetry(lastError, attempt, delayMs);
      }

      await sleep(delayMs);
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

// ============================================================
// v2.6.2: Ticker Extraction Helpers
// ============================================================

/**
 * Normalize ticker string: uppercase, trim whitespace
 */
export function normalizeTicker(str: string | null | undefined): string | null {
  if (!str || typeof str !== 'string') return null;
  const normalized = str.trim().toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Extract Kalshi series ticker from market metadata
 * Example: "KXBTC", "KXETH"
 */
export function getKalshiSeriesTicker(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata) return null;
  const ticker = metadata.seriesTicker ?? metadata.series_ticker;
  return normalizeTicker(ticker as string | null | undefined);
}

/**
 * Extract Kalshi event ticker from market metadata
 * Example: "KXBTCUPDOWN", "KXETHD-26JAN23"
 */
export function getKalshiEventTicker(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata) return null;
  const ticker = metadata.eventTicker ?? metadata.event_ticker;
  return normalizeTicker(ticker as string | null | undefined);
}

/**
 * Extract Kalshi market ticker from market metadata
 * Example: "KXBTCUPDOWN-26JAN23-T0945-B104500"
 */
export function getKalshiMarketTicker(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata) return null;
  const ticker = metadata.marketTicker ?? metadata.market_ticker;
  return normalizeTicker(ticker as string | null | undefined);
}

/**
 * Extract Polymarket market key from metadata
 * Uses conditionId, slug, or marketId
 */
export function getPolymarketMarketKey(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata) return null;
  const key = metadata.conditionId ?? metadata.condition_id ?? metadata.slug ?? metadata.marketId ?? metadata.market_id;
  return normalizeTicker(key as string | null | undefined);
}

/**
 * Check if a Kalshi event ticker indicates intraday markets
 * Patterns: UPDOWN, INTRADAY, minute-based tickers
 */
export function isKalshiIntradayTicker(eventTicker: string | null | undefined): boolean {
  if (!eventTicker || typeof eventTicker !== 'string') return false;
  const upper = eventTicker.toUpperCase();
  // Known intraday patterns
  if (/UPDOWN|INTRADAY|15MIN|30MIN|1HR|HOURLY/i.test(upper)) {
    return true;
  }
  // Kalshi crypto intraday pattern: KXBTCUPDOWN, KXETHUPDOWN
  if (/KX(BTC|ETH|SOL|XRP|DOGE)UPDOWN/i.test(upper)) {
    return true;
  }
  return false;
}

/**
 * Check if a Kalshi event ticker indicates daily threshold markets
 * Patterns: KXBTCD, KXETHD (daily), KXBTCP (price), dates in ticker
 */
export function isKalshiDailyTicker(eventTicker: string | null | undefined): boolean {
  if (!eventTicker || typeof eventTicker !== 'string') return false;
  const upper = eventTicker.toUpperCase();
  // Daily patterns: KXBTCD-*, KXETHD-*, KXBTCP-*
  if (/KX(BTC|ETH|SOL|XRP|DOGE)[DP]-/i.test(upper)) {
    return true;
  }
  // Has date pattern but not UPDOWN
  if (/\d{2}[A-Z]{3}\d{2}/.test(upper) && !isKalshiIntradayTicker(eventTicker)) {
    return true;
  }
  return false;
}

/**
 * Extract ticker prefix (first segment before hyphen or underscore)
 */
export function getTickerPrefix(ticker: string | null | undefined, maxLength: number = 20): string | null {
  if (!ticker || typeof ticker !== 'string') return null;
  const normalized = ticker.trim().toUpperCase();
  // Split by common delimiters
  const parts = normalized.split(/[-_]/);
  const prefix = parts[0] || null;
  if (prefix && prefix.length > maxLength) {
    return prefix.slice(0, maxLength);
  }
  return prefix;
}

/**
 * Base Adapter - Common functionality for all venue adapters
 * Extracted from polymarket.adapter.ts and kalshi.adapter.ts to eliminate duplication
 */

import { withRetry, HttpError, parseRetryAfter } from '@data-module/core';

export interface BaseAdapterConfig {
  timeoutMs: number;
}

/**
 * Abstract base class for venue adapters
 * Provides common HTTP fetch functionality with retry logic and timeout handling
 */
export abstract class BaseAdapter {
  protected config: BaseAdapterConfig;

  constructor(config: BaseAdapterConfig) {
    this.config = config;
  }

  /**
   * Fetch with retry logic and exponential backoff
   * Handles Retry-After headers from rate limiting
   */
  protected async fetchWithRetry<T>(
    url: string,
    options: RequestInit = {}
  ): Promise<T> {
    return withRetry(
      async () => {
        const response = await this.fetchWithTimeout(url, options);
        if (!response.ok) {
          const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'));
          throw new HttpError(response.status, response.statusText, retryAfterMs);
        }
        return response.json() as Promise<T>;
      },
      {
        maxAttempts: 5,
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        onRetry: (err, attempt, delayMs) => {
          const venueName = this.constructor.name.replace('Adapter', '').toLowerCase();
          console.warn(`[${venueName}] Retry ${attempt} in ${delayMs}ms: ${err.message}`);
        },
      }
    );
  }

  /**
   * Fetch with timeout using AbortController
   * Subclasses can override to add custom headers (e.g., JWT auth)
   */
  protected async fetchWithTimeout(
    url: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

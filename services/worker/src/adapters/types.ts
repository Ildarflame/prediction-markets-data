import type { Venue, MarketDTO, QuoteDTO, FetchMarketsResult, FetchMarketsParams } from '@data-module/core';

/**
 * Interface for venue adapters
 * Each prediction market platform must implement this interface
 */
export interface VenueAdapter {
  /**
   * Venue identifier
   */
  venue: Venue;

  /**
   * Fetch markets from the venue
   * Supports pagination via cursor
   */
  fetchMarkets(params?: FetchMarketsParams): Promise<FetchMarketsResult>;

  /**
   * Fetch current quotes for given markets
   */
  fetchQuotes(markets: MarketDTO[]): Promise<QuoteDTO[]>;
}

/**
 * Adapter configuration
 */
export interface AdapterConfig {
  /**
   * Maximum number of markets to fetch per request
   */
  pageSize?: number;

  /**
   * Maximum total markets to fetch in one ingestion run
   */
  maxMarkets?: number;

  /**
   * Request timeout in milliseconds
   */
  timeoutMs?: number;

  /**
   * Base URL override for testing
   */
  baseUrl?: string;
}

/**
 * Default adapter configuration
 */
export const DEFAULT_ADAPTER_CONFIG: Required<AdapterConfig> = {
  pageSize: 100,
  maxMarkets: 10000,
  timeoutMs: 30000,
  baseUrl: '',
};

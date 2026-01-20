import type { Venue, DedupConfig } from './types.js';
import { DEFAULT_DEDUP_CONFIG } from './types.js';

/**
 * Per-venue configuration
 */
export interface VenueConfig {
  dedup: DedupConfig;
  marketsRefreshSeconds: number;
  quotesRefreshSeconds: number;
  quotesClosedLookbackHours: number;
  quotesMaxMarketsPerCycle: number;
}

/**
 * Global configuration defaults
 */
export interface GlobalConfig {
  defaultDedup: DedupConfig;
  marketsRefreshSeconds: number;
  quotesRefreshSeconds: number;
  quotesClosedLookbackHours: number;
  quotesMaxMarketsPerCycle: number;
  venues: Record<Venue, VenueConfig>;
}

/**
 * Parse float from env with fallback
 */
function parseFloat(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/**
 * Parse int from env with fallback
 */
function parseInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/**
 * Load dedup config for a specific venue from env
 */
export function loadVenueDedupConfig(venue: Venue): DedupConfig {
  const venueUpper = venue.toUpperCase();

  // Try venue-specific first, then fall back to global, then default
  const epsilon = parseFloat(
    process.env[`DEDUP_EPSILON_${venueUpper}`] ?? process.env.DEDUP_EPSILON,
    DEFAULT_DEDUP_CONFIG.epsilon
  );

  const minIntervalSeconds = parseInt(
    process.env[`DEDUP_MIN_INTERVAL_SECONDS_${venueUpper}`] ?? process.env.DEDUP_MIN_INTERVAL_SECONDS,
    DEFAULT_DEDUP_CONFIG.minIntervalSeconds
  );

  return { epsilon, minIntervalSeconds };
}

/**
 * Load full venue config from env
 */
export function loadVenueConfig(venue: Venue): VenueConfig {
  return {
    dedup: loadVenueDedupConfig(venue),
    marketsRefreshSeconds: parseInt(process.env.MARKETS_REFRESH_SECONDS, 1800),
    quotesRefreshSeconds: parseInt(process.env.QUOTES_REFRESH_SECONDS, 60),
    quotesClosedLookbackHours: parseInt(process.env.QUOTES_CLOSED_LOOKBACK_HOURS, 24),
    quotesMaxMarketsPerCycle: parseInt(process.env.QUOTES_MAX_MARKETS_PER_CYCLE, 2000),
  };
}

/**
 * Load full global config from env
 */
export function loadGlobalConfig(): GlobalConfig {
  const defaultDedup: DedupConfig = {
    epsilon: parseFloat(process.env.DEDUP_EPSILON, DEFAULT_DEDUP_CONFIG.epsilon),
    minIntervalSeconds: parseInt(process.env.DEDUP_MIN_INTERVAL_SECONDS, DEFAULT_DEDUP_CONFIG.minIntervalSeconds),
  };

  return {
    defaultDedup,
    marketsRefreshSeconds: parseInt(process.env.MARKETS_REFRESH_SECONDS, 1800),
    quotesRefreshSeconds: parseInt(process.env.QUOTES_REFRESH_SECONDS, 60),
    quotesClosedLookbackHours: parseInt(process.env.QUOTES_CLOSED_LOOKBACK_HOURS, 24),
    quotesMaxMarketsPerCycle: parseInt(process.env.QUOTES_MAX_MARKETS_PER_CYCLE, 2000),
    venues: {
      polymarket: loadVenueConfig('polymarket'),
      kalshi: loadVenueConfig('kalshi'),
    },
  };
}

/**
 * Format config for logging
 */
export function formatVenueConfig(venue: Venue, config: VenueConfig): string {
  return [
    `[${venue}] Config:`,
    `  dedup.epsilon: ${config.dedup.epsilon}`,
    `  dedup.minIntervalSeconds: ${config.dedup.minIntervalSeconds}s`,
    `  marketsRefreshSeconds: ${config.marketsRefreshSeconds}s`,
    `  quotesRefreshSeconds: ${config.quotesRefreshSeconds}s`,
    `  quotesClosedLookbackHours: ${config.quotesClosedLookbackHours}h`,
    `  quotesMaxMarketsPerCycle: ${config.quotesMaxMarketsPerCycle}`,
  ].join('\n');
}

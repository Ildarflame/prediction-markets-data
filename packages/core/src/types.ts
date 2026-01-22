/**
 * Venue enum - supported prediction market platforms
 */
export type Venue = 'polymarket' | 'kalshi';

/**
 * Market status lifecycle
 */
export type MarketStatus = 'active' | 'closed' | 'resolved' | 'archived';

/**
 * Outcome side for binary markets
 */
export type OutcomeSide = 'yes' | 'no' | 'other';

/**
 * DTO for market data from venue adapters
 */
export interface MarketDTO {
  externalId: string;
  title: string;
  category?: string;
  status: MarketStatus;
  statusMeta?: Record<string, unknown>;
  closeTime?: Date;
  sourceUpdatedAt?: Date;
  outcomes: OutcomeDTO[];
  metadata?: Record<string, unknown>;
  // v3.0.2: Polymarket taxonomy fields (from Gamma API)
  pmCategories?: Array<{ slug: string; label: string }>;
  pmTags?: Array<{ slug: string; label: string }>;
  pmEventCategory?: string;
  pmEventSubcategory?: string;
  taxonomySource?: string;
}

/**
 * DTO for outcome data
 */
export interface OutcomeDTO {
  externalId?: string;
  name: string;
  side: OutcomeSide;
  metadata?: Record<string, unknown>;
}

/**
 * DTO for quote data from venue adapters
 */
export interface QuoteDTO {
  marketExternalId: string;
  outcomeExternalId?: string;
  outcomeName: string;
  ts: Date;
  price: number;
  impliedProb: number;
  liquidity?: number;
  volume?: number;
  raw?: Record<string, unknown>;
}

/**
 * Result of fetching markets from venue
 */
export interface FetchMarketsResult {
  items: MarketDTO[];
  nextCursor?: string;
}

/**
 * Parameters for fetching markets
 */
export interface FetchMarketsParams {
  cursor?: string;
  since?: string;
  limit?: number;
}

/**
 * Ingestion run statistics
 */
export interface IngestionStats {
  marketsFetched: number;
  marketsWritten: number;
  outcomesFetched: number;
  outcomesWritten: number;
  quotesFetched: number;
  quotesWritten: number;
  quotesSkippedDedup: number;
  durationMs: number;
}

/**
 * Dedup configuration
 */
export interface DedupConfig {
  /** Price change threshold (e.g., 0.001 = 0.1%) */
  epsilon: number;
  /** Minimum interval between quotes in seconds */
  minIntervalSeconds: number;
}

/**
 * Default dedup configuration
 */
export const DEFAULT_DEDUP_CONFIG: DedupConfig = {
  epsilon: 0.001,
  minIntervalSeconds: 60,
};

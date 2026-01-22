/**
 * Engine V3 Types (v3.0.0)
 *
 * Shared types for the unified matching engine.
 * Provides common interfaces for all topic pipelines.
 */

import type { Venue, EligibleMarket } from '@data-module/db';
import { CanonicalTopic } from '@data-module/core';

/**
 * Base signals interface - all topic-specific signals extend this
 */
export interface BaseSignals {
  /** Primary entity (e.g., BITCOIN, FED, TRUMP) - optional for flexibility */
  entity?: string | null;
  /** Additional entities */
  entities?: Set<string>;
  /** Raw title tokens for text matching */
  titleTokens?: string[];
}

/**
 * Score result interface - all topic-specific scores extend this
 */
export interface BaseScoreResult {
  /** Final combined score (0-1) */
  score: number;
  /** Human-readable reason/breakdown */
  reason: string;
  /** Score tier (determines auto-confirm eligibility) */
  tier: 'STRONG' | 'WEAK';
}

/**
 * Market pair with score
 */
export interface ScoredCandidate<TMarket = unknown, TScore extends BaseScoreResult = BaseScoreResult> {
  left: TMarket;
  right: TMarket;
  score: TScore;
}

/**
 * Hard gate check result
 */
export interface HardGateResult {
  /** Whether the gate passed */
  passed: boolean;
  /** Reason for failure (null if passed) */
  failReason: string | null;
}

/**
 * Fetch options for pipelines
 */
export interface FetchOptions {
  /** Venue to fetch from */
  venue: Venue;
  /** Hours to look back for markets */
  lookbackHours: number;
  /** Maximum markets to fetch */
  limit: number;
  /** Exclude sports/esports markets */
  excludeSports?: boolean;
}

/**
 * Pipeline limits
 */
export interface PipelineLimits {
  /** Max left (source) markets to process */
  maxLeft?: number;
  /** Max right (target) markets to process */
  maxRight?: number;
  /** Max suggestions per left market */
  maxPerLeft?: number;
  /** Max suggestions per right market */
  maxPerRight?: number;
}

/**
 * Engine V3 run options
 */
export interface EngineV3Options {
  /** Source venue */
  fromVenue: Venue;
  /** Target venue */
  toVenue: Venue;
  /** Canonical topic to match */
  canonicalTopic: CanonicalTopic;
  /** Lookback hours for market eligibility */
  lookbackHours?: number;
  /** Pipeline limits */
  limits?: PipelineLimits;
  /** Minimum score threshold */
  minScore?: number;
  /** Mode: 'suggest' writes to DB, 'dry-run' just returns results */
  mode?: 'suggest' | 'dry-run';
  /** Enable auto-confirm for safe matches */
  autoConfirm?: boolean;
  /** Enable auto-reject for bad matches */
  autoReject?: boolean;
  /** Debug: focus on single market ID */
  debugMarketId?: number;
}

/**
 * Engine V3 result
 */
export interface EngineV3Result {
  /** Topic that was matched */
  topic: CanonicalTopic;
  /** Algorithm version */
  algoVersion: string;
  /** Number of left markets processed */
  leftCount: number;
  /** Number of right markets processed */
  rightCount: number;
  /** Number of suggestions created */
  suggestionsCreated: number;
  /** Number of auto-confirmed */
  autoConfirmed: number;
  /** Number of auto-rejected */
  autoRejected: number;
  /** Execution time in ms */
  durationMs: number;
  /** Any errors encountered */
  errors: string[];
  /** Detailed stats per stage */
  stats: EngineV3Stats;
}

/**
 * Detailed stats for engine run
 */
export interface EngineV3Stats {
  /** Markets fetched per venue */
  marketsFetched: {
    left: number;
    right: number;
  };
  /** Markets after filtering */
  marketsAfterFilter: {
    left: number;
    right: number;
  };
  /** Index size */
  indexSize: number;
  /** Total candidate pairs evaluated */
  candidatesEvaluated: number;
  /** Candidates that passed hard gates */
  candidatesPassedGates: number;
  /** Candidates above minScore */
  candidatesAboveThreshold: number;
  /** Final suggestions after dedup */
  finalSuggestions: number;
  /** Score distribution */
  scoreDistribution: {
    '0.9+': number;
    '0.8-0.9': number;
    '0.7-0.8': number;
    '0.6-0.7': number;
    '<0.6': number;
  };
}

/**
 * Auto-confirm rule result
 */
export interface AutoConfirmResult {
  /** Whether to auto-confirm */
  shouldConfirm: boolean;
  /** Rule that triggered (or null if not triggered) */
  rule: string | null;
  /** Confidence of the rule */
  confidence: number;
}

/**
 * Auto-reject rule result
 */
export interface AutoRejectResult {
  /** Whether to auto-reject */
  shouldReject: boolean;
  /** Rule that triggered (or null if not triggered) */
  rule: string | null;
  /** Reason for rejection */
  reason: string | null;
}

/**
 * Suggestion to write to database
 */
export interface SuggestionToWrite {
  leftVenue: Venue;
  leftMarketId: number;
  rightVenue: Venue;
  rightMarketId: number;
  score: number;
  reason: string;
  algoVersion: string;
  topic: string;
}

/**
 * Market with signals (generic wrapper)
 */
export interface MarketWithSignals<TSignals extends BaseSignals> {
  market: EligibleMarket;
  signals: TSignals;
}

/**
 * Pipeline registration info
 */
export interface PipelineInfo {
  topic: CanonicalTopic;
  algoVersion: string;
  description: string;
  supportsAutoConfirm: boolean;
  supportsAutoReject: boolean;
}

/**
 * Default limits per topic
 */
export const DEFAULT_LIMITS: Record<string, PipelineLimits> = {
  CRYPTO_DAILY: {
    maxLeft: 2000,
    maxRight: 20000,
    maxPerLeft: 5,
    maxPerRight: 5,
  },
  CRYPTO_INTRADAY: {
    maxLeft: 1000,
    maxRight: 10000,
    maxPerLeft: 3,
    maxPerRight: 3,
  },
  MACRO: {
    maxLeft: 1000,
    maxRight: 5000,
    maxPerLeft: 3,
    maxPerRight: 3,
  },
  RATES: {
    maxLeft: 500,
    maxRight: 2000,
    maxPerLeft: 3,
    maxPerRight: 3,
  },
  ELECTIONS: {
    maxLeft: 1000,
    maxRight: 5000,
    maxPerLeft: 3,
    maxPerRight: 3,
  },
};

/**
 * Default min scores per topic
 */
export const DEFAULT_MIN_SCORES: Record<string, number> = {
  CRYPTO_DAILY: 0.60,
  CRYPTO_INTRADAY: 0.75,
  MACRO: 0.55,
  RATES: 0.60,
  ELECTIONS: 0.55,
};

/**
 * Default lookback hours per topic
 */
export const DEFAULT_LOOKBACK_HOURS: Record<string, number> = {
  CRYPTO_DAILY: 720,    // 30 days
  CRYPTO_INTRADAY: 24,  // 1 day
  MACRO: 720,           // 30 days
  RATES: 720,           // 30 days
  ELECTIONS: 720,       // 30 days
};

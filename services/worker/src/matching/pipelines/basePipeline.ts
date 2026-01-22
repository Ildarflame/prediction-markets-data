/**
 * Base Pipeline Interface (v3.0.0)
 *
 * Abstract interface that all topic-specific pipelines must implement.
 * Provides a consistent contract for the engineV3 orchestrator.
 */

import type { CanonicalTopic } from '@data-module/core';
import type { MarketRepository, EligibleMarket } from '@data-module/db';
import type {
  BaseSignals,
  BaseScoreResult,
  FetchOptions,
  HardGateResult,
  AutoConfirmResult,
  AutoRejectResult,
  MarketWithSignals,
  ScoredCandidate,
} from '../engineV3.types.js';

/**
 * Base pipeline interface - all topic pipelines must implement this
 *
 * @template TMarket - Market type with signals (e.g., CryptoMarket, RatesMarket)
 * @template TSignals - Signals type extracted from market (e.g., CryptoSignals, RatesSignals)
 * @template TScoreResult - Score result type (e.g., CryptoScoreResult, RatesScoreResult)
 */
export interface TopicPipeline<
  TMarket extends MarketWithSignals<TSignals>,
  TSignals extends BaseSignals,
  TScoreResult extends BaseScoreResult
> {
  /**
   * Canonical topic this pipeline handles
   */
  readonly topic: CanonicalTopic;

  /**
   * Algorithm version string (e.g., "rates@3.0.0")
   * Used for tracking and debugging
   */
  readonly algoVersion: string;

  /**
   * Human-readable description
   */
  readonly description: string;

  /**
   * Whether this pipeline supports auto-confirm
   */
  readonly supportsAutoConfirm: boolean;

  /**
   * Whether this pipeline supports auto-reject
   */
  readonly supportsAutoReject: boolean;

  /**
   * Fetch eligible markets from the database
   *
   * @param repo - Market repository
   * @param options - Fetch options
   * @returns Array of markets with extracted signals
   */
  fetchMarkets(
    repo: MarketRepository,
    options: FetchOptions
  ): Promise<TMarket[]>;

  /**
   * Build an index for efficient candidate lookup
   * Index key is typically entity + date/period
   *
   * @param markets - Markets to index
   * @returns Map from index key to markets
   */
  buildIndex(markets: TMarket[]): Map<string, TMarket[]>;

  /**
   * Find candidate matches for a given market
   *
   * @param market - Source market to find matches for
   * @param index - Pre-built index of target markets
   * @returns Array of candidate markets
   */
  findCandidates(market: TMarket, index: Map<string, TMarket[]>): TMarket[];

  /**
   * Check hard gates - fast fail conditions
   * Returns failure reason or null if gates pass
   *
   * @param left - Left market
   * @param right - Right market
   * @returns Gate check result
   */
  checkHardGates(left: TMarket, right: TMarket): HardGateResult;

  /**
   * Calculate match score between two markets
   * Returns null if markets are not comparable
   *
   * @param left - Left market
   * @param right - Right market
   * @returns Score result or null
   */
  score(left: TMarket, right: TMarket): TScoreResult | null;

  /**
   * Apply deduplication to scored candidates
   * Removes duplicates, applies per-market caps, etc.
   *
   * @param candidates - Scored candidates
   * @param options - Dedup options (maxPerLeft, maxPerRight, etc.)
   * @returns Deduplicated candidates
   */
  applyDedup(
    candidates: ScoredCandidate<TMarket, TScoreResult>[],
    options?: { maxPerLeft?: number; maxPerRight?: number; minWinnerGap?: number }
  ): ScoredCandidate<TMarket, TScoreResult>[];

  /**
   * Check if a match should be auto-confirmed
   * Only called if supportsAutoConfirm is true
   *
   * @param left - Left market
   * @param right - Right market
   * @param score - Score result
   * @returns Auto-confirm decision
   */
  shouldAutoConfirm?(
    left: TMarket,
    right: TMarket,
    score: TScoreResult
  ): AutoConfirmResult;

  /**
   * Check if a match should be auto-rejected
   * Only called if supportsAutoReject is true
   *
   * @param left - Left market
   * @param right - Right market
   * @param score - TScoreResult
   * @returns Auto-reject decision
   */
  shouldAutoReject?(
    left: TMarket,
    right: TMarket,
    score: TScoreResult
  ): AutoRejectResult;
}

/**
 * Base implementation helper for common pipeline operations
 */
export abstract class BasePipeline<
  TMarket extends MarketWithSignals<TSignals>,
  TSignals extends BaseSignals,
  TScoreResult extends BaseScoreResult
> implements TopicPipeline<TMarket, TSignals, TScoreResult> {
  abstract readonly topic: CanonicalTopic;
  abstract readonly algoVersion: string;
  abstract readonly description: string;
  abstract readonly supportsAutoConfirm: boolean;
  abstract readonly supportsAutoReject: boolean;

  abstract fetchMarkets(
    repo: MarketRepository,
    options: FetchOptions
  ): Promise<TMarket[]>;

  abstract buildIndex(markets: TMarket[]): Map<string, TMarket[]>;

  abstract findCandidates(market: TMarket, index: Map<string, TMarket[]>): TMarket[];

  abstract checkHardGates(left: TMarket, right: TMarket): HardGateResult;

  abstract score(left: TMarket, right: TMarket): TScoreResult | null;

  /**
   * Default dedup implementation
   * Sorts by score desc, applies per-market caps
   */
  applyDedup(
    candidates: ScoredCandidate<TMarket, TScoreResult>[],
    options: { maxPerLeft?: number; maxPerRight?: number; minWinnerGap?: number } = {}
  ): ScoredCandidate<TMarket, TScoreResult>[] {
    const { maxPerLeft = 5, maxPerRight = 5, minWinnerGap = 0.02 } = options;

    // Sort by score descending
    const sorted = [...candidates].sort((a, b) => b.score.score - a.score.score);

    // Track counts per market
    const leftCounts = new Map<number, number>();
    const rightCounts = new Map<number, number>();

    // Track best score per right market (for winner gap)
    const bestScorePerRight = new Map<number, number>();

    const result: ScoredCandidate<TMarket, TScoreResult>[] = [];

    for (const candidate of sorted) {
      const leftId = (candidate.left as { market: EligibleMarket }).market.id;
      const rightId = (candidate.right as { market: EligibleMarket }).market.id;

      // Check caps
      const leftCount = leftCounts.get(leftId) || 0;
      const rightCount = rightCounts.get(rightId) || 0;

      if (leftCount >= maxPerLeft || rightCount >= maxPerRight) {
        continue;
      }

      // Check winner gap (skip if too close to best for same right market)
      const bestForRight = bestScorePerRight.get(rightId);
      if (bestForRight !== undefined && minWinnerGap > 0) {
        if (bestForRight - candidate.score.score < minWinnerGap) {
          // Too close to winner, skip unless this is the first
          if (rightCount > 0) {
            continue;
          }
        }
      }

      // Accept candidate
      result.push(candidate);
      leftCounts.set(leftId, leftCount + 1);
      rightCounts.set(rightId, rightCount + 1);

      // Update best score for right
      if (bestForRight === undefined) {
        bestScorePerRight.set(rightId, candidate.score.score);
      }
    }

    return result;
  }

  /**
   * Default auto-confirm (disabled)
   */
  shouldAutoConfirm?(
    _left: TMarket,
    _right: TMarket,
    _score: TScoreResult
  ): AutoConfirmResult {
    return {
      shouldConfirm: false,
      rule: null,
      confidence: 0,
    };
  }

  /**
   * Default auto-reject (disabled)
   */
  shouldAutoReject?(
    _left: TMarket,
    _right: TMarket,
    _score: TScoreResult
  ): AutoRejectResult {
    return {
      shouldReject: false,
      rule: null,
      reason: null,
    };
  }
}

/**
 * Crypto Intraday Pipeline (v3.0.6)
 *
 * V3 wrapper for intraday crypto matching (UPDOWN, 15MIN, 1HR markets).
 *
 * Hard Gates:
 * - Entity must match (BITCOIN ↔ BITCOIN)
 * - Time bucket must match exactly
 * - Market type must be INTRADAY_UPDOWN
 *
 * Scoring Weights:
 * - entity: 0.60 (must match)
 * - time: 0.30 (exact bucket match)
 * - text: 0.10 (token overlap)
 */

import { CanonicalTopic } from '@data-module/core';
import type { MarketRepository, EligibleMarket } from '@data-module/db';
import { BasePipeline } from './basePipeline.js';
import type {
  FetchOptions,
  HardGateResult,
  AutoConfirmResult,
  AutoRejectResult,
  MarketWithSignals,
} from '../engineV3.types.js';
import {
  fetchIntradayCryptoMarkets,
  intradayMatchScore,
  type IntradaySignals,
  type IntradayScoreResult as BaseIntradayScoreResult,
} from '../cryptoPipeline.js';

/**
 * Market with intraday signals (V3 interface)
 */
export interface CryptoIntradayMarket extends MarketWithSignals<IntradaySignals> {
  market: EligibleMarket;
  signals: IntradaySignals;
}

/**
 * Extended intraday score result with tier for V3 compliance
 */
export interface IntradayScoreResult extends BaseIntradayScoreResult {
  tier: 'STRONG' | 'WEAK';
}

/**
 * Crypto Intraday Pipeline Implementation
 */
export class CryptoIntradayPipeline extends BasePipeline<CryptoIntradayMarket, IntradaySignals, IntradayScoreResult> {
  readonly topic = CanonicalTopic.CRYPTO_INTRADAY;
  readonly algoVersion = 'v3@3.0.6:CRYPTO_INTRADAY';
  readonly description = 'Intraday crypto up/down matching (15min, 1hr windows)';
  readonly supportsAutoConfirm = true;
  readonly supportsAutoReject = true;

  /**
   * Fetch eligible intraday markets only
   */
  async fetchMarkets(
    repo: MarketRepository,
    options: FetchOptions
  ): Promise<CryptoIntradayMarket[]> {
    const { venue, lookbackHours, limit, excludeSports = true } = options;

    const { markets } = await fetchIntradayCryptoMarkets(repo, {
      venue,
      lookbackHours,
      limit,
      excludeSports,
      slotSize: '1h', // Default 1 hour slots
    });

    return markets.map(m => ({
      market: m.market,
      signals: m.signals,
    }));
  }

  /**
   * Build index by entity + timeBucket
   */
  buildIndex(markets: CryptoIntradayMarket[]): Map<string, CryptoIntradayMarket[]> {
    const index = new Map<string, CryptoIntradayMarket[]>();

    for (const market of markets) {
      if (!market.signals.entity || !market.signals.timeBucket) continue;

      const key = `${market.signals.entity}|${market.signals.timeBucket}`;
      if (!index.has(key)) {
        index.set(key, []);
      }
      index.get(key)!.push(market);
    }

    return index;
  }

  /**
   * Find candidates with same entity and exact time bucket
   */
  findCandidates(market: CryptoIntradayMarket, index: Map<string, CryptoIntradayMarket[]>): CryptoIntradayMarket[] {
    if (!market.signals.entity || !market.signals.timeBucket) {
      return [];
    }

    const key = `${market.signals.entity}|${market.signals.timeBucket}`;
    return index.get(key) || [];
  }

  /**
   * Check hard gates
   */
  checkHardGates(left: CryptoIntradayMarket, right: CryptoIntradayMarket): HardGateResult {
    const lSig = left.signals;
    const rSig = right.signals;

    // Gate 1: Entity must match
    if (!lSig.entity || !rSig.entity || lSig.entity !== rSig.entity) {
      return { passed: false, failReason: 'entity_mismatch' };
    }

    // Gate 2: Time bucket must match exactly
    if (!lSig.timeBucket || !rSig.timeBucket || lSig.timeBucket !== rSig.timeBucket) {
      return { passed: false, failReason: 'time_bucket_mismatch' };
    }

    return { passed: true, failReason: null };
  }

  /**
   * Calculate match score
   */
  score(left: CryptoIntradayMarket, right: CryptoIntradayMarket): IntradayScoreResult | null {
    const baseResult = intradayMatchScore(
      { market: left.market, signals: left.signals },
      { market: right.market, signals: right.signals }
    );

    if (!baseResult) return null;

    // Add tier for V3 compliance
    const tier: 'STRONG' | 'WEAK' = baseResult.directionMatch && baseResult.score >= 0.85 ? 'STRONG' : 'WEAK';

    return {
      ...baseResult,
      tier,
    };
  }

  /**
   * Auto-confirm for exact matches
   */
  shouldAutoConfirm(
    _left: CryptoIntradayMarket,
    _right: CryptoIntradayMarket,
    scoreResult: IntradayScoreResult
  ): AutoConfirmResult {
    // Conditions for auto-confirm:
    // 1. Score >= 0.92
    // 2. Same time bucket (already checked)
    // 3. Direction match (both UP or both DOWN or both neutral)

    const shouldConfirm =
      scoreResult.score >= 0.92 &&
      scoreResult.directionMatch;

    return {
      shouldConfirm,
      rule: shouldConfirm ? 'CRYPTO_INTRADAY_EXACT_MATCH' : null,
      confidence: shouldConfirm ? scoreResult.score : 0,
    };
  }

  /**
   * Auto-reject for low-quality matches
   */
  shouldAutoReject(
    left: CryptoIntradayMarket,
    right: CryptoIntradayMarket,
    scoreResult: IntradayScoreResult
  ): AutoRejectResult {
    // Conditions for auto-reject:
    // 1. Score < 0.60
    // 2. Direction conflict (one UP, one DOWN)

    let shouldReject = false;
    let reason: string | null = null;

    if (scoreResult.score < 0.60) {
      shouldReject = true;
      reason = `Low score: ${scoreResult.score.toFixed(2)}`;
    } else if (
      left.signals.direction && right.signals.direction &&
      left.signals.direction !== right.signals.direction
    ) {
      shouldReject = true;
      reason = `Direction conflict: ${left.signals.direction} vs ${right.signals.direction}`;
    }

    return {
      shouldReject,
      rule: shouldReject ? 'CRYPTO_INTRADAY_LOW_SCORE' : null,
      reason,
    };
  }
}

/**
 * Singleton instance for registration
 */
export const cryptoIntradayPipeline = new CryptoIntradayPipeline();

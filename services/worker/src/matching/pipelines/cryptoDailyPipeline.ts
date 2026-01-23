/**
 * Crypto Daily Pipeline (v3.0.6)
 *
 * V3 wrapper for legacy crypto daily matching.
 * Excludes intraday markets (UPDOWN, 15MIN, etc.).
 *
 * Hard Gates:
 * - Entity must match (BITCOIN ↔ BITCOIN)
 * - Date types compatible (DAY_EXACT ↔ DAY_EXACT)
 * - Settle date within ±1 day
 * - Market types compatible (no INTRADAY_UPDOWN)
 *
 * Scoring Weights:
 * - entity: 0.45 (hard gate)
 * - date: 0.35 (1.0 exact, 0.6 ±1 day)
 * - numbers: 0.15 (price threshold overlap)
 * - text: 0.05 (token overlap)
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
  fetchEligibleCryptoMarkets,
  cryptoMatchScore,
  areDateTypesCompatible,
  areMarketTypesCompatible,
  CryptoMarketType,
  type CryptoSignals,
  type CryptoScoreResult,
} from '../cryptoPipeline.js';

/**
 * Market with crypto signals (V3 interface)
 */
export interface CryptoDailyMarket extends MarketWithSignals<CryptoSignals> {
  market: EligibleMarket;
  signals: CryptoSignals;
}

/**
 * Crypto Daily Pipeline Implementation
 */
export class CryptoDailyPipeline extends BasePipeline<CryptoDailyMarket, CryptoSignals, CryptoScoreResult> {
  readonly topic = CanonicalTopic.CRYPTO_DAILY;
  readonly algoVersion = 'v3@3.0.6:CRYPTO_DAILY';
  readonly description = 'Daily crypto threshold/range matching (BTC, ETH)';
  readonly supportsAutoConfirm = true;
  readonly supportsAutoReject = true;

  /**
   * Fetch eligible crypto daily markets (excludes intraday)
   */
  async fetchMarkets(
    repo: MarketRepository,
    options: FetchOptions
  ): Promise<CryptoDailyMarket[]> {
    const { venue, lookbackHours, limit, excludeSports = true } = options;

    const { markets } = await fetchEligibleCryptoMarkets(repo, {
      venue,
      lookbackHours,
      limit,
      excludeSports,
      excludeIntraday: true, // Key difference from intraday pipeline
    });

    return markets.map(m => ({
      market: m.market,
      signals: m.signals,
    }));
  }

  /**
   * Build index by entity + settleDate
   */
  buildIndex(markets: CryptoDailyMarket[]): Map<string, CryptoDailyMarket[]> {
    const index = new Map<string, CryptoDailyMarket[]>();

    for (const market of markets) {
      if (!market.signals.entity || !market.signals.settleDate) continue;

      const key = `${market.signals.entity}|${market.signals.settleDate}`;
      if (!index.has(key)) {
        index.set(key, []);
      }
      index.get(key)!.push(market);
    }

    return index;
  }

  /**
   * Find candidates with same entity and ±1 day settle date
   */
  findCandidates(market: CryptoDailyMarket, index: Map<string, CryptoDailyMarket[]>): CryptoDailyMarket[] {
    if (!market.signals.entity || !market.signals.settleDate) {
      return [];
    }

    const candidates: CryptoDailyMarket[] = [];
    const entity = market.signals.entity;
    const settleDate = market.signals.settleDate;

    // Exact match
    const exactKey = `${entity}|${settleDate}`;
    const exactMatches = index.get(exactKey) || [];
    candidates.push(...exactMatches);

    // ±1 day offset
    const dateObj = new Date(settleDate);

    const prevDate = new Date(dateObj);
    prevDate.setDate(prevDate.getDate() - 1);
    const prevKey = `${entity}|${prevDate.toISOString().slice(0, 10)}`;
    candidates.push(...(index.get(prevKey) || []));

    const nextDate = new Date(dateObj);
    nextDate.setDate(nextDate.getDate() + 1);
    const nextKey = `${entity}|${nextDate.toISOString().slice(0, 10)}`;
    candidates.push(...(index.get(nextKey) || []));

    return candidates;
  }

  /**
   * Check hard gates
   */
  checkHardGates(left: CryptoDailyMarket, right: CryptoDailyMarket): HardGateResult {
    const lSig = left.signals;
    const rSig = right.signals;

    // Gate 1: Entity must match
    if (!lSig.entity || !rSig.entity || lSig.entity !== rSig.entity) {
      return { passed: false, failReason: 'entity_mismatch' };
    }

    // Gate 2: Date types must be compatible
    if (!areDateTypesCompatible(lSig.dateType, rSig.dateType)) {
      return { passed: false, failReason: `date_type_incompatible:${lSig.dateType}/${rSig.dateType}` };
    }

    // Gate 3: Market types must be compatible (no intraday)
    if (!areMarketTypesCompatible(lSig.marketType, rSig.marketType)) {
      return { passed: false, failReason: `market_type_incompatible:${lSig.marketType}/${rSig.marketType}` };
    }

    // Gate 4: Exclude intraday explicitly
    if (lSig.marketType === CryptoMarketType.INTRADAY_UPDOWN ||
        rSig.marketType === CryptoMarketType.INTRADAY_UPDOWN) {
      return { passed: false, failReason: 'intraday_excluded' };
    }

    return { passed: true, failReason: null };
  }

  /**
   * Calculate match score
   */
  score(left: CryptoDailyMarket, right: CryptoDailyMarket): CryptoScoreResult | null {
    return cryptoMatchScore(
      { market: left.market, signals: left.signals },
      { market: right.market, signals: right.signals }
    );
  }

  /**
   * Auto-confirm for high-confidence matches
   */
  shouldAutoConfirm(
    left: CryptoDailyMarket,
    right: CryptoDailyMarket,
    scoreResult: CryptoScoreResult
  ): AutoConfirmResult {
    // Conditions for auto-confirm:
    // 1. Score >= 0.90
    // 2. Entity exact match (already checked)
    // 3. Date exact (dayDiff == 0)
    // 4. Numbers overlapping (numberScore >= 0.8)
    // 5. Both are DAILY_THRESHOLD type

    const shouldConfirm =
      scoreResult.score >= 0.90 &&
      scoreResult.dayDiff === 0 &&
      scoreResult.numberScore >= 0.8 &&
      left.signals.marketType === CryptoMarketType.DAILY_THRESHOLD &&
      right.signals.marketType === CryptoMarketType.DAILY_THRESHOLD;

    return {
      shouldConfirm,
      rule: shouldConfirm ? 'CRYPTO_DAILY_EXACT_MATCH' : null,
      confidence: shouldConfirm ? scoreResult.score : 0,
    };
  }

  /**
   * Auto-reject for low-quality matches
   */
  shouldAutoReject(
    _left: CryptoDailyMarket,
    _right: CryptoDailyMarket,
    scoreResult: CryptoScoreResult
  ): AutoRejectResult {
    // Conditions for auto-reject:
    // 1. Score < 0.55
    // 2. Day difference > 1 (shouldn't happen due to gates, but safety check)
    // 3. Incompatible market types

    let shouldReject = false;
    let reason: string | null = null;

    if (scoreResult.score < 0.55) {
      shouldReject = true;
      reason = `Low score: ${scoreResult.score.toFixed(2)}`;
    } else if (scoreResult.dayDiff !== null && scoreResult.dayDiff > 1) {
      shouldReject = true;
      reason = `Date too far: ${scoreResult.dayDiff}d`;
    }

    return {
      shouldReject,
      rule: shouldReject ? 'CRYPTO_DAILY_LOW_SCORE' : null,
      reason,
    };
  }
}

/**
 * Singleton instance for registration
 */
export const cryptoDailyPipeline = new CryptoDailyPipeline();

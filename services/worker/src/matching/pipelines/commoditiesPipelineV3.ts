/**
 * Commodities Pipeline V3 (v3.0.6)
 *
 * V3 wrapper for commodities matching (oil, gold, agriculture futures).
 *
 * Hard Gates:
 * - Underlying must match (OIL_WTI ↔ OIL_WTI)
 * - Date compatible (same month or adjacent)
 *
 * Scoring Weights:
 * - underlying: 0.45 (hard gate)
 * - date: 0.30 (same month, adjacent month)
 * - comparator: 0.10 (same direction)
 * - numbers: 0.10 (threshold overlap)
 * - text: 0.05 (token overlap)
 */

import { CanonicalTopic, tokenizeForEntities, clampScoreSimple } from '@data-module/core';
import type { MarketRepository, EligibleMarket } from '@data-module/db';
import { BasePipeline } from './basePipeline.js';
import type {
  FetchOptions,
  HardGateResult,
  AutoConfirmResult,
  AutoRejectResult,
  MarketWithSignals,
  BaseSignals,
} from '../engineV3.types.js';
import {
  extractCommoditiesSignals,
  isCommoditiesMarket,
  type CommoditiesSignals as BaseCommoditiesSignals,
} from '../commoditiesSignals.js';

/**
 * Extended commodities signals with BaseSignals compliance
 */
export interface CommoditiesSignals extends BaseCommoditiesSignals, BaseSignals {
  /** Entity maps to underlying for BaseSignals compatibility */
  entity: string | null;
}

/**
 * Market with commodities signals (V3 interface)
 */
export interface CommoditiesMarketV3 extends MarketWithSignals<CommoditiesSignals> {
  market: EligibleMarket;
  signals: CommoditiesSignals;
}

/**
 * Commodities score result
 */
export interface CommoditiesScoreResult {
  score: number;
  reason: string;
  tier: 'STRONG' | 'WEAK';
  /** Underlying match */
  underlyingScore: number;
  /** Date compatibility */
  dateScore: number;
  /** Comparator match */
  comparatorScore: number;
  /** Number/threshold overlap */
  numberScore: number;
  /** Text similarity */
  textScore: number;
}

/**
 * Scoring weights
 */
const WEIGHTS = {
  underlying: 0.45,
  date: 0.30,
  comparator: 0.10,
  numbers: 0.10,
  text: 0.05,
};

/**
 * Commodities keywords for DB query
 */
const COMMODITIES_KEYWORDS = [
  'oil', 'crude', 'wti', 'brent', 'natural gas', 'natgas',
  'gold', 'silver', 'copper', 'platinum', 'palladium',
  'corn', 'wheat', 'soybeans', 'coffee', 'sugar', 'cocoa',
];

/**
 * Commodities Pipeline V3 Implementation
 */
export class CommoditiesPipelineV3 extends BasePipeline<CommoditiesMarketV3, CommoditiesSignals, CommoditiesScoreResult> {
  readonly topic = CanonicalTopic.COMMODITIES;
  readonly algoVersion = 'v3@3.0.6:COMMODITIES';
  readonly description = 'Commodities futures matching (oil, gold, agriculture)';
  readonly supportsAutoConfirm = true;
  readonly supportsAutoReject = true;

  /**
   * Fetch eligible commodities markets
   */
  async fetchMarkets(
    repo: MarketRepository,
    options: FetchOptions
  ): Promise<CommoditiesMarketV3[]> {
    const { venue, lookbackHours, limit } = options;

    // Fetch markets with commodities keywords
    const markets = await repo.listEligibleMarkets(venue, {
      lookbackHours,
      limit,
      titleKeywords: COMMODITIES_KEYWORDS,
      orderBy: 'closeTime',
    });

    // Filter and extract signals
    const result: CommoditiesMarketV3[] = [];

    for (const market of markets) {
      const baseSignals = extractCommoditiesSignals(market.title);

      // Skip if not a commodities market (no underlying detected)
      if (!isCommoditiesMarket(baseSignals)) {
        continue;
      }

      // Map underlying to entity for BaseSignals compliance
      const signals: CommoditiesSignals = {
        ...baseSignals,
        entity: baseSignals.underlying,
      };

      result.push({ market, signals });
    }

    return result;
  }

  /**
   * Build index by underlying + month
   */
  buildIndex(markets: CommoditiesMarketV3[]): Map<string, CommoditiesMarketV3[]> {
    const index = new Map<string, CommoditiesMarketV3[]>();

    for (const market of markets) {
      if (!market.signals.underlying) continue;

      const month = market.signals.targetDate?.substring(0, 7) || market.signals.contractMonth;
      if (!month) continue;

      const key = `${market.signals.underlying}|${month}`;
      if (!index.has(key)) {
        index.set(key, []);
      }
      index.get(key)!.push(market);
    }

    return index;
  }

  /**
   * Find candidates with same underlying and compatible month
   */
  findCandidates(market: CommoditiesMarketV3, index: Map<string, CommoditiesMarketV3[]>): CommoditiesMarketV3[] {
    if (!market.signals.underlying) {
      return [];
    }

    const candidates: CommoditiesMarketV3[] = [];
    const underlying = market.signals.underlying;
    const month = market.signals.targetDate?.substring(0, 7) || market.signals.contractMonth;

    if (!month) {
      // No month - check all underlyings
      for (const [key, list] of index) {
        if (key.startsWith(underlying + '|')) {
          candidates.push(...list);
        }
      }
      return candidates;
    }

    // Exact month match
    const exactKey = `${underlying}|${month}`;
    candidates.push(...(index.get(exactKey) || []));

    // Adjacent months
    const [year, mo] = month.split('-').map(Number);
    const prevMonth = mo === 1
      ? `${year - 1}-12`
      : `${year}-${String(mo - 1).padStart(2, '0')}`;
    const nextMonth = mo === 12
      ? `${year + 1}-01`
      : `${year}-${String(mo + 1).padStart(2, '0')}`;

    candidates.push(...(index.get(`${underlying}|${prevMonth}`) || []));
    candidates.push(...(index.get(`${underlying}|${nextMonth}`) || []));

    return candidates;
  }

  /**
   * Check hard gates
   */
  checkHardGates(left: CommoditiesMarketV3, right: CommoditiesMarketV3): HardGateResult {
    const lSig = left.signals;
    const rSig = right.signals;

    // Gate 1: Underlying must match
    if (!lSig.underlying || !rSig.underlying || lSig.underlying !== rSig.underlying) {
      return { passed: false, failReason: 'underlying_mismatch' };
    }

    // Gate 2: Date must be somewhat compatible
    const leftMonth = lSig.targetDate?.substring(0, 7) || lSig.contractMonth;
    const rightMonth = rSig.targetDate?.substring(0, 7) || rSig.contractMonth;

    if (leftMonth && rightMonth) {
      const [lYear, lMo] = leftMonth.split('-').map(Number);
      const [rYear, rMo] = rightMonth.split('-').map(Number);
      const monthDiff = Math.abs((lYear * 12 + lMo) - (rYear * 12 + rMo));

      if (monthDiff > 1) {
        return { passed: false, failReason: `date_too_far:${leftMonth}/${rightMonth}` };
      }
    }

    return { passed: true, failReason: null };
  }

  /**
   * Calculate match score
   */
  score(left: CommoditiesMarketV3, right: CommoditiesMarketV3): CommoditiesScoreResult | null {
    const lSig = left.signals;
    const rSig = right.signals;

    // Check gates first
    const gateResult = this.checkHardGates(left, right);
    if (!gateResult.passed) {
      return null;
    }

    // Underlying score (already checked in gates)
    const underlyingScore = 1.0;

    // Date score
    let dateScore = 0.5; // Default for missing
    const leftMonth = lSig.targetDate?.substring(0, 7) || lSig.contractMonth;
    const rightMonth = rSig.targetDate?.substring(0, 7) || rSig.contractMonth;

    if (leftMonth && rightMonth) {
      if (leftMonth === rightMonth) {
        if (lSig.dateType === rSig.dateType) {
          dateScore = 1.0;
        } else {
          dateScore = 0.8;
        }
      } else {
        // Adjacent month
        dateScore = 0.4;
      }
    }

    // Comparator score
    let comparatorScore = 0.5;
    if (lSig.comparator && rSig.comparator) {
      if (lSig.comparator === rSig.comparator) {
        comparatorScore = 1.0;
      } else if (
        (lSig.comparator === 'GE' && rSig.comparator === 'LE') ||
        (lSig.comparator === 'LE' && rSig.comparator === 'GE')
      ) {
        comparatorScore = 0.0; // Opposite directions
      } else {
        comparatorScore = 0.3;
      }
    }

    // Number score (threshold overlap)
    let numberScore = 0.5;
    if (lSig.thresholds.length > 0 && rSig.thresholds.length > 0) {
      const lMin = Math.min(...lSig.thresholds);
      const lMax = Math.max(...lSig.thresholds);
      const rMin = Math.min(...rSig.thresholds);
      const rMax = Math.max(...rSig.thresholds);

      if (lMin <= rMax && rMin <= lMax) {
        numberScore = 1.0;
      } else {
        const gap = Math.min(Math.abs(lMax - rMin), Math.abs(rMax - lMin));
        const avg = (lMax + rMax) / 2;
        const relGap = gap / avg;
        if (relGap < 0.01) numberScore = 0.9;
        else if (relGap < 0.05) numberScore = 0.7;
        else numberScore = 0.3;
      }
    }

    // Text score
    const lTokens = new Set(tokenizeForEntities(left.market.title));
    const rTokens = new Set(tokenizeForEntities(right.market.title));
    let intersection = 0;
    for (const t of lTokens) {
      if (rTokens.has(t)) intersection++;
    }
    const union = lTokens.size + rTokens.size - intersection;
    const textScore = union > 0 ? intersection / union : 0;

    // Weighted score
    const rawScore =
      WEIGHTS.underlying * underlyingScore +
      WEIGHTS.date * dateScore +
      WEIGHTS.comparator * comparatorScore +
      WEIGHTS.numbers * numberScore +
      WEIGHTS.text * textScore;
    const score = clampScoreSimple(rawScore);

    // Tier
    const tier: 'STRONG' | 'WEAK' =
      dateScore >= 0.8 && numberScore >= 0.7 ? 'STRONG' : 'WEAK';

    const reason = `underlying=${lSig.underlying} date=${dateScore.toFixed(2)} cmp=${comparatorScore.toFixed(2)} num=${numberScore.toFixed(2)}`;

    return {
      score,
      reason,
      tier,
      underlyingScore,
      dateScore,
      comparatorScore,
      numberScore,
      textScore,
    };
  }

  /**
   * Auto-confirm for high-confidence matches
   */
  shouldAutoConfirm(
    _left: CommoditiesMarketV3,
    _right: CommoditiesMarketV3,
    scoreResult: CommoditiesScoreResult
  ): AutoConfirmResult {
    // Conditions:
    // 1. Score >= 0.90
    // 2. Same date
    // 3. Same comparator or both null
    // 4. Numbers overlapping

    const shouldConfirm =
      scoreResult.score >= 0.90 &&
      scoreResult.dateScore >= 1.0 &&
      scoreResult.comparatorScore >= 0.8 &&
      scoreResult.numberScore >= 0.8;

    return {
      shouldConfirm,
      rule: shouldConfirm ? 'COMMODITIES_EXACT_MATCH' : null,
      confidence: shouldConfirm ? scoreResult.score : 0,
    };
  }

  /**
   * Auto-reject for low-quality matches
   */
  shouldAutoReject(
    _left: CommoditiesMarketV3,
    _right: CommoditiesMarketV3,
    scoreResult: CommoditiesScoreResult
  ): AutoRejectResult {
    // Conditions:
    // 1. Score < 0.50
    // 2. Opposite comparators

    let shouldReject = false;
    let reason: string | null = null;

    if (scoreResult.score < 0.50) {
      shouldReject = true;
      reason = `Low score: ${scoreResult.score.toFixed(2)}`;
    } else if (scoreResult.comparatorScore === 0) {
      shouldReject = true;
      reason = 'Opposite comparators (GE vs LE)';
    }

    return {
      shouldReject,
      rule: shouldReject ? 'COMMODITIES_LOW_SCORE' : null,
      reason,
    };
  }
}

/**
 * Singleton instance for registration
 */
export const commoditiesPipelineV3 = new CommoditiesPipelineV3();

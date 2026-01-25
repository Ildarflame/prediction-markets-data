/**
 * Finance Pipeline (v3.1.0)
 *
 * Pipeline for matching financial markets across venues.
 * Indices (S&P 500, Nasdaq, Dow), Forex, and Bonds/Treasuries.
 */

import { CanonicalTopic, jaccard, clampScoreSimple } from '@data-module/core';
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
  extractFinanceSignals,
  isFinanceMarket,
  FinanceAssetClass,
  FinanceDirection,
  type FinanceSignals,
} from '../signals/financeSignals.js';

/**
 * Market with finance signals
 */
export interface FinanceMarket extends MarketWithSignals<FinanceSignals> {
  market: EligibleMarket;
  signals: FinanceSignals;
}

/**
 * Finance score result
 */
export interface FinanceScoreResult {
  score: number;
  reason: string;
  tier: 'STRONG' | 'WEAK';
  /** Instrument score */
  instrumentScore: number;
  /** Direction score */
  directionScore: number;
  /** Target value score */
  targetScore: number;
  /** Date score */
  dateScore: number;
  /** Text similarity score */
  textScore: number;
  /** Target value difference (for diagnostics) */
  targetDiff: number | null;
}

/**
 * Finance-specific keywords for DB query
 */
const FINANCE_KEYWORDS = [
  's&p', 's&p500', 'sp500', 'spx', 'nasdaq', 'ndx', 'dow', 'djia',
  'eur/usd', 'usd/jpy', 'gbp/usd', 'forex', 'currency',
  'treasury', 'treasuries', '10-year', '2-year', 'bond yield', 't-bill',
  'index', 'indices', 'russell', 'vix',
];

/**
 * Scoring weights for finance matching
 */
const FINANCE_WEIGHTS = {
  instrument: 0.35,    // Must match
  direction: 0.15,     // Direction match
  target: 0.25,        // Target value proximity
  date: 0.15,          // Date match
  text: 0.10,          // Text similarity
};

/**
 * Calculate target value proximity score
 * Similar to crypto bracket matching
 */
function calculateTargetScore(
  targetA: number | null,
  targetB: number | null,
  lowerA: number | null,
  upperA: number | null,
  lowerB: number | null,
  upperB: number | null
): { score: number; diff: number | null } {
  // Both null - neutral
  if (targetA === null && targetB === null && lowerA === null && lowerB === null) {
    return { score: 0.5, diff: null };
  }

  // Check for range overlap
  if (lowerA !== null && upperA !== null && lowerB !== null && upperB !== null) {
    // Both are ranges - check overlap
    const overlapLower = Math.max(lowerA, lowerB);
    const overlapUpper = Math.min(upperA, upperB);
    if (overlapLower <= overlapUpper) {
      const overlapSize = overlapUpper - overlapLower;
      const unionSize = Math.max(upperA, upperB) - Math.min(lowerA, lowerB);
      return { score: overlapSize / unionSize, diff: null };
    }
    return { score: 0, diff: null };
  }

  // One is range, one is target - check if target is in range
  if (lowerA !== null && upperA !== null && targetB !== null) {
    if (targetB >= lowerA && targetB <= upperA) {
      return { score: 0.8, diff: null };
    }
    return { score: 0.2, diff: null };
  }
  if (lowerB !== null && upperB !== null && targetA !== null) {
    if (targetA >= lowerB && targetA <= upperB) {
      return { score: 0.8, diff: null };
    }
    return { score: 0.2, diff: null };
  }

  // Both are single targets
  if (targetA !== null && targetB !== null) {
    const diff = Math.abs(targetA - targetB);
    const avg = (targetA + targetB) / 2;

    // Calculate relative difference
    const relDiff = avg > 0 ? diff / avg : 0;

    // Score based on proximity
    // Exact match: 1.0
    // 0.1% diff: 0.95
    // 1% diff: 0.8
    // 5% diff: 0.5
    // 10% diff: 0.2
    // >10% diff: 0
    if (relDiff < 0.001) {
      return { score: 1.0, diff };
    } else if (relDiff < 0.01) {
      return { score: 0.8, diff };
    } else if (relDiff < 0.05) {
      return { score: 0.5, diff };
    } else if (relDiff < 0.10) {
      return { score: 0.2, diff };
    } else {
      return { score: 0, diff };
    }
  }

  // One has target, other doesn't
  return { score: 0.3, diff: null };
}

/**
 * Calculate date score
 */
function calculateDateScore(dateA: string | null, dateB: string | null): number {
  if (dateA === null && dateB === null) {
    return 0.5;  // Both unknown - neutral
  }

  if (dateA === null || dateB === null) {
    return 0.3;  // One known, one unknown
  }

  if (dateA === dateB) {
    return 1.0;  // Exact match
  }

  // Check if dates are close (within 1 day)
  const dA = new Date(dateA);
  const dB = new Date(dateB);
  const diffDays = Math.abs((dA.getTime() - dB.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays <= 1) {
    return 0.8;  // Within 1 day
  } else if (diffDays <= 7) {
    return 0.5;  // Within 1 week
  } else {
    return 0;    // Different dates
  }
}

/**
 * Finance Pipeline Implementation
 */
export class FinancePipeline extends BasePipeline<FinanceMarket, FinanceSignals, FinanceScoreResult> {
  readonly topic = CanonicalTopic.FINANCE;
  readonly algoVersion = 'finance@3.1.0';
  readonly description = 'Financial market matching (indices, forex, bonds)';
  readonly supportsAutoConfirm = true;
  readonly supportsAutoReject = true;

  /**
   * Fetch eligible finance markets
   */
  async fetchMarkets(
    repo: MarketRepository,
    options: FetchOptions
  ): Promise<FinanceMarket[]> {
    const { venue, lookbackHours, limit, excludeSports = true } = options;

    // Fetch markets with finance keywords
    const markets = await repo.listEligibleMarkets(venue, {
      lookbackHours,
      limit,
      titleKeywords: FINANCE_KEYWORDS,
      orderBy: 'closeTime',
    });

    // Filter and extract signals
    const result: FinanceMarket[] = [];

    for (const market of markets) {
      // Skip sports markets
      if (excludeSports && this.isSportsMarket(market)) {
        continue;
      }

      // Skip if not a finance market
      if (!isFinanceMarket(market.title)) {
        continue;
      }

      const signals = extractFinanceSignals(market);

      // Must have asset class and instrument to be useful
      if (signals.assetClass === FinanceAssetClass.UNKNOWN || signals.instrument === null) {
        continue;
      }

      result.push({ market, signals });
    }

    return result;
  }

  /**
   * Check if market is sports (should be excluded)
   */
  private isSportsMarket(market: EligibleMarket): boolean {
    const lower = market.title.toLowerCase();
    const sportsKeywords = [
      'nba', 'nfl', 'mlb', 'nhl', 'soccer', 'football game',
      'points', 'rebounds', 'assists', 'touchdowns',
    ];
    return sportsKeywords.some(kw => lower.includes(kw));
  }

  /**
   * Build index by instrument + date
   */
  buildIndex(markets: FinanceMarket[]): Map<string, FinanceMarket[]> {
    const index = new Map<string, FinanceMarket[]>();

    for (const market of markets) {
      // Primary key: instrument + date
      const primaryKey = `${market.signals.instrument}|${market.signals.date || 'unknown'}`;
      if (!index.has(primaryKey)) {
        index.set(primaryKey, []);
      }
      index.get(primaryKey)!.push(market);

      // Secondary key: instrument only
      const instrumentKey = `instrument|${market.signals.instrument}`;
      if (!index.has(instrumentKey)) {
        index.set(instrumentKey, []);
      }
      index.get(instrumentKey)!.push(market);

      // Asset class key
      const assetClassKey = `class|${market.signals.assetClass}|${market.signals.date || 'unknown'}`;
      if (!index.has(assetClassKey)) {
        index.set(assetClassKey, []);
      }
      index.get(assetClassKey)!.push(market);
    }

    return index;
  }

  /**
   * Find candidates for a given finance market
   */
  findCandidates(market: FinanceMarket, index: Map<string, FinanceMarket[]>): FinanceMarket[] {
    const candidates: FinanceMarket[] = [];
    const seenIds = new Set<number>();

    // Lookup by primary key
    const primaryKey = `${market.signals.instrument}|${market.signals.date || 'unknown'}`;
    for (const m of index.get(primaryKey) || []) {
      if (!seenIds.has(m.market.id)) {
        seenIds.add(m.market.id);
        candidates.push(m);
      }
    }

    // Lookup by instrument only
    const instrumentKey = `instrument|${market.signals.instrument}`;
    for (const m of index.get(instrumentKey) || []) {
      if (!seenIds.has(m.market.id)) {
        seenIds.add(m.market.id);
        candidates.push(m);
      }
    }

    return candidates;
  }

  /**
   * Check hard gates for finance matching
   */
  checkHardGates(left: FinanceMarket, right: FinanceMarket): HardGateResult {
    const lSig = left.signals;
    const rSig = right.signals;

    // Gate 1: Instrument must match
    if (lSig.instrument !== rSig.instrument) {
      return {
        passed: false,
        failReason: `Instrument mismatch: ${lSig.instrument} vs ${rSig.instrument}`,
      };
    }

    // Gate 2: Asset class should match
    if (lSig.assetClass !== rSig.assetClass) {
      return {
        passed: false,
        failReason: `Asset class mismatch: ${lSig.assetClass} vs ${rSig.assetClass}`,
      };
    }

    // Gate 3: Date should be compatible (same or within 7 days)
    if (lSig.date !== null && rSig.date !== null) {
      const dL = new Date(lSig.date);
      const dR = new Date(rSig.date);
      const diffDays = Math.abs((dL.getTime() - dR.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays > 7) {
        return {
          passed: false,
          failReason: `Date too far apart: ${lSig.date} vs ${rSig.date} (${diffDays} days)`,
        };
      }
    }

    return { passed: true, failReason: null };
  }

  /**
   * Score finance market pair
   */
  score(left: FinanceMarket, right: FinanceMarket): FinanceScoreResult | null {
    const lSig = left.signals;
    const rSig = right.signals;

    // Instrument score
    const instrumentScore = lSig.instrument === rSig.instrument ? 1.0 : 0;

    // Direction score
    let directionScore = 0;
    if (lSig.direction === rSig.direction && lSig.direction !== FinanceDirection.UNKNOWN) {
      directionScore = 1.0;
    } else if (lSig.direction === FinanceDirection.UNKNOWN || rSig.direction === FinanceDirection.UNKNOWN) {
      directionScore = 0.5;
    } else {
      // Different directions - low score but not zero
      directionScore = 0.2;
    }

    // Target score
    const { score: targetScore, diff: targetDiff } = calculateTargetScore(
      lSig.targetValue,
      rSig.targetValue,
      lSig.lowerBound,
      lSig.upperBound,
      rSig.lowerBound,
      rSig.upperBound
    );

    // Date score
    const dateScore = calculateDateScore(lSig.date, rSig.date);

    // Text score
    const lTokens = lSig.titleTokens ?? [];
    const rTokens = rSig.titleTokens ?? [];
    const textScore = jaccard(lTokens, rTokens);

    // Weighted score
    let score =
      FINANCE_WEIGHTS.instrument * instrumentScore +
      FINANCE_WEIGHTS.direction * directionScore +
      FINANCE_WEIGHTS.target * targetScore +
      FINANCE_WEIGHTS.date * dateScore +
      FINANCE_WEIGHTS.text * textScore;

    // Bonus for exact target match
    if (targetScore >= 1.0) {
      score = Math.min(1.0, score + 0.05);
    }

    // Bonus for exact date match
    if (dateScore >= 1.0) {
      score = Math.min(1.0, score + 0.05);
    }

    score = clampScoreSimple(score);

    // Tier determination
    const isStrong = instrumentScore >= 1.0 && dateScore >= 0.8 && targetScore >= 0.5;
    const tier: 'STRONG' | 'WEAK' = isStrong ? 'STRONG' : 'WEAK';

    // Build reason string
    const reason = [
      `instrument=${instrumentScore.toFixed(2)}[${lSig.instrument}]`,
      `direction=${directionScore.toFixed(2)}[${lSig.direction}/${rSig.direction}]`,
      `target=${targetScore.toFixed(2)}[${lSig.targetValue}/${rSig.targetValue}]`,
      `date=${dateScore.toFixed(2)}[${lSig.date}/${rSig.date}]`,
      `text=${textScore.toFixed(2)}`,
    ].join(' ');

    return {
      score,
      reason,
      tier,
      instrumentScore,
      directionScore,
      targetScore,
      dateScore,
      textScore,
      targetDiff,
    };
  }

  /**
   * Check if match should be auto-confirmed
   */
  shouldAutoConfirm(
    left: FinanceMarket,
    right: FinanceMarket,
    scoreResult: FinanceScoreResult
  ): AutoConfirmResult {
    const MIN_SCORE = 0.90;

    if (scoreResult.score < MIN_SCORE) {
      return { shouldConfirm: false, rule: null, confidence: 0 };
    }

    // Must have same instrument
    if (scoreResult.instrumentScore < 1.0) {
      return { shouldConfirm: false, rule: null, confidence: 0 };
    }

    // Must have exact date match
    if (scoreResult.dateScore < 1.0) {
      return { shouldConfirm: false, rule: null, confidence: 0 };
    }

    // Must have good target match
    if (scoreResult.targetScore < 0.8) {
      return { shouldConfirm: false, rule: null, confidence: 0 };
    }

    return {
      shouldConfirm: true,
      rule: 'FINANCE_EXACT_MATCH',
      confidence: scoreResult.score,
    };
  }

  /**
   * Check if match should be auto-rejected
   */
  shouldAutoReject(
    left: FinanceMarket,
    right: FinanceMarket,
    scoreResult: FinanceScoreResult
  ): AutoRejectResult {
    const lSig = left.signals;
    const rSig = right.signals;

    // Low score
    if (scoreResult.score < 0.60) {
      return {
        shouldReject: true,
        rule: 'LOW_SCORE',
        reason: `Score ${scoreResult.score.toFixed(2)} < 0.60`,
      };
    }

    // Different instruments
    if (lSig.instrument !== rSig.instrument) {
      return {
        shouldReject: true,
        rule: 'DIFFERENT_INSTRUMENTS',
        reason: `Different instruments: ${lSig.instrument} vs ${rSig.instrument}`,
      };
    }

    // Target value too different (more than 10%)
    if (scoreResult.targetScore === 0) {
      return {
        shouldReject: true,
        rule: 'TARGET_MISMATCH',
        reason: `Target values too different: ${lSig.targetValue} vs ${rSig.targetValue}`,
      };
    }

    return { shouldReject: false, rule: null, reason: null };
  }
}

/**
 * Singleton instance
 */
export const financePipeline = new FinancePipeline();

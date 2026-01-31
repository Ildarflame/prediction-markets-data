/**
 * Climate Pipeline (v3.0.10)
 *
 * V3 matching pipeline for CLIMATE topic:
 * - Hurricane tracking/landfall
 * - Temperature records
 * - Snow/rainfall
 * - Natural disasters (earthquake, volcano, flood, drought, wildfire)
 *
 * Scoring weights:
 *   kind: 0.35 (hard gate)
 *   date: 0.30
 *   region: 0.20
 *   thresholds: 0.10
 *   text: 0.05
 */

import { CanonicalTopic, jaccard } from '@data-module/core';
import type { MarketRepository } from '@data-module/db';
import {
  extractClimateSignals,
  isClimateMarket,
  areDateTypesCompatible,
  calculateDateScore,
  calculateThresholdScore,
  CLIMATE_KEYWORDS,
  type ClimateSignals,
  ClimateKind,
  ClimateDateType,
  ClimateComparator,
} from '../signals/climateSignals.js';
import type { TopicPipeline } from './basePipeline.js';
import type {
  MarketWithSignals,
  HardGateResult,
  AutoConfirmResult,
  AutoRejectResult,
  FetchOptions,
} from '../engineV3.types.js';

// ============================================================================
// TYPES
// ============================================================================

export interface ClimateMarket extends MarketWithSignals<ClimateSignals> {}

export interface ClimateScoreResult {
  score: number;
  reason: string;
  tier: 'STRONG' | 'WEAK';
  kindScore: number;
  dateScore: number;
  regionScore: number;
  thresholdScore: number;
  textScore: number;
  kindMatch: boolean;
  dateMatch: boolean;
  regionMatch: boolean | null; // null if one side has no region
  comparatorMatch: boolean | null;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const ALGO_VERSION = 'climate@3.0.10';

const WEIGHTS = {
  kind: 0.35,
  date: 0.30,
  region: 0.20,
  threshold: 0.10,
  text: 0.05,
};

// Auto-confirm thresholds (conservative for CLIMATE)
const AUTO_CONFIRM_MIN_SCORE = 0.93;
const AUTO_CONFIRM_MIN_TEXT = 0.10;

// Auto-reject thresholds
const AUTO_REJECT_MAX_SCORE = 0.55;
const AUTO_REJECT_MIN_TEXT = 0.05;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Build index key for a climate market
 */
function buildIndexKeys(market: ClimateMarket): string[] {
  const { kind, settleKey, regionKey, dateType } = market.signals;
  const keys: string[] = [];

  // Primary key: kind|date
  if (settleKey) {
    keys.push(`${kind}|${settleKey}`);

    // Add month key for day-exact dates
    if (dateType === ClimateDateType.DAY_EXACT && settleKey.length >= 7) {
      keys.push(`${kind}|${settleKey.substring(0, 7)}`);
    }
  }

  // Kind-only key as fallback
  keys.push(`${kind}|ALL`);

  // Region-specific key
  if (regionKey) {
    keys.push(`${kind}|${regionKey}`);
  }

  return keys;
}

// ============================================================================
// CLIMATE PIPELINE
// ============================================================================

export const climatePipeline: TopicPipeline<ClimateMarket, ClimateSignals, ClimateScoreResult> = {
  topic: CanonicalTopic.CLIMATE,
  algoVersion: ALGO_VERSION,
  description: 'Climate and weather events matching (hurricanes, temperature, natural disasters)',
  supportsAutoConfirm: true,  // But very conservative
  supportsAutoReject: true,

  /**
   * Fetch climate-eligible markets from a venue
   */
  async fetchMarkets(
    repo: MarketRepository,
    options: FetchOptions
  ): Promise<ClimateMarket[]> {
    const { venue, lookbackHours = 720, limit = 5000 } = options;

    // Fetch markets with climate keywords
    const markets = await repo.listEligibleMarkets(venue, {
      lookbackHours,
      limit,
      titleKeywords: CLIMATE_KEYWORDS,
      orderBy: 'closeTime',
    });

    // Extract signals
    const climateMarkets: ClimateMarket[] = [];

    for (const market of markets) {
      // Double-check it's a climate market
      if (!isClimateMarket(market.title)) {
        continue;
      }

      const signals = extractClimateSignals(market);

      // Skip if kind is OTHER with low confidence
      if (signals.kind === ClimateKind.OTHER && signals.confidence < 0.3) {
        continue;
      }

      climateMarkets.push({ market, signals });
    }

    return climateMarkets;
  },

  /**
   * Build index for fast candidate lookup
   */
  buildIndex(markets: ClimateMarket[]): Map<string, ClimateMarket[]> {
    const index = new Map<string, ClimateMarket[]>();

    for (const market of markets) {
      const keys = buildIndexKeys(market);
      for (const key of keys) {
        if (!index.has(key)) {
          index.set(key, []);
        }
        index.get(key)!.push(market);
      }
    }

    return index;
  },

  /**
   * Find candidate matches for a market
   */
  findCandidates(market: ClimateMarket, index: Map<string, ClimateMarket[]>): ClimateMarket[] {
    const keys = buildIndexKeys(market);
    const seen = new Set<number>();
    const candidates: ClimateMarket[] = [];

    for (const key of keys) {
      const matches = index.get(key) || [];
      for (const candidate of matches) {
        if (!seen.has(candidate.market.id)) {
          seen.add(candidate.market.id);
          candidates.push(candidate);
        }
      }
    }

    return candidates;
  },

  /**
   * Check hard gates (must pass for any match consideration)
   */
  checkHardGates(left: ClimateMarket, right: ClimateMarket): HardGateResult {
    const { signals: ls } = left;
    const { signals: rs } = right;

    // Gate 1: Climate kind must match
    if (ls.kind !== rs.kind) {
      return { passed: false, failReason: `kind_mismatch:${ls.kind}≠${rs.kind}` };
    }

    // Gate 2: Date type must be compatible
    if (!areDateTypesCompatible(ls.dateType, rs.dateType)) {
      return { passed: false, failReason: `date_type_incompatible:${ls.dateType}≠${rs.dateType}` };
    }

    // Gate 3: If both have regions, they must match
    if (ls.regionKey && rs.regionKey && ls.regionKey !== rs.regionKey) {
      return { passed: false, failReason: `region_mismatch:${ls.regionKey}≠${rs.regionKey}` };
    }

    // Gate 4: If both have comparators and they conflict (GE vs LE), reject
    if (ls.comparator !== ClimateComparator.UNKNOWN &&
        rs.comparator !== ClimateComparator.UNKNOWN) {
      const conflict =
        (ls.comparator === ClimateComparator.GE && rs.comparator === ClimateComparator.LE) ||
        (ls.comparator === ClimateComparator.LE && rs.comparator === ClimateComparator.GE);
      if (conflict) {
        return { passed: false, failReason: `comparator_conflict:${ls.comparator}vs${rs.comparator}` };
      }
    }

    return { passed: true, failReason: null };
  },

  /**
   * Calculate match score
   */
  score(left: ClimateMarket, right: ClimateMarket): ClimateScoreResult | null {
    const { signals: ls } = left;
    const { signals: rs } = right;

    // Kind score (already passed hard gate, so 1.0 if match)
    const kindMatch = ls.kind === rs.kind;
    const kindScore = kindMatch ? 1.0 : 0.0;

    // Date score
    const dateScore = calculateDateScore(ls.dateType, ls.settleKey, rs.dateType, rs.settleKey);
    const dateMatch = dateScore >= 0.8;

    // Region score
    let regionScore = 0.5; // Default if one/both missing
    let regionMatch: boolean | null = null;
    if (ls.regionKey && rs.regionKey) {
      regionMatch = ls.regionKey === rs.regionKey;
      regionScore = regionMatch ? 1.0 : 0.0;
    } else if (ls.regionKey || rs.regionKey) {
      // One has region, other doesn't - partial penalty
      regionScore = 0.4;
      regionMatch = null;
    }

    // Threshold score
    const thresholdScore = calculateThresholdScore(ls.thresholds, rs.thresholds);

    // Text similarity (Jaccard on tokens)
    const textScore = jaccard(ls.titleTokens, rs.titleTokens);

    // Comparator match
    let comparatorMatch: boolean | null = null;
    if (ls.comparator !== ClimateComparator.UNKNOWN && rs.comparator !== ClimateComparator.UNKNOWN) {
      comparatorMatch = ls.comparator === rs.comparator;
    }

    // Calculate weighted score
    const rawScore =
      kindScore * WEIGHTS.kind +
      dateScore * WEIGHTS.date +
      regionScore * WEIGHTS.region +
      thresholdScore * WEIGHTS.threshold +
      textScore * WEIGHTS.text;

    // Clamp to [0, 1]
    const score = Math.min(1.0, Math.max(0.0, rawScore));

    // Determine tier
    const tier = score >= 0.85 && dateMatch && (regionMatch === true || regionMatch === null) ? 'STRONG' : 'WEAK';

    // Build reason string
    const reason = [
      `kind=${kindScore.toFixed(2)}[${ls.kind}]`,
      `date=${dateScore.toFixed(2)}[${ls.dateType}/${rs.dateType}]`,
      `region=${regionScore.toFixed(2)}[${ls.regionKey || '?'}/${rs.regionKey || '?'}]`,
      `thresh=${thresholdScore.toFixed(2)}`,
      `text=${textScore.toFixed(2)}`,
    ].join(' ');

    return {
      score,
      reason,
      tier,
      kindScore,
      dateScore,
      regionScore,
      thresholdScore,
      textScore,
      kindMatch,
      dateMatch,
      regionMatch,
      comparatorMatch,
    };
  },

  /**
   * Deduplication - keep best matches per market
   */
  applyDedup(
    candidates: Array<{ left: ClimateMarket; right: ClimateMarket; score: ClimateScoreResult }>,
    options: { maxPerLeft?: number; maxPerRight?: number; minWinnerGap?: number } = {}
  ): Array<{ left: ClimateMarket; right: ClimateMarket; score: ClimateScoreResult }> {
    const { maxPerLeft = 3, maxPerRight = 3, minWinnerGap = 0.02 } = options;

    // Sort by score descending
    const sorted = [...candidates].sort((a, b) => b.score.score - a.score.score);

    const leftCounts = new Map<number, number>();
    const rightCounts = new Map<number, number>();
    const rightBestScores = new Map<number, number>();
    const result: typeof sorted = [];

    for (const candidate of sorted) {
      const leftId = candidate.left.market.id;
      const rightId = candidate.right.market.id;
      const score = candidate.score.score;

      const leftCount = leftCounts.get(leftId) || 0;
      const rightCount = rightCounts.get(rightId) || 0;

      // Check caps
      if (leftCount >= maxPerLeft) continue;
      if (rightCount >= maxPerRight) continue;

      // Check winner gap for right market
      const rightBest = rightBestScores.get(rightId);
      if (rightBest !== undefined && rightBest - score > minWinnerGap) {
        continue;
      }

      // Accept
      result.push(candidate);
      leftCounts.set(leftId, leftCount + 1);
      rightCounts.set(rightId, rightCount + 1);
      if (rightBest === undefined) {
        rightBestScores.set(rightId, score);
      }
    }

    return result;
  },

  /**
   * Auto-confirm rules (conservative for CLIMATE)
   */
  shouldAutoConfirm(
    left: ClimateMarket,
    right: ClimateMarket,
    scoreResult: ClimateScoreResult
  ): AutoConfirmResult {
    const { score, kindMatch, dateScore, regionMatch, comparatorMatch, textScore } = scoreResult;
    const { signals: ls } = left;
    const { signals: rs } = right;

    // Must pass minimum score
    if (score < AUTO_CONFIRM_MIN_SCORE) {
      return { shouldConfirm: false, rule: null, confidence: 0 };
    }

    // Must have kind match (should always be true if passed hard gates)
    if (!kindMatch) {
      return { shouldConfirm: false, rule: null, confidence: 0 };
    }

    // Date must be exact or very close
    if (dateScore < 0.9) {
      return { shouldConfirm: false, rule: null, confidence: 0 };
    }

    // If both DAY_EXACT, must be same day
    if (ls.dateType === ClimateDateType.DAY_EXACT && rs.dateType === ClimateDateType.DAY_EXACT) {
      if (ls.settleKey !== rs.settleKey) {
        return { shouldConfirm: false, rule: null, confidence: 0 };
      }
    }

    // Region must match if both specified
    if (regionMatch === false) {
      return { shouldConfirm: false, rule: null, confidence: 0 };
    }

    // Comparator must match if both specified
    if (comparatorMatch === false) {
      return { shouldConfirm: false, rule: null, confidence: 0 };
    }

    // Text sanity check
    if (textScore < AUTO_CONFIRM_MIN_TEXT) {
      return { shouldConfirm: false, rule: null, confidence: 0 };
    }

    // Threshold check - if both have thresholds, they should be close
    if (ls.thresholds.length > 0 && rs.thresholds.length > 0) {
      const threshScore = calculateThresholdScore(ls.thresholds, rs.thresholds);
      if (threshScore < 0.8) {
        return { shouldConfirm: false, rule: null, confidence: 0 };
      }
    }

    return {
      shouldConfirm: true,
      rule: 'CLIMATE_SAFE_MATCH',
      confidence: score,
    };
  },

  /**
   * Auto-reject rules
   */
  shouldAutoReject(
    left: ClimateMarket,
    right: ClimateMarket,
    scoreResult: ClimateScoreResult
  ): AutoRejectResult {
    const { score, kindMatch, dateScore, regionMatch, textScore } = scoreResult;
    const { signals: ls } = left;
    const { signals: rs } = right;

    // Low score
    if (score < AUTO_REJECT_MAX_SCORE) {
      return { shouldReject: true, rule: 'LOW_SCORE', reason: `score=${score.toFixed(3)}<${AUTO_REJECT_MAX_SCORE}` };
    }

    // Kind mismatch (should have been caught by hard gate)
    if (!kindMatch) {
      return { shouldReject: true, rule: 'KIND_MISMATCH', reason: `${ls.kind}≠${rs.kind}` };
    }

    // Date type incompatible
    if (dateScore < 0.2) {
      return { shouldReject: true, rule: 'DATE_INCOMPATIBLE', reason: `dateScore=${dateScore.toFixed(2)}` };
    }

    // Region mismatch (both have regions but different)
    if (regionMatch === false) {
      return { shouldReject: true, rule: 'REGION_MISMATCH', reason: `${ls.regionKey}≠${rs.regionKey}` };
    }

    // Very low text sanity
    if (textScore < AUTO_REJECT_MIN_TEXT) {
      return { shouldReject: true, rule: 'LOW_TEXT_SANITY', reason: `textScore=${textScore.toFixed(3)}<${AUTO_REJECT_MIN_TEXT}` };
    }

    return { shouldReject: false, rule: null, reason: null };
  },
};

// Export for registration
export default climatePipeline;

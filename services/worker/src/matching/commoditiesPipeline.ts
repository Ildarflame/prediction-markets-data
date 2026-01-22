/**
 * Commodities Pipeline (v3.0.4)
 *
 * Matching pipeline for commodities markets (oil, gold, agriculture).
 *
 * Hard Gates:
 * 1. Underlying exact match (OIL_WTI ↔ OIL_WTI)
 * 2. Date compatibility (MONTH_END ↔ MONTH_END, same month)
 *
 * Scoring Weights:
 * - underlying: 0.45 (hard gate)
 * - date: 0.30 (1.0 exact, 0.7 same month different type, 0.4 adjacent month)
 * - comparator: 0.10 (1.0 exact, 0.5 if one null)
 * - numbers: 0.10 (1.0 exact match, uses tolerance)
 * - text: 0.05 (jaccard similarity)
 */

import { getClient, type Market, type Venue } from '@data-module/db';
import { jaccard, tokenize } from '@data-module/core';
import {
  extractCommoditiesSignals,
  isCommoditiesMarket,
  formatCommoditiesSignals,
  type CommoditiesSignals,
} from './commoditiesSignals.js';

/**
 * Market with precomputed signals
 */
interface CommoditiesMarket {
  market: Market;
  signals: CommoditiesSignals;
}

/**
 * Match candidate with score
 */
interface CommoditiesCandidate {
  left: CommoditiesMarket;
  right: CommoditiesMarket;
  score: number;
  reason: string;
  passedGates: boolean;
  gateFailReason?: string;
}

/**
 * Pipeline options
 */
export interface CommoditiesPipelineOptions {
  /** Source venue (left side) */
  fromVenue: Venue;
  /** Target venue (right side) */
  toVenue: Venue;
  /** Lookback hours for markets (default: 168 = 7 days) */
  lookbackHours?: number;
  /** Min score to keep (default: 0.60) */
  minScore?: number;
  /** Max candidates per left market (default: 5) */
  maxPerLeft?: number;
  /** Debug mode - print details */
  debug?: boolean;
}

/**
 * Pipeline result
 */
export interface CommoditiesPipelineResult {
  leftCount: number;
  rightCount: number;
  candidatesFound: number;
  gatesPassed: number;
  highScoreCandidates: CommoditiesCandidate[];
  underlyingDistribution: Record<string, number>;
  durationMs: number;
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
 * Number tolerance for matching thresholds
 */
const NUMBER_TOLERANCE = {
  absolute: 1.0,      // ±1 for small numbers
  relative: 0.001,    // ±0.1% for large numbers
};

/**
 * Check if two underlyings match (hard gate)
 */
function underlyingsMatch(left: CommoditiesSignals, right: CommoditiesSignals): boolean {
  if (!left.underlying || !right.underlying) return false;
  return left.underlying === right.underlying;
}

/**
 * Check if dates are compatible (hard gate)
 */
function datesCompatible(left: CommoditiesSignals, right: CommoditiesSignals): boolean {
  // If neither has date, compatible
  if (!left.targetDate && !left.contractMonth && !right.targetDate && !right.contractMonth) {
    return true;
  }

  // Get effective month from either targetDate or contractMonth
  const leftMonth = left.targetDate?.substring(0, 7) || left.contractMonth;
  const rightMonth = right.targetDate?.substring(0, 7) || right.contractMonth;

  if (!leftMonth || !rightMonth) {
    // One has date, one doesn't - allow but will score lower
    return true;
  }

  // Same month = compatible
  if (leftMonth === rightMonth) {
    return true;
  }

  // Adjacent months might be compatible (e.g., end of June vs start of July for same contract)
  const [leftYear, leftMo] = leftMonth.split('-').map(Number);
  const [rightYear, rightMo] = rightMonth.split('-').map(Number);

  const leftMonthNum = leftYear * 12 + leftMo;
  const rightMonthNum = rightYear * 12 + rightMo;

  // Allow ±1 month
  return Math.abs(leftMonthNum - rightMonthNum) <= 1;
}

/**
 * Score date similarity
 */
function scoreDates(left: CommoditiesSignals, right: CommoditiesSignals): number {
  const leftDate = left.targetDate || left.contractMonth;
  const rightDate = right.targetDate || right.contractMonth;

  if (!leftDate && !rightDate) return 0.5; // Both missing
  if (!leftDate || !rightDate) return 0.3; // One missing

  // Exact match (including date type)
  if (left.targetDate === right.targetDate && left.dateType === right.dateType) {
    return 1.0;
  }

  // Same month
  const leftMonth = leftDate.substring(0, 7);
  const rightMonth = rightDate.substring(0, 7);

  if (leftMonth === rightMonth) {
    // Same month, different date type
    if (left.dateType !== right.dateType) return 0.7;
    // Same month, different day
    return 0.9;
  }

  // Adjacent month
  const [leftYear, leftMo] = leftMonth.split('-').map(Number);
  const [rightYear, rightMo] = rightMonth.split('-').map(Number);

  const leftMonthNum = leftYear * 12 + leftMo;
  const rightMonthNum = rightYear * 12 + rightMo;

  if (Math.abs(leftMonthNum - rightMonthNum) === 1) {
    return 0.4;
  }

  return 0.0;
}

/**
 * Score comparator similarity
 */
function scoreComparators(left: CommoditiesSignals, right: CommoditiesSignals): number {
  if (!left.comparator && !right.comparator) return 0.5;
  if (!left.comparator || !right.comparator) return 0.5;

  if (left.comparator === right.comparator) return 1.0;

  // GE/LE are opposite
  if (
    (left.comparator === 'GE' && right.comparator === 'LE') ||
    (left.comparator === 'LE' && right.comparator === 'GE')
  ) {
    return 0.0;
  }

  // BETWEEN vs GE/LE
  if (left.comparator === 'BETWEEN' || right.comparator === 'BETWEEN') {
    return 0.3;
  }

  return 0.5;
}

/**
 * Score number similarity
 */
function scoreNumbers(left: CommoditiesSignals, right: CommoditiesSignals): number {
  if (left.thresholds.length === 0 && right.thresholds.length === 0) {
    return 0.5; // Both missing
  }

  if (left.thresholds.length === 0 || right.thresholds.length === 0) {
    return 0.0; // One missing
  }

  // Find best matching pair
  let bestMatch = 0;

  for (const leftNum of left.thresholds) {
    for (const rightNum of right.thresholds) {
      const diff = Math.abs(leftNum - rightNum);
      const maxVal = Math.max(leftNum, rightNum, 1);

      // Check absolute tolerance
      if (diff <= NUMBER_TOLERANCE.absolute) {
        bestMatch = Math.max(bestMatch, 1.0);
        continue;
      }

      // Check relative tolerance
      const relDiff = diff / maxVal;
      if (relDiff <= NUMBER_TOLERANCE.relative) {
        bestMatch = Math.max(bestMatch, 1.0);
        continue;
      }

      // Partial match based on how close
      if (relDiff <= 0.01) bestMatch = Math.max(bestMatch, 0.8);
      else if (relDiff <= 0.05) bestMatch = Math.max(bestMatch, 0.5);
      else if (relDiff <= 0.10) bestMatch = Math.max(bestMatch, 0.3);
    }
  }

  return bestMatch;
}

/**
 * Score text similarity using Jaccard
 */
function scoreText(leftTitle: string, rightTitle: string): number {
  const leftTokens = tokenize(leftTitle);
  const rightTokens = tokenize(rightTitle);
  return jaccard(leftTokens, rightTokens);
}

/**
 * Score a candidate pair
 */
function scoreCandidate(left: CommoditiesMarket, right: CommoditiesMarket): CommoditiesCandidate {
  const leftSig = left.signals;
  const rightSig = right.signals;

  // Check hard gates first
  if (!underlyingsMatch(leftSig, rightSig)) {
    return {
      left,
      right,
      score: 0,
      reason: `UNDERLYING_MISMATCH: ${leftSig.underlying} vs ${rightSig.underlying}`,
      passedGates: false,
      gateFailReason: 'underlying_mismatch',
    };
  }

  if (!datesCompatible(leftSig, rightSig)) {
    const leftDate = leftSig.targetDate || leftSig.contractMonth || 'none';
    const rightDate = rightSig.targetDate || rightSig.contractMonth || 'none';
    return {
      left,
      right,
      score: 0,
      reason: `DATE_INCOMPATIBLE: ${leftDate} vs ${rightDate}`,
      passedGates: false,
      gateFailReason: 'date_incompatible',
    };
  }

  // Calculate component scores
  const dateScore = scoreDates(leftSig, rightSig);
  const comparatorScore = scoreComparators(leftSig, rightSig);
  const numbersScore = scoreNumbers(leftSig, rightSig);
  const textScore = scoreText(left.market.title, right.market.title);

  // Underlying matched = 1.0 (it's a gate)
  const underlyingScore = 1.0;

  // Weighted sum
  const totalScore = Math.min(1.0, Math.max(0,
    WEIGHTS.underlying * underlyingScore +
    WEIGHTS.date * dateScore +
    WEIGHTS.comparator * comparatorScore +
    WEIGHTS.numbers * numbersScore +
    WEIGHTS.text * textScore
  ));

  // Build reason string
  const reason = [
    `underlying=${leftSig.underlying}`,
    `date=${dateScore.toFixed(2)}(${leftSig.targetDate || leftSig.contractMonth || '?'}/${rightSig.targetDate || rightSig.contractMonth || '?'})`,
    `cmp=${comparatorScore.toFixed(2)}(${leftSig.comparator || '?'}/${rightSig.comparator || '?'})`,
    `num=${numbersScore.toFixed(2)}`,
    `text=${textScore.toFixed(2)}`,
  ].join(' ');

  return {
    left,
    right,
    score: totalScore,
    reason,
    passedGates: true,
  };
}

/**
 * Load eligible commodities markets from database
 */
async function loadCommoditiesMarkets(
  client: ReturnType<typeof getClient>,
  venue: Venue,
  lookbackHours: number
): Promise<CommoditiesMarket[]> {
  const cutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

  const markets = await client.market.findMany({
    where: {
      venue,
      status: 'active',
      closeTime: { gt: new Date() },
      createdAt: { gte: cutoff },
    },
    orderBy: { createdAt: 'desc' },
    take: 10000,
  });

  const commoditiesMarkets: CommoditiesMarket[] = [];

  for (const market of markets) {
    const signals = extractCommoditiesSignals(market.title);

    if (isCommoditiesMarket(signals)) {
      commoditiesMarkets.push({ market, signals });
    }
  }

  return commoditiesMarkets;
}

/**
 * Build index by underlying for fast lookup
 */
function buildUnderlyingIndex(markets: CommoditiesMarket[]): Map<string, CommoditiesMarket[]> {
  const index = new Map<string, CommoditiesMarket[]>();

  for (const market of markets) {
    if (market.signals.underlying) {
      const key = market.signals.underlying;
      const existing = index.get(key) || [];
      existing.push(market);
      index.set(key, existing);
    }
  }

  return index;
}

/**
 * Run commodities matching pipeline
 */
export async function runCommoditiesPipeline(
  options: CommoditiesPipelineOptions
): Promise<CommoditiesPipelineResult> {
  const {
    fromVenue,
    toVenue,
    lookbackHours = 168,
    minScore = 0.60,
    maxPerLeft = 5,
    debug = false,
  } = options;

  const startTime = Date.now();

  if (debug) {
    console.log(`\n=== Commodities Pipeline (v3.0.4) ===`);
    console.log(`From: ${fromVenue} -> To: ${toVenue}`);
    console.log(`Lookback: ${lookbackHours}h, MinScore: ${minScore}\n`);
  }

  const client = getClient();

  // Load markets
  const [leftMarkets, rightMarkets] = await Promise.all([
    loadCommoditiesMarkets(client, fromVenue, lookbackHours),
    loadCommoditiesMarkets(client, toVenue, lookbackHours),
  ]);

  if (debug) {
    console.log(`Loaded ${leftMarkets.length} left markets, ${rightMarkets.length} right markets`);
  }

  // Build underlying distribution
  const underlyingDistribution: Record<string, number> = {};
  for (const m of [...leftMarkets, ...rightMarkets]) {
    if (m.signals.underlying) {
      underlyingDistribution[m.signals.underlying] = (underlyingDistribution[m.signals.underlying] || 0) + 1;
    }
  }

  // Build index on right side
  const rightIndex = buildUnderlyingIndex(rightMarkets);

  // Find candidates
  const allCandidates: CommoditiesCandidate[] = [];
  let gatesPassed = 0;

  for (const left of leftMarkets) {
    if (!left.signals.underlying) continue;

    // Get potential matches from index
    const potentialRights = rightIndex.get(left.signals.underlying) || [];

    const candidates: CommoditiesCandidate[] = [];

    for (const right of potentialRights) {
      const candidate = scoreCandidate(left, right);

      if (candidate.passedGates) {
        gatesPassed++;
        if (candidate.score >= minScore) {
          candidates.push(candidate);
        }
      }
    }

    // Sort by score and take top N
    candidates.sort((a, b) => b.score - a.score);
    allCandidates.push(...candidates.slice(0, maxPerLeft));
  }

  // Sort all by score
  allCandidates.sort((a, b) => b.score - a.score);

  const result: CommoditiesPipelineResult = {
    leftCount: leftMarkets.length,
    rightCount: rightMarkets.length,
    candidatesFound: allCandidates.length,
    gatesPassed,
    highScoreCandidates: allCandidates.slice(0, 100),
    underlyingDistribution,
    durationMs: Date.now() - startTime,
  };

  if (debug) {
    console.log(`\nGates passed: ${gatesPassed}`);
    console.log(`Candidates (score >= ${minScore}): ${allCandidates.length}`);

    if (allCandidates.length > 0) {
      console.log(`\n--- Top 10 Candidates ---`);
      for (const c of allCandidates.slice(0, 10)) {
        console.log(`\n[${c.score.toFixed(3)}] ${c.left.market.title.substring(0, 50)}...`);
        console.log(`        ${c.right.market.title.substring(0, 50)}...`);
        console.log(`   L: ${formatCommoditiesSignals(c.left.signals)}`);
        console.log(`   R: ${formatCommoditiesSignals(c.right.signals)}`);
        console.log(`   ${c.reason}`);
      }
    }

    console.log(`\n--- Underlying Distribution ---`);
    for (const [underlying, count] of Object.entries(underlyingDistribution).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${underlying.padEnd(15)} ${count}`);
    }
  }

  return result;
}

/**
 * Count commodities markets per venue
 */
export async function runCommoditiesCounts(venues: Venue[] = ['polymarket', 'kalshi']): Promise<void> {
  console.log(`\n=== Commodities Counts (v3.0.4) ===\n`);

  const client = getClient();

  for (const venue of venues) {
    const markets = await loadCommoditiesMarkets(client, venue, 168);

    console.log(`${venue}: ${markets.length} commodities markets`);

    // Count by underlying
    const byUnderlying: Record<string, number> = {};
    for (const m of markets) {
      if (m.signals.underlying) {
        byUnderlying[m.signals.underlying] = (byUnderlying[m.signals.underlying] || 0) + 1;
      }
    }

    for (const [underlying, count] of Object.entries(byUnderlying).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${underlying.padEnd(15)} ${count}`);
    }
    console.log('');
  }
}

/**
 * Find overlap between venues for commodities
 */
export async function runCommoditiesOverlap(): Promise<void> {
  console.log(`\n=== Commodities Overlap (v3.0.4) ===\n`);

  const client = getClient();

  const [pmMarkets, kalshiMarkets] = await Promise.all([
    loadCommoditiesMarkets(client, 'polymarket', 168),
    loadCommoditiesMarkets(client, 'kalshi', 168),
  ]);

  console.log(`Polymarket: ${pmMarkets.length} markets`);
  console.log(`Kalshi: ${kalshiMarkets.length} markets\n`);

  // Find common underlyings
  const pmUnderlyings = new Set(pmMarkets.map(m => m.signals.underlying).filter(Boolean));
  const kalshiUnderlyings = new Set(kalshiMarkets.map(m => m.signals.underlying).filter(Boolean));

  const commonUnderlyings = [...pmUnderlyings].filter(u => kalshiUnderlyings.has(u));

  console.log(`Common underlyings: ${commonUnderlyings.join(', ')}`);
  console.log(`PM only: ${[...pmUnderlyings].filter(u => !kalshiUnderlyings.has(u)).join(', ')}`);
  console.log(`Kalshi only: ${[...kalshiUnderlyings].filter(u => !pmUnderlyings.has(u)).join(', ')}`);
}

/**
 * Find best commodities matches
 */
export async function runCommoditiesBest(
  options: { limit?: number; minScore?: number; debug?: boolean } = {}
): Promise<CommoditiesCandidate[]> {
  const { limit = 20, minScore = 0.70, debug = true } = options;

  const result = await runCommoditiesPipeline({
    fromVenue: 'polymarket',
    toVenue: 'kalshi',
    lookbackHours: 168,
    minScore,
    debug,
  });

  return result.highScoreCandidates.slice(0, limit);
}

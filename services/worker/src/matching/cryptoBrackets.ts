/**
 * Crypto Bracket Grouping (v2.6.0)
 *
 * Detects bracket series (markets sharing entity+settleDate+comparator but differing by threshold)
 * and collapses them into groups to reduce O(N²) explosion in matching.
 */

import { type CryptoMarket, type CryptoScoreResult } from './cryptoPipeline.js';

/**
 * A bracket group key: entity|settleDate|comparator
 */
export type BracketKey = string;

/**
 * A candidate match with scoring info
 */
export interface BracketCandidate {
  leftCrypto: CryptoMarket;
  rightCrypto: CryptoMarket;
  score: number;
  scoreResult: CryptoScoreResult;
  bracketKey: BracketKey;
}

/**
 * A bracket group containing related matches
 */
export interface BracketGroup {
  key: BracketKey;
  entity: string;
  settleDate: string;
  comparator: string;
  candidates: BracketCandidate[];
  /** Best score in the group */
  bestScore: number;
  /** Representative candidate (highest score or most central threshold) */
  representative: BracketCandidate | null;
}

/**
 * Bracket grouping options
 */
export interface BracketGroupingOptions {
  /** Max groups to keep per left market (default: 3) */
  maxGroupsPerLeft?: number;
  /** Max lines to keep per group (default: 1) */
  maxLinesPerGroup?: number;
  /** Selection strategy for representative: 'best_score' | 'central_threshold' */
  representativeStrategy?: 'best_score' | 'central_threshold';
}

/**
 * Bracket grouping statistics
 */
export interface BracketStats {
  /** Total candidates before grouping */
  totalCandidates: number;
  /** Number of unique bracket keys */
  uniqueGroups: number;
  /** Candidates saved after grouping */
  savedCandidates: number;
  /** Candidates dropped by group limit */
  droppedByGroupLimit: number;
  /** Candidates dropped within groups */
  droppedWithinGroups: number;
}

/**
 * Build a bracket key from match components
 */
export function buildBracketKey(
  entity: string | null,
  settleDate: string | null,
  comparator: string | null
): BracketKey {
  const e = entity || 'UNKNOWN';
  const d = settleDate || 'UNKNOWN';
  const c = normalizeComparator(comparator);
  return `${e}|${d}|${c}`;
}

/**
 * Normalize comparator for bracket grouping
 */
function normalizeComparator(comparator: string | null): string {
  if (!comparator) return 'UNKNOWN';
  const upper = comparator.toUpperCase();

  // Map variations to canonical forms
  const mapping: Record<string, string> = {
    'GE': 'GE',
    'GT': 'GE',
    'ABOVE': 'GE',
    'OVER': 'GE',
    'LE': 'LE',
    'LT': 'LE',
    'BELOW': 'LE',
    'UNDER': 'LE',
    'BETWEEN': 'BETWEEN',
    'RANGE': 'BETWEEN',
    'EQ': 'EQ',
    'EQUAL': 'EQ',
  };

  return mapping[upper] || upper;
}

/**
 * Group candidates into bracket groups
 */
export function groupByBracket(candidates: BracketCandidate[]): Map<BracketKey, BracketGroup> {
  const groups = new Map<BracketKey, BracketGroup>();

  for (const candidate of candidates) {
    const key = candidate.bracketKey;

    if (!groups.has(key)) {
      const rSig = candidate.rightCrypto.signals;
      groups.set(key, {
        key,
        entity: rSig.entity || 'UNKNOWN',
        settleDate: rSig.settleDate || 'UNKNOWN',
        comparator: normalizeComparator(rSig.comparator),
        candidates: [],
        bestScore: 0,
        representative: null,
      });
    }

    const group = groups.get(key)!;
    group.candidates.push(candidate);

    if (candidate.score > group.bestScore) {
      group.bestScore = candidate.score;
    }
  }

  return groups;
}

/**
 * Select representative candidate from a group
 *
 * Strategies:
 * - 'best_score': highest scoring candidate
 * - 'central_threshold': candidate with threshold closest to median
 */
export function selectRepresentative(
  group: BracketGroup,
  strategy: 'best_score' | 'central_threshold' = 'best_score'
): BracketCandidate | null {
  if (group.candidates.length === 0) return null;

  if (strategy === 'best_score' || group.candidates.length === 1) {
    // Find highest scoring candidate
    let best = group.candidates[0];
    for (const c of group.candidates) {
      if (c.score > best.score) {
        best = c;
      }
    }
    return best;
  }

  // 'central_threshold': find candidate closest to median threshold
  // Extract primary threshold from each candidate
  const thresholds: Array<{ candidate: BracketCandidate; threshold: number }> = [];

  for (const c of group.candidates) {
    const numbers = c.rightCrypto.signals.numbers;
    if (numbers.length > 0) {
      // Use first number for GE/LE, middle for BETWEEN
      const threshold = group.comparator === 'BETWEEN' && numbers.length >= 2
        ? (Math.min(...numbers) + Math.max(...numbers)) / 2
        : numbers[0];
      thresholds.push({ candidate: c, threshold });
    }
  }

  if (thresholds.length === 0) {
    // Fall back to best score
    return selectRepresentative(group, 'best_score');
  }

  // Sort by threshold to find median
  thresholds.sort((a, b) => a.threshold - b.threshold);
  const medianIdx = Math.floor(thresholds.length / 2);
  const medianThreshold = thresholds[medianIdx].threshold;

  // Find candidate closest to median
  let closest = thresholds[0];
  let closestDist = Math.abs(thresholds[0].threshold - medianThreshold);

  for (const t of thresholds) {
    const dist = Math.abs(t.threshold - medianThreshold);
    if (dist < closestDist || (dist === closestDist && t.candidate.score > closest.candidate.score)) {
      closest = t;
      closestDist = dist;
    }
  }

  return closest.candidate;
}

/**
 * Apply bracket grouping to candidates for a single left market
 *
 * Returns deduplicated candidates and stats
 */
export function applyBracketGrouping(
  candidates: BracketCandidate[],
  options: BracketGroupingOptions = {}
): { result: BracketCandidate[]; stats: BracketStats } {
  const {
    maxGroupsPerLeft = 3,
    maxLinesPerGroup = 1,
    representativeStrategy = 'best_score',
  } = options;

  const stats: BracketStats = {
    totalCandidates: candidates.length,
    uniqueGroups: 0,
    savedCandidates: 0,
    droppedByGroupLimit: 0,
    droppedWithinGroups: 0,
  };

  if (candidates.length === 0) {
    return { result: [], stats };
  }

  // Group by bracket key
  const groups = groupByBracket(candidates);
  stats.uniqueGroups = groups.size;

  // Sort groups by best score
  const sortedGroups = Array.from(groups.values()).sort((a, b) => b.bestScore - a.bestScore);

  // Keep top-K groups
  const keptGroups = sortedGroups.slice(0, maxGroupsPerLeft);
  const droppedGroups = sortedGroups.slice(maxGroupsPerLeft);

  // Count dropped candidates from excluded groups
  for (const g of droppedGroups) {
    stats.droppedByGroupLimit += g.candidates.length;
  }

  // Process kept groups
  const result: BracketCandidate[] = [];

  for (const group of keptGroups) {
    // Select representative(s) for this group
    if (maxLinesPerGroup === 1) {
      const rep = selectRepresentative(group, representativeStrategy);
      if (rep) {
        result.push(rep);
        stats.savedCandidates++;
        stats.droppedWithinGroups += group.candidates.length - 1;
      }
    } else {
      // Sort by score and take top-K
      const sorted = [...group.candidates].sort((a, b) => b.score - a.score);
      const kept = sorted.slice(0, maxLinesPerGroup);
      result.push(...kept);
      stats.savedCandidates += kept.length;
      stats.droppedWithinGroups += group.candidates.length - kept.length;
    }
  }

  return { result, stats };
}

/**
 * Diagnostic: Analyze bracket structure of markets
 */
export interface BracketAnalysis {
  /** Total right markets analyzed */
  totalMarkets: number;
  /** Markets with all required fields (entity, date, comparator, numbers) */
  completeMarkets: number;
  /** Unique bracket keys found */
  uniqueBrackets: number;
  /** Distribution of markets per bracket */
  bracketSizes: Map<number, number>;
  /** Top brackets by size */
  topBrackets: Array<{
    key: BracketKey;
    entity: string;
    settleDate: string;
    comparator: string;
    count: number;
    sampleThresholds: number[];
  }>;
}

/**
 * Analyze bracket structure of crypto markets
 */
export function analyzeBrackets(markets: CryptoMarket[], topN: number = 10): BracketAnalysis {
  const analysis: BracketAnalysis = {
    totalMarkets: markets.length,
    completeMarkets: 0,
    uniqueBrackets: 0,
    bracketSizes: new Map(),
    topBrackets: [],
  };

  // Group markets by bracket key
  const brackets = new Map<BracketKey, { markets: CryptoMarket[]; entity: string; date: string; comparator: string }>();

  for (const m of markets) {
    const sig = m.signals;

    // Check if complete
    const isComplete = sig.entity !== null &&
      sig.settleDate !== null &&
      sig.comparator !== null &&
      sig.numbers.length > 0;

    if (isComplete) {
      analysis.completeMarkets++;
    }

    // Group even incomplete markets for analysis
    const key = buildBracketKey(sig.entity, sig.settleDate, sig.comparator);

    if (!brackets.has(key)) {
      brackets.set(key, {
        markets: [],
        entity: sig.entity || 'UNKNOWN',
        date: sig.settleDate || 'UNKNOWN',
        comparator: normalizeComparator(sig.comparator),
      });
    }

    brackets.get(key)!.markets.push(m);
  }

  analysis.uniqueBrackets = brackets.size;

  // Count bracket sizes
  for (const [, bracket] of brackets) {
    const size = bracket.markets.length;
    analysis.bracketSizes.set(size, (analysis.bracketSizes.get(size) || 0) + 1);
  }

  // Find top brackets by size
  const sorted = Array.from(brackets.entries())
    .sort((a, b) => b[1].markets.length - a[1].markets.length)
    .slice(0, topN);

  for (const [key, bracket] of sorted) {
    // Extract sample thresholds
    const thresholds: number[] = [];
    for (const m of bracket.markets.slice(0, 10)) {
      if (m.signals.numbers.length > 0) {
        thresholds.push(m.signals.numbers[0]);
      }
    }
    thresholds.sort((a, b) => a - b);

    analysis.topBrackets.push({
      key,
      entity: bracket.entity,
      settleDate: bracket.date,
      comparator: bracket.comparator,
      count: bracket.markets.length,
      sampleThresholds: thresholds,
    });
  }

  return analysis;
}

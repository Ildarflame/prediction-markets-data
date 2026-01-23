/**
 * Elections Pipeline (v3.0.10)
 *
 * Pipeline for matching political/election markets across venues.
 * Presidential, senate, governor, and other election markets.
 *
 * v3.0.10: Hardened gates - UNKNOWN no longer passes against known values
 *          Increased auto-reject threshold to 0.60
 *          Better scoring for partial matches
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
  extractElectionsSignals,
  isElectionsMarket,
  ElectionCountry,
  ElectionOffice,
  ElectionIntent,
  type ElectionsSignals,
} from '../signals/electionsSignals.js';

/**
 * Market with elections signals
 */
export interface ElectionsMarket extends MarketWithSignals<ElectionsSignals> {
  market: EligibleMarket;
  signals: ElectionsSignals;
}

/**
 * Elections score result
 */
export interface ElectionsScoreResult {
  score: number;
  reason: string;
  tier: 'STRONG' | 'WEAK';
  /** Country score component */
  countryScore: number;
  /** Office score component */
  officeScore: number;
  /** Year score component */
  yearScore: number;
  /** Candidate overlap score */
  candidateScore: number;
  /** Text similarity score */
  textScore: number;
  /** State match (for state-level races) */
  stateMatch: boolean;
  /** Candidate overlap count */
  candidateOverlap: number;
}

/**
 * Elections-specific keywords for DB query
 * v3.0.10: Expanded keywords
 */
const ELECTIONS_KEYWORDS = [
  'election', 'president', 'presidential', 'senate', 'senator',
  'congress', 'house', 'governor', 'gubernatorial', 'governorship', 'electoral',
  'trump', 'biden', 'harris', 'republican', 'democrat',
  'primary', 'nominee', 'vote', 'ballot',
  // v3.0.10: More keywords for international elections
  'prime minister', 'parliament', 'chancellor', 'referendum',
  'malaysia', 'latvia', 'lebanon', 'mexico', 'brazil', 'india', 'japan',
];

/**
 * Scoring weights for elections matching
 */
const ELECTIONS_WEIGHTS = {
  country: 0.20,     // Must match (hard gate)
  office: 0.20,      // Must match (hard gate)
  year: 0.15,        // Must match (hard gate)
  candidates: 0.25,  // Candidate overlap
  text: 0.20,        // Text similarity
};

/**
 * Calculate candidate overlap score
 */
function candidateOverlapScore(
  candidatesA: string[],
  candidatesB: string[]
): { score: number; overlap: number } {
  if (candidatesA.length === 0 && candidatesB.length === 0) {
    // Neither has candidates - partial credit
    return { score: 0.5, overlap: 0 };
  }

  if (candidatesA.length === 0 || candidatesB.length === 0) {
    // One has candidates, other doesn't - low score
    return { score: 0.3, overlap: 0 };
  }

  // Calculate Jaccard similarity
  const setA = new Set(candidatesA);
  const setB = new Set(candidatesB);

  const intersection = [...setA].filter(x => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;

  const overlap = intersection;
  const score = union > 0 ? intersection / union : 0;

  return { score, overlap };
}

/**
 * Elections Pipeline Implementation
 */
export class ElectionsPipeline extends BasePipeline<ElectionsMarket, ElectionsSignals, ElectionsScoreResult> {
  readonly topic = CanonicalTopic.ELECTIONS;
  readonly algoVersion = 'elections@3.0.10';
  readonly description = 'Political and election market matching';
  readonly supportsAutoConfirm = true; // v3.0.15: Enabled with strict rules
  readonly supportsAutoReject = true;

  /**
   * Fetch eligible elections markets
   */
  async fetchMarkets(
    repo: MarketRepository,
    options: FetchOptions
  ): Promise<ElectionsMarket[]> {
    const { venue, lookbackHours, limit, excludeSports = true } = options;

    // Fetch markets with elections keywords
    const markets = await repo.listEligibleMarkets(venue, {
      lookbackHours,
      limit,
      titleKeywords: ELECTIONS_KEYWORDS,
      orderBy: 'closeTime',
    });

    // Filter and extract signals
    const result: ElectionsMarket[] = [];

    for (const market of markets) {
      // Skip sports markets
      if (excludeSports && this.isSportsMarket(market)) {
        continue;
      }

      // Skip if not an elections market
      if (!isElectionsMarket(market.title)) {
        continue;
      }

      const signals = extractElectionsSignals(market);

      // Must have country or office to be useful
      if (signals.country === ElectionCountry.UNKNOWN && signals.office === ElectionOffice.UNKNOWN) {
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
      'esports', 'dota', 'league of legends',
    ];
    return sportsKeywords.some(kw => lower.includes(kw));
  }

  /**
   * Build index by country + office + year
   */
  buildIndex(markets: ElectionsMarket[]): Map<string, ElectionsMarket[]> {
    const index = new Map<string, ElectionsMarket[]>();

    for (const market of markets) {
      // Primary key: country + office + year
      const primaryKey = `${market.signals.country}|${market.signals.office}|${market.signals.year || 'unknown'}`;
      if (!index.has(primaryKey)) {
        index.set(primaryKey, []);
      }
      index.get(primaryKey)!.push(market);

      // Secondary key: country + year (for broader matches)
      const secondaryKey = `${market.signals.country}|${market.signals.year || 'unknown'}`;
      if (!index.has(secondaryKey)) {
        index.set(secondaryKey, []);
      }
      index.get(secondaryKey)!.push(market);

      // Candidate keys
      for (const candidate of market.signals.candidates) {
        const candidateKey = `candidate|${candidate}|${market.signals.year || 'unknown'}`;
        if (!index.has(candidateKey)) {
          index.set(candidateKey, []);
        }
        index.get(candidateKey)!.push(market);
      }
    }

    return index;
  }

  /**
   * Find candidates for a given elections market
   */
  findCandidates(market: ElectionsMarket, index: Map<string, ElectionsMarket[]>): ElectionsMarket[] {
    const candidates: ElectionsMarket[] = [];
    const seenIds = new Set<number>();

    // Lookup by primary key
    const primaryKey = `${market.signals.country}|${market.signals.office}|${market.signals.year || 'unknown'}`;
    for (const m of index.get(primaryKey) || []) {
      if (!seenIds.has(m.market.id)) {
        seenIds.add(m.market.id);
        candidates.push(m);
      }
    }

    // If office is UNKNOWN, try broader lookup
    if (market.signals.office === ElectionOffice.UNKNOWN) {
      const secondaryKey = `${market.signals.country}|${market.signals.year || 'unknown'}`;
      for (const m of index.get(secondaryKey) || []) {
        if (!seenIds.has(m.market.id)) {
          seenIds.add(m.market.id);
          candidates.push(m);
        }
      }
    }

    // Lookup by candidates
    for (const candidate of market.signals.candidates) {
      const candidateKey = `candidate|${candidate}|${market.signals.year || 'unknown'}`;
      for (const m of index.get(candidateKey) || []) {
        if (!seenIds.has(m.market.id)) {
          seenIds.add(m.market.id);
          candidates.push(m);
        }
      }
    }

    return candidates;
  }

  /**
   * Check hard gates for elections matching
   * v3.0.10: UNKNOWN no longer passes against known values
   */
  checkHardGates(left: ElectionsMarket, right: ElectionsMarket): HardGateResult {
    const lSig = left.signals;
    const rSig = right.signals;

    // Gate 1: Country must match (UNKNOWN vs known = FAIL)
    if (lSig.country !== rSig.country) {
      // v3.0.10: Reject if one side is UNKNOWN and other is known
      // This prevents Malaysia (UNKNOWN) matching US elections
      return {
        passed: false,
        failReason: `Country mismatch: ${lSig.country} vs ${rSig.country}`,
      };
    }

    // Gate 2: Office must be compatible (UNKNOWN vs known = FAIL)
    if (lSig.office !== rSig.office) {
      // If either is UNKNOWN, reject
      if (lSig.office === ElectionOffice.UNKNOWN || rSig.office === ElectionOffice.UNKNOWN) {
        return {
          passed: false,
          failReason: `Office mismatch (one unknown): ${lSig.office} vs ${rSig.office}`,
        };
      }
      // Special case: HOUSE/SENATE and PARTY_CONTROL are related
      const compatible = (
        (lSig.office === ElectionOffice.HOUSE && rSig.office === ElectionOffice.PARTY_CONTROL) ||
        (lSig.office === ElectionOffice.PARTY_CONTROL && rSig.office === ElectionOffice.HOUSE) ||
        (lSig.office === ElectionOffice.SENATE && rSig.office === ElectionOffice.PARTY_CONTROL) ||
        (lSig.office === ElectionOffice.PARTY_CONTROL && rSig.office === ElectionOffice.SENATE)
      );
      if (!compatible) {
        return {
          passed: false,
          failReason: `Office mismatch: ${lSig.office} vs ${rSig.office}`,
        };
      }
    }

    // Gate 3: Year must match (null/unknown = FAIL if other has year)
    if (lSig.year !== rSig.year) {
      // If both have years and they differ, reject
      if (lSig.year !== null && rSig.year !== null) {
        return {
          passed: false,
          failReason: `Year mismatch: ${lSig.year} vs ${rSig.year}`,
        };
      }
      // v3.0.10: If one has year and other doesn't, reject
      // This prevents matching 2024 elections with undated markets
      if ((lSig.year !== null && rSig.year === null) || (lSig.year === null && rSig.year !== null)) {
        return {
          passed: false,
          failReason: `Year mismatch (one null): ${lSig.year} vs ${rSig.year}`,
        };
      }
    }

    // Gate 4: State must match (for state-level races)
    if (lSig.state && rSig.state && lSig.state !== rSig.state) {
      return {
        passed: false,
        failReason: `State mismatch: ${lSig.state} vs ${rSig.state}`,
      };
    }

    return { passed: true, failReason: null };
  }

  /**
   * Score elections market pair
   * v3.0.10: Stricter scoring - UNKNOWN gives 0 not 0.5
   */
  score(left: ElectionsMarket, right: ElectionsMarket): ElectionsScoreResult | null {
    const lSig = left.signals;
    const rSig = right.signals;

    // Country score (hard gate ensures exact match now)
    // v3.0.10: Only exact match gets 1.0
    const countryScore = lSig.country === rSig.country ? 1.0 : 0.0;

    // Office score
    // v3.0.10: UNKNOWN gets 0, not 0.5 (hard gate should have rejected anyway)
    let officeScore = 0;
    if (lSig.office === rSig.office) {
      officeScore = 1.0;
    } else if (lSig.office === ElectionOffice.UNKNOWN || rSig.office === ElectionOffice.UNKNOWN) {
      officeScore = 0.0; // v3.0.10: No partial credit for unknown
    } else {
      // Check for related offices
      const related = (
        (lSig.office === ElectionOffice.HOUSE && rSig.office === ElectionOffice.PARTY_CONTROL) ||
        (lSig.office === ElectionOffice.PARTY_CONTROL && rSig.office === ElectionOffice.HOUSE) ||
        (lSig.office === ElectionOffice.SENATE && rSig.office === ElectionOffice.PARTY_CONTROL) ||
        (lSig.office === ElectionOffice.PARTY_CONTROL && rSig.office === ElectionOffice.SENATE)
      );
      officeScore = related ? 0.7 : 0.0;
    }

    // Year score
    // v3.0.10: null year gets 0, not 0.5 (hard gate should have rejected)
    let yearScore = 0;
    if (lSig.year === rSig.year && lSig.year !== null) {
      yearScore = 1.0;
    } else if (lSig.year === null || rSig.year === null) {
      yearScore = 0.0; // v3.0.10: No partial credit for null year
    }

    // Candidate score
    const { score: candidateScore, overlap: candidateOverlap } = candidateOverlapScore(
      lSig.candidates,
      rSig.candidates
    );

    // State match
    const stateMatch = lSig.state === rSig.state || !lSig.state || !rSig.state;

    // Text score
    const lTokens = lSig.titleTokens ?? [];
    const rTokens = rSig.titleTokens ?? [];
    const textScore = jaccard(lTokens, rTokens);

    // Weighted score
    const rawScore =
      ELECTIONS_WEIGHTS.country * countryScore +
      ELECTIONS_WEIGHTS.office * officeScore +
      ELECTIONS_WEIGHTS.year * yearScore +
      ELECTIONS_WEIGHTS.candidates * candidateScore +
      ELECTIONS_WEIGHTS.text * textScore;

    // State bonus/penalty
    let score = rawScore;
    if (lSig.state && rSig.state) {
      if (lSig.state === rSig.state) {
        score = Math.min(1.0, score + 0.05); // Bonus for state match
      } else {
        score = Math.max(0, score - 0.1); // Penalty for state mismatch
      }
    }

    // v3.0.10: Cap score when both have candidates but no overlap
    if (lSig.candidates.length > 0 && rSig.candidates.length > 0 && candidateOverlap === 0) {
      score = Math.min(score, 0.65); // Cap at 0.65 per spec B2
    }

    score = clampScoreSimple(score);

    // Tier determination
    const isStrong = officeScore >= 0.7 && yearScore >= 0.5 && candidateOverlap > 0;
    const tier: 'STRONG' | 'WEAK' = isStrong ? 'STRONG' : 'WEAK';

    // Build reason string
    const reason = [
      `country=${lSig.country}`,
      `office=${officeScore.toFixed(2)}[${lSig.office}/${rSig.office}]`,
      `year=${yearScore.toFixed(2)}[${lSig.year}/${rSig.year}]`,
      `candidates=${candidateScore.toFixed(2)}(${candidateOverlap} overlap)`,
      `text=${textScore.toFixed(2)}`,
      stateMatch ? '' : `state_mismatch`,
    ].filter(Boolean).join(' ');

    return {
      score,
      reason,
      tier,
      countryScore,
      officeScore,
      yearScore,
      candidateScore,
      textScore,
      stateMatch,
      candidateOverlap,
    };
  }

  /**
   * v3.0.15: Enable auto-confirm for ELECTIONS with strict rules
   *
   * Rules:
   * - score >= 0.98
   * - country match (same country)
   * - office match (same office type)
   * - year match (same year)
   * - candidate overlap >= 1 (at least one candidate in common)
   */
  shouldAutoConfirm(
    left: ElectionsMarket,
    right: ElectionsMarket,
    scoreResult: ElectionsScoreResult
  ): AutoConfirmResult {
    // v3.0.15: Score >= 0.95 with all components at 1.0 is safe
    const MIN_SCORE = 0.95;

    // Must have high score
    if (scoreResult.score < MIN_SCORE) {
      return { shouldConfirm: false, rule: null, confidence: 0 };
    }

    const lSig = left.signals;
    const rSig = right.signals;

    // Must have country match (countryScore 1.0 = exact match)
    if (scoreResult.countryScore < 1.0) {
      return { shouldConfirm: false, rule: null, confidence: 0 };
    }

    // Must have office match (score 1.0 means exact match)
    if (scoreResult.officeScore < 1.0) {
      return { shouldConfirm: false, rule: null, confidence: 0 };
    }

    // Must have year match
    if (scoreResult.yearScore < 1.0) {
      return { shouldConfirm: false, rule: null, confidence: 0 };
    }

    // Must have at least 1 candidate overlap when both have candidates
    if (lSig.candidates.length > 0 && rSig.candidates.length > 0) {
      if (scoreResult.candidateOverlap < 1) {
        return { shouldConfirm: false, rule: null, confidence: 0 };
      }
    }

    return {
      shouldConfirm: true,
      rule: 'ELECTIONS_STRICT',
      confidence: scoreResult.score,
    };
  }

  /**
   * Check if match should be auto-rejected
   * v3.0.10: Increased threshold from 0.50 to 0.60
   */
  shouldAutoReject(
    left: ElectionsMarket,
    right: ElectionsMarket,
    scoreResult: ElectionsScoreResult
  ): AutoRejectResult {
    const lSig = left.signals;
    const rSig = right.signals;

    // v3.0.10: Increased threshold from 0.50 to 0.60
    if (scoreResult.score < 0.60) {
      return {
        shouldReject: true,
        rule: 'LOW_SCORE',
        reason: `Score ${scoreResult.score.toFixed(2)} < 0.60`,
      };
    }

    // v3.0.10: Reject if no candidate overlap when both have candidates
    // Score is capped at 0.65 in score(), and we reject if < 0.70
    // This effectively rejects all no-overlap cases (0.65 < 0.70)
    if (lSig.candidates.length > 0 && rSig.candidates.length > 0) {
      if (scoreResult.candidateOverlap === 0 && scoreResult.score < 0.70) {
        return {
          shouldReject: true,
          rule: 'NO_CANDIDATE_OVERLAP',
          reason: `No candidate overlap (score ${scoreResult.score.toFixed(2)} < 0.70): [${lSig.candidates.join(',')}] vs [${rSig.candidates.join(',')}]`,
        };
      }
    }

    // Reject if intent is incompatible
    if (lSig.intent !== ElectionIntent.UNKNOWN && rSig.intent !== ElectionIntent.UNKNOWN) {
      // WINNER vs MARGIN is compatible
      // WINNER vs TURNOUT is NOT compatible
      // WINNER vs PARTY_CONTROL is compatible
      const incompatible = (
        (lSig.intent === ElectionIntent.WINNER && rSig.intent === ElectionIntent.TURNOUT) ||
        (lSig.intent === ElectionIntent.TURNOUT && rSig.intent === ElectionIntent.WINNER) ||
        (lSig.intent === ElectionIntent.MARGIN && rSig.intent === ElectionIntent.TURNOUT) ||
        (lSig.intent === ElectionIntent.TURNOUT && rSig.intent === ElectionIntent.MARGIN)
      );
      if (incompatible) {
        return {
          shouldReject: true,
          rule: 'INTENT_MISMATCH',
          reason: `Incompatible intent: ${lSig.intent} vs ${rSig.intent}`,
        };
      }
    }

    return { shouldReject: false, rule: null, reason: null };
  }
}

/**
 * Singleton instance
 */
export const electionsPipeline = new ElectionsPipeline();

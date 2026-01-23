/**
 * Sports Pipeline (v3.0.12)
 *
 * V3 matching pipeline for SPORTS topic:
 * - Event-first matching: Teams + League + StartTime
 * - Market-level matching: MarketType + LineValue
 *
 * V2 CHANGES (v3.0.12):
 * - Event-first extraction: fetch kalshi_events for team/time enrichment
 * - Relaxed eligibility: accept teams from event OR market
 * - Support for closeTime as fallback startTime
 *
 * V1 SAFE SCOPE (still applies):
 * - Only MONEYLINE, SPREAD, TOTAL (no props, futures, parlays)
 * - Only FULL_GAME period (no halves, quarters)
 * - Auto-confirm: MONEYLINE only with strict rules
 * - Auto-reject: Aggressive for safety
 *
 * Scoring weights:
 *   eventScore (0.75):
 *     - league: 0.20
 *     - teams: 0.45 (0.225 per team)
 *     - time: 0.10
 *   lineScore (0.25):
 *     - marketType: 0.10
 *     - lineValue: 0.10
 *     - side: 0.05
 */

import { CanonicalTopic, SportsLeague, SportsMarketType, areTimeBucketsAdjacent, teamsMatch } from '@data-module/core';
import type { MarketRepository, KalshiEventRepository } from '@data-module/db';
import {
  extractSportsSignals,
  isEligibleSportsMarket,
  isEligibleSportsMarketV2,
  isEligibleSportsMarketV3,
  SPORTS_KEYWORDS,
  toSportsEventData,
  type SportsSignals,
  type SportsEventData,
} from '../signals/sportsSignals.js';
import type { TopicPipeline } from './basePipeline.js';
import type {
  MarketWithSignals,
  HardGateResult,
  AutoConfirmResult,
  AutoRejectResult,
  FetchOptions,
  ScoredCandidate,
} from '../engineV3.types.js';

// ============================================================================
// TYPES
// ============================================================================

export interface SportsMarket extends MarketWithSignals<SportsSignals> {}

export interface SportsScoreResult {
  score: number;
  reason: string;
  tier: 'STRONG' | 'WEAK';

  // Event-level scores
  eventScore: number;
  leagueScore: number;
  teamsScore: number;
  timeScore: number;

  // Line-level scores
  lineScore: number;
  marketTypeScore: number;
  lineValueScore: number;
  sideScore: number;

  // Match info
  leagueMatch: boolean;
  teamsMatch: boolean;
  timeBucketMatch: boolean;
  marketTypeMatch: boolean;
  lineValueMatch: boolean | null;  // null if N/A
}

// ============================================================================
// CONSTANTS
// ============================================================================

const ALGO_VERSION = 'sports@3.0.14';

const WEIGHTS = {
  // Event-level (0.75 total)
  league: 0.20,
  teams: 0.45,
  time: 0.10,
  // Line-level (0.25 total)
  marketType: 0.10,
  lineValue: 0.10,
  side: 0.05,
};

// Auto-confirm: MONEYLINE only, very strict
const AUTO_CONFIRM_MIN_SCORE = 0.92;
const AUTO_CONFIRM_MIN_TEXT_SANITY = 0.10;

// Auto-reject: Aggressive
const AUTO_REJECT_MAX_SCORE = 0.55;
const AUTO_REJECT_LINE_DIFF_THRESHOLD = 2.0;

// Dedup limits
const MAX_PER_LEFT = 20;
const MAX_PER_RIGHT = 5;
const MIN_WINNER_GAP = 0.10;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate Jaccard similarity
 */
function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter(x => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? intersection / union : 0;
}

/**
 * Build index keys for a sports market
 * Returns multiple keys for fuzzy matching
 */
function buildIndexKeys(market: SportsMarket): string[] {
  const { eventKey } = market.signals;
  const keys: string[] = [];

  // Primary: league|teamA|teamB|timeBucket (sorted teams)
  if (eventKey.teamA_norm && eventKey.teamB_norm && eventKey.startBucket) {
    const teams = [eventKey.teamA_norm, eventKey.teamB_norm].sort();
    keys.push(`${eventKey.league}|${teams[0]}|${teams[1]}|${eventKey.startBucket}`);

    // Also add league|teams key (without time) for broader matching
    keys.push(`${eventKey.league}|${teams[0]}|${teams[1]}`);
  }

  // Venue event ID as additional key (very strong when available)
  if (eventKey.venueEventId) {
    keys.push(`EVENT_ID|${eventKey.venueEventId}`);
  }

  return keys;
}

// ============================================================================
// SPORTS PIPELINE
// ============================================================================

export const sportsPipeline: TopicPipeline<SportsMarket, SportsSignals, SportsScoreResult> = {
  topic: CanonicalTopic.SPORTS,
  algoVersion: ALGO_VERSION,
  description: 'Sports event matching (moneyline, spread, total) - V1 safe scope',
  supportsAutoConfirm: true,   // Only for MONEYLINE
  supportsAutoReject: true,

  /**
   * Fetch sports-eligible markets from a venue (v3.0.13: derivedTopic for Kalshi)
   */
  async fetchMarkets(
    repo: MarketRepository,
    options: FetchOptions
  ): Promise<SportsMarket[]> {
    const {
      venue,
      lookbackHours = 720,
      limit = 10000,
      useV2Eligibility = false,
      useV3Eligibility = false,
      eventRepo,
    } = options;

    // v3.0.13: Use derivedTopic for Kalshi (more precise), keywords for Polymarket
    // v3.0.15: Exclude MVE markets at query level for efficiency when using V3 eligibility
    let markets;
    if (venue === 'kalshi') {
      markets = await repo.listMarketsByDerivedTopic('SPORTS', {
        venue,
        lookbackHours,
        limit,
        excludeMve: useV3Eligibility, // v3.0.15: Filter out MVE at query level
      });
      console.log(`[sportsPipeline] Fetched ${markets.length} ${venue} markets with derivedTopic=SPORTS${useV3Eligibility ? ' (non-MVE only)' : ''}`);
    } else {
      // Polymarket: keep keyword matching (no derivedTopic populated yet)
      markets = await repo.listEligibleMarkets(venue, {
        lookbackHours,
        limit,
        titleKeywords: SPORTS_KEYWORDS,
      });
      console.log(`[sportsPipeline] Fetched ${markets.length} ${venue} markets with sports keywords`);
    }

    // v3.0.12: Build event data map for Kalshi markets
    const eventDataMap = new Map<string, SportsEventData>();

    if (venue === 'kalshi' && eventRepo) {
      const kalshiEventRepo = eventRepo as KalshiEventRepository;

      // Collect event tickers from markets
      const eventTickers = new Set<string>();
      for (const market of markets) {
        if (market.kalshiEventTicker) {
          eventTickers.add(market.kalshiEventTicker);
        } else {
          // Check metadata
          const metadata = market.metadata as Record<string, unknown> | null;
          if (metadata?.eventTicker) {
            eventTickers.add(String(metadata.eventTicker));
          }
        }
      }

      if (eventTickers.size > 0) {
        console.log(`[sportsPipeline] Fetching ${eventTickers.size} events for enrichment...`);
        const eventsMap = await kalshiEventRepo.getEventsMap([...eventTickers]);
        for (const [ticker, event] of eventsMap) {
          eventDataMap.set(ticker, toSportsEventData(event));
        }
        console.log(`[sportsPipeline] Found ${eventDataMap.size} events in DB`);
      }
    }

    // Extract signals and filter eligible
    const sportsMarkets: SportsMarket[] = [];
    let excludedCount = 0;
    let eventEnrichedCount = 0;

    // v3.0.14: Select eligibility function based on options and venue
    // V3 eligibility requires market.isMve for MVE filtering - only applies to Kalshi
    // For Polymarket, use V2 eligibility (relaxed rules without MVE check)
    const getEligibility = (signals: SportsSignals, market: { isMve?: boolean | null }) => {
      // V3 eligibility only for Kalshi (has isMve data)
      if (useV3Eligibility && venue === 'kalshi') {
        const result = isEligibleSportsMarketV3(signals, market);
        return result.eligible;
      }
      // For Polymarket or when V3 not requested, use V2 or V1
      if (useV2Eligibility || (useV3Eligibility && venue !== 'kalshi')) {
        return isEligibleSportsMarketV2(signals);
      }
      return isEligibleSportsMarket(signals);
    };

    for (const market of markets) {
      // Get event data for this market (if available)
      let eventData: SportsEventData | undefined;
      if (market.kalshiEventTicker) {
        eventData = eventDataMap.get(market.kalshiEventTicker);
      } else {
        const metadata = market.metadata as Record<string, unknown> | null;
        if (metadata?.eventTicker) {
          eventData = eventDataMap.get(String(metadata.eventTicker));
        }
      }

      // Extract signals with event enrichment
      const signals = extractSportsSignals(market, eventData);

      if (eventData && signals.eventKey.teamsSource === 'event') {
        eventEnrichedCount++;
      }

      if (getEligibility(signals, { isMve: market.isMve })) {
        sportsMarkets.push({ market, signals });
      } else {
        excludedCount++;
      }
    }

    const eligibilityLabel = (useV3Eligibility && venue === 'kalshi') ? 'V3' : (useV2Eligibility || useV3Eligibility ? 'V2' : 'V1');
    console.log(`[sportsPipeline] ${venue}: ${sportsMarkets.length} eligible (${eligibilityLabel}), ${excludedCount} excluded, ${eventEnrichedCount} event-enriched`);

    return sportsMarkets;
  },

  /**
   * Build index for efficient candidate lookup
   * Key: league|teamA|teamB|timeBucket
   */
  buildIndex(markets: SportsMarket[]): Map<string, SportsMarket[]> {
    const index = new Map<string, SportsMarket[]>();

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
   * Find candidates for a given market
   * Uses event key to find same-game markets
   */
  findCandidates(market: SportsMarket, index: Map<string, SportsMarket[]>): SportsMarket[] {
    const candidates = new Set<SportsMarket>();
    const keys = buildIndexKeys(market);

    for (const key of keys) {
      const matches = index.get(key);
      if (matches) {
        for (const m of matches) {
          candidates.add(m);
        }
      }
    }

    // For event key matching, also try swapped teams and adjacent time buckets
    const { eventKey } = market.signals;
    if (eventKey.teamA_norm && eventKey.teamB_norm && eventKey.startBucket) {
      const teams = [eventKey.teamA_norm, eventKey.teamB_norm].sort();

      // Try adjacent time buckets
      for (const [key, markets] of index.entries()) {
        if (!key.startsWith(`${eventKey.league}|${teams[0]}|${teams[1]}`)) continue;

        const timeBucket = key.split('|')[3];
        if (timeBucket && areTimeBucketsAdjacent(eventKey.startBucket, timeBucket)) {
          for (const m of markets) {
            candidates.add(m);
          }
        }
      }
    }

    return [...candidates];
  },

  /**
   * Check hard gates for sports matching
   */
  checkHardGates(left: SportsMarket, right: SportsMarket): HardGateResult {
    const lEvent = left.signals.eventKey;
    const rEvent = right.signals.eventKey;
    const lLine = left.signals.line;
    const rLine = right.signals.line;

    // Gate 1: League must match
    if (lEvent.league !== rEvent.league) {
      return { passed: false, failReason: `League mismatch: ${lEvent.league} vs ${rEvent.league}` };
    }

    // Gate 2: UNKNOWN league fails
    if (lEvent.league === SportsLeague.UNKNOWN) {
      return { passed: false, failReason: 'League is UNKNOWN' };
    }

    // Gate 3: Teams must match (both teams, order-insensitive)
    const lTeams = [lEvent.teamA_norm, lEvent.teamB_norm].sort();
    const rTeams = [rEvent.teamA_norm, rEvent.teamB_norm].sort();

    const teamAMatch = teamsMatch(lTeams[0], rTeams[0]);
    const teamBMatch = teamsMatch(lTeams[1], rTeams[1]);

    if (!teamAMatch || !teamBMatch) {
      return {
        passed: false,
        failReason: `Teams mismatch: [${lTeams.join(', ')}] vs [${rTeams.join(', ')}]`,
      };
    }

    // Gate 4: Time bucket must be exact or adjacent (when teams exact)
    if (lEvent.startBucket && rEvent.startBucket) {
      if (lEvent.startBucket !== rEvent.startBucket) {
        if (!areTimeBucketsAdjacent(lEvent.startBucket, rEvent.startBucket)) {
          return {
            passed: false,
            failReason: `Time bucket mismatch: ${lEvent.startBucket} vs ${rEvent.startBucket}`,
          };
        }
      }
    } else {
      // If one or both missing time, fail
      return { passed: false, failReason: 'Missing time bucket' };
    }

    // Gate 5: Market type compatibility
    // MONEYLINE ↔ MONEYLINE, SPREAD ↔ SPREAD, TOTAL ↔ TOTAL
    if (lLine.marketType !== rLine.marketType) {
      return {
        passed: false,
        failReason: `Market type mismatch: ${lLine.marketType} vs ${rLine.marketType}`,
      };
    }

    // Gate 6: For SPREAD/TOTAL, line value must be within tolerance
    if (lLine.marketType === SportsMarketType.SPREAD || lLine.marketType === SportsMarketType.TOTAL) {
      if (lLine.lineValue !== null && rLine.lineValue !== null) {
        const lineDiff = Math.abs(lLine.lineValue - rLine.lineValue);
        if (lineDiff > AUTO_REJECT_LINE_DIFF_THRESHOLD) {
          return {
            passed: false,
            failReason: `Line value too different: ${lLine.lineValue} vs ${rLine.lineValue} (diff=${lineDiff})`,
          };
        }
      }
    }

    return { passed: true, failReason: null };
  },

  /**
   * Score a match between two sports markets
   */
  score(left: SportsMarket, right: SportsMarket): SportsScoreResult | null {
    const lEvent = left.signals.eventKey;
    const rEvent = right.signals.eventKey;
    const lLine = left.signals.line;
    const rLine = right.signals.line;

    // --- Event Score ---

    // League score (hard gate should ensure match, but score anyway)
    const leagueMatch = lEvent.league === rEvent.league && lEvent.league !== SportsLeague.UNKNOWN;
    const leagueScore = leagueMatch ? 1.0 : 0;

    // Teams score
    const lTeams = [lEvent.teamA_norm, lEvent.teamB_norm].sort();
    const rTeams = [rEvent.teamA_norm, rEvent.teamB_norm].sort();
    const team1Match = teamsMatch(lTeams[0], rTeams[0]);
    const team2Match = teamsMatch(lTeams[1], rTeams[1]);
    const teamMatchCount = (team1Match ? 1 : 0) + (team2Match ? 1 : 0);
    const teamsMatchBool = team1Match && team2Match;
    const teamsScore = teamMatchCount / 2;

    // Time score
    let timeScore = 0;
    const timeBucketMatch = lEvent.startBucket === rEvent.startBucket;
    if (timeBucketMatch) {
      timeScore = 1.0;
    } else if (lEvent.startBucket && rEvent.startBucket &&
               areTimeBucketsAdjacent(lEvent.startBucket, rEvent.startBucket)) {
      timeScore = 0.7;
    }

    const eventScore = (leagueScore * WEIGHTS.league +
                        teamsScore * WEIGHTS.teams +
                        timeScore * WEIGHTS.time) / (WEIGHTS.league + WEIGHTS.teams + WEIGHTS.time);

    // --- Line Score ---

    // Market type score
    const marketTypeMatch = lLine.marketType === rLine.marketType;
    const marketTypeScore = marketTypeMatch ? 1.0 : 0;

    // Line value score (for spread/total)
    let lineValueScore = 1.0;
    let lineValueMatch: boolean | null = null;
    if (lLine.marketType === SportsMarketType.SPREAD || lLine.marketType === SportsMarketType.TOTAL) {
      if (lLine.lineValue !== null && rLine.lineValue !== null) {
        const lineDiff = Math.abs(lLine.lineValue - rLine.lineValue);
        lineValueMatch = lineDiff <= 0.5;
        if (lineDiff === 0) lineValueScore = 1.0;
        else if (lineDiff <= 0.5) lineValueScore = 0.9;
        else if (lineDiff <= 1.0) lineValueScore = 0.7;
        else if (lineDiff <= 2.0) lineValueScore = 0.4;
        else lineValueScore = 0.1;
      } else if (lLine.lineValue === null || rLine.lineValue === null) {
        lineValueScore = 0.5;  // Neutral if one missing
        lineValueMatch = null;
      }
    }

    // Side score (OVER/UNDER, HOME/AWAY)
    let sideScore = 0.5;  // Neutral default
    if (lLine.side !== undefined && rLine.side !== undefined) {
      sideScore = lLine.side === rLine.side ? 1.0 : 0.3;
    }

    const lineScore = (marketTypeScore * WEIGHTS.marketType +
                       lineValueScore * WEIGHTS.lineValue +
                       sideScore * WEIGHTS.side) / (WEIGHTS.marketType + WEIGHTS.lineValue + WEIGHTS.side);

    // --- Combined Score ---
    const score = eventScore * 0.75 + lineScore * 0.25;

    // --- Tier ---
    const tier = score >= 0.85 ? 'STRONG' : 'WEAK';

    // --- Reason ---
    const reason = [
      `event=${eventScore.toFixed(2)} (league=${leagueMatch ? '✓' : '✗'}, teams=${teamsScore.toFixed(2)}, time=${timeScore.toFixed(2)})`,
      `line=${lineScore.toFixed(2)} (type=${marketTypeMatch ? '✓' : '✗'}, val=${lineValueScore.toFixed(2)})`,
    ].join(' | ');

    return {
      score,
      reason,
      tier,
      eventScore,
      leagueScore,
      teamsScore,
      timeScore,
      lineScore,
      marketTypeScore,
      lineValueScore,
      sideScore,
      leagueMatch,
      teamsMatch: teamsMatchBool,
      timeBucketMatch,
      marketTypeMatch,
      lineValueMatch,
    };
  },

  /**
   * Dedup with sports-specific limits
   */
  applyDedup(
    candidates: ScoredCandidate<SportsMarket, SportsScoreResult>[],
    options = {}
  ): ScoredCandidate<SportsMarket, SportsScoreResult>[] {
    const {
      maxPerLeft = MAX_PER_LEFT,
      maxPerRight = MAX_PER_RIGHT,
      minWinnerGap = MIN_WINNER_GAP,
    } = options;

    const sorted = [...candidates].sort((a, b) => b.score.score - a.score.score);
    const leftCounts = new Map<number, number>();
    const rightCounts = new Map<number, number>();
    const bestScorePerRight = new Map<number, number>();
    const result: ScoredCandidate<SportsMarket, SportsScoreResult>[] = [];

    for (const candidate of sorted) {
      const leftId = candidate.left.market.id;
      const rightId = candidate.right.market.id;

      const leftCount = leftCounts.get(leftId) || 0;
      const rightCount = rightCounts.get(rightId) || 0;

      if (leftCount >= maxPerLeft || rightCount >= maxPerRight) continue;

      const bestForRight = bestScorePerRight.get(rightId);
      if (bestForRight !== undefined && minWinnerGap > 0) {
        if (bestForRight - candidate.score.score < minWinnerGap && rightCount > 0) {
          continue;
        }
      }

      result.push(candidate);
      leftCounts.set(leftId, leftCount + 1);
      rightCounts.set(rightId, rightCount + 1);

      if (bestForRight === undefined) {
        bestScorePerRight.set(rightId, candidate.score.score);
      }
    }

    return result;
  },

  /**
   * Auto-confirm: MONEYLINE only with strict rules
   */
  shouldAutoConfirm(
    left: SportsMarket,
    right: SportsMarket,
    scoreResult: SportsScoreResult
  ): AutoConfirmResult {
    // Only auto-confirm MONEYLINE in v1
    if (left.signals.line.marketType !== SportsMarketType.MONEYLINE) {
      return { shouldConfirm: false, rule: null, confidence: 0 };
    }

    // Must have high score
    if (scoreResult.score < AUTO_CONFIRM_MIN_SCORE) {
      return { shouldConfirm: false, rule: null, confidence: 0 };
    }

    // Must have exact event match
    if (!scoreResult.leagueMatch || !scoreResult.teamsMatch) {
      return { shouldConfirm: false, rule: null, confidence: 0 };
    }

    // Time must be exact or adjacent
    if (scoreResult.timeScore < 0.7) {
      return { shouldConfirm: false, rule: null, confidence: 0 };
    }

    // Text sanity check
    const textSanity = jaccardSimilarity(left.signals.titleTokens, right.signals.titleTokens);
    if (textSanity < AUTO_CONFIRM_MIN_TEXT_SANITY) {
      return { shouldConfirm: false, rule: null, confidence: 0 };
    }

    return {
      shouldConfirm: true,
      rule: 'MONEYLINE_EXACT_EVENT_MATCH',
      confidence: scoreResult.score,
    };
  },

  /**
   * Auto-reject: Aggressive for safety
   */
  shouldAutoReject(
    _left: SportsMarket,
    _right: SportsMarket,
    scoreResult: SportsScoreResult
  ): AutoRejectResult {
    // Low score
    if (scoreResult.score < AUTO_REJECT_MAX_SCORE) {
      return {
        shouldReject: true,
        rule: 'LOW_SCORE',
        reason: `Score ${scoreResult.score.toFixed(2)} < ${AUTO_REJECT_MAX_SCORE}`,
      };
    }

    // League mismatch (should be caught by hard gates, but double-check)
    if (!scoreResult.leagueMatch) {
      return {
        shouldReject: true,
        rule: 'LEAGUE_MISMATCH',
        reason: 'League does not match',
      };
    }

    // Teams mismatch
    if (!scoreResult.teamsMatch) {
      return {
        shouldReject: true,
        rule: 'TEAMS_MISMATCH',
        reason: 'Teams do not match',
      };
    }

    // Time bucket mismatch (not even adjacent)
    if (scoreResult.timeScore === 0) {
      return {
        shouldReject: true,
        rule: 'TIME_MISMATCH',
        reason: 'Time buckets not compatible',
      };
    }

    // Market type mismatch
    if (!scoreResult.marketTypeMatch) {
      return {
        shouldReject: true,
        rule: 'MARKET_TYPE_MISMATCH',
        reason: 'Market type does not match',
      };
    }

    // Line value too different (for spread/total)
    if (scoreResult.lineValueMatch === false) {
      return {
        shouldReject: true,
        rule: 'LINE_VALUE_MISMATCH',
        reason: 'Line value difference too large',
      };
    }

    return { shouldReject: false, rule: null, reason: null };
  },
};

// Export class for type compatibility
export class SportsPipeline {
  static pipeline = sportsPipeline;
}

/**
 * Universal Pipeline (v3.0.16)
 *
 * Topic-agnostic pipeline that works for ALL market categories.
 * Uses Universal Extractor + Universal Scorer for cross-venue matching.
 *
 * Benefits:
 * - Works for esports, soccer, tennis, UFC, entertainment, etc.
 * - No need for category-specific pipelines
 * - Unified auto-confirm/reject rules
 * - Detailed scoring explanations
 */

import { CanonicalTopic } from '@data-module/core';
import type { MarketRepository, Venue } from '@data-module/db';
import type {
  BaseSignals,
  FetchOptions,
  HardGateResult,
  AutoConfirmResult,
  AutoRejectResult,
  MarketWithSignals,
} from '../engineV3.types.js';
import { BasePipeline } from './basePipeline.js';
import {
  scoreUniversal,
  extractMarketEntities,
  quickMatchCheck,
  type MarketWithUniversalEntities,
  type UniversalScoreResult,
  type EligibleMarketWithTopic,
  SCORE_THRESHOLDS,
} from '../universalScorer.js';
import type { UniversalEntities } from '@data-module/core';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Universal signals - entity extraction result
 * Note: We use 'extractedEntities' instead of 'entities' to avoid conflict
 * with BaseSignals.entities which is Set<string>
 */
export interface UniversalSignals extends BaseSignals {
  /** Full extraction result */
  extractedEntities: UniversalEntities;
  /** Game type detected */
  gameType: string;
  /** Market type detected */
  marketType: string;
}

/**
 * Market wrapper for universal pipeline
 */
export type UniversalMarket = MarketWithSignals<UniversalSignals>;

// ============================================================================
// PIPELINE IMPLEMENTATION
// ============================================================================

/**
 * Universal Pipeline - works for any topic
 *
 * Usage:
 * ```typescript
 * const pipeline = new UniversalPipeline();
 * registerPipeline(pipeline);
 *
 * // Or use with specific topic
 * const sportsPipeline = new UniversalPipeline(CanonicalTopic.SPORTS);
 * ```
 */
export class UniversalPipeline extends BasePipeline<
  UniversalMarket,
  UniversalSignals,
  UniversalScoreResult
> {
  readonly topic: CanonicalTopic;
  readonly algoVersion = 'universal@3.0.18';
  readonly description: string;
  readonly supportsAutoConfirm = true;
  readonly supportsAutoReject = true;

  constructor(topic: CanonicalTopic = CanonicalTopic.UNIVERSAL) {
    super();
    this.topic = topic;
    this.description = `Universal pipeline for ${topic === CanonicalTopic.UNIVERSAL ? 'any' : topic} markets`;
  }

  // --------------------------------------------------------------------------
  // FETCH MARKETS
  // --------------------------------------------------------------------------

  async fetchMarkets(
    repo: MarketRepository,
    options: FetchOptions
  ): Promise<UniversalMarket[]> {
    const { venue, lookbackHours, limit } = options;

    // Use the repository's listEligibleMarkets method
    const markets = await repo.listEligibleMarkets(venue as Venue, {
      lookbackHours,
      limit,
      orderBy: 'closeTime',
    });

    // Extract entities for each market
    return markets.map((market) => {
      const withEntities = extractMarketEntities(market);
      return {
        market: market as EligibleMarketWithTopic,
        signals: {
          extractedEntities: withEntities.entities,
          gameType: withEntities.entities.gameType,
          marketType: withEntities.entities.marketType,
          entity: withEntities.entities.organizations[0] || null,
          titleTokens: withEntities.entities.tokens,
        },
      };
    });
  }

  // --------------------------------------------------------------------------
  // BUILD INDEX
  // --------------------------------------------------------------------------

  /**
   * Build index by multiple keys:
   * - Teams
   * - People
   * - Organizations
   * - Game type + date (for time-based matching)
   */
  buildIndex(markets: UniversalMarket[]): Map<string, UniversalMarket[]> {
    const index = new Map<string, UniversalMarket[]>();

    const addToIndex = (key: string, market: UniversalMarket) => {
      const existing = index.get(key) || [];
      existing.push(market);
      index.set(key, existing);
    };

    for (const market of markets) {
      const { extractedEntities } = market.signals;

      // Index by teams
      for (const team of extractedEntities.teams) {
        addToIndex(`team:${team}`, market);
      }

      // Index by people
      for (const person of extractedEntities.people) {
        addToIndex(`person:${person}`, market);
      }

      // Index by organizations
      for (const org of extractedEntities.organizations) {
        addToIndex(`org:${org}`, market);
      }

      // Index by game type + close date (for time-based fallback)
      if (market.market.closeTime) {
        const dateStr = market.market.closeTime.toISOString().slice(0, 10);
        addToIndex(`date:${dateStr}`, market);
        addToIndex(`type:${extractedEntities.gameType}:${dateStr}`, market);
      }

      // Always add to "all" for fallback
      addToIndex('all', market);
    }

    return index;
  }

  // --------------------------------------------------------------------------
  // FIND CANDIDATES
  // --------------------------------------------------------------------------

  findCandidates(
    market: UniversalMarket,
    index: Map<string, UniversalMarket[]>
  ): UniversalMarket[] {
    const { extractedEntities } = market.signals;
    const candidates = new Set<UniversalMarket>();

    // Find by teams
    for (const team of extractedEntities.teams) {
      const matches = index.get(`team:${team}`) || [];
      for (const m of matches) {
        if (m.market.id !== market.market.id) {
          candidates.add(m);
        }
      }
    }

    // Find by people
    for (const person of extractedEntities.people) {
      const matches = index.get(`person:${person}`) || [];
      for (const m of matches) {
        if (m.market.id !== market.market.id) {
          candidates.add(m);
        }
      }
    }

    // Find by organizations
    for (const org of extractedEntities.organizations) {
      const matches = index.get(`org:${org}`) || [];
      for (const m of matches) {
        if (m.market.id !== market.market.id) {
          candidates.add(m);
        }
      }
    }

    // If no entity matches, try date-based lookup
    if (candidates.size === 0 && market.market.closeTime) {
      const dateStr = market.market.closeTime.toISOString().slice(0, 10);
      const gameTypeKey = `type:${extractedEntities.gameType}:${dateStr}`;
      const matches = index.get(gameTypeKey) || [];
      for (const m of matches) {
        if (m.market.id !== market.market.id) {
          candidates.add(m);
        }
      }
    }

    return Array.from(candidates);
  }

  // --------------------------------------------------------------------------
  // HARD GATES
  // --------------------------------------------------------------------------

  checkHardGates(left: UniversalMarket, right: UniversalMarket): HardGateResult {
    // Gate 1: Same market ID
    if (left.market.id === right.market.id) {
      return { passed: false, failReason: 'Same market' };
    }

    // Gate 2: Same venue
    if (left.market.venue === right.market.venue) {
      return { passed: false, failReason: 'Same venue' };
    }

    // Gate 3: Both must have some extractable entities or meaningful overlap
    const le = left.signals.extractedEntities;
    const re = right.signals.extractedEntities;

    const leftHasEntities =
      le.teams.length > 0 ||
      le.people.length > 0 ||
      le.organizations.length > 0;

    const rightHasEntities =
      re.teams.length > 0 ||
      re.people.length > 0 ||
      re.organizations.length > 0;

    // Allow if either has entities OR there's token overlap
    if (!leftHasEntities && !rightHasEntities) {
      // Check token overlap as fallback
      const tokenOverlap = new Set(le.tokens.filter(t => re.tokens.includes(t))).size;
      const minTokens = Math.min(le.tokens.length, re.tokens.length);
      if (minTokens > 0 && tokenOverlap / minTokens < 0.3) {
        return { passed: false, failReason: 'No entity overlap and low token overlap' };
      }
    }

    // Gate 4: Quick match check (time/entity/text filter)
    const leftWithEntities: MarketWithUniversalEntities = {
      market: left.market,
      entities: le,
    };
    const rightWithEntities: MarketWithUniversalEntities = {
      market: right.market,
      entities: re,
    };

    if (!quickMatchCheck(leftWithEntities, rightWithEntities)) {
      return { passed: false, failReason: 'Failed quick match filter' };
    }

    return { passed: true, failReason: null };
  }

  // --------------------------------------------------------------------------
  // SCORING
  // --------------------------------------------------------------------------

  score(left: UniversalMarket, right: UniversalMarket): UniversalScoreResult | null {
    const leftWithEntities: MarketWithUniversalEntities = {
      market: left.market,
      entities: left.signals.extractedEntities,
    };
    const rightWithEntities: MarketWithUniversalEntities = {
      market: right.market,
      entities: right.signals.extractedEntities,
    };

    const result = scoreUniversal(leftWithEntities, rightWithEntities);

    // Filter out very low scores
    if (result.score < 0.30) {
      return null;
    }

    return result;
  }

  // --------------------------------------------------------------------------
  // AUTO-CONFIRM
  // --------------------------------------------------------------------------

  shouldAutoConfirm(
    _left: UniversalMarket,
    _right: UniversalMarket,
    score: UniversalScoreResult
  ): AutoConfirmResult {
    // Rule 1: High score with entity match
    if (
      score.score >= SCORE_THRESHOLDS.AUTO_CONFIRM &&
      score.matchedEntities.length >= 1 &&
      score.breakdown.textSimilarity >= 0.10
    ) {
      return {
        shouldConfirm: true,
        rule: 'UNIVERSAL_HIGH_CONFIDENCE',
        confidence: score.score,
      };
    }

    // Rule 2: Very high entity overlap with good time match
    if (
      score.breakdown.entityOverlap >= 0.90 &&
      score.breakdown.timeProximity >= 0.70 &&
      score.score >= 0.80
    ) {
      return {
        shouldConfirm: true,
        rule: 'UNIVERSAL_ENTITY_EXACT',
        confidence: score.score,
      };
    }

    // Rule 3: Perfect number match with entity overlap
    if (
      score.overlapDetails.numbers >= 1 &&
      score.breakdown.numberMatch >= 0.95 &&
      score.matchedEntities.length >= 1 &&
      score.score >= 0.85
    ) {
      return {
        shouldConfirm: true,
        rule: 'UNIVERSAL_NUMBER_EXACT',
        confidence: score.score,
      };
    }

    return {
      shouldConfirm: false,
      rule: null,
      confidence: 0,
    };
  }

  // --------------------------------------------------------------------------
  // AUTO-REJECT
  // --------------------------------------------------------------------------

  shouldAutoReject(
    left: UniversalMarket,
    right: UniversalMarket,
    score: UniversalScoreResult
  ): AutoRejectResult {
    // Rule 1: Very low score
    if (score.score < 0.40) {
      return {
        shouldReject: true,
        rule: 'LOW_SCORE',
        reason: `Score ${(score.score * 100).toFixed(0)}% below threshold`,
      };
    }

    // Rule 2: No entity overlap with low text similarity
    if (
      score.matchedEntities.length === 0 &&
      score.breakdown.textSimilarity < 0.15
    ) {
      return {
        shouldReject: true,
        rule: 'NO_OVERLAP',
        reason: 'No entity overlap and low text similarity',
      };
    }

    // Rule 3: Different game types with no entity overlap
    const leftGameType = left.signals.extractedEntities.gameType;
    const rightGameType = right.signals.extractedEntities.gameType;

    if (
      leftGameType !== 'UNKNOWN' &&
      rightGameType !== 'UNKNOWN' &&
      leftGameType !== rightGameType &&
      score.matchedEntities.length === 0
    ) {
      return {
        shouldReject: true,
        rule: 'DIFFERENT_GAME_TYPE',
        reason: `Different game types: ${leftGameType} vs ${rightGameType}`,
      };
    }

    // Rule 4: Conflicting comparators (ABOVE vs BELOW)
    const leftComp = left.signals.extractedEntities.comparator;
    const rightComp = right.signals.extractedEntities.comparator;

    if (
      (leftComp === 'ABOVE' && rightComp === 'BELOW') ||
      (leftComp === 'BELOW' && rightComp === 'ABOVE')
    ) {
      return {
        shouldReject: true,
        rule: 'CONFLICTING_COMPARATOR',
        reason: `Conflicting comparators: ${leftComp} vs ${rightComp}`,
      };
    }

    return {
      shouldReject: false,
      rule: null,
      reason: null,
    };
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a universal pipeline for a specific topic
 */
export function createUniversalPipeline(topic?: CanonicalTopic): UniversalPipeline {
  return new UniversalPipeline(topic);
}

/**
 * Singleton instance for general use (topic = UNIVERSAL)
 */
export const universalPipeline = new UniversalPipeline(CanonicalTopic.UNIVERSAL);

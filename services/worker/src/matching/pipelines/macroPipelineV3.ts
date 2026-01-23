/**
 * Macro Pipeline V3 (v3.0.6)
 *
 * V3 wrapper for legacy macro matching (CPI, GDP, NFP, etc.).
 *
 * Hard Gates:
 * - Entity overlap required (at least one common macro entity)
 * - Period must be compatible (exact, month_in_quarter, etc.)
 *
 * Scoring Weights:
 * - entity: 0.50 (jaccard overlap)
 * - period: 0.35 (compatibility score)
 * - text: 0.15 (token overlap)
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
} from '../engineV3.types.js';
import {
  fetchEligibleMacroMarkets,
  isPeriodCompatible,
  periodCompatibilityScore,
  type MacroSignals,
} from '../macroPipeline.js';

/**
 * Market with macro signals (V3 interface)
 */
export interface MacroMarketV3 extends MarketWithSignals<MacroSignals> {
  market: EligibleMarket;
  signals: MacroSignals;
}

/**
 * Macro score result
 */
export interface MacroScoreResult {
  score: number;
  reason: string;
  tier: 'STRONG' | 'WEAK';
  /** Entity jaccard overlap */
  entityScore: number;
  /** Period compatibility score */
  periodScore: number;
  /** Text similarity */
  textScore: number;
  /** Period compatibility kind */
  periodKind: string;
  /** Overlapping entities */
  overlappingEntities: string[];
}

/**
 * Scoring weights for macro matching
 */
const MACRO_WEIGHTS = {
  entity: 0.50,
  period: 0.35,
  text: 0.15,
};

/**
 * Macro Pipeline V3 Implementation
 */
export class MacroPipelineV3 extends BasePipeline<MacroMarketV3, MacroSignals, MacroScoreResult> {
  readonly topic = CanonicalTopic.MACRO;
  readonly algoVersion = 'v3@3.0.6:MACRO';
  readonly description = 'Macroeconomic indicator matching (CPI, GDP, NFP)';
  readonly supportsAutoConfirm = true;
  readonly supportsAutoReject = true;

  /**
   * Fetch eligible macro markets
   */
  async fetchMarkets(
    repo: MarketRepository,
    options: FetchOptions
  ): Promise<MacroMarketV3[]> {
    const { venue, lookbackHours, limit, excludeSports = true } = options;

    const { markets } = await fetchEligibleMacroMarkets(repo, {
      venue,
      lookbackHours,
      limit,
      excludeSports,
    });

    return markets.map(m => ({
      market: m.market,
      signals: m.signals,
    }));
  }

  /**
   * Build index by entity + periodKey
   */
  buildIndex(markets: MacroMarketV3[]): Map<string, MacroMarketV3[]> {
    const index = new Map<string, MacroMarketV3[]>();

    for (const market of markets) {
      if (market.signals.entities.size === 0 || !market.signals.periodKey) continue;

      // Index by each entity + period combination
      for (const entity of market.signals.entities) {
        const key = `${entity}|${market.signals.periodKey}`;
        if (!index.has(key)) {
          index.set(key, []);
        }
        index.get(key)!.push(market);
      }
    }

    return index;
  }

  /**
   * Find candidates with entity overlap and compatible period
   */
  findCandidates(market: MacroMarketV3, index: Map<string, MacroMarketV3[]>): MacroMarketV3[] {
    if (market.signals.entities.size === 0 || !market.signals.periodKey) {
      return [];
    }

    const candidateSet = new Set<number>();
    const candidates: MacroMarketV3[] = [];

    // Search by each entity
    for (const entity of market.signals.entities) {
      // Exact period match
      const exactKey = `${entity}|${market.signals.periodKey}`;
      const exactMatches = index.get(exactKey) || [];
      for (const c of exactMatches) {
        if (!candidateSet.has(c.market.id)) {
          candidateSet.add(c.market.id);
          candidates.push(c);
        }
      }

      // Also check compatible periods (quarter containing month, etc.)
      // This is handled in scoring, but we could expand here for more coverage
    }

    return candidates;
  }

  /**
   * Check hard gates
   */
  checkHardGates(left: MacroMarketV3, right: MacroMarketV3): HardGateResult {
    const lSig = left.signals;
    const rSig = right.signals;

    // Gate 1: Must have entities
    if (lSig.entities.size === 0 || rSig.entities.size === 0) {
      return { passed: false, failReason: 'no_entities' };
    }

    // Gate 2: Must have entity overlap
    const overlap = [...lSig.entities].filter(e => rSig.entities.has(e));
    if (overlap.length === 0) {
      return { passed: false, failReason: 'no_entity_overlap' };
    }

    // Gate 3: Period must be compatible
    const periodCompat = isPeriodCompatible(lSig.periodKey, rSig.periodKey);
    if (!periodCompat.compatible) {
      return { passed: false, failReason: `period_incompatible:${lSig.periodKey}/${rSig.periodKey}` };
    }

    return { passed: true, failReason: null };
  }

  /**
   * Calculate match score
   */
  score(left: MacroMarketV3, right: MacroMarketV3): MacroScoreResult | null {
    const lSig = left.signals;
    const rSig = right.signals;

    // Check gates first
    const gateResult = this.checkHardGates(left, right);
    if (!gateResult.passed) {
      return null;
    }

    // Entity score (jaccard overlap)
    const lEntities = [...lSig.entities];
    const rEntities = [...rSig.entities];
    const overlap = lEntities.filter(e => rSig.entities.has(e));
    const union = new Set([...lEntities, ...rEntities]).size;
    const entityScore = union > 0 ? overlap.length / union : 0;

    // Period score
    const periodCompat = isPeriodCompatible(lSig.periodKey, rSig.periodKey);
    const periodScore = periodCompatibilityScore(periodCompat.kind);

    // Text score (token overlap)
    const lTokens = new Set(tokenizeForEntities(left.market.title));
    const rTokens = new Set(tokenizeForEntities(right.market.title));
    let intersection = 0;
    for (const t of lTokens) {
      if (rTokens.has(t)) intersection++;
    }
    const tokenUnion = lTokens.size + rTokens.size - intersection;
    const textScore = tokenUnion > 0 ? intersection / tokenUnion : 0;

    // Weighted score
    const rawScore =
      MACRO_WEIGHTS.entity * entityScore +
      MACRO_WEIGHTS.period * periodScore +
      MACRO_WEIGHTS.text * textScore;
    const score = clampScoreSimple(rawScore);

    // Tier determination
    const tier: 'STRONG' | 'WEAK' =
      periodCompat.kind === 'exact' && entityScore >= 0.5 ? 'STRONG' : 'WEAK';

    const reason = `entities=[${overlap.join(',')}] period=${periodCompat.kind}(${periodScore.toFixed(2)}) text=${textScore.toFixed(2)}`;

    return {
      score,
      reason,
      tier,
      entityScore,
      periodScore,
      textScore,
      periodKind: periodCompat.kind,
      overlappingEntities: overlap,
    };
  }

  /**
   * Auto-confirm for high-confidence matches
   */
  shouldAutoConfirm(
    _left: MacroMarketV3,
    _right: MacroMarketV3,
    scoreResult: MacroScoreResult
  ): AutoConfirmResult {
    // Conditions for auto-confirm:
    // 1. Score >= 0.88
    // 2. Period exact match
    // 3. Entity overlap >= 0.8 (strong entity match)

    const shouldConfirm =
      scoreResult.score >= 0.88 &&
      scoreResult.periodKind === 'exact' &&
      scoreResult.entityScore >= 0.8;

    return {
      shouldConfirm,
      rule: shouldConfirm ? 'MACRO_EXACT_MATCH' : null,
      confidence: shouldConfirm ? scoreResult.score : 0,
    };
  }

  /**
   * Auto-reject for low-quality matches
   */
  shouldAutoReject(
    _left: MacroMarketV3,
    _right: MacroMarketV3,
    scoreResult: MacroScoreResult
  ): AutoRejectResult {
    // Conditions for auto-reject:
    // 1. Score < 0.50
    // 2. Period incompatible (shouldn't happen due to gates)

    let shouldReject = false;
    let reason: string | null = null;

    if (scoreResult.score < 0.50) {
      shouldReject = true;
      reason = `Low score: ${scoreResult.score.toFixed(2)}`;
    }

    return {
      shouldReject,
      rule: shouldReject ? 'MACRO_LOW_SCORE' : null,
      reason,
    };
  }
}

/**
 * Singleton instance for registration
 */
export const macroPipelineV3 = new MacroPipelineV3();

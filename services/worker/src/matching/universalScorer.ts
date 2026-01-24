/**
 * Universal Scorer (v3.0.16)
 *
 * Weighted multi-component scoring for Universal Hybrid Matcher.
 * Works for ALL market categories without category-specific pipelines.
 *
 * Scoring components:
 * - Entity Overlap: 0.40 (teams, people, orgs)
 * - Number Match: 0.20 (prices, spreads, percentages)
 * - Time Proximity: 0.20 (closeTime distance)
 * - Text Similarity: 0.15 (Jaccard on tokens)
 * - Category Boost: 0.05 (same derivedTopic)
 */

import {
  extractUniversalEntities,
  countEntityOverlapDetailed,
  jaccardSets,
  type UniversalEntities,
  type EntityOverlapResult,
} from '@data-module/core';
import type { EligibleMarket } from '@data-module/db';
import type { BaseScoreResult } from './engineV3.types.js';

/**
 * Extended EligibleMarket with optional derivedTopic
 * derivedTopic comes from taxonomy backfill and may not be present on all markets
 */
export interface EligibleMarketWithTopic extends EligibleMarket {
  derivedTopic?: string | null;
}

// ============================================================================
// TYPES
// ============================================================================

/**
 * Market with pre-extracted entities
 */
export interface MarketWithUniversalEntities {
  market: EligibleMarketWithTopic;
  entities: UniversalEntities;
}

/**
 * Scoring weights configuration
 */
export interface UniversalWeights {
  entityOverlap: number;
  numberMatch: number;
  timeProximity: number;
  textSimilarity: number;
  categoryBoost: number;
}

/**
 * Score breakdown for debugging
 */
export interface UniversalScoreBreakdown {
  entityOverlap: number;
  numberMatch: number;
  timeProximity: number;
  textSimilarity: number;
  categoryBoost: number;
}

/**
 * Full score result with explanation
 */
export interface UniversalScoreResult extends BaseScoreResult {
  score: number;
  reason: string;
  tier: 'STRONG' | 'WEAK';
  breakdown: UniversalScoreBreakdown;
  matchedEntities: string[];
  overlapDetails: EntityOverlapResult;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Default weights - can be tuned
 */
export const DEFAULT_WEIGHTS: UniversalWeights = {
  entityOverlap: 0.40,
  numberMatch: 0.20,
  timeProximity: 0.20,
  textSimilarity: 0.15,
  categoryBoost: 0.05,
};

/**
 * Score thresholds
 */
export const SCORE_THRESHOLDS = {
  STRONG: 0.75,        // tier = STRONG
  AUTO_CONFIRM: 0.92,  // Can auto-confirm
  HIGH_CONFIDENCE: 0.85,
  MEDIUM_CONFIDENCE: 0.65,
};

// ============================================================================
// SCORING FUNCTIONS
// ============================================================================

/**
 * Calculate entity overlap score (0-1)
 * Takes the max overlap ratio from any category
 */
function scoreEntityOverlap(
  left: UniversalEntities,
  right: UniversalEntities,
  overlapDetails: EntityOverlapResult
): number {
  // Calculate ratios for each entity type
  const teamScore = calculateSetOverlapRatio(
    left.teams,
    right.teams,
    overlapDetails.teams
  );

  const peopleScore = calculateSetOverlapRatio(
    left.people,
    right.people,
    overlapDetails.people
  );

  const orgScore = calculateSetOverlapRatio(
    left.organizations,
    right.organizations,
    overlapDetails.organizations
  );

  // Take the best score from any category
  const bestEntityScore = Math.max(teamScore, peopleScore, orgScore);

  // Bonus for multiple entity types matching
  const typesMatching = [
    overlapDetails.teams > 0,
    overlapDetails.people > 0,
    overlapDetails.organizations > 0,
  ].filter(Boolean).length;

  const multiTypeBonus = typesMatching >= 2 ? 0.1 : 0;

  return Math.min(bestEntityScore + multiTypeBonus, 1.0);
}

/**
 * Calculate overlap ratio for a set
 */
function calculateSetOverlapRatio(
  setA: string[],
  setB: string[],
  overlapCount: number
): number {
  if (setA.length === 0 && setB.length === 0) return 0;
  if (overlapCount === 0) return 0;

  // Jaccard-style ratio
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : overlapCount / union;
}

/**
 * Calculate number match score (0-1)
 */
function scoreNumberMatch(overlapDetails: EntityOverlapResult): number {
  const { numbers, matchedNumbers } = overlapDetails;

  if (numbers === 0) return 0.3; // Neutral if no numbers in either

  // Score based on matched numbers quality
  let score = 0;
  for (const matched of matchedNumbers) {
    const diff = Math.abs(matched.a.value - matched.b.value);
    const maxVal = Math.max(Math.abs(matched.a.value), Math.abs(matched.b.value));
    const relDiff = maxVal === 0 ? 0 : diff / maxVal;

    // Score based on precision
    if (relDiff === 0) score += 1.0;
    else if (relDiff <= 0.001) score += 0.95;
    else if (relDiff <= 0.01) score += 0.85;
    else if (relDiff <= 0.05) score += 0.60;
  }

  return matchedNumbers.length > 0 ? score / matchedNumbers.length : 0;
}

/**
 * Calculate time proximity score (0-1)
 * Based on closeTime difference
 */
function scoreTimeProximity(
  leftCloseTime: Date | null,
  rightCloseTime: Date | null
): number {
  if (!leftCloseTime || !rightCloseTime) return 0.5; // Neutral if no times

  const diffMs = Math.abs(leftCloseTime.getTime() - rightCloseTime.getTime());
  const diffHours = diffMs / (1000 * 60 * 60);

  // Score based on time difference
  if (diffHours <= 1) return 1.0;      // Same hour
  if (diffHours <= 6) return 0.95;     // Within 6 hours
  if (diffHours <= 24) return 0.85;    // Same day
  if (diffHours <= 48) return 0.70;    // Within 2 days
  if (diffHours <= 168) return 0.50;   // Within 1 week
  if (diffHours <= 720) return 0.30;   // Within 1 month
  return 0.10;                          // More than 1 month
}

/**
 * Calculate text similarity score (Jaccard)
 */
function scoreTextSimilarity(
  leftTokens: string[],
  rightTokens: string[]
): number {
  return jaccardSets(leftTokens, rightTokens);
}

/**
 * Calculate category boost (same topic)
 */
function scoreCategoryBoost(
  leftTopic: string | null | undefined,
  rightTopic: string | null | undefined
): number {
  if (!leftTopic || !rightTopic) return 0;
  return leftTopic === rightTopic ? 1.0 : 0;
}

// ============================================================================
// REASON BUILDER
// ============================================================================

/**
 * Build human-readable reason string
 */
function buildReason(
  overlapDetails: EntityOverlapResult,
  breakdown: UniversalScoreBreakdown,
  score: number
): string {
  const parts: string[] = [];

  // Entity matches
  if (overlapDetails.matchedTeams.length > 0) {
    parts.push(`Teams: ${overlapDetails.matchedTeams.join(', ')}`);
  }
  if (overlapDetails.matchedPeople.length > 0) {
    parts.push(`People: ${overlapDetails.matchedPeople.join(', ')}`);
  }
  if (overlapDetails.matchedOrgs.length > 0) {
    parts.push(`Orgs: ${overlapDetails.matchedOrgs.join(', ')}`);
  }

  // Number matches
  if (overlapDetails.matchedNumbers.length > 0) {
    const numStr = overlapDetails.matchedNumbers
      .map(m => `${m.a.raw}≈${m.b.raw}`)
      .join(', ');
    parts.push(`Numbers: ${numStr}`);
  }

  // Date matches
  if (overlapDetails.matchedDates.length > 0) {
    const dateStr = overlapDetails.matchedDates
      .map(m => `${m.a.raw}≈${m.b.raw}`)
      .join(', ');
    parts.push(`Dates: ${dateStr}`);
  }

  // Score breakdown summary
  const breakdownStr = [
    `E=${(breakdown.entityOverlap * 100).toFixed(0)}%`,
    `N=${(breakdown.numberMatch * 100).toFixed(0)}%`,
    `T=${(breakdown.timeProximity * 100).toFixed(0)}%`,
    `J=${(breakdown.textSimilarity * 100).toFixed(0)}%`,
  ].join(' ');

  return `${parts.join('; ')} [${breakdownStr}] (${(score * 100).toFixed(0)}%)`;
}

// ============================================================================
// MAIN SCORING FUNCTION
// ============================================================================

/**
 * Score a pair of markets using universal weighted scoring
 *
 * @param left - Left market with entities
 * @param right - Right market with entities
 * @param weights - Optional custom weights
 * @returns Score result with breakdown
 */
export function scoreUniversal(
  left: MarketWithUniversalEntities,
  right: MarketWithUniversalEntities,
  weights: UniversalWeights = DEFAULT_WEIGHTS
): UniversalScoreResult {
  const le = left.entities;
  const re = right.entities;

  // Get detailed overlap
  const overlapDetails = countEntityOverlapDetailed(le, re);

  // Calculate component scores
  const entityScore = scoreEntityOverlap(le, re, overlapDetails);
  const numberScore = scoreNumberMatch(overlapDetails);
  const timeScore = scoreTimeProximity(left.market.closeTime, right.market.closeTime);
  const textScore = scoreTextSimilarity(le.tokens, re.tokens);
  const categoryScore = scoreCategoryBoost(
    left.market.derivedTopic,
    right.market.derivedTopic
  );

  // Calculate weighted score
  const score =
    weights.entityOverlap * entityScore +
    weights.numberMatch * numberScore +
    weights.timeProximity * timeScore +
    weights.textSimilarity * textScore +
    weights.categoryBoost * categoryScore;

  // Build breakdown
  const breakdown: UniversalScoreBreakdown = {
    entityOverlap: entityScore,
    numberMatch: numberScore,
    timeProximity: timeScore,
    textSimilarity: textScore,
    categoryBoost: categoryScore,
  };

  // Collect matched entities for quick reference
  const matchedEntities = [
    ...overlapDetails.matchedTeams,
    ...overlapDetails.matchedPeople,
    ...overlapDetails.matchedOrgs,
  ];

  // Determine confidence
  let confidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
  if (score >= SCORE_THRESHOLDS.HIGH_CONFIDENCE) {
    confidence = 'HIGH';
  } else if (score >= SCORE_THRESHOLDS.MEDIUM_CONFIDENCE) {
    confidence = 'MEDIUM';
  }

  // Determine tier
  const tier = score >= SCORE_THRESHOLDS.STRONG ? 'STRONG' : 'WEAK';

  // Build reason
  const reason = buildReason(overlapDetails, breakdown, score);

  return {
    score: Math.max(0, Math.min(1, score)),
    reason,
    tier,
    breakdown,
    matchedEntities,
    overlapDetails,
    confidence,
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Extract entities from a market and wrap in MarketWithUniversalEntities
 */
export function extractMarketEntities(market: EligibleMarket | EligibleMarketWithTopic): MarketWithUniversalEntities {
  return {
    market: market as EligibleMarketWithTopic,
    entities: extractUniversalEntities(market.title, market.closeTime),
  };
}

/**
 * Batch extract entities for multiple markets
 */
export function extractMarketEntitiesBatch(markets: (EligibleMarket | EligibleMarketWithTopic)[]): MarketWithUniversalEntities[] {
  return markets.map(extractMarketEntities);
}

/**
 * Quick check if two markets might match (fast filter)
 * Used for candidate generation before full scoring
 */
export function quickMatchCheck(
  left: MarketWithUniversalEntities,
  right: MarketWithUniversalEntities
): boolean {
  const le = left.entities;
  const re = right.entities;

  // Check for any entity overlap
  const hasTeamOverlap = le.teams.some(t => re.teams.includes(t));
  const hasPeopleOverlap = le.people.some(p => re.people.includes(p));
  const hasOrgOverlap = le.organizations.some(o => re.organizations.includes(o));

  if (hasTeamOverlap || hasPeopleOverlap || hasOrgOverlap) {
    return true;
  }

  // Check for token overlap (at least 20%)
  const tokenOverlap = jaccardSets(le.tokens, re.tokens);
  if (tokenOverlap >= 0.20) {
    return true;
  }

  // Check for time proximity (within 48 hours)
  const leftClose = left.market.closeTime;
  const rightClose = right.market.closeTime;
  if (leftClose && rightClose) {
    const diffMs = Math.abs(leftClose.getTime() - rightClose.getTime());
    const diffHours = diffMs / (1000 * 60 * 60);
    if (diffHours <= 48) {
      return true;
    }
  }

  return false;
}

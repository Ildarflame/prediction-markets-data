/**
 * Universal Scorer (v3.0.17)
 *
 * Weighted multi-component scoring for Universal Hybrid Matcher.
 * Works for ALL market categories without category-specific pipelines.
 *
 * Scoring components (v3.0.17 - tuned):
 * - Entity Overlap: 0.45 (teams, people, orgs)
 * - Event Match: 0.15 (tournament/event name detection) - NEW
 * - Number Match: 0.15 (prices, spreads, percentages)
 * - Time Proximity: 0.10 (closeTime distance) - REDUCED
 * - Text Similarity: 0.10 (Jaccard on tokens)
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
  eventMatch: number;      // v3.0.17: tournament/event name detection (BONUS)
  matchupBonus: number;    // v3.0.18: "A vs B" both teams match (BONUS)
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
  eventMatch: number;      // v3.0.17 (BONUS)
  matchupMatch: number;    // v3.0.18 (BONUS)
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
 * Default weights - v3.0.18 tuned
 * Base weights sum to 1.0, bonuses are added on top
 *
 * - Entity overlap: 50% (team, people, org matches)
 * - Number match: 15% (price brackets, percentages)
 * - Time proximity: 10% (close time distance)
 * - Text similarity: 15% (Jaccard on tokens)
 * - Category boost: 10% (same derived topic)
 *
 * BONUSES (added on top, capped at 1.0 total):
 * - Event match: +15% for same tournament/championship
 * - Matchup bonus: +15% for exact "A vs B" match
 */
export const DEFAULT_WEIGHTS: UniversalWeights = {
  entityOverlap: 0.50,   // Base: 50%
  eventMatch: 0.15,      // BONUS: +15% for tournament match
  matchupBonus: 0.15,    // BONUS: +15% for exact matchup (v3.0.18)
  numberMatch: 0.15,     // Base: 15%
  timeProximity: 0.10,   // Base: 10%
  textSimilarity: 0.15,  // Base: 15%
  categoryBoost: 0.10,   // Base: 10%
};

/**
 * Score thresholds - v3.0.17 tuned
 */
export const SCORE_THRESHOLDS = {
  STRONG: 0.75,          // tier = STRONG
  AUTO_CONFIRM: 0.85,    // LOWERED from 0.92 (v3.0.17)
  HIGH_CONFIDENCE: 0.80, // LOWERED from 0.85
  MEDIUM_CONFIDENCE: 0.60, // LOWERED from 0.65
};

// ============================================================================
// SCORING FUNCTIONS
// ============================================================================

/**
 * Calculate entity overlap score (0-1)
 * Takes the max overlap ratio from any category + multi-entity bonuses
 *
 * v3.0.23: Enhanced with multi-entity bonus
 * - Bonus for total matched entities (3+ = +0.15, 2 = +0.10)
 * - Bonus for multiple entities in same category (2+ teams/people = +0.05)
 * - Existing bonus for multiple entity types matching (2+ types = +0.10)
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

  // Bonus 1: Multiple entity types matching (existing)
  const typesMatching = [
    overlapDetails.teams > 0,
    overlapDetails.people > 0,
    overlapDetails.organizations > 0,
  ].filter(Boolean).length;
  const multiTypeBonus = typesMatching >= 2 ? 0.10 : 0;

  // Bonus 2: Total number of matched entities (NEW v3.0.23)
  // Rewards markets that share many entities (e.g., "Team A vs Team B" matching both teams)
  const totalMatched = overlapDetails.teams + overlapDetails.people + overlapDetails.organizations;
  let multiEntityBonus = 0;
  if (totalMatched >= 3) {
    multiEntityBonus = 0.15;
  } else if (totalMatched >= 2) {
    multiEntityBonus = 0.10;
  }

  // Bonus 3: Multiple entities within same category (NEW v3.0.23)
  // e.g., 2 teams matching is stronger signal than 1 team
  const sameCategoryMultiple =
    overlapDetails.teams >= 2 ||
    overlapDetails.people >= 2 ||
    overlapDetails.organizations >= 2;
  const sameCategoryBonus = sameCategoryMultiple ? 0.05 : 0;

  // Combined score (capped at 1.0)
  return Math.min(bestEntityScore + multiTypeBonus + multiEntityBonus + sameCategoryBonus, 1.0);
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
 * v3.0.24: Changed neutral score from 0.3 to 0.5 for markets without numbers
 */
function scoreNumberMatch(overlapDetails: EntityOverlapResult): number {
  const { numbers, matchedNumbers } = overlapDetails;

  // v3.0.24: True neutral if no numbers in either market
  // This prevents political/sports markets from being penalized
  if (numbers === 0) return 0.5;

  // Numbers exist but none matched - slight penalty
  if (matchedNumbers.length === 0) return 0.2;

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

  return score / matchedNumbers.length;
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
// EVENT MATCHING (v3.0.17)
// ============================================================================

/**
 * Event patterns for tournament/championship detection
 */
const EVENT_PATTERNS: RegExp[] = [
  // Esports - CS2/Valorant/LoL
  /\b(IEM\s+\w+(?:\s+\d{4})?)/i,
  /\b(BLAST\s+(?:Premier|Bounty|World\s*Final)(?:\s+\w+)?(?:\s+\d{4})?)/i,
  /\b(ESL\s+(?:Pro\s+League|One|Challenger)(?:\s+\w+)?(?:\s+\d{4})?)/i,
  /\b(PGL\s+\w+(?:\s+\d{4})?)/i,
  /\b((?:LEC|LCS|LCK|LPL)\s+(?:\d{4}\s+)?(?:Spring|Summer|Winter|Fall)?(?:\s+(?:Split|Playoffs|Finals))?)/i,
  /\b(Worlds?\s+\d{4})/i,
  /\b(The\s+International\s*\d*)/i,
  /\b(VCT\s+(?:\w+\s+)?(?:\d{4})?)/i,
  /\b(Champions\s+Tour(?:\s+\w+)?(?:\s+\d{4})?)/i,

  // Traditional Sports
  /\b(Super\s*Bowl\s*(?:L?[IVX]+|\d+)?)/i,
  /\b(World\s+Cup\s*\d{4})/i,
  /\b((?:Summer|Winter)\s+Olympics?\s*\d{4})/i,
  /\b(UEFA\s+(?:Champions\s+League|Euro(?:pa)?(?:\s+League)?|Nations\s+League)(?:\s+\d{4}(?:[-\/]\d{2,4})?)?)/i,
  /\b(NBA\s+(?:\d{4}[-\/]\d{2,4}\s+)?(?:Season|Playoffs|Finals|Championship))/i,
  /\b(NFL\s+(?:\d{4}[-\/]\d{2,4}\s+)?(?:Season|Playoffs|Championship))/i,
  /\b(MLB\s+(?:\d{4}\s+)?(?:World\s+Series|Playoffs|Season))/i,
  /\b(NHL\s+(?:\d{4}[-\/]\d{2,4}\s+)?(?:Season|Playoffs|Stanley\s+Cup))/i,
  /\b((?:Wimbledon|US\s+Open|French\s+Open|Australian\s+Open)(?:\s+\d{4})?)/i,
  /\b((?:F1|Formula\s+(?:1|One))\s+(?:\d{4}\s+)?(?:\w+\s+)?Grand\s+Prix)/i,
  /\b(UFC\s+\d+)/i,

  // General patterns
  /\b(\w+\s+Championship\s+\d{4})/i,
  /\b(\w+\s+World\s+(?:Championship|Cup|Series)\s*\d{4}?)/i,
  /\b(Major\s+(?:Championship|Tournament)(?:\s+\d{4})?)/i,
];

/**
 * Extract event/tournament name from title
 */
function extractEventName(title: string): string | null {
  for (const pattern of EVENT_PATTERNS) {
    const match = title.match(pattern);
    if (match) {
      return normalizeEventName(match[1]);
    }
  }
  return null;
}

/**
 * Normalize event name for comparison
 */
function normalizeEventName(event: string): string {
  return event
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract base event name (without year/stage) for partial matching
 */
function extractEventBase(event: string): string {
  return event
    .replace(/\d{4}/g, '')           // Remove years
    .replace(/\s*(SPRING|SUMMER|WINTER|FALL|FINALS?|PLAYOFFS?|SPLIT)\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculate event match score (0-1) - v3.0.17
 * Detects matching tournament/championship names
 */
function scoreEventMatch(leftTitle: string, rightTitle: string): { score: number; event: string | null } {
  const leftEvent = extractEventName(leftTitle);
  const rightEvent = extractEventName(rightTitle);

  // No events detected
  if (!leftEvent && !rightEvent) {
    return { score: 0, event: null };
  }

  // Only one has event - partial match possible via tokens
  if (!leftEvent || !rightEvent) {
    return { score: 0, event: null };
  }

  // Exact match
  if (leftEvent === rightEvent) {
    return { score: 1.0, event: leftEvent };
  }

  // Partial match (same tournament base, different year/stage)
  const leftBase = extractEventBase(leftEvent);
  const rightBase = extractEventBase(rightEvent);

  if (leftBase === rightBase && leftBase.length > 3) {
    return { score: 0.7, event: `${leftBase} (partial)` };
  }

  // Check for significant overlap in event names
  const leftWords = new Set(leftEvent.split(/\s+/).filter(w => w.length > 2));
  const rightWords = new Set(rightEvent.split(/\s+/).filter(w => w.length > 2));
  const intersection = [...leftWords].filter(w => rightWords.has(w));
  const union = new Set([...leftWords, ...rightWords]);

  if (intersection.length >= 2 && intersection.length / union.size >= 0.5) {
    return { score: 0.5, event: `${intersection.join(' ')} (overlap)` };
  }

  return { score: 0, event: null };
}

// ============================================================================
// TWO-TEAM MATCHUP DETECTION (v3.0.18)
// ============================================================================

/**
 * Matchup patterns for "Team A vs Team B" detection
 */
const MATCHUP_PATTERNS: RegExp[] = [
  // "Team A vs Team B", "A versus B", "A v B"
  /^(.+?)\s+(?:vs\.?|versus|v\.?)\s+(.+?)(?:\s*[-–—]\s*|\s+(?:match|game|fight|bout|series|map)|\?|$)/i,
  // "Team A - Team B" (with dash separator)
  /^(.+?)\s*[-–—]\s*(.+?)(?:\s+(?:match|game|fight|bout|series|map)|\?|$)/i,
  // "Will X beat Y", "Can X defeat Y"
  /(?:will|can)\s+(.+?)\s+(?:beat|defeat|win\s+against|lose\s+to)\s+(.+?)(?:\?|$)/i,
];

/**
 * Team name normalization patterns
 */
const TEAM_PREFIXES = ['team', 'the', 'fc', 'ac', 'sc', 'cf'];
const TEAM_SUFFIXES = [
  'esports', 'gaming', 'fc', 'united', 'city',
  // Game names often appear after team names
  'cs2', 'csgo', 'valorant', 'dota', 'dota2', 'lol',
  'league of legends', 'overwatch', 'ow2', 'r6', 'rainbow six',
  // Match descriptors
  'match', 'game', 'bout', 'fight', 'series',
];

/**
 * Normalize team name for comparison
 */
function normalizeTeamName(team: string): string {
  let normalized = team
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

  // Remove common prefixes (case-insensitive)
  for (const prefix of TEAM_PREFIXES) {
    const prefixUpper = prefix.toUpperCase() + ' ';
    if (normalized.startsWith(prefixUpper)) {
      normalized = normalized.slice(prefixUpper.length).trim();
    }
  }

  // Remove common suffixes (case-insensitive)
  for (const suffix of TEAM_SUFFIXES) {
    const suffixUpper = ' ' + suffix.toUpperCase();
    if (normalized.endsWith(suffixUpper)) {
      normalized = normalized.slice(0, -suffixUpper.length).trim();
    }
  }

  return normalized;
}

/**
 * Extract matchup (two teams) from title
 */
interface Matchup {
  teamA: string;
  teamB: string;
  normalized: [string, string];  // Sorted for comparison
}

function extractMatchup(title: string): Matchup | null {
  for (const pattern of MATCHUP_PATTERNS) {
    const match = title.match(pattern);
    if (match && match[1] && match[2]) {
      const teamA = match[1].trim();
      const teamB = match[2].trim();

      // Filter out non-team matches (too short, contains numbers only, etc.)
      if (teamA.length < 2 || teamB.length < 2) continue;
      if (/^\d+$/.test(teamA) || /^\d+$/.test(teamB)) continue;

      const normA = normalizeTeamName(teamA);
      const normB = normalizeTeamName(teamB);

      // Skip if normalized names are too short
      if (normA.length < 2 || normB.length < 2) continue;

      // Sort for consistent comparison (A vs B == B vs A)
      const sorted = [normA, normB].sort() as [string, string];

      return {
        teamA,
        teamB,
        normalized: sorted,
      };
    }
  }
  return null;
}

/**
 * Calculate matchup match score (0-1) - v3.0.18
 * Detects "Team A vs Team B" patterns and requires BOTH teams to match
 */
interface MatchupResult {
  score: number;
  matchup: string | null;
  bothTeamsMatch: boolean;
  oneTeamMatch: boolean;
}

function scoreMatchupMatch(leftTitle: string, rightTitle: string): MatchupResult {
  const leftMatchup = extractMatchup(leftTitle);
  const rightMatchup = extractMatchup(rightTitle);

  // No matchups detected
  if (!leftMatchup && !rightMatchup) {
    return { score: 0, matchup: null, bothTeamsMatch: false, oneTeamMatch: false };
  }

  // Only one has matchup
  if (!leftMatchup || !rightMatchup) {
    return { score: 0, matchup: null, bothTeamsMatch: false, oneTeamMatch: false };
  }

  // Both have matchups - compare normalized teams
  const [leftA, leftB] = leftMatchup.normalized;
  const [rightA, rightB] = rightMatchup.normalized;

  // Exact matchup (both teams match)
  if (leftA === rightA && leftB === rightB) {
    return {
      score: 1.0,
      matchup: `${leftMatchup.teamA} vs ${leftMatchup.teamB}`,
      bothTeamsMatch: true,
      oneTeamMatch: true,
    };
  }

  // Check for partial match (one team matches)
  const leftTeams = new Set([leftA, leftB]);
  const rightTeams = new Set([rightA, rightB]);
  const intersection = [...leftTeams].filter(t => rightTeams.has(t));

  if (intersection.length === 1) {
    return {
      score: 0.3,  // Low score for only one team matching
      matchup: `${intersection[0]} (partial)`,
      bothTeamsMatch: false,
      oneTeamMatch: true,
    };
  }

  // No match
  return { score: 0, matchup: null, bothTeamsMatch: false, oneTeamMatch: false };
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
  score: number,
  matchedEvent: string | null,  // v3.0.17
  matchedMatchup: string | null // v3.0.18
): string {
  const parts: string[] = [];

  // Matchup match (v3.0.18)
  if (matchedMatchup) {
    parts.push(`Matchup: ${matchedMatchup}`);
  }

  // Event match (v3.0.17)
  if (matchedEvent) {
    parts.push(`Event: ${matchedEvent}`);
  }

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

  // Score breakdown summary (v3.0.17: added Ev for event)
  // v3.0.18: Show matchup and event bonuses only if > 0
  const breakdownParts = [
    `E=${(breakdown.entityOverlap * 100).toFixed(0)}%`,
  ];
  if (breakdown.matchupMatch > 0) {
    breakdownParts.push(`M=${(breakdown.matchupMatch * 100).toFixed(0)}%`);
  }
  if (breakdown.eventMatch > 0) {
    breakdownParts.push(`Ev=${(breakdown.eventMatch * 100).toFixed(0)}%`);
  }
  breakdownParts.push(
    `N=${(breakdown.numberMatch * 100).toFixed(0)}%`,
    `T=${(breakdown.timeProximity * 100).toFixed(0)}%`,
    `J=${(breakdown.textSimilarity * 100).toFixed(0)}%`
  );
  const breakdownStr = breakdownParts.join(' ');

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
  const eventResult = scoreEventMatch(left.market.title, right.market.title);  // v3.0.17
  const matchupResult = scoreMatchupMatch(left.market.title, right.market.title);  // v3.0.18
  const numberScore = scoreNumberMatch(overlapDetails);
  const timeScore = scoreTimeProximity(left.market.closeTime, right.market.closeTime);
  const textScore = scoreTextSimilarity(le.tokens, re.tokens);
  const categoryScore = scoreCategoryBoost(
    left.market.derivedTopic,
    right.market.derivedTopic
  );

  // Calculate base score (entity, number, time, text, category = 1.0 total)
  const baseScore =
    weights.entityOverlap * entityScore +
    weights.numberMatch * numberScore +
    weights.timeProximity * timeScore +
    weights.textSimilarity * textScore +
    weights.categoryBoost * categoryScore;

  // BONUSES added on top (v3.0.17, v3.0.18)
  // Only applied when detected, doesn't penalize non-matching markets
  const eventBonus = weights.eventMatch * eventResult.score;
  const matchupBonus = weights.matchupBonus * matchupResult.score;
  const score = Math.min(1.0, baseScore + eventBonus + matchupBonus);

  // Build breakdown (v3.0.18: added matchupMatch)
  const breakdown: UniversalScoreBreakdown = {
    entityOverlap: entityScore,
    eventMatch: eventResult.score,
    matchupMatch: matchupResult.score,
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

  // Build reason (v3.0.18: pass matchedEvent and matchedMatchup)
  const reason = buildReason(overlapDetails, breakdown, score, eventResult.event, matchupResult.matchup);

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

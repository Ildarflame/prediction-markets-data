/**
 * Geopolitics Pipeline (v3.1.0)
 *
 * Pipeline for matching geopolitical markets across venues.
 * War, peace, sanctions, and international relations markets.
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
  extractGeopoliticsSignals,
  isGeopoliticsMarket,
  GeopoliticsRegion,
  GeopoliticsEventType,
  type GeopoliticsSignals,
} from '../signals/geopoliticsSignals.js';

/**
 * Market with geopolitics signals
 */
export interface GeopoliticsMarket extends MarketWithSignals<GeopoliticsSignals> {
  market: EligibleMarket;
  signals: GeopoliticsSignals;
}

/**
 * Geopolitics score result
 */
export interface GeopoliticsScoreResult {
  score: number;
  reason: string;
  tier: 'STRONG' | 'WEAK';
  /** Region score component */
  regionScore: number;
  /** Countries overlap score */
  countriesScore: number;
  /** Event type score */
  eventTypeScore: number;
  /** Actors overlap score */
  actorsScore: number;
  /** Text similarity score */
  textScore: number;
  /** Number of overlapping countries */
  countryOverlap: number;
  /** Number of overlapping actors */
  actorOverlap: number;
}

/**
 * Geopolitics-specific keywords for DB query
 */
const GEOPOLITICS_KEYWORDS = [
  'war', 'peace', 'ceasefire', 'invasion', 'conflict', 'sanctions',
  'ukraine', 'russia', 'china', 'taiwan', 'israel', 'gaza', 'iran',
  'nato', 'military', 'troops', 'territory', 'treaty', 'negotiation',
  'putin', 'zelensky', 'xi', 'netanyahu', 'hezbollah', 'hamas',
  'syria', 'yemen', 'korea', 'nuclear', 'missile', 'tariff',
];

/**
 * Scoring weights for geopolitics matching
 */
const GEOPOLITICS_WEIGHTS = {
  region: 0.30,      // Hard gate - must match
  countries: 0.25,   // Countries overlap
  eventType: 0.20,   // Event type match
  actors: 0.15,      // Actors overlap
  text: 0.10,        // Text similarity
};

/**
 * Calculate set overlap score (Jaccard-like)
 */
function setOverlapScore(setA: string[], setB: string[]): { score: number; overlap: number } {
  if (setA.length === 0 && setB.length === 0) {
    return { score: 0.5, overlap: 0 };  // Both empty - neutral
  }

  if (setA.length === 0 || setB.length === 0) {
    return { score: 0.3, overlap: 0 };  // One empty - low score
  }

  const a = new Set(setA);
  const b = new Set(setB);

  const intersection = [...a].filter(x => b.has(x)).length;
  const union = new Set([...a, ...b]).size;

  return {
    score: union > 0 ? intersection / union : 0,
    overlap: intersection,
  };
}

/**
 * Check if event types are compatible
 */
function areEventTypesCompatible(
  typeA: GeopoliticsEventType,
  typeB: GeopoliticsEventType
): boolean {
  // Same type is always compatible
  if (typeA === typeB) return true;

  // UNKNOWN is compatible with anything
  if (typeA === GeopoliticsEventType.UNKNOWN || typeB === GeopoliticsEventType.UNKNOWN) {
    return true;
  }

  // Define compatible pairs
  const compatiblePairs: [GeopoliticsEventType, GeopoliticsEventType][] = [
    [GeopoliticsEventType.WAR, GeopoliticsEventType.MILITARY],
    [GeopoliticsEventType.PEACE, GeopoliticsEventType.DIPLOMACY],
    [GeopoliticsEventType.TERRITORY, GeopoliticsEventType.WAR],
    [GeopoliticsEventType.TERRITORY, GeopoliticsEventType.PEACE],
  ];

  for (const [a, b] of compatiblePairs) {
    if ((typeA === a && typeB === b) || (typeA === b && typeB === a)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if event types are conflicting
 */
function areEventTypesConflicting(
  typeA: GeopoliticsEventType,
  typeB: GeopoliticsEventType
): boolean {
  // UNKNOWN never conflicts
  if (typeA === GeopoliticsEventType.UNKNOWN || typeB === GeopoliticsEventType.UNKNOWN) {
    return false;
  }

  // WAR and PEACE are conflicting
  if ((typeA === GeopoliticsEventType.WAR && typeB === GeopoliticsEventType.PEACE) ||
      (typeA === GeopoliticsEventType.PEACE && typeB === GeopoliticsEventType.WAR)) {
    return true;
  }

  return false;
}

/**
 * Geopolitics Pipeline Implementation
 */
export class GeopoliticsPipeline extends BasePipeline<GeopoliticsMarket, GeopoliticsSignals, GeopoliticsScoreResult> {
  readonly topic = CanonicalTopic.GEOPOLITICS;
  readonly algoVersion = 'geopolitics@3.1.0';
  readonly description = 'Geopolitical market matching (war, peace, sanctions)';
  readonly supportsAutoConfirm = true;
  readonly supportsAutoReject = true;

  /**
   * Fetch eligible geopolitics markets
   */
  async fetchMarkets(
    repo: MarketRepository,
    options: FetchOptions
  ): Promise<GeopoliticsMarket[]> {
    const { venue, lookbackHours, limit, excludeSports = true } = options;

    // Fetch markets with geopolitics keywords
    const markets = await repo.listEligibleMarkets(venue, {
      lookbackHours,
      limit,
      titleKeywords: GEOPOLITICS_KEYWORDS,
      orderBy: 'closeTime',
    });

    // Filter and extract signals
    const result: GeopoliticsMarket[] = [];

    for (const market of markets) {
      // Skip sports markets
      if (excludeSports && this.isSportsMarket(market)) {
        continue;
      }

      // Skip if not a geopolitics market
      if (!isGeopoliticsMarket(market.title)) {
        continue;
      }

      const signals = extractGeopoliticsSignals(market);

      // Must have region or countries to be useful
      if (signals.region === GeopoliticsRegion.UNKNOWN && signals.countries.length === 0) {
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
   * Build index by region + event type + year
   */
  buildIndex(markets: GeopoliticsMarket[]): Map<string, GeopoliticsMarket[]> {
    const index = new Map<string, GeopoliticsMarket[]>();

    for (const market of markets) {
      // Primary key: region + event type + year
      const primaryKey = `${market.signals.region}|${market.signals.eventType}|${market.signals.year || 'unknown'}`;
      if (!index.has(primaryKey)) {
        index.set(primaryKey, []);
      }
      index.get(primaryKey)!.push(market);

      // Secondary key: region + year (broader)
      const secondaryKey = `${market.signals.region}|${market.signals.year || 'unknown'}`;
      if (!index.has(secondaryKey)) {
        index.set(secondaryKey, []);
      }
      index.get(secondaryKey)!.push(market);

      // Country keys
      for (const country of market.signals.countries) {
        const countryKey = `country|${country}|${market.signals.year || 'unknown'}`;
        if (!index.has(countryKey)) {
          index.set(countryKey, []);
        }
        index.get(countryKey)!.push(market);
      }

      // Actor keys
      for (const actor of market.signals.actors) {
        const actorKey = `actor|${actor}|${market.signals.year || 'unknown'}`;
        if (!index.has(actorKey)) {
          index.set(actorKey, []);
        }
        index.get(actorKey)!.push(market);
      }
    }

    return index;
  }

  /**
   * Find candidates for a given geopolitics market
   */
  findCandidates(market: GeopoliticsMarket, index: Map<string, GeopoliticsMarket[]>): GeopoliticsMarket[] {
    const candidates: GeopoliticsMarket[] = [];
    const seenIds = new Set<number>();

    // Lookup by primary key
    const primaryKey = `${market.signals.region}|${market.signals.eventType}|${market.signals.year || 'unknown'}`;
    for (const m of index.get(primaryKey) || []) {
      if (!seenIds.has(m.market.id)) {
        seenIds.add(m.market.id);
        candidates.push(m);
      }
    }

    // Lookup by secondary key (region + year)
    const secondaryKey = `${market.signals.region}|${market.signals.year || 'unknown'}`;
    for (const m of index.get(secondaryKey) || []) {
      if (!seenIds.has(m.market.id)) {
        seenIds.add(m.market.id);
        candidates.push(m);
      }
    }

    // Lookup by countries
    for (const country of market.signals.countries) {
      const countryKey = `country|${country}|${market.signals.year || 'unknown'}`;
      for (const m of index.get(countryKey) || []) {
        if (!seenIds.has(m.market.id)) {
          seenIds.add(m.market.id);
          candidates.push(m);
        }
      }
    }

    // Lookup by actors
    for (const actor of market.signals.actors) {
      const actorKey = `actor|${actor}|${market.signals.year || 'unknown'}`;
      for (const m of index.get(actorKey) || []) {
        if (!seenIds.has(m.market.id)) {
          seenIds.add(m.market.id);
          candidates.push(m);
        }
      }
    }

    return candidates;
  }

  /**
   * Check hard gates for geopolitics matching
   */
  checkHardGates(left: GeopoliticsMarket, right: GeopoliticsMarket): HardGateResult {
    const lSig = left.signals;
    const rSig = right.signals;

    // Gate 1: At least one shared region
    const leftRegions = new Set(lSig.regions);
    const rightRegions = new Set(rSig.regions);
    const hasRegionOverlap = [...leftRegions].some(r => rightRegions.has(r));

    // If no region overlap, check for country overlap
    const leftCountries = new Set(lSig.countries);
    const rightCountries = new Set(rSig.countries);
    const hasCountryOverlap = [...leftCountries].some(c => rightCountries.has(c));

    if (!hasRegionOverlap && !hasCountryOverlap) {
      return {
        passed: false,
        failReason: `No region or country overlap: regions=[${[...leftRegions].join(',')}] vs [${[...rightRegions].join(',')}], countries=[${lSig.countries.join(',')}] vs [${rSig.countries.join(',')}]`,
      };
    }

    // Gate 2: Event types must not conflict (WAR vs PEACE)
    if (areEventTypesConflicting(lSig.eventType, rSig.eventType)) {
      return {
        passed: false,
        failReason: `Conflicting event types: ${lSig.eventType} vs ${rSig.eventType}`,
      };
    }

    // Gate 3: Year must be compatible
    if (lSig.year !== null && rSig.year !== null && lSig.year !== rSig.year) {
      return {
        passed: false,
        failReason: `Year mismatch: ${lSig.year} vs ${rSig.year}`,
      };
    }

    return { passed: true, failReason: null };
  }

  /**
   * Score geopolitics market pair
   */
  score(left: GeopoliticsMarket, right: GeopoliticsMarket): GeopoliticsScoreResult | null {
    const lSig = left.signals;
    const rSig = right.signals;

    // Region score
    const leftRegions = new Set(lSig.regions);
    const rightRegions = new Set(rSig.regions);
    const regionOverlap = [...leftRegions].filter(r => rightRegions.has(r)).length;
    const regionUnion = new Set([...leftRegions, ...rightRegions]).size;
    const regionScore = regionUnion > 0 ? regionOverlap / regionUnion : 0;

    // Countries score
    const { score: countriesScore, overlap: countryOverlap } = setOverlapScore(
      lSig.countries,
      rSig.countries
    );

    // Event type score
    let eventTypeScore = 0;
    if (lSig.eventType === rSig.eventType && lSig.eventType !== GeopoliticsEventType.UNKNOWN) {
      eventTypeScore = 1.0;
    } else if (areEventTypesCompatible(lSig.eventType, rSig.eventType)) {
      eventTypeScore = 0.6;
    } else {
      eventTypeScore = 0;
    }

    // Actors score
    const { score: actorsScore, overlap: actorOverlap } = setOverlapScore(
      lSig.actors,
      rSig.actors
    );

    // Text score
    const lTokens = lSig.titleTokens ?? [];
    const rTokens = rSig.titleTokens ?? [];
    const textScore = jaccard(lTokens, rTokens);

    // Weighted score
    let score =
      GEOPOLITICS_WEIGHTS.region * regionScore +
      GEOPOLITICS_WEIGHTS.countries * countriesScore +
      GEOPOLITICS_WEIGHTS.eventType * eventTypeScore +
      GEOPOLITICS_WEIGHTS.actors * actorsScore +
      GEOPOLITICS_WEIGHTS.text * textScore;

    // Bonus for high country overlap
    if (countryOverlap >= 2) {
      score = Math.min(1.0, score + 0.05);
    }

    // Bonus for actor overlap
    if (actorOverlap >= 1) {
      score = Math.min(1.0, score + 0.05);
    }

    score = clampScoreSimple(score);

    // Tier determination
    const isStrong = regionScore >= 0.5 && countryOverlap >= 1 && eventTypeScore >= 0.6;
    const tier: 'STRONG' | 'WEAK' = isStrong ? 'STRONG' : 'WEAK';

    // Build reason string
    const reason = [
      `region=${regionScore.toFixed(2)}[${regionOverlap}/${regionUnion}]`,
      `countries=${countriesScore.toFixed(2)}(${countryOverlap} overlap)`,
      `eventType=${eventTypeScore.toFixed(2)}[${lSig.eventType}/${rSig.eventType}]`,
      `actors=${actorsScore.toFixed(2)}(${actorOverlap} overlap)`,
      `text=${textScore.toFixed(2)}`,
    ].join(' ');

    return {
      score,
      reason,
      tier,
      regionScore,
      countriesScore,
      eventTypeScore,
      actorsScore,
      textScore,
      countryOverlap,
      actorOverlap,
    };
  }

  /**
   * Check if match should be auto-confirmed
   */
  shouldAutoConfirm(
    left: GeopoliticsMarket,
    right: GeopoliticsMarket,
    scoreResult: GeopoliticsScoreResult
  ): AutoConfirmResult {
    const MIN_SCORE = 0.90;

    if (scoreResult.score < MIN_SCORE) {
      return { shouldConfirm: false, rule: null, confidence: 0 };
    }

    const lSig = left.signals;
    const rSig = right.signals;

    // Must have same region
    if (lSig.region !== rSig.region || lSig.region === GeopoliticsRegion.UNKNOWN) {
      return { shouldConfirm: false, rule: null, confidence: 0 };
    }

    // Must have country overlap
    if (scoreResult.countryOverlap < 1) {
      return { shouldConfirm: false, rule: null, confidence: 0 };
    }

    // Must have same event type
    if (lSig.eventType !== rSig.eventType) {
      return { shouldConfirm: false, rule: null, confidence: 0 };
    }

    // Actor overlap is a strong signal
    if (scoreResult.actorOverlap >= 1) {
      return {
        shouldConfirm: true,
        rule: 'GEOPOLITICS_ACTOR_MATCH',
        confidence: scoreResult.score,
      };
    }

    // High score with good component scores
    if (scoreResult.regionScore >= 0.8 && scoreResult.countriesScore >= 0.8) {
      return {
        shouldConfirm: true,
        rule: 'GEOPOLITICS_HIGH_OVERLAP',
        confidence: scoreResult.score,
      };
    }

    return { shouldConfirm: false, rule: null, confidence: 0 };
  }

  /**
   * Check if match should be auto-rejected
   */
  shouldAutoReject(
    left: GeopoliticsMarket,
    right: GeopoliticsMarket,
    scoreResult: GeopoliticsScoreResult
  ): AutoRejectResult {
    const lSig = left.signals;
    const rSig = right.signals;

    // Low score
    if (scoreResult.score < 0.55) {
      return {
        shouldReject: true,
        rule: 'LOW_SCORE',
        reason: `Score ${scoreResult.score.toFixed(2)} < 0.55`,
      };
    }

    // No region overlap (should have been caught by hard gates)
    if (scoreResult.regionScore === 0) {
      return {
        shouldReject: true,
        rule: 'NO_REGION_OVERLAP',
        reason: 'No overlapping regions',
      };
    }

    // Conflicting event types
    if (areEventTypesConflicting(lSig.eventType, rSig.eventType)) {
      return {
        shouldReject: true,
        rule: 'CONFLICTING_EVENT_TYPES',
        reason: `Conflicting: ${lSig.eventType} vs ${rSig.eventType}`,
      };
    }

    return { shouldReject: false, rule: null, reason: null };
  }
}

/**
 * Singleton instance
 */
export const geopoliticsPipeline = new GeopoliticsPipeline();

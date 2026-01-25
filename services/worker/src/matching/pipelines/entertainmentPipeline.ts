/**
 * Entertainment Pipeline (v3.1.0)
 *
 * Pipeline for matching entertainment markets across venues.
 * Awards, movies, TV, music, and celebrity markets.
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
  extractEntertainmentSignals,
  isEntertainmentMarket,
  AwardShow,
  MediaType,
  type EntertainmentSignals,
} from '../signals/entertainmentSignals.js';

/**
 * Market with entertainment signals
 */
export interface EntertainmentMarket extends MarketWithSignals<EntertainmentSignals> {
  market: EligibleMarket;
  signals: EntertainmentSignals;
}

/**
 * Entertainment score result
 */
export interface EntertainmentScoreResult {
  score: number;
  reason: string;
  tier: 'STRONG' | 'WEAK';
  /** Award show score */
  awardShowScore: number;
  /** Category score */
  categoryScore: number;
  /** Year score */
  yearScore: number;
  /** Nominees overlap score */
  nomineesScore: number;
  /** Text similarity score */
  textScore: number;
  /** Number of overlapping nominees */
  nomineeOverlap: number;
}

/**
 * Entertainment-specific keywords for DB query
 */
const ENTERTAINMENT_KEYWORDS = [
  'oscar', 'grammy', 'emmy', 'golden globe', 'tony', 'bafta',
  'best picture', 'best actor', 'best actress', 'album of the year',
  'box office', 'opening weekend', 'movie', 'film',
  'netflix', 'disney', 'hbo', 'streaming', 'hulu',
  'youtube', 'tiktok', 'mrbeast', 'spotify', 'billboard',
  'celebrity', 'award', 'nominated', 'gta', 'video game',
];

/**
 * Scoring weights for entertainment matching
 */
const ENTERTAINMENT_WEIGHTS = {
  awardShow: 0.30,   // Hard gate for awards
  category: 0.25,    // Award category
  year: 0.15,        // Hard gate
  nominees: 0.20,    // Nominees overlap
  text: 0.10,        // Text similarity
};

/**
 * Calculate nominee overlap score
 */
function nomineeOverlapScore(
  nomineesA: string[],
  nomineesB: string[]
): { score: number; overlap: number } {
  if (nomineesA.length === 0 && nomineesB.length === 0) {
    return { score: 0.5, overlap: 0 };  // Both empty - neutral
  }

  if (nomineesA.length === 0 || nomineesB.length === 0) {
    return { score: 0.3, overlap: 0 };  // One empty - low score
  }

  const a = new Set(nomineesA);
  const b = new Set(nomineesB);

  const intersection = [...a].filter(x => b.has(x)).length;
  const union = new Set([...a, ...b]).size;

  return {
    score: union > 0 ? intersection / union : 0,
    overlap: intersection,
  };
}

/**
 * Check if categories are compatible (fuzzy match)
 */
function areCategoriesCompatible(catA: string | null, catB: string | null): boolean {
  if (catA === null || catB === null) return true;  // Unknown is compatible
  if (catA === catB) return true;  // Exact match

  // Similar categories
  const similarGroups: string[][] = [
    ['BEST_ACTOR', 'BEST_SUPPORTING_ACTOR'],
    ['BEST_ACTRESS', 'BEST_SUPPORTING_ACTRESS'],
    ['BEST_DRAMA', 'BEST_COMEDY'],  // Both are TV categories
    ['ALBUM_OF_THE_YEAR', 'RECORD_OF_THE_YEAR', 'SONG_OF_THE_YEAR'],
  ];

  for (const group of similarGroups) {
    if (group.includes(catA) && group.includes(catB)) {
      return true;
    }
  }

  return false;
}

/**
 * Entertainment Pipeline Implementation
 */
export class EntertainmentPipeline extends BasePipeline<EntertainmentMarket, EntertainmentSignals, EntertainmentScoreResult> {
  readonly topic = CanonicalTopic.ENTERTAINMENT;
  readonly algoVersion = 'entertainment@3.1.0';
  readonly description = 'Entertainment market matching (awards, movies, music)';
  readonly supportsAutoConfirm = true;
  readonly supportsAutoReject = true;

  /**
   * Fetch eligible entertainment markets
   */
  async fetchMarkets(
    repo: MarketRepository,
    options: FetchOptions
  ): Promise<EntertainmentMarket[]> {
    const { venue, lookbackHours, limit, excludeSports = true } = options;

    // Fetch markets with entertainment keywords
    const markets = await repo.listEligibleMarkets(venue, {
      lookbackHours,
      limit,
      titleKeywords: ENTERTAINMENT_KEYWORDS,
      orderBy: 'closeTime',
    });

    // Filter and extract signals
    const result: EntertainmentMarket[] = [];

    for (const market of markets) {
      // Skip sports markets
      if (excludeSports && this.isSportsMarket(market)) {
        continue;
      }

      // Skip if not an entertainment market
      if (!isEntertainmentMarket(market.title)) {
        continue;
      }

      const signals = extractEntertainmentSignals(market);

      // Must have award show or media type to be useful
      if (signals.awardShow === AwardShow.UNKNOWN && signals.mediaType === MediaType.UNKNOWN) {
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
      'ufc', 'boxing', 'tennis', 'golf',
    ];
    return sportsKeywords.some(kw => lower.includes(kw));
  }

  /**
   * Build index by award show + year + category
   */
  buildIndex(markets: EntertainmentMarket[]): Map<string, EntertainmentMarket[]> {
    const index = new Map<string, EntertainmentMarket[]>();

    for (const market of markets) {
      // Primary key: award show + year + category
      const primaryKey = `${market.signals.awardShow}|${market.signals.year || 'unknown'}|${market.signals.category || 'unknown'}`;
      if (!index.has(primaryKey)) {
        index.set(primaryKey, []);
      }
      index.get(primaryKey)!.push(market);

      // Secondary key: award show + year
      const secondaryKey = `${market.signals.awardShow}|${market.signals.year || 'unknown'}`;
      if (!index.has(secondaryKey)) {
        index.set(secondaryKey, []);
      }
      index.get(secondaryKey)!.push(market);

      // Media type key
      const mediaKey = `media|${market.signals.mediaType}|${market.signals.year || 'unknown'}`;
      if (!index.has(mediaKey)) {
        index.set(mediaKey, []);
      }
      index.get(mediaKey)!.push(market);

      // Nominee keys
      for (const nominee of market.signals.nominees) {
        const nomineeKey = `nominee|${nominee}|${market.signals.year || 'unknown'}`;
        if (!index.has(nomineeKey)) {
          index.set(nomineeKey, []);
        }
        index.get(nomineeKey)!.push(market);
      }
    }

    return index;
  }

  /**
   * Find candidates for a given entertainment market
   */
  findCandidates(market: EntertainmentMarket, index: Map<string, EntertainmentMarket[]>): EntertainmentMarket[] {
    const candidates: EntertainmentMarket[] = [];
    const seenIds = new Set<number>();

    // Lookup by primary key
    const primaryKey = `${market.signals.awardShow}|${market.signals.year || 'unknown'}|${market.signals.category || 'unknown'}`;
    for (const m of index.get(primaryKey) || []) {
      if (!seenIds.has(m.market.id)) {
        seenIds.add(m.market.id);
        candidates.push(m);
      }
    }

    // Lookup by secondary key
    const secondaryKey = `${market.signals.awardShow}|${market.signals.year || 'unknown'}`;
    for (const m of index.get(secondaryKey) || []) {
      if (!seenIds.has(m.market.id)) {
        seenIds.add(m.market.id);
        candidates.push(m);
      }
    }

    // Lookup by media type
    const mediaKey = `media|${market.signals.mediaType}|${market.signals.year || 'unknown'}`;
    for (const m of index.get(mediaKey) || []) {
      if (!seenIds.has(m.market.id)) {
        seenIds.add(m.market.id);
        candidates.push(m);
      }
    }

    // Lookup by nominees
    for (const nominee of market.signals.nominees) {
      const nomineeKey = `nominee|${nominee}|${market.signals.year || 'unknown'}`;
      for (const m of index.get(nomineeKey) || []) {
        if (!seenIds.has(m.market.id)) {
          seenIds.add(m.market.id);
          candidates.push(m);
        }
      }
    }

    return candidates;
  }

  /**
   * Check hard gates for entertainment matching
   */
  checkHardGates(left: EntertainmentMarket, right: EntertainmentMarket): HardGateResult {
    const lSig = left.signals;
    const rSig = right.signals;

    // Gate 1: Award show must match (if both have award shows)
    if (lSig.awardShow !== AwardShow.UNKNOWN && rSig.awardShow !== AwardShow.UNKNOWN) {
      if (lSig.awardShow !== rSig.awardShow) {
        return {
          passed: false,
          failReason: `Award show mismatch: ${lSig.awardShow} vs ${rSig.awardShow}`,
        };
      }
    }

    // Gate 2: Year must match
    if (lSig.year !== null && rSig.year !== null && lSig.year !== rSig.year) {
      return {
        passed: false,
        failReason: `Year mismatch: ${lSig.year} vs ${rSig.year}`,
      };
    }

    // Gate 3: Categories must be compatible
    if (!areCategoriesCompatible(lSig.category, rSig.category)) {
      return {
        passed: false,
        failReason: `Category mismatch: ${lSig.category} vs ${rSig.category}`,
      };
    }

    // Gate 4: Media type should be compatible
    if (lSig.mediaType !== MediaType.UNKNOWN && rSig.mediaType !== MediaType.UNKNOWN) {
      if (lSig.mediaType !== rSig.mediaType) {
        // Allow some cross-media matches (e.g., STREAMING and TV)
        const compatible = (
          (lSig.mediaType === MediaType.STREAMING && rSig.mediaType === MediaType.TV) ||
          (lSig.mediaType === MediaType.TV && rSig.mediaType === MediaType.STREAMING) ||
          (lSig.mediaType === MediaType.MUSIC && rSig.mediaType === MediaType.STREAMING) ||
          (lSig.mediaType === MediaType.STREAMING && rSig.mediaType === MediaType.MUSIC)
        );
        if (!compatible) {
          return {
            passed: false,
            failReason: `Media type mismatch: ${lSig.mediaType} vs ${rSig.mediaType}`,
          };
        }
      }
    }

    return { passed: true, failReason: null };
  }

  /**
   * Score entertainment market pair
   */
  score(left: EntertainmentMarket, right: EntertainmentMarket): EntertainmentScoreResult | null {
    const lSig = left.signals;
    const rSig = right.signals;

    // Award show score
    let awardShowScore = 0;
    if (lSig.awardShow !== AwardShow.UNKNOWN && rSig.awardShow !== AwardShow.UNKNOWN) {
      awardShowScore = lSig.awardShow === rSig.awardShow ? 1.0 : 0;
    } else if (lSig.awardShow === AwardShow.UNKNOWN && rSig.awardShow === AwardShow.UNKNOWN) {
      // Neither has award show - use media type instead
      awardShowScore = lSig.mediaType === rSig.mediaType ? 0.8 : 0.4;
    } else {
      awardShowScore = 0.5;  // One has award show, other doesn't
    }

    // Category score
    let categoryScore = 0;
    if (lSig.category !== null && rSig.category !== null) {
      if (lSig.category === rSig.category) {
        categoryScore = 1.0;
      } else if (areCategoriesCompatible(lSig.category, rSig.category)) {
        categoryScore = 0.6;
      } else {
        categoryScore = 0;
      }
    } else if (lSig.category === null && rSig.category === null) {
      categoryScore = 0.5;  // Both unknown
    } else {
      categoryScore = 0.3;  // One known, one unknown
    }

    // Year score
    let yearScore = 0;
    if (lSig.year !== null && rSig.year !== null) {
      yearScore = lSig.year === rSig.year ? 1.0 : 0;
    } else if (lSig.year === null && rSig.year === null) {
      yearScore = 0.5;  // Both unknown
    } else {
      yearScore = 0.3;  // One known, one unknown
    }

    // Nominees score
    const { score: nomineesScore, overlap: nomineeOverlap } = nomineeOverlapScore(
      lSig.nominees,
      rSig.nominees
    );

    // Text score
    const lTokens = lSig.titleTokens ?? [];
    const rTokens = rSig.titleTokens ?? [];
    const textScore = jaccard(lTokens, rTokens);

    // Weighted score
    let score =
      ENTERTAINMENT_WEIGHTS.awardShow * awardShowScore +
      ENTERTAINMENT_WEIGHTS.category * categoryScore +
      ENTERTAINMENT_WEIGHTS.year * yearScore +
      ENTERTAINMENT_WEIGHTS.nominees * nomineesScore +
      ENTERTAINMENT_WEIGHTS.text * textScore;

    // Bonus for nominee overlap
    if (nomineeOverlap >= 1) {
      score = Math.min(1.0, score + 0.05);
    }

    score = clampScoreSimple(score);

    // Tier determination
    const isStrong = awardShowScore >= 1.0 && yearScore >= 1.0 && categoryScore >= 0.6;
    const tier: 'STRONG' | 'WEAK' = isStrong ? 'STRONG' : 'WEAK';

    // Build reason string
    const reason = [
      `award=${awardShowScore.toFixed(2)}[${lSig.awardShow}/${rSig.awardShow}]`,
      `category=${categoryScore.toFixed(2)}[${lSig.category}/${rSig.category}]`,
      `year=${yearScore.toFixed(2)}[${lSig.year}/${rSig.year}]`,
      `nominees=${nomineesScore.toFixed(2)}(${nomineeOverlap} overlap)`,
      `text=${textScore.toFixed(2)}`,
    ].join(' ');

    return {
      score,
      reason,
      tier,
      awardShowScore,
      categoryScore,
      yearScore,
      nomineesScore,
      textScore,
      nomineeOverlap,
    };
  }

  /**
   * Check if match should be auto-confirmed
   */
  shouldAutoConfirm(
    left: EntertainmentMarket,
    right: EntertainmentMarket,
    scoreResult: EntertainmentScoreResult
  ): AutoConfirmResult {
    const MIN_SCORE = 0.88;

    if (scoreResult.score < MIN_SCORE) {
      return { shouldConfirm: false, rule: null, confidence: 0 };
    }

    const lSig = left.signals;
    const rSig = right.signals;

    // Must have same award show
    if (lSig.awardShow !== rSig.awardShow) {
      return { shouldConfirm: false, rule: null, confidence: 0 };
    }

    // Must have same year
    if (scoreResult.yearScore < 1.0) {
      return { shouldConfirm: false, rule: null, confidence: 0 };
    }

    // Must have same category
    if (lSig.category !== rSig.category) {
      return { shouldConfirm: false, rule: null, confidence: 0 };
    }

    // Nominee overlap is a bonus
    if (scoreResult.nomineeOverlap >= 1) {
      return {
        shouldConfirm: true,
        rule: 'ENTERTAINMENT_NOMINEE_MATCH',
        confidence: scoreResult.score,
      };
    }

    // High score with matching award/year/category
    if (scoreResult.awardShowScore >= 1.0 && scoreResult.categoryScore >= 1.0) {
      return {
        shouldConfirm: true,
        rule: 'ENTERTAINMENT_EXACT_MATCH',
        confidence: scoreResult.score,
      };
    }

    return { shouldConfirm: false, rule: null, confidence: 0 };
  }

  /**
   * Check if match should be auto-rejected
   */
  shouldAutoReject(
    left: EntertainmentMarket,
    right: EntertainmentMarket,
    scoreResult: EntertainmentScoreResult
  ): AutoRejectResult {
    const lSig = left.signals;
    const rSig = right.signals;

    // Low score
    if (scoreResult.score < 0.50) {
      return {
        shouldReject: true,
        rule: 'LOW_SCORE',
        reason: `Score ${scoreResult.score.toFixed(2)} < 0.50`,
      };
    }

    // Different award shows
    if (lSig.awardShow !== AwardShow.UNKNOWN && rSig.awardShow !== AwardShow.UNKNOWN) {
      if (lSig.awardShow !== rSig.awardShow) {
        return {
          shouldReject: true,
          rule: 'DIFFERENT_AWARD_SHOWS',
          reason: `Different awards: ${lSig.awardShow} vs ${rSig.awardShow}`,
        };
      }
    }

    // Different years
    if (lSig.year !== null && rSig.year !== null && lSig.year !== rSig.year) {
      return {
        shouldReject: true,
        rule: 'DIFFERENT_YEARS',
        reason: `Different years: ${lSig.year} vs ${rSig.year}`,
      };
    }

    return { shouldReject: false, rule: null, reason: null };
  }
}

/**
 * Singleton instance
 */
export const entertainmentPipeline = new EntertainmentPipeline();

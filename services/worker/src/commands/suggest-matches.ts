import type { Venue as CoreVenue } from '@data-module/core';
import {
  buildFingerprint,
  normalizeTitleForFuzzy,
  entityScore,
  numberScore,
  dateScore,
  passesDateGate,
  tokenize,
  jaccard,
  tokenizeForEntities,
  MarketIntent,
  extractPeriod,
  type MarketFingerprint,
  type MacroPeriod,
} from '@data-module/core';
import {
  getClient,
  MarketRepository,
  MarketLinkRepository,
  type Venue,
  type EligibleMarket,
} from '@data-module/db';
import { distance } from 'fastest-levenshtein';
import {
  buildPeriodKey,
  isPeriodCompatible,
  periodCompatibilityScore,
  PERIOD_COMPATIBILITY_SCORES,
  RARE_MACRO_ENTITIES,
  RARE_ENTITY_DEFAULT_LOOKBACK_HOURS,
  type PeriodCompatibilityKind,
  // Crypto Pipeline (v2.5.2, v2.6.1)
  CRYPTO_ENTITIES_V1,
  fetchEligibleCryptoMarkets,
  buildCryptoIndex,
  findCryptoCandidates,
  cryptoMatchScore,
  areMarketTypesCompatible,
  type CryptoMarket,
  type CryptoScoreResult,
  // Crypto Bracket Grouping (v2.6.0)
  buildBracketKey,
  applyBracketGrouping,
  type BracketCandidate,
  type BracketStats,
  // v2.6.2: Intraday Pipeline
  fetchIntradayCryptoMarkets,
  buildIntradayIndex,
  findIntradayCandidates,
  intradayMatchScore,
  type IntradayMarket,
  type IntradaySlotSize,
} from '../matching/index.js';

/**
 * Sports exclusion patterns for Kalshi
 * Based on eventTicker prefixes that indicate sports/esports markets
 */
export const KALSHI_SPORTS_PREFIXES = [
  'KXMVESPORT',   // Esports multi-game
  'KXMVENBASI',   // NBA parlays
  'KXNCAAMBGA',   // NCAA basketball
  'KXTABLETEN',   // Table tennis
  'KXNBAREB',     // NBA rebounds
  'KXNFL',        // NFL
];

/**
 * Keywords in title that indicate sports/esports markets
 */
export const SPORTS_TITLE_KEYWORDS = [
  // Player stat patterns (e.g., "yes Player: 10+")
  'yes ',         // Parlay format starts with "yes"
  ': 1+', ': 2+', ': 3+', ': 4+', ': 5+', ': 6+', ': 7+', ': 8+', ': 9+',
  ': 10+', ': 15+', ': 20+', ': 25+', ': 30+', ': 40+', ': 50+',
  'points scored', 'wins by over', 'wins by under',
  'first quarter', 'second quarter', 'third quarter', 'fourth quarter',
  'steals', 'rebounds', 'assists', 'touchdowns', 'yards',
  'kill handicap', 'tower handicap', 'map handicap', // Esports
];

/**
 * Esports exclusion patterns for Polymarket
 */
export const POLYMARKET_ESPORTS_KEYWORDS = [
  'kill handicap', 'tower handicap', 'map handicap',
  'ninjas in pyjamas', 'team we', 'forze', 'sangal',
  'esports', 'dota', 'league of legends', 'cs:go', 'valorant',
];

/**
 * Extended market info with metadata for filtering
 */
interface MarketWithMeta extends EligibleMarket {
  metadata?: Record<string, unknown> | null;
}

/**
 * Check if a Kalshi market should be excluded based on eventTicker prefix
 */
function isKalshiSportsMarket(metadata: Record<string, unknown> | null | undefined, prefixes: string[]): boolean {
  if (!metadata) return false;
  const eventTicker = metadata.eventTicker || metadata.event_ticker;
  if (typeof eventTicker !== 'string') return false;

  return prefixes.some(prefix => eventTicker.startsWith(prefix));
}

/**
 * Check if a market title contains sports keywords
 * Uses substring matching for sports patterns (intentional - patterns like ": 10+" need this)
 */
function hasSportsTitleKeyword(title: string, keywords: string[]): boolean {
  const lowerTitle = title.toLowerCase();
  return keywords.some(keyword => lowerTitle.includes(keyword.toLowerCase()));
}

/**
 * Check if a market title contains at least one keyword using TOKEN-based matching
 * This prevents "Hegseth" from matching keyword "eth"
 */
function hasKeywordToken(title: string, keywords: string[]): boolean {
  const titleTokens = new Set(tokenizeForEntities(title));
  // Also add some common variations
  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    // Check if keyword appears as a token (exact match)
    if (titleTokens.has(kwLower)) {
      return true;
    }
    // For multi-word keywords, check if all words appear as consecutive tokens
    const kwTokens = tokenizeForEntities(kw);
    if (kwTokens.length > 1) {
      const titleTokenArr = tokenizeForEntities(title);
      // Check for consecutive match
      for (let i = 0; i <= titleTokenArr.length - kwTokens.length; i++) {
        let allMatch = true;
        for (let j = 0; j < kwTokens.length; j++) {
          if (titleTokenArr[i + j] !== kwTokens[j]) {
            allMatch = false;
            break;
          }
        }
        if (allMatch) return true;
      }
    }
  }
  return false;
}

/**
 * Post-filter markets to ensure they match keywords using token-based matching
 * The database query uses substring matching which can produce false positives
 */
function filterByKeywordTokens(
  markets: EligibleMarket[],
  keywords: string[]
): { filtered: EligibleMarket[]; removed: number } {
  if (keywords.length === 0) {
    return { filtered: markets, removed: 0 };
  }
  const filtered: EligibleMarket[] = [];
  let removed = 0;
  for (const market of markets) {
    if (hasKeywordToken(market.title, keywords)) {
      filtered.push(market);
    } else {
      removed++;
    }
  }
  return { filtered, removed };
}

/**
 * Filter out sports markets from eligible markets
 */
function filterSportsMarkets(
  markets: MarketWithMeta[],
  venue: string,
  options: {
    excludeKalshiPrefixes?: string[];
    excludeTitleKeywords?: string[];
  }
): { filtered: EligibleMarket[]; stats: { prefixExcluded: number; keywordExcluded: number } } {
  const { excludeKalshiPrefixes = [], excludeTitleKeywords = [] } = options;
  const filtered: EligibleMarket[] = [];
  let prefixExcluded = 0;
  let keywordExcluded = 0;

  for (const market of markets) {
    // Check Kalshi eventTicker prefix
    if (venue === 'kalshi' && excludeKalshiPrefixes.length > 0) {
      if (isKalshiSportsMarket(market.metadata, excludeKalshiPrefixes)) {
        prefixExcluded++;
        continue;
      }
    }

    // Check title keywords
    if (excludeTitleKeywords.length > 0) {
      if (hasSportsTitleKeyword(market.title, excludeTitleKeywords)) {
        keywordExcluded++;
        continue;
      }
    }

    filtered.push(market);
  }

  return { filtered, stats: { prefixExcluded, keywordExcluded } };
}

/**
 * Topic filter for suggest-matches (v2.6.2)
 * - crypto: All crypto markets (backward compatible)
 * - crypto_daily: Only daily/yearly crypto markets (excludes INTRADAY_UPDOWN)
 * - crypto_intraday: Only intraday crypto markets (reserved for future)
 * - macro: Economic indicators
 * - politics: Political markets
 * - all: All topics
 */
export type TopicFilter = 'crypto' | 'crypto_daily' | 'crypto_intraday' | 'macro' | 'politics' | 'all';

/**
 * Topic-specific entities for filtering
 * Markets must have at least one entity from the topic set to match
 */
const CRYPTO_ENTITIES = [
  'BITCOIN', 'ETHEREUM', 'SOLANA', 'XRP', 'DOGECOIN', 'CARDANO', 'BNB',
  'AVALANCHE', 'POLYGON', 'POLKADOT', 'CHAINLINK', 'LITECOIN',
];

export const TOPIC_ENTITIES: Record<Exclude<TopicFilter, 'all'>, string[]> = {
  crypto: CRYPTO_ENTITIES,
  crypto_daily: CRYPTO_ENTITIES,
  crypto_intraday: CRYPTO_ENTITIES,
  macro: [
    'CPI', 'GDP', 'NFP', 'FOMC', 'FED_RATE', 'UNEMPLOYMENT_RATE', 'JOBLESS_CLAIMS',
    'INFLATION', 'INTEREST_RATE', 'PPI', 'PCE',
  ],
  politics: [
    'DONALD_TRUMP', 'DONALD_TRUMP_JR', 'JOE_BIDEN', 'HUNTER_BIDEN',
    'KAMALA_HARRIS', 'RON_DESANTIS', 'GAVIN_NEWSOM', 'NIKKI_HALEY',
    'VIVEK_RAMASWAMY', 'MIKE_PENCE', 'RFK_JR', 'BARACK_OBAMA', 'MICHELLE_OBAMA',
    'ELON_MUSK', 'JEFF_BEZOS', 'NANCY_PELOSI', 'KEVIN_MCCARTHY',
    'CHUCK_SCHUMER', 'MITCH_MCCONNELL', 'AOC', 'BERNIE_SANDERS', 'ELIZABETH_WARREN',
    'VLADIMIR_PUTIN', 'VOLODYMYR_ZELENSKY', 'XI_JINPING', 'BENJAMIN_NETANYAHU',
    'US_PRESIDENTIAL_ELECTION', 'US_SENATE', 'US_HOUSE', 'US_MIDTERMS',
  ],
};

/**
 * Topic-specific keywords for filtering
 * Markets must have at least one keyword from the topic set (fallback if no entity)
 */
const CRYPTO_KEYWORDS = [
  'bitcoin', 'btc', 'ethereum', 'eth', 'solana', 'sol', 'crypto',
  'xrp', 'ripple', 'doge', 'dogecoin', 'cardano', 'ada',
];

export const TOPIC_KEYWORDS: Record<Exclude<TopicFilter, 'all'>, string[]> = {
  crypto: CRYPTO_KEYWORDS,
  crypto_daily: CRYPTO_KEYWORDS,
  crypto_intraday: CRYPTO_KEYWORDS,
  // Macro keywords - token-based only, specific to economic indicators
  // v2.4.6: expanded to include "jobs" (Polymarket uses "jobs" instead of NFP)
  macro: [
    'cpi', 'gdp', 'inflation', 'unemployment', 'jobless',
    'payrolls', 'nonfarm', 'nfp', 'fed', 'fomc',
    'rates', 'interest', 'pce', 'pmi',
    // v2.4.6 additions
    'jobs', 'employment', 'claims', 'ism', 'purchasing',
  ],
  politics: [
    'trump', 'biden', 'harris', 'election', 'president', 'presidential',
    'congress', 'senate', 'house', 'governor', 'democrats', 'republicans',
    'putin', 'zelensky', 'ukraine', 'russia', 'china', 'xi jinping',
  ],
};

export interface SuggestMatchesOptions {
  fromVenue: CoreVenue;
  toVenue: CoreVenue;
  minScore?: number;
  topK?: number;
  lookbackHours?: number;
  limitLeft?: number;
  limitRight?: number;
  debugMarketId?: number;
  requireOverlapKeywords?: boolean;
  targetKeywords?: string[];
  // Topic filter - defines entity and keyword requirements
  topic?: TopicFilter;
  // Sports exclusion options
  excludeSports?: boolean;
  excludeKalshiPrefixes?: string[];
  excludeTitleKeywords?: string[];
  // Macro year window (v2.4.1)
  macroMinYear?: number;
  macroMaxYear?: number;
  // Cap suggestions per left market (v2.4.2 - reduce bracket duplicates)
  maxSuggestionsPerLeft?: number;
  // Guardrail for cross-granularity period matches (v2.4.3)
  // Limits year↔month, quarter↔month matches to prevent explosion
  maxCrossGranularityPerLeft?: number;
  // Extended lookback for rare entities like GDP, UNEMPLOYMENT_RATE (v2.4.3)
  rareEntityLookbackHours?: number;
  // Right-side cap per entity-period bucket (v2.4.5)
  // Limits many-to-one explosion (e.g., 882 CPI Kalshi → 65 CPI Polymarket)
  maxPerRightPerEntityPeriod?: number;
}

export interface SuggestMatchesResult {
  leftCount: number;
  rightCount: number;
  candidatesConsidered: number;
  suggestionsCreated: number;
  suggestionsUpdated: number;
  skippedConfirmed: number;
  skippedNoOverlap: number;
  skippedDateGate: number;
  skippedTextGate: number;
  skippedPeriodGate: number;
  skippedTypeGate: number; // v2.6.1: MarketType incompatibility
  // Cap statistics (v2.4.2)
  generatedPairsTotal: number;
  savedTopKTotal: number;
  droppedByCapTotal: number;
  // Cross-granularity guardrail stats (v2.4.3)
  droppedByCrossGranularityCap: number;
  // Right-side cap stats (v2.4.5)
  droppedByRightCap: number;
  errors: string[];
}

/**
 * Market with precomputed fingerprint
 */
interface IndexedMarket {
  market: EligibleMarket;
  fingerprint: MarketFingerprint;
  normalizedTitle: string;
}

/**
 * Entity-based inverted index for candidate generation
 */
interface EntityIndex {
  byEntity: Map<string, Set<number>>;
  byYear: Map<number, Set<number>>;
  markets: Map<number, IndexedMarket>;
}

/**
 * Macro-specific index for candidate generation
 * Uses macroEntity + period for more precise matching
 */
interface MacroEntityIndex extends EntityIndex {
  // Key format: "ENTITY:YYYY-MM" for month, "ENTITY:YYYY-Qn" for quarter, "ENTITY:YYYY" for year
  byMacroEntityPeriod: Map<string, Set<number>>;
}

/**
 * Build a key for macro entity + period indexing
 */
function buildMacroPeriodKey(entity: string, period: { type: string | null; year?: number; month?: number; quarter?: number }): string | null {
  if (!period.type || !period.year) return null;

  if (period.type === 'month' && period.month) {
    return `${entity}:${period.year}-${String(period.month).padStart(2, '0')}`;
  } else if (period.type === 'quarter' && period.quarter) {
    return `${entity}:${period.year}-Q${period.quarter}`;
  } else if (period.type === 'year') {
    return `${entity}:${period.year}`;
  }
  return null;
}

/**
 * Get all compatible period keys for a given entity + period
 * For a month, returns both the month key and the quarter key
 */
function getCompatiblePeriodKeys(entity: string, period: { type: string | null; year?: number; month?: number; quarter?: number }): string[] {
  if (!period.type || !period.year) return [];

  const keys: string[] = [];

  if (period.type === 'month' && period.month) {
    // Add exact month key
    keys.push(`${entity}:${period.year}-${String(period.month).padStart(2, '0')}`);
    // Add quarter key (month falls within this quarter)
    const quarter = Math.ceil(period.month / 3);
    keys.push(`${entity}:${period.year}-Q${quarter}`);
    // Add year key
    keys.push(`${entity}:${period.year}`);
  } else if (period.type === 'quarter' && period.quarter) {
    // Add quarter key
    keys.push(`${entity}:${period.year}-Q${period.quarter}`);
    // Add all months in the quarter
    const startMonth = (period.quarter - 1) * 3 + 1;
    for (let m = startMonth; m < startMonth + 3; m++) {
      keys.push(`${entity}:${period.year}-${String(m).padStart(2, '0')}`);
    }
    // Add year key
    keys.push(`${entity}:${period.year}`);
  } else if (period.type === 'year') {
    // Add year key
    keys.push(`${entity}:${period.year}`);
    // Add all quarters
    for (let q = 1; q <= 4; q++) {
      keys.push(`${entity}:${period.year}-Q${q}`);
    }
    // Add all months
    for (let m = 1; m <= 12; m++) {
      keys.push(`${entity}:${period.year}-${String(m).padStart(2, '0')}`);
    }
  }

  return keys;
}

/**
 * Calculate macro entity score
 * Returns 0.5 if there's at least one matching macro entity, 0 otherwise
 */
function macroEntityScore(leftMacroEntities: Set<string> | undefined, rightMacroEntities: Set<string> | undefined): number {
  if (!leftMacroEntities?.size || !rightMacroEntities?.size) return 0;

  for (const entity of leftMacroEntities) {
    if (rightMacroEntities.has(entity)) {
      return 0.5; // Any match gives full score
    }
  }
  return 0;
}

/**
 * Match strength tier (v2.4.5)
 *
 * STRONG: High-confidence match
 * - Period kind is exact, month_in_quarter, or quarter_in_year
 * - NOT month_in_year (too loose, many false positives)
 *
 * WEAK: Lower confidence, useful for discovery but needs manual review
 * - Period kind is month_in_year
 */
export type MatchTier = 'STRONG' | 'WEAK';

function computeMatchTier(periodKind: PeriodCompatibilityKind | undefined): MatchTier {
  // month_in_year and none are WEAK
  if (periodKind === 'month_in_year' || periodKind === 'none' || !periodKind) {
    return 'WEAK';
  }
  // exact, month_in_quarter, quarter_in_year are STRONG
  return 'STRONG';
}

/**
 * Build right-side cap bucket key (v2.4.5)
 *
 * Used to limit many-to-one suggestions per right market per entity-period.
 * The bucket is based on the RIGHT market's period (normalized to year for loose matches).
 *
 * Format: rightId:entity:periodBucket
 * Where periodBucket is:
 * - YYYY-MM for month periods
 * - YYYY-Qn for quarter periods
 * - YYYY for year periods (and for month_in_year matches)
 */
function buildRightCapKey(
  rightId: number,
  entity: string,
  rightPeriod: MacroPeriod | undefined,
  periodKind: PeriodCompatibilityKind | undefined
): string {
  let bucket = 'unknown';

  if (rightPeriod?.year) {
    if (rightPeriod.type === 'month' && rightPeriod.month) {
      // For month_in_year, bucket by year only to properly cap
      if (periodKind === 'month_in_year') {
        bucket = String(rightPeriod.year);
      } else {
        bucket = `${rightPeriod.year}-${String(rightPeriod.month).padStart(2, '0')}`;
      }
    } else if (rightPeriod.type === 'quarter' && rightPeriod.quarter) {
      bucket = `${rightPeriod.year}-Q${rightPeriod.quarter}`;
    } else if (rightPeriod.type === 'year') {
      bucket = String(rightPeriod.year);
    }
  }

  return `${rightId}:${entity}:${bucket}`;
}

/**
 * Calculate period match score using period compatibility engine (v2.4.3)
 *
 * Scoring weights (applied to base 0.4):
 * - exact: 1.00 -> 0.40
 * - month_in_quarter: 0.60 -> 0.24
 * - quarter_in_year: 0.55 -> 0.22
 * - month_in_year: 0.45 -> 0.18
 * - none: 0 -> 0
 */
function periodScoreWithKind(
  leftPeriod: MacroPeriod | undefined,
  rightPeriod: MacroPeriod | undefined
): { score: number; kind: PeriodCompatibilityKind } {
  if (!leftPeriod?.type || !rightPeriod?.type) {
    return { score: 0, kind: 'none' };
  }

  const leftKey = buildPeriodKey(leftPeriod);
  const rightKey = buildPeriodKey(rightPeriod);

  const compat = isPeriodCompatible(leftKey, rightKey);

  if (!compat.compatible) {
    return { score: 0, kind: 'none' };
  }

  // Base weight for period is 0.4, scaled by compatibility
  const score = 0.4 * periodCompatibilityScore(compat.kind);

  return { score, kind: compat.kind };
}

/**
 * Check if periods are compatible (v2.4.3)
 * Uses the new period compatibility engine
 */
function periodsAreCompatible(
  leftPeriod: MacroPeriod | undefined,
  rightPeriod: MacroPeriod | undefined
): boolean {
  if (!leftPeriod?.type || !rightPeriod?.type) return false;

  const leftKey = buildPeriodKey(leftPeriod);
  const rightKey = buildPeriodKey(rightPeriod);

  return isPeriodCompatible(leftKey, rightKey).compatible;
}

/**
 * Build entity-based index for target markets
 */
function buildEntityIndex(markets: EligibleMarket[]): EntityIndex {
  const byEntity = new Map<string, Set<number>>();
  const byYear = new Map<number, Set<number>>();
  const marketsMap = new Map<number, IndexedMarket>();

  for (const market of markets) {
    // Pass metadata for Kalshi ticker entity extraction
    const fingerprint = buildFingerprint(market.title, market.closeTime, { metadata: market.metadata });
    const normalizedTitle = normalizeTitleForFuzzy(market.title);

    const indexed: IndexedMarket = { market, fingerprint, normalizedTitle };
    marketsMap.set(market.id, indexed);

    // Index by entities
    for (const entity of fingerprint.entities) {
      if (!byEntity.has(entity)) {
        byEntity.set(entity, new Set());
      }
      byEntity.get(entity)!.add(market.id);
    }

    // Index by year from dates
    for (const date of fingerprint.dates) {
      if (date.year) {
        if (!byYear.has(date.year)) {
          byYear.set(date.year, new Set());
        }
        byYear.get(date.year)!.add(market.id);
      }
    }

    // Also index by closeTime year
    if (market.closeTime) {
      const year = market.closeTime.getFullYear();
      if (!byYear.has(year)) {
        byYear.set(year, new Set());
      }
      byYear.get(year)!.add(market.id);
    }
  }

  return { byEntity, byYear, markets: marketsMap };
}

/**
 * Find candidate markets using entity and date overlap
 */
function findCandidatesByEntity(
  leftFingerprint: MarketFingerprint,
  leftCloseTime: Date | null,
  index: EntityIndex,
  maxCandidates: number = 500
): Set<number> {
  const candidates = new Set<number>();
  const entityScores = new Map<number, number>();

  // Find candidates that share at least one entity
  for (const entity of leftFingerprint.entities) {
    const marketIds = index.byEntity.get(entity);
    if (marketIds) {
      for (const id of marketIds) {
        candidates.add(id);
        entityScores.set(id, (entityScores.get(id) || 0) + 1);
      }
    }
  }

  // If we have too many candidates, prioritize by entity overlap count
  if (candidates.size > maxCandidates) {
    const sorted = Array.from(candidates).sort((a, b) =>
      (entityScores.get(b) || 0) - (entityScores.get(a) || 0)
    );
    return new Set(sorted.slice(0, maxCandidates));
  }

  // If no entities found, try year-based filtering
  if (candidates.size === 0) {
    // Get year from dates or closeTime
    let year: number | undefined;
    if (leftFingerprint.dates.length > 0 && leftFingerprint.dates[0].year) {
      year = leftFingerprint.dates[0].year;
    } else if (leftCloseTime) {
      year = leftCloseTime.getFullYear();
    }

    if (year) {
      const yearMarkets = index.byYear.get(year);
      if (yearMarkets) {
        for (const id of yearMarkets) {
          candidates.add(id);
          if (candidates.size >= maxCandidates) break;
        }
      }
    }
  }

  return candidates;
}

/**
 * Build macro entity + period index for target markets
 * Used for more precise macro market matching
 */
function buildMacroEntityIndex(markets: EligibleMarket[]): MacroEntityIndex {
  const byEntity = new Map<string, Set<number>>();
  const byYear = new Map<number, Set<number>>();
  const byMacroEntityPeriod = new Map<string, Set<number>>();
  const marketsMap = new Map<number, IndexedMarket>();

  for (const market of markets) {
    const fingerprint = buildFingerprint(market.title, market.closeTime, { metadata: market.metadata });
    const normalizedTitle = normalizeTitleForFuzzy(market.title);

    const indexed: IndexedMarket = { market, fingerprint, normalizedTitle };
    marketsMap.set(market.id, indexed);

    // Standard entity index
    for (const entity of fingerprint.entities) {
      if (!byEntity.has(entity)) {
        byEntity.set(entity, new Set());
      }
      byEntity.get(entity)!.add(market.id);
    }

    // Standard year index
    if (fingerprint.period?.year) {
      const year = fingerprint.period.year;
      if (!byYear.has(year)) {
        byYear.set(year, new Set());
      }
      byYear.get(year)!.add(market.id);
    } else if (market.closeTime) {
      const year = market.closeTime.getFullYear();
      if (!byYear.has(year)) {
        byYear.set(year, new Set());
      }
      byYear.get(year)!.add(market.id);
    }

    // Macro entity + period index (only for MACRO_PERIOD intent)
    if (fingerprint.macroEntities?.size && fingerprint.period?.type) {
      for (const macroEntity of fingerprint.macroEntities) {
        const key = buildMacroPeriodKey(macroEntity, fingerprint.period);
        if (key) {
          if (!byMacroEntityPeriod.has(key)) {
            byMacroEntityPeriod.set(key, new Set());
          }
          byMacroEntityPeriod.get(key)!.add(market.id);
        }
      }
    }
  }

  return { byEntity, byYear, byMacroEntityPeriod, markets: marketsMap };
}

/**
 * Find candidate markets for macro matching using entity + period index
 * More precise than general entity matching
 */
function findMacroCandidates(
  leftFingerprint: MarketFingerprint,
  leftCloseTime: Date | null,
  index: MacroEntityIndex,
  maxCandidates: number = 200
): Set<number> {
  const candidates = new Set<number>();
  const scores = new Map<number, number>();

  // If left has macro entities and period, use precise matching
  if (leftFingerprint.macroEntities?.size && leftFingerprint.period?.type) {
    for (const macroEntity of leftFingerprint.macroEntities) {
      // Get all compatible period keys
      const keys = getCompatiblePeriodKeys(macroEntity, leftFingerprint.period);

      for (const key of keys) {
        const marketIds = index.byMacroEntityPeriod.get(key);
        if (marketIds) {
          for (const id of marketIds) {
            candidates.add(id);
            // Score by match quality - exact match gets higher score
            const isExactKey = key === buildMacroPeriodKey(macroEntity, leftFingerprint.period);
            scores.set(id, (scores.get(id) || 0) + (isExactKey ? 2 : 1));
          }
        }
      }
    }
  }

  // Fallback: if no candidates from period matching, use entity-only
  if (candidates.size === 0) {
    // Use general entities as fallback
    for (const entity of leftFingerprint.entities) {
      const marketIds = index.byEntity.get(entity);
      if (marketIds) {
        for (const id of marketIds) {
          candidates.add(id);
          scores.set(id, (scores.get(id) || 0) + 1);
        }
      }
    }

    // Still no candidates? Use year-based fallback
    if (candidates.size === 0) {
      const year = leftFingerprint.period?.year || leftCloseTime?.getFullYear();
      if (year) {
        const yearMarkets = index.byYear.get(year);
        if (yearMarkets) {
          for (const id of yearMarkets) {
            candidates.add(id);
            if (candidates.size >= maxCandidates) break;
          }
        }
      }
    }
  }

  // Limit candidates by score
  if (candidates.size > maxCandidates) {
    const sorted = Array.from(candidates).sort((a, b) =>
      (scores.get(b) || 0) - (scores.get(a) || 0)
    );
    return new Set(sorted.slice(0, maxCandidates));
  }

  return candidates;
}

/**
 * Check if two titles share at least one keyword
 * Used as a prefilter to skip obviously unrelated markets
 */
function hasKeywordOverlap(titleA: string, titleB: string): boolean {
  const wordsA = new Set(titleA.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(titleB.toLowerCase().split(/\s+/).filter(w => w.length > 2));

  for (const word of wordsA) {
    if (wordsB.has(word)) {
      return true;
    }
  }
  return false;
}

/**
 * Calculate fuzzy title similarity using Levenshtein distance
 * Returns score 0-1 where 1 is exact match
 */
function fuzzyTitleScore(titleA: string, titleB: string): number {
  if (titleA === titleB) return 1.0;

  const maxLen = Math.max(titleA.length, titleB.length);
  if (maxLen === 0) return 0;

  const dist = distance(titleA, titleB);
  const similarity = 1 - (dist / maxLen);

  return Math.max(0, similarity);
}

// Intent-based text similarity thresholds to prevent false positives
// PRICE_DATE markets require stricter thresholds (price+date must be precise)
// Other intents can use relaxed thresholds to increase match coverage

// Strict thresholds for PRICE_DATE intent
const PRICE_DATE_MIN_TEXT_SIMILARITY = 0.20;  // (jaccard + fuzzy) / 2 must exceed this
const PRICE_DATE_MIN_JACCARD = 0.10;          // jaccard alone must exceed this

// Relaxed thresholds for other intents (ELECTION, METRIC_DATE, GENERAL)
const RELAXED_MIN_TEXT_SIMILARITY = 0.12;
const RELAXED_MIN_JACCARD = 0.05;

/**
 * Calculate weighted match score using multiple signals
 * Weights: 0.35 entity + 0.25 date + 0.25 number + 0.10 fuzzy + 0.05 jaccard
 * Returns score=0 if date gate fails for PRICE_DATE markets
 * Returns score=0 if text similarity is below minimum threshold (hard gate)
 * For MACRO_PERIOD: uses period gate instead of day-level date gate
 */
function calculateMatchScore(
  left: IndexedMarket,
  right: IndexedMarket
): { score: number; reason: string; breakdown: Record<string, number>; dateGateFailed: boolean; textGateFailed: boolean; periodGateFailed: boolean; periodKind?: PeriodCompatibilityKind } {
  const isMacroPeriodIntent =
    left.fingerprint.intent === MarketIntent.MACRO_PERIOD ||
    right.fingerprint.intent === MarketIntent.MACRO_PERIOD;

  // MACRO_PERIOD uses special scoring and gating
  if (isMacroPeriodIntent) {
    const leftPeriod = left.fingerprint.period;
    const rightPeriod = right.fingerprint.period;
    const leftMacro = left.fingerprint.macroEntities;
    const rightMacro = right.fingerprint.macroEntities;

    // Pre-calculate scores for breakdown
    const entScore = entityScore(left.fingerprint.entities, right.fingerprint.entities);
    const numScore = numberScore(left.fingerprint.numbers, right.fingerprint.numbers);
    const fzScore = fuzzyTitleScore(left.normalizedTitle, right.normalizedTitle);
    const leftTokens = tokenize(left.market.title);
    const rightTokens = tokenize(right.market.title);
    const jcScore = jaccard(leftTokens, rightTokens);

    // HARD GATE 1: Both must have macro entities
    if (!leftMacro?.size || !rightMacro?.size) {
      return {
        score: 0,
        reason: `MACRO_GATE_FAIL (macro entities missing: left=${leftMacro?.size || 0}, right=${rightMacro?.size || 0})`,
        breakdown: { entity: entScore, period: 0, number: numScore, fuzzy: fzScore, jaccard: jcScore },
        dateGateFailed: false,
        textGateFailed: false,
        periodGateFailed: true,
      };
    }

    // HARD GATE 2: Macro entities must overlap
    const macroEntScore = macroEntityScore(leftMacro, rightMacro);
    if (macroEntScore === 0) {
      return {
        score: 0,
        reason: `MACRO_GATE_FAIL (no macro entity overlap: [${Array.from(leftMacro).join(',')}] vs [${Array.from(rightMacro).join(',')}])`,
        breakdown: { entity: entScore, macroEntity: 0, period: 0, number: numScore, fuzzy: fzScore, jaccard: jcScore },
        dateGateFailed: false,
        textGateFailed: false,
        periodGateFailed: true,
      };
    }

    // HARD GATE 3: Period must be present
    if (!leftPeriod?.type || !rightPeriod?.type) {
      return {
        score: 0,
        reason: `PERIOD_GATE_FAIL (period missing: left=${leftPeriod?.type || 'null'}, right=${rightPeriod?.type || 'null'})`,
        breakdown: { entity: entScore, macroEntity: macroEntScore, period: 0, number: numScore, fuzzy: fzScore, jaccard: jcScore },
        dateGateFailed: false,
        textGateFailed: false,
        periodGateFailed: true,
      };
    }

    // HARD GATE 4: Period must be compatible (v2.4.3 - uses compatibility engine)
    if (!periodsAreCompatible(leftPeriod, rightPeriod)) {
      const leftPeriodStr = buildPeriodKey(leftPeriod) || 'null';
      const rightPeriodStr = buildPeriodKey(rightPeriod) || 'null';

      return {
        score: 0,
        reason: `PERIOD_GATE_FAIL (incompatible: ${leftPeriodStr} vs ${rightPeriodStr})`,
        breakdown: { entity: entScore, macroEntity: macroEntScore, period: 0, number: numScore, fuzzy: fzScore, jaccard: jcScore },
        dateGateFailed: false,
        textGateFailed: false,
        periodGateFailed: true,
      };
    }

    // Calculate period score with compatibility kind (v2.4.3)
    const { score: perScore, kind: periodKind } = periodScoreWithKind(leftPeriod, rightPeriod);

    // MACRO_PERIOD scoring formula (v2.4.3):
    // macroEntity (0.5) + period (0.4 * compatScore) + number (0.05) + text bonus (0.05)
    // Period scores by kind: exact=0.40, month_in_quarter=0.24, quarter_in_year=0.22, month_in_year=0.18
    const textBonus = (fzScore + jcScore) / 2 * 0.1; // Up to 0.05 contribution
    const numberBonus = numScore * 0.1; // Up to 0.05 contribution

    const score = macroEntScore + perScore + numberBonus + textBonus;

    const leftPeriodStr = buildPeriodKey(leftPeriod) || 'null';
    const rightPeriodStr = buildPeriodKey(rightPeriod) || 'null';

    // v2.4.5: Compute match tier and include in reason
    const tier = computeMatchTier(periodKind);

    // Include tier and period kind in reason for debugging (v2.4.5)
    const reason = `MACRO: tier=${tier} me=${macroEntScore.toFixed(2)} per=${perScore.toFixed(2)}[${periodKind}](${leftPeriodStr}/${rightPeriodStr}) num=${numberBonus.toFixed(2)} txt=${textBonus.toFixed(2)}`;

    return {
      score,
      reason,
      breakdown: { entity: entScore, macroEntity: macroEntScore, period: perScore, number: numScore, fuzzy: fzScore, jaccard: jcScore },
      dateGateFailed: false,
      textGateFailed: false,
      periodGateFailed: false,
      periodKind,
    };
  }

  // Date gating check - strict matching for PRICE_DATE markets (not used for MACRO_PERIOD)
  if (!isMacroPeriodIntent) {
    const leftDate = left.fingerprint.dates[0];
    const rightDate = right.fingerprint.dates[0];
    const passesGate = passesDateGate(leftDate, rightDate, left.fingerprint.intent, right.fingerprint.intent);

    // If date gate fails for date-sensitive markets, return 0 score
    if (!passesGate) {
      return {
        score: 0,
        reason: `DATE_GATE_FAIL (${left.fingerprint.intent}/${right.fingerprint.intent})`,
        breakdown: { entity: 0, date: 0, number: 0, fuzzy: 0, jaccard: 0 },
        dateGateFailed: true,
        textGateFailed: false,
        periodGateFailed: false,
      };
    }
  }

  // Entity score (0-1)
  const entScore = entityScore(left.fingerprint.entities, right.fingerprint.entities);

  // Date score (0-1) - for MACRO_PERIOD, we use period compatibility instead
  const leftDate = left.fingerprint.dates[0];
  const rightDate = right.fingerprint.dates[0];
  const dtScore = isMacroPeriodIntent ? 1.0 : dateScore(leftDate, rightDate); // Full date score if period gate passed

  // Number score (0-1)
  const numScore = numberScore(left.fingerprint.numbers, right.fingerprint.numbers);

  // Fuzzy title score (0-1)
  const fzScore = fuzzyTitleScore(left.normalizedTitle, right.normalizedTitle);

  // Jaccard score (0-1) - on tokenized titles
  const leftTokens = tokenize(left.market.title);
  const rightTokens = tokenize(right.market.title);
  const jcScore = jaccard(leftTokens, rightTokens);

  // HARD GATE: Require minimum text similarity
  // This prevents matches like "Trump Greenland Tariffs" vs "Trump pardon" where
  // entity matches but titles are semantically different
  //
  // Intent-based thresholds:
  // - PRICE_DATE requires stricter thresholds (price+date precision matters)
  // - MACRO_PERIOD uses relaxed thresholds (period is the main gate)
  // - Other intents use relaxed thresholds to increase match coverage
  const isPriceDateIntent =
    left.fingerprint.intent === MarketIntent.PRICE_DATE ||
    right.fingerprint.intent === MarketIntent.PRICE_DATE;

  const minTextSimilarity = isPriceDateIntent ? PRICE_DATE_MIN_TEXT_SIMILARITY : RELAXED_MIN_TEXT_SIMILARITY;
  const minJaccard = isPriceDateIntent ? PRICE_DATE_MIN_JACCARD : RELAXED_MIN_JACCARD;

  const textSimilarity = (jcScore + fzScore) / 2;
  if (textSimilarity < minTextSimilarity || jcScore < minJaccard) {
    const reason = jcScore < minJaccard
      ? `TEXT_GATE_FAIL (jc=${jcScore.toFixed(3)} < ${minJaccard})`
      : `TEXT_GATE_FAIL (sim=${textSimilarity.toFixed(3)} < ${minTextSimilarity})`;
    return {
      score: 0,
      reason,
      breakdown: { entity: entScore, date: dtScore, number: numScore, fuzzy: fzScore, jaccard: jcScore },
      dateGateFailed: false,
      textGateFailed: true,
      periodGateFailed: false,
    };
  }

  // Weighted combination
  const score =
    0.35 * entScore +
    0.25 * dtScore +
    0.25 * numScore +
    0.10 * fzScore +
    0.05 * jcScore;

  const breakdown = {
    entity: entScore,
    date: dtScore,
    number: numScore,
    fuzzy: fzScore,
    jaccard: jcScore,
  };

  const reason = `ent=${entScore.toFixed(2)} dt=${dtScore.toFixed(2)} num=${numScore.toFixed(2)} fz=${fzScore.toFixed(2)} jc=${jcScore.toFixed(2)}`;

  return { score, reason, breakdown, dateGateFailed: false, textGateFailed: false, periodGateFailed: false };
}

/**
 * Check if a market matches a topic based on entities or keywords
 * @param market - Market to check
 * @param fingerprint - Pre-computed fingerprint (if available)
 * @param topic - Topic to match against
 * @returns true if market matches the topic
 */
function matchesTopic(
  market: EligibleMarket,
  fingerprint: MarketFingerprint | null,
  topic: Exclude<TopicFilter, 'all'>
): boolean {
  const topicEntities = new Set(TOPIC_ENTITIES[topic]);
  const topicKeywords = TOPIC_KEYWORDS[topic];

  // Check entities first (most reliable)
  if (fingerprint) {
    for (const entity of fingerprint.entities) {
      if (topicEntities.has(entity)) {
        return true;
      }
    }
  }

  // Fallback to keyword matching in title
  return hasKeywordToken(market.title, topicKeywords);
}

/**
 * Filter markets by topic
 * @param markets - Markets to filter
 * @param topic - Topic filter ('all' returns all markets)
 * @returns Filtered markets and count of removed
 */
function filterByTopic(
  markets: EligibleMarket[],
  topic: TopicFilter
): { filtered: EligibleMarket[]; removed: number } {
  if (topic === 'all') {
    return { filtered: markets, removed: 0 };
  }

  const filtered: EligibleMarket[] = [];
  let removed = 0;

  for (const market of markets) {
    // Compute fingerprint for entity extraction
    const fingerprint = buildFingerprint(market.title, market.closeTime, { metadata: market.metadata });
    if (matchesTopic(market, fingerprint, topic)) {
      filtered.push(market);
    } else {
      removed++;
    }
  }

  return { filtered, removed };
}

/**
 * Common options for fetching eligible markets
 */
interface FetchMarketsOptions {
  venue: CoreVenue;
  lookbackHours: number;
  limit: number;
  targetKeywords: string[];
  topic: TopicFilter;
  excludeSports: boolean;
  excludeKalshiPrefixes: string[];
  excludeTitleKeywords: string[];
  // Macro year window (v2.4.1)
  macroMinYear?: number;
  macroMaxYear?: number;
  // Rare entity extended lookback (v2.4.3)
  rareEntityLookbackHours?: number;
  // Sort order for DB query (v2.4.5)
  // 'id' (default): newest markets first
  // 'closeTime': markets closing soon first (better for macro - includes old active markets)
  orderBy?: 'id' | 'closeTime';
}

/**
 * Pipeline stats for market fetching
 */
interface FetchMarketsStats {
  total: number;
  afterKeywordFilter: number;
  afterSportsFilter: number;
  afterTopicFilter: number;
  afterMacroYearFilter: number;
  macroExcludedYearLow: number;
  macroExcludedYearHigh: number;
  macroExcludedNoYear: number;
  // Rare entity extended lookback (v2.4.3)
  rareEntityMarketsAdded: number;
}

/**
 * Fetch eligible markets with all filters applied
 * This is the unified pipeline used by both debug and full run modes
 */
async function fetchEligibleMarkets(
  marketRepo: MarketRepository,
  options: FetchMarketsOptions
): Promise<{ markets: EligibleMarket[]; stats: FetchMarketsStats }> {
  const {
    venue,
    lookbackHours,
    limit,
    targetKeywords,
    topic,
    excludeSports,
    excludeKalshiPrefixes,
    excludeTitleKeywords,
    macroMinYear,
    macroMaxYear,
    rareEntityLookbackHours,
    orderBy,
  } = options;

  // Step 1: Fetch from DB with keyword filter
  // v2.4.5: Pass orderBy to support different sorting strategies
  let markets = await marketRepo.listEligibleMarkets(venue as Venue, {
    lookbackHours,
    limit,
    titleKeywords: targetKeywords.length > 0 ? targetKeywords : undefined,
    orderBy,
  });
  const total = markets.length;

  // Step 2: Apply token-based keyword post-filter (DB uses substring matching)
  if (targetKeywords.length > 0) {
    const { filtered } = filterByKeywordTokens(markets, targetKeywords);
    markets = filtered;
  }
  const afterKeywordFilter = markets.length;

  // Step 3: Apply sports filtering
  if (excludeSports) {
    const polyKeywords = venue === 'polymarket' ? [...excludeTitleKeywords, ...POLYMARKET_ESPORTS_KEYWORDS] : excludeTitleKeywords;
    const { filtered } = filterSportsMarkets(markets, venue, {
      excludeKalshiPrefixes: venue === 'kalshi' ? excludeKalshiPrefixes : [],
      excludeTitleKeywords: polyKeywords,
    });
    markets = filtered;
  }
  const afterSportsFilter = markets.length;

  // Step 4: Apply topic filtering
  if (topic !== 'all') {
    const { filtered } = filterByTopic(markets, topic);
    markets = filtered;
  }
  const afterTopicFilter = markets.length;

  // Step 5: Apply macro year window filter (v2.4.1)
  // Only for topic=macro, filter by period.year or closeTime.year
  let afterMacroYearFilter = afterTopicFilter;
  let macroExcludedYearLow = 0;
  let macroExcludedYearHigh = 0;
  let macroExcludedNoYear = 0;

  if (topic === 'macro' && (macroMinYear || macroMaxYear)) {
    const filtered: EligibleMarket[] = [];

    for (const market of markets) {
      // Extract period from title
      const period = extractPeriod(market.title, market.closeTime);
      let year: number | undefined;

      // Use period.year if available, otherwise closeTime.year
      if (period.year) {
        year = period.year;
      } else if (market.closeTime) {
        year = market.closeTime.getFullYear();
      }

      // Exclude if no year
      if (!year) {
        macroExcludedNoYear++;
        continue;
      }

      // Exclude if year < macroMinYear
      if (macroMinYear && year < macroMinYear) {
        macroExcludedYearLow++;
        continue;
      }

      // Exclude if year > macroMaxYear
      if (macroMaxYear && year > macroMaxYear) {
        macroExcludedYearHigh++;
        continue;
      }

      filtered.push(market);
    }

    markets = filtered;
    afterMacroYearFilter = markets.length;
  }

  // Step 6: Rare entity extended lookback (v2.4.3)
  // For macro topic, check if rare entities are missing and refetch with extended lookback
  let rareEntityMarketsAdded = 0;

  if (topic === 'macro' && rareEntityLookbackHours && rareEntityLookbackHours > lookbackHours) {
    // Find which rare entities already have markets
    const foundRareEntities = new Set<string>();
    for (const market of markets) {
      const fp = buildFingerprint(market.title, market.closeTime, { metadata: market.metadata });
      for (const entity of fp.macroEntities || []) {
        if (RARE_MACRO_ENTITIES.has(entity)) {
          foundRareEntities.add(entity);
        }
      }
    }

    // Find missing rare entities
    const missingRareEntities = [...RARE_MACRO_ENTITIES].filter(e => !foundRareEntities.has(e));

    if (missingRareEntities.length > 0) {
      // Build keywords for missing rare entities
      const rareKeywords: string[] = [];
      for (const entity of missingRareEntities) {
        if (entity === 'GDP') rareKeywords.push('gdp');
        else if (entity === 'UNEMPLOYMENT_RATE') rareKeywords.push('unemployment', 'jobless');
      }

      if (rareKeywords.length > 0) {
        const existingIds = new Set(markets.map(m => m.id));

        // Fetch with extended lookback
        // v2.4.5: Use same orderBy for consistency
        const extendedMarkets = await marketRepo.listEligibleMarkets(venue as Venue, {
          lookbackHours: rareEntityLookbackHours,
          limit,
          titleKeywords: rareKeywords,
          orderBy,
        });

        // Process extended markets through same filters
        const polyKeywords = venue === 'polymarket' ? [...excludeTitleKeywords, ...POLYMARKET_ESPORTS_KEYWORDS] : excludeTitleKeywords;

        for (const market of extendedMarkets) {
          if (existingIds.has(market.id)) continue;

          // Apply keyword filter
          if (!hasKeywordToken(market.title, rareKeywords)) continue;

          // Apply sports filter
          if (excludeSports) {
            if (venue === 'kalshi' && isKalshiSportsMarket(market.metadata, excludeKalshiPrefixes)) continue;
            if (hasSportsTitleKeyword(market.title, polyKeywords)) continue;
          }

          // Apply topic filter
          const fp = buildFingerprint(market.title, market.closeTime, { metadata: market.metadata });
          if (!matchesTopic(market, fp, 'macro')) continue;

          // Check if it has a missing rare entity
          const hasRareEntity = [...(fp.macroEntities || [])].some(e => missingRareEntities.includes(e));
          if (!hasRareEntity) continue;

          // Apply year filter
          const period = extractPeriod(market.title, market.closeTime);
          let year: number | undefined;
          if (period.year) year = period.year;
          else if (market.closeTime) year = market.closeTime.getFullYear();

          if (!year) continue;
          if (macroMinYear && year < macroMinYear) continue;
          if (macroMaxYear && year > macroMaxYear) continue;

          markets.push(market);
          existingIds.add(market.id);
          rareEntityMarketsAdded++;
        }
      }
    }
  }

  return {
    markets,
    stats: {
      total,
      afterKeywordFilter,
      afterSportsFilter,
      afterTopicFilter,
      afterMacroYearFilter,
      macroExcludedYearLow,
      macroExcludedYearHigh,
      macroExcludedNoYear,
      rareEntityMarketsAdded,
    },
  };
}

/**
 * Debug a single market - show top candidates with breakdown
 * Uses the SAME pipeline as runSuggestMatches for market fetching
 */
async function debugMarket(
  marketId: number,
  fromVenue: CoreVenue,
  toVenue: CoreVenue,
  options: {
    lookbackHours: number;
    limitLeft: number;
    limitRight: number;
    targetKeywords: string[];
    topic: TopicFilter;
    excludeSports: boolean;
    excludeKalshiPrefixes: string[];
    excludeTitleKeywords: string[];
  }
): Promise<void> {
  const prisma = getClient();
  const marketRepo = new MarketRepository(prisma);

  console.log(`\n[debug v2.4.5] Analyzing market ID ${marketId} from ${fromVenue}...\n`);
  console.log(`[debug] Using unified pipeline with full run settings:`);
  console.log(`[debug] lookbackHours=${options.lookbackHours}, limitLeft=${options.limitLeft}, limitRight=${options.limitRight}`);
  console.log(`[debug] topic=${options.topic}, excludeSports=${options.excludeSports}, keywords=${options.targetKeywords.length}`);

  // v2.4.5: Use closeTime ordering for macro to include old active markets
  const orderBy = options.topic === 'macro' ? 'closeTime' as const : 'id' as const;
  console.log(`[debug] orderBy=${orderBy} (v2.4.5: macro uses closeTime to include old active markets)`);

  // Fetch source markets using unified pipeline
  const { markets: leftMarkets, stats: leftStats } = await fetchEligibleMarkets(marketRepo, {
    venue: fromVenue,
    lookbackHours: options.lookbackHours,
    limit: options.limitLeft,
    targetKeywords: options.targetKeywords,
    topic: options.topic,
    excludeSports: options.excludeSports,
    excludeKalshiPrefixes: options.excludeKalshiPrefixes,
    excludeTitleKeywords: options.excludeTitleKeywords,
    orderBy,
  });

  console.log(`\n[debug] ${fromVenue} markets: ${leftStats.total} -> ${leftStats.afterKeywordFilter} (kw) -> ${leftStats.afterSportsFilter} (sports) -> ${leftStats.afterTopicFilter} (topic)`);

  const leftMarket = leftMarkets.find(m => m.id === marketId);
  if (!leftMarket) {
    // Market not found in filtered set - try to find why
    // v2.4.5: Use closeTime ordering for macro
    const allMarkets = await marketRepo.listEligibleMarkets(fromVenue as Venue, {
      lookbackHours: options.lookbackHours,
      limit: 50000,
      orderBy,
    });
    const rawMarket = allMarkets.find(m => m.id === marketId);
    if (rawMarket) {
      console.error(`Market ${marketId} found in raw data but filtered out.`);
      console.error(`Title: ${rawMarket.title}`);

      // Check why it was filtered
      const hasKeyword = hasKeywordToken(rawMarket.title, options.targetKeywords);
      const isSports = hasSportsTitleKeyword(rawMarket.title, options.excludeTitleKeywords);
      console.error(`Has target keyword: ${hasKeyword}`);
      console.error(`Is sports market: ${isSports}`);
    } else {
      console.error(`Market ${marketId} not found in ${fromVenue} (lookback=${options.lookbackHours}h)`);
    }
    return;
  }

  console.log(`\nSource market:`);
  console.log(`  ID: ${leftMarket.id}`);
  console.log(`  Title: ${leftMarket.title}`);
  console.log(`  Category: ${leftMarket.category || 'N/A'}`);
  console.log(`  Close time: ${leftMarket.closeTime?.toISOString() || 'N/A'}`);

  // Show metadata if available (for Kalshi)
  if (leftMarket.metadata) {
    const eventTicker = (leftMarket.metadata as Record<string, unknown>).eventTicker || (leftMarket.metadata as Record<string, unknown>).event_ticker;
    if (eventTicker) {
      console.log(`  Event ticker: ${eventTicker}`);
    }
  }

  const leftFingerprint = buildFingerprint(leftMarket.title, leftMarket.closeTime, { metadata: leftMarket.metadata });
  console.log(`  Entities: ${leftFingerprint.entities.join(', ') || 'none'}`);
  console.log(`  Numbers: ${leftFingerprint.numbers.join(', ') || 'none'}`);

  // Show dates with precision
  if (leftFingerprint.dates.length > 0) {
    const dateInfo = leftFingerprint.dates.map(d => `${d.raw} (${d.precision})`).join(', ');
    console.log(`  Dates: ${dateInfo}`);
  } else {
    console.log(`  Dates: none`);
  }

  console.log(`  Comparator: ${leftFingerprint.comparator}`);
  console.log(`  Intent: ${leftFingerprint.intent}`);

  // Show period for MACRO_PERIOD intent
  if (leftFingerprint.period?.type) {
    const p = leftFingerprint.period;
    const periodStr = p.type === 'month' ? `${p.year}-${String(p.month).padStart(2, '0')}` :
                      p.type === 'quarter' ? `Q${p.quarter} ${p.year}` :
                      `${p.year}`;
    console.log(`  Period: ${periodStr} (${p.type})`);
  }

  // Show macro entities for MACRO_PERIOD intent
  if (leftFingerprint.macroEntities?.size) {
    console.log(`  Macro entities: ${Array.from(leftFingerprint.macroEntities).join(', ')}`);
  }

  console.log(`  Fingerprint: ${leftFingerprint.fingerprint}`);
  const isPriceDate = leftFingerprint.intent === MarketIntent.PRICE_DATE;
  const isMacroPeriod = leftFingerprint.intent === MarketIntent.MACRO_PERIOD;
  console.log(`  Text gate: sim>=${isPriceDate ? PRICE_DATE_MIN_TEXT_SIMILARITY : RELAXED_MIN_TEXT_SIMILARITY}, jc>=${isPriceDate ? PRICE_DATE_MIN_JACCARD : RELAXED_MIN_JACCARD} (${isPriceDate ? 'PRICE_DATE strict' : 'relaxed'})`);
  if (isMacroPeriod) {
    console.log(`  Period gate: ENABLED (requires compatible period match)`);
  }

  // Fetch target markets using unified pipeline
  // v2.4.5: Use orderBy for consistency with left markets
  const { markets: rightMarkets, stats: rightStats } = await fetchEligibleMarkets(marketRepo, {
    venue: toVenue,
    lookbackHours: options.lookbackHours,
    limit: options.limitRight,
    targetKeywords: options.targetKeywords,
    topic: options.topic,
    excludeSports: options.excludeSports,
    excludeKalshiPrefixes: options.excludeKalshiPrefixes,
    excludeTitleKeywords: options.excludeTitleKeywords,
    orderBy,
  });

  console.log(`\n[debug] ${toVenue} markets: ${rightStats.total} -> ${rightStats.afterKeywordFilter} (kw) -> ${rightStats.afterSportsFilter} (sports) -> ${rightStats.afterTopicFilter} (topic)`);

  // Build index - use macro-specific index for topic=macro
  const isMacroTopic = options.topic === 'macro';
  const index = isMacroTopic
    ? buildMacroEntityIndex(rightMarkets)
    : buildEntityIndex(rightMarkets);

  if (isMacroTopic) {
    const macroIndex = index as MacroEntityIndex;
    console.log(`[debug] Macro index: ${macroIndex.byMacroEntityPeriod.size} entity+period keys, ${index.byEntity.size} entities, ${index.byYear.size} years`);
  } else {
    console.log(`[debug] Index: ${index.byEntity.size} unique entities, ${index.byYear.size} years`);
  }

  // Find candidates - use macro candidates for topic=macro or MACRO_PERIOD intent
  const useMacroMatching = isMacroTopic || leftFingerprint.intent === MarketIntent.MACRO_PERIOD;
  const candidateIds = useMacroMatching && isMacroTopic
    ? findMacroCandidates(leftFingerprint, leftMarket.closeTime, index as MacroEntityIndex, 200)
    : findCandidatesByEntity(leftFingerprint, leftMarket.closeTime, index, 1000);
  console.log(`[debug] Found ${candidateIds.size} candidates by ${useMacroMatching ? 'macro entity+period' : 'entity'} overlap\n`);

  // Score all candidates
  const leftIndexed: IndexedMarket = {
    market: leftMarket,
    fingerprint: leftFingerprint,
    normalizedTitle: normalizeTitleForFuzzy(leftMarket.title),
  };

  const scores: Array<{
    market: EligibleMarket;
    score: number;
    reason: string;
    breakdown: Record<string, number>;
    fingerprint: MarketFingerprint;
    dateGateFailed: boolean;
    textGateFailed: boolean;
    periodGateFailed: boolean;
  }> = [];

  let dateGateFailCount = 0;
  let textGateFailCount = 0;
  let periodGateFailCount = 0;

  for (const rightId of candidateIds) {
    const rightIndexed = index.markets.get(rightId);
    if (!rightIndexed) continue;

    const result = calculateMatchScore(leftIndexed, rightIndexed);
    if (result.dateGateFailed) {
      dateGateFailCount++;
    }
    if (result.textGateFailed) {
      textGateFailCount++;
    }
    if (result.periodGateFailed) {
      periodGateFailCount++;
    }
    scores.push({
      market: rightIndexed.market,
      score: result.score,
      reason: result.reason,
      breakdown: result.breakdown,
      fingerprint: rightIndexed.fingerprint,
      dateGateFailed: result.dateGateFailed,
      textGateFailed: result.textGateFailed,
      periodGateFailed: result.periodGateFailed,
    });
  }

  // Sort by score (gate failures at the bottom)
  scores.sort((a, b) => {
    const aFailed = a.dateGateFailed || a.textGateFailed || a.periodGateFailed;
    const bFailed = b.dateGateFailed || b.textGateFailed || b.periodGateFailed;
    if (aFailed && !bFailed) return 1;
    if (!aFailed && bFailed) return -1;
    return b.score - a.score;
  });

  console.log(`Gate failures: date=${dateGateFailCount}, text=${textGateFailCount}, period=${periodGateFailCount} / ${candidateIds.size} candidates`);

  // Count passing scores
  const passingScores = scores.filter(s => !s.dateGateFailed && !s.textGateFailed && !s.periodGateFailed);
  console.log(`Passing candidates (no gate failures): ${passingScores.length}`);

  // Show top 20
  console.log(`\nTop 20 candidates:\n`);
  console.log('Rank | Score | Gate   | Intent       | Entity | Date   | Number | Title');
  console.log('-'.repeat(130));

  for (let i = 0; i < Math.min(20, scores.length); i++) {
    const s = scores[i];
    const truncTitle = s.market.title.length > 45 ? s.market.title.slice(0, 42) + '...' : s.market.title;
    const gateStatus = s.dateGateFailed ? 'DATE  ' : (s.textGateFailed ? 'TEXT  ' : (s.periodGateFailed ? 'PERIOD' : 'OK    '));
    const intent = s.fingerprint.intent.padEnd(12);
    console.log(
      `${String(i + 1).padStart(4)} | ${s.score.toFixed(3)} | ${gateStatus} | ${intent} | ${s.breakdown.entity.toFixed(3)}  | ${s.breakdown.date.toFixed(3)}  | ${s.breakdown.number.toFixed(3)}  | ${truncTitle}`
    );
  }

  console.log('\nDetailed top 5:\n');
  for (let i = 0; i < Math.min(5, scores.length); i++) {
    const s = scores[i];
    const gateIcon = s.dateGateFailed ? '[DATE FAIL]' : (s.textGateFailed ? '[TEXT FAIL]' : (s.periodGateFailed ? '[PERIOD FAIL]' : '[PASS]'));
    console.log(`#${i + 1} (score=${s.score.toFixed(4)}) ${gateIcon}:`);
    console.log(`  Title: ${s.market.title}`);
    console.log(`  ID: ${s.market.id}`);
    console.log(`  Intent: ${s.fingerprint.intent}`);
    console.log(`  Entities: ${s.fingerprint.entities.join(', ') || 'none'}`);
    console.log(`  Numbers: ${s.fingerprint.numbers.join(', ') || 'none'}`);

    // Show dates with precision
    if (s.fingerprint.dates.length > 0) {
      const dateInfo = s.fingerprint.dates.map(d => `${d.raw} (${d.precision})`).join(', ');
      console.log(`  Dates: ${dateInfo}`);
    } else {
      console.log(`  Dates: none`);
    }

    // Show period for MACRO_PERIOD intent
    if (s.fingerprint.period?.type) {
      const p = s.fingerprint.period;
      const periodStr = p.type === 'month' ? `${p.year}-${String(p.month).padStart(2, '0')}` :
                        p.type === 'quarter' ? `Q${p.quarter} ${p.year}` :
                        `${p.year}`;
      console.log(`  Period: ${periodStr} (${p.type})`);
    }

    console.log(`  Breakdown: ${s.reason}`);
    if (s.dateGateFailed) {
      console.log(`  Status: DATE_GATE_FAILED - intents: source=${leftFingerprint.intent}, target=${s.fingerprint.intent}`);
    } else if (s.periodGateFailed) {
      console.log(`  Status: PERIOD_GATE_FAILED - ${s.reason}`);
    } else if (s.textGateFailed) {
      const textSim = ((s.breakdown.jaccard + s.breakdown.fuzzy) / 2).toFixed(3);
      const isPriceDatePair = leftFingerprint.intent === MarketIntent.PRICE_DATE || s.fingerprint.intent === MarketIntent.PRICE_DATE;
      const minSim = isPriceDatePair ? PRICE_DATE_MIN_TEXT_SIMILARITY : RELAXED_MIN_TEXT_SIMILARITY;
      const minJc = isPriceDatePair ? PRICE_DATE_MIN_JACCARD : RELAXED_MIN_JACCARD;
      console.log(`  Status: TEXT_GATE_FAILED - sim=${textSim}, jc=${s.breakdown.jaccard.toFixed(3)} (min: sim>=${minSim}, jc>=${minJc}, ${isPriceDatePair ? 'strict' : 'relaxed'})`);
    }
    console.log('');
  }
}

/**
 * Run suggest-matches job with fingerprint-based matching
 */
// Default keywords for matching political/economic markets
const MATCHING_KEYWORDS = [
  'trump', 'biden', 'harris', 'election', 'president', 'congress', 'senate', 'house',
  'bitcoin', 'btc', 'ethereum', 'eth', 'crypto',
  'cpi', 'gdp', 'inflation', 'fed', 'rate',
  'ukraine', 'russia', 'china', 'war',
];

// ============================================================
// v2.5.3: Crypto-specific matching function with dedup/caps
// ============================================================

interface CryptoSuggestMatchesOptions {
  fromVenue: CoreVenue;
  toVenue: CoreVenue;
  minScore: number;
  topK: number;
  lookbackHours: number;
  limitLeft: number;
  limitRight: number;
  maxSuggestionsPerLeft: number;
  excludeSports: boolean;
  /** v2.5.3: Max suggestions per right market per (entity, settleKey) */
  maxPerRight: number;
  /** v2.5.3: Winner gap - if top1 - top2 >= gap, keep only top1 */
  winnerGap: number;
  /** v2.6.0: Max bracket groups per left market (0 = disabled) */
  maxGroupsPerLeft: number;
  /** v2.6.0: Max lines per bracket group (0 = disabled) */
  maxLinesPerGroup: number;
  /**
   * v2.6.2: Exclude intraday markets (INTRADAY_UPDOWN)
   * When true, filters out markets with intraday tickers (KXBTCUPDOWN, etc.)
   * and markets classified as INTRADAY_UPDOWN
   */
  excludeIntraday: boolean;
  /** v2.6.2: Algorithm version for tracking (e.g., "crypto_daily@2.6.2") */
  algoVersion: string;
  marketRepo: MarketRepository;
  linkRepo: MarketLinkRepository;
  result: SuggestMatchesResult;
}

/**
 * v2.5.3/v2.6.0 Dedup stats for crypto matching
 */
interface CryptoDedupStats {
  generatedPairs: number;
  savedTopK: number;
  droppedByLeftCap: number;
  droppedByRightCap: number;
  droppedByWinnerGap: number;
  /** v2.6.0: Bracket grouping stats */
  bracketStats: BracketStats | null;
}

/**
 * v2.6.2: Options for intraday crypto matching
 */
interface IntradaySuggestMatchesOptions {
  fromVenue: CoreVenue;
  toVenue: CoreVenue;
  minScore: number;
  topK: number;
  lookbackHours: number;
  limitLeft: number;
  limitRight: number;
  maxSuggestionsPerLeft: number;
  excludeSports: boolean;
  /** Max suggestions per right market */
  maxPerRight: number;
  /** Time bucket size for intraday matching */
  slotSize: IntradaySlotSize;
  /** v2.6.2: Algorithm version for tracking (e.g., "crypto_intraday@2.6.2") */
  algoVersion: string;
  marketRepo: MarketRepository;
  linkRepo: MarketLinkRepository;
  result: SuggestMatchesResult;
}

/**
 * v2.6.2: Intraday crypto matching flow
 *
 * Uses dedicated intraday pipeline:
 * - fetchIntradayCryptoMarkets with INTRADAY_UPDOWN market type filter
 * - buildIntradayIndex keyed by entity + timeBucket
 * - findIntradayCandidates with exact bucket match (no ±1 day)
 * - intradayMatchScore with hard gates (entity match, bucket exact)
 *
 * Scoring weights: entity 0.6 + time 0.3 + text 0.1
 */
async function runIntradaySuggestMatches(options: IntradaySuggestMatchesOptions): Promise<SuggestMatchesResult> {
  const {
    fromVenue,
    toVenue,
    minScore,
    topK,
    lookbackHours,
    limitLeft,
    limitRight,
    maxSuggestionsPerLeft,
    excludeSports,
    maxPerRight,
    slotSize,
    algoVersion,
    marketRepo,
    linkRepo,
    result,
  } = options;

  console.log(`[intraday-matching] Starting suggest-matches v2.6.3: ${fromVenue} -> ${toVenue}`);
  console.log(`[intraday-matching] minScore=${minScore}, topK=${topK}, lookbackHours=${lookbackHours}`);
  console.log(`[intraday-matching] limitLeft=${limitLeft}, limitRight=${limitRight}, maxSuggestionsPerLeft=${maxSuggestionsPerLeft}`);
  console.log(`[intraday-matching] maxPerRight=${maxPerRight}, slotSize=${slotSize}, algoVersion=${algoVersion}`);
  console.log(`[intraday-matching] Sports exclusion: ${excludeSports ? 'enabled' : 'disabled'}`);

  try {
    // Fetch intraday crypto markets from both venues
    console.log(`[intraday-matching] Fetching intraday crypto markets from ${fromVenue}...`);
    const { markets: leftMarkets, stats: leftStats } = await fetchIntradayCryptoMarkets(marketRepo, {
      venue: fromVenue,
      lookbackHours,
      limit: limitLeft,
      excludeSports,
      slotSize,
    });
    result.leftCount = leftMarkets.length;
    console.log(`[intraday-matching] ${fromVenue}: ${leftStats.total} DB -> ${leftStats.afterSportsFilter} (sports) -> ${leftStats.afterIntradayFilter} (intraday only) -> ${leftStats.withCryptoEntity} (with entity)`);

    console.log(`[intraday-matching] Fetching intraday crypto markets from ${toVenue}...`);
    const { markets: rightMarkets, stats: rightStats } = await fetchIntradayCryptoMarkets(marketRepo, {
      venue: toVenue,
      lookbackHours,
      limit: limitRight,
      excludeSports,
      slotSize,
    });
    result.rightCount = rightMarkets.length;
    console.log(`[intraday-matching] ${toVenue}: ${rightStats.total} DB -> ${rightStats.afterSportsFilter} (sports) -> ${rightStats.afterIntradayFilter} (intraday only) -> ${rightStats.withCryptoEntity} (with entity)`);

    if (leftMarkets.length === 0 || rightMarkets.length === 0) {
      console.log(`[intraday-matching] No markets to match`);
      return result;
    }

    // Build intraday index for right markets (keyed by entity + timeBucket)
    console.log(`[intraday-matching] Building intraday index for ${toVenue}...`);
    const intradayIndex = buildIntradayIndex(rightMarkets);
    console.log(`[intraday-matching] Index built: ${intradayIndex.size} unique entity+bucket keys`);

    // Get set of markets that already have confirmed links
    const confirmedLeft = new Set<number>();
    for (const { market } of leftMarkets) {
      const hasConfirmed = await linkRepo.hasConfirmedLink(fromVenue as Venue, market.id);
      if (hasConfirmed) {
        confirmedLeft.add(market.id);
      }
    }
    console.log(`[intraday-matching] ${confirmedLeft.size} markets from ${fromVenue} already have confirmed links`);

    // Intraday coverage tracking
    const intradayStats = {
      leftByEntity: new Map<string, number>(),
      rightByEntity: new Map<string, number>(),
      matchedByEntity: new Map<string, number>(),
      leftByBucket: new Map<string, number>(),
      rightByBucket: new Map<string, number>(),
    };

    // Build right-side entity counts
    for (const { signals } of rightMarkets) {
      if (signals.entity) {
        intradayStats.rightByEntity.set(signals.entity, (intradayStats.rightByEntity.get(signals.entity) || 0) + 1);
      }
      if (signals.timeBucket) {
        intradayStats.rightByBucket.set(signals.timeBucket, (intradayStats.rightByBucket.get(signals.timeBucket) || 0) + 1);
      }
    }

    // Track right-side usage for dedup
    const rightUsage = new Map<string, number>();

    // Process each left market
    console.log(`[intraday-matching] Processing matches...`);
    let processed = 0;
    const effectiveCap = Math.min(topK, maxSuggestionsPerLeft);

    for (const leftIntraday of leftMarkets) {
      const leftMarket = leftIntraday.market;

      // Skip if already has confirmed link
      if (confirmedLeft.has(leftMarket.id)) {
        result.skippedConfirmed++;
        continue;
      }

      // Track left-side entity
      if (leftIntraday.signals.entity) {
        intradayStats.leftByEntity.set(leftIntraday.signals.entity, (intradayStats.leftByEntity.get(leftIntraday.signals.entity) || 0) + 1);
      }
      if (leftIntraday.signals.timeBucket) {
        intradayStats.leftByBucket.set(leftIntraday.signals.timeBucket, (intradayStats.leftByBucket.get(leftIntraday.signals.timeBucket) || 0) + 1);
      }

      // Find candidates using intraday index (exact entity + timeBucket match)
      const candidates = findIntradayCandidates(leftIntraday, intradayIndex);
      result.candidatesConsidered += candidates.length;

      // Score candidates
      const scores: Array<{
        rightMarket: IntradayMarket;
        score: number;
        reason: string;
        entity: string;
        bucket: string;
      }> = [];

      for (const rightIntraday of candidates) {
        // Skip self-match
        if (rightIntraday.market.id === leftMarket.id) continue;

        // Calculate intraday score (includes hard gates)
        const scoreResult = intradayMatchScore(leftIntraday, rightIntraday);

        // null means gate failed
        if (!scoreResult) {
          result.skippedDateGate++; // entity or bucket gate
          continue;
        }

        if (scoreResult.score >= minScore) {
          scores.push({
            rightMarket: rightIntraday,
            score: scoreResult.score,
            reason: scoreResult.reason,
            entity: rightIntraday.signals.entity || 'UNKNOWN',
            bucket: rightIntraday.signals.timeBucket || 'UNKNOWN',
          });
        }
      }

      // Sort by score descending
      scores.sort((a, b) => b.score - a.score);

      // Track generated pairs
      result.generatedPairsTotal += scores.length;

      // Apply left cap
      const afterLeftCap = scores.slice(0, effectiveCap);
      result.droppedByCapTotal += Math.max(0, scores.length - afterLeftCap.length);

      // Apply right-side cap
      const finalCandidates: typeof afterLeftCap = [];
      for (const candidate of afterLeftCap) {
        const rightKey = `${candidate.rightMarket.market.id}|${candidate.entity}|${candidate.bucket}`;
        const currentUsage = rightUsage.get(rightKey) || 0;

        if (currentUsage < maxPerRight) {
          finalCandidates.push(candidate);
          rightUsage.set(rightKey, currentUsage + 1);
        } else {
          result.droppedByRightCap++;
        }
      }

      result.savedTopKTotal += finalCandidates.length;

      // Save suggestions
      for (const candidate of finalCandidates) {
        try {
          const upsertResult = await linkRepo.upsertSuggestion(
            fromVenue as Venue,
            leftMarket.id,
            toVenue as Venue,
            candidate.rightMarket.market.id,
            candidate.score,
            candidate.reason,
            algoVersion
          );

          if (upsertResult.created) {
            result.suggestionsCreated++;
          } else {
            result.suggestionsUpdated++;
          }

          // Track matched entities
          if (leftIntraday.signals.entity) {
            intradayStats.matchedByEntity.set(
              leftIntraday.signals.entity,
              (intradayStats.matchedByEntity.get(leftIntraday.signals.entity) || 0) + 1
            );
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Failed to save suggestion for ${leftMarket.id}: ${errMsg}`);
        }
      }

      processed++;
      if (processed % 100 === 0) {
        console.log(`[intraday-matching] Processed ${processed}/${leftMarkets.length - confirmedLeft.size} markets...`);
      }
    }

    // Print summary
    console.log(`\n[intraday-matching] Suggest-matches v2.6.2 complete:`);
    console.log(`  Left markets (${fromVenue}): ${result.leftCount}`);
    console.log(`  Right markets (${toVenue}): ${result.rightCount}`);
    console.log(`  Skipped (already confirmed): ${result.skippedConfirmed}`);
    console.log(`  Skipped (entity/bucket gate): ${result.skippedDateGate}`);
    console.log(`  Candidates considered: ${result.candidatesConsidered}`);
    console.log(`  Generated pairs (score >= ${minScore}): ${result.generatedPairsTotal}`);
    console.log(`  Dropped by left-cap (max ${effectiveCap}): ${result.droppedByCapTotal}`);
    console.log(`  Dropped by right-cap (max ${maxPerRight}): ${result.droppedByRightCap}`);
    console.log(`  Saved after dedup: ${result.savedTopKTotal}`);
    console.log(`  Suggestions created: ${result.suggestionsCreated}`);
    console.log(`  Suggestions updated: ${result.suggestionsUpdated}`);

    if (result.errors.length > 0) {
      console.log(`  Errors: ${result.errors.length}`);
    }

    // Intraday coverage report
    console.log(`\n[intraday-coverage] Intraday Entity Coverage Report:`);
    console.log(`${'Entity'.padEnd(12)} | ${'Left'.padStart(6)} | ${'Right'.padStart(6)} | ${'Matched'.padStart(8)} | ${'Rate'.padStart(6)}`);
    console.log('-'.repeat(48));

    let totalLeft = 0;
    let totalMatched = 0;

    for (const entity of ['BTC', 'ETH']) {
      const left = intradayStats.leftByEntity.get(entity) || 0;
      const right = intradayStats.rightByEntity.get(entity) || 0;
      const matched = intradayStats.matchedByEntity.get(entity) || 0;
      const rate = left > 0 ? ((matched / left) * 100).toFixed(1) + '%' : 'N/A';

      console.log(`${entity.padEnd(12)} | ${String(left).padStart(6)} | ${String(right).padStart(6)} | ${String(matched).padStart(8)} | ${rate.padStart(6)}`);

      totalLeft += left;
      totalMatched += matched;
    }

    console.log('-'.repeat(48));
    const totalRate = totalLeft > 0 ? ((totalMatched / totalLeft) * 100).toFixed(1) + '%' : 'N/A';
    console.log(`${'TOTAL'.padEnd(12)} | ${String(totalLeft).padStart(6)} | ${String('').padStart(6)} | ${String(totalMatched).padStart(8)} | ${totalRate.padStart(6)}`);

    // Top time buckets with overlap
    console.log(`\n[intraday-coverage] Top TimeBuckets with overlap:`);
    const leftBuckets = [...intradayStats.leftByBucket.entries()].sort((a, b) => b[1] - a[1]);
    const rightBucketsSet = new Set(intradayStats.rightByBucket.keys());
    let shownBuckets = 0;
    for (const [bucket, leftCount] of leftBuckets) {
      if (rightBucketsSet.has(bucket) && shownBuckets < 10) {
        const rightCount = intradayStats.rightByBucket.get(bucket) || 0;
        console.log(`  ${bucket}: ${leftCount} ${fromVenue} × ${rightCount} ${toVenue}`);
        shownBuckets++;
      }
    }
    if (shownBuckets === 0) {
      console.log(`  No bucket overlap found`);
    }

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    result.errors.push(`Intraday matching error: ${errMsg}`);
    console.error(`[intraday-matching] Error: ${errMsg}`);
  }

  return result;
}

/**
 * Crypto-specific matching flow (v2.5.3)
 *
 * Uses dedicated crypto pipeline:
 * - fetchEligibleCryptoMarkets with regex-based DB search for tickers
 * - buildCryptoIndex keyed by entity + settleDate
 * - findCryptoCandidates with ±1 day window
 * - cryptoMatchScore with hard gates (entity match, date within ±1 day)
 *
 * v2.5.3 Dedup/caps:
 * - --max-per-left: limit suggestions per left market (default 3)
 * - --max-per-right: limit per (rightId, entity, settleKey) (default 5)
 * - --winner-gap: if top1 - top2 >= gap, keep only top1 (default 0.08)
 */
async function runCryptoSuggestMatches(options: CryptoSuggestMatchesOptions): Promise<SuggestMatchesResult> {
  const {
    fromVenue,
    toVenue,
    minScore,
    topK,
    lookbackHours,
    limitLeft,
    limitRight,
    maxSuggestionsPerLeft,
    excludeSports,
    maxPerRight,
    winnerGap,
    maxGroupsPerLeft,
    maxLinesPerGroup,
    excludeIntraday,
    algoVersion,
    marketRepo,
    linkRepo,
    result,
  } = options;

  const useBracketGrouping = maxGroupsPerLeft > 0 && maxLinesPerGroup > 0;

  console.log(`[crypto-matching] Starting suggest-matches v2.6.2: ${fromVenue} -> ${toVenue}`);
  console.log(`[crypto-matching] minScore=${minScore}, topK=${topK}, lookbackHours=${lookbackHours}, algoVersion=${algoVersion}`);
  console.log(`[crypto-matching] limitLeft=${limitLeft}, limitRight=${limitRight}, maxSuggestionsPerLeft=${maxSuggestionsPerLeft}`);
  console.log(`[crypto-matching] maxPerRight=${maxPerRight}, winnerGap=${winnerGap} (v2.5.3 dedup)`);
  if (useBracketGrouping) {
    console.log(`[crypto-matching] Bracket grouping (v2.6.0): maxGroups=${maxGroupsPerLeft}, maxLines=${maxLinesPerGroup}`);
  }
  console.log(`[crypto-matching] Entities: ${CRYPTO_ENTITIES_V1.join(', ')}`);
  console.log(`[crypto-matching] Sports exclusion: ${excludeSports ? 'enabled' : 'disabled'}`);
  console.log(`[crypto-matching] Intraday exclusion (v2.6.2): ${excludeIntraday ? 'enabled' : 'disabled'}`);

  try {
    // Fetch crypto markets from both venues
    console.log(`[crypto-matching] Fetching crypto markets from ${fromVenue}...`);
    const { markets: leftMarkets, stats: leftStats } = await fetchEligibleCryptoMarkets(marketRepo, {
      venue: fromVenue,
      lookbackHours,
      limit: limitLeft,
      entities: CRYPTO_ENTITIES_V1,
      excludeSports,
      excludeIntraday,
    });
    result.leftCount = leftMarkets.length;
    console.log(`[crypto-matching] ${fromVenue}: ${leftStats.total} DB -> ${leftStats.afterSportsFilter} (sports) -> ${leftStats.afterIntradayFilter} (intraday) -> ${leftStats.withCryptoEntity} (entity) [${leftStats.withSettleDate} with date]`);

    console.log(`[crypto-matching] Fetching crypto markets from ${toVenue}...`);
    const { markets: rightMarkets, stats: rightStats } = await fetchEligibleCryptoMarkets(marketRepo, {
      venue: toVenue,
      lookbackHours,
      limit: limitRight,
      entities: CRYPTO_ENTITIES_V1,
      excludeSports,
      excludeIntraday,
    });
    result.rightCount = rightMarkets.length;
    console.log(`[crypto-matching] ${toVenue}: ${rightStats.total} DB -> ${rightStats.afterSportsFilter} (sports) -> ${rightStats.afterIntradayFilter} (intraday) -> ${rightStats.withCryptoEntity} (entity) [${rightStats.withSettleDate} with date]`);

    if (leftMarkets.length === 0 || rightMarkets.length === 0) {
      console.log(`[crypto-matching] No markets to match`);
      return result;
    }

    // Build crypto index for right markets
    console.log(`[crypto-matching] Building crypto index for ${toVenue}...`);
    const cryptoIndex = buildCryptoIndex(rightMarkets);
    console.log(`[crypto-matching] Index built: ${cryptoIndex.size} unique entity+date keys`);

    // Get set of markets that already have confirmed links
    const confirmedLeft = new Set<number>();
    for (const { market } of leftMarkets) {
      const hasConfirmed = await linkRepo.hasConfirmedLink(fromVenue as Venue, market.id);
      if (hasConfirmed) {
        confirmedLeft.add(market.id);
      }
    }
    console.log(`[crypto-matching] ${confirmedLeft.size} markets from ${fromVenue} already have confirmed links`);

    // Crypto coverage tracking
    const cryptoStats = {
      leftByEntity: new Map<string, number>(),
      rightByEntity: new Map<string, number>(),
      matchedByEntity: new Map<string, number>(),
      leftBySettleDate: new Map<string, number>(),
      rightBySettleDate: new Map<string, number>(),
    };

    // Build right-side entity counts
    for (const { signals } of rightMarkets) {
      if (signals.entity) {
        cryptoStats.rightByEntity.set(signals.entity, (cryptoStats.rightByEntity.get(signals.entity) || 0) + 1);
      }
      if (signals.settleDate) {
        cryptoStats.rightBySettleDate.set(signals.settleDate, (cryptoStats.rightBySettleDate.get(signals.settleDate) || 0) + 1);
      }
    }

    // v2.5.3: Track right-side usage for dedup
    // Key: "rightId|entity|settleKey" -> count of suggestions using this right market
    const rightUsage = new Map<string, number>();

    // v2.5.3: Dedup stats
    const dedupStats: CryptoDedupStats = {
      generatedPairs: 0,
      savedTopK: 0,
      droppedByLeftCap: 0,
      droppedByRightCap: 0,
      droppedByWinnerGap: 0,
      bracketStats: null,
    };

    // v2.6.0: Aggregate bracket stats
    const aggregateBracketStats: BracketStats = {
      totalCandidates: 0,
      uniqueGroups: 0,
      savedCandidates: 0,
      droppedByGroupLimit: 0,
      droppedWithinGroups: 0,
    };

    // Process each left market
    console.log(`[crypto-matching] Processing matches...`);
    let processed = 0;
    const effectiveCap = Math.min(topK, maxSuggestionsPerLeft);

    for (const leftCrypto of leftMarkets) {
      const leftMarket = leftCrypto.market;

      // Skip if already has confirmed link
      if (confirmedLeft.has(leftMarket.id)) {
        result.skippedConfirmed++;
        continue;
      }

      // Track left-side entity
      if (leftCrypto.signals.entity) {
        cryptoStats.leftByEntity.set(leftCrypto.signals.entity, (cryptoStats.leftByEntity.get(leftCrypto.signals.entity) || 0) + 1);
      }
      if (leftCrypto.signals.settleDate) {
        cryptoStats.leftBySettleDate.set(leftCrypto.signals.settleDate, (cryptoStats.leftBySettleDate.get(leftCrypto.signals.settleDate) || 0) + 1);
      }

      // Find candidates using crypto index (same entity, settleDate ±1 day)
      const candidates = findCryptoCandidates(leftCrypto, cryptoIndex, true);
      result.candidatesConsidered += candidates.length;

      // Score candidates
      const scores: Array<{
        rightMarket: CryptoMarket;
        score: number;
        reason: string;
        entity: string;
        settleKey: string;
        scoreResult: CryptoScoreResult;
      }> = [];

      for (const rightCrypto of candidates) {
        // Skip self-match
        if (rightCrypto.market.id === leftMarket.id) continue;

        // v2.6.1: Check market type compatibility (INTRADAY_UPDOWN excluded)
        if (!areMarketTypesCompatible(leftCrypto.signals.marketType, rightCrypto.signals.marketType)) {
          result.skippedTypeGate++;
          continue;
        }

        // Calculate crypto score (includes hard gates)
        const scoreResult = cryptoMatchScore(leftCrypto, rightCrypto);

        // null means gate failed
        if (!scoreResult) {
          result.skippedDateGate++; // entity or date gate
          continue;
        }

        if (scoreResult.score >= minScore) {
          // v2.5.3: Build settle key for right-side cap
          const entity = rightCrypto.signals.entity || 'UNKNOWN';
          const settleKey = rightCrypto.signals.settlePeriod || rightCrypto.signals.settleDate || 'UNKNOWN';

          scores.push({
            rightMarket: rightCrypto,
            score: scoreResult.score,
            reason: scoreResult.reason,
            entity,
            settleKey,
            scoreResult,
          });
        }
      }

      // Sort by score descending
      scores.sort((a, b) => b.score - a.score);

      // Track generated pairs before any caps
      dedupStats.generatedPairs += scores.length;

      // v2.6.0: Apply bracket grouping if enabled
      let processedCandidates: Array<{ rightMarket: CryptoMarket; score: number; reason: string; entity: string; settleKey: string }>;

      if (useBracketGrouping && scores.length > 0) {
        // Convert to BracketCandidate format
        const bracketCandidates: BracketCandidate[] = scores.map(s => ({
          leftCrypto,
          rightCrypto: s.rightMarket,
          score: s.score,
          scoreResult: s.scoreResult,
          bracketKey: buildBracketKey(s.entity, s.settleKey, s.rightMarket.signals.comparator),
        }));

        // Apply bracket grouping
        const { result: grouped, stats: bracketStats } = applyBracketGrouping(bracketCandidates, {
          maxGroupsPerLeft,
          maxLinesPerGroup,
          representativeStrategy: 'best_score',
        });

        // Update aggregate bracket stats
        aggregateBracketStats.totalCandidates += bracketStats.totalCandidates;
        aggregateBracketStats.uniqueGroups += bracketStats.uniqueGroups;
        aggregateBracketStats.savedCandidates += bracketStats.savedCandidates;
        aggregateBracketStats.droppedByGroupLimit += bracketStats.droppedByGroupLimit;
        aggregateBracketStats.droppedWithinGroups += bracketStats.droppedWithinGroups;

        // Convert back to our format
        processedCandidates = grouped.map(g => ({
          rightMarket: g.rightCrypto,
          score: g.score,
          reason: g.scoreResult.reason,
          entity: g.rightCrypto.signals.entity || 'UNKNOWN',
          settleKey: g.rightCrypto.signals.settlePeriod || g.rightCrypto.signals.settleDate || 'UNKNOWN',
        }));
      } else {
        // v2.5.3: Apply winner-gap logic (only when bracket grouping is disabled)
        let winnowedScores = scores;
        if (scores.length >= 2 && winnerGap > 0) {
          const gap = scores[0].score - scores[1].score;
          if (gap >= winnerGap) {
            dedupStats.droppedByWinnerGap += scores.length - 1;
            winnowedScores = [scores[0]];
          }
        }

        // Apply left cap
        const afterLeftCap = winnowedScores.slice(0, effectiveCap);
        dedupStats.droppedByLeftCap += winnowedScores.length - afterLeftCap.length;

        processedCandidates = afterLeftCap;
      }

      // v2.5.3: Apply right-side cap per (rightId, entity, settleKey)
      const finalCandidates: typeof processedCandidates = [];
      for (const candidate of processedCandidates) {
        const rightKey = `${candidate.rightMarket.market.id}|${candidate.entity}|${candidate.settleKey}`;
        const currentUsage = rightUsage.get(rightKey) || 0;

        if (currentUsage < maxPerRight) {
          finalCandidates.push(candidate);
          rightUsage.set(rightKey, currentUsage + 1);
        } else {
          dedupStats.droppedByRightCap++;
        }
      }

      dedupStats.savedTopK += finalCandidates.length;

      // Track stats (legacy)
      result.generatedPairsTotal += scores.length;
      result.savedTopKTotal += finalCandidates.length;
      result.droppedByCapTotal += Math.max(0, scores.length - finalCandidates.length);

      // Save suggestions
      for (const candidate of finalCandidates) {
        try {
          const upsertResult = await linkRepo.upsertSuggestion(
            fromVenue as Venue,
            leftMarket.id,
            toVenue as Venue,
            candidate.rightMarket.market.id,
            candidate.score,
            candidate.reason,
            algoVersion
          );

          if (upsertResult.created) {
            result.suggestionsCreated++;
          } else {
            result.suggestionsUpdated++;
          }

          // Track matched entities
          if (leftCrypto.signals.entity) {
            cryptoStats.matchedByEntity.set(
              leftCrypto.signals.entity,
              (cryptoStats.matchedByEntity.get(leftCrypto.signals.entity) || 0) + 1
            );
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Failed to save suggestion for ${leftMarket.id}: ${errMsg}`);
        }
      }

      processed++;
      if (processed % 100 === 0) {
        console.log(`[crypto-matching] Processed ${processed}/${leftMarkets.length - confirmedLeft.size} markets...`);
      }
    }

    // Print summary
    console.log(`\n[crypto-matching] Suggest-matches v2.5.3 complete:`);
    console.log(`  Left markets (${fromVenue}): ${result.leftCount}`);
    console.log(`  Right markets (${toVenue}): ${result.rightCount}`);
    console.log(`  Skipped (already confirmed): ${result.skippedConfirmed}`);
    console.log(`  Skipped (entity/date gate): ${result.skippedDateGate}`);
    console.log(`  Candidates considered: ${result.candidatesConsidered}`);
    console.log(`  Generated pairs (score >= ${minScore}): ${dedupStats.generatedPairs}`);
    console.log(`  [v2.5.3 Dedup Stats]`);
    if (useBracketGrouping) {
      console.log(`  v2.6.0 Bracket Grouping Stats:`);
      console.log(`    Total candidates: ${aggregateBracketStats.totalCandidates}`);
      console.log(`    Unique bracket groups: ${aggregateBracketStats.uniqueGroups}`);
      console.log(`    Dropped by group limit: ${aggregateBracketStats.droppedByGroupLimit}`);
      console.log(`    Dropped within groups: ${aggregateBracketStats.droppedWithinGroups}`);
      console.log(`    Saved from brackets: ${aggregateBracketStats.savedCandidates}`);
    } else {
      console.log(`    Dropped by winner-gap (>=${winnerGap}): ${dedupStats.droppedByWinnerGap}`);
      console.log(`    Dropped by left-cap (max ${effectiveCap}): ${dedupStats.droppedByLeftCap}`);
    }
    console.log(`    Dropped by right-cap (max ${maxPerRight}/key): ${dedupStats.droppedByRightCap}`);
    console.log(`    Saved after dedup: ${dedupStats.savedTopK}`);
    console.log(`  Suggestions created: ${result.suggestionsCreated}`);
    console.log(`  Suggestions updated: ${result.suggestionsUpdated}`);

    if (result.errors.length > 0) {
      console.log(`  Errors: ${result.errors.length}`);
    }

    // Crypto coverage report
    console.log(`\n[crypto-coverage] Crypto Entity Coverage Report:`);
    console.log(`${'Entity'.padEnd(12)} | ${'Left'.padStart(6)} | ${'Right'.padStart(6)} | ${'Matched'.padStart(8)} | ${'Rate'.padStart(6)}`);
    console.log('-'.repeat(48));

    let totalLeft = 0;
    let totalMatched = 0;

    for (const entity of CRYPTO_ENTITIES_V1) {
      const left = cryptoStats.leftByEntity.get(entity) || 0;
      const right = cryptoStats.rightByEntity.get(entity) || 0;
      const matched = cryptoStats.matchedByEntity.get(entity) || 0;
      const rate = left > 0 ? ((matched / left) * 100).toFixed(1) + '%' : 'N/A';

      console.log(`${entity.padEnd(12)} | ${String(left).padStart(6)} | ${String(right).padStart(6)} | ${String(matched).padStart(8)} | ${rate.padStart(6)}`);

      totalLeft += left;
      totalMatched += matched;
    }

    console.log('-'.repeat(48));
    const totalRate = totalLeft > 0 ? ((totalMatched / totalLeft) * 100).toFixed(1) + '%' : 'N/A';
    console.log(`${'TOTAL'.padEnd(12)} | ${String(totalLeft).padStart(6)} | ${String('').padStart(6)} | ${String(totalMatched).padStart(8)} | ${totalRate.padStart(6)}`);

    // Top settle dates with overlap
    console.log(`\n[crypto-coverage] Top SettleDates with overlap:`);
    const leftDates = [...cryptoStats.leftBySettleDate.entries()].sort((a, b) => b[1] - a[1]);
    const rightDatesSet = new Set(cryptoStats.rightBySettleDate.keys());
    let shownDates = 0;
    for (const [date, leftCount] of leftDates) {
      if (rightDatesSet.has(date) && shownDates < 10) {
        const rightCount = cryptoStats.rightBySettleDate.get(date) || 0;
        console.log(`  ${date}: ${leftCount} ${fromVenue} × ${rightCount} ${toVenue}`);
        shownDates++;
      }
    }
    if (shownDates === 0) {
      console.log(`  No date overlap found`);
    }

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    result.errors.push(`Crypto matching error: ${errMsg}`);
    console.error(`[crypto-matching] Error: ${errMsg}`);
  }

  return result;
}

export async function runSuggestMatches(options: SuggestMatchesOptions): Promise<SuggestMatchesResult> {
  // Defaults for macro year window
  const currentYear = new Date().getFullYear();
  const defaultMacroMinYear = currentYear - 1; // e.g., 2025 when running in 2026
  const defaultMacroMaxYear = currentYear + 1; // e.g., 2027 when running in 2026

  const {
    fromVenue,
    toVenue,
    minScore = 0.6,  // Raised from 0.55 for better quality
    topK = 10,
    lookbackHours = 24,
    limitLeft = 2000,
    limitRight = 20000,
    debugMarketId,
    requireOverlapKeywords = true,
    // Topic filter - 'all' by default for backwards compatibility
    topic = 'all',
    // Sports exclusion options - enabled by default
    excludeSports = true,
    excludeKalshiPrefixes = excludeSports ? KALSHI_SPORTS_PREFIXES : [],
    excludeTitleKeywords = excludeSports ? SPORTS_TITLE_KEYWORDS : [],
    // Macro year window (v2.4.1) - only applied when topic=macro
    macroMinYear = defaultMacroMinYear,
    macroMaxYear = defaultMacroMaxYear,
    // Cap suggestions per left market (v2.4.2) - ENV overridable
    maxSuggestionsPerLeft = parseInt(process.env.MAX_SUGGESTIONS_PER_LEFT || '5', 10),
    // Guardrail for cross-granularity period matches (v2.4.3) - limits year↔month explosion
    maxCrossGranularityPerLeft = parseInt(process.env.MAX_CROSS_GRANULARITY_PER_LEFT || '2', 10),
    // Extended lookback for rare entities (v2.4.3) - ENV overridable
    rareEntityLookbackHours = parseInt(process.env.RARE_ENTITY_LOOKBACK_HOURS || String(RARE_ENTITY_DEFAULT_LOOKBACK_HOURS), 10),
    // Right-side cap per entity-period bucket (v2.4.5) - controls many-to-one explosion
    maxPerRightPerEntityPeriod = parseInt(process.env.MAX_PER_RIGHT_PER_ENTITY_PERIOD || '8', 10),
  } = options;

  // v2.4.5: Use topic-specific keywords for DB query filtering
  // This prevents mixed keyword lists from pushing out relevant markets
  // (e.g., politics markets with 2045 close dates pushing out macro markets)
  const targetKeywords = topic !== 'all' && TOPIC_KEYWORDS[topic]
    ? TOPIC_KEYWORDS[topic]
    : MATCHING_KEYWORDS;

  // Handle debug mode - uses the same unified pipeline as full run
  if (debugMarketId !== undefined) {
    await debugMarket(debugMarketId, fromVenue, toVenue, {
      lookbackHours,
      limitLeft,
      limitRight,
      targetKeywords,
      topic,
      excludeSports,
      excludeKalshiPrefixes,
      excludeTitleKeywords,
    });
    return {
      leftCount: 0,
      rightCount: 0,
      candidatesConsidered: 0,
      suggestionsCreated: 0,
      suggestionsUpdated: 0,
      skippedConfirmed: 0,
      skippedNoOverlap: 0,
      skippedDateGate: 0,
      skippedTextGate: 0,
      skippedPeriodGate: 0,
      skippedTypeGate: 0,
      generatedPairsTotal: 0,
      savedTopKTotal: 0,
      droppedByCapTotal: 0,
      droppedByCrossGranularityCap: 0,
      droppedByRightCap: 0,
      errors: [],
    };
  }

  const prisma = getClient();
  const marketRepo = new MarketRepository(prisma);
  const linkRepo = new MarketLinkRepository(prisma);

  const result: SuggestMatchesResult = {
    leftCount: 0,
    rightCount: 0,
    candidatesConsidered: 0,
    suggestionsCreated: 0,
    suggestionsUpdated: 0,
    skippedConfirmed: 0,
    skippedNoOverlap: 0,
    skippedDateGate: 0,
    skippedTextGate: 0,
    skippedPeriodGate: 0,
    skippedTypeGate: 0,
    generatedPairsTotal: 0,
    savedTopKTotal: 0,
    droppedByCapTotal: 0,
    droppedByCrossGranularityCap: 0,
    droppedByRightCap: 0,
    errors: [],
  };

  // ============================================================
  // v2.6.2: Crypto-specific matching paths (daily/intraday split)
  // ============================================================
  // Topic variants:
  // - 'crypto': Original behavior (includes both daily and intraday)
  // - 'crypto_daily': Excludes intraday markets (RECOMMENDED for matching)
  // - 'crypto_intraday': Only intraday markets (separate matching pool)
  if (topic === 'crypto' || topic === 'crypto_daily' || topic === 'crypto_intraday') {
    // v2.5.3/v2.6.0: Crypto dedup/caps options (ENV overridable)
    const cryptoMaxPerRight = parseInt(process.env.CRYPTO_MAX_PER_RIGHT || '5', 10);
    const cryptoWinnerGap = parseFloat(process.env.CRYPTO_WINNER_GAP || '0.08');
    // v2.6.0: Bracket grouping options (set to 0 to disable)
    const cryptoMaxGroupsPerLeft = parseInt(process.env.CRYPTO_MAX_GROUPS_PER_LEFT || '3', 10);
    const cryptoMaxLinesPerGroup = parseInt(process.env.CRYPTO_MAX_LINES_PER_GROUP || '1', 10);

    // v2.6.2: Determine intraday exclusion based on topic
    // - crypto_daily: excludeIntraday=true (filter out INTRADAY_UPDOWN)
    // - crypto_intraday: NOT SUPPORTED YET - would need separate pipeline
    // - crypto: excludeIntraday=false (backward compatible, includes all)
    const excludeIntraday = topic === 'crypto_daily';

    // v2.6.3: Separate intraday pipeline for INTRADAY_UPDOWN markets
    // Uses time bucket matching with configurable slot size (default 15m)
    if (topic === 'crypto_intraday') {
      // v2.6.3: Use CRYPTO_INTRADAY_BUCKET_MIN for slot size (default 15 minutes)
      const bucketMinutes = parseInt(process.env.CRYPTO_INTRADAY_BUCKET_MIN || '15', 10);
      const slotSizeMap: Record<number, IntradaySlotSize> = {
        15: '15m',
        30: '30m',
        60: '1h',
        120: '2h',
        240: '4h',
      };
      const intradaySlotSize = slotSizeMap[bucketMinutes] || '15m';
      const intradayMaxPerRight = parseInt(process.env.INTRADAY_MAX_PER_RIGHT || '3', 10);
      const intradayMaxPerLeft = parseInt(process.env.INTRADAY_MAX_PER_LEFT || '3', 10);

      return await runIntradaySuggestMatches({
        fromVenue,
        toVenue,
        minScore,
        topK,
        lookbackHours,
        limitLeft,
        limitRight,
        maxSuggestionsPerLeft: intradayMaxPerLeft,
        excludeSports,
        maxPerRight: intradayMaxPerRight,
        slotSize: intradaySlotSize,
        algoVersion: 'crypto_intraday@2.6.3',
        marketRepo,
        linkRepo,
        result,
      });
    }

    // v2.6.2: algoVersion for crypto_daily or crypto (backward compat)
    const cryptoAlgoVersion = topic === 'crypto_daily' ? 'crypto_daily@2.6.2' : 'crypto@2.6.2';

    return await runCryptoSuggestMatches({
      fromVenue,
      toVenue,
      minScore,
      topK,
      lookbackHours,
      limitLeft,
      limitRight,
      maxSuggestionsPerLeft: parseInt(process.env.CRYPTO_MAX_PER_LEFT || '3', 10),
      excludeSports,
      maxPerRight: cryptoMaxPerRight,
      winnerGap: cryptoWinnerGap,
      maxGroupsPerLeft: cryptoMaxGroupsPerLeft,
      maxLinesPerGroup: cryptoMaxLinesPerGroup,
      excludeIntraday,
      algoVersion: cryptoAlgoVersion,
      marketRepo,
      linkRepo,
      result,
    });
  }

  // v2.4.5: Use closeTime ordering for macro to include old active markets
  const orderBy = topic === 'macro' ? 'closeTime' as const : 'id' as const;

  // v2.6.2: algoVersion for tracking
  const algoVersion = topic !== 'all' ? `${topic}@2.6.2` : 'all@2.6.2';

  console.log(`[matching] Starting suggest-matches v2.4.5: ${fromVenue} -> ${toVenue}`);
  console.log(`[matching] minScore=${minScore}, topK=${topK}, lookbackHours=${lookbackHours}, limitLeft=${limitLeft}, limitRight=${limitRight}, requireOverlap=${requireOverlapKeywords}`);
  console.log(`[matching] Topic filter: ${topic}`);
  if (topic === 'macro') {
    console.log(`[matching] Macro year window: ${macroMinYear}-${macroMaxYear}`);
    console.log(`[matching] Order by: ${orderBy} (v2.4.5: includes old active markets)`);
  }
  console.log(`[matching] Target keywords: ${targetKeywords.slice(0, 10).join(', ')}${targetKeywords.length > 10 ? '...' : ''}`);
  console.log(`[matching] Sports exclusion: ${excludeSports ? 'enabled' : 'disabled'} (prefixes: ${excludeKalshiPrefixes.length}, keywords: ${excludeTitleKeywords.length})`);
  console.log(`[matching] Max suggestions per left market: ${maxSuggestionsPerLeft}`);
  console.log(`[matching] Max cross-granularity per left (v2.4.3): ${maxCrossGranularityPerLeft}`);
  if (topic === 'macro') {
    console.log(`[matching] Max per right market per entity-period (v2.4.5): ${maxPerRightPerEntityPeriod}`);
  }
  if (topic === 'macro') {
    console.log(`[matching] Rare entity extended lookback (v2.4.3): ${rareEntityLookbackHours}h`);
  }

  try {
    // Fetch eligible markets from both venues using unified pipeline
    console.log(`[matching] Fetching eligible markets from ${fromVenue}...`);
    const { markets: leftMarkets, stats: leftStats } = await fetchEligibleMarkets(marketRepo, {
      venue: fromVenue,
      lookbackHours,
      limit: limitLeft,
      targetKeywords,
      topic,
      excludeSports,
      excludeKalshiPrefixes,
      excludeTitleKeywords,
      macroMinYear,
      macroMaxYear,
      rareEntityLookbackHours,
      orderBy,
    });
    result.leftCount = leftMarkets.length;
    if (topic === 'macro') {
      console.log(`[matching] ${fromVenue}: ${leftStats.total} -> ${leftStats.afterKeywordFilter} (kw) -> ${leftStats.afterSportsFilter} (sports) -> ${leftStats.afterTopicFilter} (topic) -> ${leftStats.afterMacroYearFilter} (year)`);
      if (leftStats.macroExcludedYearLow > 0 || leftStats.macroExcludedYearHigh > 0 || leftStats.macroExcludedNoYear > 0) {
        console.log(`[matching]   year filter: excluded ${leftStats.macroExcludedYearLow} (year<${macroMinYear}), ${leftStats.macroExcludedYearHigh} (year>${macroMaxYear}), ${leftStats.macroExcludedNoYear} (no year)`);
      }
      if (leftStats.rareEntityMarketsAdded > 0) {
        console.log(`[matching]   rare entity lookback (v2.4.3): +${leftStats.rareEntityMarketsAdded} markets added`);
      }
    } else {
      console.log(`[matching] ${fromVenue}: ${leftStats.total} -> ${leftStats.afterKeywordFilter} (kw) -> ${leftStats.afterSportsFilter} (sports) -> ${leftStats.afterTopicFilter} (topic)`);
    }

    console.log(`[matching] Fetching eligible markets from ${toVenue}...`);
    const { markets: rightMarkets, stats: rightStats } = await fetchEligibleMarkets(marketRepo, {
      venue: toVenue,
      lookbackHours,
      limit: limitRight,
      targetKeywords,
      topic,
      excludeSports,
      excludeKalshiPrefixes,
      excludeTitleKeywords,
      macroMinYear,
      macroMaxYear,
      rareEntityLookbackHours,
      orderBy,
    });
    result.rightCount = rightMarkets.length;
    if (topic === 'macro') {
      console.log(`[matching] ${toVenue}: ${rightStats.total} -> ${rightStats.afterKeywordFilter} (kw) -> ${rightStats.afterSportsFilter} (sports) -> ${rightStats.afterTopicFilter} (topic) -> ${rightStats.afterMacroYearFilter} (year)`);
      if (rightStats.macroExcludedYearLow > 0 || rightStats.macroExcludedYearHigh > 0 || rightStats.macroExcludedNoYear > 0) {
        console.log(`[matching]   year filter: excluded ${rightStats.macroExcludedYearLow} (year<${macroMinYear}), ${rightStats.macroExcludedYearHigh} (year>${macroMaxYear}), ${rightStats.macroExcludedNoYear} (no year)`);
      }
      if (rightStats.rareEntityMarketsAdded > 0) {
        console.log(`[matching]   rare entity lookback (v2.4.3): +${rightStats.rareEntityMarketsAdded} markets added`);
      }
    } else {
      console.log(`[matching] ${toVenue}: ${rightStats.total} -> ${rightStats.afterKeywordFilter} (kw) -> ${rightStats.afterSportsFilter} (sports) -> ${rightStats.afterTopicFilter} (topic)`);
    }

    if (leftMarkets.length === 0 || rightMarkets.length === 0) {
      console.log(`[matching] No markets to match`);
      return result;
    }

    // Build entity-based index for right markets
    // Use macro-specific index for topic=macro
    const isMacroTopic = topic === 'macro';
    console.log(`[matching] Building ${isMacroTopic ? 'macro entity+period' : 'entity'} index for ${toVenue}...`);
    const index = isMacroTopic
      ? buildMacroEntityIndex(rightMarkets)
      : buildEntityIndex(rightMarkets);

    if (isMacroTopic) {
      const macroIndex = index as MacroEntityIndex;
      console.log(`[matching] Macro index built: ${macroIndex.byMacroEntityPeriod.size} entity+period keys, ${index.byEntity.size} entities, ${index.byYear.size} years`);
    } else {
      console.log(`[matching] Index built: ${index.byEntity.size} unique entities, ${index.byYear.size} years`);
    }

    // Get set of markets that already have confirmed links
    const confirmedLeft = new Set<number>();
    for (const market of leftMarkets) {
      const hasConfirmed = await linkRepo.hasConfirmedLink(fromVenue as Venue, market.id);
      if (hasConfirmed) {
        confirmedLeft.add(market.id);
      }
    }
    console.log(`[matching] ${confirmedLeft.size} markets from ${fromVenue} already have confirmed links`);

    // Process each left market
    console.log(`[matching] Processing matches...`);
    let processed = 0;
    let noEntityCount = 0;

    // Macro coverage tracking
    const macroStats = {
      leftByEntity: new Map<string, number>(),
      rightByEntity: new Map<string, number>(),
      matchedByEntity: new Map<string, number>(),
      unmatchedMarkets: [] as { id: number; title: string; macroEntities: string[]; period: string }[],
      // Period compatibility stats (v2.4.3)
      periodKindCounts: new Map<PeriodCompatibilityKind, number>(),
    };

    // Build right-side macro entity counts (from index)
    if (isMacroTopic) {
      for (const [, indexed] of index.markets) {
        if (indexed.fingerprint.macroEntities?.size) {
          for (const entity of indexed.fingerprint.macroEntities) {
            macroStats.rightByEntity.set(entity, (macroStats.rightByEntity.get(entity) || 0) + 1);
          }
        }
      }
    }

    // v2.4.5: Right-side cap tracker (per entity-period bucket)
    // Tracks how many suggestions we've saved for each (rightId, entity, periodBucket)
    const rightCapTracker = new Map<string, number>();

    for (const leftMarket of leftMarkets) {
      // Skip if already has confirmed link
      if (confirmedLeft.has(leftMarket.id)) {
        result.skippedConfirmed++;
        continue;
      }

      const leftFingerprint = buildFingerprint(leftMarket.title, leftMarket.closeTime, { metadata: leftMarket.metadata });
      const leftIndexed: IndexedMarket = {
        market: leftMarket,
        fingerprint: leftFingerprint,
        normalizedTitle: normalizeTitleForFuzzy(leftMarket.title),
      };

      // Track markets with no entities
      if (leftFingerprint.entities.length === 0) {
        noEntityCount++;
      }

      // Track left-side macro entities
      if (isMacroTopic && leftFingerprint.macroEntities?.size) {
        for (const entity of leftFingerprint.macroEntities) {
          macroStats.leftByEntity.set(entity, (macroStats.leftByEntity.get(entity) || 0) + 1);
        }
      }

      // Find candidates using appropriate index
      // Use macro candidates for topic=macro or MACRO_PERIOD intent
      const useMacroMatching = isMacroTopic || leftFingerprint.intent === MarketIntent.MACRO_PERIOD;
      const candidateIds = useMacroMatching && isMacroTopic
        ? findMacroCandidates(leftFingerprint, leftMarket.closeTime, index as MacroEntityIndex, 200)
        : findCandidatesByEntity(leftFingerprint, leftMarket.closeTime, index, 500);
      result.candidatesConsidered += candidateIds.size;

      // Score candidates and find top-k
      const scores: Array<{ rightId: number; score: number; reason: string; periodKind?: PeriodCompatibilityKind }> = [];

      for (const rightId of candidateIds) {
        const rightIndexed = index.markets.get(rightId);
        if (!rightIndexed) continue;

        // Skip if no keyword overlap (prefilter)
        if (requireOverlapKeywords) {
          if (!hasKeywordOverlap(leftMarket.title, rightIndexed.market.title)) {
            result.skippedNoOverlap++;
            continue;
          }
        }

        const matchResult = calculateMatchScore(leftIndexed, rightIndexed);

        // Track date gate failures
        if (matchResult.dateGateFailed) {
          result.skippedDateGate++;
          continue;
        }

        // Track text gate failures
        if (matchResult.textGateFailed) {
          result.skippedTextGate++;
          continue;
        }

        // Track period gate failures
        if (matchResult.periodGateFailed) {
          result.skippedPeriodGate++;
          continue;
        }

        if (matchResult.score >= minScore) {
          scores.push({
            rightId,
            score: matchResult.score,
            reason: matchResult.reason,
            periodKind: matchResult.periodKind,
          });
        }
      }

      // Sort by score and take top-k (capped by maxSuggestionsPerLeft)
      scores.sort((a, b) => b.score - a.score);

      // v2.4.3: Apply cross-granularity guardrail for MACRO_PERIOD markets
      // This prevents year↔month matches from exploding (e.g., 1 year market matching 12 months)
      let topCandidates: typeof scores;
      let crossGranularityDropped = 0;

      if (isMacroTopic && maxCrossGranularityPerLeft > 0) {
        const exactMatches: typeof scores = [];
        const crossGranularityMatches: typeof scores = [];

        for (const entry of scores) {
          // 'exact' means same period type and values (e.g., 2026-01 vs 2026-01)
          if (entry.periodKind === 'exact' || !entry.periodKind) {
            exactMatches.push(entry);
          } else {
            // month_in_quarter, quarter_in_year, month_in_year are cross-granularity
            crossGranularityMatches.push(entry);
          }
        }

        // Take all exact matches up to cap, plus limited cross-granularity matches
        const effectiveCap = Math.min(topK, maxSuggestionsPerLeft);
        const exactToTake = Math.min(exactMatches.length, effectiveCap);
        const remainingCap = effectiveCap - exactToTake;
        const crossGranularityToTake = Math.min(
          crossGranularityMatches.length,
          remainingCap,
          maxCrossGranularityPerLeft
        );

        topCandidates = [
          ...exactMatches.slice(0, exactToTake),
          ...crossGranularityMatches.slice(0, crossGranularityToTake),
        ];

        // Track how many cross-granularity were dropped due to the guardrail
        crossGranularityDropped = Math.max(0, crossGranularityMatches.length - crossGranularityToTake);
      } else {
        const effectiveCap = Math.min(topK, maxSuggestionsPerLeft);
        topCandidates = scores.slice(0, effectiveCap);
      }

      // Track cap statistics
      result.generatedPairsTotal += scores.length;
      result.savedTopKTotal += topCandidates.length;
      const effectiveCap = Math.min(topK, maxSuggestionsPerLeft);
      result.droppedByCapTotal += Math.max(0, scores.length - effectiveCap);
      result.droppedByCrossGranularityCap += crossGranularityDropped;

      // Save suggestions (with v2.4.5 right-side cap)
      for (const candidate of topCandidates) {
        try {
          // v2.4.5: Check right-side cap per entity-period bucket
          if (isMacroTopic && maxPerRightPerEntityPeriod > 0) {
            const rightIndexed = index.markets.get(candidate.rightId);
            if (rightIndexed?.fingerprint.macroEntities?.size) {
              let cappedForAllEntities = true;

              // Check cap for each matching entity
              for (const entity of rightIndexed.fingerprint.macroEntities) {
                // Only check entities that overlap with left
                if (!leftFingerprint.macroEntities?.has(entity)) continue;

                const capKey = buildRightCapKey(
                  candidate.rightId,
                  entity,
                  rightIndexed.fingerprint.period,
                  candidate.periodKind
                );
                const currentCount = rightCapTracker.get(capKey) || 0;

                if (currentCount < maxPerRightPerEntityPeriod) {
                  cappedForAllEntities = false;
                }
              }

              if (cappedForAllEntities && rightIndexed.fingerprint.macroEntities.size > 0) {
                // All matching entities have hit the cap - skip this suggestion
                result.droppedByRightCap++;
                continue;
              }

              // Increment caps for all matching entities
              for (const entity of rightIndexed.fingerprint.macroEntities) {
                if (!leftFingerprint.macroEntities?.has(entity)) continue;

                const capKey = buildRightCapKey(
                  candidate.rightId,
                  entity,
                  rightIndexed.fingerprint.period,
                  candidate.periodKind
                );
                rightCapTracker.set(capKey, (rightCapTracker.get(capKey) || 0) + 1);
              }
            }
          }

          // Warn if reason is missing
          if (!candidate.reason) {
            console.warn(`[matching] Warning: empty reason for match ${leftMarket.id} -> ${candidate.rightId}`);
          }

          const upsertResult = await linkRepo.upsertSuggestion(
            fromVenue as Venue,
            leftMarket.id,
            toVenue as Venue,
            candidate.rightId,
            candidate.score,
            candidate.reason,
            algoVersion
          );

          if (upsertResult.created) {
            result.suggestionsCreated++;
          } else {
            result.suggestionsUpdated++;
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Failed to save suggestion for ${leftMarket.id}: ${errMsg}`);
        }
      }

      // Track macro matches/unmatched
      if (isMacroTopic && leftFingerprint.macroEntities?.size) {
        if (topCandidates.length > 0) {
          // v2.4.5: Only count entities that ACTUALLY matched (intersection with right side)
          // This fixes the bug where matchedByEntity[PCE]=55 but rightByEntity[PCE]=0
          const matchedEntitiesForThisLeft = new Set<string>();
          for (const candidate of topCandidates) {
            const rightIndexed = index.markets.get(candidate.rightId);
            if (rightIndexed?.fingerprint.macroEntities) {
              for (const entity of leftFingerprint.macroEntities) {
                if (rightIndexed.fingerprint.macroEntities.has(entity)) {
                  matchedEntitiesForThisLeft.add(entity);
                }
              }
            }
            // Track period compatibility kinds for the matches (v2.4.3)
            const kind = candidate.periodKind || 'exact';
            macroStats.periodKindCounts.set(kind, (macroStats.periodKindCounts.get(kind) || 0) + 1);
          }
          // Increment matched count for entities that actually matched
          for (const entity of matchedEntitiesForThisLeft) {
            macroStats.matchedByEntity.set(entity, (macroStats.matchedByEntity.get(entity) || 0) + 1);
          }
        } else {
          // Market is unmatched - add to unmatched list
          const periodStr = leftFingerprint.period?.type === 'month'
            ? `${leftFingerprint.period.year}-${String(leftFingerprint.period.month).padStart(2, '0')}`
            : leftFingerprint.period?.type === 'quarter'
            ? `Q${leftFingerprint.period.quarter} ${leftFingerprint.period.year}`
            : leftFingerprint.period?.year ? `${leftFingerprint.period.year}` : 'none';
          macroStats.unmatchedMarkets.push({
            id: leftMarket.id,
            title: leftMarket.title,
            macroEntities: Array.from(leftFingerprint.macroEntities),
            period: periodStr,
          });
        }
      }

      processed++;
      if (processed % 100 === 0) {
        console.log(`[matching] Processed ${processed}/${leftMarkets.length - confirmedLeft.size} markets...`);
      }
    }

    console.log(`\n[matching] Suggest-matches v2.4.5 complete:`);
    console.log(`  Left markets (${fromVenue}): ${result.leftCount}`);
    console.log(`  Right markets (${toVenue}): ${result.rightCount}`);
    console.log(`  Skipped (already confirmed): ${result.skippedConfirmed}`);
    console.log(`  Skipped (no keyword overlap): ${result.skippedNoOverlap}`);
    console.log(`  Skipped (date gate): ${result.skippedDateGate}`);
    console.log(`  Skipped (text gate): ${result.skippedTextGate}`);
    console.log(`  Skipped (period gate): ${result.skippedPeriodGate}`);
    console.log(`  Candidates considered: ${result.candidatesConsidered}`);
    console.log(`  Generated pairs (score >= ${minScore}): ${result.generatedPairsTotal}`);
    console.log(`  Saved (top-${Math.min(topK, maxSuggestionsPerLeft)} cap): ${result.savedTopKTotal}`);
    console.log(`  Dropped by cap: ${result.droppedByCapTotal}`);
    console.log(`  Dropped by cross-granularity guardrail (v2.4.3): ${result.droppedByCrossGranularityCap}`);
    if (isMacroTopic && result.droppedByRightCap > 0) {
      console.log(`  Dropped by right-side cap (v2.4.5): ${result.droppedByRightCap}`);
    }
    console.log(`  Suggestions created: ${result.suggestionsCreated}`);
    console.log(`  Suggestions updated: ${result.suggestionsUpdated}`);
    console.log(`  Markets with no entities: ${noEntityCount}`);

    if (result.errors.length > 0) {
      console.log(`  Errors: ${result.errors.length}`);
    }

    // Macro coverage report (only for topic=macro)
    if (isMacroTopic) {
      console.log(`\n[macro-coverage] Macro Entity Coverage Report (eligible window only):`);
      console.log(`[NOTE] Counts show eligible markets in current window. Use macro:audit --all-time for full DB scan.`);
      console.log(`${'Entity'.padEnd(15)} | ${'Left'.padStart(6)} | ${'Right'.padStart(6)} | ${'Matched'.padStart(8)} | ${'Rate'.padStart(6)}`);
      console.log('-'.repeat(50));

      // Get all unique macro entities from both sides
      const allEntities = new Set([
        ...macroStats.leftByEntity.keys(),
        ...macroStats.rightByEntity.keys(),
      ]);

      // Sort alphabetically
      const sortedEntities = Array.from(allEntities).sort();

      let totalLeft = 0;
      let totalMatched = 0;

      // v2.4.5: Track entities with inconsistent counts for sanity check
      const inconsistentEntities: string[] = [];

      for (const entity of sortedEntities) {
        const left = macroStats.leftByEntity.get(entity) || 0;
        const right = macroStats.rightByEntity.get(entity) || 0;
        const matched = macroStats.matchedByEntity.get(entity) || 0;
        const rate = left > 0 ? ((matched / left) * 100).toFixed(1) + '%' : 'N/A';

        console.log(`${entity.padEnd(15)} | ${String(left).padStart(6)} | ${String(right).padStart(6)} | ${String(matched).padStart(8)} | ${rate.padStart(6)}`);

        // v2.4.5: Sanity check - matched > 0 but right = 0 is impossible
        if (right === 0 && matched > 0) {
          inconsistentEntities.push(entity);
        }

        totalLeft += left;
        totalMatched += matched;
      }

      // v2.4.5: Print warning for inconsistent entities
      if (inconsistentEntities.length > 0) {
        console.log(`\n[WARN] Inconsistent entity counts detected (Right=0 but Matched>0):`);
        for (const entity of inconsistentEntities) {
          const matched = macroStats.matchedByEntity.get(entity) || 0;
          console.log(`  ${entity}: Right=0 but Matched=${matched} - this indicates a bug in entity matching`);
        }
      }

      console.log('-'.repeat(50));
      const totalRate = totalLeft > 0 ? ((totalMatched / totalLeft) * 100).toFixed(1) + '%' : 'N/A';
      console.log(`${'TOTAL'.padEnd(15)} | ${String(totalLeft).padStart(6)} | ${String('').padStart(6)} | ${String(totalMatched).padStart(8)} | ${totalRate.padStart(6)}`);

      // Period compatibility breakdown (v2.4.3)
      if (macroStats.periodKindCounts.size > 0) {
        console.log(`\n[macro-coverage] Period Compatibility Breakdown (v2.4.3):`);
        const totalMatches = Array.from(macroStats.periodKindCounts.values()).reduce((a, b) => a + b, 0);
        const kindOrder: PeriodCompatibilityKind[] = ['exact', 'month_in_quarter', 'quarter_in_year', 'month_in_year', 'none'];
        for (const kind of kindOrder) {
          const count = macroStats.periodKindCounts.get(kind) || 0;
          if (count > 0) {
            const pct = ((count / totalMatches) * 100).toFixed(1);
            const score = PERIOD_COMPATIBILITY_SCORES[kind];
            console.log(`  ${kind.padEnd(18)} : ${String(count).padStart(4)} matches (${pct.padStart(5)}%) [score=${(score * 0.4).toFixed(2)}]`);
          }
        }
        console.log(`  ${'TOTAL'.padEnd(18)} : ${String(totalMatches).padStart(4)} matches`);
      }

      // Show unmatched markets (up to 10)
      if (macroStats.unmatchedMarkets.length > 0) {
        console.log(`\n[macro-coverage] Unmatched Markets (${macroStats.unmatchedMarkets.length} total):`);
        const toShow = macroStats.unmatchedMarkets.slice(0, 10);
        for (const m of toShow) {
          console.log(`  ID=${m.id} [${m.macroEntities.join(',')}] [${m.period}] "${m.title.substring(0, 60)}${m.title.length > 60 ? '...' : ''}"`);
        }
        if (macroStats.unmatchedMarkets.length > 10) {
          console.log(`  ... and ${macroStats.unmatchedMarkets.length - 10} more`);
        }
      }
    }

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errors.push(errorMsg);
    console.error(`[matching] Failed: ${errorMsg}`);
  }

  return result;
}

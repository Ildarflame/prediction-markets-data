/**
 * Crypto Pipeline (v2.5.0)
 *
 * Unified pipeline for fetching and processing crypto price markets.
 * Used by suggest-matches --topic crypto and crypto:* diagnostic commands.
 *
 * Key differences from macro:
 * - Uses settleDate (YYYY-MM-DD) instead of period (month/quarter/year)
 * - Hard gate: settleDate must match within ±1 day
 * - Candidate index key: entity + settleDate
 */

import type { Venue as CoreVenue } from '@data-module/core';
import {
  buildFingerprint,
  extractDates,
  tokenizeForEntities,
  MarketIntent,
  DatePrecision,
  type MarketFingerprint,
  type ExtractedDate,
} from '@data-module/core';
import {
  MarketRepository,
  type Venue,
  type EligibleMarket,
} from '@data-module/db';

// ============================================================
// Crypto Entities (v2.5.0)
// ============================================================

/**
 * Supported crypto entities for v2.5.0
 * Starting narrow: BTC + ETH only
 */
export const CRYPTO_ENTITIES_V1 = ['BITCOIN', 'ETHEREUM'] as const;
export type CryptoEntityV1 = typeof CRYPTO_ENTITIES_V1[number];

/**
 * Extended crypto entities for future versions
 */
export const CRYPTO_ENTITIES_EXTENDED = [
  ...CRYPTO_ENTITIES_V1,
  'SOLANA', 'XRP', 'DOGECOIN', 'CARDANO', 'BNB',
  'AVALANCHE', 'POLYGON', 'POLKADOT', 'CHAINLINK', 'LITECOIN',
] as const;

// ============================================================
// Crypto Keywords (STRICT vs BROAD)
// ============================================================

/**
 * STRICT keywords - used for DB query (title ILIKE)
 * Must be specific to the asset, no false positives
 * NOTE: "eth" removed from ETHEREUM - too many false positives (Hegseth, Kenneth, etc.)
 *       The extractor uses tokenization and handles "eth" correctly
 */
export const CRYPTO_KEYWORDS_STRICT: Record<string, string[]> = {
  BITCOIN: ['bitcoin', 'btc'],
  ETHEREUM: ['ethereum'],  // "eth" matches names like "Hegseth"
  // Extended (v2.5.1+)
  SOLANA: ['solana'],  // "sol" is too common (solution, solve, etc.)
  XRP: ['xrp', 'ripple'],
  DOGECOIN: ['dogecoin', 'doge'],
};

/**
 * BROAD keywords - used for diagnostic only, not for DB query
 * May have false positives
 */
export const CRYPTO_KEYWORDS_BROAD = ['crypto', 'token', 'coin', 'price'];

/**
 * Get all strict keywords for DB query (flattened)
 */
export function getCryptoStrictKeywords(entities: readonly string[] = CRYPTO_ENTITIES_V1): string[] {
  const keywords: string[] = [];
  for (const entity of entities) {
    const entityKeywords = CRYPTO_KEYWORDS_STRICT[entity];
    if (entityKeywords) {
      keywords.push(...entityKeywords);
    }
  }
  return keywords;
}

// ============================================================
// Crypto Signals
// ============================================================

/**
 * Extracted crypto signals from a market
 */
export interface CryptoSignals {
  /** Crypto entity (BITCOIN, ETHEREUM, etc.) */
  entity: string | null;
  /** Settlement date as YYYY-MM-DD string */
  settleDate: string | null;
  /** Parsed settlement date */
  settleDateParsed: ExtractedDate | null;
  /** Extracted numbers (price thresholds) */
  numbers: number[];
  /** Market intent */
  intent: MarketIntent;
  /** Full fingerprint */
  fingerprint: MarketFingerprint;
}

/**
 * Market with extracted crypto signals
 */
export interface CryptoMarket {
  market: EligibleMarket;
  signals: CryptoSignals;
}

// ============================================================
// Settle Date Extraction
// ============================================================

/**
 * Extract settlement date from title or closeTime
 * Returns YYYY-MM-DD string for indexing
 *
 * Priority:
 * 1. Explicit date in title (Dec 13, 2025)
 * 2. closeTime (fallback)
 */
export function extractSettleDate(title: string, closeTime?: Date | null): { date: string | null; parsed: ExtractedDate | null } {
  const dates = extractDates(title);

  // Find best date - prefer DAY precision
  const dayDate = dates.find(d => d.precision === DatePrecision.DAY);
  if (dayDate && dayDate.year && dayDate.month && dayDate.day) {
    const dateStr = `${dayDate.year}-${String(dayDate.month).padStart(2, '0')}-${String(dayDate.day).padStart(2, '0')}`;
    return { date: dateStr, parsed: dayDate };
  }

  // Fallback to closeTime
  if (closeTime) {
    const year = closeTime.getFullYear();
    const month = closeTime.getMonth() + 1;
    const day = closeTime.getDate();
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return {
      date: dateStr,
      parsed: {
        year,
        month,
        day,
        raw: 'closeTime',
        precision: DatePrecision.DAY,
      },
    };
  }

  return { date: null, parsed: null };
}

/**
 * Calculate day difference between two settle dates
 * Returns null if either date is invalid
 */
export function settleDateDayDiff(dateA: string | null, dateB: string | null): number | null {
  if (!dateA || !dateB) return null;

  const parseDate = (s: string): Date | null => {
    const match = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
  };

  const a = parseDate(dateA);
  const b = parseDate(dateB);
  if (!a || !b) return null;

  const diffMs = Math.abs(a.getTime() - b.getTime());
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

// ============================================================
// Crypto Entity Extraction (enhanced)
// ============================================================

/**
 * Extract crypto entity from market title using token-based matching
 * Returns the first matching entity or null
 *
 * Rules:
 * - Token "bitcoin" or "btc" => BITCOIN
 * - Token "ethereum" or "eth" => ETHEREUM (but NOT "hegseth")
 * - Ticker patterns $BTC, $ETH also work
 */
export function extractCryptoEntity(title: string, metadata?: Record<string, unknown> | null): string | null {
  const tokens = tokenizeForEntities(title);
  const tokenSet = new Set(tokens);

  // Check BTC first
  if (tokenSet.has('bitcoin') || tokenSet.has('btc')) {
    return 'BITCOIN';
  }

  // Check ETH - with word boundary safety
  // "eth" as standalone token (not part of "hegseth")
  if (tokenSet.has('ethereum') || tokenSet.has('eth')) {
    return 'ETHEREUM';
  }

  // Check ticker patterns in title ($BTC, $ETH)
  const tickerMatch = title.match(/\$(BTC|ETH)\b/i);
  if (tickerMatch) {
    const ticker = tickerMatch[1].toUpperCase();
    if (ticker === 'BTC') return 'BITCOIN';
    if (ticker === 'ETH') return 'ETHEREUM';
  }

  // Check Kalshi eventTicker metadata
  if (metadata) {
    const eventTicker = metadata.eventTicker || metadata.event_ticker;
    if (typeof eventTicker === 'string') {
      if (eventTicker.startsWith('KXBTC')) return 'BITCOIN';
      if (eventTicker.startsWith('KXETH')) return 'ETHEREUM';
    }
  }

  // Extended entities (v2.5.1+)
  if (tokenSet.has('solana') || tokenSet.has('sol')) return 'SOLANA';
  if (tokenSet.has('xrp') || tokenSet.has('ripple')) return 'XRP';
  if (tokenSet.has('dogecoin') || tokenSet.has('doge')) return 'DOGECOIN';

  return null;
}

// ============================================================
// Crypto Signal Extraction
// ============================================================

/**
 * Extract crypto signals from a market
 */
export function extractCryptoSignals(market: EligibleMarket): CryptoSignals {
  const fingerprint = buildFingerprint(market.title, market.closeTime, { metadata: market.metadata });
  const entity = extractCryptoEntity(market.title, market.metadata);
  const { date: settleDate, parsed: settleDateParsed } = extractSettleDate(market.title, market.closeTime);

  return {
    entity,
    settleDate,
    settleDateParsed,
    numbers: fingerprint.numbers,
    intent: fingerprint.intent,
    fingerprint,
  };
}

// ============================================================
// Crypto Pipeline Options
// ============================================================

export interface FetchCryptoMarketsOptions {
  venue: CoreVenue;
  lookbackHours: number;
  limit: number;
  /** Only fetch these entities (default: CRYPTO_ENTITIES_V1) */
  entities?: readonly string[];
  /** Exclude sports/esports markets */
  excludeSports?: boolean;
}

export interface FetchCryptoMarketsStats {
  total: number;
  afterKeywordFilter: number;
  afterSportsFilter: number;
  withCryptoEntity: number;
  withSettleDate: number;
}

// ============================================================
// Sports Exclusion (reuse from macro)
// ============================================================

const KALSHI_SPORTS_PREFIXES = [
  'KXMVESPORT', 'KXMVENBASI', 'KXNCAAMBGA', 'KXTABLETEN', 'KXNBAREB', 'KXNFL',
];

const SPORTS_TITLE_KEYWORDS = [
  'yes ', ': 1+', ': 2+', ': 3+', ': 4+', ': 5+', ': 6+', ': 7+', ': 8+', ': 9+',
  ': 10+', ': 15+', ': 20+', ': 25+', ': 30+', ': 40+', ': 50+',
  'points scored', 'wins by over', 'wins by under',
  'steals', 'rebounds', 'assists', 'touchdowns', 'yards',
  'kill handicap', 'tower handicap', 'map handicap',
];

function hasSportsTitleKeyword(title: string): boolean {
  const lower = title.toLowerCase();
  return SPORTS_TITLE_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
}

function isKalshiSportsMarket(metadata: Record<string, unknown> | null | undefined): boolean {
  if (!metadata) return false;
  const eventTicker = metadata.eventTicker || metadata.event_ticker;
  if (typeof eventTicker !== 'string') return false;
  return KALSHI_SPORTS_PREFIXES.some(prefix => eventTicker.startsWith(prefix));
}

// ============================================================
// Token-based Keyword Filter
// ============================================================

function hasKeywordToken(title: string, keywords: string[]): boolean {
  const tokens = new Set(tokenizeForEntities(title));
  for (const kw of keywords) {
    if (tokens.has(kw.toLowerCase())) {
      return true;
    }
  }
  return false;
}

// ============================================================
// Fetch Crypto Markets
// ============================================================

/**
 * Fetch eligible crypto markets using unified pipeline
 * This is the SAME pipeline used by suggest-matches --topic crypto
 */
export async function fetchEligibleCryptoMarkets(
  marketRepo: MarketRepository,
  options: FetchCryptoMarketsOptions
): Promise<{ markets: CryptoMarket[]; stats: FetchCryptoMarketsStats }> {
  const {
    venue,
    lookbackHours,
    limit,
    entities = CRYPTO_ENTITIES_V1,
    excludeSports = true,
  } = options;

  const stats: FetchCryptoMarketsStats = {
    total: 0,
    afterKeywordFilter: 0,
    afterSportsFilter: 0,
    withCryptoEntity: 0,
    withSettleDate: 0,
  };

  // Get strict keywords for DB query
  const strictKeywords = getCryptoStrictKeywords(entities);

  // Step 1: Fetch from DB with keyword pre-filter
  let markets = await marketRepo.listEligibleMarkets(venue as Venue, {
    lookbackHours,
    limit,
    titleKeywords: strictKeywords,
    orderBy: 'closeTime',
  });
  stats.total = markets.length;

  // Step 2: Apply token-based keyword post-filter (remove "Hegseth" etc.)
  markets = markets.filter(m => hasKeywordToken(m.title, strictKeywords));
  stats.afterKeywordFilter = markets.length;

  // Step 3: Apply sports filtering
  if (excludeSports) {
    markets = markets.filter(m => {
      if (venue === 'kalshi' && isKalshiSportsMarket(m.metadata)) return false;
      if (hasSportsTitleKeyword(m.title)) return false;
      return true;
    });
  }
  stats.afterSportsFilter = markets.length;

  // Step 4: Extract signals and filter by entity
  const result: CryptoMarket[] = [];
  const entitySet = new Set(entities);

  for (const market of markets) {
    const signals = extractCryptoSignals(market);

    // Must have a recognized crypto entity
    if (!signals.entity || !entitySet.has(signals.entity)) {
      continue;
    }

    stats.withCryptoEntity++;

    if (signals.settleDate) {
      stats.withSettleDate++;
    }

    result.push({ market, signals });
  }

  return { markets: result, stats };
}

// ============================================================
// Crypto Candidate Index
// ============================================================

/**
 * Build candidate index for crypto markets
 * Key: entity + settleDate (e.g., "BITCOIN|2025-12-13")
 */
export function buildCryptoIndex(markets: CryptoMarket[]): Map<string, CryptoMarket[]> {
  const index = new Map<string, CryptoMarket[]>();

  for (const m of markets) {
    if (!m.signals.entity || !m.signals.settleDate) continue;

    const key = `${m.signals.entity}|${m.signals.settleDate}`;
    if (!index.has(key)) {
      index.set(key, []);
    }
    index.get(key)!.push(m);
  }

  return index;
}

/**
 * Find candidates from index for a given market
 * Returns candidates with same entity and settleDate within ±1 day
 */
export function findCryptoCandidates(
  market: CryptoMarket,
  index: Map<string, CryptoMarket[]>,
  allowDayOffset: boolean = true
): CryptoMarket[] {
  if (!market.signals.entity || !market.signals.settleDate) {
    return [];
  }

  const candidates: CryptoMarket[] = [];
  const entity = market.signals.entity;
  const settleDate = market.signals.settleDate;

  // Exact match
  const exactKey = `${entity}|${settleDate}`;
  const exactMatches = index.get(exactKey) || [];
  candidates.push(...exactMatches);

  // ±1 day offset (if allowed)
  if (allowDayOffset) {
    const dateObj = new Date(settleDate);

    // Previous day
    const prevDate = new Date(dateObj);
    prevDate.setDate(prevDate.getDate() - 1);
    const prevKey = `${entity}|${prevDate.toISOString().slice(0, 10)}`;
    const prevMatches = index.get(prevKey) || [];
    candidates.push(...prevMatches);

    // Next day
    const nextDate = new Date(dateObj);
    nextDate.setDate(nextDate.getDate() + 1);
    const nextKey = `${entity}|${nextDate.toISOString().slice(0, 10)}`;
    const nextMatches = index.get(nextKey) || [];
    candidates.push(...nextMatches);
  }

  return candidates;
}

// ============================================================
// Crypto Scoring
// ============================================================

export interface CryptoScoreResult {
  score: number;
  reason: string;
  entityScore: number;
  dateScore: number;
  numberScore: number;
  textScore: number;
  tier: 'STRONG' | 'WEAK';
  /** Day difference between settle dates */
  dayDiff: number | null;
}

/**
 * Calculate crypto match score
 *
 * Formula:
 * - entityScore: 0.45 (exact match only)
 * - dateScore: 0.35 (1.0 exact, 0.6 ±1 day)
 * - numberScore: 0.15 (threshold overlap)
 * - textScore: 0.05 (fuzzy bonus)
 *
 * Hard gates:
 * - Entity must match
 * - Date must be within ±1 day
 */
export function cryptoMatchScore(left: CryptoMarket, right: CryptoMarket): CryptoScoreResult | null {
  const lSig = left.signals;
  const rSig = right.signals;

  // Hard gate: entity must match
  if (!lSig.entity || !rSig.entity || lSig.entity !== rSig.entity) {
    return null;
  }

  // Hard gate: date must exist and be within ±1 day
  const dayDiff = settleDateDayDiff(lSig.settleDate, rSig.settleDate);
  if (dayDiff === null || dayDiff > 1) {
    return null;
  }

  // Entity score (exact match = 1.0)
  const entityScoreVal = 1.0;

  // Date score (exact = 1.0, ±1 day = 0.6)
  const dateScoreVal = dayDiff === 0 ? 1.0 : 0.6;

  // Number score (overlap)
  let numberScoreVal = 0;
  if (lSig.numbers.length > 0 && rSig.numbers.length > 0) {
    // Check for overlap in price ranges
    const lMin = Math.min(...lSig.numbers);
    const lMax = Math.max(...lSig.numbers);
    const rMin = Math.min(...rSig.numbers);
    const rMax = Math.max(...rSig.numbers);

    // Check if ranges overlap
    if (lMin <= rMax && rMin <= lMax) {
      numberScoreVal = 1.0;
    } else {
      // Check relative distance
      const gapMin = Math.min(Math.abs(lMax - rMin), Math.abs(rMax - lMin));
      const avgVal = (lMax + rMax) / 2;
      const relGap = gapMin / avgVal;
      if (relGap < 0.01) numberScoreVal = 0.9;
      else if (relGap < 0.05) numberScoreVal = 0.7;
      else if (relGap < 0.10) numberScoreVal = 0.4;
    }
  }

  // Text score (simple token overlap)
  const lTokens = new Set(tokenizeForEntities(left.market.title));
  const rTokens = new Set(tokenizeForEntities(right.market.title));
  let intersection = 0;
  for (const t of lTokens) {
    if (rTokens.has(t)) intersection++;
  }
  const union = lTokens.size + rTokens.size - intersection;
  const textScoreVal = union > 0 ? intersection / union : 0;

  // Weighted score
  const score =
    0.45 * entityScoreVal +
    0.35 * dateScoreVal +
    0.15 * numberScoreVal +
    0.05 * textScoreVal;

  // Tier determination
  const tier: 'STRONG' | 'WEAK' = (dayDiff === 0 && numberScoreVal >= 0.6) ? 'STRONG' : 'WEAK';

  // Build reason string
  const reason = `entity=${lSig.entity} date=${dateScoreVal.toFixed(2)}(${dayDiff}d) num=${numberScoreVal.toFixed(2)} text=${textScoreVal.toFixed(2)}`;

  return {
    score,
    reason,
    entityScore: entityScoreVal,
    dateScore: dateScoreVal,
    numberScore: numberScoreVal,
    textScore: textScoreVal,
    tier,
    dayDiff,
  };
}

// ============================================================
// Collect Statistics
// ============================================================

/**
 * Collect crypto entity -> settleDates from processed markets
 */
export function collectCryptoSettleDates(
  markets: CryptoMarket[]
): Map<string, Set<string>> {
  const entityDates = new Map<string, Set<string>>();

  for (const { signals } of markets) {
    if (!signals.entity || !signals.settleDate) continue;

    if (!entityDates.has(signals.entity)) {
      entityDates.set(signals.entity, new Set());
    }
    entityDates.get(signals.entity)!.add(signals.settleDate);
  }

  return entityDates;
}

/**
 * Collect sample markets per entity (for debugging)
 */
export function collectCryptoSamplesByEntity(
  markets: CryptoMarket[],
  sampleCount: number = 5
): Map<string, Array<{ id: number; title: string; settleDate: string | null; numbers: number[] }>> {
  const samples = new Map<string, Array<{ id: number; title: string; settleDate: string | null; numbers: number[] }>>();

  for (const { market, signals } of markets) {
    if (!signals.entity) continue;

    if (!samples.has(signals.entity)) {
      samples.set(signals.entity, []);
    }
    const entitySamples = samples.get(signals.entity)!;
    if (entitySamples.length < sampleCount) {
      entitySamples.push({
        id: market.id,
        title: market.title,
        settleDate: signals.settleDate,
        numbers: signals.numbers,
      });
    }
  }

  return samples;
}

/**
 * Crypto Pipeline (v2.5.3)
 *
 * Unified pipeline for fetching and processing crypto price markets.
 * Used by suggest-matches --topic crypto and crypto:* diagnostic commands.
 *
 * Key differences from macro:
 * - Uses settleDate (YYYY-MM-DD) instead of period (month/quarter/year)
 * - Hard gate: settleDate must match within ±1 day (for DAY_EXACT type)
 * - Candidate index key: entity + settleDate
 *
 * v2.5.3 Changes:
 * - DateType system: DAY_EXACT, MONTH_END, QUARTER (only compatible types match)
 * - Smart number extraction: avoids date numbers, prefers $ and comparator context
 * - Dedup caps: --max-per-left, --max-per-right, --winner-gap
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
 * FULL NAME keywords - used for DB query (ILIKE contains)
 * Safe from false positives
 */
export const CRYPTO_FULLNAME_KEYWORDS: Record<string, string[]> = {
  BITCOIN: ['bitcoin'],
  ETHEREUM: ['ethereum'],
  SOLANA: ['solana'],
  XRP: ['xrp', 'ripple'],
  DOGECOIN: ['dogecoin'],
};

/**
 * TICKER keywords - need word-boundary regex matching (v2.5.2)
 * These are short and would cause false positives with simple contains:
 * - "eth" matches "Hegseth", "Kenneth"
 * - "sol" matches "solution", "solve"
 * - "btc" is generally safe but we use regex for consistency
 */
export const CRYPTO_TICKER_KEYWORDS: Record<string, string[]> = {
  BITCOIN: ['btc'],
  ETHEREUM: ['eth'],
  SOLANA: ['sol'],
  XRP: [],  // xrp is specific enough
  DOGECOIN: ['doge'],
};

/**
 * Generate PostgreSQL regex pattern for word-boundary ticker matching
 * Pattern: (^|[^a-z0-9])\$?ticker([^a-z0-9]|$)
 *
 * Matches:
 * - "ETH price" (word boundary before)
 * - "$ETH" (with dollar sign)
 * - "ETH!" (word boundary after)
 * - "ETH" at start or end of string
 *
 * Does NOT match:
 * - "Hegseth" (no word boundary)
 * - "ETHXYZ" (no word boundary after)
 */
export function getCryptoTickerRegex(ticker: string): string {
  return `(^|[^a-z0-9])\\$?${ticker}([^a-z0-9]|$)`;
}

/**
 * STRICT keywords - backward compatible (used by diagnostic commands)
 * Combines full names + tickers for simple use cases
 */
export const CRYPTO_KEYWORDS_STRICT: Record<string, string[]> = {
  BITCOIN: ['bitcoin', 'btc'],
  ETHEREUM: ['ethereum'],  // "eth" removed - use regex instead
  SOLANA: ['solana'],  // "sol" removed - use regex instead
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
 * For backward compatibility - use getCryptoDBPatterns for new code
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

/**
 * Get DB search patterns for crypto (v2.5.2)
 * Returns fullNameKeywords (ILIKE) and tickerPatterns (regex)
 */
export function getCryptoDBPatterns(entities: readonly string[] = CRYPTO_ENTITIES_V1): {
  fullNameKeywords: string[];
  tickerPatterns: string[];
} {
  const fullNameKeywords: string[] = [];
  const tickerPatterns: string[] = [];

  for (const entity of entities) {
    // Add full name keywords
    const fullNames = CRYPTO_FULLNAME_KEYWORDS[entity];
    if (fullNames) {
      fullNameKeywords.push(...fullNames);
    }

    // Add ticker regex patterns
    const tickers = CRYPTO_TICKER_KEYWORDS[entity];
    if (tickers) {
      for (const ticker of tickers) {
        tickerPatterns.push(getCryptoTickerRegex(ticker));
      }
    }
  }

  return { fullNameKeywords, tickerPatterns };
}

// ============================================================
// Date Type System (v2.5.3)
// ============================================================

/**
 * Date type classification for crypto matching
 * Only compatible types can match:
 * - DAY_EXACT <-> DAY_EXACT (±1 day allowed)
 * - MONTH_END <-> MONTH_END (same month required)
 * - QUARTER <-> QUARTER (same quarter required)
 */
export enum CryptoDateType {
  /** Specific day: "Jan 21, 2026" */
  DAY_EXACT = 'DAY_EXACT',
  /** End of month: "end of January 2026" */
  MONTH_END = 'MONTH_END',
  /** Quarter: "Q1 2026" */
  QUARTER = 'QUARTER',
  /** From closeTime fallback */
  CLOSE_TIME = 'CLOSE_TIME',
  /** Unknown/unparseable */
  UNKNOWN = 'UNKNOWN',
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
  /** Date type classification (v2.5.3) */
  dateType: CryptoDateType;
  /** Settlement period key for non-day types (v2.5.3): "2026-01" for MONTH_END, "2026-Q1" for QUARTER */
  settlePeriod: string | null;
  /** Extracted numbers (price thresholds) - now with smart extraction (v2.5.3) */
  numbers: number[];
  /** Number extraction context (v2.5.3) */
  numberContext: 'price' | 'threshold' | 'unknown';
  /** Comparator from title */
  comparator: string | null;
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
// Settle Date Extraction (v2.5.3 - enhanced with dateType)
// ============================================================

/**
 * Result of settle date extraction
 */
export interface SettleDateResult {
  /** YYYY-MM-DD string for indexing (for DAY_EXACT) */
  date: string | null;
  /** Parsed date details */
  parsed: ExtractedDate | null;
  /** Date type classification (v2.5.3) */
  dateType: CryptoDateType;
  /** Period key for non-day types: "2026-01" for MONTH_END, "2026-Q1" for QUARTER */
  settlePeriod: string | null;
}

/**
 * Extract settlement date from title or closeTime (v2.5.3)
 * Now returns dateType and settlePeriod for proper matching
 *
 * Patterns recognized:
 * - DAY_EXACT: "Jan 21, 2026", "January 21", "Dec 13"
 * - MONTH_END: "end of January 2026", "by end of Jan", "January 2026" (month without day)
 * - QUARTER: "Q1 2026", "first quarter 2026"
 * - CLOSE_TIME: fallback to closeTime
 */
export function extractSettleDate(title: string, closeTime?: Date | null): SettleDateResult {
  const lower = title.toLowerCase();

  // Pattern 1: "end of <Month> <Year>" -> MONTH_END
  const endOfMonthPattern = /\b(?:end of|by end of|month[- ]end)\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*,?\s*(20\d{2})?\b/gi;
  let match = endOfMonthPattern.exec(lower);
  if (match) {
    const monthName = match[1].toLowerCase();
    const monthMap: Record<string, number> = {
      'jan': 1, 'january': 1, 'feb': 2, 'february': 2, 'mar': 3, 'march': 3,
      'apr': 4, 'april': 4, 'may': 5, 'jun': 6, 'june': 6, 'jul': 7, 'july': 7,
      'aug': 8, 'august': 8, 'sep': 9, 'sept': 9, 'september': 9, 'oct': 10, 'october': 10,
      'nov': 11, 'november': 11, 'dec': 12, 'december': 12,
    };
    const month = monthMap[monthName] || monthMap[monthName.slice(0, 3)];
    let year = match[2] ? parseInt(match[2], 10) : null;

    // Infer year from closeTime if not specified
    if (!year && closeTime) {
      year = closeTime.getFullYear();
    } else if (!year) {
      year = new Date().getFullYear();
    }

    if (month && year) {
      // Calculate last day of month
      const lastDay = new Date(year, month, 0).getDate();
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      const periodStr = `${year}-${String(month).padStart(2, '0')}`;

      return {
        date: dateStr,
        parsed: { year, month, day: lastDay, raw: match[0], precision: DatePrecision.MONTH },
        dateType: CryptoDateType.MONTH_END,
        settlePeriod: periodStr,
      };
    }
  }

  // Pattern 2: Quarter patterns "Q1 2026", "first quarter 2026"
  const quarterPattern = /\b(?:q([1-4])|(first|second|third|fourth)\s+quarter)\s*(20\d{2})?\b/gi;
  match = quarterPattern.exec(lower);
  if (match) {
    let quarter: number;
    if (match[1]) {
      quarter = parseInt(match[1], 10);
    } else {
      const quarterNames: Record<string, number> = { 'first': 1, 'second': 2, 'third': 3, 'fourth': 4 };
      quarter = quarterNames[match[2].toLowerCase()];
    }

    let year = match[3] ? parseInt(match[3], 10) : null;
    if (!year && closeTime) {
      year = closeTime.getFullYear();
    } else if (!year) {
      year = new Date().getFullYear();
    }

    if (quarter && year) {
      const periodStr = `${year}-Q${quarter}`;
      // Quarter end date
      const quarterEndMonth = quarter * 3;
      const lastDay = new Date(year, quarterEndMonth, 0).getDate();
      const dateStr = `${year}-${String(quarterEndMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

      return {
        date: dateStr,
        parsed: { year, month: quarterEndMonth, day: lastDay, raw: match[0], precision: DatePrecision.QUARTER },
        dateType: CryptoDateType.QUARTER,
        settlePeriod: periodStr,
      };
    }
  }

  // Pattern 3: Use standard extractDates for DAY_EXACT
  const dates = extractDates(title);

  // Find best date - prefer DAY precision
  const dayDate = dates.find(d => d.precision === DatePrecision.DAY);
  if (dayDate && dayDate.year && dayDate.month && dayDate.day) {
    const dateStr = `${dayDate.year}-${String(dayDate.month).padStart(2, '0')}-${String(dayDate.day).padStart(2, '0')}`;
    return {
      date: dateStr,
      parsed: dayDate,
      dateType: CryptoDateType.DAY_EXACT,
      settlePeriod: null,
    };
  }

  // Pattern 4: Month + Year without day (e.g., "January 2026") -> MONTH_END
  const monthYearDate = dates.find(d => d.precision === DatePrecision.MONTH && d.year && d.month);
  if (monthYearDate && monthYearDate.year && monthYearDate.month) {
    const lastDay = new Date(monthYearDate.year, monthYearDate.month, 0).getDate();
    const dateStr = `${monthYearDate.year}-${String(monthYearDate.month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const periodStr = `${monthYearDate.year}-${String(monthYearDate.month).padStart(2, '0')}`;

    return {
      date: dateStr,
      parsed: { ...monthYearDate, day: lastDay },
      dateType: CryptoDateType.MONTH_END,
      settlePeriod: periodStr,
    };
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
      dateType: CryptoDateType.CLOSE_TIME,
      settlePeriod: null,
    };
  }

  return { date: null, parsed: null, dateType: CryptoDateType.UNKNOWN, settlePeriod: null };
}

// ============================================================
// Smart Number Extraction (v2.5.3)
// ============================================================

/**
 * Smart crypto number extraction result
 */
export interface CryptoNumberResult {
  /** Extracted price numbers */
  numbers: number[];
  /** Context of extraction */
  context: 'price' | 'threshold' | 'unknown';
}

/**
 * Extract crypto price numbers from title (v2.5.3)
 * Avoids date numbers and prefers $ prefixed or comparator-adjacent numbers
 *
 * Rules:
 * - Numbers 1-31 adjacent to month tokens are NOT prices (date days)
 * - Years 20xx in date context are NOT prices
 * - Prefer numbers with:
 *   a) $ prefix -> definitely price
 *   b) near comparator (above/below/between) -> threshold
 *   c) near "price" keyword -> price
 * - Numbers with k/m/b suffixes are always included
 */
export function extractCryptoNumbers(title: string): CryptoNumberResult {
  const numbers: number[] = [];
  const seen = new Set<number>();
  let context: 'price' | 'threshold' | 'unknown' = 'unknown';

  const lower = title.toLowerCase();

  // Check for comparator context
  const hasComparator = /\b(above|below|over|under|exceed|reach|hit|between|from|to)\b/i.test(title);
  const hasPriceKeyword = /\bprice\b/i.test(title);

  // Month tokens for date detection
  const monthPattern = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/gi;

  // Find all date contexts (month + day patterns)
  const dateContextRanges: Array<{ start: number; end: number }> = [];
  const monthDayPattern = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?\b/gi;
  let match;
  while ((match = monthDayPattern.exec(lower)) !== null) {
    dateContextRanges.push({ start: match.index, end: match.index + match[0].length });
  }

  // Also mark year patterns as date context
  const yearContextPattern = /\b20\d{2}\b/g;
  while ((match = yearContextPattern.exec(lower)) !== null) {
    // Check if this year is in a date-like context (near a month or quarter)
    const before = lower.slice(Math.max(0, match.index - 30), match.index);
    const hasMonthBefore = monthPattern.test(before) || /q[1-4]/i.test(before);
    if (hasMonthBefore) {
      dateContextRanges.push({ start: match.index, end: match.index + match[0].length });
    }
    monthPattern.lastIndex = 0; // Reset regex
  }

  // Helper to check if index is in date context
  const isInDateContext = (idx: number): boolean => {
    for (const range of dateContextRanges) {
      if (idx >= range.start && idx < range.end) return true;
    }
    return false;
  };

  // Multiplier map
  const multipliers: Record<string, number> = {
    'k': 1_000, 'thousand': 1_000,
    'm': 1_000_000, 'million': 1_000_000,
    'b': 1_000_000_000, 'billion': 1_000_000_000,
    't': 1_000_000_000_000, 'trillion': 1_000_000_000_000,
  };

  // Pattern 1: $ prefixed numbers (always price)
  const dollarPattern = /\$([\d,]+(?:\.\d+)?)\s*([kmbt])?\b/gi;
  while ((match = dollarPattern.exec(title)) !== null) {
    const numStr = match[1].replace(/,/g, '');
    let num = parseFloat(numStr);
    if (match[2]) {
      num *= multipliers[match[2].toLowerCase()] || 1;
    }
    if (!isNaN(num) && num >= 1 && !seen.has(num)) {
      seen.add(num);
      numbers.push(num);
      context = 'price';
    }
  }

  // Pattern 2: Numbers with k/m/b suffix (likely price)
  const multiplierPattern = /([\d,]+(?:\.\d+)?)\s*([kmbt])\b/gi;
  while ((match = multiplierPattern.exec(title)) !== null) {
    if (isInDateContext(match.index)) continue;

    const numStr = match[1].replace(/,/g, '');
    let num = parseFloat(numStr);
    num *= multipliers[match[2].toLowerCase()] || 1;

    if (!isNaN(num) && num >= 1000 && !seen.has(num)) {
      seen.add(num);
      numbers.push(num);
      if (context === 'unknown') context = 'threshold';
    }
  }

  // Pattern 3: Plain large numbers (>= 1000) in comparator context
  if (hasComparator || hasPriceKeyword) {
    const plainPattern = /([\d,]+(?:\.\d+)?)/g;
    while ((match = plainPattern.exec(title)) !== null) {
      if (isInDateContext(match.index)) continue;

      const numStr = match[0].replace(/,/g, '');
      const num = parseFloat(numStr);

      // Skip small numbers (1-31) and years (20xx)
      if (num >= 1 && num <= 31) continue;
      if (num >= 2020 && num <= 2100) continue;

      // Only include larger numbers in comparator context
      if (!isNaN(num) && num >= 100 && !seen.has(num)) {
        seen.add(num);
        numbers.push(num);
        if (context === 'unknown') context = 'threshold';
      }
    }
  }

  // Sort by value
  numbers.sort((a, b) => a - b);

  return { numbers, context };
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

/**
 * Check if two date types are compatible for matching (v2.5.3)
 *
 * Rules:
 * - DAY_EXACT <-> DAY_EXACT: compatible (will check ±1 day separately)
 * - DAY_EXACT <-> CLOSE_TIME: compatible (CLOSE_TIME is treated as DAY)
 * - MONTH_END <-> MONTH_END: compatible (must be same month)
 * - QUARTER <-> QUARTER: compatible (must be same quarter)
 * - All other combinations: not compatible
 */
export function areDateTypesCompatible(typeA: CryptoDateType, typeB: CryptoDateType): boolean {
  // Both DAY types (DAY_EXACT or CLOSE_TIME)
  const isDayType = (t: CryptoDateType) => t === CryptoDateType.DAY_EXACT || t === CryptoDateType.CLOSE_TIME;
  if (isDayType(typeA) && isDayType(typeB)) return true;

  // Both MONTH_END
  if (typeA === CryptoDateType.MONTH_END && typeB === CryptoDateType.MONTH_END) return true;

  // Both QUARTER
  if (typeA === CryptoDateType.QUARTER && typeB === CryptoDateType.QUARTER) return true;

  return false;
}

/**
 * Check if two periods match for MONTH_END or QUARTER types (v2.5.3)
 * Period format: "2026-01" for MONTH_END, "2026-Q1" for QUARTER
 */
export function arePeriodsEqual(periodA: string | null, periodB: string | null): boolean {
  if (!periodA || !periodB) return false;
  return periodA === periodB;
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
// Crypto Signal Extraction (v2.5.3)
// ============================================================

/**
 * Extract crypto signals from a market (v2.5.3)
 * Now includes dateType, settlePeriod, and smart number extraction
 */
export function extractCryptoSignals(market: EligibleMarket): CryptoSignals {
  const fingerprint = buildFingerprint(market.title, market.closeTime, { metadata: market.metadata });
  const entity = extractCryptoEntity(market.title, market.metadata);
  const { date: settleDate, parsed: settleDateParsed, dateType, settlePeriod } = extractSettleDate(market.title, market.closeTime);

  // v2.5.3: Use smart number extraction
  const { numbers, context: numberContext } = extractCryptoNumbers(market.title);

  return {
    entity,
    settleDate,
    settleDateParsed,
    dateType,
    settlePeriod,
    numbers,
    numberContext,
    comparator: fingerprint.comparator,
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
// Fetch Crypto Markets
// ============================================================

/**
 * Fetch eligible crypto markets using unified pipeline (v2.5.2)
 * This is the SAME pipeline used by suggest-matches --topic crypto
 *
 * v2.5.2: Now uses regex-based DB search for tickers to find "$ETH", "ETH price" etc.
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

  // v2.5.2: Use new regex-based DB search for tickers
  const { fullNameKeywords, tickerPatterns } = getCryptoDBPatterns(entities);

  // Step 1: Fetch from DB with regex patterns for tickers
  let markets = await marketRepo.listEligibleMarketsCrypto(venue as Venue, {
    lookbackHours,
    limit,
    fullNameKeywords,
    tickerPatterns,
    orderBy: 'closeTime',
  });
  stats.total = markets.length;

  // Step 2: No post-filter needed - regex already handles word boundaries
  // (keeping stat for consistency)
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
// Crypto Scoring (v2.5.3)
// ============================================================

export interface CryptoScoreResult {
  score: number;
  reason: string;
  entityScore: number;
  dateScore: number;
  numberScore: number;
  textScore: number;
  tier: 'STRONG' | 'WEAK';
  /** Day difference between settle dates (for DAY types) */
  dayDiff: number | null;
  /** Date type of left market (v2.5.3) */
  dateTypeL: CryptoDateType;
  /** Date type of right market (v2.5.3) */
  dateTypeR: CryptoDateType;
  /** Number context (v2.5.3) */
  numberContextL: 'price' | 'threshold' | 'unknown';
  numberContextR: 'price' | 'threshold' | 'unknown';
  /** Comparator from left (v2.5.3) */
  comparatorL: string | null;
  /** Comparator from right (v2.5.3) */
  comparatorR: string | null;
}

/**
 * Calculate crypto match score (v2.5.3)
 *
 * Formula:
 * - entityScore: 0.45 (exact match only)
 * - dateScore: 0.35 (1.0 exact, 0.6 ±1 day for DAY types, 1.0 for matching period types)
 * - numberScore: 0.15 (threshold overlap)
 * - textScore: 0.05 (fuzzy bonus)
 *
 * Hard gates:
 * - Entity must match
 * - Date types must be compatible (DAY<->DAY, MONTH_END<->MONTH_END, QUARTER<->QUARTER)
 * - For DAY types: date must be within ±1 day
 * - For MONTH_END/QUARTER: period must match exactly
 */
export function cryptoMatchScore(left: CryptoMarket, right: CryptoMarket): CryptoScoreResult | null {
  const lSig = left.signals;
  const rSig = right.signals;

  // Hard gate: entity must match
  if (!lSig.entity || !rSig.entity || lSig.entity !== rSig.entity) {
    return null;
  }

  // Hard gate: date types must be compatible (v2.5.3)
  if (!areDateTypesCompatible(lSig.dateType, rSig.dateType)) {
    return null;
  }

  // For DAY types: check ±1 day gate
  const isDayType = (t: CryptoDateType) => t === CryptoDateType.DAY_EXACT || t === CryptoDateType.CLOSE_TIME;
  let dayDiff: number | null = null;
  let dateScoreVal = 0;

  if (isDayType(lSig.dateType) && isDayType(rSig.dateType)) {
    dayDiff = settleDateDayDiff(lSig.settleDate, rSig.settleDate);
    if (dayDiff === null || dayDiff > 1) {
      return null;
    }
    // Date score (exact = 1.0, ±1 day = 0.6)
    dateScoreVal = dayDiff === 0 ? 1.0 : 0.6;
  } else if (lSig.dateType === CryptoDateType.MONTH_END && rSig.dateType === CryptoDateType.MONTH_END) {
    // For MONTH_END: periods must match exactly
    if (!arePeriodsEqual(lSig.settlePeriod, rSig.settlePeriod)) {
      return null;
    }
    dateScoreVal = 1.0;
  } else if (lSig.dateType === CryptoDateType.QUARTER && rSig.dateType === CryptoDateType.QUARTER) {
    // For QUARTER: periods must match exactly
    if (!arePeriodsEqual(lSig.settlePeriod, rSig.settlePeriod)) {
      return null;
    }
    dateScoreVal = 1.0;
  } else {
    // Unknown compatibility case - reject
    return null;
  }

  // Entity score (exact match = 1.0)
  const entityScoreVal = 1.0;

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

  // Tier determination (v2.5.3: consider dateType)
  const isDayMatch = isDayType(lSig.dateType) && dayDiff === 0;
  const isPeriodMatch = !isDayType(lSig.dateType) && arePeriodsEqual(lSig.settlePeriod, rSig.settlePeriod);
  const tier: 'STRONG' | 'WEAK' = ((isDayMatch || isPeriodMatch) && numberScoreVal >= 0.6) ? 'STRONG' : 'WEAK';

  // Build reason string (v2.5.3: includes dateType)
  const dateInfo = isDayType(lSig.dateType) ? `${dayDiff}d` : lSig.settlePeriod || 'period';
  const reason = `entity=${lSig.entity} dateType=${lSig.dateType} date=${dateScoreVal.toFixed(2)}(${dateInfo}) num=${numberScoreVal.toFixed(2)}[${lSig.numberContext}] text=${textScoreVal.toFixed(2)}`;

  return {
    score,
    reason,
    entityScore: entityScoreVal,
    dateScore: dateScoreVal,
    numberScore: numberScoreVal,
    textScore: textScoreVal,
    tier,
    dayDiff,
    dateTypeL: lSig.dateType,
    dateTypeR: rSig.dateType,
    numberContextL: lSig.numberContext,
    numberContextR: rSig.numberContext,
    comparatorL: lSig.comparator,
    comparatorR: rSig.comparator,
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

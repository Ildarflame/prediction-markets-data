/**
 * Macro Pipeline (v2.4.3)
 *
 * Unified pipeline for fetching and processing macro markets.
 * Used by both suggest-matches and macro:overlap to ensure consistency.
 *
 * v2.4.3: Added period compatibility engine (month/quarter/year)
 */

import type { Venue as CoreVenue } from '@data-module/core';
import {
  buildFingerprint,
  extractPeriod,
  tokenizeForEntities,
  MarketIntent,
  type MarketFingerprint,
  type MacroPeriod,
} from '@data-module/core';
import {
  MarketRepository,
  type Venue,
  type EligibleMarket,
} from '@data-module/db';

/**
 * Sports exclusion patterns for Kalshi
 */
export const KALSHI_SPORTS_PREFIXES = [
  'KXMVESPORT',
  'KXMVENBASI',
  'KXNCAAMBGA',
  'KXTABLETEN',
  'KXNBAREB',
  'KXNFL',
];

/**
 * Keywords in title that indicate sports/esports markets
 */
export const SPORTS_TITLE_KEYWORDS = [
  'yes ',
  ': 1+', ': 2+', ': 3+', ': 4+', ': 5+', ': 6+', ': 7+', ': 8+', ': 9+',
  ': 10+', ': 15+', ': 20+', ': 25+', ': 30+', ': 40+', ': 50+',
  'points scored', 'wins by over', 'wins by under',
  'first quarter', 'second quarter', 'third quarter', 'fourth quarter',
  'steals', 'rebounds', 'assists', 'touchdowns', 'yards',
  'kill handicap', 'tower handicap', 'map handicap',
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
 * Macro-specific keywords for filtering (token-based)
 */
export const MACRO_KEYWORDS = [
  'cpi', 'gdp', 'inflation', 'unemployment', 'jobless',
  'payrolls', 'nonfarm', 'nfp', 'fed', 'fomc',
  'rates', 'interest', 'pce', 'pmi',
];

/**
 * Macro entity names for topic filtering
 * Note: UNEMPLOYMENT_RATE replaces UNEMPLOYMENT (v2.4.2)
 *       JOBLESS_CLAIMS added as separate entity
 */
export const MACRO_ENTITIES = [
  'CPI', 'GDP', 'NFP', 'FOMC', 'FED_RATE', 'UNEMPLOYMENT_RATE', 'JOBLESS_CLAIMS',
  'INFLATION', 'INTEREST_RATE', 'PPI', 'PCE',
];

/**
 * Extracted macro signals from a market
 */
export interface MacroSignals {
  entities: Set<string>;
  period: MacroPeriod;
  periodKey: string | null;
  intent: MarketIntent;
  fingerprint: MarketFingerprint;
}

/**
 * Options for fetching macro markets
 */
export interface FetchMacroMarketsOptions {
  venue: CoreVenue;
  lookbackHours: number;
  limit: number;
  macroMinYear?: number;
  macroMaxYear?: number;
  excludeSports?: boolean;
}

/**
 * Stats from fetching macro markets
 */
export interface FetchMacroMarketsStats {
  total: number;
  afterKeywordFilter: number;
  afterSportsFilter: number;
  afterTopicFilter: number;
  afterYearFilter: number;
  excludedYearLow: number;
  excludedYearHigh: number;
  excludedNoYear: number;
  withMacroEntity: number;
  withPeriod: number;
}

/**
 * Market with extracted macro signals
 */
export interface MacroMarket {
  market: EligibleMarket;
  signals: MacroSignals;
}

/**
 * Build period key string from MacroPeriod
 */
export function buildPeriodKey(period: MacroPeriod): string | null {
  if (!period.type || !period.year) return null;

  if (period.type === 'month' && period.month) {
    return `${period.year}-${String(period.month).padStart(2, '0')}`;
  } else if (period.type === 'quarter' && period.quarter) {
    return `${period.year}-Q${period.quarter}`;
  } else if (period.type === 'year') {
    return `${period.year}`;
  }
  return null;
}

/**
 * Period compatibility kind (v2.4.3)
 * Defines how two periods relate to each other
 */
export type PeriodCompatibilityKind =
  | 'exact'           // Same period (2026-01 vs 2026-01)
  | 'month_in_quarter' // Month within quarter (2026-02 vs 2026-Q1)
  | 'month_in_year'    // Month within year (2026-02 vs 2026)
  | 'quarter_in_year'  // Quarter within year (2026-Q1 vs 2026)
  | 'none';            // Not compatible

/**
 * Result of period compatibility check
 */
export interface PeriodCompatibilityResult {
  compatible: boolean;
  kind: PeriodCompatibilityKind;
}

/**
 * Parse period key into components
 * Returns { type, year, month?, quarter? }
 */
export function parsePeriodKey(key: string): { type: 'month' | 'quarter' | 'year'; year: number; month?: number; quarter?: number } | null {
  if (!key) return null;

  // Month format: YYYY-MM (e.g., 2026-01)
  const monthMatch = key.match(/^(\d{4})-(\d{2})$/);
  if (monthMatch) {
    return { type: 'month', year: parseInt(monthMatch[1], 10), month: parseInt(monthMatch[2], 10) };
  }

  // Quarter format: YYYY-Qn (e.g., 2026-Q1)
  const quarterMatch = key.match(/^(\d{4})-Q([1-4])$/);
  if (quarterMatch) {
    return { type: 'quarter', year: parseInt(quarterMatch[1], 10), quarter: parseInt(quarterMatch[2], 10) };
  }

  // Year format: YYYY (e.g., 2026)
  const yearMatch = key.match(/^(\d{4})$/);
  if (yearMatch) {
    return { type: 'year', year: parseInt(yearMatch[1], 10) };
  }

  return null;
}

/**
 * Get quarter number (1-4) for a given month (1-12)
 */
function getQuarterForMonth(month: number): number {
  return Math.ceil(month / 3);
}

/**
 * Check if two periods are compatible (v2.4.3)
 *
 * Compatibility rules (symmetric):
 * - month(YYYY-MM) compatible with quarter(YYYY-Qn) if month is in that quarter
 * - month(YYYY-MM) compatible with year(YYYY) if same year
 * - quarter(YYYY-Qn) compatible with year(YYYY) if same year
 */
export function isPeriodCompatible(keyA: string | null, keyB: string | null): PeriodCompatibilityResult {
  if (!keyA || !keyB) {
    return { compatible: false, kind: 'none' };
  }

  // Exact match
  if (keyA === keyB) {
    return { compatible: true, kind: 'exact' };
  }

  const a = parsePeriodKey(keyA);
  const b = parsePeriodKey(keyB);

  if (!a || !b) {
    return { compatible: false, kind: 'none' };
  }

  // Different years => not compatible
  if (a.year !== b.year) {
    return { compatible: false, kind: 'none' };
  }

  // Same type but different values (already checked exact match above)
  if (a.type === b.type) {
    return { compatible: false, kind: 'none' };
  }

  // Month vs Quarter
  if (a.type === 'month' && b.type === 'quarter') {
    const monthQuarter = getQuarterForMonth(a.month!);
    if (monthQuarter === b.quarter) {
      return { compatible: true, kind: 'month_in_quarter' };
    }
    return { compatible: false, kind: 'none' };
  }
  if (a.type === 'quarter' && b.type === 'month') {
    const monthQuarter = getQuarterForMonth(b.month!);
    if (monthQuarter === a.quarter) {
      return { compatible: true, kind: 'month_in_quarter' };
    }
    return { compatible: false, kind: 'none' };
  }

  // Month vs Year (same year already checked)
  if ((a.type === 'month' && b.type === 'year') || (a.type === 'year' && b.type === 'month')) {
    return { compatible: true, kind: 'month_in_year' };
  }

  // Quarter vs Year (same year already checked)
  if ((a.type === 'quarter' && b.type === 'year') || (a.type === 'year' && b.type === 'quarter')) {
    return { compatible: true, kind: 'quarter_in_year' };
  }

  return { compatible: false, kind: 'none' };
}

/**
 * Period compatibility scores (v2.4.3)
 * Used in macro scoring formula
 */
export const PERIOD_COMPATIBILITY_SCORES: Record<PeriodCompatibilityKind, number> = {
  exact: 1.00,
  month_in_quarter: 0.60,
  quarter_in_year: 0.55,
  month_in_year: 0.45,
  none: 0,
};

/**
 * Get period compatibility score for a given kind
 */
export function periodCompatibilityScore(kind: PeriodCompatibilityKind): number {
  return PERIOD_COMPATIBILITY_SCORES[kind];
}

/**
 * Extract macro signals from a market
 */
export function extractMacroSignals(market: EligibleMarket): MacroSignals {
  const fingerprint = buildFingerprint(market.title, market.closeTime, { metadata: market.metadata });
  const period = fingerprint.period || extractPeriod(market.title, market.closeTime);
  const periodKey = buildPeriodKey(period);

  return {
    entities: fingerprint.macroEntities || new Set(),
    period,
    periodKey,
    intent: fingerprint.intent,
    fingerprint,
  };
}

/**
 * Check if market title contains a keyword using token-based matching
 */
function hasKeywordToken(title: string, keywords: string[]): boolean {
  const titleTokens = new Set(tokenizeForEntities(title));

  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    if (titleTokens.has(kwLower)) {
      return true;
    }
    // Multi-word keywords
    const kwTokens = tokenizeForEntities(kw);
    if (kwTokens.length > 1) {
      const titleTokenArr = tokenizeForEntities(title);
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
 * Check if market title contains sports keywords (substring-based for patterns like ": 10+")
 */
function hasSportsTitleKeyword(title: string, keywords: string[]): boolean {
  const lowerTitle = title.toLowerCase();
  return keywords.some(keyword => lowerTitle.includes(keyword.toLowerCase()));
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
 * Check if market matches macro topic by entity or keyword
 */
function matchesMacroTopic(market: EligibleMarket, fingerprint: MarketFingerprint): boolean {
  const topicEntities = new Set(MACRO_ENTITIES);

  // Check entities first
  for (const entity of fingerprint.entities) {
    if (topicEntities.has(entity)) {
      return true;
    }
  }

  // Fallback to keyword matching
  return hasKeywordToken(market.title, MACRO_KEYWORDS);
}

/**
 * Fetch eligible macro markets using unified pipeline
 * This is the SAME pipeline used by suggest-matches --topic macro
 */
export async function fetchEligibleMacroMarkets(
  marketRepo: MarketRepository,
  options: FetchMacroMarketsOptions
): Promise<{ markets: MacroMarket[]; stats: FetchMacroMarketsStats }> {
  const {
    venue,
    lookbackHours,
    limit,
    macroMinYear,
    macroMaxYear,
    excludeSports = true,
  } = options;

  // Current year for defaults
  const currentYear = new Date().getFullYear();
  const minYear = macroMinYear ?? currentYear - 1;
  const maxYear = macroMaxYear ?? currentYear + 1;

  const stats: FetchMacroMarketsStats = {
    total: 0,
    afterKeywordFilter: 0,
    afterSportsFilter: 0,
    afterTopicFilter: 0,
    afterYearFilter: 0,
    excludedYearLow: 0,
    excludedYearHigh: 0,
    excludedNoYear: 0,
    withMacroEntity: 0,
    withPeriod: 0,
  };

  // Step 1: Fetch from DB with keyword pre-filter
  let markets = await marketRepo.listEligibleMarkets(venue as Venue, {
    lookbackHours,
    limit,
    titleKeywords: MACRO_KEYWORDS,
  });
  stats.total = markets.length;

  // Step 2: Apply token-based keyword post-filter
  markets = markets.filter(m => hasKeywordToken(m.title, MACRO_KEYWORDS));
  stats.afterKeywordFilter = markets.length;

  // Step 3: Apply sports filtering
  if (excludeSports) {
    const sportsKeywords = venue === 'polymarket'
      ? [...SPORTS_TITLE_KEYWORDS, ...POLYMARKET_ESPORTS_KEYWORDS]
      : SPORTS_TITLE_KEYWORDS;

    markets = markets.filter(m => {
      if (venue === 'kalshi' && isKalshiSportsMarket(m.metadata, KALSHI_SPORTS_PREFIXES)) {
        return false;
      }
      if (hasSportsTitleKeyword(m.title, sportsKeywords)) {
        return false;
      }
      return true;
    });
  }
  stats.afterSportsFilter = markets.length;

  // Step 4: Apply topic filtering (must match macro entity or keyword)
  const marketsWithFingerprints: Array<{ market: EligibleMarket; fingerprint: MarketFingerprint }> = [];

  for (const market of markets) {
    const fingerprint = buildFingerprint(market.title, market.closeTime, { metadata: market.metadata });
    if (matchesMacroTopic(market, fingerprint)) {
      marketsWithFingerprints.push({ market, fingerprint });
    }
  }
  stats.afterTopicFilter = marketsWithFingerprints.length;

  // Step 5: Apply year window filter
  const result: MacroMarket[] = [];

  for (const { market, fingerprint } of marketsWithFingerprints) {
    const period = fingerprint.period || extractPeriod(market.title, market.closeTime);
    let year: number | undefined;

    if (period.year) {
      year = period.year;
    } else if (market.closeTime) {
      year = market.closeTime.getFullYear();
    }

    if (!year) {
      stats.excludedNoYear++;
      continue;
    }

    if (year < minYear) {
      stats.excludedYearLow++;
      continue;
    }

    if (year > maxYear) {
      stats.excludedYearHigh++;
      continue;
    }

    const periodKey = buildPeriodKey(period);

    const signals: MacroSignals = {
      entities: fingerprint.macroEntities || new Set(),
      period,
      periodKey,
      intent: fingerprint.intent,
      fingerprint,
    };

    if (signals.entities.size > 0) {
      stats.withMacroEntity++;
    }
    if (periodKey) {
      stats.withPeriod++;
    }

    result.push({ market, signals });
  }

  stats.afterYearFilter = result.length;

  return { markets: result, stats };
}

/**
 * Collect macro entity -> periods from processed macro markets
 */
export function collectMacroPeriods(
  macroMarkets: MacroMarket[]
): Map<string, Set<string>> {
  const entityPeriods = new Map<string, Set<string>>();

  for (const { signals } of macroMarkets) {
    if (!signals.entities.size) continue;
    if (!signals.periodKey) continue;

    for (const entity of signals.entities) {
      if (!entityPeriods.has(entity)) {
        entityPeriods.set(entity, new Set());
      }
      entityPeriods.get(entity)!.add(signals.periodKey);
    }
  }

  return entityPeriods;
}

/**
 * Collect sample markets per entity (for debugging)
 */
export function collectSamplesByEntity(
  macroMarkets: MacroMarket[],
  sampleCount: number = 5
): Map<string, Array<{ id: number; title: string; period: string | null }>> {
  const samples = new Map<string, Array<{ id: number; title: string; period: string | null }>>();

  for (const { market, signals } of macroMarkets) {
    for (const entity of signals.entities) {
      if (!samples.has(entity)) {
        samples.set(entity, []);
      }
      const entitySamples = samples.get(entity)!;
      if (entitySamples.length < sampleCount) {
        entitySamples.push({
          id: market.id,
          title: market.title,
          period: signals.periodKey,
        });
      }
    }
  }

  return samples;
}

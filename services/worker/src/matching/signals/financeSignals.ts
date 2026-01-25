/**
 * Finance Signals Extraction (v3.1.0)
 *
 * Extracts structured signals from financial markets.
 * Used for cross-venue matching of indices, forex, and bond markets.
 */

import { tokenizeForEntities } from '@data-module/core';
import type { EligibleMarket } from '@data-module/db';

/**
 * Asset classes
 */
export enum FinanceAssetClass {
  INDEX = 'INDEX',
  FOREX = 'FOREX',
  BOND = 'BOND',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Direction/comparator
 */
export enum FinanceDirection {
  ABOVE = 'ABOVE',
  BELOW = 'BELOW',
  CLOSE = 'CLOSE',
  BETWEEN = 'BETWEEN',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Indices
 */
export const INDICES: Record<string, string[]> = {
  'SP500': ['s&p 500', 's&p500', 'sp500', 'spx', 's&p', 'sp 500'],
  'NASDAQ': ['nasdaq', 'nasdaq-100', 'nasdaq 100', 'qqq', 'ndx', 'comp'],
  'DOW': ['dow jones', 'dow', 'djia', 'dow 30'],
  'RUSSELL': ['russell 2000', 'russell2000', 'rut'],
  'VIX': ['vix', 'volatility index', 'cboe volatility'],
};

/**
 * Forex pairs
 */
export const FOREX_PAIRS: Record<string, string[]> = {
  'EURUSD': ['eur/usd', 'eurusd', 'euro dollar', 'eur usd'],
  'USDJPY': ['usd/jpy', 'usdjpy', 'dollar yen', 'usd jpy'],
  'GBPUSD': ['gbp/usd', 'gbpusd', 'cable', 'gbp usd', 'pound dollar'],
  'USDCHF': ['usd/chf', 'usdchf', 'swissy', 'usd chf'],
  'AUDUSD': ['aud/usd', 'audusd', 'aussie', 'aud usd'],
  'USDCAD': ['usd/cad', 'usdcad', 'loonie', 'usd cad'],
  'NZDUSD': ['nzd/usd', 'nzdusd', 'kiwi', 'nzd usd'],
};

/**
 * Bonds/Treasuries
 */
export const BONDS: Record<string, string[]> = {
  '10Y': ['10-year', '10 year', '10y', 'ten year', 'ten-year', '10yr'],
  '2Y': ['2-year', '2 year', '2y', 'two year', 'two-year', '2yr'],
  '5Y': ['5-year', '5 year', '5y', 'five year', 'five-year', '5yr'],
  '30Y': ['30-year', '30 year', '30y', 'thirty year', 'thirty-year', '30yr'],
  'TBILL': ['t-bill', 'tbill', 'treasury bill'],
  'TREASURY': ['treasury', 'treasuries', 'bond yield'],
};

/**
 * Direction keywords
 */
export const DIRECTION_KEYWORDS: Record<FinanceDirection, string[]> = {
  [FinanceDirection.ABOVE]: ['above', 'over', 'higher than', 'exceed', 'at or above', 'close above'],
  [FinanceDirection.BELOW]: ['below', 'under', 'lower than', 'at or below', 'close below'],
  [FinanceDirection.CLOSE]: ['close at', 'settle at', 'end at', 'finish at'],
  [FinanceDirection.BETWEEN]: ['between', 'range', 'from ... to'],
  [FinanceDirection.UNKNOWN]: [],
};

/**
 * Finance signals extracted from a market
 */
export interface FinanceSignals {
  /** Asset class */
  assetClass: FinanceAssetClass;
  /** Specific instrument (e.g., SP500, EURUSD, 10Y) */
  instrument: string | null;
  /** Direction/comparator */
  direction: FinanceDirection;
  /** Target value (e.g., 5000, 1.10, 4.5%) */
  targetValue: number | null;
  /** Lower bound for range */
  lowerBound: number | null;
  /** Upper bound for range */
  upperBound: number | null;
  /** Date from title (YYYY-MM-DD) */
  date: string | null;
  /** Timeframe (daily, weekly, monthly) */
  timeframe: string | null;
  /** Raw title tokens */
  titleTokens: string[];
  /** Confidence in extraction */
  confidence: number;
}

/**
 * Extract asset class from title
 */
export function extractAssetClass(title: string): FinanceAssetClass {
  const lower = title.toLowerCase();

  // Check indices
  for (const aliases of Object.values(INDICES)) {
    for (const alias of aliases) {
      const pattern = new RegExp(`\\b${alias.replace(/[&]/g, '\\&').replace(/\s+/g, '\\s*')}\\b`, 'i');
      if (pattern.test(lower)) {
        return FinanceAssetClass.INDEX;
      }
    }
  }

  // Check forex
  for (const aliases of Object.values(FOREX_PAIRS)) {
    for (const alias of aliases) {
      const pattern = new RegExp(`\\b${alias.replace(/[/]/g, '\\/?').replace(/\s+/g, '\\s*')}\\b`, 'i');
      if (pattern.test(lower)) {
        return FinanceAssetClass.FOREX;
      }
    }
  }

  // Check bonds
  for (const aliases of Object.values(BONDS)) {
    for (const alias of aliases) {
      const pattern = new RegExp(`\\b${alias.replace(/-/g, '\\-?').replace(/\s+/g, '\\s*')}\\b`, 'i');
      if (pattern.test(lower)) {
        return FinanceAssetClass.BOND;
      }
    }
  }

  return FinanceAssetClass.UNKNOWN;
}

/**
 * Extract instrument from title
 */
export function extractInstrument(title: string): string | null {
  const lower = title.toLowerCase();

  // Check indices
  for (const [instrument, aliases] of Object.entries(INDICES)) {
    for (const alias of aliases) {
      const pattern = new RegExp(`\\b${alias.replace(/[&]/g, '\\&').replace(/\s+/g, '\\s*')}\\b`, 'i');
      if (pattern.test(lower)) {
        return instrument;
      }
    }
  }

  // Check forex
  for (const [instrument, aliases] of Object.entries(FOREX_PAIRS)) {
    for (const alias of aliases) {
      const pattern = new RegExp(`\\b${alias.replace(/[/]/g, '\\/?').replace(/\s+/g, '\\s*')}\\b`, 'i');
      if (pattern.test(lower)) {
        return instrument;
      }
    }
  }

  // Check bonds
  for (const [instrument, aliases] of Object.entries(BONDS)) {
    for (const alias of aliases) {
      const pattern = new RegExp(`\\b${alias.replace(/-/g, '\\-?').replace(/\s+/g, '\\s*')}\\b`, 'i');
      if (pattern.test(lower)) {
        return instrument;
      }
    }
  }

  return null;
}

/**
 * Extract direction from title
 */
export function extractDirection(title: string): FinanceDirection {
  const lower = title.toLowerCase();

  for (const [direction, keywords] of Object.entries(DIRECTION_KEYWORDS)) {
    if (direction === FinanceDirection.UNKNOWN) continue;

    for (const keyword of keywords) {
      const pattern = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'i');
      if (pattern.test(lower)) {
        return direction as FinanceDirection;
      }
    }
  }

  return FinanceDirection.UNKNOWN;
}

/**
 * Extract target value from title
 * Handles: $5000, 5000, 1.10, 4.5%, etc.
 */
export function extractTargetValue(title: string): number | null {
  // Try various patterns
  const patterns = [
    // Dollar amounts: $5,000 or $5000
    /\$\s*([\d,]+(?:\.\d+)?)/,
    // Percentage: 4.5%
    /([\d.]+)\s*%/,
    // Plain numbers with k suffix: 5k, 5.5k
    /([\d.]+)\s*k\b/i,
    // Large numbers: 5,000 or 5000 (at least 3 digits)
    /\b([\d,]{3,}(?:\.\d+)?)\b/,
    // Decimal numbers (for forex): 1.10, 1.0850
    /\b(\d+\.\d{2,})\b/,
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match) {
      const value = match[1].replace(/,/g, '');
      const parsed = parseFloat(value);
      if (!isNaN(parsed)) {
        // Handle k suffix
        if (/k\b/i.test(title) && parsed < 100) {
          return parsed * 1000;
        }
        return parsed;
      }
    }
  }

  return null;
}

/**
 * Extract range bounds from title
 */
export function extractRange(title: string): { lower: number | null; upper: number | null } {
  // Pattern: between X and Y, X-Y, X to Y
  const rangePatterns = [
    /between\s+\$?([\d,]+(?:\.\d+)?)\s+and\s+\$?([\d,]+(?:\.\d+)?)/i,
    /\$?([\d,]+(?:\.\d+)?)\s*-\s*\$?([\d,]+(?:\.\d+)?)/,
    /\$?([\d,]+(?:\.\d+)?)\s+to\s+\$?([\d,]+(?:\.\d+)?)/i,
  ];

  for (const pattern of rangePatterns) {
    const match = title.match(pattern);
    if (match) {
      const lower = parseFloat(match[1].replace(/,/g, ''));
      const upper = parseFloat(match[2].replace(/,/g, ''));
      if (!isNaN(lower) && !isNaN(upper)) {
        return { lower, upper };
      }
    }
  }

  return { lower: null, upper: null };
}

/**
 * Extract date from title
 */
export function extractDate(title: string, closeTime?: Date | null): string | null {
  // Try explicit date patterns
  const datePatterns = [
    // January 25, 2026
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(202[4-9])/i,
    // Jan 25, 2026
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(202[4-9])/i,
    // 2026-01-25
    /\b(202[4-9])-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/,
    // 01/25/2026
    /\b(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/(202[4-9])\b/,
  ];

  const monthMap: Record<string, string> = {
    'january': '01', 'jan': '01',
    'february': '02', 'feb': '02',
    'march': '03', 'mar': '03',
    'april': '04', 'apr': '04',
    'may': '05',
    'june': '06', 'jun': '06',
    'july': '07', 'jul': '07',
    'august': '08', 'aug': '08',
    'september': '09', 'sep': '09',
    'october': '10', 'oct': '10',
    'november': '11', 'nov': '11',
    'december': '12', 'dec': '12',
  };

  for (const pattern of datePatterns) {
    const match = title.match(pattern);
    if (match) {
      if (pattern.source.includes('january|february')) {
        // Full month name
        const month = monthMap[match[1].toLowerCase()];
        const day = match[2].padStart(2, '0');
        const year = match[3];
        return `${year}-${month}-${day}`;
      } else if (pattern.source.includes('jan|feb')) {
        // Abbreviated month name
        const month = monthMap[match[1].toLowerCase()];
        const day = match[2].padStart(2, '0');
        const year = match[3];
        return `${year}-${month}-${day}`;
      } else if (pattern.source.includes('202[4-9]-')) {
        // ISO format
        return match[0];
      } else {
        // MM/DD/YYYY
        const month = match[1];
        const day = match[2];
        const year = match[3];
        return `${year}-${month}-${day}`;
      }
    }
  }

  // Derive from closeTime
  if (closeTime) {
    return closeTime.toISOString().split('T')[0];
  }

  return null;
}

/**
 * Extract timeframe from title
 */
export function extractTimeframe(title: string): string | null {
  const lower = title.toLowerCase();

  if (/\bdaily\b/.test(lower) || /\btoday\b/.test(lower) || /\btonight\b/.test(lower)) {
    return 'daily';
  }
  if (/\bweekly\b/.test(lower) || /\bthis week\b/.test(lower) || /\bweek of\b/.test(lower)) {
    return 'weekly';
  }
  if (/\bmonthly\b/.test(lower) || /\bthis month\b/.test(lower) || /\bend of month\b/.test(lower)) {
    return 'monthly';
  }
  if (/\bquarterly\b/.test(lower) || /\bq[1-4]\b/.test(lower)) {
    return 'quarterly';
  }
  if (/\byearly\b/.test(lower) || /\bannual\b/.test(lower) || /\bend of year\b/.test(lower)) {
    return 'yearly';
  }

  return null;
}

/**
 * Extract all finance signals from a market
 */
export function extractFinanceSignals(market: EligibleMarket): FinanceSignals {
  const title = market.title;
  const closeTime = market.closeTime;

  const assetClass = extractAssetClass(title);
  const instrument = extractInstrument(title);
  const direction = extractDirection(title);
  const targetValue = extractTargetValue(title);
  const { lower: lowerBound, upper: upperBound } = extractRange(title);
  const date = extractDate(title, closeTime);
  const timeframe = extractTimeframe(title);
  const titleTokens = tokenizeForEntities(title);

  // Calculate confidence
  let confidence = 0;
  if (assetClass !== FinanceAssetClass.UNKNOWN) confidence += 0.25;
  if (instrument !== null) confidence += 0.25;
  if (direction !== FinanceDirection.UNKNOWN) confidence += 0.15;
  if (targetValue !== null || (lowerBound !== null && upperBound !== null)) confidence += 0.20;
  if (date !== null) confidence += 0.10;
  if (timeframe !== null) confidence += 0.05;

  return {
    assetClass,
    instrument,
    direction,
    targetValue,
    lowerBound,
    upperBound,
    date,
    timeframe,
    titleTokens,
    confidence,
  };
}

/**
 * Check if a market is likely a finance market
 */
export function isFinanceMarket(title: string): boolean {
  const lower = title.toLowerCase();

  // Must have finance-related keywords
  const financeKeywords = [
    's&p', 'sp500', 'nasdaq', 'dow', 'djia', 'russell',
    'eur/usd', 'usd/jpy', 'gbp/usd', 'forex',
    'treasury', 'treasuries', '10-year', '2-year', 'bond yield',
    'index', 'indices',
  ];

  return financeKeywords.some(kw => lower.includes(kw));
}

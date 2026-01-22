/**
 * Rates Signals Extraction (v3.0.0)
 *
 * Extracts structured signals from interest rate / central bank markets.
 * Used for cross-venue matching of FOMC, Fed, ECB, BoE, BoJ markets.
 */

import { tokenizeForEntities } from '@data-module/core';
import type { EligibleMarket } from '@data-module/db';

/**
 * Central bank identifiers
 */
export enum CentralBank {
  FED = 'FED',
  ECB = 'ECB',
  BOE = 'BOE',
  BOJ = 'BOJ',
  RBA = 'RBA',
  BOC = 'BOC',
  SNB = 'SNB',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Rate action types
 */
export enum RateAction {
  CUT = 'CUT',
  HIKE = 'HIKE',
  HOLD = 'HOLD',
  PAUSE = 'PAUSE',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Keywords for central bank detection
 */
export const CENTRAL_BANK_KEYWORDS: Record<CentralBank, string[]> = {
  [CentralBank.FED]: [
    'federal reserve', 'fed ', 'fomc', 'fed funds', 'powell',
    'us interest rate', 'us rate', 'fed rate',
  ],
  [CentralBank.ECB]: [
    'european central bank', 'ecb', 'lagarde', 'eurozone rate',
    'euro area rate', 'eu interest rate',
  ],
  [CentralBank.BOE]: [
    'bank of england', 'boe', 'bailey', 'uk interest rate',
    'uk rate', 'sterling rate',
  ],
  [CentralBank.BOJ]: [
    'bank of japan', 'boj', 'ueda', 'japan interest rate',
    'japan rate', 'yen rate',
  ],
  [CentralBank.RBA]: [
    'reserve bank of australia', 'rba', 'australian rate',
  ],
  [CentralBank.BOC]: [
    'bank of canada', 'boc', 'canada rate',
  ],
  [CentralBank.SNB]: [
    'swiss national bank', 'snb', 'swiss rate',
  ],
  [CentralBank.UNKNOWN]: [],
};

/**
 * Keywords for rate action detection
 */
export const RATE_ACTION_KEYWORDS: Record<RateAction, string[]> = {
  [RateAction.CUT]: [
    'cut', 'cuts', 'cutting', 'lower', 'lowering', 'decrease', 'decreasing',
    'reduce', 'reducing', 'reduction', 'ease', 'easing',
  ],
  [RateAction.HIKE]: [
    'hike', 'hikes', 'hiking', 'raise', 'raising', 'increase', 'increasing',
    'tighten', 'tightening', 'higher',
  ],
  [RateAction.HOLD]: [
    'hold', 'holds', 'holding', 'unchanged', 'no change', 'maintain', 'maintaining',
    'steady', 'stable',
  ],
  [RateAction.PAUSE]: [
    'pause', 'pauses', 'pausing', 'skip', 'skipping',
  ],
  [RateAction.UNKNOWN]: [],
};

/**
 * FOMC meeting dates (approximate - actual dates vary)
 * Format: YYYY-MM-DD
 */
export const FOMC_MEETING_MONTHS_2024_2026 = [
  // 2024
  '2024-01', '2024-03', '2024-05', '2024-06', '2024-07', '2024-09', '2024-11', '2024-12',
  // 2025
  '2025-01', '2025-03', '2025-05', '2025-06', '2025-07', '2025-09', '2025-11', '2025-12',
  // 2026
  '2026-01', '2026-03', '2026-05', '2026-06', '2026-07', '2026-09', '2026-11', '2026-12',
];

/**
 * Rates signals extracted from a market
 */
export interface RatesSignals {
  /** Central bank entity */
  centralBank: CentralBank;
  /** Meeting date as YYYY-MM-DD (if specific date found) */
  meetingDate: string | null;
  /** Meeting month as YYYY-MM (coarser granularity) */
  meetingMonth: string | null;
  /** Rate action type */
  action: RateAction;
  /** Basis points (25, 50, 75, 100, etc.) */
  basisPoints: number | null;
  /** Target rate range { min, max } */
  targetRate: { min: number; max: number } | null;
  /** End-of-year rate prediction */
  yearEndRate: number | null;
  /** Year for predictions */
  year: number | null;
  /** Number of cuts/hikes expected */
  actionCount: number | null;
  /** Raw title tokens for text matching */
  titleTokens: string[];
  /** Confidence in extraction */
  confidence: number;
}

/**
 * Extract central bank from title
 */
export function extractCentralBank(title: string): CentralBank {
  const lower = title.toLowerCase();

  for (const [bank, keywords] of Object.entries(CENTRAL_BANK_KEYWORDS)) {
    if (bank === CentralBank.UNKNOWN) continue;

    for (const keyword of keywords) {
      if (lower.includes(keyword.toLowerCase())) {
        return bank as CentralBank;
      }
    }
  }

  return CentralBank.UNKNOWN;
}

/**
 * Extract rate action from title
 */
export function extractRateAction(title: string): RateAction {
  const lower = title.toLowerCase();

  // Check for specific action keywords
  for (const [action, keywords] of Object.entries(RATE_ACTION_KEYWORDS)) {
    if (action === RateAction.UNKNOWN) continue;

    for (const keyword of keywords) {
      // Word boundary check
      const pattern = new RegExp(`\\b${keyword}\\b`, 'i');
      if (pattern.test(lower)) {
        return action as RateAction;
      }
    }
  }

  return RateAction.UNKNOWN;
}

/**
 * Extract basis points from title
 * Patterns: "25 bps", "25 basis points", "0.25%", "quarter point"
 */
export function extractBasisPoints(title: string): number | null {
  const lower = title.toLowerCase();

  // Pattern: X bps or X basis points
  const bpsMatch = lower.match(/(\d+)\s*(?:bps?|basis\s*points?)/i);
  if (bpsMatch) {
    return parseInt(bpsMatch[1], 10);
  }

  // Pattern: 0.XX% or X.XX%
  const percentMatch = lower.match(/(\d+\.?\d*)\s*%/);
  if (percentMatch) {
    const percent = parseFloat(percentMatch[1]);
    // Convert to bps (0.25% = 25bps)
    if (percent <= 1) {
      return Math.round(percent * 100);
    }
  }

  // Pattern: quarter point = 25bps
  if (/quarter\s*point/i.test(lower)) {
    return 25;
  }

  // Pattern: half point = 50bps
  if (/half\s*point/i.test(lower)) {
    return 50;
  }

  return null;
}

/**
 * Extract meeting date from title
 * Returns YYYY-MM-DD if specific date found, null otherwise
 */
export function extractMeetingDate(title: string, closeTime?: Date | null): string | null {
  const lower = title.toLowerCase();

  // Pattern: Month DD, YYYY or Month DD YYYY
  const fullDateMatch = lower.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(20\d{2})\b/i
  );

  if (fullDateMatch) {
    const monthMap: Record<string, number> = {
      jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
      apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
      aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
      nov: 11, november: 11, dec: 12, december: 12,
    };

    const monthName = fullDateMatch[1].toLowerCase();
    const month = monthMap[monthName] || monthMap[monthName.slice(0, 3)];
    const day = parseInt(fullDateMatch[2], 10);
    const year = parseInt(fullDateMatch[3], 10);

    if (month && day && year) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // Fallback to closeTime if available
  if (closeTime) {
    const year = closeTime.getFullYear();
    const month = closeTime.getMonth() + 1;
    const day = closeTime.getDate();
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  return null;
}

/**
 * Extract meeting month from title or date
 */
export function extractMeetingMonth(title: string, closeTime?: Date | null): string | null {
  // First try to get full date
  const fullDate = extractMeetingDate(title, null);
  if (fullDate) {
    return fullDate.slice(0, 7); // YYYY-MM
  }

  const lower = title.toLowerCase();

  // Pattern: Month YYYY
  const monthYearMatch = lower.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*(20\d{2})\b/i
  );

  if (monthYearMatch) {
    const monthMap: Record<string, number> = {
      jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
      apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
      aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
      nov: 11, november: 11, dec: 12, december: 12,
    };

    const monthName = monthYearMatch[1].toLowerCase();
    const month = monthMap[monthName] || monthMap[monthName.slice(0, 3)];
    const year = parseInt(monthYearMatch[2], 10);

    if (month && year) {
      return `${year}-${String(month).padStart(2, '0')}`;
    }
  }

  // Fallback to closeTime
  if (closeTime) {
    const year = closeTime.getFullYear();
    const month = closeTime.getMonth() + 1;
    return `${year}-${String(month).padStart(2, '0')}`;
  }

  return null;
}

/**
 * Extract target rate range from title
 * Pattern: "4.25%-4.50%", "4.25-4.50%", "between 4.25% and 4.50%"
 */
export function extractTargetRate(title: string): { min: number; max: number } | null {
  // Pattern: X.XX%-Y.YY% or X.XX-Y.YY%
  const rangeMatch = title.match(/(\d+\.?\d*)\s*%?\s*[-–]\s*(\d+\.?\d*)\s*%/);
  if (rangeMatch) {
    const min = parseFloat(rangeMatch[1]);
    const max = parseFloat(rangeMatch[2]);
    if (!isNaN(min) && !isNaN(max)) {
      return { min, max };
    }
  }

  // Pattern: between X% and Y%
  const betweenMatch = title.match(/between\s+(\d+\.?\d*)\s*%?\s+and\s+(\d+\.?\d*)\s*%/i);
  if (betweenMatch) {
    const min = parseFloat(betweenMatch[1]);
    const max = parseFloat(betweenMatch[2]);
    if (!isNaN(min) && !isNaN(max)) {
      return { min, max };
    }
  }

  return null;
}

/**
 * Extract year from title
 */
export function extractYear(title: string, closeTime?: Date | null): number | null {
  const yearMatch = title.match(/\b(20\d{2})\b/);
  if (yearMatch) {
    return parseInt(yearMatch[1], 10);
  }

  if (closeTime) {
    return closeTime.getFullYear();
  }

  return null;
}

/**
 * Extract action count (number of cuts/hikes expected)
 * Pattern: "3 cuts", "two rate cuts", "no cuts"
 */
export function extractActionCount(title: string): number | null {
  const lower = title.toLowerCase();

  // Pattern: number + cuts/hikes
  const numberMap: Record<string, number> = {
    'no': 0, 'zero': 0, 'one': 1, 'two': 2, 'three': 3, 'four': 4,
    'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
  };

  // Digit pattern: "3 cuts"
  const digitMatch = lower.match(/(\d+)\s*(?:rate\s*)?(?:cut|hike)s?/i);
  if (digitMatch) {
    return parseInt(digitMatch[1], 10);
  }

  // Word pattern: "three cuts"
  for (const [word, num] of Object.entries(numberMap)) {
    const pattern = new RegExp(`\\b${word}\\s*(?:rate\\s*)?(?:cut|hike)s?\\b`, 'i');
    if (pattern.test(lower)) {
      return num;
    }
  }

  return null;
}

/**
 * Extract all rates signals from a market
 */
export function extractRatesSignals(market: EligibleMarket): RatesSignals {
  const title = market.title;
  const closeTime = market.closeTime;

  const centralBank = extractCentralBank(title);
  const meetingDate = extractMeetingDate(title, closeTime);
  const meetingMonth = extractMeetingMonth(title, closeTime);
  const action = extractRateAction(title);
  const basisPoints = extractBasisPoints(title);
  const targetRate = extractTargetRate(title);
  const year = extractYear(title, closeTime);
  const actionCount = extractActionCount(title);
  const titleTokens = tokenizeForEntities(title);

  // Calculate confidence
  let confidence = 0;
  if (centralBank !== CentralBank.UNKNOWN) confidence += 0.4;
  if (meetingMonth) confidence += 0.3;
  if (action !== RateAction.UNKNOWN) confidence += 0.2;
  if (basisPoints !== null || targetRate !== null) confidence += 0.1;

  return {
    centralBank,
    meetingDate,
    meetingMonth,
    action,
    basisPoints,
    targetRate,
    yearEndRate: null, // Not implemented yet
    year,
    actionCount,
    titleTokens,
    confidence,
  };
}

/**
 * Check if a market is likely a rates market
 */
export function isRatesMarket(title: string): boolean {
  const lower = title.toLowerCase();

  // Must have central bank OR rate-related keywords
  const hasCentralBank = extractCentralBank(title) !== CentralBank.UNKNOWN;
  const hasRateKeywords = /\b(rate|interest|fomc|fed funds?|bps|basis points?)\b/i.test(lower);

  return hasCentralBank || hasRateKeywords;
}

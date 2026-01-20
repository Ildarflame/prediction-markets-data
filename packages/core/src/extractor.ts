/**
 * Fingerprint-based entity extraction for market matching
 */

import { ENTITY_ALIASES, TICKER_PATTERNS, normalizeEntity, isKnownEntity } from './aliases.js';

/**
 * Comparator type for market conditions
 */
export enum Comparator {
  GE = 'GE',       // Greater than or equal (above, over, exceed, reach, at least)
  LE = 'LE',       // Less than or equal (below, under, less than, at most)
  WIN = 'WIN',     // Win/victory condition
  UNKNOWN = 'UNKNOWN',
}

/**
 * Extracted date with optional components
 */
export interface ExtractedDate {
  year?: number;
  month?: number;
  day?: number;
  raw: string;
}

/**
 * Market fingerprint for matching
 */
export interface MarketFingerprint {
  entities: string[];
  numbers: number[];
  dates: ExtractedDate[];
  comparator: Comparator;
  fingerprint: string;
}

// Month name to number mapping
const MONTH_MAP: Record<string, number> = {
  'jan': 1, 'january': 1,
  'feb': 2, 'february': 2,
  'mar': 3, 'march': 3,
  'apr': 4, 'april': 4,
  'may': 5,
  'jun': 6, 'june': 6,
  'jul': 7, 'july': 7,
  'aug': 8, 'august': 8,
  'sep': 9, 'sept': 9, 'september': 9,
  'oct': 10, 'october': 10,
  'nov': 11, 'november': 11,
  'dec': 12, 'december': 12,
};

// Comparator keywords
const GE_KEYWORDS = [
  'above', 'over', 'exceed', 'exceeds', 'exceeding',
  'reach', 'reaches', 'reaching', 'hit', 'hits',
  'at least', 'greater than', 'more than', 'higher than',
  'surpass', 'surpasses', 'top', 'tops',
];

const LE_KEYWORDS = [
  'below', 'under', 'less than', 'at most', 'lower than',
  'fall below', 'falls below', 'drop below', 'drops below',
  'not exceed', 'not reach', 'fail to reach',
];

const WIN_KEYWORDS = [
  'win', 'wins', 'winning', 'winner',
  'beat', 'beats', 'defeat', 'defeats',
  'elected', 'election winner', 'victory',
  'champion', 'champions', 'championship',
];

/**
 * Extract entities from market title using alias map and patterns
 */
export function extractEntities(title: string): string[] {
  const entities = new Set<string>();
  const normalizedTitle = title.toLowerCase();

  // Check multi-word aliases first (longer matches take priority)
  const sortedAliases = Object.keys(ENTITY_ALIASES).sort((a, b) => b.length - a.length);

  for (const alias of sortedAliases) {
    if (normalizedTitle.includes(alias)) {
      entities.add(ENTITY_ALIASES[alias]);
    }
  }

  // Extract ticker patterns
  for (const pattern of TICKER_PATTERNS) {
    const matches = title.match(pattern);
    if (matches) {
      for (const match of matches) {
        const clean = match.replace('$', '').toUpperCase();
        const normalized = normalizeEntity(clean);
        entities.add(normalized);
      }
    }
  }

  // Extract remaining capitalized words that might be entities
  const words = title.split(/\s+/);
  for (const word of words) {
    const clean = word.replace(/[^a-zA-Z0-9]/g, '');
    if (clean.length >= 2 && isKnownEntity(clean)) {
      entities.add(normalizeEntity(clean));
    }
  }

  return Array.from(entities).sort();
}

/**
 * Extract numbers from market title
 * Handles: 100k -> 100000, 3% -> 3, 175+ -> 175, $50,000 -> 50000
 */
export function extractNumbers(title: string): number[] {
  const numbers: number[] = [];

  const multipliers: Record<string, number> = {
    'k': 1_000,
    'thousand': 1_000,
    'm': 1_000_000,
    'million': 1_000_000,
    'b': 1_000_000_000,
    'billion': 1_000_000_000,
    't': 1_000_000_000_000,
    'trillion': 1_000_000_000_000,
  };

  // Extract with main pattern
  const mainPattern = /\$?([\d,]+(?:\.\d+)?)\s*([kmbt](?:illion|housand)?)?/gi;
  let match;

  while ((match = mainPattern.exec(title)) !== null) {
    let numStr = match[1].replace(/,/g, '');
    let num = parseFloat(numStr);

    if (isNaN(num)) continue;

    // Apply multiplier if present
    if (match[2]) {
      const suffix = match[2].toLowerCase();
      const mult = multipliers[suffix] || multipliers[suffix[0]] || 1;
      num *= mult;
    }

    // Skip very small numbers that are likely noise (years handled separately)
    if (num >= 1 && num < 1900 || num > 2100) {
      numbers.push(num);
    }
  }

  // Extract percentages separately
  const pctPattern = /([\d.]+)\s*%/g;
  while ((match = pctPattern.exec(title)) !== null) {
    const num = parseFloat(match[1]);
    if (!isNaN(num)) {
      numbers.push(num);
    }
  }

  // Deduplicate and sort
  return [...new Set(numbers)].sort((a, b) => a - b);
}

/**
 * Extract dates from market title
 * Handles: Dec 31 2024, December 31, 2024, end of 2024, 2024-12-31, Q4 2024
 */
export function extractDates(title: string): ExtractedDate[] {
  const dates: ExtractedDate[] = [];

  // Pattern: Month Day, Year (Dec 31, 2024 or December 31 2024)
  const monthDayYearPattern = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?[,\s]+(\d{4})\b/gi;
  let match;

  while ((match = monthDayYearPattern.exec(title)) !== null) {
    const monthName = match[1].toLowerCase();
    const month = MONTH_MAP[monthName] || MONTH_MAP[monthName.slice(0, 3)];
    const day = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);

    if (month && day >= 1 && day <= 31 && year >= 2020 && year <= 2030) {
      dates.push({ year, month, day, raw: match[0] });
    }
  }

  // Pattern: Month Year (December 2024, Dec 2024)
  const monthYearPattern = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{4})\b/gi;

  while ((match = monthYearPattern.exec(title)) !== null) {
    const monthName = match[1].toLowerCase();
    const month = MONTH_MAP[monthName] || MONTH_MAP[monthName.slice(0, 3)];
    const year = parseInt(match[2], 10);

    if (month && year >= 2020 && year <= 2030) {
      // Check if this wasn't already captured with a day
      const alreadyHasDay = dates.some(d => d.year === year && d.month === month && d.day);
      if (!alreadyHasDay) {
        dates.push({ year, month, raw: match[0] });
      }
    }
  }

  // Pattern: end of YEAR, by end of YEAR, year-end YEAR
  const endOfYearPattern = /\b(?:end of|by end of|year[- ]end|eoy)\s*(\d{4})\b/gi;

  while ((match = endOfYearPattern.exec(title)) !== null) {
    const year = parseInt(match[1], 10);
    if (year >= 2020 && year <= 2030) {
      dates.push({ year, month: 12, day: 31, raw: match[0] });
    }
  }

  // Pattern: Q1/Q2/Q3/Q4 YEAR
  const quarterPattern = /\bq([1-4])\s*(\d{4})\b/gi;
  const quarterEndMonth: Record<number, number> = { 1: 3, 2: 6, 3: 9, 4: 12 };
  const quarterEndDay: Record<number, number> = { 1: 31, 2: 30, 3: 30, 4: 31 };

  while ((match = quarterPattern.exec(title)) !== null) {
    const quarter = parseInt(match[1], 10);
    const year = parseInt(match[2], 10);
    if (year >= 2020 && year <= 2030) {
      dates.push({
        year,
        month: quarterEndMonth[quarter],
        day: quarterEndDay[quarter],
        raw: match[0]
      });
    }
  }

  // Pattern: standalone year (2024, 2025) - only if no other dates found
  if (dates.length === 0) {
    const yearPattern = /\b(202[0-9]|2030)\b/g;
    while ((match = yearPattern.exec(title)) !== null) {
      const year = parseInt(match[1], 10);
      // Only add standalone year if it looks like a deadline context
      const beforeMatch = title.slice(Math.max(0, match.index - 20), match.index).toLowerCase();
      if (beforeMatch.includes('by') || beforeMatch.includes('in') ||
          beforeMatch.includes('before') || beforeMatch.includes('until') ||
          beforeMatch.includes('during')) {
        dates.push({ year, raw: match[0] });
      }
    }
  }

  // ISO format: 2024-12-31
  const isoPattern = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  while ((match = isoPattern.exec(title)) !== null) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);
    if (year >= 2020 && year <= 2030 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      dates.push({ year, month, day, raw: match[0] });
    }
  }

  // Deduplicate by comparing year/month/day
  const seen = new Set<string>();
  return dates.filter(d => {
    const key = `${d.year}-${d.month}-${d.day}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Extract comparator from market title
 */
export function extractComparator(title: string): Comparator {
  const lower = title.toLowerCase();

  // Check for GE keywords
  for (const kw of GE_KEYWORDS) {
    if (lower.includes(kw)) {
      return Comparator.GE;
    }
  }

  // Check for LE keywords
  for (const kw of LE_KEYWORDS) {
    if (lower.includes(kw)) {
      return Comparator.LE;
    }
  }

  // Check for WIN keywords
  for (const kw of WIN_KEYWORDS) {
    if (lower.includes(kw)) {
      return Comparator.WIN;
    }
  }

  return Comparator.UNKNOWN;
}

/**
 * Build a fingerprint string for a market
 * Format: ENTITIES|NUMBER|DATE|COMPARATOR
 */
export function buildFingerprint(title: string, closeTime?: Date | null): MarketFingerprint {
  const entities = extractEntities(title);
  const numbers = extractNumbers(title);
  const dates = extractDates(title);
  const comparator = extractComparator(title);

  // Build fingerprint string
  const parts: string[] = [];

  // Entities (sorted)
  if (entities.length > 0) {
    parts.push(entities.join('+'));
  }

  // Main number (first significant one)
  if (numbers.length > 0) {
    // Prefer round numbers or the largest
    const mainNumber = numbers.find(n => n % 1000 === 0) || numbers[numbers.length - 1];
    parts.push(`N${mainNumber}`);
  }

  // Main date
  if (dates.length > 0) {
    const d = dates[0];
    if (d.year && d.month && d.day) {
      parts.push(`D${d.year}${String(d.month).padStart(2, '0')}${String(d.day).padStart(2, '0')}`);
    } else if (d.year && d.month) {
      parts.push(`D${d.year}${String(d.month).padStart(2, '0')}`);
    } else if (d.year) {
      parts.push(`D${d.year}`);
    }
  } else if (closeTime) {
    // Use closeTime if no date extracted
    const year = closeTime.getFullYear();
    const month = closeTime.getMonth() + 1;
    const day = closeTime.getDate();
    parts.push(`D${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`);
  }

  // Comparator
  if (comparator !== Comparator.UNKNOWN) {
    parts.push(comparator);
  }

  return {
    entities,
    numbers,
    dates,
    comparator,
    fingerprint: parts.join('|') || 'UNKNOWN',
  };
}

/**
 * Normalize title for fuzzy matching
 * Removes punctuation, lowercases, normalizes whitespace
 */
export function normalizeTitleForFuzzy(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculate date similarity score
 * Returns 1.0 for exact match, decreasing for further dates
 */
export function dateScore(dateA: ExtractedDate | undefined, dateB: ExtractedDate | undefined): number {
  if (!dateA || !dateB) return 0;

  // Both have full dates
  if (dateA.year && dateA.month && dateA.day && dateB.year && dateB.month && dateB.day) {
    const a = new Date(dateA.year, dateA.month - 1, dateA.day);
    const b = new Date(dateB.year, dateB.month - 1, dateB.day);
    const diffDays = Math.abs(a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24);

    if (diffDays === 0) return 1.0;
    if (diffDays <= 1) return 0.95;
    if (diffDays <= 7) return 0.8;
    if (diffDays <= 30) return 0.5;
    if (diffDays <= 90) return 0.2;
    return 0;
  }

  // Both have year and month
  if (dateA.year && dateA.month && dateB.year && dateB.month) {
    if (dateA.year === dateB.year && dateA.month === dateB.month) return 0.9;
    const diffMonths = Math.abs((dateA.year - dateB.year) * 12 + (dateA.month - dateB.month));
    if (diffMonths <= 1) return 0.7;
    if (diffMonths <= 3) return 0.3;
    return 0;
  }

  // Both have year only
  if (dateA.year && dateB.year) {
    if (dateA.year === dateB.year) return 0.7;
    return 0;
  }

  return 0;
}

/**
 * Calculate number similarity score
 * Returns 1.0 for exact match, decreasing for different numbers
 */
export function numberScore(numbersA: number[], numbersB: number[]): number {
  if (numbersA.length === 0 || numbersB.length === 0) return 0;

  let bestScore = 0;

  for (const a of numbersA) {
    for (const b of numbersB) {
      if (a === b) {
        bestScore = Math.max(bestScore, 1.0);
      } else {
        // Calculate relative difference
        const diff = Math.abs(a - b);
        const maxVal = Math.max(Math.abs(a), Math.abs(b));
        const relDiff = diff / maxVal;

        if (relDiff < 0.01) bestScore = Math.max(bestScore, 0.95); // Within 1%
        else if (relDiff < 0.05) bestScore = Math.max(bestScore, 0.8); // Within 5%
        else if (relDiff < 0.1) bestScore = Math.max(bestScore, 0.5); // Within 10%
      }
    }
  }

  return bestScore;
}

/**
 * Calculate entity overlap score
 * Returns ratio of shared entities
 */
export function entityScore(entitiesA: string[], entitiesB: string[]): number {
  if (entitiesA.length === 0 && entitiesB.length === 0) return 0;
  if (entitiesA.length === 0 || entitiesB.length === 0) return 0;

  const setA = new Set(entitiesA);
  const setB = new Set(entitiesB);

  let intersection = 0;
  for (const e of setA) {
    if (setB.has(e)) intersection++;
  }

  // Jaccard-like but weighted towards having any match
  const union = setA.size + setB.size - intersection;
  if (union === 0) return 0;

  // If at least one important entity matches, give high score
  if (intersection > 0) {
    // Base score from Jaccard
    const jaccard = intersection / union;
    // Boost if we have good overlap
    return Math.min(1.0, jaccard + (intersection >= 2 ? 0.3 : 0.1));
  }

  return 0;
}

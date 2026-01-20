/**
 * Fingerprint-based entity extraction for market matching
 */

import { ENTITY_ALIASES, TICKER_PATTERNS, normalizeEntity, isKnownEntity, extractEntityFromKalshiTicker, MACRO_ENTITIES, type MacroEntityKey } from './aliases.js';

/**
 * Tokenize text for entity matching
 * - Lowercase
 * - Replace all non-alphanumeric with spaces
 * - Split by whitespace
 * - Filter out empty tokens
 */
export function tokenizeForEntities(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 0);
}

/**
 * Get tokens as a Set for O(1) lookup
 */
export function tokenSetForEntities(text: string): Set<string> {
  return new Set(tokenizeForEntities(text));
}

/**
 * Check if multi-word alias matches in title using tokens
 * All alias tokens must appear as consecutive tokens in title
 */
function matchesMultiWordAlias(titleTokens: string[], aliasTokens: string[]): boolean {
  if (aliasTokens.length === 0) return false;
  if (aliasTokens.length === 1) {
    // Single token - exact match in token set
    return titleTokens.includes(aliasTokens[0]);
  }

  // Multi-word: find consecutive sequence
  const first = aliasTokens[0];
  for (let i = 0; i <= titleTokens.length - aliasTokens.length; i++) {
    if (titleTokens[i] === first) {
      let matches = true;
      for (let j = 1; j < aliasTokens.length; j++) {
        if (titleTokens[i + j] !== aliasTokens[j]) {
          matches = false;
          break;
        }
      }
      if (matches) return true;
    }
  }
  return false;
}

/**
 * Extract macro economic entities from text using token and phrase matching
 * Must be called BEFORE general entity extraction for priority
 *
 * Rules (all token-based, no substring matching):
 * - "cpi" or "consumer price index" => CPI
 * - "inflation" => CPI (mapped for MVP)
 * - "gdp" or "gross domestic product" => GDP
 * - "unemployment" or "jobless rate" => UNEMPLOYMENT
 * - "nfp" or "payrolls" or "nonfarm" phrases => NFP
 * - "fed" + ("rate" or "interest") or phrases => FED_RATE
 * - "fomc" or "federal reserve" => FOMC
 * - "pce" => PCE
 * - "pmi" => PMI
 */
export function extractMacroEntities(tokens: string[], normalizedTitle: string): Set<string> {
  const macroEntities = new Set<string>();

  // Helper to check if phrase exists in title (token-based)
  const hasPhrase = (phrase: string): boolean => {
    const phraseTokens = phrase.toLowerCase().split(/\s+/);
    if (phraseTokens.length === 1) {
      return tokens.includes(phraseTokens[0]);
    }
    // Multi-word phrase: check consecutive tokens
    const first = phraseTokens[0];
    for (let i = 0; i <= tokens.length - phraseTokens.length; i++) {
      if (tokens[i] === first) {
        let matches = true;
        for (let j = 1; j < phraseTokens.length; j++) {
          if (tokens[i + j] !== phraseTokens[j]) {
            matches = false;
            break;
          }
        }
        if (matches) return true;
      }
    }
    return false;
  };

  // Check each macro entity
  for (const key of Object.keys(MACRO_ENTITIES) as MacroEntityKey[]) {
    const entityDef = MACRO_ENTITIES[key];

    // Check single tokens
    for (const token of entityDef.tokens) {
      if (tokens.includes(token)) {
        macroEntities.add(entityDef.canonical);
        break;
      }
    }

    // Check phrases
    for (const phrase of entityDef.phrases) {
      if (hasPhrase(phrase)) {
        macroEntities.add(entityDef.canonical);
        break;
      }
    }
  }

  // Special case: "fed" + "rate" or "fed" + "interest" => FED_RATE
  // This handles cases like "Fed rate decision" where tokens aren't consecutive
  const hasFed = tokens.includes('fed') || tokens.includes('federal');
  const hasRateWord = tokens.includes('rate') || tokens.includes('rates') || tokens.includes('interest');
  if (hasFed && hasRateWord && !macroEntities.has('FED_RATE')) {
    macroEntities.add('FED_RATE');
  }

  return macroEntities;
}

/**
 * Comparator type for market conditions
 */
export enum Comparator {
  GE = 'GE',       // Greater than or equal (above, over, exceed, reach, at least)
  LE = 'LE',       // Less than or equal (below, under, less than, at most)
  BETWEEN = 'BETWEEN', // Range condition (between X and Y)
  WIN = 'WIN',     // Win/victory condition
  UNKNOWN = 'UNKNOWN',
}

/**
 * Market intent classification for matching rules
 */
export enum MarketIntent {
  PRICE_DATE = 'PRICE_DATE',   // "ETH $3700 by Jan 26" - requires strict date match
  ELECTION = 'ELECTION',       // "Trump wins 2024" - year-level match
  METRIC_DATE = 'METRIC_DATE', // "CPI above 3% in Dec" - month-level match
  GENERAL = 'GENERAL',         // Generic market - flexible date matching
}

/**
 * Date precision level
 */
export enum DatePrecision {
  DAY = 'DAY',
  MONTH = 'MONTH',
  QUARTER = 'QUARTER',
  YEAR = 'YEAR',
}

/**
 * Extracted date with optional components
 */
export interface ExtractedDate {
  year?: number;
  month?: number;
  day?: number;
  raw: string;
  precision: DatePrecision;
}

/**
 * Market fingerprint for matching
 */
export interface MarketFingerprint {
  entities: string[];
  numbers: number[];
  dates: ExtractedDate[];
  comparator: Comparator;
  intent: MarketIntent;
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
 * Uses TOKEN-BASED matching to prevent substring false positives
 * (e.g., "Hegseth" should NOT match "eth" → ETHEREUM)
 */
export function extractEntities(title: string): string[] {
  const entities = new Set<string>();

  // Tokenize the title for precise matching
  const titleTokens = tokenizeForEntities(title);
  const titleTokenSet = new Set(titleTokens);

  // Pre-tokenize all aliases (cache for performance)
  const aliasTokensMap = new Map<string, string[]>();
  for (const alias of Object.keys(ENTITY_ALIASES)) {
    aliasTokensMap.set(alias, tokenizeForEntities(alias));
  }

  // Check aliases using TOKEN matching (not substring)
  // Sort by token count descending (multi-word first)
  const sortedAliases = Object.keys(ENTITY_ALIASES).sort((a, b) => {
    const tokensA = aliasTokensMap.get(a)!;
    const tokensB = aliasTokensMap.get(b)!;
    return tokensB.length - tokensA.length;
  });

  for (const alias of sortedAliases) {
    const aliasTokens = aliasTokensMap.get(alias)!;

    if (aliasTokens.length === 1) {
      // Single-token alias: exact token match required
      if (titleTokenSet.has(aliasTokens[0])) {
        entities.add(ENTITY_ALIASES[alias]);
      }
    } else if (aliasTokens.length > 1) {
      // Multi-token alias: all tokens must appear consecutively
      if (matchesMultiWordAlias(titleTokens, aliasTokens)) {
        entities.add(ENTITY_ALIASES[alias]);
      }
    }
  }

  // Extract ticker patterns (these use word boundaries via regex)
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

  // Extract remaining known entity tokens
  for (const token of titleTokens) {
    if (token.length >= 2 && isKnownEntity(token)) {
      entities.add(normalizeEntity(token));
    }
  }

  return Array.from(entities).sort();
}

/**
 * Extract numbers from market title
 * Handles: 100k -> 100000, 3% -> 3, 175+ -> 175, $50,000 -> 50000
 * Excludes numbers that are part of dates (e.g., "Feb 1" should not extract "1")
 *
 * IMPORTANT: Single-letter multipliers (k/m/b/t) must IMMEDIATELY follow the number
 * (no whitespace), e.g., "79k", "1.2m". Word multipliers can have optional space.
 * This prevents "$79,000 to" from capturing "t" as trillion.
 */
export function extractNumbers(title: string): number[] {
  const numbers: number[] = [];
  const seen = new Set<number>();

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

  // Pattern to detect date contexts (month names followed by numbers)
  // Used to exclude numbers that are part of dates
  const dateContextPattern = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}\b/gi;
  const dateContexts = new Set<number>();
  let dateMatch;
  while ((dateMatch = dateContextPattern.exec(title)) !== null) {
    // Mark the position of the number in the date context
    const numStartInDate = dateMatch.index + dateMatch[0].lastIndexOf(' ') + 1;
    dateContexts.add(numStartInDate);
  }

  // Helper to add a number with validation
  const addNumber = (num: number, index: number, hasDollar: boolean, hasMultiplier: boolean) => {
    if (isNaN(num) || num < 1) return;

    // Skip if this number is part of a date context
    if (dateContexts.has(index) || dateContexts.has(index + 1)) {
      return;
    }

    // Skip very small numbers (1-31) that are likely date days, unless they have $ or multiplier
    if (num >= 1 && num <= 31 && !hasDollar && !hasMultiplier) {
      return;
    }

    // Skip years (handled separately in date extraction)
    if (num >= 1900 && num <= 2100) {
      return;
    }

    if (!seen.has(num)) {
      seen.add(num);
      numbers.push(num);
    }
  };

  // Pattern 1: Numbers with IMMEDIATE single-letter suffix (k/m/b/t) - NO whitespace allowed
  // Examples: "79k", "1.2m", "$100k", "5b"
  const immediateMultPattern = /\$?([\d,]+(?:\.\d+)?)([kmbt])\b/gi;
  let match;

  while ((match = immediateMultPattern.exec(title)) !== null) {
    const numStr = match[1].replace(/,/g, '');
    let num = parseFloat(numStr);
    const suffix = match[2].toLowerCase();
    const mult = multipliers[suffix] || 1;
    num *= mult;

    const hasDollar = title[match.index] === '$';
    addNumber(num, match.index, hasDollar, true);
  }

  // Pattern 2: Numbers with word multipliers (can have optional whitespace)
  // Examples: "100 thousand", "1.2 million", "$5 billion"
  const wordMultPattern = /\$?([\d,]+(?:\.\d+)?)\s*(thousand|million|billion|trillion)\b/gi;

  while ((match = wordMultPattern.exec(title)) !== null) {
    const numStr = match[1].replace(/,/g, '');
    let num = parseFloat(numStr);
    const suffix = match[2].toLowerCase();
    const mult = multipliers[suffix] || 1;
    num *= mult;

    const hasDollar = title[match.index] === '$';
    addNumber(num, match.index, hasDollar, true);
  }

  // Pattern 3: Plain numbers (with optional $ prefix, no multiplier)
  // Examples: "$79,000", "3700", "79249.99"
  const plainPattern = /\$?([\d,]+(?:\.\d+)?)\b/gi;

  while ((match = plainPattern.exec(title)) !== null) {
    // Skip if this was already captured by multiplier patterns
    // Check by looking at what follows the number
    const afterMatch = title.slice(match.index + match[0].length);
    const followedByMult = /^[kmbt]\b/i.test(afterMatch) || /^\s*(thousand|million|billion|trillion)\b/i.test(afterMatch);
    if (followedByMult) continue;

    const numStr = match[1].replace(/,/g, '');
    const num = parseFloat(numStr);
    const hasDollar = title[match.index] === '$';
    addNumber(num, match.index, hasDollar, false);
  }

  // Extract percentages separately
  const pctPattern = /([\d.]+)\s*%/g;
  while ((match = pctPattern.exec(title)) !== null) {
    const num = parseFloat(match[1]);
    if (!isNaN(num) && !seen.has(num)) {
      seen.add(num);
      numbers.push(num);
    }
  }

  // Sort
  return numbers.sort((a, b) => a - b);
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
      dates.push({ year, month, day, raw: match[0], precision: DatePrecision.DAY });
    }
  }

  // Pattern: Month Day (without year) - Dec 31, Jan 26
  const monthDayPattern = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b/gi;

  while ((match = monthDayPattern.exec(title)) !== null) {
    const monthName = match[1].toLowerCase();
    const month = MONTH_MAP[monthName] || MONTH_MAP[monthName.slice(0, 3)];
    const day = parseInt(match[2], 10);

    if (month && day >= 1 && day <= 31) {
      // Check if this wasn't already captured with a year
      const alreadyHasYear = dates.some(d => d.month === month && d.day === day && d.year);
      if (!alreadyHasYear) {
        // Infer year based on current date - assume near future
        const now = new Date();
        let year = now.getFullYear();
        const potentialDate = new Date(year, month - 1, day);
        // If date is more than 3 months in the past, assume next year
        if (potentialDate.getTime() < now.getTime() - 90 * 24 * 60 * 60 * 1000) {
          year++;
        }
        dates.push({ year, month, day, raw: match[0], precision: DatePrecision.DAY });
      }
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
        dates.push({ year, month, raw: match[0], precision: DatePrecision.MONTH });
      }
    }
  }

  // Pattern: end of YEAR, by end of YEAR, year-end YEAR
  const endOfYearPattern = /\b(?:end of|by end of|year[- ]end|eoy)\s*(\d{4})\b/gi;

  while ((match = endOfYearPattern.exec(title)) !== null) {
    const year = parseInt(match[1], 10);
    if (year >= 2020 && year <= 2030) {
      dates.push({ year, month: 12, day: 31, raw: match[0], precision: DatePrecision.YEAR });
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
        raw: match[0],
        precision: DatePrecision.QUARTER,
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
        dates.push({ year, raw: match[0], precision: DatePrecision.YEAR });
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
      dates.push({ year, month, day, raw: match[0], precision: DatePrecision.DAY });
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

  // Check for BETWEEN/range patterns first (higher priority)
  // Patterns: "between $X and $Y", "from $X to $Y", "$X-$Y range", "$X to $Y"
  const betweenPatterns = [
    /between\s+\$?[\d,]+\s+and\s+\$?[\d,]+/i,
    /from\s+\$?[\d,]+\s+to\s+\$?[\d,]+/i,
    /\$?[\d,]+\s*[-–]\s*\$?[\d,]+/,  // e.g., "$3700-$3800" or "$3700–$3800"
    /\$?[\d,]+\s+to\s+\$?[\d,]+/i,
  ];
  for (const pattern of betweenPatterns) {
    if (pattern.test(lower)) {
      return Comparator.BETWEEN;
    }
  }

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

// Crypto/price tickers for PRICE_DATE detection
const PRICE_TICKERS = ['BTC', 'BITCOIN', 'ETH', 'ETHEREUM', 'SOL', 'SOLANA', 'XRP', 'DOGE', 'ADA'];

// Election keywords for ELECTION detection
const ELECTION_KEYWORDS = ['win', 'wins', 'winner', 'elected', 'election', 'president', 'presidential', 'governor', 'senate', 'congress'];

// Metric keywords for METRIC_DATE detection
const METRIC_KEYWORDS = ['cpi', 'gdp', 'inflation', 'rate', 'unemployment', 'jobs', 'nonfarm'];

/**
 * Classify market intent based on title analysis
 * Used to determine matching strictness
 */
export function classifyIntent(
  title: string,
  entities: string[],
  numbers: number[],
  dates: ExtractedDate[],
  comparator: Comparator
): MarketIntent {
  const lower = title.toLowerCase();

  // PRICE_DATE: crypto/asset + price number + specific date
  // Examples: "ETH above $3700 by Jan 26", "BTC hits 100k by Dec 31", "ETH between $3700 and $3800 on Jan 26"
  const hasPriceTicker = entities.some(e => PRICE_TICKERS.includes(e.toUpperCase()));
  const hasSignificantNumber = numbers.some(n => n >= 1000); // Price targets usually > 1000
  const hasDayDate = dates.some(d => d.precision === DatePrecision.DAY);

  // Accept GE, LE, or BETWEEN comparators for price markets
  const hasPriceComparator = comparator === Comparator.GE || comparator === Comparator.LE || comparator === Comparator.BETWEEN;

  if (hasPriceTicker && hasSignificantNumber && hasDayDate && hasPriceComparator) {
    return MarketIntent.PRICE_DATE;
  }

  // ELECTION: election-related keywords
  if (ELECTION_KEYWORDS.some(kw => lower.includes(kw))) {
    return MarketIntent.ELECTION;
  }

  // METRIC_DATE: economic metrics with date
  if (METRIC_KEYWORDS.some(kw => lower.includes(kw)) && dates.length > 0) {
    return MarketIntent.METRIC_DATE;
  }

  return MarketIntent.GENERAL;
}

/**
 * Options for fingerprint building
 */
export interface FingerprintOptions {
  /** Market metadata (for Kalshi ticker extraction) */
  metadata?: Record<string, unknown> | null;
}

/**
 * Build a fingerprint string for a market
 * Format: ENTITIES|NUMBER|DATE|COMPARATOR
 */
export function buildFingerprint(title: string, closeTime?: Date | null, options?: FingerprintOptions): MarketFingerprint {
  const entities = extractEntities(title);
  const numbers = extractNumbers(title);
  const dates = extractDates(title);
  const comparator = extractComparator(title);

  // Extract entity from Kalshi eventTicker if available (metadata enrichment)
  if (options?.metadata) {
    const eventTicker = options.metadata.eventTicker || options.metadata.event_ticker;
    if (typeof eventTicker === 'string') {
      const tickerEntity = extractEntityFromKalshiTicker(eventTicker);
      if (tickerEntity && !entities.includes(tickerEntity)) {
        entities.push(tickerEntity);
        entities.sort(); // Keep sorted
      }
    }
  }

  const intent = classifyIntent(title, entities, numbers, dates, comparator);

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
    intent,
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
 * Strict date gating for PRICE_DATE markets
 * Returns false if dates don't match within tolerance for the given intent
 *
 * Rules:
 * - PRICE_DATE: dates must match within 2 days
 * - METRIC_DATE: dates must match within same month
 * - ELECTION: dates must match within same year
 * - GENERAL: no strict gating (always returns true)
 */
export function passesDateGate(
  dateA: ExtractedDate | undefined,
  dateB: ExtractedDate | undefined,
  intentA: MarketIntent,
  intentB: MarketIntent
): boolean {
  // If neither is a date-sensitive intent, no gating
  const strictIntents = [MarketIntent.PRICE_DATE, MarketIntent.METRIC_DATE];
  const hasStrict = strictIntents.includes(intentA) || strictIntents.includes(intentB);

  if (!hasStrict) return true;

  // If either lacks a date, can't verify - fail strict matching
  if (!dateA || !dateB) return false;

  // PRICE_DATE requires day-level match within 2 days
  if (intentA === MarketIntent.PRICE_DATE || intentB === MarketIntent.PRICE_DATE) {
    // Both must have day precision
    if (dateA.precision !== DatePrecision.DAY || dateB.precision !== DatePrecision.DAY) {
      return false;
    }
    if (!dateA.year || !dateA.month || !dateA.day || !dateB.year || !dateB.month || !dateB.day) {
      return false;
    }

    const a = new Date(dateA.year, dateA.month - 1, dateA.day);
    const b = new Date(dateB.year, dateB.month - 1, dateB.day);
    const diffDays = Math.abs(a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24);

    return diffDays <= 2;
  }

  // METRIC_DATE requires month-level match
  if (intentA === MarketIntent.METRIC_DATE || intentB === MarketIntent.METRIC_DATE) {
    if (!dateA.year || !dateA.month || !dateB.year || !dateB.month) {
      return false;
    }
    return dateA.year === dateB.year && dateA.month === dateB.month;
  }

  return true;
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

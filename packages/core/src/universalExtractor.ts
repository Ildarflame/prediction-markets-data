/**
 * Universal Entity Extractor (v3.0.16)
 *
 * Unified extraction for all market types: sports, esports, politics, finance, etc.
 * Used by Universal Hybrid Matcher for cross-venue matching.
 *
 * NOTE: Functions are prefixed with "Universal" to avoid conflicts with existing extractors.
 */

import {
  ALL_LOOKUP as ALL_TEAMS_LOOKUP,
  ESPORTS_LOOKUP,
  UFC_LOOKUP,
  TENNIS_LOOKUP,
  F1_LOOKUP,
  GOLF_LOOKUP,
} from './aliases/teams.js';

import {
  ALL_PEOPLE_LOOKUP,
  US_POLITICIANS_LOOKUP,
  INTERNATIONAL_LOOKUP,
} from './aliases/people.js';

import {
  ALL_ORGS_LOOKUP,
  LEAGUES_LOOKUP,
} from './aliases/organizations.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Comparator type for market conditions
 */
export enum UniversalComparator {
  ABOVE = 'ABOVE',       // Greater than (above, over, exceed)
  BELOW = 'BELOW',       // Less than (below, under)
  BETWEEN = 'BETWEEN',   // Range condition
  EXACT = 'EXACT',       // Exact match (at, equals)
  WIN = 'WIN',           // Win/victory condition
  UNKNOWN = 'UNKNOWN',
}

/**
 * Game/sport type classification
 */
export enum GameType {
  // Esports
  CS2 = 'CS2',
  VALORANT = 'VALORANT',
  LOL = 'LOL',
  DOTA2 = 'DOTA2',

  // Traditional sports
  NBA = 'NBA',
  NFL = 'NFL',
  MLB = 'MLB',
  NHL = 'NHL',
  SOCCER = 'SOCCER',
  TENNIS = 'TENNIS',
  GOLF = 'GOLF',
  UFC = 'UFC',
  F1 = 'F1',

  // Other
  ELECTION = 'ELECTION',
  CRYPTO = 'CRYPTO',
  MACRO = 'MACRO',
  ENTERTAINMENT = 'ENTERTAINMENT',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Market type classification
 */
export enum UniversalMarketType {
  WINNER = 'WINNER',           // Who wins (moneyline, election winner)
  SPREAD = 'SPREAD',           // Point spread / handicap
  TOTAL = 'TOTAL',             // Over/under total
  PRICE_TARGET = 'PRICE_TARGET', // Price above/below X
  YES_NO = 'YES_NO',           // Binary yes/no
  UNKNOWN = 'UNKNOWN',
}

/**
 * Numeric entity with context
 */
export interface NumberEntity {
  value: number;
  unit: string | null;       // "USD", "bps", "points", "%"
  context: string | null;    // "price", "spread", "total", "rate"
  raw: string;               // Original text: "$100K", "3.5 points"
}

/**
 * Date with precision
 */
export interface ExtractedDateUniversal {
  year?: number;
  month?: number;            // 1-12
  day?: number;              // 1-31
  raw: string;
  precision: 'DAY' | 'MONTH' | 'QUARTER' | 'YEAR';
}

/**
 * Complete extracted entities from a market title
 */
export interface UniversalEntities {
  // Named entities
  teams: string[];           // ["TEAM_VITALITY", "TEAM_FALCONS"]
  people: string[];          // ["DONALD_TRUMP", "JOE_BIDEN"]
  organizations: string[];   // ["FED", "UFC", "NBA"]

  // Numeric values
  numbers: NumberEntity[];   // [{value: 100000, unit: "USD", context: "price"}]
  percentages: number[];     // [2.5, 3.0]

  // Temporal
  dates: ExtractedDateUniversal[];

  // Context
  gameType: GameType;
  marketType: UniversalMarketType;
  comparator: UniversalComparator;

  // Metadata
  confidence: number;        // 0-1, based on extraction quality
  rawTitle: string;
  normalizedTitle: string;
  tokens: string[];

  // For debugging
  extractedFrom: {
    teams: string[];         // Original extracted strings before normalization
    people: string[];
    organizations: string[];
  };
}

// ============================================================================
// TOKENIZATION
// ============================================================================

/**
 * Normalize and tokenize title for matching
 */
export function normalizeUniversalTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/['']/g, "'")           // Normalize apostrophes
    .replace(/[^\w\s'-]/g, ' ')      // Keep alphanumeric, spaces, hyphens, apostrophes
    .replace(/\s+/g, ' ')            // Normalize whitespace
    .trim();
}

/**
 * Tokenize text for entity matching
 */
export function tokenizeUniversal(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 0);
}

// ============================================================================
// MULTI-WORD PHRASE MATCHING
// ============================================================================

/**
 * Check if phrase exists in token array (consecutive tokens)
 */
function phraseExistsInTokens(tokens: string[], phrase: string): boolean {
  const phraseTokens = tokenizeUniversal(phrase);
  if (phraseTokens.length === 0) return false;

  if (phraseTokens.length === 1) {
    return tokens.includes(phraseTokens[0]);
  }

  // Multi-word: find consecutive sequence
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
}

/**
 * Extract entities from text using a lookup map
 * Returns both canonical names and original extracted strings
 */
function extractFromLookup(
  title: string,
  tokens: string[],
  lookup: Map<string, string>
): { canonical: string[]; original: string[] } {
  const canonical = new Set<string>();
  const original: string[] = [];
  const titleLower = title.toLowerCase();

  // Sort by phrase length descending (longer phrases first)
  const entries = Array.from(lookup.entries()).sort((a, b) => b[0].length - a[0].length);

  for (const [alias, canonicalName] of entries) {
    // Skip if already found this canonical
    if (canonical.has(canonicalName)) continue;

    // Check if alias exists in title
    const aliasTokens = tokenizeUniversal(alias);

    if (aliasTokens.length === 1) {
      // Single token: exact match required
      if (tokens.includes(aliasTokens[0])) {
        canonical.add(canonicalName);
        original.push(alias);
      }
    } else {
      // Multi-word: check consecutive tokens OR substring match for hyphenated names
      if (phraseExistsInTokens(tokens, alias) || titleLower.includes(alias)) {
        canonical.add(canonicalName);
        original.push(alias);
      }
    }
  }

  return { canonical: Array.from(canonical), original };
}

// ============================================================================
// TEAM EXTRACTION
// ============================================================================

/**
 * Extract teams/players from market title
 * Includes esports, traditional sports, fighters, tennis players, etc.
 */
export function extractUniversalTeams(title: string, tokens?: string[]): { teams: string[]; original: string[] } {
  const t = tokens || tokenizeUniversal(title);
  const result = extractFromLookup(title, t, ALL_TEAMS_LOOKUP);
  return { teams: result.canonical, original: result.original };
}

/**
 * Extract only esports teams
 */
export function extractEsportsTeams(title: string, tokens?: string[]): { teams: string[]; original: string[] } {
  const t = tokens || tokenizeUniversal(title);
  const result = extractFromLookup(title, t, ESPORTS_LOOKUP);
  return { teams: result.canonical, original: result.original };
}

// ============================================================================
// PEOPLE EXTRACTION
// ============================================================================

/**
 * Extract people (politicians, celebrities, athletes) from market title
 */
export function extractUniversalPeople(title: string, tokens?: string[]): { people: string[]; original: string[] } {
  const t = tokens || tokenizeUniversal(title);
  const result = extractFromLookup(title, t, ALL_PEOPLE_LOOKUP);
  return { people: result.canonical, original: result.original };
}

/**
 * Extract only politicians
 */
export function extractPoliticians(title: string, tokens?: string[]): { people: string[]; original: string[] } {
  const t = tokens || tokenizeUniversal(title);
  const us = extractFromLookup(title, t, US_POLITICIANS_LOOKUP);
  const intl = extractFromLookup(title, t, INTERNATIONAL_LOOKUP);
  return {
    people: [...new Set([...us.canonical, ...intl.canonical])],
    original: [...us.original, ...intl.original],
  };
}

// ============================================================================
// ORGANIZATION EXTRACTION
// ============================================================================

/**
 * Extract organizations (central banks, leagues, companies)
 */
export function extractUniversalOrganizations(title: string, tokens?: string[]): { orgs: string[]; original: string[] } {
  const t = tokens || tokenizeUniversal(title);
  const result = extractFromLookup(title, t, ALL_ORGS_LOOKUP);
  return { orgs: result.canonical, original: result.original };
}

// ============================================================================
// NUMBER EXTRACTION
// ============================================================================

const MULTIPLIERS: Record<string, number> = {
  'k': 1_000,
  'thousand': 1_000,
  'm': 1_000_000,
  'million': 1_000_000,
  'b': 1_000_000_000,
  'billion': 1_000_000_000,
  't': 1_000_000_000_000,
  'trillion': 1_000_000_000_000,
};

/**
 * Extract numeric values with context
 */
export function extractUniversalNumbers(title: string): NumberEntity[] {
  const numbers: NumberEntity[] = [];
  const seen = new Set<number>();

  // Pattern: Numbers with immediate multiplier (79k, 1.2m)
  const immediateMultPattern = /\$?([\d,]+(?:\.\d+)?)([kmbt])\b/gi;
  let match;

  while ((match = immediateMultPattern.exec(title)) !== null) {
    const numStr = match[1].replace(/,/g, '');
    let value = parseFloat(numStr);
    const suffix = match[2].toLowerCase();
    const mult = MULTIPLIERS[suffix] || 1;
    value *= mult;

    const hasDollar = title[match.index] === '$';

    if (!isNaN(value) && value >= 1 && !seen.has(value)) {
      seen.add(value);
      numbers.push({
        value,
        unit: hasDollar ? 'USD' : null,
        context: hasDollar ? 'price' : null,
        raw: match[0],
      });
    }
  }

  // Pattern: Numbers with word multipliers (100 thousand, 1.2 million)
  const wordMultPattern = /\$?([\d,]+(?:\.\d+)?)\s*(thousand|million|billion|trillion)\b/gi;

  while ((match = wordMultPattern.exec(title)) !== null) {
    const numStr = match[1].replace(/,/g, '');
    let value = parseFloat(numStr);
    const suffix = match[2].toLowerCase();
    const mult = MULTIPLIERS[suffix] || 1;
    value *= mult;

    const hasDollar = title[match.index] === '$';

    if (!isNaN(value) && value >= 1 && !seen.has(value)) {
      seen.add(value);
      numbers.push({
        value,
        unit: hasDollar ? 'USD' : null,
        context: hasDollar ? 'price' : null,
        raw: match[0],
      });
    }
  }

  // Pattern: Plain numbers with $ prefix ($79,000, $3700)
  const dollarPattern = /\$([\d,]+(?:\.\d+)?)\b/g;

  while ((match = dollarPattern.exec(title)) !== null) {
    const numStr = match[1].replace(/,/g, '');
    const value = parseFloat(numStr);

    // Skip if already captured by multiplier patterns
    const afterMatch = title.slice(match.index + match[0].length);
    const followedByMult = /^[kmbt]\b/i.test(afterMatch) || /^\s*(thousand|million|billion|trillion)\b/i.test(afterMatch);
    if (followedByMult) continue;

    if (!isNaN(value) && value >= 1 && !seen.has(value)) {
      // Skip years
      if (value >= 1900 && value <= 2100) continue;

      seen.add(value);
      numbers.push({
        value,
        unit: 'USD',
        context: 'price',
        raw: match[0],
      });
    }
  }

  // Pattern: Percentages (3.5%, 2.5%)
  const pctPattern = /([\d.]+)\s*%/g;

  while ((match = pctPattern.exec(title)) !== null) {
    const value = parseFloat(match[1]);

    if (!isNaN(value) && !seen.has(value)) {
      seen.add(value);
      numbers.push({
        value,
        unit: '%',
        context: 'rate',
        raw: match[0],
      });
    }
  }

  // Pattern: Basis points (25 bps, 50bps)
  const bpsPattern = /(\d+)\s*(?:bps|basis\s+points?)\b/gi;

  while ((match = bpsPattern.exec(title)) !== null) {
    const value = parseInt(match[1], 10);

    if (!isNaN(value) && !seen.has(value)) {
      seen.add(value);
      numbers.push({
        value,
        unit: 'bps',
        context: 'rate',
        raw: match[0],
      });
    }
  }

  // Pattern: Spread values (+3.5, -7)
  const spreadPattern = /([+-]?\d+\.?\d*)\s*(point|pts|points)?\b/gi;

  while ((match = spreadPattern.exec(title)) !== null) {
    const value = parseFloat(match[1]);
    const hasPointsSuffix = !!match[2];

    // Only extract if it looks like a spread (has sign or "points")
    if (!hasPointsSuffix && !match[1].startsWith('+') && !match[1].startsWith('-')) continue;

    if (!isNaN(value) && !seen.has(Math.abs(value))) {
      // Skip years and very large numbers
      if (Math.abs(value) >= 1900 && Math.abs(value) <= 2100) continue;
      if (Math.abs(value) > 1000) continue;

      seen.add(Math.abs(value));
      numbers.push({
        value,
        unit: 'points',
        context: 'spread',
        raw: match[0],
      });
    }
  }

  return numbers;
}

// ============================================================================
// DATE EXTRACTION
// ============================================================================

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

/**
 * Extract dates from market title
 */
export function extractUniversalDates(title: string, closeTime?: Date | null): ExtractedDateUniversal[] {
  const dates: ExtractedDateUniversal[] = [];
  const seen = new Set<string>();

  const addDate = (d: ExtractedDateUniversal) => {
    const key = `${d.year}-${d.month}-${d.day}`;
    if (!seen.has(key)) {
      seen.add(key);
      dates.push(d);
    }
  };

  // Pattern: Month Day, Year (Dec 31, 2024 or December 31 2024)
  const monthDayYearPattern = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?[,\s]+(\d{4})\b/gi;
  let match;

  while ((match = monthDayYearPattern.exec(title)) !== null) {
    const monthName = match[1].toLowerCase();
    const month = MONTH_MAP[monthName] || MONTH_MAP[monthName.slice(0, 3)];
    const day = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);

    if (month && day >= 1 && day <= 31 && year >= 2020 && year <= 2035) {
      addDate({ year, month, day, raw: match[0], precision: 'DAY' });
    }
  }

  // Pattern: Month Day (without year)
  const monthDayPattern = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b/gi;

  while ((match = monthDayPattern.exec(title)) !== null) {
    const monthName = match[1].toLowerCase();
    const month = MONTH_MAP[monthName] || MONTH_MAP[monthName.slice(0, 3)];
    const day = parseInt(match[2], 10);

    if (month && day >= 1 && day <= 31) {
      // Check if already captured with year
      const hasYear = dates.some(d => d.month === month && d.day === day && d.year);
      if (!hasYear) {
        // Infer year from closeTime or current date
        const now = closeTime || new Date();
        let year = now.getFullYear();
        const potentialDate = new Date(year, month - 1, day);
        if (potentialDate.getTime() < now.getTime() - 90 * 24 * 60 * 60 * 1000) {
          year++;
        }
        addDate({ year, month, day, raw: match[0], precision: 'DAY' });
      }
    }
  }

  // Pattern: ISO format (2024-01-26)
  const isoPattern = /\b(\d{4})-(\d{2})-(\d{2})\b/g;

  while ((match = isoPattern.exec(title)) !== null) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);

    if (year >= 2020 && year <= 2035 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      addDate({ year, month, day, raw: match[0], precision: 'DAY' });
    }
  }

  // Pattern: Month Year (January 2026)
  const monthYearPattern = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{4})\b/gi;

  while ((match = monthYearPattern.exec(title)) !== null) {
    const monthName = match[1].toLowerCase();
    const month = MONTH_MAP[monthName] || MONTH_MAP[monthName.slice(0, 3)];
    const year = parseInt(match[2], 10);

    if (month && year >= 2020 && year <= 2035) {
      // Don't add if we already have a day-level date for this month
      const hasDay = dates.some(d => d.year === year && d.month === month && d.day);
      if (!hasDay) {
        addDate({ year, month, raw: match[0], precision: 'MONTH' });
      }
    }
  }

  // Pattern: Q1/Q2/Q3/Q4 Year
  const quarterPattern = /\bq([1-4])\s*(\d{4})\b/gi;
  const quarterEndMonth: Record<number, number> = { 1: 3, 2: 6, 3: 9, 4: 12 };

  while ((match = quarterPattern.exec(title)) !== null) {
    const quarter = parseInt(match[1], 10);
    const year = parseInt(match[2], 10);

    if (year >= 2020 && year <= 2035) {
      addDate({ year, month: quarterEndMonth[quarter], raw: match[0], precision: 'QUARTER' });
    }
  }

  // Pattern: Year only in deadline context
  if (dates.length === 0) {
    const yearPattern = /\b(202[0-9]|203[0-5])\b/g;

    while ((match = yearPattern.exec(title)) !== null) {
      const year = parseInt(match[1], 10);
      const beforeMatch = title.slice(Math.max(0, match.index - 20), match.index).toLowerCase();
      if (beforeMatch.includes('by') || beforeMatch.includes('in') || beforeMatch.includes('before') || beforeMatch.includes('during')) {
        addDate({ year, raw: match[0], precision: 'YEAR' });
      }
    }
  }

  return dates;
}

// ============================================================================
// COMPARATOR EXTRACTION
// ============================================================================

const ABOVE_KEYWORDS = [
  'above', 'over', 'exceed', 'exceeds', 'exceeding',
  'reach', 'reaches', 'reaching', 'hit', 'hits',
  'at least', 'greater than', 'more than', 'higher than',
  'surpass', 'surpasses', 'top', 'tops',
];

const BELOW_KEYWORDS = [
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
 * Extract comparator from market title
 */
export function extractUniversalComparator(title: string): UniversalComparator {
  const lower = title.toLowerCase();

  // Check for BETWEEN first (patterns support k/m/b suffixes)
  const numWithSuffix = '\\$?[\\d,]+(?:\\.\\d+)?[kmb]?';
  const betweenPatterns = [
    new RegExp(`between\\s+${numWithSuffix}\\s+and\\s+${numWithSuffix}`, 'i'),
    new RegExp(`from\\s+${numWithSuffix}\\s+to\\s+${numWithSuffix}`, 'i'),
    new RegExp(`${numWithSuffix}\\s*[-–]\\s*${numWithSuffix}`),
    new RegExp(`${numWithSuffix}\\s+to\\s+${numWithSuffix}`, 'i'),
  ];

  for (const pattern of betweenPatterns) {
    if (pattern.test(lower)) {
      return UniversalComparator.BETWEEN;
    }
  }

  // Check keywords
  for (const kw of ABOVE_KEYWORDS) {
    if (lower.includes(kw)) return UniversalComparator.ABOVE;
  }

  for (const kw of BELOW_KEYWORDS) {
    if (lower.includes(kw)) return UniversalComparator.BELOW;
  }

  for (const kw of WIN_KEYWORDS) {
    if (lower.includes(kw)) return UniversalComparator.WIN;
  }

  return UniversalComparator.UNKNOWN;
}

// ============================================================================
// GAME TYPE DETECTION
// ============================================================================

const GAME_TYPE_PATTERNS: [RegExp, GameType][] = [
  // Esports - be specific
  [/\b(cs2|csgo|cs:go|counter[\s-]?strike|counterstrike)\b/i, GameType.CS2],
  [/\bvalorant\b/i, GameType.VALORANT],
  [/\b(league\s+of\s+legends|lol|lck|lpl|lec|lcs)\b/i, GameType.LOL],
  [/\b(dota\s*2?|the\s+international|ti\d+)\b/i, GameType.DOTA2],

  // Traditional sports
  [/\b(nba|basketball)\b/i, GameType.NBA],
  [/\b(nfl|football|super\s+bowl)\b/i, GameType.NFL],
  [/\b(mlb|baseball|world\s+series)\b/i, GameType.MLB],
  [/\b(nhl|hockey|stanley\s+cup)\b/i, GameType.NHL],
  [/\b(soccer|football|premier\s+league|la\s+liga|bundesliga|serie\s+a|champions\s+league|epl|ucl)\b/i, GameType.SOCCER],
  [/\b(tennis|atp|wta|wimbledon|us\s+open|australian\s+open|french\s+open|grand\s+slam)\b/i, GameType.TENNIS],
  [/\b(golf|pga|lpga|masters|ryder\s+cup)\b/i, GameType.GOLF],
  [/\b(ufc|mma|fight\s+night|ppv)\b/i, GameType.UFC],
  [/\b(f1|formula\s*1|grand\s+prix)\b/i, GameType.F1],

  // Other categories
  [/\b(election|president|senate|congress|governor|vote|ballot|electoral)\b/i, GameType.ELECTION],
  [/\b(bitcoin|btc|ethereum|eth|crypto|solana|doge|xrp)\b/i, GameType.CRYPTO],
  [/\b(cpi|gdp|inflation|fed|fomc|interest\s+rate|unemployment|nfp|payrolls|pce)\b/i, GameType.MACRO],
  [/\b(oscar|grammy|emmy|golden\s+globe|movie|film|album|song)\b/i, GameType.ENTERTAINMENT],
];

/**
 * Detect game/category type from market title
 */
export function detectUniversalGameType(title: string, teams?: string[], orgs?: string[]): GameType {
  const lower = title.toLowerCase();

  // Check explicit patterns first
  for (const [pattern, gameType] of GAME_TYPE_PATTERNS) {
    if (pattern.test(lower)) {
      return gameType;
    }
  }

  // Check if we have esports team matches
  if (teams && teams.length > 0) {
    const esportsResult = extractFromLookup(title, tokenizeUniversal(title), ESPORTS_LOOKUP);
    if (esportsResult.canonical.length > 0) {
      // Try to determine specific game
      if (/vitality|falcons|navi|g2|faze|spirit|mouz|heroic|astralis|fnatic|ence/i.test(lower)) {
        return GameType.CS2;
      }
      if (/sentinels|loud|drx|paper\s+rex|gen\.?g/i.test(lower)) {
        return GameType.VALORANT;
      }
      return GameType.CS2; // Default esports to CS2
    }
  }

  // Check UFC fighters
  if (teams && teams.length > 0) {
    const ufcResult = extractFromLookup(title, tokenizeUniversal(title), UFC_LOOKUP);
    if (ufcResult.canonical.length > 0) {
      return GameType.UFC;
    }
  }

  // Check tennis players
  if (teams && teams.length > 0) {
    const tennisResult = extractFromLookup(title, tokenizeUniversal(title), TENNIS_LOOKUP);
    if (tennisResult.canonical.length > 0) {
      return GameType.TENNIS;
    }
  }

  // Check F1
  if (teams && teams.length > 0) {
    const f1Result = extractFromLookup(title, tokenizeUniversal(title), F1_LOOKUP);
    if (f1Result.canonical.length > 0) {
      return GameType.F1;
    }
  }

  // Check golf
  if (teams && teams.length > 0) {
    const golfResult = extractFromLookup(title, tokenizeUniversal(title), GOLF_LOOKUP);
    if (golfResult.canonical.length > 0) {
      return GameType.GOLF;
    }
  }

  // Check organizations for league hints
  if (orgs && orgs.length > 0) {
    const leagueResult = extractFromLookup(title, tokenizeUniversal(title), LEAGUES_LOOKUP);
    for (const league of leagueResult.canonical) {
      if (['NBA', 'NCAA_BASKETBALL'].includes(league)) return GameType.NBA;
      if (['NFL', 'NCAA_FOOTBALL'].includes(league)) return GameType.NFL;
      if (['MLB'].includes(league)) return GameType.MLB;
      if (['NHL'].includes(league)) return GameType.NHL;
      if (['EPL', 'LA_LIGA', 'BUNDESLIGA', 'SERIE_A', 'LIGUE_1', 'UCL', 'SOCCER'].includes(league)) return GameType.SOCCER;
      if (['UFC', 'BELLATOR'].includes(league)) return GameType.UFC;
      if (['ATP', 'WTA', 'GRAND_SLAM'].includes(league)) return GameType.TENNIS;
      if (['PGA', 'LPGA'].includes(league)) return GameType.GOLF;
      if (['F1', 'NASCAR'].includes(league)) return GameType.F1;
    }
  }

  return GameType.UNKNOWN;
}

// ============================================================================
// MARKET TYPE DETECTION
// ============================================================================

/**
 * Detect market type from title
 */
export function detectUniversalMarketType(title: string, comparator: UniversalComparator): UniversalMarketType {
  const lower = title.toLowerCase();

  // Spread detection
  if (/spread|handicap|\+\d+\.?\d*|\-\d+\.?\d*\s*(point|pts)?/.test(lower)) {
    return UniversalMarketType.SPREAD;
  }

  // Total detection
  if (/over\/under|over\s*\/?\s*under|total\s+(points|goals|runs)|o\/u/.test(lower)) {
    return UniversalMarketType.TOTAL;
  }

  // Price target
  if (comparator === UniversalComparator.ABOVE || comparator === UniversalComparator.BELOW) {
    if (/\$\d|price|target|reach|\bbtc\b|\beth\b|\bsol\b/i.test(lower)) {
      return UniversalMarketType.PRICE_TARGET;
    }
  }

  // Winner/Moneyline
  if (/(?:will\s+)?(.+?)\s+(win|beat|defeat)|moneyline|winner|to\s+win|vs\.?|v\.?|@/.test(lower)) {
    return UniversalMarketType.WINNER;
  }

  // Yes/No binary
  if (/\byes\b|\bno\b|will\s+.+\s+\?/.test(lower)) {
    return UniversalMarketType.YES_NO;
  }

  return UniversalMarketType.UNKNOWN;
}

// ============================================================================
// MAIN EXTRACTION FUNCTION
// ============================================================================

/**
 * Extract all entities from a market title
 */
export function extractUniversalEntities(
  title: string,
  closeTime?: Date | null,
  _metadata?: Record<string, unknown>
): UniversalEntities {
  const normalizedTitle = normalizeUniversalTitle(title);
  const tokens = tokenizeUniversal(normalizedTitle);

  // Extract entities
  const teamsResult = extractUniversalTeams(title, tokens);
  const peopleResult = extractUniversalPeople(title, tokens);
  const orgsResult = extractUniversalOrganizations(title, tokens);

  // Extract numbers and dates
  const numbers = extractUniversalNumbers(title);
  const dates = extractUniversalDates(title, closeTime);

  // Extract percentages from numbers
  const percentages = numbers
    .filter(n => n.unit === '%')
    .map(n => n.value);

  // Extract comparator
  const comparator = extractUniversalComparator(title);

  // Detect game type
  const gameType = detectUniversalGameType(title, teamsResult.teams, orgsResult.orgs);

  // Detect market type
  const marketType = detectUniversalMarketType(title, comparator);

  // Calculate confidence based on extraction quality
  let confidence = 0.5; // Base confidence
  if (teamsResult.teams.length > 0) confidence += 0.15;
  if (peopleResult.people.length > 0) confidence += 0.1;
  if (numbers.length > 0) confidence += 0.1;
  if (dates.length > 0) confidence += 0.1;
  if (gameType !== GameType.UNKNOWN) confidence += 0.05;

  return {
    teams: teamsResult.teams,
    people: peopleResult.people,
    organizations: orgsResult.orgs,
    numbers,
    percentages,
    dates,
    gameType,
    marketType,
    comparator,
    confidence: Math.min(confidence, 1.0),
    rawTitle: title,
    normalizedTitle,
    tokens,
    extractedFrom: {
      teams: teamsResult.original,
      people: peopleResult.original,
      organizations: orgsResult.original,
    },
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Calculate Jaccard similarity between two sets
 */
export function jaccardSets<T>(setA: Set<T> | T[], setB: Set<T> | T[]): number {
  const a = setA instanceof Set ? setA : new Set(setA);
  const b = setB instanceof Set ? setB : new Set(setB);

  if (a.size === 0 && b.size === 0) return 0;

  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }

  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Check if two numbers match (within tolerance)
 */
function numbersMatch(a: NumberEntity, b: NumberEntity, tolerance = 0.01): boolean {
  // Must have same unit (or both null)
  if (a.unit !== b.unit) return false;

  // Check value within tolerance (1% default)
  const diff = Math.abs(a.value - b.value);
  const maxVal = Math.max(Math.abs(a.value), Math.abs(b.value));
  if (maxVal === 0) return diff === 0;
  return diff / maxVal <= tolerance;
}

/**
 * Check if two dates match
 */
function datesMatch(a: ExtractedDateUniversal, b: ExtractedDateUniversal): boolean {
  // Year must match if both specified
  if (a.year && b.year && a.year !== b.year) return false;

  // Month must match if both specified
  if (a.month && b.month && a.month !== b.month) return false;

  // Day matching: if EITHER has day precision, require exact day match
  // This prevents "January 31" from matching "January 2026"
  const aHasDay = a.precision === 'DAY' && a.day;
  const bHasDay = b.precision === 'DAY' && b.day;

  if (aHasDay || bHasDay) {
    // If one has day and other doesn't, no match
    if (!aHasDay || !bHasDay) return false;
    // Both have days, must be equal
    if (a.day !== b.day) return false;
  }

  // At least month must match for a valid date match
  return !!(a.month && b.month && a.month === b.month);
}

/**
 * Detailed overlap result for debugging and scoring
 */
export interface EntityOverlapResult {
  total: number;
  teams: number;
  people: number;
  organizations: number;
  numbers: number;
  dates: number;
  matchedTeams: string[];
  matchedPeople: string[];
  matchedOrgs: string[];
  matchedNumbers: Array<{ a: NumberEntity; b: NumberEntity }>;
  matchedDates: Array<{ a: ExtractedDateUniversal; b: ExtractedDateUniversal }>;
}

/**
 * Count overlapping entities between two extraction results (v2 - includes numbers and dates)
 */
export function countEntityOverlap(
  entitiesA: UniversalEntities,
  entitiesB: UniversalEntities
): number {
  return countEntityOverlapDetailed(entitiesA, entitiesB).total;
}

/**
 * Get detailed overlap breakdown between two extraction results
 */
export function countEntityOverlapDetailed(
  entitiesA: UniversalEntities,
  entitiesB: UniversalEntities
): EntityOverlapResult {
  const result: EntityOverlapResult = {
    total: 0,
    teams: 0,
    people: 0,
    organizations: 0,
    numbers: 0,
    dates: 0,
    matchedTeams: [],
    matchedPeople: [],
    matchedOrgs: [],
    matchedNumbers: [],
    matchedDates: [],
  };

  // Count team overlaps
  const teamsA = new Set(entitiesA.teams);
  for (const team of entitiesB.teams) {
    if (teamsA.has(team)) {
      result.teams++;
      result.matchedTeams.push(team);
    }
  }

  // Count people overlaps
  const peopleA = new Set(entitiesA.people);
  for (const person of entitiesB.people) {
    if (peopleA.has(person)) {
      result.people++;
      result.matchedPeople.push(person);
    }
  }

  // Count org overlaps
  const orgsA = new Set(entitiesA.organizations);
  for (const org of entitiesB.organizations) {
    if (orgsA.has(org)) {
      result.organizations++;
      result.matchedOrgs.push(org);
    }
  }

  // Count number overlaps (each number can only match once)
  const usedNumbersB = new Set<number>();
  for (const numA of entitiesA.numbers) {
    for (let i = 0; i < entitiesB.numbers.length; i++) {
      if (usedNumbersB.has(i)) continue;
      const numB = entitiesB.numbers[i];
      if (numbersMatch(numA, numB)) {
        result.numbers++;
        result.matchedNumbers.push({ a: numA, b: numB });
        usedNumbersB.add(i);
        break;
      }
    }
  }

  // Count date overlaps (each date can only match once)
  const usedDatesB = new Set<number>();
  for (const dateA of entitiesA.dates) {
    for (let i = 0; i < entitiesB.dates.length; i++) {
      if (usedDatesB.has(i)) continue;
      const dateB = entitiesB.dates[i];
      if (datesMatch(dateA, dateB)) {
        result.dates++;
        result.matchedDates.push({ a: dateA, b: dateB });
        usedDatesB.add(i);
        break;
      }
    }
  }

  result.total = result.teams + result.people + result.organizations + result.numbers + result.dates;
  return result;
}

// Re-export with short aliases for convenience (internal use)
export {
  extractUniversalTeams as extractTeams,
  extractUniversalPeople as extractPeople,
  extractUniversalOrganizations as extractOrganizations,
  extractUniversalNumbers as extractNumbers,
  extractUniversalDates as extractDates,
  extractUniversalComparator as extractComparator,
  detectUniversalGameType as detectGameType,
  detectUniversalMarketType as detectMarketType,
  normalizeUniversalTitle as normalizeTitle,
  tokenizeUniversal as tokenize,
};

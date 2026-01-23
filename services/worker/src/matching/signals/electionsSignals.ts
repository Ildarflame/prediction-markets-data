/**
 * Elections Signals Extraction (v3.0.10)
 *
 * Extracts structured signals from political/election markets.
 * Used for cross-venue matching of presidential, senate, governor races.
 *
 * v3.0.10: Added more countries (Malaysia, Latvia, Lebanon, Mexico, Brazil, India, Japan, South Korea, Philippines)
 *          Fixed governorship detection
 *          Added PM abbreviation detection
 *          Fixed state extraction to use word boundaries (no more "presidential" → Alabama)
 *          Fixed intent priority (MARGIN/NOMINEE checked before WINNER)
 *          Added raceKey for diagnostics
 */

import { tokenizeForEntities } from '@data-module/core';
import type { EligibleMarket } from '@data-module/db';

/**
 * Countries for election markets
 */
export enum ElectionCountry {
  US = 'US',
  UK = 'UK',
  FRANCE = 'FRANCE',
  GERMANY = 'GERMANY',
  CANADA = 'CANADA',
  AUSTRALIA = 'AUSTRALIA',
  // v3.0.10: Added more countries
  MALAYSIA = 'MALAYSIA',
  LATVIA = 'LATVIA',
  LEBANON = 'LEBANON',
  MEXICO = 'MEXICO',
  BRAZIL = 'BRAZIL',
  INDIA = 'INDIA',
  JAPAN = 'JAPAN',
  SOUTH_KOREA = 'SOUTH_KOREA',
  PHILIPPINES = 'PHILIPPINES',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Office types
 */
export enum ElectionOffice {
  PRESIDENT = 'PRESIDENT',
  VICE_PRESIDENT = 'VICE_PRESIDENT',
  SENATE = 'SENATE',
  HOUSE = 'HOUSE',
  GOVERNOR = 'GOVERNOR',
  PRIME_MINISTER = 'PRIME_MINISTER',
  MAYOR = 'MAYOR',
  PARTY_CONTROL = 'PARTY_CONTROL',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Market intent for elections
 */
export enum ElectionIntent {
  WINNER = 'WINNER',           // Who will win
  MARGIN = 'MARGIN',           // Win margin/popular vote
  TURNOUT = 'TURNOUT',         // Voter turnout
  PARTY_CONTROL = 'PARTY_CONTROL', // Which party controls
  NOMINEE = 'NOMINEE',         // Who will be nominated
  UNKNOWN = 'UNKNOWN',
}

/**
 * Country keywords
 */
export const COUNTRY_KEYWORDS: Record<ElectionCountry, string[]> = {
  [ElectionCountry.US]: [
    'united states', 'america', 'us ', 'usa', 'u.s.',
    'american', 'federal', 'congress', 'senate', 'white house',
  ],
  [ElectionCountry.UK]: [
    'united kingdom', 'britain', 'british', 'uk ', 'u.k.',
    'england', 'parliament', 'westminster', 'downing street',
  ],
  [ElectionCountry.FRANCE]: [
    'france', 'french', 'elysee', 'macron', 'le pen',
  ],
  [ElectionCountry.GERMANY]: [
    'germany', 'german', 'bundestag', 'chancellor',
  ],
  [ElectionCountry.CANADA]: [
    'canada', 'canadian', 'trudeau', 'ottawa',
  ],
  [ElectionCountry.AUSTRALIA]: [
    'australia', 'australian', 'canberra',
  ],
  // v3.0.10: Added more countries
  [ElectionCountry.MALAYSIA]: [
    'malaysia', 'malaysian', 'kuala lumpur',
  ],
  [ElectionCountry.LATVIA]: [
    'latvia', 'latvian', 'riga',
  ],
  [ElectionCountry.LEBANON]: [
    'lebanon', 'lebanese', 'beirut', 'hezbollah',
  ],
  [ElectionCountry.MEXICO]: [
    'mexico', 'mexican',
  ],
  [ElectionCountry.BRAZIL]: [
    'brazil', 'brazilian', 'bolsonaro', 'lula',
  ],
  [ElectionCountry.INDIA]: [
    'india', 'indian', 'modi', 'lok sabha',
  ],
  [ElectionCountry.JAPAN]: [
    'japan', 'japanese', 'diet',
  ],
  [ElectionCountry.SOUTH_KOREA]: [
    'south korea', 'korean', 'seoul',
  ],
  [ElectionCountry.PHILIPPINES]: [
    'philippines', 'filipino', 'duterte', 'marcos',
  ],
  [ElectionCountry.UNKNOWN]: [],
};

/**
 * Office keywords
 */
export const OFFICE_KEYWORDS: Record<ElectionOffice, string[]> = {
  [ElectionOffice.PRESIDENT]: [
    'president', 'presidential', 'potus', 'commander in chief',
    'white house', 'oval office',
  ],
  [ElectionOffice.VICE_PRESIDENT]: [
    'vice president', 'vp ', 'veep', 'running mate',
  ],
  [ElectionOffice.SENATE]: [
    'senate', 'senator', 'senatorial',
  ],
  [ElectionOffice.HOUSE]: [
    'house', 'congress', 'congressional', 'representative',
    'house of representatives',
  ],
  [ElectionOffice.GOVERNOR]: [
    'governor', 'governorship', 'gubernatorial', 'state house',
  ],
  [ElectionOffice.PRIME_MINISTER]: [
    'prime minister', 'premier',
  ],
  [ElectionOffice.MAYOR]: [
    'mayor', 'mayoral', 'city hall',
  ],
  [ElectionOffice.PARTY_CONTROL]: [
    'control', 'flip', 'majority', 'trifecta',
  ],
  [ElectionOffice.UNKNOWN]: [],
};

/**
 * Intent keywords
 */
export const INTENT_KEYWORDS: Record<ElectionIntent, string[]> = {
  [ElectionIntent.WINNER]: [
    'win', 'wins', 'winner', 'winning', 'elected', 'become',
    'next president', 'next governor', 'next senator',
  ],
  [ElectionIntent.MARGIN]: [
    'margin', 'popular vote', 'electoral vote', 'landslide',
    'close race', 'by how many', 'vote share',
  ],
  [ElectionIntent.TURNOUT]: [
    'turnout', 'voter turnout', 'participation', 'how many vote',
  ],
  [ElectionIntent.PARTY_CONTROL]: [
    'control', 'majority', 'flip', 'hold', 'keep',
    'republicans control', 'democrats control',
  ],
  [ElectionIntent.NOMINEE]: [
    'nominee', 'nomination', 'primary', 'nominated',
    'republican nominee', 'democratic nominee',
  ],
  [ElectionIntent.UNKNOWN]: [],
};

/**
 * Major candidates database (2024-2026)
 */
export const CANDIDATES: Record<string, string[]> = {
  // US Presidents/Candidates
  'TRUMP': ['trump', 'donald trump', 'donald j trump', 'djt'],
  'BIDEN': ['biden', 'joe biden', 'joseph biden'],
  'HARRIS': ['harris', 'kamala harris', 'kamala'],
  'DESANTIS': ['desantis', 'ron desantis'],
  'HALEY': ['haley', 'nikki haley'],
  'NEWSOM': ['newsom', 'gavin newsom'],
  'VANCE': ['vance', 'jd vance', 'j.d. vance'],
  'RAMASWAMY': ['ramaswamy', 'vivek ramaswamy', 'vivek'],
  'PENCE': ['pence', 'mike pence'],
  'RFK_JR': ['rfk', 'kennedy', 'robert kennedy', 'rfk jr'],
  // UK
  'SUNAK': ['sunak', 'rishi sunak'],
  'STARMER': ['starmer', 'keir starmer'],
  // France
  'MACRON': ['macron', 'emmanuel macron'],
  'LE_PEN': ['le pen', 'marine le pen'],
};

/**
 * US State abbreviations and names
 */
export const US_STATES: Record<string, string[]> = {
  'AL': ['alabama', 'al '],
  'AK': ['alaska', 'ak '],
  'AZ': ['arizona', 'az '],
  'AR': ['arkansas', 'ar '],
  'CA': ['california', 'ca ', 'calif'],
  'CO': ['colorado', 'co '],
  'CT': ['connecticut', 'ct '],
  'DE': ['delaware', 'de '],
  'FL': ['florida', 'fl '],
  'GA': ['georgia', 'ga '],
  'HI': ['hawaii', 'hi '],
  'ID': ['idaho', 'id '],
  'IL': ['illinois', 'il '],
  'IN': ['indiana', 'in '],
  'IA': ['iowa', 'ia '],
  'KS': ['kansas', 'ks '],
  'KY': ['kentucky', 'ky '],
  'LA': ['louisiana', 'la '],
  'ME': ['maine', 'me '],
  'MD': ['maryland', 'md '],
  'MA': ['massachusetts', 'ma ', 'mass'],
  'MI': ['michigan', 'mi '],
  'MN': ['minnesota', 'mn '],
  'MS': ['mississippi', 'ms '],
  'MO': ['missouri', 'mo '],
  'MT': ['montana', 'mt '],
  'NE': ['nebraska', 'ne '],
  'NV': ['nevada', 'nv '],
  'NH': ['new hampshire', 'nh '],
  'NJ': ['new jersey', 'nj '],
  'NM': ['new mexico', 'nm '],
  'NY': ['new york', 'ny '],
  'NC': ['north carolina', 'nc '],
  'ND': ['north dakota', 'nd '],
  'OH': ['ohio', 'oh '],
  'OK': ['oklahoma', 'ok '],
  'OR': ['oregon', 'or '],
  'PA': ['pennsylvania', 'pa '],
  'RI': ['rhode island', 'ri '],
  'SC': ['south carolina', 'sc '],
  'SD': ['south dakota', 'sd '],
  'TN': ['tennessee', 'tn '],
  'TX': ['texas', 'tx '],
  'UT': ['utah', 'ut '],
  'VT': ['vermont', 'vt '],
  'VA': ['virginia', 'va '],
  'WA': ['washington', 'wa ', 'wash'],
  'WV': ['west virginia', 'wv '],
  'WI': ['wisconsin', 'wi '],
  'WY': ['wyoming', 'wy '],
  'DC': ['district of columbia', 'dc ', 'd.c.', 'washington dc'],
};

/**
 * Elections signals extracted from a market
 */
export interface ElectionsSignals {
  /** Country */
  country: ElectionCountry;
  /** Office being contested */
  office: ElectionOffice;
  /** Election year */
  year: number | null;
  /** US State (if applicable) */
  state: string | null;
  /** Candidates mentioned */
  candidates: string[];
  /** Market intent */
  intent: ElectionIntent;
  /** Party mentioned (REPUBLICAN, DEMOCRAT, etc.) */
  party: string | null;
  /** Raw title tokens */
  titleTokens: string[];
  /** Confidence in extraction */
  confidence: number;
  /** v3.0.10: Race key for indexing/diagnostics (country+office+year+state) */
  raceKey: string;
}

/**
 * Extract country from title
 */
export function extractCountry(title: string): ElectionCountry {
  const lower = title.toLowerCase();

  // Default to US if no explicit country and has US-specific terms
  // v3.0.10: Added presidency, congressional
  const usTerms = ['president', 'presidency', 'congress', 'congressional', 'senate', 'governor', 'electoral'];
  const hasUsTerm = usTerms.some(t => lower.includes(t));

  for (const [country, keywords] of Object.entries(COUNTRY_KEYWORDS)) {
    if (country === ElectionCountry.UNKNOWN) continue;

    for (const keyword of keywords) {
      if (lower.includes(keyword.toLowerCase())) {
        return country as ElectionCountry;
      }
    }
  }

  // Default to US if has US-specific terms
  if (hasUsTerm) {
    return ElectionCountry.US;
  }

  return ElectionCountry.UNKNOWN;
}

/**
 * Extract office from title
 * v3.0.10: Special handling for PM abbreviation
 */
export function extractOffice(title: string): ElectionOffice {
  const lower = title.toLowerCase();

  // v3.0.10: Special case for "PM" abbreviation (word boundary)
  if (/\bpm\b/i.test(title)) {
    return ElectionOffice.PRIME_MINISTER;
  }

  for (const [office, keywords] of Object.entries(OFFICE_KEYWORDS)) {
    if (office === ElectionOffice.UNKNOWN) continue;

    for (const keyword of keywords) {
      const pattern = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'i');
      if (pattern.test(lower)) {
        return office as ElectionOffice;
      }
    }
  }

  return ElectionOffice.UNKNOWN;
}

/**
 * Extract election intent
 * v3.0.10: Check specific intents before generic WINNER to avoid false positives
 */
export function extractIntent(title: string): ElectionIntent {
  const lower = title.toLowerCase();

  // v3.0.10: Check in priority order - more specific intents first
  // This prevents "landslide" being overshadowed by "win" or "primary winner" by "winner"
  const intentPriority: ElectionIntent[] = [
    ElectionIntent.MARGIN,      // Check first: landslide, vote share, etc.
    ElectionIntent.NOMINEE,     // Check second: primary, nomination, etc.
    ElectionIntent.TURNOUT,     // Check third: voter turnout
    ElectionIntent.PARTY_CONTROL, // Check fourth: control, majority
    ElectionIntent.WINNER,      // Check last: generic win/wins/winner
  ];

  for (const intent of intentPriority) {
    const keywords = INTENT_KEYWORDS[intent];
    if (!keywords) continue;

    for (const keyword of keywords) {
      if (lower.includes(keyword.toLowerCase())) {
        return intent;
      }
    }
  }

  // Default to WINNER if office detected
  const office = extractOffice(title);
  if (office !== ElectionOffice.UNKNOWN) {
    return ElectionIntent.WINNER;
  }

  return ElectionIntent.UNKNOWN;
}

/**
 * Extract year from title
 */
export function extractElectionYear(title: string, closeTime?: Date | null): number | null {
  // Look for explicit year
  const yearMatch = title.match(/\b(202[4-9]|203[0-9])\b/);
  if (yearMatch) {
    return parseInt(yearMatch[1], 10);
  }

  // Derive from closeTime
  if (closeTime) {
    return closeTime.getFullYear();
  }

  return null;
}

/**
 * Extract US state from title
 * v3.0.10: Use word boundaries to avoid false positives (e.g., "presidential" matching "AL")
 */
export function extractState(title: string): string | null {
  const lower = title.toLowerCase();

  for (const [abbrev, keywords] of Object.entries(US_STATES)) {
    for (const keyword of keywords) {
      // v3.0.10: Use word boundary regex to prevent false positives
      // Remove trailing space from keyword pattern if present
      const cleanKeyword = keyword.trim();
      const pattern = new RegExp(`\\b${cleanKeyword}\\b`, 'i');
      if (pattern.test(lower)) {
        return abbrev;
      }
    }
  }

  return null;
}

/**
 * Extract candidates from title
 */
export function extractCandidates(title: string): string[] {
  const lower = title.toLowerCase();
  const found: string[] = [];

  for (const [candidateKey, aliases] of Object.entries(CANDIDATES)) {
    for (const alias of aliases) {
      const pattern = new RegExp(`\\b${alias.replace(/\s+/g, '\\s+')}\\b`, 'i');
      if (pattern.test(lower)) {
        found.push(candidateKey);
        break; // Only add once per candidate
      }
    }
  }

  return found;
}

/**
 * Extract party from title
 */
export function extractParty(title: string): string | null {
  const lower = title.toLowerCase();

  // v3.0.10: Added plural forms
  if (/\b(republican|republicans|gop|red)\b/i.test(lower)) {
    return 'REPUBLICAN';
  }
  if (/\b(democrat|democrats|democratic|blue)\b/i.test(lower)) {
    return 'DEMOCRAT';
  }
  if (/\b(independent|third party)\b/i.test(lower)) {
    return 'INDEPENDENT';
  }
  if (/\b(conservative|tory|tories)\b/i.test(lower)) {
    return 'CONSERVATIVE';
  }
  if (/\b(labour|labor)\b/i.test(lower)) {
    return 'LABOUR';
  }

  return null;
}

/**
 * Extract all elections signals from a market
 */
export function extractElectionsSignals(market: EligibleMarket): ElectionsSignals {
  const title = market.title;
  const closeTime = market.closeTime;

  const country = extractCountry(title);
  const office = extractOffice(title);
  const year = extractElectionYear(title, closeTime);
  const state = extractState(title);
  const candidates = extractCandidates(title);
  const intent = extractIntent(title);
  const party = extractParty(title);
  const titleTokens = tokenizeForEntities(title);

  // Calculate confidence
  let confidence = 0;
  if (country !== ElectionCountry.UNKNOWN) confidence += 0.25;
  if (office !== ElectionOffice.UNKNOWN) confidence += 0.25;
  if (year !== null) confidence += 0.15;
  if (candidates.length > 0) confidence += 0.20;
  if (intent !== ElectionIntent.UNKNOWN) confidence += 0.15;

  // v3.0.10: Build raceKey for indexing/diagnostics
  const raceKeyParts = [country, office, year ?? 'null'];
  if (state) raceKeyParts.push(state);
  const raceKey = raceKeyParts.join('|');

  return {
    country,
    office,
    year,
    state,
    candidates,
    intent,
    party,
    titleTokens,
    confidence,
    raceKey,
  };
}

/**
 * Check if a market is likely an elections market
 */
export function isElectionsMarket(title: string): boolean {
  const lower = title.toLowerCase();

  // Must have election-related keywords
  const electionKeywords = [
    'election', 'president', 'senate', 'congress', 'governor',
    'vote', 'ballot', 'electoral', 'primary', 'nominee',
    'republican', 'democrat', 'trump', 'biden', 'harris',
  ];

  return electionKeywords.some(kw => lower.includes(kw));
}

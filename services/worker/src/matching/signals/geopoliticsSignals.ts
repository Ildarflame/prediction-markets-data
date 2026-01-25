/**
 * Geopolitics Signals Extraction (v3.1.0)
 *
 * Extracts structured signals from geopolitical markets.
 * Used for cross-venue matching of war, peace, sanctions, and international relations markets.
 */

import { tokenizeForEntities } from '@data-module/core';
import type { EligibleMarket } from '@data-module/db';

/**
 * Geopolitical regions
 */
export enum GeopoliticsRegion {
  UKRAINE = 'UKRAINE',
  RUSSIA = 'RUSSIA',
  CHINA = 'CHINA',
  MIDDLE_EAST = 'MIDDLE_EAST',
  EUROPE = 'EUROPE',
  ASIA = 'ASIA',
  AMERICAS = 'AMERICAS',
  AFRICA = 'AFRICA',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Event types for geopolitical markets
 */
export enum GeopoliticsEventType {
  WAR = 'WAR',
  PEACE = 'PEACE',
  SANCTIONS = 'SANCTIONS',
  LEADERSHIP = 'LEADERSHIP',
  TERRITORY = 'TERRITORY',
  MILITARY = 'MILITARY',
  DIPLOMACY = 'DIPLOMACY',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Region keywords for detection
 */
export const REGION_KEYWORDS: Record<GeopoliticsRegion, string[]> = {
  [GeopoliticsRegion.UKRAINE]: [
    'ukraine', 'ukrainian', 'kyiv', 'kiev', 'zelensky', 'zelenskyy',
    'donbas', 'donbass', 'crimea', 'kharkiv', 'odessa', 'lviv',
  ],
  [GeopoliticsRegion.RUSSIA]: [
    'russia', 'russian', 'moscow', 'putin', 'kremlin',
    'soviet', 'siberia', 'medvedev',
  ],
  [GeopoliticsRegion.CHINA]: [
    'china', 'chinese', 'beijing', 'xi jinping', 'xi', 'ccp',
    'taiwan', 'prc', 'hong kong', 'tibet', 'xinjiang',
  ],
  [GeopoliticsRegion.MIDDLE_EAST]: [
    'israel', 'israeli', 'gaza', 'hamas', 'iran', 'iranian',
    'yemen', 'hezbollah', 'syria', 'syrian', 'lebanon', 'lebanese',
    'iraq', 'iraqi', 'saudi', 'saudi arabia', 'turkey', 'turkish',
    'palestine', 'palestinian', 'west bank', 'netanyahu',
  ],
  [GeopoliticsRegion.EUROPE]: [
    'eu', 'european union', 'nato', 'france', 'french', 'macron',
    'germany', 'german', 'merkel', 'scholz', 'uk', 'britain', 'british',
    'poland', 'polish', 'italy', 'italian', 'spain', 'spanish',
  ],
  [GeopoliticsRegion.ASIA]: [
    'india', 'indian', 'modi', 'pakistan', 'pakistani',
    'north korea', 'kim jong', 'pyongyang', 'south korea', 'korean', 'seoul',
    'japan', 'japanese', 'tokyo', 'philippines', 'vietnam', 'thailand',
  ],
  [GeopoliticsRegion.AMERICAS]: [
    'canada', 'canadian', 'trudeau', 'mexico', 'mexican',
    'brazil', 'brazilian', 'venezuela', 'cuba', 'latin america',
  ],
  [GeopoliticsRegion.AFRICA]: [
    'africa', 'african', 'egypt', 'egyptian', 'south africa',
    'nigeria', 'ethiopia', 'sudan', 'libya', 'libyan',
  ],
  [GeopoliticsRegion.UNKNOWN]: [],
};

/**
 * Event type keywords
 */
export const EVENT_TYPE_KEYWORDS: Record<GeopoliticsEventType, string[]> = {
  [GeopoliticsEventType.WAR]: [
    'war', 'warfare', 'invasion', 'invade', 'invading',
    'conflict', 'attack', 'offensive', 'battle', 'combat',
    'fighting', 'hostilities', 'assault',
  ],
  [GeopoliticsEventType.PEACE]: [
    'peace', 'ceasefire', 'truce', 'armistice',
    'negotiation', 'negotiate', 'deal', 'treaty', 'agreement',
    'settlement', 'diplomatic', 'talks', 'summit',
  ],
  [GeopoliticsEventType.SANCTIONS]: [
    'sanction', 'sanctions', 'embargo', 'tariff', 'tariffs',
    'trade war', 'trade ban', 'economic pressure', 'restriction',
  ],
  [GeopoliticsEventType.LEADERSHIP]: [
    'resign', 'resignation', 'step down', 'overthrow', 'overthrown',
    'coup', 'election', 'leader', 'president', 'prime minister',
    'removed', 'removal', 'impeach', 'impeachment', 'succession',
  ],
  [GeopoliticsEventType.TERRITORY]: [
    'territory', 'territorial', 'annex', 'annexation',
    'occupation', 'occupy', 'occupied', 'border', 'borders',
    'sovereignty', 'independence', 'secession', 'separatist',
  ],
  [GeopoliticsEventType.MILITARY]: [
    'military', 'troops', 'soldiers', 'army', 'forces',
    'deploy', 'deployment', 'mobilization', 'missile', 'missiles',
    'nuclear', 'weapon', 'weapons', 'defense', 'defence',
  ],
  [GeopoliticsEventType.DIPLOMACY]: [
    'diplomacy', 'diplomat', 'diplomatic', 'embassy',
    'ambassador', 'relations', 'alliance', 'ally', 'allies',
    'cooperation', 'partnership',
  ],
  [GeopoliticsEventType.UNKNOWN]: [],
};

/**
 * Key actors in geopolitics
 */
export const ACTORS: Record<string, string[]> = {
  // Russia/Ukraine
  'PUTIN': ['putin', 'vladimir putin'],
  'ZELENSKY': ['zelensky', 'zelenskyy', 'volodymyr zelensky'],
  'LAVROV': ['lavrov', 'sergei lavrov'],
  // China
  'XI': ['xi jinping', 'xi', 'jinping'],
  // Middle East
  'NETANYAHU': ['netanyahu', 'bibi'],
  'SINWAR': ['sinwar', 'yahya sinwar'],
  'KHAMENEI': ['khamenei', 'ayatollah'],
  // Europe
  'MACRON': ['macron', 'emmanuel macron'],
  'SCHOLZ': ['scholz', 'olaf scholz'],
  // US
  'TRUMP': ['trump', 'donald trump'],
  'BIDEN': ['biden', 'joe biden'],
};

/**
 * Countries list for extraction
 */
export const COUNTRIES: Record<string, string[]> = {
  'UKRAINE': ['ukraine', 'ukrainian'],
  'RUSSIA': ['russia', 'russian'],
  'CHINA': ['china', 'chinese'],
  'TAIWAN': ['taiwan', 'taiwanese'],
  'ISRAEL': ['israel', 'israeli'],
  'IRAN': ['iran', 'iranian'],
  'GAZA': ['gaza'],
  'YEMEN': ['yemen', 'yemeni'],
  'SYRIA': ['syria', 'syrian'],
  'LEBANON': ['lebanon', 'lebanese'],
  'NORTH_KOREA': ['north korea', 'dprk'],
  'SOUTH_KOREA': ['south korea', 'rok'],
  'INDIA': ['india', 'indian'],
  'PAKISTAN': ['pakistan', 'pakistani'],
  'TURKEY': ['turkey', 'turkish', 'turkiye'],
  'POLAND': ['poland', 'polish'],
  'GERMANY': ['germany', 'german'],
  'FRANCE': ['france', 'french'],
  'UK': ['uk', 'britain', 'british', 'england'],
  'NATO': ['nato'],
  'EU': ['eu', 'european union'],
};

/**
 * Geopolitics signals extracted from a market
 */
export interface GeopoliticsSignals {
  /** Primary region */
  region: GeopoliticsRegion;
  /** All regions mentioned */
  regions: GeopoliticsRegion[];
  /** Countries mentioned */
  countries: string[];
  /** Event type */
  eventType: GeopoliticsEventType;
  /** Actors mentioned (e.g., Putin, Zelensky) */
  actors: string[];
  /** Year if mentioned */
  year: number | null;
  /** Deadline phrase if present (e.g., 'by March', 'before summer') */
  deadline: string | null;
  /** Raw title tokens */
  titleTokens: string[];
  /** Confidence in extraction */
  confidence: number;
}

/**
 * Extract region from title
 */
export function extractRegion(title: string): GeopoliticsRegion {
  const lower = title.toLowerCase();

  for (const [region, keywords] of Object.entries(REGION_KEYWORDS)) {
    if (region === GeopoliticsRegion.UNKNOWN) continue;

    for (const keyword of keywords) {
      const pattern = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'i');
      if (pattern.test(lower)) {
        return region as GeopoliticsRegion;
      }
    }
  }

  return GeopoliticsRegion.UNKNOWN;
}

/**
 * Extract all regions from title
 */
export function extractAllRegions(title: string): GeopoliticsRegion[] {
  const lower = title.toLowerCase();
  const found: GeopoliticsRegion[] = [];

  for (const [region, keywords] of Object.entries(REGION_KEYWORDS)) {
    if (region === GeopoliticsRegion.UNKNOWN) continue;

    for (const keyword of keywords) {
      const pattern = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'i');
      if (pattern.test(lower)) {
        if (!found.includes(region as GeopoliticsRegion)) {
          found.push(region as GeopoliticsRegion);
        }
        break;
      }
    }
  }

  return found;
}

/**
 * Extract event type from title
 */
export function extractEventType(title: string): GeopoliticsEventType {
  const lower = title.toLowerCase();

  // Check in priority order
  const priority: GeopoliticsEventType[] = [
    GeopoliticsEventType.PEACE,      // Check specific events first
    GeopoliticsEventType.SANCTIONS,
    GeopoliticsEventType.LEADERSHIP,
    GeopoliticsEventType.TERRITORY,
    GeopoliticsEventType.WAR,        // WAR is more generic, check later
    GeopoliticsEventType.MILITARY,
    GeopoliticsEventType.DIPLOMACY,
  ];

  for (const eventType of priority) {
    const keywords = EVENT_TYPE_KEYWORDS[eventType];
    for (const keyword of keywords) {
      const pattern = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'i');
      if (pattern.test(lower)) {
        return eventType;
      }
    }
  }

  return GeopoliticsEventType.UNKNOWN;
}

/**
 * Extract countries from title
 */
export function extractCountries(title: string): string[] {
  const lower = title.toLowerCase();
  const found: string[] = [];

  for (const [country, aliases] of Object.entries(COUNTRIES)) {
    for (const alias of aliases) {
      const pattern = new RegExp(`\\b${alias.replace(/\s+/g, '\\s+')}\\b`, 'i');
      if (pattern.test(lower)) {
        if (!found.includes(country)) {
          found.push(country);
        }
        break;
      }
    }
  }

  return found;
}

/**
 * Extract actors from title
 */
export function extractActors(title: string): string[] {
  const lower = title.toLowerCase();
  const found: string[] = [];

  for (const [actor, aliases] of Object.entries(ACTORS)) {
    for (const alias of aliases) {
      const pattern = new RegExp(`\\b${alias.replace(/\s+/g, '\\s+')}\\b`, 'i');
      if (pattern.test(lower)) {
        if (!found.includes(actor)) {
          found.push(actor);
        }
        break;
      }
    }
  }

  return found;
}

/**
 * Extract year from title
 */
export function extractYear(title: string, closeTime?: Date | null): number | null {
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
 * Extract deadline phrase from title
 */
export function extractDeadline(title: string): string | null {
  const lower = title.toLowerCase();

  // Patterns for deadlines
  const patterns = [
    /\bby\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
    /\bbefore\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
    /\bby\s+(spring|summer|fall|autumn|winter)\b/i,
    /\bbefore\s+(spring|summer|fall|autumn|winter)\b/i,
    /\bby\s+end\s+of\s+(january|february|march|april|may|june|july|august|september|october|november|december|\d{4})\b/i,
    /\bbefore\s+\d{4}\b/i,
    /\bby\s+\d{4}\b/i,
    /\bin\s+\d{4}\b/i,
  ];

  for (const pattern of patterns) {
    const match = lower.match(pattern);
    if (match) {
      return match[0];
    }
  }

  return null;
}

/**
 * Extract all geopolitics signals from a market
 */
export function extractGeopoliticsSignals(market: EligibleMarket): GeopoliticsSignals {
  const title = market.title;
  const closeTime = market.closeTime;

  const region = extractRegion(title);
  const regions = extractAllRegions(title);
  const countries = extractCountries(title);
  const eventType = extractEventType(title);
  const actors = extractActors(title);
  const year = extractYear(title, closeTime);
  const deadline = extractDeadline(title);
  const titleTokens = tokenizeForEntities(title);

  // Calculate confidence
  let confidence = 0;
  if (region !== GeopoliticsRegion.UNKNOWN) confidence += 0.25;
  if (countries.length > 0) confidence += 0.25;
  if (eventType !== GeopoliticsEventType.UNKNOWN) confidence += 0.20;
  if (actors.length > 0) confidence += 0.15;
  if (year !== null) confidence += 0.10;
  if (deadline !== null) confidence += 0.05;

  return {
    region,
    regions,
    countries,
    eventType,
    actors,
    year,
    deadline,
    titleTokens,
    confidence,
  };
}

/**
 * Check if a market is likely a geopolitics market
 */
export function isGeopoliticsMarket(title: string): boolean {
  const lower = title.toLowerCase();

  // Must have geopolitics-related keywords
  const geopoliticsKeywords = [
    'war', 'peace', 'ceasefire', 'invasion', 'conflict', 'sanctions',
    'ukraine', 'russia', 'china', 'taiwan', 'israel', 'gaza', 'iran',
    'nato', 'military', 'troops', 'territory', 'treaty', 'negotiation',
    'putin', 'zelensky', 'xi', 'netanyahu', 'hezbollah', 'hamas',
  ];

  return geopoliticsKeywords.some(kw => lower.includes(kw));
}

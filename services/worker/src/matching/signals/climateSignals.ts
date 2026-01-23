/**
 * Climate Signals Extraction (v3.0.10)
 *
 * Extracts climate-specific features from market titles for matching:
 * - Climate kind (hurricane, temperature, snow, flood, etc.)
 * - Region (US state, country, city)
 * - Date/period (exact day, month, range)
 * - Thresholds (temperature, rainfall, wind speed with units)
 * - Comparator (GE, LE, BETWEEN)
 */

import type { EligibleMarket } from '@data-module/db';
import type { BaseSignals } from '../engineV3.types.js';

// ============================================================================
// ENUMS & TYPES
// ============================================================================

export enum ClimateKind {
  HURRICANE = 'HURRICANE',
  TEMPERATURE = 'TEMPERATURE',
  SNOW = 'SNOW',
  FLOOD = 'FLOOD',
  DROUGHT = 'DROUGHT',
  WILDFIRE = 'WILDFIRE',
  STORM = 'STORM',
  RAINFALL = 'RAINFALL',
  EARTHQUAKE = 'EARTHQUAKE',
  VOLCANO = 'VOLCANO',
  TORNADO = 'TORNADO',
  OTHER = 'OTHER',
}

export enum ClimateDateType {
  DAY_EXACT = 'DAY_EXACT',       // e.g., "January 15, 2025"
  DATE_RANGE = 'DATE_RANGE',     // e.g., "between Jan 1 and Mar 31"
  MONTH = 'MONTH',               // e.g., "in January 2025"
  YEAR = 'YEAR',                 // e.g., "in 2025"
  SEASON = 'SEASON',             // e.g., "this winter", "hurricane season"
  UNKNOWN = 'UNKNOWN',
}

export enum ClimateComparator {
  GE = 'GE',           // greater than or equal (≥, at least, or more)
  LE = 'LE',           // less than or equal (≤, under, at most)
  BETWEEN = 'BETWEEN', // range (between X and Y)
  EQ = 'EQ',           // exactly
  UNKNOWN = 'UNKNOWN',
}

export interface ClimateThreshold {
  value: number;
  unit: string | null;  // °F, °C, mph, km/h, inches, mm, etc.
  raw: string;          // original text
}

export interface ClimateSignalQuality {
  missingRegion: boolean;
  missingNumber: boolean;
  unknownKind: boolean;
  unknownDate: boolean;
  lowConfidence: boolean;
}

export interface ClimateSignals extends BaseSignals {
  kind: ClimateKind;
  regionKey: string | null;       // Normalized: US-FL, US, UK, NYC, etc.
  regionRaw: string | null;       // Original region text
  dateType: ClimateDateType;
  settleKey: string | null;       // YYYY-MM-DD, YYYY-MM, or range
  settleStart: string | null;     // For ranges: start date
  settleEnd: string | null;       // For ranges: end date
  comparator: ClimateComparator;
  thresholds: ClimateThreshold[];
  titleTokens: string[];
  quality: ClimateSignalQuality;
  confidence: number;
}

// ============================================================================
// KEYWORD MAPS
// ============================================================================

const CLIMATE_KIND_KEYWORDS: Record<ClimateKind, string[]> = {
  [ClimateKind.HURRICANE]: [
    'hurricane', 'hurricanes', 'tropical storm', 'cyclone', 'typhoon',
    'category 1', 'category 2', 'category 3', 'category 4', 'category 5',
    'cat 1', 'cat 2', 'cat 3', 'cat 4', 'cat 5', 'landfall',
  ],
  [ClimateKind.TEMPERATURE]: [
    'temperature', 'temp', 'high temp', 'low temp', 'highest temp', 'lowest temp',
    'degrees', '°f', '°c', 'fahrenheit', 'celsius', 'heat wave', 'cold snap',
    'record high', 'record low', 'average temp', 'warming',
  ],
  [ClimateKind.SNOW]: [
    'snow', 'snowfall', 'snowstorm', 'blizzard', 'winter storm',
    'inches of snow', 'snow accumulation', 'white christmas',
  ],
  [ClimateKind.FLOOD]: [
    'flood', 'flooding', 'flash flood', 'river flood', 'coastal flood',
    'flood warning', 'flood stage',
  ],
  [ClimateKind.DROUGHT]: [
    'drought', 'dry spell', 'water shortage', 'drought conditions',
  ],
  [ClimateKind.WILDFIRE]: [
    'wildfire', 'wildfires', 'forest fire', 'brush fire', 'fire season',
    'acres burned', 'fire danger',
  ],
  [ClimateKind.STORM]: [
    'storm', 'thunderstorm', 'severe storm', 'ice storm', 'hailstorm',
    'wind storm', 'derecho',
  ],
  [ClimateKind.RAINFALL]: [
    'rain', 'rainfall', 'precipitation', 'inches of rain', 'rainy',
    'monsoon', 'el nino', 'la nina',
  ],
  [ClimateKind.EARTHQUAKE]: [
    'earthquake', 'quake', 'seismic', 'magnitude', 'richter',
    'tremor', 'aftershock',
  ],
  [ClimateKind.VOLCANO]: [
    'volcano', 'volcanic', 'eruption', 'erupts', 'lava', 'vei',
  ],
  [ClimateKind.TORNADO]: [
    'tornado', 'tornadoes', 'twister', 'funnel cloud', 'ef0', 'ef1', 'ef2', 'ef3', 'ef4', 'ef5',
  ],
  [ClimateKind.OTHER]: [], // fallback
};

// US States mapping
const US_STATES: Record<string, string> = {
  'alabama': 'US-AL', 'al': 'US-AL',
  'alaska': 'US-AK', 'ak': 'US-AK',
  'arizona': 'US-AZ', 'az': 'US-AZ',
  'arkansas': 'US-AR', 'ar': 'US-AR',
  'california': 'US-CA', 'ca': 'US-CA',
  'colorado': 'US-CO', 'co': 'US-CO',
  'connecticut': 'US-CT', 'ct': 'US-CT',
  'delaware': 'US-DE', 'de': 'US-DE',
  'florida': 'US-FL', 'fl': 'US-FL',
  'georgia': 'US-GA', 'ga': 'US-GA',
  'hawaii': 'US-HI', 'hi': 'US-HI',
  'idaho': 'US-ID', 'id': 'US-ID',
  'illinois': 'US-IL', 'il': 'US-IL',
  'indiana': 'US-IN', 'in': 'US-IN',
  'iowa': 'US-IA', 'ia': 'US-IA',
  'kansas': 'US-KS', 'ks': 'US-KS',
  'kentucky': 'US-KY', 'ky': 'US-KY',
  'louisiana': 'US-LA', 'la': 'US-LA',
  'maine': 'US-ME', 'me': 'US-ME',
  'maryland': 'US-MD', 'md': 'US-MD',
  'massachusetts': 'US-MA', 'ma': 'US-MA',
  'michigan': 'US-MI', 'mi': 'US-MI',
  'minnesota': 'US-MN', 'mn': 'US-MN',
  'mississippi': 'US-MS', 'ms': 'US-MS',
  'missouri': 'US-MO', 'mo': 'US-MO',
  'montana': 'US-MT', 'mt': 'US-MT',
  'nebraska': 'US-NE', 'ne': 'US-NE',
  'nevada': 'US-NV', 'nv': 'US-NV',
  'new hampshire': 'US-NH', 'nh': 'US-NH',
  'new jersey': 'US-NJ', 'nj': 'US-NJ',
  'new mexico': 'US-NM', 'nm': 'US-NM',
  'new york': 'US-NY', 'ny': 'US-NY', 'nyc': 'US-NY',
  'north carolina': 'US-NC', 'nc': 'US-NC',
  'north dakota': 'US-ND', 'nd': 'US-ND',
  'ohio': 'US-OH', 'oh': 'US-OH',
  'oklahoma': 'US-OK', 'ok': 'US-OK',
  'oregon': 'US-OR', 'or': 'US-OR',
  'pennsylvania': 'US-PA', 'pa': 'US-PA',
  'rhode island': 'US-RI', 'ri': 'US-RI',
  'south carolina': 'US-SC', 'sc': 'US-SC',
  'south dakota': 'US-SD', 'sd': 'US-SD',
  'tennessee': 'US-TN', 'tn': 'US-TN',
  'texas': 'US-TX', 'tx': 'US-TX',
  'utah': 'US-UT', 'ut': 'US-UT',
  'vermont': 'US-VT', 'vt': 'US-VT',
  'virginia': 'US-VA', 'va': 'US-VA',
  'washington': 'US-WA', 'wa': 'US-WA',
  'west virginia': 'US-WV', 'wv': 'US-WV',
  'wisconsin': 'US-WI', 'wi': 'US-WI',
  'wyoming': 'US-WY', 'wy': 'US-WY',
  'district of columbia': 'US-DC', 'dc': 'US-DC',
  'puerto rico': 'US-PR', 'pr': 'US-PR',
};

// Major US cities
const US_CITIES: Record<string, string> = {
  'new york city': 'US-NY', 'new york': 'US-NY', 'nyc': 'US-NY', 'manhattan': 'US-NY',
  'los angeles': 'US-CA', 'la': 'US-CA',
  'chicago': 'US-IL',
  'houston': 'US-TX',
  'phoenix': 'US-AZ',
  'philadelphia': 'US-PA', 'philly': 'US-PA',
  'san antonio': 'US-TX',
  'san diego': 'US-CA',
  'dallas': 'US-TX',
  'san jose': 'US-CA',
  'austin': 'US-TX',
  'jacksonville': 'US-FL',
  'fort worth': 'US-TX',
  'columbus': 'US-OH',
  'charlotte': 'US-NC',
  'san francisco': 'US-CA', 'sf': 'US-CA',
  'indianapolis': 'US-IN',
  'seattle': 'US-WA',
  'denver': 'US-CO',
  'boston': 'US-MA',
  'el paso': 'US-TX',
  'detroit': 'US-MI',
  'nashville': 'US-TN',
  'portland': 'US-OR',
  'memphis': 'US-TN',
  'oklahoma city': 'US-OK',
  'las vegas': 'US-NV', 'vegas': 'US-NV',
  'louisville': 'US-KY',
  'baltimore': 'US-MD',
  'milwaukee': 'US-WI',
  'albuquerque': 'US-NM',
  'tucson': 'US-AZ',
  'fresno': 'US-CA',
  'sacramento': 'US-CA',
  'atlanta': 'US-GA',
  'miami': 'US-FL',
  'orlando': 'US-FL',
  'tampa': 'US-FL',
  'new orleans': 'US-LA',
  'wilmington': 'US-NC', // Often referenced in hurricane context
  'anchorage': 'US-AK',
  'honolulu': 'US-HI',
};

// Countries
const COUNTRIES: Record<string, string> = {
  'united states': 'US', 'usa': 'US', 'us': 'US', 'america': 'US',
  'united kingdom': 'UK', 'uk': 'UK', 'britain': 'UK', 'england': 'UK',
  'canada': 'CA',
  'mexico': 'MX',
  'japan': 'JP',
  'china': 'CN',
  'india': 'IN',
  'australia': 'AU',
  'germany': 'DE',
  'france': 'FR',
  'italy': 'IT',
  'spain': 'ES',
  'brazil': 'BR',
  'russia': 'RU',
  'indonesia': 'ID',
  'philippines': 'PH',
  'caribbean': 'CARIBBEAN',
  'atlantic': 'ATLANTIC',
  'pacific': 'PACIFIC',
  'gulf': 'GULF',
  'arctic': 'ARCTIC',
  'global': 'GLOBAL',
  'worldwide': 'GLOBAL',
};

// Month names for date parsing
const MONTHS: Record<string, number> = {
  'january': 1, 'jan': 1,
  'february': 2, 'feb': 2,
  'march': 3, 'mar': 3,
  'april': 4, 'apr': 4,
  'may': 5,
  'june': 6, 'jun': 6,
  'july': 7, 'jul': 7,
  'august': 8, 'aug': 8,
  'september': 9, 'sep': 9, 'sept': 9,
  'october': 10, 'oct': 10,
  'november': 11, 'nov': 11,
  'december': 12, 'dec': 12,
};

// ============================================================================
// EXTRACTION FUNCTIONS
// ============================================================================

/**
 * Extract climate kind from title
 */
export function extractClimateKind(title: string): ClimateKind {
  const titleLower = title.toLowerCase();

  // Check each kind's keywords (order matters - more specific first)
  const kindPriority: ClimateKind[] = [
    ClimateKind.HURRICANE,
    ClimateKind.TORNADO,
    ClimateKind.EARTHQUAKE,
    ClimateKind.VOLCANO,
    ClimateKind.WILDFIRE,
    ClimateKind.FLOOD,
    ClimateKind.DROUGHT,
    ClimateKind.SNOW,
    ClimateKind.RAINFALL,
    ClimateKind.STORM,
    ClimateKind.TEMPERATURE,
  ];

  for (const kind of kindPriority) {
    const keywords = CLIMATE_KIND_KEYWORDS[kind] || [];
    for (const keyword of keywords) {
      if (titleLower.includes(keyword)) {
        return kind;
      }
    }
  }

  // Fallback checks
  if (/\d+\s*°[fc]/i.test(title)) {
    return ClimateKind.TEMPERATURE;
  }
  if (/natural disaster/i.test(title)) {
    return ClimateKind.OTHER;
  }

  return ClimateKind.OTHER;
}

/**
 * Extract region from title
 */
export function extractRegion(title: string): { key: string | null; raw: string | null } {
  // Check US cities first (more specific) - use word boundaries to avoid false positives
  for (const [city, stateCode] of Object.entries(US_CITIES)) {
    // Escape special regex characters and use word boundaries
    const escapedCity = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\b${escapedCity}\\b`, 'i');
    if (pattern.test(title)) {
      return { key: stateCode, raw: city };
    }
  }

  // Check US states
  for (const [state, stateCode] of Object.entries(US_STATES)) {
    // Avoid false positives: require word boundary or specific patterns
    const pattern = new RegExp(`\\b${state}\\b`, 'i');
    if (pattern.test(title)) {
      return { key: stateCode, raw: state };
    }
  }

  // Check countries
  for (const [country, countryCode] of Object.entries(COUNTRIES)) {
    const pattern = new RegExp(`\\b${country}\\b`, 'i');
    if (pattern.test(title)) {
      return { key: countryCode, raw: country };
    }
  }

  // Check for "in the US" or similar
  if (/\bin\s+the\s+u\.?s\.?a?\.?\b/i.test(title) || /\bin\s+america\b/i.test(title)) {
    return { key: 'US', raw: 'US' };
  }

  return { key: null, raw: null };
}

/**
 * Extract date/period from title and closeTime
 */
export function extractDateInfo(
  title: string,
  closeTime: Date | null
): {
  dateType: ClimateDateType;
  settleKey: string | null;
  settleStart: string | null;
  settleEnd: string | null;
} {
  const titleLower = title.toLowerCase();

  // Try to extract specific date patterns

  // Pattern: "on January 15, 2025" or "January 15 2025" or "Jan 15, 2025"
  const exactDatePattern = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?[,\s]+(\d{4})\b/i;
  const exactMatch = title.match(exactDatePattern);
  if (exactMatch) {
    const month = MONTHS[exactMatch[1].toLowerCase().substring(0, 3)];
    const day = parseInt(exactMatch[2], 10);
    const year = parseInt(exactMatch[3], 10);
    if (month && day >= 1 && day <= 31 && year >= 2020 && year <= 2030) {
      const settleKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return { dateType: ClimateDateType.DAY_EXACT, settleKey, settleStart: null, settleEnd: null };
    }
  }

  // Pattern: "in January 2025" or "during January 2025"
  const monthYearPattern = /\b(?:in|during|for|by)\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{4})\b/i;
  const monthYearMatch = title.match(monthYearPattern);
  if (monthYearMatch) {
    const month = MONTHS[monthYearMatch[1].toLowerCase().substring(0, 3)];
    const year = parseInt(monthYearMatch[2], 10);
    if (month && year >= 2020 && year <= 2030) {
      const settleKey = `${year}-${String(month).padStart(2, '0')}`;
      return { dateType: ClimateDateType.MONTH, settleKey, settleStart: null, settleEnd: null };
    }
  }

  // Pattern: "in 2025" or "before 2026" or "by 2025"
  const yearPattern = /\b(?:in|during|before|by)\s+(\d{4})\b/i;
  const yearMatch = title.match(yearPattern);
  if (yearMatch) {
    const year = parseInt(yearMatch[1], 10);
    if (year >= 2020 && year <= 2030) {
      return { dateType: ClimateDateType.YEAR, settleKey: String(year), settleStart: null, settleEnd: null };
    }
  }

  // Pattern: "between January 1 and March 31"
  const rangePattern = /\bbetween\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})\s+and\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})/i;
  const rangeMatch = title.match(rangePattern);
  if (rangeMatch) {
    const startMonth = MONTHS[rangeMatch[1].toLowerCase().substring(0, 3)];
    const startDay = parseInt(rangeMatch[2], 10);
    const endMonth = MONTHS[rangeMatch[3].toLowerCase().substring(0, 3)];
    const endDay = parseInt(rangeMatch[4], 10);
    // Use closeTime year or current year
    const year = closeTime ? closeTime.getFullYear() : new Date().getFullYear();
    if (startMonth && endMonth) {
      const settleStart = `${year}-${String(startMonth).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`;
      const settleEnd = `${year}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;
      return { dateType: ClimateDateType.DATE_RANGE, settleKey: `${settleStart}/${settleEnd}`, settleStart, settleEnd };
    }
  }

  // Season patterns
  if (/\bthis\s+(winter|summer|spring|fall|autumn)\b/i.test(titleLower) ||
      /\b(winter|summer)\s+\d{4}/i.test(titleLower) ||
      /\bhurricane\s+season\b/i.test(titleLower)) {
    const year = closeTime ? closeTime.getFullYear() : new Date().getFullYear();
    return { dateType: ClimateDateType.SEASON, settleKey: `SEASON-${year}`, settleStart: null, settleEnd: null };
  }

  // Fallback to closeTime
  if (closeTime) {
    const year = closeTime.getFullYear();
    const month = closeTime.getMonth() + 1;
    const day = closeTime.getDate();
    const settleKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return { dateType: ClimateDateType.DAY_EXACT, settleKey, settleStart: null, settleEnd: null };
  }

  return { dateType: ClimateDateType.UNKNOWN, settleKey: null, settleStart: null, settleEnd: null };
}

/**
 * Extract comparator from title
 */
export function extractComparator(title: string): ClimateComparator {
  const titleLower = title.toLowerCase();

  // GE patterns
  if (/\b(at\s+least|or\s+more|above|over|exceed|≥|>=|more\s+than|greater\s+than|reach)\b/i.test(titleLower)) {
    return ClimateComparator.GE;
  }

  // LE patterns
  if (/\b(at\s+most|or\s+less|under|below|less\s+than|fewer\s+than|≤|<=|not\s+exceed)\b/i.test(titleLower)) {
    return ClimateComparator.LE;
  }

  // BETWEEN patterns
  if (/\bbetween\s+\d+\s+and\s+\d+/i.test(titleLower)) {
    return ClimateComparator.BETWEEN;
  }

  // EQ patterns
  if (/\b(exactly|precisely)\b/i.test(titleLower)) {
    return ClimateComparator.EQ;
  }

  return ClimateComparator.UNKNOWN;
}

/**
 * Extract numeric thresholds with units from title
 */
export function extractThresholds(title: string): ClimateThreshold[] {
  const thresholds: ClimateThreshold[] = [];

  // Temperature patterns: "90°F", "32 degrees fahrenheit", "-10°C"
  const tempPattern = /(-?\d+(?:\.\d+)?)\s*(?:°|degrees?\s*)([fFcC](?:ahrenheit|elsius)?)/gi;
  let match;
  while ((match = tempPattern.exec(title)) !== null) {
    const value = parseFloat(match[1]);
    const unit = match[2].toLowerCase().startsWith('f') ? '°F' : '°C';
    thresholds.push({ value, unit, raw: match[0] });
  }

  // Speed patterns: "74 mph", "120 km/h", "100 knots"
  const speedPattern = /(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh|knots?)/gi;
  while ((match = speedPattern.exec(title)) !== null) {
    const value = parseFloat(match[1]);
    const unit = match[2].toLowerCase().replace('kmh', 'km/h');
    thresholds.push({ value, unit, raw: match[0] });
  }

  // Precipitation patterns: "10 inches", "25mm", "5 cm"
  const precipPattern = /(\d+(?:\.\d+)?)\s*(inches?|in|mm|cm|millimeters?|centimeters?)/gi;
  while ((match = precipPattern.exec(title)) !== null) {
    const value = parseFloat(match[1]);
    let unit = match[2].toLowerCase();
    if (unit.startsWith('in')) unit = 'in';
    if (unit.startsWith('mm') || unit.startsWith('millimeter')) unit = 'mm';
    if (unit.startsWith('cm') || unit.startsWith('centimeter')) unit = 'cm';
    thresholds.push({ value, unit, raw: match[0] });
  }

  // Earthquake magnitude: "magnitude 7.0", "7.0 or above"
  const magnitudePattern = /\bmagnitude\s+(\d+(?:\.\d+)?)/gi;
  while ((match = magnitudePattern.exec(title)) !== null) {
    const value = parseFloat(match[1]);
    thresholds.push({ value, unit: 'magnitude', raw: match[0] });
  }

  // Count patterns: "5 earthquakes", "3 hurricanes"
  const countPattern = /(\d+)\s+(earthquake|hurricane|tornado|storm|flood|wildfire)s?\b/gi;
  while ((match = countPattern.exec(title)) !== null) {
    const value = parseFloat(match[1]);
    thresholds.push({ value, unit: 'count', raw: match[0] });
  }

  // VEI for volcanoes: "VEI ≥6", "VEI 5+"
  const veiPattern = /\bvei\s*[≥>=]?\s*(\d+)\+?/gi;
  while ((match = veiPattern.exec(title)) !== null) {
    const value = parseFloat(match[1]);
    thresholds.push({ value, unit: 'VEI', raw: match[0] });
  }

  // Plain numbers at end (for count markets): "between 5 and 7"
  const rangePattern = /\bbetween\s+(\d+)\s+and\s+(\d+)\b/gi;
  while ((match = rangePattern.exec(title)) !== null) {
    const low = parseFloat(match[1]);
    const high = parseFloat(match[2]);
    thresholds.push({ value: low, unit: 'range_low', raw: match[0] });
    thresholds.push({ value: high, unit: 'range_high', raw: match[0] });
  }

  return thresholds;
}

/**
 * Generate title tokens for text similarity
 */
export function extractTitleTokens(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length >= 2)
    .filter(token => !['the', 'a', 'an', 'in', 'on', 'at', 'to', 'of', 'be', 'will', 'is', 'are'].includes(token));
}

/**
 * Check if a market is a climate market based on title
 */
export function isClimateMarket(title: string): boolean {
  const kind = extractClimateKind(title);
  return kind !== ClimateKind.OTHER;
}

/**
 * Main extraction function
 */
export function extractClimateSignals(market: EligibleMarket): ClimateSignals {
  const title = market.title;
  const closeTime = market.closeTime;

  const kind = extractClimateKind(title);
  const region = extractRegion(title);
  const dateInfo = extractDateInfo(title, closeTime);
  const comparator = extractComparator(title);
  const thresholds = extractThresholds(title);
  const titleTokens = extractTitleTokens(title);

  const quality: ClimateSignalQuality = {
    missingRegion: region.key === null,
    missingNumber: thresholds.length === 0,
    unknownKind: kind === ClimateKind.OTHER,
    unknownDate: dateInfo.dateType === ClimateDateType.UNKNOWN,
    lowConfidence: false,
  };

  // Calculate confidence based on quality
  let confidence = 1.0;
  if (quality.unknownKind) confidence -= 0.3;
  if (quality.unknownDate) confidence -= 0.2;
  if (quality.missingRegion) confidence -= 0.1;
  if (quality.missingNumber) confidence -= 0.1;
  confidence = Math.max(0, confidence);

  quality.lowConfidence = confidence < 0.5;

  return {
    kind,
    regionKey: region.key,
    regionRaw: region.raw,
    dateType: dateInfo.dateType,
    settleKey: dateInfo.settleKey,
    settleStart: dateInfo.settleStart,
    settleEnd: dateInfo.settleEnd,
    comparator,
    thresholds,
    titleTokens,
    quality,
    confidence,
    entity: kind, // Use kind as primary entity for base interface
    entities: new Set([kind]),
  };
}

// ============================================================================
// UTILITY FUNCTIONS FOR MATCHING
// ============================================================================

/**
 * Check if two date types are compatible for matching
 */
export function areDateTypesCompatible(a: ClimateDateType, b: ClimateDateType): boolean {
  if (a === b) return true;

  // DAY_EXACT can match DAY_EXACT, or be within DATE_RANGE/MONTH
  if (a === ClimateDateType.DAY_EXACT && b === ClimateDateType.MONTH) return true;
  if (b === ClimateDateType.DAY_EXACT && a === ClimateDateType.MONTH) return true;

  // DATE_RANGE can match MONTH if they overlap
  if (a === ClimateDateType.DATE_RANGE && b === ClimateDateType.MONTH) return true;
  if (b === ClimateDateType.DATE_RANGE && a === ClimateDateType.MONTH) return true;

  // YEAR is very broad, can match anything with same year
  if (a === ClimateDateType.YEAR || b === ClimateDateType.YEAR) return true;

  // SEASON can match MONTH/DATE_RANGE
  if (a === ClimateDateType.SEASON || b === ClimateDateType.SEASON) return true;

  return false;
}

/**
 * Calculate date similarity score
 */
export function calculateDateScore(
  aType: ClimateDateType,
  aKey: string | null,
  bType: ClimateDateType,
  bKey: string | null
): number {
  if (!aKey || !bKey) return 0.3; // Penalty for missing date

  // Exact match
  if (aKey === bKey && aType === bType) return 1.0;

  // Both DAY_EXACT - check day difference
  if (aType === ClimateDateType.DAY_EXACT && bType === ClimateDateType.DAY_EXACT) {
    const aDate = new Date(aKey);
    const bDate = new Date(bKey);
    const dayDiff = Math.abs((aDate.getTime() - bDate.getTime()) / (1000 * 60 * 60 * 24));
    if (dayDiff === 0) return 1.0;
    if (dayDiff === 1) return 0.9;
    if (dayDiff <= 3) return 0.7;
    if (dayDiff <= 7) return 0.5;
    return 0.2;
  }

  // Both MONTH - check month difference
  if (aType === ClimateDateType.MONTH && bType === ClimateDateType.MONTH) {
    const [aYear, aMonth] = aKey.split('-').map(Number);
    const [bYear, bMonth] = bKey.split('-').map(Number);
    if (aYear === bYear && aMonth === bMonth) return 1.0;
    const monthDiff = Math.abs((aYear * 12 + aMonth) - (bYear * 12 + bMonth));
    if (monthDiff === 1) return 0.6;
    return 0.2;
  }

  // DAY_EXACT vs MONTH - check if day is in month
  if (aType === ClimateDateType.DAY_EXACT && bType === ClimateDateType.MONTH) {
    const dayMonth = aKey.substring(0, 7); // YYYY-MM
    if (dayMonth === bKey) return 0.8;
    return 0.3;
  }
  if (bType === ClimateDateType.DAY_EXACT && aType === ClimateDateType.MONTH) {
    const dayMonth = bKey.substring(0, 7);
    if (dayMonth === aKey) return 0.8;
    return 0.3;
  }

  // YEAR match
  if (aType === ClimateDateType.YEAR || bType === ClimateDateType.YEAR) {
    const aYear = aKey.substring(0, 4);
    const bYear = bKey.substring(0, 4);
    if (aYear === bYear) return 0.6;
    return 0.2;
  }

  // Fallback
  return 0.3;
}

/**
 * Calculate threshold similarity
 */
export function calculateThresholdScore(
  aThresholds: ClimateThreshold[],
  bThresholds: ClimateThreshold[]
): number {
  if (aThresholds.length === 0 || bThresholds.length === 0) {
    return 0.5; // Neutral if one side missing
  }

  // Group by unit type
  const aByUnit = new Map<string, ClimateThreshold[]>();
  const bByUnit = new Map<string, ClimateThreshold[]>();

  for (const t of aThresholds) {
    const unit = t.unit || 'unknown';
    if (!aByUnit.has(unit)) aByUnit.set(unit, []);
    aByUnit.get(unit)!.push(t);
  }

  for (const t of bThresholds) {
    const unit = t.unit || 'unknown';
    if (!bByUnit.has(unit)) bByUnit.set(unit, []);
    bByUnit.get(unit)!.push(t);
  }

  // Find matching units
  const commonUnits = [...aByUnit.keys()].filter(u => bByUnit.has(u));
  if (commonUnits.length === 0) return 0.4;

  let totalScore = 0;
  for (const unit of commonUnits) {
    const aVals = aByUnit.get(unit)!.map(t => t.value);
    const bVals = bByUnit.get(unit)!.map(t => t.value);

    // Compare closest values
    let bestMatch = 0;
    for (const a of aVals) {
      for (const b of bVals) {
        const diff = Math.abs(a - b);
        const maxVal = Math.max(Math.abs(a), Math.abs(b), 1);
        const relDiff = diff / maxVal;

        let score = 0;
        if (relDiff === 0) score = 1.0;
        else if (relDiff <= 0.01) score = 0.95; // 1% tolerance
        else if (relDiff <= 0.05) score = 0.8;  // 5% tolerance
        else if (relDiff <= 0.10) score = 0.6;  // 10% tolerance
        else score = 0.3;

        bestMatch = Math.max(bestMatch, score);
      }
    }
    totalScore += bestMatch;
  }

  return totalScore / commonUnits.length;
}

export const CLIMATE_KEYWORDS = [
  'hurricane', 'storm', 'snow', 'temperature', 'heat', 'wildfire',
  'flood', 'drought', 'rainfall', 'earthquake', 'volcano', 'tornado',
  'natural disaster', 'weather', 'climate',
];

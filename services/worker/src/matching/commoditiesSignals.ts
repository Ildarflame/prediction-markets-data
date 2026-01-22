/**
 * Commodities Signals Extraction (v3.0.4)
 *
 * Extracts structured signals from commodities market titles for matching.
 *
 * Supported underlyings:
 * - Energy: OIL_WTI (CL), OIL_BRENT, NATGAS (NG)
 * - Precious metals: GOLD (GC), SILVER (SI), PLATINUM, PALLADIUM
 * - Base metals: COPPER (HG)
 * - Agriculture: CORN (C), WHEAT (W), SOYBEANS (S), COFFEE, SUGAR, COCOA
 */

/**
 * Commodity underlying types
 */
export type CommodityUnderlying =
  // Energy
  | 'OIL_WTI'
  | 'OIL_BRENT'
  | 'NATGAS'
  // Precious metals
  | 'GOLD'
  | 'SILVER'
  | 'PLATINUM'
  | 'PALLADIUM'
  // Base metals
  | 'COPPER'
  // Agriculture
  | 'CORN'
  | 'WHEAT'
  | 'SOYBEANS'
  | 'COFFEE'
  | 'SUGAR'
  | 'COCOA';

/**
 * Comparator for threshold markets
 */
export type CommodityComparator = 'GE' | 'LE' | 'BETWEEN' | 'EXACT';

/**
 * Date type for commodities
 */
export type CommodityDateType =
  | 'MONTH_END'      // End of month (most common: "final trading day of June")
  | 'DAY_EXACT'      // Specific day
  | 'CONTRACT';       // Futures contract month (Feb 2026, etc.)

/**
 * Extracted commodities signals
 */
export interface CommoditiesSignals {
  /** Primary commodity underlying */
  underlying: CommodityUnderlying | null;
  /** Futures contract code if present (CL, GC, etc.) */
  contractCode: string | null;
  /** Target date type */
  dateType: CommodityDateType | null;
  /** Target date (YYYY-MM-DD or YYYY-MM for month end) */
  targetDate: string | null;
  /** Contract month (YYYY-MM for futures) */
  contractMonth: string | null;
  /** Price comparator */
  comparator: CommodityComparator | null;
  /** Threshold values (1 for GE/LE, 2 for BETWEEN) */
  thresholds: number[];
  /** Text similarity score (for debugging) */
  textScore?: number;
}

/**
 * Commodity patterns for detection
 */
const COMMODITY_PATTERNS: Array<{
  pattern: RegExp;
  underlying: CommodityUnderlying;
  contractCode?: string;
}> = [
  // Energy
  { pattern: /\bcrude\s*oil\b/i, underlying: 'OIL_WTI', contractCode: 'CL' },
  { pattern: /\boil\s*\(cl\)/i, underlying: 'OIL_WTI', contractCode: 'CL' },
  { pattern: /\b(?:wti|west texas)\b/i, underlying: 'OIL_WTI', contractCode: 'CL' },
  { pattern: /\bbrent\b/i, underlying: 'OIL_BRENT' },
  { pattern: /\bnatural\s*gas\b/i, underlying: 'NATGAS', contractCode: 'NG' },
  { pattern: /\bnatgas\b/i, underlying: 'NATGAS', contractCode: 'NG' },
  { pattern: /\bgas\s*\(ng\)/i, underlying: 'NATGAS', contractCode: 'NG' },

  // Precious metals
  { pattern: /\bgold\s*\(gc\)/i, underlying: 'GOLD', contractCode: 'GC' },
  { pattern: /\bgold\b(?!\s*en)/i, underlying: 'GOLD', contractCode: 'GC' },
  { pattern: /\bsilver\s*\(si\)/i, underlying: 'SILVER', contractCode: 'SI' },
  { pattern: /\bsilver\b/i, underlying: 'SILVER', contractCode: 'SI' },
  { pattern: /\bplatinum\b/i, underlying: 'PLATINUM' },
  { pattern: /\bpalladium\b/i, underlying: 'PALLADIUM' },

  // Base metals
  { pattern: /\bcopper\s*\(hg\)/i, underlying: 'COPPER', contractCode: 'HG' },
  { pattern: /\bcopper\b/i, underlying: 'COPPER', contractCode: 'HG' },

  // Agriculture
  { pattern: /\bcorn\s*\(c\)/i, underlying: 'CORN', contractCode: 'C' },
  { pattern: /\bcorn\b/i, underlying: 'CORN', contractCode: 'C' },
  { pattern: /\bwheat\s*\(w\)/i, underlying: 'WHEAT', contractCode: 'W' },
  { pattern: /\bwheat\b/i, underlying: 'WHEAT', contractCode: 'W' },
  { pattern: /\bsoybeans?\s*\(s\)/i, underlying: 'SOYBEANS', contractCode: 'S' },
  { pattern: /\bsoybeans?\b/i, underlying: 'SOYBEANS', contractCode: 'S' },
  { pattern: /\bcoffee\b/i, underlying: 'COFFEE' },
  { pattern: /\bsugar\b/i, underlying: 'SUGAR' },
  { pattern: /\bcocoa\b/i, underlying: 'COCOA' },
];

/**
 * Month names to number mapping
 */
const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

/**
 * Extract commodity underlying from title
 */
function extractUnderlying(title: string): { underlying: CommodityUnderlying; contractCode: string | null } | null {
  for (const { pattern, underlying, contractCode } of COMMODITY_PATTERNS) {
    if (pattern.test(title)) {
      return { underlying, contractCode: contractCode || null };
    }
  }
  return null;
}

/**
 * Extract comparator from title
 */
function extractComparator(title: string): CommodityComparator | null {
  const lower = title.toLowerCase();

  // BETWEEN patterns
  if (/\bbetween\b/.test(lower) || /\$[\d,.]+\s*(?:and|[-–])\s*\$[\d,.]+/.test(lower)) {
    return 'BETWEEN';
  }

  // GE patterns (above, over, at least, >=)
  if (/\b(?:above|over|exceed|settle\s+over|at\s+(?:or\s+)?above|at\s+least|greater\s+than|>=)\b/i.test(title)) {
    return 'GE';
  }

  // LE patterns (below, under, at most, <=)
  if (/\b(?:below|under|settle\s+below|at\s+(?:or\s+)?below|at\s+most|less\s+than|<=)\b/i.test(title)) {
    return 'LE';
  }

  return null;
}

/**
 * Extract price thresholds from title
 */
function extractThresholds(title: string): number[] {
  const thresholds: number[] = [];

  // Match dollar amounts: $50, $100,000, $50.50, $50k, $1.5m
  const dollarPattern = /\$\s*([\d,]+(?:\.\d+)?)\s*([kmb])?/gi;
  let match;

  while ((match = dollarPattern.exec(title)) !== null) {
    let value = parseFloat(match[1].replace(/,/g, ''));
    const suffix = match[2]?.toLowerCase();

    if (suffix === 'k') value *= 1000;
    else if (suffix === 'm') value *= 1_000_000;
    else if (suffix === 'b') value *= 1_000_000_000;

    // Skip likely years (1900-2100)
    if (value >= 1900 && value <= 2100 && !match[0].includes('.')) {
      continue;
    }

    thresholds.push(value);
  }

  // Also match plain numbers with context (e.g., "over 50", "below 100")
  const plainPattern = /\b(?:over|above|below|under|at)\s+([\d,]+(?:\.\d+)?)\b/gi;
  while ((match = plainPattern.exec(title)) !== null) {
    const value = parseFloat(match[1].replace(/,/g, ''));
    // Skip years
    if (value >= 1900 && value <= 2100) continue;
    if (!thresholds.includes(value)) {
      thresholds.push(value);
    }
  }

  return thresholds.sort((a, b) => a - b);
}

/**
 * Extract date information from title
 */
function extractDateInfo(title: string): {
  dateType: CommodityDateType | null;
  targetDate: string | null;
  contractMonth: string | null;
} {
  const lower = title.toLowerCase();
  let dateType: CommodityDateType | null = null;
  let targetDate: string | null = null;
  let contractMonth: string | null = null;

  // Pattern: "final trading day of [Month] [Year]" or "end of [Month]"
  const monthEndPattern = /(?:final\s+trading\s+day\s+of|end\s+of)\s+(\w+)(?:\s+(\d{4}))?/i;
  const monthEndMatch = lower.match(monthEndPattern);

  if (monthEndMatch) {
    const monthName = monthEndMatch[1].toLowerCase();
    const year = monthEndMatch[2] ? parseInt(monthEndMatch[2], 10) : new Date().getFullYear();
    const month = MONTH_NAMES[monthName];

    if (month) {
      dateType = 'MONTH_END';
      targetDate = `${year}-${String(month).padStart(2, '0')}`;
    }
  }

  // Pattern: "[Month] [Day], [Year]" or "[Month] [Day] [Year]"
  if (!dateType) {
    const dayExactPattern = /(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?[,\s]+(\d{4})/i;
    const dayMatch = title.match(dayExactPattern);

    if (dayMatch) {
      const monthName = dayMatch[1].toLowerCase();
      const day = parseInt(dayMatch[2], 10);
      const year = parseInt(dayMatch[3], 10);
      const month = MONTH_NAMES[monthName];

      if (month && day >= 1 && day <= 31) {
        dateType = 'DAY_EXACT';
        targetDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }
  }

  // Pattern: "on [Month] [Year]" (contract month)
  if (!dateType) {
    const contractPattern = /(?:on|in|for|by)\s+(\w+)\s+(\d{4})/i;
    const contractMatch = title.match(contractPattern);

    if (contractMatch) {
      const monthName = contractMatch[1].toLowerCase();
      const year = parseInt(contractMatch[2], 10);
      const month = MONTH_NAMES[monthName];

      if (month) {
        dateType = 'CONTRACT';
        contractMonth = `${year}-${String(month).padStart(2, '0')}`;
      }
    }
  }

  return { dateType, targetDate, contractMonth };
}

/**
 * Extract all commodities signals from a market title
 */
export function extractCommoditiesSignals(title: string): CommoditiesSignals {
  const underlyingInfo = extractUnderlying(title);
  const comparator = extractComparator(title);
  const thresholds = extractThresholds(title);
  const dateInfo = extractDateInfo(title);

  return {
    underlying: underlyingInfo?.underlying || null,
    contractCode: underlyingInfo?.contractCode || null,
    dateType: dateInfo.dateType,
    targetDate: dateInfo.targetDate,
    contractMonth: dateInfo.contractMonth,
    comparator,
    thresholds,
  };
}

/**
 * Check if signals represent a commodities market
 */
export function isCommoditiesMarket(signals: CommoditiesSignals): boolean {
  return signals.underlying !== null;
}

/**
 * Format signals for debugging
 */
export function formatCommoditiesSignals(signals: CommoditiesSignals): string {
  const parts: string[] = [];

  if (signals.underlying) parts.push(`underlying=${signals.underlying}`);
  if (signals.contractCode) parts.push(`code=${signals.contractCode}`);
  if (signals.dateType) parts.push(`dateType=${signals.dateType}`);
  if (signals.targetDate) parts.push(`date=${signals.targetDate}`);
  if (signals.contractMonth) parts.push(`contract=${signals.contractMonth}`);
  if (signals.comparator) parts.push(`cmp=${signals.comparator}`);
  if (signals.thresholds.length > 0) parts.push(`thresh=[${signals.thresholds.join(',')}]`);

  return parts.join(' ');
}

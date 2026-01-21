/**
 * Crypto Auto-Confirm Rules (v2.6.0)
 *
 * SAFE_RULES for auto-confirming crypto matches without manual review.
 * All rules must pass for a match to be auto-confirmed.
 */

import { CryptoDateType, type CryptoMarket, type CryptoScoreResult } from './cryptoPipeline.js';

/**
 * Auto-confirm validation result
 */
export interface AutoConfirmValidation {
  /** Whether the match passes all SAFE_RULES */
  safe: boolean;
  /** Reason for rejection if not safe */
  rejectReason: string | null;
  /** Detailed breakdown of rule checks */
  ruleChecks: {
    entityMatch: boolean;
    dateTypeMatch: boolean;
    dateExact: boolean;
    comparatorMatch: boolean;
    numberCompatible: boolean;
    textSanity: boolean;
    hasRequiredFields: boolean;
  };
}

/**
 * SAFE_RULES for auto-confirm (v2.6.0)
 *
 * All rules must pass:
 * 1. Entity exact match
 * 2. BOTH dateType must be DAY_EXACT (not CLOSE_TIME, MONTH_END, QUARTER)
 * 3. settleDate must be EXACTLY equal (no ±1 day tolerance for auto-confirm)
 * 4. Comparator must be equal (GE/LE/BETWEEN/RANGE)
 * 5. Number compatibility:
 *    - For GE/LE: |L - R| <= max(1, 0.001 * R) (tolerance: $1 or 0.1%)
 *    - For BETWEEN/RANGE: overlap ratio >= 0.90 AND endpoints within tolerance
 * 6. Minimum text sanity: avg(jaccard, fuzzy) >= 0.12
 * 7. Required fields present (settleDate, numbers for price-threshold markets)
 */
export function validateAutoConfirm(
  left: CryptoMarket,
  right: CryptoMarket,
  _scoreResult: CryptoScoreResult
): AutoConfirmValidation {
  const lSig = left.signals;
  const rSig = right.signals;

  const ruleChecks = {
    entityMatch: false,
    dateTypeMatch: false,
    dateExact: false,
    comparatorMatch: false,
    numberCompatible: false,
    textSanity: false,
    hasRequiredFields: false,
  };

  // Rule 1: Entity exact match
  ruleChecks.entityMatch = lSig.entity === rSig.entity && lSig.entity !== null;
  if (!ruleChecks.entityMatch) {
    return {
      safe: false,
      rejectReason: 'entity_mismatch',
      ruleChecks,
    };
  }

  // Rule 2: BOTH dateType must be DAY_EXACT
  ruleChecks.dateTypeMatch =
    lSig.dateType === CryptoDateType.DAY_EXACT &&
    rSig.dateType === CryptoDateType.DAY_EXACT;
  if (!ruleChecks.dateTypeMatch) {
    return {
      safe: false,
      rejectReason: `date_type_not_day_exact: ${lSig.dateType}/${rSig.dateType}`,
      ruleChecks,
    };
  }

  // Rule 3: settleDate must be EXACTLY equal (no ±1 day)
  ruleChecks.dateExact = lSig.settleDate === rSig.settleDate && lSig.settleDate !== null;
  if (!ruleChecks.dateExact) {
    return {
      safe: false,
      rejectReason: `date_not_exact: ${lSig.settleDate} vs ${rSig.settleDate}`,
      ruleChecks,
    };
  }

  // Rule 4: Comparator must be equal
  const normalizedComparatorL = normalizeComparator(lSig.comparator);
  const normalizedComparatorR = normalizeComparator(rSig.comparator);
  ruleChecks.comparatorMatch =
    normalizedComparatorL !== null &&
    normalizedComparatorR !== null &&
    normalizedComparatorL === normalizedComparatorR;
  if (!ruleChecks.comparatorMatch) {
    return {
      safe: false,
      rejectReason: `comparator_mismatch: ${lSig.comparator} vs ${rSig.comparator}`,
      ruleChecks,
    };
  }

  // Rule 5: Number compatibility
  ruleChecks.numberCompatible = checkNumberCompatibility(
    lSig.numbers,
    rSig.numbers,
    normalizedComparatorL
  );
  if (!ruleChecks.numberCompatible) {
    return {
      safe: false,
      rejectReason: `number_incompatible: [${lSig.numbers.join(',')}] vs [${rSig.numbers.join(',')}]`,
      ruleChecks,
    };
  }

  // Rule 6: Minimum text sanity
  const textSanityScore = computeTextSanity(left.market.title, right.market.title);
  ruleChecks.textSanity = textSanityScore >= 0.12;
  if (!ruleChecks.textSanity) {
    return {
      safe: false,
      rejectReason: `text_sanity_too_low: ${textSanityScore.toFixed(3)} < 0.12`,
      ruleChecks,
    };
  }

  // Rule 7: Required fields present
  ruleChecks.hasRequiredFields =
    lSig.settleDate !== null &&
    rSig.settleDate !== null &&
    lSig.numbers.length > 0 &&
    rSig.numbers.length > 0;
  if (!ruleChecks.hasRequiredFields) {
    return {
      safe: false,
      rejectReason: 'missing_required_fields',
      ruleChecks,
    };
  }

  // All rules passed
  return {
    safe: true,
    rejectReason: null,
    ruleChecks,
  };
}

/**
 * Normalize comparator to canonical form
 */
function normalizeComparator(comparator: string | null): string | null {
  if (!comparator) return null;
  const upper = comparator.toUpperCase();

  // Map variations to canonical forms
  const mapping: Record<string, string> = {
    'GE': 'GE',
    'GT': 'GE', // treat GT as GE for matching
    'ABOVE': 'GE',
    'OVER': 'GE',
    'LE': 'LE',
    'LT': 'LE', // treat LT as LE for matching
    'BELOW': 'LE',
    'UNDER': 'LE',
    'BETWEEN': 'BETWEEN',
    'RANGE': 'BETWEEN',
    'EQ': 'EQ',
    'EQUAL': 'EQ',
  };

  return mapping[upper] || upper;
}

/**
 * Check number compatibility based on comparator type
 */
function checkNumberCompatibility(
  numbersL: number[],
  numbersR: number[],
  comparator: string | null
): boolean {
  if (numbersL.length === 0 || numbersR.length === 0) {
    return false;
  }

  if (comparator === 'GE' || comparator === 'LE') {
    // For GE/LE: single threshold comparison
    // Use primary (first for LE, last for GE) threshold
    const thresholdL = comparator === 'GE' ? Math.min(...numbersL) : Math.max(...numbersL);
    const thresholdR = comparator === 'GE' ? Math.min(...numbersR) : Math.max(...numbersR);

    // Tolerance: max($1, 0.1% of value)
    const tolerance = Math.max(1, 0.001 * Math.max(thresholdL, thresholdR));
    return Math.abs(thresholdL - thresholdR) <= tolerance;
  }

  if (comparator === 'BETWEEN') {
    // For BETWEEN: need 2 numbers, check overlap ratio >= 0.90
    if (numbersL.length < 2 || numbersR.length < 2) {
      return false;
    }

    const [minL, maxL] = [Math.min(...numbersL), Math.max(...numbersL)];
    const [minR, maxR] = [Math.min(...numbersR), Math.max(...numbersR)];

    // Check overlap
    const overlapMin = Math.max(minL, minR);
    const overlapMax = Math.min(maxL, maxR);

    if (overlapMin > overlapMax) {
      return false; // No overlap
    }

    const overlapSize = overlapMax - overlapMin;
    const unionSize = Math.max(maxL, maxR) - Math.min(minL, minR);

    if (unionSize === 0) {
      return minL === minR && maxL === maxR; // Identical points
    }

    const overlapRatio = overlapSize / unionSize;

    // Also check endpoints are within tolerance
    const tolerance = Math.max(1, 0.001 * Math.max(maxL, maxR));
    const endpointsClose =
      Math.abs(minL - minR) <= tolerance && Math.abs(maxL - maxR) <= tolerance;

    return overlapRatio >= 0.90 || endpointsClose;
  }

  // For unknown comparators, fall back to checking if any number matches
  for (const nL of numbersL) {
    for (const nR of numbersR) {
      const tolerance = Math.max(1, 0.001 * Math.max(nL, nR));
      if (Math.abs(nL - nR) <= tolerance) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Compute text sanity score (average of Jaccard and simple fuzzy)
 */
function computeTextSanity(titleL: string, titleR: string): number {
  const tokensL = tokenize(titleL);
  const tokensR = tokenize(titleR);

  // Jaccard similarity
  const setL = new Set(tokensL);
  const setR = new Set(tokensR);
  let intersection = 0;
  for (const t of setL) {
    if (setR.has(t)) intersection++;
  }
  const union = setL.size + setR.size - intersection;
  const jaccard = union > 0 ? intersection / union : 0;

  // Simple fuzzy: ratio of matching tokens
  const matchingL = tokensL.filter(t => setR.has(t)).length;
  const matchingR = tokensR.filter(t => setL.has(t)).length;
  const fuzzy = (matchingL + matchingR) / (tokensL.length + tokensR.length || 1);

  return (jaccard + fuzzy) / 2;
}

/**
 * Tokenize title for text comparison
 */
function tokenize(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

/**
 * Auto-confirm statistics
 */
export interface AutoConfirmStats {
  scanned: number;
  confirmed: number;
  skippedByRule: {
    entityMismatch: number;
    dateTypeMismatch: number;
    dateNotExact: number;
    comparatorMismatch: number;
    numberIncompatible: number;
    textSanityLow: number;
    missingFields: number;
  };
  updatedExistingLinks: number;
  alreadyConfirmed: number;
}

export function createEmptyAutoConfirmStats(): AutoConfirmStats {
  return {
    scanned: 0,
    confirmed: 0,
    skippedByRule: {
      entityMismatch: 0,
      dateTypeMismatch: 0,
      dateNotExact: 0,
      comparatorMismatch: 0,
      numberIncompatible: 0,
      textSanityLow: 0,
      missingFields: 0,
    },
    updatedExistingLinks: 0,
    alreadyConfirmed: 0,
  };
}

export function updateStatsFromRejectReason(stats: AutoConfirmStats, reason: string | null): void {
  if (!reason) return;

  if (reason.startsWith('entity_mismatch')) {
    stats.skippedByRule.entityMismatch++;
  } else if (reason.startsWith('date_type_not_day_exact')) {
    stats.skippedByRule.dateTypeMismatch++;
  } else if (reason.startsWith('date_not_exact')) {
    stats.skippedByRule.dateNotExact++;
  } else if (reason.startsWith('comparator_mismatch')) {
    stats.skippedByRule.comparatorMismatch++;
  } else if (reason.startsWith('number_incompatible')) {
    stats.skippedByRule.numberIncompatible++;
  } else if (reason.startsWith('text_sanity_too_low')) {
    stats.skippedByRule.textSanityLow++;
  } else if (reason === 'missing_required_fields') {
    stats.skippedByRule.missingFields++;
  }
}

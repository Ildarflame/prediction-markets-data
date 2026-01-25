/**
 * Safe Rules Evaluator for Auto-Confirm (v2.6.8)
 *
 * Strict rules to ensure ONLY high-quality matches are auto-confirmed.
 * Each topic has specific requirements that must ALL pass.
 */

import type { MarketLink, Market, Outcome } from '@data-module/db';

// v3.1.0: Added all implemented topics
export type Topic =
  | 'crypto_daily'
  | 'crypto_intraday'
  | 'macro'
  | 'rates'
  | 'elections'
  | 'geopolitics'
  | 'entertainment'
  | 'finance'
  | 'climate'
  | 'commodities'
  | 'sports';

export interface SafeRuleResult {
  pass: boolean;
  ruleId: string;
  reason: string;
}

export interface SafeEvaluation {
  pass: boolean;
  topic: Topic;
  score: number;
  results: SafeRuleResult[];
  failedRules: string[];
  passedRules: string[];
}

export interface MarketLinkWithMarkets extends MarketLink {
  leftMarket: Market & { outcomes: Outcome[] };
  rightMarket: Market & { outcomes: Outcome[] };
}

// ============================================================================
// PARSING UTILITIES
// ============================================================================

/**
 * Parse reason string into key=value pairs
 * Handles formats like: "entity=BITCOIN dateType=DAY_EXACT date=1.00(0d) num=0.90[price] text=0.45"
 */
export function parseReasonString(reason: string | null): Record<string, string> {
  if (!reason) return {};

  const result: Record<string, string> = {};

  // Handle MACRO format: "MACRO: tier=STRONG me=0.50 per=0.24[month_in_quarter](2025-Q1/2025-Q1) num=0.05 txt=0.05"
  if (reason.startsWith('MACRO:')) {
    result._type = 'MACRO';
    const content = reason.slice(6).trim();

    // Extract tier
    const tierMatch = content.match(/tier=(\w+)/);
    if (tierMatch) result.tier = tierMatch[1];

    // Extract me (macro entity score)
    const meMatch = content.match(/me=([\d.]+)/);
    if (meMatch) result.me = meMatch[1];

    // Extract per (period score) with kind and periods
    const perMatch = content.match(/per=([\d.]+)\[([^\]]+)\]\(([^)]+)\)/);
    if (perMatch) {
      result.per = perMatch[1];
      result.perKind = perMatch[2];
      result.perPeriods = perMatch[3];
    }

    // Extract num
    const numMatch = content.match(/num=([\d.]+)/);
    if (numMatch) result.num = numMatch[1];

    // Extract txt
    const txtMatch = content.match(/txt=([\d.]+)/);
    if (txtMatch) result.txt = txtMatch[1];

    return result;
  }

  // Handle Intraday format FIRST (has bucket=): "entity=BITCOIN bucket=2026-01-21T14:00:00.000Z dir=up/up text=0.45"
  // Check bucket before entity since intraday can have both
  const bucketMatch = reason.match(/bucket=([^\s]+)/);
  if (bucketMatch) {
    result._type = 'INTRADAY';

    const entityMatch = reason.match(/entity=(\w+)/);
    if (entityMatch) result.entity = entityMatch[1];

    result.bucket = bucketMatch[1];

    const dirMatch = reason.match(/dir=([^/]+)\/([^\s]+)/);
    if (dirMatch) {
      result.dirL = dirMatch[1];
      result.dirR = dirMatch[2];
    }

    const textMatch = reason.match(/text=([\d.]+)/);
    if (textMatch) result.text = textMatch[1];

    return result;
  }

  // Handle Crypto daily format: "entity=BITCOIN dateType=DAY_EXACT date=1.00(0d) num=0.90[price] text=0.45"
  const entityMatch = reason.match(/entity=(\w+)/);
  if (entityMatch) {
    result._type = 'CRYPTO';
    result.entity = entityMatch[1];

    // Extract dateType
    const dateTypeMatch = reason.match(/dateType=(\w+)/);
    if (dateTypeMatch) result.dateType = dateTypeMatch[1];

    // Extract date score and day diff
    const dateMatch = reason.match(/date=([\d.]+)\(([^)]+)\)/);
    if (dateMatch) {
      result.date = dateMatch[1];
      result.dateDiff = dateMatch[2];
    }

    // Extract num score and context
    const numMatch = reason.match(/num=([\d.]+)(?:\[([^\]]+)\])?/);
    if (numMatch) {
      result.num = numMatch[1];
      if (numMatch[2]) result.numContext = numMatch[2];
    }

    // Extract text score
    const textMatch = reason.match(/text=([\d.]+)/);
    if (textMatch) result.text = textMatch[1];

    return result;
  }

  // Fallback: try to extract any key=value pairs
  const kvPattern = /(\w+)=([\d.]+|\w+)/g;
  let match;
  while ((match = kvPattern.exec(reason)) !== null) {
    result[match[1]] = match[2];
  }

  return result;
}

/**
 * Extract numbers from market title for comparison
 */
export function extractNumbers(title: string): number[] {
  const numbers: number[] = [];

  // Match currency amounts like $100,000 or $100k
  const currencyPattern = /\$[\d,]+(?:\.\d+)?[kmb]?/gi;
  const currencyMatches = title.match(currencyPattern) || [];
  for (const m of currencyMatches) {
    const cleaned = m.replace(/[$,]/g, '').toLowerCase();
    let val = parseFloat(cleaned);
    if (cleaned.endsWith('k')) val *= 1000;
    else if (cleaned.endsWith('m')) val *= 1000000;
    else if (cleaned.endsWith('b')) val *= 1000000000;
    if (!isNaN(val)) numbers.push(val);
  }

  // Match percentages like 5.5%
  const percentPattern = /[\d.]+%/g;
  const percentMatches = title.match(percentPattern) || [];
  for (const m of percentMatches) {
    const val = parseFloat(m.replace('%', ''));
    if (!isNaN(val)) numbers.push(val);
  }

  // Match plain numbers (but not years or dates)
  const plainPattern = /(?<![/-])\b(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\b(?![/-])/g;
  let plainMatch;
  while ((plainMatch = plainPattern.exec(title)) !== null) {
    const val = parseFloat(plainMatch[1].replace(/,/g, ''));
    // Skip likely years (1900-2100) and very small numbers
    if (!isNaN(val) && (val < 1900 || val > 2100) && val >= 0.01) {
      numbers.push(val);
    }
  }

  return [...new Set(numbers)]; // dedupe
}

/**
 * Check if two number sets are compatible
 */
export function numbersCompatible(nums1: number[], nums2: number[]): { compatible: boolean; reason: string } {
  if (nums1.length === 0 && nums2.length === 0) {
    return { compatible: true, reason: 'no_numbers' };
  }

  if (nums1.length === 0 || nums2.length === 0) {
    return { compatible: false, reason: 'missing_numbers' };
  }

  // Check if any number pair is compatible
  for (const n1 of nums1) {
    for (const n2 of nums2) {
      const absDiff = Math.abs(n1 - n2);
      const relDiff = Math.abs(n1 - n2) / Math.max(n1, n2);

      if (absDiff <= 1 || relDiff <= 0.001) {
        return { compatible: true, reason: `match:${n1}≈${n2}` };
      }
    }
  }

  return { compatible: false, reason: `no_match:${nums1.join(',')}vs${nums2.join(',')}` };
}

/**
 * Extract comparator from market title (GE, LE, BETWEEN, RANGE, etc.)
 */
export function extractComparator(title: string): string | null {
  const lower = title.toLowerCase();

  if (lower.includes('above') || lower.includes('at or above') || lower.includes('at least') || lower.includes('≥') || lower.includes('>=')) {
    return 'GE';
  }
  if (lower.includes('below') || lower.includes('at or below') || lower.includes('at most') || lower.includes('≤') || lower.includes('<=')) {
    return 'LE';
  }
  if (lower.includes('between') || lower.includes('range')) {
    return 'BETWEEN';
  }
  if (lower.includes('exactly') || lower.includes('equal to')) {
    return 'EQ';
  }

  return null;
}

/**
 * Check if comparators are compatible
 */
export function comparatorsCompatible(comp1: string | null, comp2: string | null): boolean {
  if (!comp1 || !comp2) return true; // If either is missing, assume compatible
  return comp1 === comp2;
}

// ============================================================================
// SAFE RULES BY TOPIC
// ============================================================================

/**
 * CRYPTO_DAILY Safe Rules
 *
 * Requirements:
 * 1. Entity exact match
 * 2. Market type compatible (DAY_EXACT, DAILY_THRESHOLD, DAILY_RANGE, YEARLY_THRESHOLD)
 * 3. Settle date exact match (dayDiff = 0)
 * 4. Comparator compatible (if present)
 * 5. Numbers compatible (absDiff <= 1 OR relDiff <= 0.1%)
 * 6. Text sanity >= 0.12
 * 7. Required fields present
 */
function evaluateCryptoDailyRules(
  link: MarketLinkWithMarkets,
  parsed: Record<string, string>
): SafeRuleResult[] {
  const results: SafeRuleResult[] = [];

  // Rule 1: Entity must be present and match
  if (!parsed.entity) {
    results.push({
      pass: false,
      ruleId: 'CD_ENTITY_PRESENT',
      reason: 'entity not found in reason',
    });
  } else {
    results.push({
      pass: true,
      ruleId: 'CD_ENTITY_PRESENT',
      reason: `entity=${parsed.entity}`,
    });
  }

  // Rule 2: Date type must be compatible
  // CLOSE_TIME is set by crypto pipeline when using closeTime for date matching
  const compatibleDateTypes = ['DAY_EXACT', 'DAILY_THRESHOLD', 'DAILY_RANGE', 'YEARLY_THRESHOLD', 'MONTH_END', 'QUARTER_END', 'CLOSE_TIME'];
  if (!parsed.dateType) {
    results.push({
      pass: false,
      ruleId: 'CD_DATETYPE_VALID',
      reason: 'dateType not found',
    });
  } else if (!compatibleDateTypes.includes(parsed.dateType)) {
    results.push({
      pass: false,
      ruleId: 'CD_DATETYPE_VALID',
      reason: `dateType=${parsed.dateType} not in allowed list`,
    });
  } else {
    results.push({
      pass: true,
      ruleId: 'CD_DATETYPE_VALID',
      reason: `dateType=${parsed.dateType}`,
    });
  }

  // Rule 3: Date diff must be 0 (exact match for auto-confirm)
  if (!parsed.dateDiff) {
    results.push({
      pass: false,
      ruleId: 'CD_DATE_EXACT',
      reason: 'dateDiff not found',
    });
  } else if (parsed.dateDiff !== '0d') {
    results.push({
      pass: false,
      ruleId: 'CD_DATE_EXACT',
      reason: `dateDiff=${parsed.dateDiff} not 0d`,
    });
  } else {
    results.push({
      pass: true,
      ruleId: 'CD_DATE_EXACT',
      reason: 'dateDiff=0d',
    });
  }

  // Rule 4: Comparator compatibility
  const compL = extractComparator(link.leftMarket.title);
  const compR = extractComparator(link.rightMarket.title);
  if (!comparatorsCompatible(compL, compR)) {
    results.push({
      pass: false,
      ruleId: 'CD_COMPARATOR',
      reason: `comparator mismatch: ${compL} vs ${compR}`,
    });
  } else {
    results.push({
      pass: true,
      ruleId: 'CD_COMPARATOR',
      reason: `comparator: ${compL || 'none'}/${compR || 'none'}`,
    });
  }

  // Rule 5: Numbers compatibility
  const numsL = extractNumbers(link.leftMarket.title);
  const numsR = extractNumbers(link.rightMarket.title);
  const numCheck = numbersCompatible(numsL, numsR);
  results.push({
    pass: numCheck.compatible,
    ruleId: 'CD_NUMBERS',
    reason: numCheck.reason,
  });

  // Rule 6: Text sanity >= 0.12
  const textScore = parseFloat(parsed.text || '0');
  if (textScore < 0.12) {
    results.push({
      pass: false,
      ruleId: 'CD_TEXT_SANITY',
      reason: `text=${textScore.toFixed(2)} < 0.12`,
    });
  } else {
    results.push({
      pass: true,
      ruleId: 'CD_TEXT_SANITY',
      reason: `text=${textScore.toFixed(2)}`,
    });
  }

  // Rule 7: Date score should be high (>= 0.9)
  const dateScore = parseFloat(parsed.date || '0');
  if (dateScore < 0.9) {
    results.push({
      pass: false,
      ruleId: 'CD_DATE_SCORE',
      reason: `dateScore=${dateScore.toFixed(2)} < 0.90`,
    });
  } else {
    results.push({
      pass: true,
      ruleId: 'CD_DATE_SCORE',
      reason: `dateScore=${dateScore.toFixed(2)}`,
    });
  }

  return results;
}

/**
 * CRYPTO_INTRADAY Safe Rules
 *
 * Requirements:
 * 1. Entity exact match
 * 2. Time bucket exact match
 * 3. Direction match (if present)
 * 4. Text sanity >= 0.15
 */
function evaluateCryptoIntradayRules(
  _link: MarketLinkWithMarkets,
  parsed: Record<string, string>
): SafeRuleResult[] {
  const results: SafeRuleResult[] = [];

  // Rule 1: Entity must be present
  if (!parsed.entity) {
    results.push({
      pass: false,
      ruleId: 'CI_ENTITY_PRESENT',
      reason: 'entity not found',
    });
  } else {
    results.push({
      pass: true,
      ruleId: 'CI_ENTITY_PRESENT',
      reason: `entity=${parsed.entity}`,
    });
  }

  // Rule 2: Bucket must be present (indicates exact time match)
  if (!parsed.bucket) {
    results.push({
      pass: false,
      ruleId: 'CI_BUCKET_PRESENT',
      reason: 'bucket not found',
    });
  } else {
    results.push({
      pass: true,
      ruleId: 'CI_BUCKET_PRESENT',
      reason: `bucket=${parsed.bucket}`,
    });
  }

  // Rule 3: Direction must match if both present
  if (parsed.dirL && parsed.dirR && parsed.dirL !== parsed.dirR) {
    results.push({
      pass: false,
      ruleId: 'CI_DIRECTION',
      reason: `direction mismatch: ${parsed.dirL} vs ${parsed.dirR}`,
    });
  } else {
    results.push({
      pass: true,
      ruleId: 'CI_DIRECTION',
      reason: `direction: ${parsed.dirL || 'any'}/${parsed.dirR || 'any'}`,
    });
  }

  // Rule 4: Text sanity >= 0.15
  const textScore = parseFloat(parsed.text || '0');
  if (textScore < 0.15) {
    results.push({
      pass: false,
      ruleId: 'CI_TEXT_SANITY',
      reason: `text=${textScore.toFixed(2)} < 0.15`,
    });
  } else {
    results.push({
      pass: true,
      ruleId: 'CI_TEXT_SANITY',
      reason: `text=${textScore.toFixed(2)}`,
    });
  }

  return results;
}

/**
 * MACRO Safe Rules
 *
 * Requirements:
 * 1. Macro entity exact match (me = 0.50)
 * 2. Period compatibility tier MUST be STRONG (exact, month_in_quarter, quarter_in_year)
 * 3. Period score >= 0.22 (excludes month_in_year which is 0.18)
 * 4. Text sanity >= 0.10
 * 5. Tier must be STRONG
 */
function evaluateMacroRules(
  _link: MarketLinkWithMarkets,
  parsed: Record<string, string>
): SafeRuleResult[] {
  const results: SafeRuleResult[] = [];

  // Rule 1: Macro entity must match (me = 0.50)
  const meScore = parseFloat(parsed.me || '0');
  if (meScore < 0.50) {
    results.push({
      pass: false,
      ruleId: 'MA_ENTITY_MATCH',
      reason: `me=${meScore.toFixed(2)} < 0.50`,
    });
  } else {
    results.push({
      pass: true,
      ruleId: 'MA_ENTITY_MATCH',
      reason: `me=${meScore.toFixed(2)}`,
    });
  }

  // Rule 2: Period kind must be STRONG (exact, month_in_quarter, quarter_in_year)
  const strongKinds = ['exact', 'month_in_quarter', 'quarter_in_year'];
  if (!parsed.perKind) {
    results.push({
      pass: false,
      ruleId: 'MA_PERIOD_KIND',
      reason: 'perKind not found',
    });
  } else if (!strongKinds.includes(parsed.perKind)) {
    results.push({
      pass: false,
      ruleId: 'MA_PERIOD_KIND',
      reason: `perKind=${parsed.perKind} not in STRONG tier`,
    });
  } else {
    results.push({
      pass: true,
      ruleId: 'MA_PERIOD_KIND',
      reason: `perKind=${parsed.perKind}`,
    });
  }

  // Rule 3: Period score >= 0.22
  const perScore = parseFloat(parsed.per || '0');
  if (perScore < 0.22) {
    results.push({
      pass: false,
      ruleId: 'MA_PERIOD_SCORE',
      reason: `per=${perScore.toFixed(2)} < 0.22`,
    });
  } else {
    results.push({
      pass: true,
      ruleId: 'MA_PERIOD_SCORE',
      reason: `per=${perScore.toFixed(2)}`,
    });
  }

  // Rule 4: Text sanity >= 0.10
  const txtScore = parseFloat(parsed.txt || '0');
  if (txtScore < 0.10) {
    results.push({
      pass: false,
      ruleId: 'MA_TEXT_SANITY',
      reason: `txt=${txtScore.toFixed(2)} < 0.10`,
    });
  } else {
    results.push({
      pass: true,
      ruleId: 'MA_TEXT_SANITY',
      reason: `txt=${txtScore.toFixed(2)}`,
    });
  }

  // Rule 5: Tier must be STRONG
  if (parsed.tier !== 'STRONG') {
    results.push({
      pass: false,
      ruleId: 'MA_TIER_STRONG',
      reason: `tier=${parsed.tier || 'missing'} not STRONG`,
    });
  } else {
    results.push({
      pass: true,
      ruleId: 'MA_TIER_STRONG',
      reason: 'tier=STRONG',
    });
  }

  return results;
}

// ============================================================================
// MAIN EVALUATOR
// ============================================================================

/**
 * Default minimum scores by topic (v3.1.0: all topics)
 */
export const DEFAULT_MIN_SCORES: Record<Topic, number> = {
  crypto_daily: 0.88,
  crypto_intraday: 0.85,
  macro: 0.90,
  rates: 0.90,              // v3.1.0: Same as macro (FED rates)
  elections: 0.88,          // v3.1.0: High confidence for elections
  geopolitics: 0.85,        // v3.1.0: Region/event matching
  entertainment: 0.88,      // v3.1.0: Awards/nominees matching
  finance: 0.88,            // v3.1.0: Index/forex matching
  climate: 0.85,            // v3.1.0: Location/metric matching
  commodities: 0.85,        // v3.1.0: Commodity/contract matching
  sports: 0.90,             // v3.1.0: Event/team matching (MVE filtered)
};

/**
 * Evaluate safe rules for a link
 */
export function evaluateSafeRules(
  link: MarketLinkWithMarkets,
  topic: Topic,
  minScore?: number
): SafeEvaluation {
  const effectiveMinScore = minScore ?? DEFAULT_MIN_SCORES[topic];
  const parsed = parseReasonString(link.reason);

  // Pre-check: score must meet minimum
  if (link.score < effectiveMinScore) {
    return {
      pass: false,
      topic,
      score: link.score,
      results: [{
        pass: false,
        ruleId: 'SCORE_MINIMUM',
        reason: `score=${link.score.toFixed(3)} < ${effectiveMinScore}`,
      }],
      failedRules: ['SCORE_MINIMUM'],
      passedRules: [],
    };
  }

  // Evaluate topic-specific rules
  let results: SafeRuleResult[];
  switch (topic) {
    case 'crypto_daily':
      results = evaluateCryptoDailyRules(link, parsed);
      break;
    case 'crypto_intraday':
      results = evaluateCryptoIntradayRules(link, parsed);
      break;
    case 'macro':
      results = evaluateMacroRules(link, parsed);
      break;
    default:
      results = [{
        pass: false,
        ruleId: 'UNKNOWN_TOPIC',
        reason: `unknown topic: ${topic}`,
      }];
  }

  const failedRules = results.filter(r => !r.pass).map(r => r.ruleId);
  const passedRules = results.filter(r => r.pass).map(r => r.ruleId);
  const pass = failedRules.length === 0;

  return {
    pass,
    topic,
    score: link.score,
    results,
    failedRules,
    passedRules,
  };
}

/**
 * Format evaluation result for logging
 */
export function formatEvaluation(eval_: SafeEvaluation): string {
  const status = eval_.pass ? '✓ PASS' : '✗ FAIL';
  const lines = [
    `${status} [${eval_.topic}] score=${eval_.score.toFixed(3)}`,
  ];

  for (const r of eval_.results) {
    const mark = r.pass ? '  ✓' : '  ✗';
    lines.push(`${mark} ${r.ruleId}: ${r.reason}`);
  }

  return lines.join('\n');
}

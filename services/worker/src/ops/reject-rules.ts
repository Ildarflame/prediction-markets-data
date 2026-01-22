/**
 * Reject Rules Evaluator for Auto-Reject (v2.6.8)
 *
 * Rules to identify OBVIOUS garbage that should be rejected.
 * Conservative: only reject when clearly wrong.
 */

import type { MarketLink, Market, Outcome } from '@data-module/db';

export type Topic = 'crypto_daily' | 'crypto_intraday' | 'macro' | 'all';

export interface RejectRuleResult {
  reject: boolean;
  ruleId: string;
  reason: string;
}

export interface RejectEvaluation {
  reject: boolean;
  topic: Topic | string;
  score: number;
  ageHours: number;
  results: RejectRuleResult[];
  rejectionReasons: string[];
}

export interface MarketLinkWithMarkets extends MarketLink {
  leftMarket: Market & { outcomes: Outcome[] };
  rightMarket: Market & { outcomes: Outcome[] };
}

// ============================================================================
// TOPIC-SPECIFIC HARD FLOORS
// ============================================================================

export const HARD_FLOOR_SCORES: Record<string, number> = {
  crypto_daily: 0.55,
  crypto_intraday: 0.65,
  macro: 0.60,
  all: 0.50,
};

export const TEXT_SANITY_FLOOR = 0.05;

// ============================================================================
// DETECTION PATTERNS
// ============================================================================

/**
 * Patterns that indicate entity mismatch in reason string
 */
const ENTITY_MISMATCH_PATTERNS = [
  /entity mismatch/i,
  /different entit/i,
  /wrong entity/i,
  /asset mismatch/i,
  /ENTITY_GATE_FAIL/i,
  /MACRO_GATE_FAIL.*entities missing/i,
];

/**
 * Patterns that indicate date/period mismatch
 */
const DATE_MISMATCH_PATTERNS = [
  /date mismatch/i,
  /settle mismatch/i,
  /different date/i,
  /incompatible period/i,
  /period mismatch/i,
  /DATE_GATE_FAIL/i,
  /PERIOD_GATE_FAIL.*incompatible/i,
];

/**
 * Patterns that indicate text gate failure
 */
const TEXT_GATE_PATTERNS = [
  /TEXT_GATE_FAIL/i,
];

/**
 * Check if reason contains entity mismatch
 */
function hasEntityMismatch(reason: string | null): boolean {
  if (!reason) return false;
  return ENTITY_MISMATCH_PATTERNS.some(p => p.test(reason));
}

/**
 * Check if reason contains date mismatch
 */
function hasDateMismatch(reason: string | null): boolean {
  if (!reason) return false;
  return DATE_MISMATCH_PATTERNS.some(p => p.test(reason));
}

/**
 * Check if reason contains text gate failure
 */
function hasTextGateFail(reason: string | null): boolean {
  if (!reason) return false;
  return TEXT_GATE_PATTERNS.some(p => p.test(reason));
}

/**
 * Extract text score from reason string
 */
function extractTextScore(reason: string | null): number | null {
  if (!reason) return null;

  // Try different patterns
  const patterns = [
    /text=([\d.]+)/,
    /txt=([\d.]+)/,
    /jaccard=([\d.]+)/,
    /jc=([\d.]+)/,
  ];

  for (const pattern of patterns) {
    const match = reason.match(pattern);
    if (match) {
      return parseFloat(match[1]);
    }
  }

  return null;
}

/**
 * Detect if markets are different types (daily vs intraday)
 */
function detectIncompatibleMarketType(
  leftTitle: string,
  rightTitle: string,
  _reason: string | null
): { incompatible: boolean; leftType: string; rightType: string } {
  // Intraday indicators
  const intradayPatterns = [
    /in (the )?next \d+ ?min/i,
    /in (the )?next hour/i,
    /\d{1,2}:\d{2}/,
    /\d+ ?minute/i,
    /hourly/i,
    /intraday/i,
  ];

  // Daily indicators
  const dailyPatterns = [
    /on [a-z]+ \d+/i,
    /by end of day/i,
    /daily/i,
    /close price/i,
    /settle/i,
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b.*\d{1,2}/i,
  ];

  const leftIntraday = intradayPatterns.some(p => p.test(leftTitle));
  const rightIntraday = intradayPatterns.some(p => p.test(rightTitle));
  const leftDaily = dailyPatterns.some(p => p.test(leftTitle));
  const rightDaily = dailyPatterns.some(p => p.test(rightTitle));

  const leftType = leftIntraday ? 'intraday' : leftDaily ? 'daily' : 'unknown';
  const rightType = rightIntraday ? 'intraday' : rightDaily ? 'daily' : 'unknown';

  // Only flag as incompatible if we're confident about both types
  const incompatible =
    (leftType === 'intraday' && rightType === 'daily') ||
    (leftType === 'daily' && rightType === 'intraday');

  return { incompatible, leftType, rightType };
}

/**
 * Extract settle date from reason and check for large mismatch
 */
function hasLargeSettleDateMismatch(reason: string | null, topic: string): boolean {
  if (!reason) return false;

  // For crypto_daily: check dateDiff
  const dateDiffMatch = reason.match(/date=[\d.]+\(([+-]?\d+)d\)/);
  if (dateDiffMatch) {
    const dayDiff = Math.abs(parseInt(dateDiffMatch[1], 10));
    // For auto-confirm we require 0d, for reject we allow ±1d
    // Only reject if diff > 1 day
    if (dayDiff > 1) return true;
  }

  // For macro: check period compatibility
  if (topic === 'macro' || reason.startsWith('MACRO:')) {
    const perKindMatch = reason.match(/per=[\d.]+\[([^\]]+)\]/);
    if (perKindMatch) {
      const kind = perKindMatch[1];
      // month_in_year is weak, but not necessarily rejection
      // Only incompatible periods (none) should be rejected
      if (kind === 'none' || reason.includes('incompatible')) {
        return true;
      }
    }
  }

  return false;
}

// ============================================================================
// MAIN EVALUATOR
// ============================================================================

/**
 * Evaluate reject rules for a link
 */
export function evaluateRejectRules(
  link: MarketLinkWithMarkets,
  topic: Topic | string,
  minAgeHours: number = 24
): RejectEvaluation {
  const results: RejectRuleResult[] = [];

  // Calculate age
  const ageMs = Date.now() - new Date(link.createdAt).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);

  // Determine effective topic
  const effectiveTopic = (link.topic || topic || 'all') as string;

  // Rule 0: Age check (don't reject fresh links)
  if (ageHours < minAgeHours) {
    return {
      reject: false,
      topic: effectiveTopic,
      score: link.score,
      ageHours,
      results: [{
        reject: false,
        ruleId: 'AGE_TOO_FRESH',
        reason: `age=${ageHours.toFixed(1)}h < ${minAgeHours}h minimum`,
      }],
      rejectionReasons: [],
    };
  }

  results.push({
    reject: false,
    ruleId: 'AGE_CHECK',
    reason: `age=${ageHours.toFixed(1)}h >= ${minAgeHours}h`,
  });

  // Rule 1: Score below hard floor
  const hardFloor = HARD_FLOOR_SCORES[effectiveTopic] || HARD_FLOOR_SCORES.all;
  if (link.score < hardFloor) {
    results.push({
      reject: true,
      ruleId: 'SCORE_BELOW_FLOOR',
      reason: `score=${link.score.toFixed(3)} < ${hardFloor} (${effectiveTopic} floor)`,
    });
  } else {
    results.push({
      reject: false,
      ruleId: 'SCORE_ABOVE_FLOOR',
      reason: `score=${link.score.toFixed(3)} >= ${hardFloor}`,
    });
  }

  // Rule 2: Entity mismatch detected
  if (hasEntityMismatch(link.reason)) {
    results.push({
      reject: true,
      ruleId: 'ENTITY_MISMATCH',
      reason: 'entity mismatch detected in reason',
    });
  }

  // Rule 3: Incompatible market types (daily vs intraday)
  const typeCheck = detectIncompatibleMarketType(
    link.leftMarket.title,
    link.rightMarket.title,
    link.reason
  );
  if (typeCheck.incompatible) {
    results.push({
      reject: true,
      ruleId: 'MARKET_TYPE_MISMATCH',
      reason: `type mismatch: ${typeCheck.leftType} vs ${typeCheck.rightType}`,
    });
  }

  // Rule 4: Large settle date mismatch
  if (hasLargeSettleDateMismatch(link.reason, effectiveTopic)) {
    results.push({
      reject: true,
      ruleId: 'DATE_MISMATCH_LARGE',
      reason: 'settle date mismatch beyond tolerance',
    });
  }

  // Rule 5: Text sanity below floor
  const textScore = extractTextScore(link.reason);
  if (textScore !== null && textScore < TEXT_SANITY_FLOOR) {
    results.push({
      reject: true,
      ruleId: 'TEXT_SANITY_FLOOR',
      reason: `text=${textScore.toFixed(2)} < ${TEXT_SANITY_FLOOR}`,
    });
  }

  // Rule 6: Explicit text gate failure
  if (hasTextGateFail(link.reason)) {
    results.push({
      reject: true,
      ruleId: 'TEXT_GATE_FAILED',
      reason: 'TEXT_GATE_FAIL in reason',
    });
  }

  // Rule 7: Explicit date gate failure with incompatibility
  if (hasDateMismatch(link.reason) && link.reason?.includes('incompatible')) {
    results.push({
      reject: true,
      ruleId: 'DATE_GATE_FAILED',
      reason: 'DATE/PERIOD_GATE_FAIL with incompatibility',
    });
  }

  const rejectionReasons = results.filter(r => r.reject).map(r => r.ruleId);
  const reject = rejectionReasons.length > 0;

  return {
    reject,
    topic: effectiveTopic,
    score: link.score,
    ageHours,
    results,
    rejectionReasons,
  };
}

/**
 * Format evaluation result for logging
 */
export function formatRejectEvaluation(eval_: RejectEvaluation): string {
  const status = eval_.reject ? '✗ REJECT' : '○ KEEP';
  const lines = [
    `${status} [${eval_.topic}] score=${eval_.score.toFixed(3)} age=${eval_.ageHours.toFixed(1)}h`,
  ];

  for (const r of eval_.results) {
    const mark = r.reject ? '  ✗' : '  ○';
    lines.push(`${mark} ${r.ruleId}: ${r.reason}`);
  }

  return lines.join('\n');
}

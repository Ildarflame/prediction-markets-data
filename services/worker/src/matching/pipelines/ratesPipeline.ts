/**
 * Rates Pipeline (v3.0.0)
 *
 * Pipeline for matching interest rate / central bank decision markets
 * across venues (FOMC, Fed, ECB, BoE, etc.).
 */

import { CanonicalTopic, jaccard, clampScoreSimple } from '@data-module/core';
import type { MarketRepository, EligibleMarket } from '@data-module/db';
import { BasePipeline } from './basePipeline.js';
import type {
  FetchOptions,
  HardGateResult,
  AutoConfirmResult,
  AutoRejectResult,
  MarketWithSignals,
} from '../engineV3.types.js';
import {
  extractRatesSignals,
  isRatesMarket,
  CentralBank,
  RateAction,
  type RatesSignals,
} from '../signals/ratesSignals.js';

/**
 * Market with rates signals
 */
export interface RatesMarket extends MarketWithSignals<RatesSignals> {
  market: EligibleMarket;
  signals: RatesSignals;
}

/**
 * Rates score result
 */
export interface RatesScoreResult {
  score: number;
  reason: string;
  tier: 'STRONG' | 'WEAK';
  /** Central bank score component */
  centralBankScore: number;
  /** Meeting date/month score component */
  dateScore: number;
  /** Rate action score component */
  actionScore: number;
  /** Basis points score component */
  bpsScore: number;
  /** Text similarity score component */
  textScore: number;
  /** Day difference between meeting dates */
  dayDiff: number | null;
  /** Month difference */
  monthDiff: number | null;
}

/**
 * Rates-specific keywords for DB query
 */
const RATES_KEYWORDS = [
  'fed', 'fomc', 'federal reserve', 'interest rate', 'rate cut', 'rate hike',
  'ecb', 'bank of england', 'boe', 'boj', 'bank of japan',
  'basis points', 'bps', 'fed funds',
];

/**
 * Scoring weights for rates matching
 */
const RATES_WEIGHTS = {
  centralBank: 0.40,  // Must match exactly (hard gate)
  date: 0.30,         // Meeting date/month
  action: 0.15,       // CUT/HIKE/HOLD
  bps: 0.10,          // Basis points
  text: 0.05,         // Text similarity
};

/**
 * Calculate day difference between two YYYY-MM-DD dates
 */
function dateDayDiff(dateA: string | null, dateB: string | null): number | null {
  if (!dateA || !dateB) return null;

  const parseDate = (s: string): Date | null => {
    const match = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
  };

  const a = parseDate(dateA);
  const b = parseDate(dateB);
  if (!a || !b) return null;

  const diffMs = Math.abs(a.getTime() - b.getTime());
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Calculate month difference between two YYYY-MM strings
 */
function monthDiff(monthA: string | null, monthB: string | null): number | null {
  if (!monthA || !monthB) return null;

  const parseMonth = (s: string): { year: number; month: number } | null => {
    const match = s.match(/^(\d{4})-(\d{2})$/);
    if (!match) return null;
    return { year: parseInt(match[1]), month: parseInt(match[2]) };
  };

  const a = parseMonth(monthA);
  const b = parseMonth(monthB);
  if (!a || !b) return null;

  return Math.abs((a.year - b.year) * 12 + (a.month - b.month));
}

/**
 * Rates Pipeline Implementation
 */
export class RatesPipeline extends BasePipeline<RatesMarket, RatesSignals, RatesScoreResult> {
  readonly topic = CanonicalTopic.RATES;
  readonly algoVersion = 'rates@3.0.0';
  readonly description = 'Interest rate and central bank decision matching';
  readonly supportsAutoConfirm = true;
  readonly supportsAutoReject = true;

  /**
   * Fetch eligible rates markets
   */
  async fetchMarkets(
    repo: MarketRepository,
    options: FetchOptions
  ): Promise<RatesMarket[]> {
    const { venue, lookbackHours, limit, excludeSports = true } = options;

    // Fetch markets with rates keywords
    const markets = await repo.listEligibleMarkets(venue, {
      lookbackHours,
      limit,
      titleKeywords: RATES_KEYWORDS,
      orderBy: 'closeTime',
    });

    // Filter and extract signals
    const result: RatesMarket[] = [];

    for (const market of markets) {
      // Skip sports markets
      if (excludeSports && this.isSportsMarket(market)) {
        continue;
      }

      // Skip if not a rates market
      if (!isRatesMarket(market.title)) {
        continue;
      }

      const signals = extractRatesSignals(market);

      // Must have a central bank to be useful
      if (signals.centralBank === CentralBank.UNKNOWN) {
        continue;
      }

      result.push({ market, signals });
    }

    return result;
  }

  /**
   * Check if market is sports (should be excluded)
   */
  private isSportsMarket(market: EligibleMarket): boolean {
    const lower = market.title.toLowerCase();
    const sportsKeywords = [
      'nba', 'nfl', 'mlb', 'nhl', 'soccer', 'football game',
      'points', 'rebounds', 'assists', 'touchdowns',
    ];
    return sportsKeywords.some(kw => lower.includes(kw));
  }

  /**
   * Build index by central bank + meeting month
   */
  buildIndex(markets: RatesMarket[]): Map<string, RatesMarket[]> {
    const index = new Map<string, RatesMarket[]>();

    for (const market of markets) {
      if (!market.signals.centralBank || market.signals.centralBank === CentralBank.UNKNOWN) {
        continue;
      }

      // Primary key: centralBank + meetingMonth
      if (market.signals.meetingMonth) {
        const key = `${market.signals.centralBank}|${market.signals.meetingMonth}`;
        if (!index.has(key)) {
          index.set(key, []);
        }
        index.get(key)!.push(market);
      }

      // Secondary key: centralBank + year (for year-end predictions)
      if (market.signals.year) {
        const yearKey = `${market.signals.centralBank}|${market.signals.year}`;
        if (!index.has(yearKey)) {
          index.set(yearKey, []);
        }
        index.get(yearKey)!.push(market);
      }
    }

    return index;
  }

  /**
   * Find candidates for a given rates market
   */
  findCandidates(market: RatesMarket, index: Map<string, RatesMarket[]>): RatesMarket[] {
    const candidates: RatesMarket[] = [];
    const seenIds = new Set<number>();

    // Lookup by central bank + meeting month
    if (market.signals.meetingMonth) {
      const key = `${market.signals.centralBank}|${market.signals.meetingMonth}`;
      const matches = index.get(key) || [];
      for (const m of matches) {
        if (!seenIds.has(m.market.id)) {
          seenIds.add(m.market.id);
          candidates.push(m);
        }
      }

      // Also check ±1 month
      const parts = market.signals.meetingMonth.match(/^(\d{4})-(\d{2})$/);
      if (parts) {
        const year = parseInt(parts[1]);
        const month = parseInt(parts[2]);

        // Previous month
        const prevMonth = month === 1 ? 12 : month - 1;
        const prevYear = month === 1 ? year - 1 : year;
        const prevKey = `${market.signals.centralBank}|${prevYear}-${String(prevMonth).padStart(2, '0')}`;
        for (const m of index.get(prevKey) || []) {
          if (!seenIds.has(m.market.id)) {
            seenIds.add(m.market.id);
            candidates.push(m);
          }
        }

        // Next month
        const nextMonth = month === 12 ? 1 : month + 1;
        const nextYear = month === 12 ? year + 1 : year;
        const nextKey = `${market.signals.centralBank}|${nextYear}-${String(nextMonth).padStart(2, '0')}`;
        for (const m of index.get(nextKey) || []) {
          if (!seenIds.has(m.market.id)) {
            seenIds.add(m.market.id);
            candidates.push(m);
          }
        }
      }
    }

    // Also lookup by year
    if (market.signals.year) {
      const yearKey = `${market.signals.centralBank}|${market.signals.year}`;
      for (const m of index.get(yearKey) || []) {
        if (!seenIds.has(m.market.id)) {
          seenIds.add(m.market.id);
          candidates.push(m);
        }
      }
    }

    return candidates;
  }

  /**
   * Check hard gates for rates matching
   */
  checkHardGates(left: RatesMarket, right: RatesMarket): HardGateResult {
    const lSig = left.signals;
    const rSig = right.signals;

    // Gate 1: Central bank must match exactly
    if (lSig.centralBank !== rSig.centralBank) {
      return {
        passed: false,
        failReason: `Central bank mismatch: ${lSig.centralBank} vs ${rSig.centralBank}`,
      };
    }

    // Gate 2: Must have central bank
    if (lSig.centralBank === CentralBank.UNKNOWN || rSig.centralBank === CentralBank.UNKNOWN) {
      return {
        passed: false,
        failReason: 'Unknown central bank',
      };
    }

    // Gate 3: Meeting date/month within reasonable range
    if (lSig.meetingMonth && rSig.meetingMonth) {
      const mDiff = monthDiff(lSig.meetingMonth, rSig.meetingMonth);
      if (mDiff !== null && mDiff > 1) {
        return {
          passed: false,
          failReason: `Month difference too large: ${mDiff} months`,
        };
      }
    }

    // Gate 4: If both have specific dates, check they're within 7 days
    if (lSig.meetingDate && rSig.meetingDate) {
      const dDiff = dateDayDiff(lSig.meetingDate, rSig.meetingDate);
      if (dDiff !== null && dDiff > 7) {
        return {
          passed: false,
          failReason: `Date difference too large: ${dDiff} days`,
        };
      }
    }

    return { passed: true, failReason: null };
  }

  /**
   * Score rates market pair
   */
  score(left: RatesMarket, right: RatesMarket): RatesScoreResult | null {
    const lSig = left.signals;
    const rSig = right.signals;

    // Central bank score (hard gate ensures this is 1.0)
    const centralBankScore = lSig.centralBank === rSig.centralBank ? 1.0 : 0.0;

    // Date score
    let dateScore = 0;
    let dayDiff: number | null = null;
    let mDiff: number | null = null;

    if (lSig.meetingDate && rSig.meetingDate) {
      dayDiff = dateDayDiff(lSig.meetingDate, rSig.meetingDate);
      if (dayDiff === 0) {
        dateScore = 1.0;
      } else if (dayDiff !== null && dayDiff <= 1) {
        dateScore = 0.9;
      } else if (dayDiff !== null && dayDiff <= 3) {
        dateScore = 0.7;
      } else if (dayDiff !== null && dayDiff <= 7) {
        dateScore = 0.5;
      }
    } else if (lSig.meetingMonth && rSig.meetingMonth) {
      mDiff = monthDiff(lSig.meetingMonth, rSig.meetingMonth);
      if (mDiff === 0) {
        dateScore = 0.8; // Same month but no specific date
      } else if (mDiff === 1) {
        dateScore = 0.4; // Adjacent month
      }
    } else if (lSig.year && rSig.year && lSig.year === rSig.year) {
      dateScore = 0.3; // Same year only
    }

    // Action score
    let actionScore = 0;
    if (lSig.action !== RateAction.UNKNOWN && rSig.action !== RateAction.UNKNOWN) {
      if (lSig.action === rSig.action) {
        actionScore = 1.0;
      } else if (
        (lSig.action === RateAction.HOLD && rSig.action === RateAction.PAUSE) ||
        (lSig.action === RateAction.PAUSE && rSig.action === RateAction.HOLD)
      ) {
        // HOLD and PAUSE are similar
        actionScore = 0.8;
      }
    } else if (lSig.action === RateAction.UNKNOWN || rSig.action === RateAction.UNKNOWN) {
      // One unknown - partial credit
      actionScore = 0.5;
    }

    // Basis points score
    let bpsScore = 0;
    if (lSig.basisPoints !== null && rSig.basisPoints !== null) {
      if (lSig.basisPoints === rSig.basisPoints) {
        bpsScore = 1.0;
      } else if (Math.abs(lSig.basisPoints - rSig.basisPoints) <= 25) {
        bpsScore = 0.7;
      } else if (Math.abs(lSig.basisPoints - rSig.basisPoints) <= 50) {
        bpsScore = 0.4;
      }
    } else if (lSig.basisPoints === null && rSig.basisPoints === null) {
      // Neither has bps - neutral
      bpsScore = 0.5;
    }

    // Text score (jaccard)
    const lTokens = lSig.titleTokens ?? [];
    const rTokens = rSig.titleTokens ?? [];
    const textScore = jaccard(lTokens, rTokens);

    // Weighted score
    const rawScore =
      RATES_WEIGHTS.centralBank * centralBankScore +
      RATES_WEIGHTS.date * dateScore +
      RATES_WEIGHTS.action * actionScore +
      RATES_WEIGHTS.bps * bpsScore +
      RATES_WEIGHTS.text * textScore;

    const score = clampScoreSimple(rawScore);

    // Tier determination
    const isStrong = dateScore >= 0.7 && (actionScore >= 0.8 || actionScore === 0.5);
    const tier: 'STRONG' | 'WEAK' = isStrong ? 'STRONG' : 'WEAK';

    // Build reason string
    const reason = [
      `bank=${lSig.centralBank}`,
      `date=${dateScore.toFixed(2)}${dayDiff !== null ? `(${dayDiff}d)` : mDiff !== null ? `(${mDiff}m)` : ''}`,
      `action=${actionScore.toFixed(2)}[${lSig.action}/${rSig.action}]`,
      `bps=${bpsScore.toFixed(2)}[${lSig.basisPoints ?? '?'}/${rSig.basisPoints ?? '?'}]`,
      `text=${textScore.toFixed(2)}`,
    ].join(' ');

    return {
      score,
      reason,
      tier,
      centralBankScore,
      dateScore,
      actionScore,
      bpsScore,
      textScore,
      dayDiff,
      monthDiff: mDiff,
    };
  }

  /**
   * Check if match should be auto-confirmed
   */
  shouldAutoConfirm(
    left: RatesMarket,
    right: RatesMarket,
    scoreResult: RatesScoreResult
  ): AutoConfirmResult {
    // Auto-confirm conditions:
    // 1. Score >= 0.85
    // 2. Central bank exact match (always true due to hard gate)
    // 3. Meeting date exact match (same day)
    // 4. Action exact match (or both unknown)
    // 5. If bps specified, must match exactly

    const lSig = left.signals;
    const rSig = right.signals;

    if (scoreResult.score < 0.85) {
      return { shouldConfirm: false, rule: null, confidence: 0 };
    }

    // Date must be exact
    if (scoreResult.dayDiff !== 0) {
      return { shouldConfirm: false, rule: null, confidence: 0 };
    }

    // Action must match or both unknown
    if (lSig.action !== RateAction.UNKNOWN && rSig.action !== RateAction.UNKNOWN) {
      if (lSig.action !== rSig.action) {
        return { shouldConfirm: false, rule: null, confidence: 0 };
      }
    }

    // BPS must match if both specified
    if (lSig.basisPoints !== null && rSig.basisPoints !== null) {
      if (lSig.basisPoints !== rSig.basisPoints) {
        return { shouldConfirm: false, rule: null, confidence: 0 };
      }
    }

    // Text sanity check
    if (scoreResult.textScore < 0.15) {
      return { shouldConfirm: false, rule: null, confidence: 0 };
    }

    return {
      shouldConfirm: true,
      rule: 'RATES_EXACT_MATCH',
      confidence: scoreResult.score,
    };
  }

  /**
   * Check if match should be auto-rejected
   */
  shouldAutoReject(
    left: RatesMarket,
    right: RatesMarket,
    scoreResult: RatesScoreResult
  ): AutoRejectResult {
    const lSig = left.signals;
    const rSig = right.signals;

    // Reject if score < 0.55
    if (scoreResult.score < 0.55) {
      return {
        shouldReject: true,
        rule: 'LOW_SCORE',
        reason: `Score ${scoreResult.score.toFixed(2)} < 0.55`,
      };
    }

    // Reject if actions conflict (CUT vs HIKE)
    if (
      (lSig.action === RateAction.CUT && rSig.action === RateAction.HIKE) ||
      (lSig.action === RateAction.HIKE && rSig.action === RateAction.CUT)
    ) {
      return {
        shouldReject: true,
        rule: 'ACTION_CONFLICT',
        reason: `Conflicting actions: ${lSig.action} vs ${rSig.action}`,
      };
    }

    // Reject if BPS conflict (both specified, differ by > 50bps)
    if (lSig.basisPoints !== null && rSig.basisPoints !== null) {
      if (Math.abs(lSig.basisPoints - rSig.basisPoints) > 50) {
        return {
          shouldReject: true,
          rule: 'BPS_MISMATCH',
          reason: `BPS mismatch: ${lSig.basisPoints} vs ${rSig.basisPoints}`,
        };
      }
    }

    return { shouldReject: false, rule: null, reason: null };
  }
}

/**
 * Singleton instance
 */
export const ratesPipeline = new RatesPipeline();

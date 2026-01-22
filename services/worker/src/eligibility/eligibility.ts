/**
 * Eligibility v3 - Unified market eligibility filtering (v2.6.7)
 *
 * Single source of truth for determining which markets are eligible for:
 * - Matching (suggest-matches)
 * - Quoting (quotes sync)
 * - Diagnostics (sanity checks)
 *
 * KEY PRINCIPLE: Never trust status alone.
 * - Active markets with closeTime in past (beyond grace) are "stale_active"
 * - Use time-based filtering as primary eligibility check
 */

import type { Venue, MarketStatus } from '@data-module/db';

// Default configuration from environment variables
const DEFAULT_GRACE_MINUTES = parseInt(process.env.ELIGIBILITY_GRACE_MINUTES || '60', 10);
const DEFAULT_FORWARD_HOURS_CRYPTO_DAILY = parseInt(
  process.env.ELIGIBILITY_FORWARD_HOURS_CRYPTO_DAILY || '72',
  10
);
const DEFAULT_LOOKBACK_HOURS_CRYPTO_DAILY = parseInt(
  process.env.ELIGIBILITY_LOOKBACK_HOURS_CRYPTO_DAILY || '168',
  10
);
const DEFAULT_LOOKBACK_HOURS_MACRO = parseInt(
  process.env.ELIGIBILITY_LOOKBACK_HOURS_MACRO || '720',
  10
);

export type Topic = 'crypto' | 'crypto_daily' | 'crypto_intraday' | 'macro' | 'politics' | 'all';

export interface EligibilityConfig {
  venue: Venue;
  topic?: Topic;
  now?: Date;
  /** Hours to look back for closed markets (default: 168 for crypto, 720 for macro) */
  lookbackHours?: number;
  /** Hours to look forward for closeTime (default: 72 for crypto_daily) */
  forwardHours?: number;
  /** Grace period in minutes for "stale active" detection (default: 60) */
  graceMinutes?: number;
  /** Include resolved/archived markets (default: false) */
  includeResolved?: boolean;
}

export interface EligibilityReason {
  code: string;
  message: string;
  severity: 'info' | 'warn' | 'exclude';
}

export interface MarketForEligibility {
  id: number;
  title: string;
  status: MarketStatus | string;
  closeTime: Date | null;
  venue: Venue;
  category?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface EligibilityResult {
  eligible: boolean;
  reasons: EligibilityReason[];
}

/**
 * Get default lookback hours based on topic
 */
export function getDefaultLookbackHours(topic?: Topic): number {
  switch (topic) {
    case 'crypto':
    case 'crypto_daily':
    case 'crypto_intraday':
      return DEFAULT_LOOKBACK_HOURS_CRYPTO_DAILY;
    case 'macro':
    case 'politics':
      return DEFAULT_LOOKBACK_HOURS_MACRO;
    default:
      return DEFAULT_LOOKBACK_HOURS_CRYPTO_DAILY; // Default to crypto
  }
}

/**
 * Get default forward hours based on topic
 */
export function getDefaultForwardHours(topic?: Topic): number {
  switch (topic) {
    case 'crypto':
    case 'crypto_daily':
      return DEFAULT_FORWARD_HOURS_CRYPTO_DAILY;
    case 'crypto_intraday':
      return 24; // Intraday markets are short-lived
    case 'macro':
    case 'politics':
      return 8760; // 1 year for macro (many are far future)
    default:
      return DEFAULT_FORWARD_HOURS_CRYPTO_DAILY;
  }
}

/**
 * Build Prisma WHERE clause for eligible markets
 *
 * This builds a filter that:
 * 1. Excludes resolved/archived unless explicitly included
 * 2. For active markets: closeTime >= now - graceMinutes
 * 3. For closed markets: closeTime >= now - lookbackHours
 * 4. For future closeTime: closeTime <= now + forwardHours
 */
export function buildEligibleWhere(config: EligibilityConfig): {
  where: Record<string, unknown>;
  orderBy: Record<string, string>;
} {
  const {
    venue,
    topic,
    now = new Date(),
    lookbackHours = getDefaultLookbackHours(topic),
    forwardHours = getDefaultForwardHours(topic),
    graceMinutes = DEFAULT_GRACE_MINUTES,
    includeResolved = false,
  } = config;

  const graceMs = graceMinutes * 60 * 1000;
  const lookbackMs = lookbackHours * 60 * 60 * 1000;
  const forwardMs = forwardHours * 60 * 60 * 1000;

  const graceCutoff = new Date(now.getTime() - graceMs);
  const lookbackCutoff = new Date(now.getTime() - lookbackMs);
  const forwardCutoff = new Date(now.getTime() + forwardMs);

  // Build status filter
  const validStatuses: MarketStatus[] = ['active', 'closed'];
  if (includeResolved) {
    validStatuses.push('resolved', 'archived');
  }

  // Build the WHERE clause
  const where: Record<string, unknown> = {
    venue,
    status: { in: validStatuses },
    OR: [
      // Active markets with closeTime in valid window (grace to forward)
      {
        status: 'active',
        closeTime: {
          gte: graceCutoff,
          lte: forwardCutoff,
        },
      },
      // Active markets with no closeTime (assume valid)
      {
        status: 'active',
        closeTime: null,
      },
      // Closed markets within lookback window
      {
        status: 'closed',
        closeTime: {
          gte: lookbackCutoff,
        },
      },
    ],
  };

  // Add resolved/archived if included
  if (includeResolved) {
    (where.OR as unknown[]).push(
      {
        status: 'resolved',
        closeTime: { gte: lookbackCutoff },
      },
      {
        status: 'archived',
        closeTime: { gte: lookbackCutoff },
      }
    );
  }

  // Order by closeTime for time-proximity based matching
  // ASC = markets closing soon first (for matching urgency)
  const orderBy = { closeTime: 'asc' };

  return { where, orderBy };
}

/**
 * Check if a single market is eligible (secondary/runtime check)
 *
 * Use this for filtering after DB query or for validation.
 */
export function isEligibleMarket(
  market: MarketForEligibility,
  now: Date = new Date(),
  graceMinutes: number = DEFAULT_GRACE_MINUTES
): boolean {
  const result = explainEligibility(market, now, graceMinutes);
  return result.eligible;
}

/**
 * Explain why a market is or isn't eligible
 *
 * Returns detailed reasons for eligibility/ineligibility.
 */
export function explainEligibility(
  market: MarketForEligibility,
  now: Date = new Date(),
  graceMinutes: number = DEFAULT_GRACE_MINUTES,
  lookbackHours?: number
): EligibilityResult {
  const reasons: EligibilityReason[] = [];
  let eligible = true;

  const graceMs = graceMinutes * 60 * 1000;
  const graceCutoff = new Date(now.getTime() - graceMs);

  const effectiveLookbackHours = lookbackHours ?? getDefaultLookbackHours();
  const lookbackMs = effectiveLookbackHours * 60 * 60 * 1000;
  const lookbackCutoff = new Date(now.getTime() - lookbackMs);

  // Check status
  const status = market.status as MarketStatus;

  if (status === 'resolved' || status === 'archived') {
    reasons.push({
      code: 'status_terminal',
      message: `Market has terminal status: ${status}`,
      severity: 'exclude',
    });
    eligible = false;
  }

  // Check closeTime for active markets
  if (status === 'active' && market.closeTime) {
    if (market.closeTime < graceCutoff) {
      const ageMinutes = Math.round((now.getTime() - market.closeTime.getTime()) / (60 * 1000));
      reasons.push({
        code: 'stale_active',
        message: `Active market with closeTime ${ageMinutes}m in past (beyond ${graceMinutes}m grace)`,
        severity: 'exclude',
      });
      eligible = false;
    } else if (market.closeTime < now) {
      const ageMinutes = Math.round((now.getTime() - market.closeTime.getTime()) / (60 * 1000));
      reasons.push({
        code: 'within_grace',
        message: `Active market with closeTime ${ageMinutes}m in past (within ${graceMinutes}m grace)`,
        severity: 'warn',
      });
      // Still eligible - within grace period
    }
  }

  // Check closeTime for closed markets
  if (status === 'closed' && market.closeTime) {
    if (market.closeTime < lookbackCutoff) {
      const ageHours = Math.round((now.getTime() - market.closeTime.getTime()) / (60 * 60 * 1000));
      reasons.push({
        code: 'closed_too_old',
        message: `Closed market with closeTime ${ageHours}h ago (beyond ${effectiveLookbackHours}h lookback)`,
        severity: 'exclude',
      });
      eligible = false;
    }
  }

  // Info: no closeTime
  if (!market.closeTime) {
    reasons.push({
      code: 'no_close_time',
      message: 'Market has no closeTime set',
      severity: 'info',
    });
  }

  // If no exclusion reasons, add info that market is eligible
  if (eligible && reasons.filter((r) => r.severity === 'exclude').length === 0) {
    if (reasons.length === 0) {
      reasons.push({
        code: 'eligible',
        message: 'Market meets all eligibility criteria',
        severity: 'info',
      });
    }
  }

  return { eligible, reasons };
}

/**
 * Categorize stale_active anomalies into minor (within grace buffer) and major (beyond)
 */
export function categorizeStaleActive(
  market: MarketForEligibility,
  now: Date = new Date(),
  graceMinutes: number = DEFAULT_GRACE_MINUTES
): 'ok' | 'minor' | 'major' {
  if (market.status !== 'active') return 'ok';
  if (!market.closeTime) return 'ok';

  const ageMs = now.getTime() - market.closeTime.getTime();
  if (ageMs <= 0) return 'ok'; // closeTime in future

  const graceMs = graceMinutes * 60 * 1000;
  const majorThresholdMs = graceMs * 2; // 2x grace = major

  if (ageMs <= graceMs) return 'minor';
  if (ageMs > majorThresholdMs) return 'major';
  return 'minor';
}

/**
 * Summary type for eligibility diagnostics
 */
export interface EligibilitySummary {
  total: number;
  eligible: number;
  excluded: number;
  byReason: Record<string, number>;
  samples: {
    reason: string;
    markets: Array<{
      id: number;
      title: string;
      status: string;
      closeTime: Date | null;
      ageInfo: string;
    }>;
  }[];
}

/**
 * Summarize eligibility for a batch of markets
 */
export function summarizeEligibility(
  markets: MarketForEligibility[],
  now: Date = new Date(),
  graceMinutes: number = DEFAULT_GRACE_MINUTES,
  sampleSize: number = 5
): EligibilitySummary {
  const byReason: Record<string, number> = {};
  const samplesByReason: Record<string, MarketForEligibility[]> = {};
  let eligible = 0;
  let excluded = 0;

  for (const market of markets) {
    const result = explainEligibility(market, now, graceMinutes);

    if (result.eligible) {
      eligible++;
    } else {
      excluded++;
    }

    for (const reason of result.reasons) {
      const key = reason.code;
      byReason[key] = (byReason[key] || 0) + 1;

      if (reason.severity === 'exclude') {
        if (!samplesByReason[key]) samplesByReason[key] = [];
        if (samplesByReason[key].length < sampleSize) {
          samplesByReason[key].push(market);
        }
      }
    }
  }

  // Build samples output
  const samples = Object.entries(samplesByReason).map(([reason, sampleMarkets]) => ({
    reason,
    markets: sampleMarkets.map((m) => {
      let ageInfo = 'N/A';
      if (m.closeTime) {
        const ageMs = now.getTime() - m.closeTime.getTime();
        if (ageMs > 0) {
          const ageMinutes = Math.round(ageMs / (60 * 1000));
          ageInfo = ageMinutes < 60 ? `${ageMinutes}m ago` : `${Math.round(ageMinutes / 60)}h ago`;
        } else {
          const futureMinutes = Math.round(-ageMs / (60 * 1000));
          ageInfo = futureMinutes < 60 ? `in ${futureMinutes}m` : `in ${Math.round(futureMinutes / 60)}h`;
        }
      }
      return {
        id: m.id,
        title: m.title.length > 60 ? m.title.slice(0, 57) + '...' : m.title,
        status: m.status as string,
        closeTime: m.closeTime,
        ageInfo,
      };
    }),
  }));

  return {
    total: markets.length,
    eligible,
    excluded,
    byReason,
    samples,
  };
}

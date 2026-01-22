/**
 * Watchlist Expansion Policy v2 (v2.6.8)
 *
 * Determines which markets should be in the watchlist and with what priority.
 *
 * Priority levels:
 * - 100: confirmed links (both markets)
 * - 80: candidate-safe (passed SAFE_RULES but not yet confirmed)
 * - 50: top suggested by score
 */

import type { MarketLink, Market, Outcome, Venue } from '@data-module/db';
import { evaluateSafeRules, type Topic as SafeTopic } from './safe-rules.js';

export interface WatchlistPolicyConfig {
  /** Maximum total watchlist entries (default: 2000) */
  maxTotal: number;
  /** Maximum per venue (default: 1000) */
  maxPerVenue: number;
  /** Minimum score for safe candidates by topic */
  minScoreSafe: Record<string, number>;
  /** Minimum score for top suggested (default: 0.85) */
  minScoreTopSuggested: number;
  /** Maximum top suggested to consider (default: 500) */
  maxTopSuggested: number;
}

export const DEFAULT_POLICY_CONFIG: WatchlistPolicyConfig = {
  maxTotal: parseInt(process.env.WATCHLIST_MAX_TOTAL || '2000', 10),
  maxPerVenue: parseInt(process.env.WATCHLIST_MAX_PER_VENUE || '1000', 10),
  minScoreSafe: {
    crypto_daily: parseFloat(process.env.WATCHLIST_MIN_SCORE_SAFE_CRYPTO_DAILY || '0.90'),
    crypto_intraday: parseFloat(process.env.WATCHLIST_MIN_SCORE_SAFE_INTRADAY || '0.92'),
    macro: parseFloat(process.env.WATCHLIST_MIN_SCORE_SAFE_MACRO || '0.88'),
  },
  minScoreTopSuggested: parseFloat(process.env.WATCHLIST_MIN_SCORE_SUGGESTED || '0.85'),
  maxTopSuggested: parseInt(process.env.WATCHLIST_MAX_TOP_SUGGESTED || '500', 10),
};

export interface MarketLinkWithMarkets extends MarketLink {
  leftMarket: Market & { outcomes: Outcome[] };
  rightMarket: Market & { outcomes: Outcome[] };
}

export interface WatchlistCandidate {
  marketId: number;
  venue: Venue;
  priority: number;
  reason: string;
  linkId: number;
  score: number;
}

export interface PolicyResult {
  candidates: WatchlistCandidate[];
  stats: {
    confirmedMarkets: number;
    candidateSafeMarkets: number;
    topSuggestedMarkets: number;
    totalUnique: number;
    byVenue: Record<string, number>;
    byPriority: Record<number, number>;
    cappedByVenue: boolean;
    cappedByTotal: boolean;
  };
}

/**
 * Derive topic from link
 */
function getLinkTopic(link: MarketLinkWithMarkets): SafeTopic | null {
  // Try explicit topic field first
  if (link.topic) {
    if (link.topic === 'crypto_daily' || link.topic === 'crypto_intraday' || link.topic === 'macro') {
      return link.topic;
    }
  }

  // Try algoVersion
  if (link.algoVersion) {
    if (link.algoVersion.includes('crypto_daily')) return 'crypto_daily';
    if (link.algoVersion.includes('crypto_intraday')) return 'crypto_intraday';
    if (link.algoVersion.includes('intraday')) return 'crypto_intraday';
    if (link.algoVersion.includes('macro')) return 'macro';
  }

  // Try reason
  if (link.reason) {
    if (link.reason.startsWith('MACRO:')) return 'macro';
    if (link.reason.includes('bucket=')) return 'crypto_intraday';
    if (link.reason.includes('dateType=')) return 'crypto_daily';
  }

  return null;
}

/**
 * Apply watchlist policy to links
 *
 * Returns candidates with priorities, respecting caps.
 */
export function applyWatchlistPolicy(
  confirmedLinks: MarketLinkWithMarkets[],
  suggestedLinks: MarketLinkWithMarkets[],
  config: WatchlistPolicyConfig = DEFAULT_POLICY_CONFIG
): PolicyResult {
  const marketMap = new Map<number, WatchlistCandidate>();
  const venueCounts = new Map<string, number>();

  let confirmedMarkets = 0;
  let candidateSafeMarkets = 0;
  let topSuggestedMarkets = 0;

  /**
   * Add candidate if not already present with higher priority
   */
  function addCandidate(
    marketId: number,
    venue: Venue,
    priority: number,
    reason: string,
    linkId: number,
    score: number
  ): boolean {
    // Check venue cap
    const currentVenueCount = venueCounts.get(venue) || 0;
    if (currentVenueCount >= config.maxPerVenue) {
      return false;
    }

    // Check total cap
    if (marketMap.size >= config.maxTotal) {
      return false;
    }

    const existing = marketMap.get(marketId);
    if (existing && existing.priority >= priority) {
      return false; // Already have higher or equal priority
    }

    if (!existing) {
      venueCounts.set(venue, currentVenueCount + 1);
    }

    marketMap.set(marketId, {
      marketId,
      venue,
      priority,
      reason,
      linkId,
      score,
    });

    return true;
  }

  // Phase 1: Confirmed links (priority 100)
  for (const link of confirmedLinks) {
    const added1 = addCandidate(
      link.leftMarketId,
      link.leftVenue,
      100,
      'confirmed_link',
      link.id,
      link.score
    );
    const added2 = addCandidate(
      link.rightMarketId,
      link.rightVenue,
      100,
      'confirmed_link',
      link.id,
      link.score
    );
    if (added1) confirmedMarkets++;
    if (added2) confirmedMarkets++;
  }

  // Phase 2: Suggested links that pass SAFE_RULES (priority 80)
  // Sort by score desc
  const sortedSuggested = [...suggestedLinks].sort((a, b) => b.score - a.score);

  for (const link of sortedSuggested) {
    const topic = getLinkTopic(link);
    if (!topic) continue;

    const minScore = config.minScoreSafe[topic];
    if (!minScore || link.score < minScore) continue;

    // Evaluate safe rules
    const evaluation = evaluateSafeRules(link, topic, minScore);
    if (!evaluation.pass) continue;

    // Add both markets with priority 80
    const added1 = addCandidate(
      link.leftMarketId,
      link.leftVenue,
      80,
      `candidate_safe:${topic}`,
      link.id,
      link.score
    );
    const added2 = addCandidate(
      link.rightMarketId,
      link.rightVenue,
      80,
      `candidate_safe:${topic}`,
      link.id,
      link.score
    );
    if (added1) candidateSafeMarkets++;
    if (added2) candidateSafeMarkets++;
  }

  // Phase 3: Top suggested by score (priority 50)
  let topSuggestedCount = 0;
  for (const link of sortedSuggested) {
    if (topSuggestedCount >= config.maxTopSuggested) break;
    if (link.score < config.minScoreTopSuggested) break;

    const added1 = addCandidate(
      link.leftMarketId,
      link.leftVenue,
      50,
      'top_suggested',
      link.id,
      link.score
    );
    const added2 = addCandidate(
      link.rightMarketId,
      link.rightVenue,
      50,
      'top_suggested',
      link.id,
      link.score
    );
    if (added1 || added2) topSuggestedCount++;
    if (added1) topSuggestedMarkets++;
    if (added2) topSuggestedMarkets++;
  }

  // Build stats
  const byVenue: Record<string, number> = {};
  const byPriority: Record<number, number> = {};
  for (const [venue, count] of venueCounts) {
    byVenue[venue] = count;
  }
  for (const candidate of marketMap.values()) {
    byPriority[candidate.priority] = (byPriority[candidate.priority] || 0) + 1;
  }

  const cappedByVenue = Array.from(venueCounts.values()).some(c => c >= config.maxPerVenue);
  const cappedByTotal = marketMap.size >= config.maxTotal;

  return {
    candidates: Array.from(marketMap.values()),
    stats: {
      confirmedMarkets,
      candidateSafeMarkets,
      topSuggestedMarkets,
      totalUnique: marketMap.size,
      byVenue,
      byPriority,
      cappedByVenue,
      cappedByTotal,
    },
  };
}

/**
 * Format policy result for logging
 */
export function formatPolicyResult(result: PolicyResult): string {
  const lines = [
    '[Watchlist Policy v2]',
    `  Confirmed markets:      ${result.stats.confirmedMarkets}`,
    `  Candidate-safe markets: ${result.stats.candidateSafeMarkets}`,
    `  Top suggested markets:  ${result.stats.topSuggestedMarkets}`,
    `  Total unique:           ${result.stats.totalUnique}`,
    '',
    '[By Venue]',
  ];

  for (const [venue, count] of Object.entries(result.stats.byVenue)) {
    lines.push(`  ${venue}: ${count}`);
  }

  lines.push('', '[By Priority]');
  for (const [priority, count] of Object.entries(result.stats.byPriority).sort((a, b) => parseInt(b[0]) - parseInt(a[0]))) {
    const label = priority === '100' ? 'confirmed' : priority === '80' ? 'candidate-safe' : 'top_suggested';
    lines.push(`  ${priority} (${label}): ${count}`);
  }

  if (result.stats.cappedByVenue) {
    lines.push('', '⚠️  Capped by venue limit');
  }
  if (result.stats.cappedByTotal) {
    lines.push('⚠️  Capped by total limit');
  }

  return lines.join('\n');
}

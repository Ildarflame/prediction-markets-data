/**
 * links:watchlist:sync - Sync market_links to quote_watchlist (v2.6.8)
 *
 * Uses Policy v2 to populate the watchlist with markets from:
 * 1. Confirmed links (both sides) - priority 100
 * 2. Candidate-safe (passed SAFE_RULES but not confirmed) - priority 80
 * 3. Top suggested links (score >= minScore) - priority 50
 *
 * Respects caps: max per venue and max total.
 *
 * Run: pnpm --filter @data-module/worker links:watchlist:sync --dry-run
 */

import { getClient, WatchlistRepository, type WatchlistItem, type LinkStatus } from '@data-module/db';
import {
  applyWatchlistPolicy,
  formatPolicyResult,
  DEFAULT_POLICY_CONFIG,
  type WatchlistPolicyConfig,
} from '../ops/watchlist-policy.js';

export interface LinksWatchlistSyncOptions {
  /** Minimum score for top suggested links (default from env or 0.85) */
  minScoreSuggested?: number;
  /** Maximum total watchlist entries (default: 2000) */
  maxTotal?: number;
  /** Maximum per venue (default: 1000) */
  maxPerVenue?: number;
  /** Maximum suggested links to include (default: 500) */
  maxSuggested?: number;
  /** Preview changes without applying */
  dryRun?: boolean;
}

export interface LinksWatchlistSyncResult {
  dryRun: boolean;
  confirmedLinks: number;
  confirmedMarkets: number;
  candidateSafeMarkets: number;
  suggestedMarkets: number;
  totalItems: number;
  byVenue: Record<string, number>;
  byPriority: Record<number, number>;
  created: number;
  updated: number;
}

export async function runLinksWatchlistSync(
  options: LinksWatchlistSyncOptions = {}
): Promise<LinksWatchlistSyncResult> {
  const {
    minScoreSuggested = DEFAULT_POLICY_CONFIG.minScoreTopSuggested,
    maxTotal = DEFAULT_POLICY_CONFIG.maxTotal,
    maxPerVenue = DEFAULT_POLICY_CONFIG.maxPerVenue,
    maxSuggested = DEFAULT_POLICY_CONFIG.maxTopSuggested,
    dryRun = false,
  } = options;

  const prisma = getClient();
  const watchlistRepo = new WatchlistRepository(prisma);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[links:watchlist:sync] Sync Links to Watchlist (v2.6.8 Policy v2)`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Options:`);
  console.log(`  minScoreSuggested: ${minScoreSuggested}`);
  console.log(`  maxTotal: ${maxTotal}`);
  console.log(`  maxPerVenue: ${maxPerVenue}`);
  console.log(`  maxSuggested: ${maxSuggested}`);
  console.log(`  dryRun: ${dryRun}`);
  console.log();

  console.log('[Safe Score Thresholds by Topic]');
  for (const [topic, score] of Object.entries(DEFAULT_POLICY_CONFIG.minScoreSafe)) {
    console.log(`  ${topic}: ${score}`);
  }
  console.log();

  // 1. Fetch confirmed links
  console.log('[1/3] Fetching confirmed links...');
  const confirmedLinks = await prisma.marketLink.findMany({
    where: { status: 'confirmed' as LinkStatus },
    include: {
      leftMarket: { include: { outcomes: true } },
      rightMarket: { include: { outcomes: true } },
    },
  });
  console.log(`  Found ${confirmedLinks.length} confirmed links`);

  // 2. Fetch suggested links (higher score first)
  console.log('[2/3] Fetching suggested links...');
  const suggestedLinks = await prisma.marketLink.findMany({
    where: {
      status: 'suggested' as LinkStatus,
      score: { gte: 0.80 }, // Lower bound to get candidates for safe rules evaluation
    },
    include: {
      leftMarket: { include: { outcomes: true } },
      rightMarket: { include: { outcomes: true } },
    },
    orderBy: { score: 'desc' },
    take: 2000, // Enough to evaluate candidate-safe + top suggested
  });
  console.log(`  Found ${suggestedLinks.length} suggested links (score >= 0.80)`);
  console.log();

  // 3. Apply policy
  console.log('[3/3] Applying watchlist policy v2...');
  const policyConfig: WatchlistPolicyConfig = {
    maxTotal,
    maxPerVenue,
    minScoreSafe: DEFAULT_POLICY_CONFIG.minScoreSafe,
    minScoreTopSuggested: minScoreSuggested,
    maxTopSuggested: maxSuggested,
  };

  const policyResult = applyWatchlistPolicy(confirmedLinks, suggestedLinks, policyConfig);

  console.log();
  console.log(formatPolicyResult(policyResult));
  console.log();

  // Convert to WatchlistItems
  const items: WatchlistItem[] = policyResult.candidates.map(c => ({
    venue: c.venue,
    marketId: c.marketId,
    priority: c.priority,
    reason: c.reason,
  }));

  // Apply or dry-run
  if (dryRun) {
    console.log('[DRY RUN] Would upsert the following items:');
    console.log(`  - ${policyResult.stats.confirmedMarkets} confirmed markets (priority 100)`);
    console.log(`  - ${policyResult.stats.candidateSafeMarkets} candidate-safe markets (priority 80)`);
    console.log(`  - ${policyResult.stats.topSuggestedMarkets} top-suggested markets (priority 50)`);
    console.log(`  - Total: ${policyResult.stats.totalUnique}`);
    console.log();
    console.log('Run without --dry-run to apply changes.');

    return {
      dryRun: true,
      confirmedLinks: confirmedLinks.length,
      confirmedMarkets: policyResult.stats.confirmedMarkets,
      candidateSafeMarkets: policyResult.stats.candidateSafeMarkets,
      suggestedMarkets: policyResult.stats.topSuggestedMarkets,
      totalItems: policyResult.stats.totalUnique,
      byVenue: policyResult.stats.byVenue,
      byPriority: policyResult.stats.byPriority,
      created: 0,
      updated: 0,
    };
  }

  console.log('[Upserting to watchlist...]');
  const result = await watchlistRepo.upsertMany(items);

  console.log(`  Created: ${result.created}`);
  console.log(`  Updated: ${result.updated}`);
  console.log();

  // Show current watchlist stats
  const stats = await watchlistRepo.getStats();
  console.log('[Watchlist Stats After Sync]');
  console.log(`  Total: ${stats.total}`);
  for (const [venue, count] of Object.entries(stats.byVenue)) {
    console.log(`  ${venue}: ${count}`);
  }
  for (const { priority, count } of stats.byPriority) {
    const label = priority === 100 ? 'confirmed' : priority === 80 ? 'candidate-safe' : 'top_suggested';
    console.log(`  Priority ${priority} (${label}): ${count}`);
  }

  return {
    dryRun: false,
    confirmedLinks: confirmedLinks.length,
    confirmedMarkets: policyResult.stats.confirmedMarkets,
    candidateSafeMarkets: policyResult.stats.candidateSafeMarkets,
    suggestedMarkets: policyResult.stats.topSuggestedMarkets,
    totalItems: policyResult.stats.totalUnique,
    byVenue: policyResult.stats.byVenue,
    byPriority: policyResult.stats.byPriority,
    created: result.created,
    updated: result.updated,
  };
}

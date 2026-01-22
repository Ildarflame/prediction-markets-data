/**
 * links:watchlist:sync - Sync market_links to quote_watchlist (v2.6.7)
 *
 * Populates the watchlist with markets from:
 * 1. Confirmed links (both sides) - priority 100
 * 2. Top suggested links (score >= minScore) - priority 50
 *
 * Run: pnpm --filter @data-module/worker links:watchlist:sync --dry-run
 */

import { getClient, WatchlistRepository, type WatchlistItem, type Venue } from '@data-module/db';

export interface LinksWatchlistSyncOptions {
  /** Minimum score for suggested links (default: 0.92) */
  minScore?: number;
  /** Maximum suggested links to include (default: 500) */
  maxSuggested?: number;
  /** Preview changes without applying */
  dryRun?: boolean;
}

export interface LinksWatchlistSyncResult {
  dryRun: boolean;
  confirmedLinks: number;
  confirmedMarkets: number;
  suggestedLinks: number;
  suggestedMarkets: number;
  totalItems: number;
  created: number;
  updated: number;
}

export async function runLinksWatchlistSync(
  options: LinksWatchlistSyncOptions = {}
): Promise<LinksWatchlistSyncResult> {
  const {
    minScore = parseFloat(process.env.WATCHLIST_MIN_SCORE || '0.92'),
    maxSuggested = 500,
    dryRun = false,
  } = options;

  const prisma = getClient();
  const watchlistRepo = new WatchlistRepository(prisma);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[links:watchlist:sync] Sync Links to Watchlist (v2.6.7)`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Options:`);
  console.log(`  minScore: ${minScore}`);
  console.log(`  maxSuggested: ${maxSuggested}`);
  console.log(`  dryRun: ${dryRun}`);
  console.log();

  const items: WatchlistItem[] = [];

  // 1. Get confirmed links (both markets)
  console.log('[1/3] Fetching confirmed links...');
  const confirmedLinks = await prisma.marketLink.findMany({
    where: { status: 'confirmed' },
    include: {
      leftMarket: { select: { id: true, venue: true } },
      rightMarket: { select: { id: true, venue: true } },
    },
  });

  console.log(`  Found ${confirmedLinks.length} confirmed links`);

  const confirmedMarketIds = new Set<string>();
  for (const link of confirmedLinks) {
    // Add left market
    const leftKey = `${link.leftMarket.venue}:${link.leftMarket.id}`;
    if (!confirmedMarketIds.has(leftKey)) {
      confirmedMarketIds.add(leftKey);
      items.push({
        venue: link.leftMarket.venue as Venue,
        marketId: link.leftMarket.id,
        priority: 100,
        reason: 'confirmed_link',
      });
    }

    // Add right market
    const rightKey = `${link.rightMarket.venue}:${link.rightMarket.id}`;
    if (!confirmedMarketIds.has(rightKey)) {
      confirmedMarketIds.add(rightKey);
      items.push({
        venue: link.rightMarket.venue as Venue,
        marketId: link.rightMarket.id,
        priority: 100,
        reason: 'confirmed_link',
      });
    }
  }

  console.log(`  Added ${confirmedMarketIds.size} unique markets from confirmed links`);

  // 2. Get top suggested links
  console.log('[2/3] Fetching top suggested links...');
  const suggestedLinks = await prisma.marketLink.findMany({
    where: {
      status: 'suggested',
      score: { gte: minScore },
    },
    include: {
      leftMarket: { select: { id: true, venue: true } },
      rightMarket: { select: { id: true, venue: true } },
    },
    orderBy: { score: 'desc' },
    take: maxSuggested,
  });

  console.log(`  Found ${suggestedLinks.length} suggested links with score >= ${minScore}`);

  const suggestedMarketIds = new Set<string>();
  for (const link of suggestedLinks) {
    // Add left market (skip if already in confirmed)
    const leftKey = `${link.leftMarket.venue}:${link.leftMarket.id}`;
    if (!confirmedMarketIds.has(leftKey) && !suggestedMarketIds.has(leftKey)) {
      suggestedMarketIds.add(leftKey);
      items.push({
        venue: link.leftMarket.venue as Venue,
        marketId: link.leftMarket.id,
        priority: 50,
        reason: 'top_suggested',
      });
    }

    // Add right market (skip if already in confirmed)
    const rightKey = `${link.rightMarket.venue}:${link.rightMarket.id}`;
    if (!confirmedMarketIds.has(rightKey) && !suggestedMarketIds.has(rightKey)) {
      suggestedMarketIds.add(rightKey);
      items.push({
        venue: link.rightMarket.venue as Venue,
        marketId: link.rightMarket.id,
        priority: 50,
        reason: 'top_suggested',
      });
    }
  }

  console.log(`  Added ${suggestedMarketIds.size} unique markets from suggested links`);

  // Summary before apply
  console.log();
  console.log('[Summary]');
  console.log(`  Confirmed links: ${confirmedLinks.length}`);
  console.log(`  Confirmed markets: ${confirmedMarketIds.size}`);
  console.log(`  Suggested links: ${suggestedLinks.length}`);
  console.log(`  Suggested markets: ${suggestedMarketIds.size}`);
  console.log(`  Total watchlist items: ${items.length}`);
  console.log();

  // Group by venue for display
  const byVenue: Record<string, number> = {};
  for (const item of items) {
    byVenue[item.venue] = (byVenue[item.venue] || 0) + 1;
  }
  console.log('[By Venue]');
  for (const [venue, count] of Object.entries(byVenue)) {
    console.log(`  ${venue}: ${count}`);
  }
  console.log();

  // 3. Apply to watchlist
  if (dryRun) {
    console.log('[DRY RUN] Would upsert the following items:');
    console.log(`  - ${confirmedMarketIds.size} confirmed markets (priority 100)`);
    console.log(`  - ${suggestedMarketIds.size} suggested markets (priority 50)`);
    console.log();
    console.log('Run without --dry-run to apply changes.');

    return {
      dryRun: true,
      confirmedLinks: confirmedLinks.length,
      confirmedMarkets: confirmedMarketIds.size,
      suggestedLinks: suggestedLinks.length,
      suggestedMarkets: suggestedMarketIds.size,
      totalItems: items.length,
      created: 0,
      updated: 0,
    };
  }

  console.log('[3/3] Upserting to watchlist...');
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
    console.log(`  Priority ${priority}: ${count}`);
  }

  return {
    dryRun: false,
    confirmedLinks: confirmedLinks.length,
    confirmedMarkets: confirmedMarketIds.size,
    suggestedLinks: suggestedLinks.length,
    suggestedMarkets: suggestedMarketIds.size,
    totalItems: items.length,
    created: result.created,
    updated: result.updated,
  };
}

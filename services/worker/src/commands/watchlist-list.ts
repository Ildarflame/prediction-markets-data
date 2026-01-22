/**
 * watchlist:list - List quote watchlist entries (v2.6.7)
 *
 * Run: pnpm --filter @data-module/worker watchlist:list --venue polymarket --limit 50
 */

import { getClient, WatchlistRepository, type WatchlistWithMarket, type Venue } from '@data-module/db';

export interface WatchlistListOptions {
  venue: Venue;
  limit?: number;
  offset?: number;
}

export interface WatchlistListResult {
  venue: Venue;
  items: WatchlistWithMarket[];
  total: number;
}

export async function runWatchlistList(
  options: WatchlistListOptions
): Promise<WatchlistListResult> {
  const { venue, limit = 50, offset = 0 } = options;
  const prisma = getClient();
  const watchlistRepo = new WatchlistRepository(prisma);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[watchlist:list] Quote Watchlist Entries (v2.6.7)`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Venue: ${venue}`);
  console.log(`Limit: ${limit}, Offset: ${offset}`);
  console.log();

  const items = await watchlistRepo.list({ venue, limit, offset, includeMarket: true });
  const stats = await watchlistRepo.getStats(venue);

  console.log(`[Results] Showing ${items.length} of ${stats.total} entries`);
  console.log();

  if (items.length === 0) {
    console.log('  (no watchlist entries)');
  } else {
    // Header
    console.log(
      '  ' +
        'ID'.padEnd(8) +
        'Priority'.padEnd(10) +
        'Reason'.padEnd(18) +
        'Market'.padEnd(12) +
        'Status'.padEnd(10) +
        'Title'
    );
    console.log('  ' + '-'.repeat(80));

    for (const item of items) {
      const title = item.market.title.length > 40
        ? item.market.title.slice(0, 37) + '...'
        : item.market.title;

      console.log(
        '  ' +
          String(item.id).padEnd(8) +
          String(item.priority).padEnd(10) +
          item.reason.padEnd(18) +
          String(item.marketId).padEnd(12) +
          item.market.status.padEnd(10) +
          title
      );
    }
  }

  console.log();
  console.log(`[Summary]`);
  console.log(`  Total for ${venue}: ${stats.total}`);

  return { venue, items, total: stats.total };
}

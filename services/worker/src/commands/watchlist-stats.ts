/**
 * watchlist:stats - Show quote watchlist statistics (v2.6.7)
 *
 * Run: pnpm --filter @data-module/worker watchlist:stats --venue kalshi
 */

import { getClient, WatchlistRepository, type Venue } from '@data-module/db';

export interface WatchlistStatsOptions {
  venue?: Venue;
}

export interface WatchlistStatsResult {
  total: number;
  byVenue: Record<string, number>;
  byReason: Record<string, number>;
  byPriority: { priority: number; count: number }[];
}

export async function runWatchlistStats(
  options: WatchlistStatsOptions = {}
): Promise<WatchlistStatsResult> {
  const { venue } = options;
  const prisma = getClient();
  const watchlistRepo = new WatchlistRepository(prisma);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[watchlist:stats] Quote Watchlist Statistics (v2.6.7)`);
  console.log(`${'='.repeat(60)}`);
  if (venue) {
    console.log(`Venue: ${venue}`);
  } else {
    console.log(`Venue: all`);
  }
  console.log();

  const stats = await watchlistRepo.getStats(venue);

  console.log('[Summary]');
  console.log(`  Total: ${stats.total.toLocaleString()}`);
  console.log();

  console.log('[By Venue]');
  if (Object.keys(stats.byVenue).length === 0) {
    console.log('  (no data)');
  } else {
    for (const [v, count] of Object.entries(stats.byVenue)) {
      console.log(`  ${v.padEnd(15)} ${String(count).padStart(8)}`);
    }
  }
  console.log();

  console.log('[By Reason]');
  if (Object.keys(stats.byReason).length === 0) {
    console.log('  (no data)');
  } else {
    const sortedReasons = Object.entries(stats.byReason).sort((a, b) => (b[1] as number) - (a[1] as number));
    for (const [reason, count] of sortedReasons) {
      console.log(`  ${reason.padEnd(20)} ${String(count).padStart(8)}`);
    }
  }
  console.log();

  console.log('[By Priority]');
  if (stats.byPriority.length === 0) {
    console.log('  (no data)');
  } else {
    for (const { priority, count } of stats.byPriority) {
      const label = priority === 100 ? 'confirmed' : priority === 50 ? 'top_suggested' : 'other';
      console.log(`  ${String(priority).padEnd(5)} (${label.padEnd(15)}) ${String(count).padStart(8)}`);
    }
  }

  return stats;
}

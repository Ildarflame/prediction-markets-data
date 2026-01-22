/**
 * watchlist:cleanup - Clean up old watchlist entries (v2.6.7)
 *
 * Run: pnpm --filter @data-module/worker watchlist:cleanup --older-than-days 30 --reason top_suggested --dry-run
 */

import { getClient, WatchlistRepository, type QuoteWatchlist, type Venue } from '@data-module/db';

export interface WatchlistCleanupOptions {
  olderThanDays: number;
  reason?: string;
  venue?: Venue;
  dryRun?: boolean;
}

export interface WatchlistCleanupResult {
  dryRun: boolean;
  count: number;
  samples: QuoteWatchlist[];
}

export async function runWatchlistCleanup(
  options: WatchlistCleanupOptions
): Promise<WatchlistCleanupResult> {
  const { olderThanDays, reason, venue, dryRun = false } = options;
  const prisma = getClient();
  const watchlistRepo = new WatchlistRepository(prisma);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[watchlist:cleanup] Clean Up Watchlist Entries (v2.6.7)`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Options:`);
  console.log(`  olderThanDays: ${olderThanDays}`);
  if (reason) console.log(`  reason: ${reason}`);
  if (venue) console.log(`  venue: ${venue}`);
  console.log(`  dryRun: ${dryRun}`);
  console.log();

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
  console.log(`Cutoff date: ${cutoffDate.toISOString()}`);
  console.log();

  const result = await watchlistRepo.cleanup({ olderThanDays, reason, venue, dryRun });

  if (dryRun) {
    console.log(`[DRY RUN] Would delete ${result.count} entries`);
  } else {
    console.log(`[Result] Deleted ${result.count} entries`);
  }

  if (result.samples.length > 0) {
    console.log();
    console.log(`[Sample Entries] (${result.samples.length})`);
    for (const entry of result.samples.slice(0, 10)) {
      console.log(
        `  [${entry.id}] venue=${entry.venue} market=${entry.marketId} ` +
          `priority=${entry.priority} reason=${entry.reason} ` +
          `updated=${entry.updatedAt.toISOString()}`
      );
    }
    if (result.samples.length > 10) {
      console.log(`  ... and ${result.samples.length - 10} more`);
    }
  }

  return { dryRun, count: result.count, samples: result.samples };
}

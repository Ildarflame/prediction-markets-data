/**
 * links:cleanup - Delete old market link suggestions (v2.6.2)
 *
 * Removes stale suggestions based on age and status
 */

import { getClient, MarketLinkRepository, type LinkStatus } from '@data-module/db';

export interface LinksCleanupOptions {
  olderThanDays: number;
  status: 'suggested' | 'rejected' | 'all';
  algoVersion?: string;
  dryRun: boolean;
}

export interface LinksCleanupResult {
  deleted: number;
  dryRun: boolean;
}

/**
 * Run links:cleanup command
 */
export async function runLinksCleanup(options: LinksCleanupOptions): Promise<LinksCleanupResult> {
  const { olderThanDays, status, algoVersion, dryRun } = options;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[links:cleanup] Delete Old Suggestions (v2.6.2)`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Options:`);
  console.log(`  olderThanDays: ${olderThanDays}`);
  console.log(`  status: ${status}`);
  console.log(`  algoVersion: ${algoVersion || '(any)'}`);
  console.log(`  dryRun: ${dryRun}`);
  console.log(`${'='.repeat(60)}\n`);

  const prisma = getClient();
  const linkRepo = new MarketLinkRepository(prisma);

  const result = await linkRepo.cleanupSuggestions({
    olderThanDays,
    status: status === 'all' ? 'all' : status as LinkStatus,
    algoVersion,
    dryRun,
  });

  if (dryRun) {
    console.log(`[DRY RUN] Would delete ${result.count} links`);

    if (result.matches.length > 0) {
      console.log('\nSample links that would be deleted:');
      for (const link of result.matches.slice(0, 10)) {
        console.log(`  ID ${link.id}: score=${link.score.toFixed(3)}, status=${link.status}, algoVersion=${link.algoVersion || '(null)'}, updated=${link.updatedAt.toISOString().split('T')[0]}`);
      }
      if (result.matches.length > 10) {
        console.log(`  ... and ${result.matches.length - 10} more`);
      }
    }
  } else {
    console.log(`Deleted ${result.count} links`);
  }

  return {
    deleted: result.count,
    dryRun,
  };
}

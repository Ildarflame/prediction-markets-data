/**
 * links:backfill - Backfill old market_links with legacy metadata (v2.6.4)
 *
 * Updates old links that have null algoVersion/topic with:
 * - algoVersion: 'legacy'
 * - topic: 'unknown'
 *
 * This allows proper filtering and cleanup of pre-v2.6.2 links.
 */

import { getClient } from '@data-module/db';

export interface LinksBackfillOptions {
  dryRun: boolean;
  /** Maximum links to update in one run */
  limit?: number;
}

export interface LinksBackfillResult {
  totalNull: number;
  updated: number;
  dryRun: boolean;
}

/**
 * Run links:backfill command
 */
export async function runLinksBackfill(options: LinksBackfillOptions): Promise<LinksBackfillResult> {
  const { dryRun, limit = 10000 } = options;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[links:backfill] Backfill Legacy Links (v2.6.4)`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Options:`);
  console.log(`  dryRun: ${dryRun}`);
  console.log(`  limit: ${limit}`);
  console.log(`${'='.repeat(60)}\n`);

  const prisma = getClient();

  // Count links with null algoVersion or null topic
  const nullAlgoCount = await prisma.marketLink.count({
    where: { algoVersion: null },
  });

  const nullTopicCount = await prisma.marketLink.count({
    where: { topic: null },
  });

  const nullBothCount = await prisma.marketLink.count({
    where: {
      AND: [
        { algoVersion: null },
        { topic: null },
      ],
    },
  });

  console.log(`[Analysis]`);
  console.log(`  Links with null algoVersion: ${nullAlgoCount}`);
  console.log(`  Links with null topic: ${nullTopicCount}`);
  console.log(`  Links with BOTH null: ${nullBothCount}`);
  console.log('');

  if (nullAlgoCount === 0 && nullTopicCount === 0) {
    console.log(`No links need backfilling. All links have algoVersion and topic set.`);
    return { totalNull: 0, updated: 0, dryRun };
  }

  if (dryRun) {
    console.log(`[DRY RUN] Would update up to ${Math.min(nullAlgoCount, limit)} links with null algoVersion`);
    console.log(`[DRY RUN] Would set: algoVersion='legacy', topic='unknown'`);

    // Show sample of links that would be updated
    const sample = await prisma.marketLink.findMany({
      where: {
        OR: [
          { algoVersion: null },
          { topic: null },
        ],
      },
      take: 10,
      orderBy: { createdAt: 'asc' },
    });

    if (sample.length > 0) {
      console.log('\nSample links that would be updated:');
      for (const link of sample) {
        console.log(`  ID ${link.id}: score=${link.score.toFixed(3)}, status=${link.status}, algoVersion=${link.algoVersion || '(null)'}, topic=${link.topic || '(null)'}, created=${link.createdAt.toISOString().split('T')[0]}`);
      }
    }

    return { totalNull: nullAlgoCount, updated: 0, dryRun };
  }

  // Update links with null algoVersion (sets both algoVersion and topic)
  console.log(`[Backfilling]`);
  console.log(`  Updating links with null algoVersion -> 'legacy'`);
  console.log(`  Updating links with null topic -> 'unknown'`);

  const updateResult = await prisma.marketLink.updateMany({
    where: {
      OR: [
        { algoVersion: null },
        { topic: null },
      ],
    },
    data: {
      algoVersion: 'legacy',
      topic: 'unknown',
    },
  });

  console.log(`\n[Result]`);
  console.log(`  Updated: ${updateResult.count} links`);

  return {
    totalNull: nullAlgoCount,
    updated: updateResult.count,
    dryRun,
  };
}

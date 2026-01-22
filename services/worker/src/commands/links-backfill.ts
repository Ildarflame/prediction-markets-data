/**
 * links:backfill - Backfill old market_links with legacy metadata (v2.6.4, v2.6.6)
 *
 * Updates old links that have null algoVersion/topic with:
 * - algoVersion: 'legacy'
 * - topic: 'unknown'
 *
 * This allows proper filtering and cleanup of pre-v2.6.2 links.
 *
 * v2.6.6: Does NOT touch confirmed links to preserve manual curation.
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

  // v2.6.6: Only count non-confirmed links (don't touch confirmed)
  const nullAlgoCount = await prisma.marketLink.count({
    where: {
      algoVersion: null,
      status: { not: 'confirmed' },
    },
  });

  const nullTopicCount = await prisma.marketLink.count({
    where: {
      topic: null,
      status: { not: 'confirmed' },
    },
  });

  const nullBothCount = await prisma.marketLink.count({
    where: {
      AND: [
        { algoVersion: null },
        { topic: null },
      ],
      status: { not: 'confirmed' },
    },
  });

  // Count confirmed with null (for info only)
  const confirmedNullCount = await prisma.marketLink.count({
    where: {
      status: 'confirmed',
      OR: [
        { algoVersion: null },
        { topic: null },
      ],
    },
  });

  console.log(`[Analysis]`);
  console.log(`  Links with null algoVersion (non-confirmed): ${nullAlgoCount}`);
  console.log(`  Links with null topic (non-confirmed): ${nullTopicCount}`);
  console.log(`  Links with BOTH null (non-confirmed): ${nullBothCount}`);
  if (confirmedNullCount > 0) {
    console.log(`  Confirmed links with null (SKIPPED): ${confirmedNullCount}`);
  }
  console.log('');

  if (nullAlgoCount === 0 && nullTopicCount === 0) {
    console.log(`No links need backfilling. All links have algoVersion and topic set.`);
    return { totalNull: 0, updated: 0, dryRun };
  }

  if (dryRun) {
    console.log(`[DRY RUN] Would update up to ${Math.min(nullAlgoCount, limit)} non-confirmed links`);
    console.log(`[DRY RUN] Would set: algoVersion='legacy', topic='unknown'`);
    console.log(`[DRY RUN] Confirmed links will NOT be modified`);

    // Show sample of links that would be updated (v2.6.6: exclude confirmed)
    const sample = await prisma.marketLink.findMany({
      where: {
        status: { not: 'confirmed' },
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
  // v2.6.6: Exclude confirmed links to preserve manual curation
  console.log(`[Backfilling]`);
  console.log(`  Updating non-confirmed links with null algoVersion -> 'legacy'`);
  console.log(`  Updating non-confirmed links with null topic -> 'unknown'`);
  console.log(`  SKIPPING confirmed links`);

  const updateResult = await prisma.marketLink.updateMany({
    where: {
      status: { not: 'confirmed' },
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

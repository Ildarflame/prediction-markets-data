/**
 * Kalshi MVE Backfill Command (v3.0.14)
 *
 * Backfills isMve field for Kalshi SPORTS markets based on:
 * - eventTicker prefix (KXMV*)
 * - seriesTicker prefix (KXMV*)
 * - Title patterns
 *
 * Usage:
 *   kalshi:mve:backfill --batch-size 5000 --dry-run
 *   kalshi:mve:backfill --batch-size 5000 --apply
 */

import { getClient, Prisma } from '@data-module/db';
import { detectMve, type MveDetectionInput } from '@data-module/core';

export interface MveBackfillOptions {
  batchSize: number;
  dryRun: boolean;
  topic?: string; // Default: SPORTS
}

export interface MveBackfillResult {
  totalProcessed: number;
  mveCount: number;
  nonMveCount: number;
  skippedCount: number; // Already has isMve set
  sourceBreakdown: Record<string, number>;
  sampleMve: Array<{ id: number; title: string; source: string }>;
  sampleNonMve: Array<{ id: number; title: string }>;
}

export async function runKalshiMveBackfill(options: MveBackfillOptions): Promise<MveBackfillResult> {
  const { batchSize, dryRun, topic = 'SPORTS' } = options;
  const prisma = getClient();

  console.log(`\n=== Kalshi MVE Backfill (v3.0.14) ===`);
  console.log(`Topic: ${topic}`);
  console.log(`Batch size: ${batchSize}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLY'}\n`);

  const result: MveBackfillResult = {
    totalProcessed: 0,
    mveCount: 0,
    nonMveCount: 0,
    skippedCount: 0,
    sourceBreakdown: {},
    sampleMve: [],
    sampleNonMve: [],
  };

  // Count total markets to process
  const totalCount = await prisma.market.count({
    where: {
      venue: 'kalshi',
      derivedTopic: topic,
      isMve: null, // Only process unclassified
    },
  });

  console.log(`Markets to process: ${totalCount.toLocaleString()}`);

  if (totalCount === 0) {
    console.log('No markets to process.');
    return result;
  }

  let cursor: number | undefined;
  let batchNum = 0;

  while (true) {
    batchNum++;
    console.log(`\nBatch ${batchNum}: fetching ${batchSize} markets...`);

    const markets = await prisma.market.findMany({
      where: {
        venue: 'kalshi',
        derivedTopic: topic,
        isMve: null,
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: {
        id: true,
        title: true,
        kalshiEventTicker: true,
        metadata: true,
      },
      orderBy: { id: 'asc' },
      take: batchSize,
    });

    if (markets.length === 0) {
      break;
    }

    cursor = markets[markets.length - 1].id;

    // Process batch
    const updates: Array<{ id: number; isMve: boolean }> = [];

    for (const market of markets) {
      result.totalProcessed++;

      const input: MveDetectionInput = {
        eventTicker: market.kalshiEventTicker,
        metadata: market.metadata as Record<string, unknown> | null,
        title: market.title,
      };

      const detection = detectMve(input);

      updates.push({ id: market.id, isMve: detection.isMve });

      if (detection.isMve) {
        result.mveCount++;
        result.sourceBreakdown[detection.source] = (result.sourceBreakdown[detection.source] || 0) + 1;

        if (result.sampleMve.length < 10) {
          result.sampleMve.push({
            id: market.id,
            title: market.title.slice(0, 80),
            source: detection.source,
          });
        }
      } else {
        result.nonMveCount++;

        if (result.sampleNonMve.length < 10) {
          result.sampleNonMve.push({
            id: market.id,
            title: market.title.slice(0, 80),
          });
        }
      }
    }

    // Apply updates if not dry run
    if (!dryRun) {
      const mveIds = updates.filter(u => u.isMve).map(u => u.id);
      const nonMveIds = updates.filter(u => !u.isMve).map(u => u.id);

      if (mveIds.length > 0) {
        await prisma.market.updateMany({
          where: { id: { in: mveIds } },
          data: { isMve: true },
        });
      }

      if (nonMveIds.length > 0) {
        await prisma.market.updateMany({
          where: { id: { in: nonMveIds } },
          data: { isMve: false },
        });
      }
    }

    const progress = ((result.totalProcessed / totalCount) * 100).toFixed(1);
    console.log(
      `  Processed: ${result.totalProcessed.toLocaleString()} / ${totalCount.toLocaleString()} (${progress}%) | MVE: ${result.mveCount.toLocaleString()} | Non-MVE: ${result.nonMveCount.toLocaleString()}`
    );
  }

  // Print summary
  console.log(`\n=== Summary ===`);
  console.log(`Total processed: ${result.totalProcessed.toLocaleString()}`);
  console.log(`MVE markets: ${result.mveCount.toLocaleString()} (${((result.mveCount / result.totalProcessed) * 100).toFixed(2)}%)`);
  console.log(`Non-MVE markets: ${result.nonMveCount.toLocaleString()} (${((result.nonMveCount / result.totalProcessed) * 100).toFixed(2)}%)`);

  console.log(`\nMVE Source Breakdown:`);
  for (const [source, count] of Object.entries(result.sourceBreakdown).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${source}: ${count.toLocaleString()}`);
  }

  console.log(`\nSample MVE titles:`);
  for (const sample of result.sampleMve) {
    console.log(`  [${sample.source}] ${sample.title}`);
  }

  console.log(`\nSample Non-MVE titles:`);
  for (const sample of result.sampleNonMve) {
    console.log(`  ${sample.title}`);
  }

  if (dryRun) {
    console.log(`\n[DRY RUN] No changes written. Run with --apply to update database.`);
  } else {
    console.log(`\n[APPLIED] ${result.totalProcessed.toLocaleString()} markets updated.`);
  }

  return result;
}

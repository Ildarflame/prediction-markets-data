/**
 * taxonomy:overlap - Topic Overlap Dashboard (v3.0.7)
 *
 * Shows cross-venue market counts per CanonicalTopic within eligibility window.
 * Helps identify matching opportunities and coverage gaps.
 *
 * v3.0.7: Uses GROUP BY for accurate counts (fixes 50K limit issue).
 *         Warning for NULL derivedTopic markets.
 *
 * Output per topic:
 * - leftCount (kalshi)
 * - rightCount (polymarket)
 * - overlapPresence (both sides have markets)
 * - matchable (pipeline exists)
 * - pipelineName
 *
 * When overlapCount==0 but both sides > 0: shows sample titles for diagnosis.
 */

import * as fs from 'node:fs';
import { getClient, type Venue } from '@data-module/db';
import { CanonicalTopic, MATCHABLE_TOPICS } from '@data-module/core';
import { getRegisteredPipelineInfos, registerAllPipelines } from '../matching/index.js';

export interface TaxonomyOverlapOptions {
  /** Lookback hours for eligibility window */
  lookbackHours?: number;
  /** Left venue (default: kalshi) */
  leftVenue?: Venue;
  /** Right venue (default: polymarket) */
  rightVenue?: Venue;
  /** Output CSV file path (optional) */
  csvOutput?: string;
  /** Sample size for zero-overlap diagnosis */
  sampleSize?: number;
  /** Live mode: classify on-the-fly instead of using DB derivedTopic */
  live?: boolean;
}

export interface TopicOverlapRow {
  topic: CanonicalTopic;
  leftCount: number;
  rightCount: number;
  overlapPresence: boolean;
  matchable: boolean;
  pipelineName: string | null;
  leftSamples?: string[];
  rightSamples?: string[];
}

export interface TaxonomyOverlapResult {
  ok: boolean;
  leftVenue: Venue;
  rightVenue: Venue;
  lookbackHours: number;
  totalLeftMarkets: number;
  totalRightMarkets: number;
  rows: TopicOverlapRow[];
  csvPath?: string;
}

/**
 * Run taxonomy overlap report
 */
export async function runTaxonomyOverlap(
  options: TaxonomyOverlapOptions = {}
): Promise<TaxonomyOverlapResult> {
  const {
    lookbackHours = 720,
    leftVenue = 'kalshi',
    rightVenue = 'polymarket',
    csvOutput,
    sampleSize = 5,
    live = false,
  } = options;

  // Register pipelines to check availability
  registerAllPipelines();

  const prisma = getClient();
  const cutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

  console.log('\n=== Taxonomy Overlap Dashboard (v3.0.7) ===\n');
  console.log(`Left venue:  ${leftVenue}`);
  console.log(`Right venue: ${rightVenue}`);
  console.log(`Lookback:    ${lookbackHours}h`);
  console.log(`Mode:        ${live ? 'LIVE (sampled)' : 'DB (GROUP BY aggregation)'}`);
  console.log(`Cutoff:      ${cutoff.toISOString()}`);
  console.log();

  // v3.0.7: Use GROUP BY for accurate counts instead of fetching all records
  console.log('[1/4] Aggregating left venue topic counts...');
  const leftCounts = await prisma.market.groupBy({
    by: ['derivedTopic'],
    where: {
      venue: leftVenue,
      status: 'active',
      closeTime: { gte: cutoff },
    },
    _count: { id: true },
  });

  const leftCountMap = new Map<string | null, number>();
  let totalLeftMarkets = 0;
  for (const row of leftCounts) {
    leftCountMap.set(row.derivedTopic, row._count.id);
    totalLeftMarkets += row._count.id;
  }
  console.log(`  Total: ${totalLeftMarkets} markets across ${leftCounts.length} topics`);

  // Warn about NULL derivedTopic on left
  const leftNullCount = leftCountMap.get(null) || 0;
  if (leftNullCount > 0) {
    const pct = ((leftNullCount / totalLeftMarkets) * 100).toFixed(1);
    console.log(`  [Warning] ${leftNullCount} (${pct}%) markets with NULL derivedTopic`);
    console.log(`    Run: kalshi:taxonomy:backfill --apply`);
  }

  console.log('[2/4] Aggregating right venue topic counts...');
  const rightCounts = await prisma.market.groupBy({
    by: ['derivedTopic'],
    where: {
      venue: rightVenue,
      status: 'active',
      closeTime: { gte: cutoff },
    },
    _count: { id: true },
  });

  const rightCountMap = new Map<string | null, number>();
  let totalRightMarkets = 0;
  for (const row of rightCounts) {
    rightCountMap.set(row.derivedTopic, row._count.id);
    totalRightMarkets += row._count.id;
  }
  console.log(`  Total: ${totalRightMarkets} markets across ${rightCounts.length} topics`);

  // Warn about NULL derivedTopic on right
  const rightNullCount = rightCountMap.get(null) || 0;
  if (rightNullCount > 0) {
    const pct = ((rightNullCount / totalRightMarkets) * 100).toFixed(1);
    console.log(`  [Warning] ${rightNullCount} (${pct}%) markets with NULL derivedTopic`);
    console.log(`    Run: polymarket:taxonomy:backfill --classify --apply`);
  }

  // Build topic maps for samples (fetch limited samples per topic)
  console.log('[3/4] Fetching samples for diagnosis...');

  const leftByTopic = new Map<CanonicalTopic, Array<{ id: number; title: string }>>();
  const rightByTopic = new Map<CanonicalTopic, Array<{ id: number; title: string }>>();

  // Get samples for topics that need diagnosis
  for (const topic of Object.values(CanonicalTopic)) {
    const leftCount = leftCountMap.get(topic) || 0;
    const rightCount = rightCountMap.get(topic) || 0;

    // Fetch samples only for topics where one side is zero (for diagnosis)
    if (leftCount === 0 && rightCount > 0) {
      const samples = await prisma.market.findMany({
        where: {
          venue: rightVenue,
          status: 'active',
          closeTime: { gte: cutoff },
          derivedTopic: topic,
        },
        select: { id: true, title: true },
        take: sampleSize,
      });
      rightByTopic.set(topic, samples);
    }

    if (rightCount === 0 && leftCount > 0) {
      const samples = await prisma.market.findMany({
        where: {
          venue: leftVenue,
          status: 'active',
          closeTime: { gte: cutoff },
          derivedTopic: topic,
        },
        select: { id: true, title: true },
        take: sampleSize,
      });
      leftByTopic.set(topic, samples);
    }
  }

  // Build rows for all topics
  console.log('[4/4] Building overlap report...');

  const allTopics = Object.values(CanonicalTopic).filter(t => t !== CanonicalTopic.UNKNOWN);
  const rows: TopicOverlapRow[] = [];

  for (const topic of allTopics) {
    // v3.0.7: Use counts from GROUP BY
    const leftCount = leftCountMap.get(topic) || 0;
    const rightCount = rightCountMap.get(topic) || 0;

    const overlapPresence = leftCount > 0 && rightCount > 0;
    const matchable = MATCHABLE_TOPICS.includes(topic as any);
    const pipelineInfo = getRegisteredPipelineInfos().find(p => p.topic === topic);

    const row: TopicOverlapRow = {
      topic,
      leftCount,
      rightCount,
      overlapPresence,
      matchable,
      pipelineName: pipelineInfo?.algoVersion || null,
    };

    // Add samples from pre-fetched data
    if (!overlapPresence) {
      const leftSamples = leftByTopic.get(topic);
      const rightSamples = rightByTopic.get(topic);

      if (leftSamples && leftSamples.length > 0) {
        row.leftSamples = leftSamples.map(m => m.title.substring(0, 80));
      }
      if (rightSamples && rightSamples.length > 0) {
        row.rightSamples = rightSamples.map(m => m.title.substring(0, 80));
      }
    }

    rows.push(row);
  }

  // Sort by overlap presence (yes first), then by combined count
  rows.sort((a, b) => {
    if (a.overlapPresence !== b.overlapPresence) {
      return a.overlapPresence ? -1 : 1;
    }
    return (b.leftCount + b.rightCount) - (a.leftCount + a.rightCount);
  });

  // Print table
  console.log('\n--- Topic Overlap Table ---\n');
  console.log(
    'Topic'.padEnd(20) +
    leftVenue.padStart(10) +
    rightVenue.padStart(12) +
    'Overlap'.padStart(10) +
    'Matchable'.padStart(10) +
    'Pipeline'.padStart(25)
  );
  console.log('-'.repeat(87));

  for (const row of rows) {
    const overlapStr = row.overlapPresence ? '✓ YES' : '✗ NO';
    const matchableStr = row.matchable ? '✓' : '–';

    console.log(
      row.topic.padEnd(20) +
      String(row.leftCount).padStart(10) +
      String(row.rightCount).padStart(12) +
      overlapStr.padStart(10) +
      matchableStr.padStart(10) +
      (row.pipelineName || '–').padStart(25)
    );

    // Show samples for zero-overlap diagnosis
    if (!row.overlapPresence) {
      if (row.leftSamples && row.leftSamples.length > 0) {
        console.log(`    [${leftVenue}] samples:`);
        for (const s of row.leftSamples) {
          console.log(`      • ${s}`);
        }
      }
      if (row.rightSamples && row.rightSamples.length > 0) {
        console.log(`    [${rightVenue}] samples:`);
        for (const s of row.rightSamples) {
          console.log(`      • ${s}`);
        }
      }
    }
  }

  // Summary stats
  const matchableRows = rows.filter(r => r.matchable);
  const matchableWithOverlap = matchableRows.filter(r => r.overlapPresence);

  console.log('\n--- Summary ---\n');
  console.log(`Total ${leftVenue} markets:     ${totalLeftMarkets}`);
  console.log(`Total ${rightVenue} markets:  ${totalRightMarkets}`);
  console.log(`Topics with overlap:       ${rows.filter(r => r.overlapPresence).length} / ${rows.length}`);
  console.log(`Matchable with overlap:    ${matchableWithOverlap.length} / ${matchableRows.length}`);

  // v3.0.7: Show NULL warning in summary if significant
  if (leftNullCount > 0 || rightNullCount > 0) {
    console.log();
    console.log('[!] NULL derivedTopic counts:');
    if (leftNullCount > 0) {
      console.log(`    ${leftVenue}: ${leftNullCount} (${((leftNullCount / totalLeftMarkets) * 100).toFixed(1)}%)`);
    }
    if (rightNullCount > 0) {
      console.log(`    ${rightVenue}: ${rightNullCount} (${((rightNullCount / totalRightMarkets) * 100).toFixed(1)}%)`);
    }
  }

  // CSV output
  let csvPath: string | undefined;
  if (csvOutput) {
    const csvLines = [
      'topic,leftCount,rightCount,overlapPresence,matchable,pipelineName',
    ];

    for (const row of rows) {
      csvLines.push([
        row.topic,
        row.leftCount,
        row.rightCount,
        row.overlapPresence,
        row.matchable,
        row.pipelineName || '',
      ].join(','));
    }

    fs.writeFileSync(csvOutput, csvLines.join('\n'));
    csvPath = csvOutput;
    console.log(`\nCSV written to: ${csvOutput}`);
  }

  return {
    ok: true,
    leftVenue,
    rightVenue,
    lookbackHours,
    totalLeftMarkets,
    totalRightMarkets,
    rows,
    csvPath,
  };
}

/**
 * taxonomy:overlap - Topic Overlap Dashboard (v3.0.6)
 *
 * Shows cross-venue market counts per CanonicalTopic within eligibility window.
 * Helps identify matching opportunities and coverage gaps.
 *
 * v3.0.6: Default uses DB derivedTopic. Use --live to classify on-the-fly.
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
import { CanonicalTopic, MATCHABLE_TOPICS, classifyKalshiMarket, classifyPolymarketMarketV3 } from '@data-module/core';
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

  console.log('\n=== Taxonomy Overlap Dashboard (v3.0.6) ===\n');
  console.log(`Left venue:  ${leftVenue}`);
  console.log(`Right venue: ${rightVenue}`);
  console.log(`Lookback:    ${lookbackHours}h`);
  console.log(`Mode:        ${live ? 'LIVE (on-the-fly classification)' : 'DB (derivedTopic from database)'}`);
  console.log(`Cutoff:      ${cutoff.toISOString()}`);
  console.log();

  // Fetch markets for both venues
  console.log('[1/4] Fetching left venue markets...');
  const leftMarkets = await prisma.market.findMany({
    where: {
      venue: leftVenue,
      status: 'active',
      closeTime: { gte: cutoff },
    },
    select: {
      id: true,
      title: true,
      derivedTopic: true,
      closeTime: true,
      metadata: true,
    },
    take: 50000,
  });
  console.log(`  Found: ${leftMarkets.length}`);

  console.log('[2/4] Fetching right venue markets...');
  const rightMarkets = await prisma.market.findMany({
    where: {
      venue: rightVenue,
      status: 'active',
      closeTime: { gte: cutoff },
    },
    select: {
      id: true,
      title: true,
      derivedTopic: true,
      closeTime: true,
      pmEventTagSlugs: true,
      pmCategories: true,
    },
    take: 50000,
  });
  console.log(`  Found: ${rightMarkets.length}`);

  // Count by topic for each venue
  console.log('[3/4] Computing topic distribution...');

  const leftByTopic = new Map<CanonicalTopic, typeof leftMarkets>();
  const rightByTopic = new Map<CanonicalTopic, typeof rightMarkets>();

  // Classify left venue markets
  let leftNullCount = 0;
  for (const market of leftMarkets) {
    let topic: CanonicalTopic;

    // v3.0.6: Use DB derivedTopic unless --live flag is set
    if (!live && market.derivedTopic && Object.values(CanonicalTopic).includes(market.derivedTopic as CanonicalTopic)) {
      topic = market.derivedTopic as CanonicalTopic;
    } else if (live || !market.derivedTopic) {
      // Classify on the fly (--live mode or missing derivedTopic)
      if (leftVenue === 'kalshi') {
        const classification = classifyKalshiMarket(
          market.title,
          (market.metadata as Record<string, unknown>)?.category as string | undefined,
          market.metadata as Record<string, unknown>,
        );
        topic = classification.topic;
      } else {
        topic = CanonicalTopic.UNKNOWN;
      }
      if (!market.derivedTopic) leftNullCount++;
    } else {
      topic = CanonicalTopic.UNKNOWN;
    }

    if (!leftByTopic.has(topic)) {
      leftByTopic.set(topic, []);
    }
    leftByTopic.get(topic)!.push(market);
  }

  // Classify right venue markets
  let rightNullCount = 0;
  for (const market of rightMarkets) {
    let topic: CanonicalTopic;

    // v3.0.6: Use DB derivedTopic unless --live flag is set
    if (!live && market.derivedTopic && Object.values(CanonicalTopic).includes(market.derivedTopic as CanonicalTopic)) {
      topic = market.derivedTopic as CanonicalTopic;
    } else if (live || !market.derivedTopic) {
      // Classify on the fly (--live mode or missing derivedTopic)
      if (rightVenue === 'polymarket') {
        const classification = classifyPolymarketMarketV3({
          title: market.title,
          category: undefined,
          tags: market.pmEventTagSlugs || undefined,
          pmCategories: (market.pmCategories || undefined) as Array<{ slug: string; label: string }> | undefined,
        });
        topic = classification.topic;
      } else {
        topic = CanonicalTopic.UNKNOWN;
      }
      if (!market.derivedTopic) rightNullCount++;
    } else {
      topic = CanonicalTopic.UNKNOWN;
    }

    if (!rightByTopic.has(topic)) {
      rightByTopic.set(topic, []);
    }
    rightByTopic.get(topic)!.push(market);
  }

  // Warn about NULL derivedTopic
  if (leftNullCount > 0 || rightNullCount > 0) {
    console.log(`[Warning] Markets with NULL derivedTopic: ${leftVenue}=${leftNullCount}, ${rightVenue}=${rightNullCount}`);
    if (!live) {
      console.log(`  Run kalshi:taxonomy:backfill to populate Kalshi derivedTopic`);
    }
  }

  // Build rows for all topics
  console.log('[4/4] Building overlap report...');

  const allTopics = Object.values(CanonicalTopic).filter(t => t !== CanonicalTopic.UNKNOWN);
  const rows: TopicOverlapRow[] = [];

  for (const topic of allTopics) {
    const leftList = leftByTopic.get(topic) || [];
    const rightList = rightByTopic.get(topic) || [];
    const leftCount = leftList.length;
    const rightCount = rightList.length;

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

    // Add samples if zero overlap but both sides have markets
    if (!overlapPresence && (leftCount > 0 || rightCount > 0)) {
      if (leftCount > 0) {
        row.leftSamples = leftList
          .slice(0, sampleSize)
          .map(m => m.title.substring(0, 80));
      }
      if (rightCount > 0) {
        row.rightSamples = rightList
          .slice(0, sampleSize)
          .map(m => m.title.substring(0, 80));
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
  console.log(`Total ${leftVenue} markets:     ${leftMarkets.length}`);
  console.log(`Total ${rightVenue} markets:  ${rightMarkets.length}`);
  console.log(`Topics with overlap:       ${rows.filter(r => r.overlapPresence).length} / ${rows.length}`);
  console.log(`Matchable with overlap:    ${matchableWithOverlap.length} / ${matchableRows.length}`);

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
    totalLeftMarkets: leftMarkets.length,
    totalRightMarkets: rightMarkets.length,
    rows,
    csvPath,
  };
}

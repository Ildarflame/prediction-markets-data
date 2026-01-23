/**
 * taxonomy:gap-report - Topic Gap Analysis (v3.0.9)
 *
 * Analyzes why a specific topic has zero or low overlap between venues.
 * Shows:
 * - Market counts per venue
 * - Sample markets from each side
 * - TaxonomySource distribution
 * - Diagnosis hint (no series, weak mapping, needs title fallback)
 */

import { getClient, type Venue } from '@data-module/db';
import { CanonicalTopic } from '@data-module/core';

export interface TaxonomyGapReportOptions {
  /** Left venue (default: kalshi) */
  leftVenue?: Venue;
  /** Right venue (default: polymarket) */
  rightVenue?: Venue;
  /** Topic to analyze */
  topic: CanonicalTopic;
  /** Lookback hours (default: 720) */
  lookbackHours?: number;
  /** Sample size per venue (default: 10) */
  sampleSize?: number;
}

export interface TaxonomyGapReportResult {
  ok: boolean;
  topic: CanonicalTopic;
  leftVenue: Venue;
  rightVenue: Venue;
  leftCount: number;
  rightCount: number;
  leftSamples: Array<{ id: number; title: string; taxonomySource: string | null }>;
  rightSamples: Array<{ id: number; title: string; taxonomySource: string | null }>;
  leftSourceDistribution: Record<string, number>;
  rightSourceDistribution: Record<string, number>;
  diagnosis: string;
}

/**
 * Analyze gap for a specific topic
 */
export async function runTaxonomyGapReport(
  options: TaxonomyGapReportOptions
): Promise<TaxonomyGapReportResult> {
  const {
    leftVenue = 'kalshi',
    rightVenue = 'polymarket',
    topic,
    lookbackHours = 720,
    sampleSize = 10,
  } = options;

  console.log(`\n=== Taxonomy Gap Report (v3.0.9) ===\n`);
  console.log(`Topic:       ${topic}`);
  console.log(`Left venue:  ${leftVenue}`);
  console.log(`Right venue: ${rightVenue}`);
  console.log(`Lookback:    ${lookbackHours}h`);
  console.log();

  const prisma = getClient();
  const cutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

  // Step 1: Count markets per venue
  console.log('[1/4] Counting markets per venue...');

  const leftCount = await prisma.market.count({
    where: {
      venue: leftVenue,
      derivedTopic: topic,
      status: 'active',
      closeTime: { gte: cutoff },
    },
  });

  const rightCount = await prisma.market.count({
    where: {
      venue: rightVenue,
      derivedTopic: topic,
      status: 'active',
      closeTime: { gte: cutoff },
    },
  });

  console.log(`  ${leftVenue}: ${leftCount} markets`);
  console.log(`  ${rightVenue}: ${rightCount} markets`);

  // Step 2: Get samples from each venue
  console.log('\n[2/4] Fetching sample markets...');

  const leftSamples = await prisma.market.findMany({
    where: {
      venue: leftVenue,
      derivedTopic: topic,
      status: 'active',
      closeTime: { gte: cutoff },
    },
    select: {
      id: true,
      title: true,
      taxonomySource: true,
      category: true,
      metadata: true,
    },
    take: sampleSize,
    orderBy: { closeTime: 'desc' },
  });

  const rightSamples = await prisma.market.findMany({
    where: {
      venue: rightVenue,
      derivedTopic: topic,
      status: 'active',
      closeTime: { gte: cutoff },
    },
    select: {
      id: true,
      title: true,
      taxonomySource: true,
      category: true,
      metadata: true,
    },
    take: sampleSize,
    orderBy: { closeTime: 'desc' },
  });

  // Step 3: Get taxonomySource distribution
  console.log('\n[3/4] Analyzing taxonomy source distribution...');

  const leftSourceGroups = await prisma.market.groupBy({
    by: ['taxonomySource'],
    where: {
      venue: leftVenue,
      derivedTopic: topic,
      status: 'active',
      closeTime: { gte: cutoff },
    },
    _count: { id: true },
  });

  const rightSourceGroups = await prisma.market.groupBy({
    by: ['taxonomySource'],
    where: {
      venue: rightVenue,
      derivedTopic: topic,
      status: 'active',
      closeTime: { gte: cutoff },
    },
    _count: { id: true },
  });

  const leftSourceDistribution: Record<string, number> = {};
  for (const row of leftSourceGroups) {
    leftSourceDistribution[row.taxonomySource || 'NULL'] = row._count.id;
  }

  const rightSourceDistribution: Record<string, number> = {};
  for (const row of rightSourceGroups) {
    rightSourceDistribution[row.taxonomySource || 'NULL'] = row._count.id;
  }

  // Step 4: Generate diagnosis
  console.log('\n[4/4] Generating diagnosis...');

  let diagnosis = '';

  if (leftCount === 0 && rightCount === 0) {
    diagnosis = `No markets classified as ${topic} on either venue. Check if topic rules exist in taxonomy.`;
  } else if (leftCount === 0) {
    // Check if it's a series/category issue for Kalshi
    if (leftVenue === 'kalshi') {
      const seriesCount = await prisma.kalshiSeries.count();
      if (seriesCount === 0) {
        diagnosis = `No Kalshi series in cache. Run: kalshi:series:sync`;
      } else {
        diagnosis = `No ${leftVenue} markets classified as ${topic}. Likely causes:\n` +
          `  1. No series with matching category/tags (run: kalshi:series:topic-audit --topic ${topic})\n` +
          `  2. Series mapping rules don't cover this topic\n` +
          `  3. Need title-based fallback classification`;
      }
    } else {
      diagnosis = `No ${leftVenue} markets classified as ${topic}. Check taxonomy rules.`;
    }
  } else if (rightCount === 0) {
    if (rightVenue === 'polymarket') {
      diagnosis = `No ${rightVenue} markets classified as ${topic}. Likely causes:\n` +
        `  1. No events/markets with matching categories\n` +
        `  2. Category mapping rules don't cover this topic\n` +
        `  3. Need title-based fallback classification`;
    } else {
      diagnosis = `No ${rightVenue} markets classified as ${topic}. Check taxonomy rules.`;
    }
  } else if (leftCount < 10 || rightCount < 10) {
    diagnosis = `Low market count on one or both venues. May indicate:\n` +
      `  1. Niche topic with few markets\n` +
      `  2. Classification rules too strict\n` +
      `  3. Markets exist but not yet classified (run backfill)`;
  } else {
    diagnosis = `Both venues have ${topic} markets. Overlap exists - ready for matching.`;
  }

  // Print results
  console.log('\n--- Market Counts ---\n');
  console.log(`${leftVenue.padEnd(15)} ${leftCount}`);
  console.log(`${rightVenue.padEnd(15)} ${rightCount}`);
  console.log(`${'Overlap'.padEnd(15)} ${leftCount > 0 && rightCount > 0 ? 'YES' : 'NO'}`);

  // Print samples
  if (leftSamples.length > 0) {
    console.log(`\n--- ${leftVenue} Samples (${leftSamples.length}) ---\n`);
    for (const s of leftSamples) {
      const meta = s.metadata as Record<string, unknown> | null;
      const seriesTicker = meta?.seriesTicker || meta?.eventTicker || '-';
      console.log(`  [${s.id}] ${s.title.substring(0, 60)}...`);
      console.log(`         source: ${s.taxonomySource || 'NULL'}, ticker: ${seriesTicker}`);
    }
  } else {
    console.log(`\n--- ${leftVenue} Samples ---\n`);
    console.log('  (no markets)');
  }

  if (rightSamples.length > 0) {
    console.log(`\n--- ${rightVenue} Samples (${rightSamples.length}) ---\n`);
    for (const s of rightSamples) {
      console.log(`  [${s.id}] ${s.title.substring(0, 60)}...`);
      console.log(`         source: ${s.taxonomySource || 'NULL'}, category: ${s.category || '-'}`);
    }
  } else {
    console.log(`\n--- ${rightVenue} Samples ---\n`);
    console.log('  (no markets)');
  }

  // Print source distribution
  console.log(`\n--- Taxonomy Source Distribution ---\n`);
  console.log(`${leftVenue}:`);
  if (Object.keys(leftSourceDistribution).length > 0) {
    for (const [source, count] of Object.entries(leftSourceDistribution).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${source.padEnd(25)} ${count}`);
    }
  } else {
    console.log('  (none)');
  }

  console.log(`\n${rightVenue}:`);
  if (Object.keys(rightSourceDistribution).length > 0) {
    for (const [source, count] of Object.entries(rightSourceDistribution).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${source.padEnd(25)} ${count}`);
    }
  } else {
    console.log('  (none)');
  }

  // Print diagnosis
  console.log('\n--- Diagnosis ---\n');
  console.log(diagnosis);
  console.log();

  return {
    ok: true,
    topic,
    leftVenue,
    rightVenue,
    leftCount,
    rightCount,
    leftSamples: leftSamples.map(s => ({
      id: s.id,
      title: s.title,
      taxonomySource: s.taxonomySource,
    })),
    rightSamples: rightSamples.map(s => ({
      id: s.id,
      title: s.title,
      taxonomySource: s.taxonomySource,
    })),
    leftSourceDistribution,
    rightSourceDistribution,
    diagnosis,
  };
}

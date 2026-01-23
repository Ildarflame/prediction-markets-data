/**
 * Kalshi MVE Audit Command (v3.0.15)
 *
 * Audits MVE truth field coverage from Kalshi API.
 * Shows how many markets have native API fields vs heuristics-only detection.
 *
 * Usage:
 *   kalshi:mve:audit --lookback-hours 168
 */

import { getClient, Prisma } from '@data-module/db';

export interface MveAuditOptions {
  lookbackHours: number;
  topic?: string;
}

export interface MveAuditResult {
  totalSportsMarkets: number;
  withMveCollectionTicker: number;
  withMveSelectedLegs: number;
  withAnyApiTruthField: number;
  heuristicsOnlyMve: number;
  nonMve: number;
  unknownMve: number;
  truthFieldCoverage: number; // percentage
  seriesBreakdown: Array<{
    seriesTicker: string;
    total: number;
    mve: number;
    nonMve: number;
    withTruthField: number;
    mvePercent: number;
    truthFieldPercent: number;
  }>;
}

export async function runKalshiMveAudit(options: MveAuditOptions): Promise<MveAuditResult> {
  const { lookbackHours, topic = 'SPORTS' } = options;
  const prisma = getClient();

  console.log(`\n=== Kalshi MVE Audit (v3.0.15) ===`);
  console.log(`Topic: ${topic}`);
  console.log(`Lookback: ${lookbackHours}h\n`);

  const lookbackDate = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

  // Total SPORTS markets
  const totalSportsMarkets = await prisma.market.count({
    where: {
      venue: 'kalshi',
      derivedTopic: topic,
      closeTime: { gte: lookbackDate },
    },
  });

  // Markets with mve_collection_ticker
  const withMveCollectionTicker = await prisma.market.count({
    where: {
      venue: 'kalshi',
      derivedTopic: topic,
      closeTime: { gte: lookbackDate },
      kalshiMveCollectionTicker: { not: null },
    },
  });

  // Markets with mve_selected_legs
  const withMveSelectedLegs = await prisma.market.count({
    where: {
      venue: 'kalshi',
      derivedTopic: topic,
      closeTime: { gte: lookbackDate },
      NOT: {
        kalshiMveSelectedLegs: { equals: Prisma.DbNull },
      },
    },
  });

  // Markets with any API truth field
  const withAnyApiTruthField = await prisma.market.count({
    where: {
      venue: 'kalshi',
      derivedTopic: topic,
      closeTime: { gte: lookbackDate },
      OR: [
        { kalshiMveCollectionTicker: { not: null } },
        { NOT: { kalshiMveSelectedLegs: { equals: Prisma.DbNull } } },
      ],
    },
  });

  // isMve = true but no API truth fields (heuristics only)
  const heuristicsOnlyMve = await prisma.market.count({
    where: {
      venue: 'kalshi',
      derivedTopic: topic,
      closeTime: { gte: lookbackDate },
      isMve: true,
      kalshiMveCollectionTicker: null,
      kalshiMveSelectedLegs: { equals: Prisma.DbNull },
    },
  });

  // Non-MVE markets
  const nonMve = await prisma.market.count({
    where: {
      venue: 'kalshi',
      derivedTopic: topic,
      closeTime: { gte: lookbackDate },
      isMve: false,
    },
  });

  // Unknown MVE status
  const unknownMve = await prisma.market.count({
    where: {
      venue: 'kalshi',
      derivedTopic: topic,
      closeTime: { gte: lookbackDate },
      isMve: null,
    },
  });

  // Series breakdown
  const seriesRaw = await prisma.$queryRaw<
    Array<{
      series_ticker: string | null;
      total: bigint;
      mve_count: bigint;
      non_mve_count: bigint;
      with_truth_field: bigint;
    }>
  >`
    SELECT
      metadata->>'seriesTicker' as series_ticker,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE is_mve = true) as mve_count,
      COUNT(*) FILTER (WHERE is_mve = false) as non_mve_count,
      COUNT(*) FILTER (WHERE kalshi_mve_collection_ticker IS NOT NULL OR kalshi_mve_selected_legs IS NOT NULL) as with_truth_field
    FROM markets
    WHERE venue = 'kalshi'
      AND derived_topic = ${topic}
      AND close_time >= ${lookbackDate}
    GROUP BY metadata->>'seriesTicker'
    ORDER BY COUNT(*) DESC
    LIMIT 30
  `;

  const seriesBreakdown = seriesRaw.map((row) => {
    const total = Number(row.total);
    const mve = Number(row.mve_count);
    const nonMveRow = Number(row.non_mve_count);
    const withTruth = Number(row.with_truth_field);
    return {
      seriesTicker: row.series_ticker || 'UNKNOWN',
      total,
      mve,
      nonMve: nonMveRow,
      withTruthField: withTruth,
      mvePercent: total > 0 ? (mve / total) * 100 : 0,
      truthFieldPercent: total > 0 ? (withTruth / total) * 100 : 0,
    };
  });

  const truthFieldCoverage =
    totalSportsMarkets > 0 ? (withAnyApiTruthField / totalSportsMarkets) * 100 : 0;

  // Print results
  console.log('=== Summary ===');
  console.log(`Total ${topic} markets: ${totalSportsMarkets.toLocaleString()}`);
  console.log('');
  console.log('MVE Detection Source:');
  console.log(`  With mve_collection_ticker: ${withMveCollectionTicker.toLocaleString()}`);
  console.log(`  With mve_selected_legs:     ${withMveSelectedLegs.toLocaleString()}`);
  console.log(`  With any API truth field:   ${withAnyApiTruthField.toLocaleString()} (${truthFieldCoverage.toFixed(1)}%)`);
  console.log(`  Heuristics-only MVE:        ${heuristicsOnlyMve.toLocaleString()}`);
  console.log('');
  console.log('Classification:');
  console.log(`  MVE (is_mve=true):  ${(withAnyApiTruthField + heuristicsOnlyMve).toLocaleString()}`);
  console.log(`  Non-MVE:            ${nonMve.toLocaleString()}`);
  console.log(`  Unknown:            ${unknownMve.toLocaleString()}`);
  console.log('');

  console.log('=== Series Breakdown (Top 30) ===');
  console.log('SeriesTicker'.padEnd(35) + 'Total'.padStart(8) + 'MVE'.padStart(8) + 'NonMVE'.padStart(8) + 'Truth%'.padStart(10));
  console.log('-'.repeat(70));

  for (const series of seriesBreakdown) {
    console.log(
      series.seriesTicker.padEnd(35) +
        series.total.toString().padStart(8) +
        series.mve.toString().padStart(8) +
        series.nonMve.toString().padStart(8) +
        `${series.truthFieldPercent.toFixed(1)}%`.padStart(10)
    );
  }

  // Highlight non-MVE series for matching
  const nonMveSeries = seriesBreakdown.filter((s) => s.nonMve > 0 && s.mvePercent < 50);
  if (nonMveSeries.length > 0) {
    console.log('');
    console.log('=== Non-MVE Candidates (potential for matching) ===');
    for (const series of nonMveSeries) {
      console.log(`  ${series.seriesTicker}: ${series.nonMve} non-MVE markets`);
    }
  }

  return {
    totalSportsMarkets,
    withMveCollectionTicker,
    withMveSelectedLegs,
    withAnyApiTruthField,
    heuristicsOnlyMve,
    nonMve,
    unknownMve,
    truthFieldCoverage,
    seriesBreakdown,
  };
}

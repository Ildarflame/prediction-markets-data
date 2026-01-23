/**
 * Kalshi Sports Breakdown Command (v3.0.14)
 *
 * Shows MVE vs Non-MVE breakdown for Kalshi SPORTS markets.
 *
 * Usage:
 *   kalshi:sports:breakdown --lookback-h 720
 */

import { getClient } from '@data-module/db';

export interface SportsBreakdownOptions {
  lookbackHours?: number;
}

export interface SportsBreakdownResult {
  total: number;
  mveCount: number;
  nonMveCount: number;
  unknownCount: number;
  topNonMveSeries: Array<{ seriesTicker: string; count: number }>;
  sampleMveTitles: string[];
  sampleNonMveTitles: string[];
}

export async function runKalshiSportsBreakdown(options: SportsBreakdownOptions): Promise<SportsBreakdownResult> {
  const { lookbackHours = 720 } = options;
  const prisma = getClient();

  const cutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

  console.log(`\n=== Kalshi SPORTS Breakdown (v3.0.14) ===`);
  console.log(`Lookback: ${lookbackHours}h (since ${cutoff.toISOString()})\n`);

  // Get counts by isMve status
  const [total, mveCount, nonMveCount, unknownCount] = await Promise.all([
    prisma.market.count({
      where: {
        venue: 'kalshi',
        derivedTopic: 'SPORTS',
        createdAt: { gte: cutoff },
      },
    }),
    prisma.market.count({
      where: {
        venue: 'kalshi',
        derivedTopic: 'SPORTS',
        isMve: true,
        createdAt: { gte: cutoff },
      },
    }),
    prisma.market.count({
      where: {
        venue: 'kalshi',
        derivedTopic: 'SPORTS',
        isMve: false,
        createdAt: { gte: cutoff },
      },
    }),
    prisma.market.count({
      where: {
        venue: 'kalshi',
        derivedTopic: 'SPORTS',
        isMve: null,
        createdAt: { gte: cutoff },
      },
    }),
  ]);

  console.log(`Total SPORTS markets: ${total.toLocaleString()}`);
  console.log(`  MVE:     ${mveCount.toLocaleString()} (${((mveCount / total) * 100).toFixed(2)}%)`);
  console.log(`  Non-MVE: ${nonMveCount.toLocaleString()} (${((nonMveCount / total) * 100).toFixed(2)}%)`);
  console.log(`  Unknown: ${unknownCount.toLocaleString()} (${((unknownCount / total) * 100).toFixed(2)}%)`);

  // Get top non-MVE series tickers
  const nonMveMarkets = await prisma.market.findMany({
    where: {
      venue: 'kalshi',
      derivedTopic: 'SPORTS',
      isMve: false,
      createdAt: { gte: cutoff },
    },
    select: {
      kalshiEventTicker: true,
      metadata: true,
    },
  });

  // Extract series tickers and count
  const seriesCount = new Map<string, number>();
  for (const market of nonMveMarkets) {
    const eventTicker = market.kalshiEventTicker || '';
    // Extract series ticker from event ticker (first part before date)
    const seriesTicker = eventTicker.split('-')[0] ||
      (market.metadata as Record<string, unknown>)?.seriesTicker as string ||
      'UNKNOWN';
    seriesCount.set(seriesTicker, (seriesCount.get(seriesTicker) || 0) + 1);
  }

  const topNonMveSeries = Array.from(seriesCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([seriesTicker, count]) => ({ seriesTicker, count }));

  console.log(`\nTop 20 Non-MVE seriesTickers:`);
  for (const { seriesTicker, count } of topNonMveSeries) {
    console.log(`  ${seriesTicker}: ${count}`);
  }

  // Sample MVE titles
  const mveSamples = await prisma.market.findMany({
    where: {
      venue: 'kalshi',
      derivedTopic: 'SPORTS',
      isMve: true,
      createdAt: { gte: cutoff },
    },
    select: { title: true },
    take: 10,
    orderBy: { createdAt: 'desc' },
  });

  console.log(`\nSample MVE titles (10):`);
  for (let i = 0; i < mveSamples.length; i++) {
    console.log(`  ${i + 1}. ${mveSamples[i].title.slice(0, 100)}`);
  }

  // Sample non-MVE titles
  const nonMveSamples = await prisma.market.findMany({
    where: {
      venue: 'kalshi',
      derivedTopic: 'SPORTS',
      isMve: false,
      createdAt: { gte: cutoff },
    },
    select: { title: true },
    take: 10,
    orderBy: { createdAt: 'desc' },
  });

  console.log(`\nSample Non-MVE titles (10):`);
  for (let i = 0; i < nonMveSamples.length; i++) {
    console.log(`  ${i + 1}. ${nonMveSamples[i].title.slice(0, 100)}`);
  }

  return {
    total,
    mveCount,
    nonMveCount,
    unknownCount,
    topNonMveSeries,
    sampleMveTitles: mveSamples.map(m => m.title),
    sampleNonMveTitles: nonMveSamples.map(m => m.title),
  };
}

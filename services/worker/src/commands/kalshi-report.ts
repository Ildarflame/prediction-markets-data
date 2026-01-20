/**
 * Kalshi coverage report command
 * Shows breakdown of markets by series, category, status, and date ranges
 */

import { KalshiAdapter, type KalshiAuthConfig } from '../adapters/index.js';
import { loadKalshiConfig } from '../adapters/kalshi.config.js';

export interface KalshiReportOptions {
  kalshiAuth?: KalshiAuthConfig;
}

interface MarketStats {
  byStatus: Record<string, number>;
  bySeries: Record<string, number>;
  byCategory: Record<string, number>;
  closeTimes: { earliest?: Date; latest?: Date };
  total: number;
}

export async function runKalshiReport(options: KalshiReportOptions = {}): Promise<void> {
  const config = loadKalshiConfig();
  const adapter = new KalshiAdapter({}, options.kalshiAuth, config);

  console.log('\n[kalshi-report] Fetching all markets from Kalshi API...\n');

  const stats: MarketStats = {
    byStatus: {},
    bySeries: {},
    byCategory: {},
    closeTimes: {},
    total: 0,
  };

  const markets = await adapter.fetchAllMarkets((progress) => {
    process.stdout.write(`\r[kalshi-report] Progress: ${progress.totalMarkets} markets fetched...`);
  });

  console.log('\n');

  // Analyze markets
  for (const market of markets) {
    stats.total++;

    // Status
    const status = market.status || 'unknown';
    stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;

    // Series (from metadata)
    const meta = market.metadata as { seriesTicker?: string; eventTicker?: string } | undefined;
    const series = meta?.seriesTicker || 'unknown';
    stats.bySeries[series] = (stats.bySeries[series] || 0) + 1;

    // Category
    const category = market.category || 'unknown';
    stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;

    // Close time range
    if (market.closeTime) {
      const closeDate = market.closeTime instanceof Date ? market.closeTime : new Date(market.closeTime);
      if (!stats.closeTimes.earliest || closeDate < stats.closeTimes.earliest) {
        stats.closeTimes.earliest = closeDate;
      }
      if (!stats.closeTimes.latest || closeDate > stats.closeTimes.latest) {
        stats.closeTimes.latest = closeDate;
      }
    }
  }

  // Print report
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                    KALSHI COVERAGE REPORT                      ');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log();

  // Total
  console.log(`Total markets: ${stats.total}`);
  console.log();

  // Status breakdown
  console.log('┌─────────────────────────────────────────────────────────────┐');
  console.log('│ STATUS BREAKDOWN                                            │');
  console.log('├─────────────────────────────────────────────────────────────┤');
  const statusEntries = Object.entries(stats.byStatus).sort((a, b) => b[1] - a[1]);
  for (const [status, count] of statusEntries) {
    const pct = ((count / stats.total) * 100).toFixed(1);
    const bar = '█'.repeat(Math.round(parseFloat(pct) / 5));
    console.log(`│ ${status.padEnd(12)} ${String(count).padStart(6)} (${pct.padStart(5)}%) ${bar.padEnd(20)} │`);
  }
  console.log('└─────────────────────────────────────────────────────────────┘');
  console.log();

  // Close time range
  console.log('┌─────────────────────────────────────────────────────────────┐');
  console.log('│ CLOSE TIME RANGE                                            │');
  console.log('├─────────────────────────────────────────────────────────────┤');
  if (stats.closeTimes.earliest && stats.closeTimes.latest) {
    console.log(`│ Earliest: ${stats.closeTimes.earliest.toISOString().padEnd(47)} │`);
    console.log(`│ Latest:   ${stats.closeTimes.latest.toISOString().padEnd(47)} │`);
  } else {
    console.log('│ No close times available                                    │');
  }
  console.log('└─────────────────────────────────────────────────────────────┘');
  console.log();

  // Top 10 series by market count
  console.log('┌─────────────────────────────────────────────────────────────┐');
  console.log('│ TOP 10 SERIES BY MARKET COUNT                               │');
  console.log('├─────────────────────────────────────────────────────────────┤');
  const seriesEntries = Object.entries(stats.bySeries)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  for (const [series, count] of seriesEntries) {
    const pct = ((count / stats.total) * 100).toFixed(1);
    console.log(`│ ${series.padEnd(25).slice(0, 25)} ${String(count).padStart(6)} (${pct.padStart(5)}%)          │`);
  }
  console.log('└─────────────────────────────────────────────────────────────┘');
  console.log();

  // Top 10 categories by market count
  console.log('┌─────────────────────────────────────────────────────────────┐');
  console.log('│ TOP 10 CATEGORIES BY MARKET COUNT                           │');
  console.log('├─────────────────────────────────────────────────────────────┤');
  const categoryEntries = Object.entries(stats.byCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  for (const [category, count] of categoryEntries) {
    const pct = ((count / stats.total) * 100).toFixed(1);
    console.log(`│ ${category.padEnd(25).slice(0, 25)} ${String(count).padStart(6)} (${pct.padStart(5)}%)          │`);
  }
  console.log('└─────────────────────────────────────────────────────────────┘');
  console.log();

  // Summary of all series
  console.log('┌─────────────────────────────────────────────────────────────┐');
  console.log('│ ALL SERIES SUMMARY                                          │');
  console.log('├─────────────────────────────────────────────────────────────┤');
  console.log(`│ Total unique series: ${Object.keys(stats.bySeries).length.toString().padEnd(36)} │`);
  console.log(`│ Total unique categories: ${Object.keys(stats.byCategory).length.toString().padEnd(33)} │`);
  console.log('└─────────────────────────────────────────────────────────────┘');
  console.log();
}

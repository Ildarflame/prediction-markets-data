/**
 * Kalshi coverage report command
 * Shows breakdown of markets by series, category, status, and date ranges
 */

import { KalshiAdapter, type KalshiAuthConfig } from '../adapters/index.js';
import { loadKalshiConfig } from '../adapters/kalshi.config.js';

export interface KalshiReportOptions {
  kalshiAuth?: KalshiAuthConfig;
  skipMarkets?: boolean;
}

interface MarketStats {
  byStatus: Record<string, number>;
  bySeries: Record<string, number>;
  byCategory: Record<string, number>;
  byKeyword: Record<string, number>;
  closeTimes: { earliest?: Date; latest?: Date };
  total: number;
  titles: string[];
}

/** Keywords to search for in market titles */
const OVERLAP_KEYWORDS = [
  'bitcoin', 'btc', 'ethereum', 'eth', 'crypto',
  'trump', 'biden', 'election', 'president', 'congress',
  'cpi', 'gdp', 'inflation', 'fed', 'rate',
  'ukraine', 'russia', 'china', 'war',
];

export async function runKalshiReport(options: KalshiReportOptions = {}): Promise<void> {
  const config = loadKalshiConfig();
  const adapter = new KalshiAdapter({}, options.kalshiAuth, config);

  console.log('\n[kalshi-report] Kalshi Coverage Report');
  console.log(`[kalshi-report] Base URL: ${adapter.getBaseUrl()}\n`);

  // First, fetch and display series categories
  console.log('[kalshi-report] Fetching series catalog...');
  const seriesList = await adapter.getAllSeriesWithCategories();

  // Group series by category
  const seriesByCategory = new Map<string, typeof seriesList>();
  for (const s of seriesList) {
    const cat = s.category || 'unknown';
    if (!seriesByCategory.has(cat)) {
      seriesByCategory.set(cat, []);
    }
    seriesByCategory.get(cat)!.push(s);
  }

  console.log(`\n[kalshi-report] Found ${seriesList.length} series in ${seriesByCategory.size} categories\n`);

  // Print series categories
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                    SERIES CATEGORIES                           ');
  console.log('═══════════════════════════════════════════════════════════════');

  const sortedCategories = Array.from(seriesByCategory.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 30);

  console.log('\nCategory'.padEnd(25) + 'Series Count'.padStart(15));
  console.log('-'.repeat(40));
  for (const [category, items] of sortedCategories) {
    console.log(`${category.padEnd(25)}${String(items.length).padStart(15)}`);
  }

  // Check for political/economic series
  console.log('\n[kalshi-report] Series matching political/economic keywords:');
  const politicalSeries: typeof seriesList = [];
  for (const s of seriesList) {
    const text = `${s.title} ${s.category} ${s.tags.join(' ')}`.toLowerCase();
    if (OVERLAP_KEYWORDS.some(k => text.includes(k))) {
      politicalSeries.push(s);
    }
  }

  if (politicalSeries.length > 0) {
    for (const s of politicalSeries.slice(0, 20)) {
      console.log(`  - ${s.ticker}: ${s.title} [${s.category}]`);
    }
    if (politicalSeries.length > 20) {
      console.log(`  ... and ${politicalSeries.length - 20} more`);
    }
  } else {
    console.log('  (none found)');
  }

  // Skip market fetching if requested
  if (options.skipMarkets) {
    console.log('\n[kalshi-report] Skipping market fetch (--skip-markets)');
    return;
  }

  console.log('\n[kalshi-report] Fetching markets...\n');

  const stats: MarketStats = {
    byStatus: {},
    bySeries: {},
    byCategory: {},
    byKeyword: {},
    closeTimes: {},
    total: 0,
    titles: [],
  };

  // Initialize keyword counts
  for (const kw of OVERLAP_KEYWORDS) {
    stats.byKeyword[kw] = 0;
  }

  const markets = await adapter.fetchAllMarkets((progress) => {
    process.stdout.write(`\r[kalshi-report] Progress: ${progress.totalMarkets} markets fetched...`);
  });

  console.log('\n');

  // Analyze markets
  for (const market of markets) {
    stats.total++;
    stats.titles.push(market.title);

    // Status
    const status = market.status || 'unknown';
    stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;

    // Series (from metadata)
    const meta = market.metadata as { seriesTicker?: string; eventTicker?: string } | undefined;
    const series = meta?.seriesTicker || 'unknown';
    stats.bySeries[series] = (stats.bySeries[series] || 0) + 1;

    // Category (try multiple sources)
    const category = market.category || meta?.eventTicker?.split('-')[0] || 'unknown';
    stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;

    // Keyword search
    const titleLower = market.title.toLowerCase();
    for (const kw of OVERLAP_KEYWORDS) {
      if (titleLower.includes(kw)) {
        stats.byKeyword[kw]++;
      }
    }

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
  console.log('                    KALSHI MARKET REPORT                        ');
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

  // Keyword grep counts
  console.log('┌─────────────────────────────────────────────────────────────┐');
  console.log('│ KEYWORD SEARCH (in market titles)                           │');
  console.log('├─────────────────────────────────────────────────────────────┤');
  const keywordEntries = Object.entries(stats.byKeyword)
    .sort((a, b) => b[1] - a[1]);
  for (const [keyword, count] of keywordEntries) {
    const pct = stats.total > 0 ? ((count / stats.total) * 100).toFixed(2) : '0.00';
    const status = count > 0 ? '✓' : '✗';
    console.log(`│ ${status} ${keyword.padEnd(15)} ${String(count).padStart(6)} (${pct.padStart(6)}%)              │`);
  }
  console.log('└─────────────────────────────────────────────────────────────┘');

  const hasOverlapKeywords = Object.values(stats.byKeyword).some(c => c > 0);
  if (!hasOverlapKeywords) {
    console.log('│ ⚠ NO OVERLAP KEYWORDS FOUND IN MARKETS                      │');
    console.log('│   Dataset may not contain political/economic markets        │');
    console.log('└─────────────────────────────────────────────────────────────┘');
  }
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

  // Top 30 series by market count
  console.log('┌─────────────────────────────────────────────────────────────┐');
  console.log('│ TOP 30 SERIES_TICKER BY MARKET COUNT                        │');
  console.log('├─────────────────────────────────────────────────────────────┤');
  const seriesEntries = Object.entries(stats.bySeries)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30);
  for (const [series, count] of seriesEntries) {
    const pct = ((count / stats.total) * 100).toFixed(1);
    console.log(`│ ${series.padEnd(30).slice(0, 30)} ${String(count).padStart(6)} (${pct.padStart(5)}%)     │`);
  }
  console.log('└─────────────────────────────────────────────────────────────┘');
  console.log();

  // Summary
  console.log('┌─────────────────────────────────────────────────────────────┐');
  console.log('│ SUMMARY                                                     │');
  console.log('├─────────────────────────────────────────────────────────────┤');
  console.log(`│ Total markets: ${stats.total.toString().padEnd(42)} │`);
  console.log(`│ Unique series_ticker: ${Object.keys(stats.bySeries).length.toString().padEnd(35)} │`);
  console.log(`│ Unique categories: ${Object.keys(stats.byCategory).length.toString().padEnd(38)} │`);
  console.log(`│ Has overlap keywords: ${(hasOverlapKeywords ? 'YES' : 'NO').padEnd(35)} │`);
  console.log('└─────────────────────────────────────────────────────────────┘');
  console.log();
}

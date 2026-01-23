/**
 * Kalshi Series Topic Audit Command (v3.0.8)
 *
 * Shows top series by category/tags and their topic mappings.
 * Helps identify ELECTIONS/COMMODITIES opportunities.
 */

import { getClient } from '@data-module/db';
import { CanonicalTopic } from '@data-module/core';

export interface KalshiSeriesAuditOptions {
  /** Limit number of categories to show */
  limit?: number;
  /** Show markets count per series */
  showMarkets?: boolean;
}

export interface SeriesCategoryStats {
  category: string | null;
  seriesCount: number;
  marketCount: number;
  suggestedTopic: CanonicalTopic;
  sampleTickers: string[];
}

/**
 * Map Kalshi category to CanonicalTopic
 */
function mapCategoryToTopic(category: string | null, tags: string[]): CanonicalTopic {
  if (!category) return CanonicalTopic.UNKNOWN;

  const cat = category.toLowerCase();
  const tagSet = new Set(tags.map(t => t.toLowerCase()));

  // Elections mapping
  if (cat === 'elections' || cat === 'politics') {
    return CanonicalTopic.ELECTIONS;
  }

  // Commodities: Check for commodity-related tags in Economics/Financials
  if (cat === 'financials' || cat === 'economics' || cat === 'economy') {
    const commodityTags = ['oil', 'gold', 'silver', 'commodities', 'energy', 'metals', 'agriculture', 'natural gas', 'crude'];
    for (const tag of commodityTags) {
      if (tagSet.has(tag)) {
        return CanonicalTopic.COMMODITIES;
      }
    }
    // Check if any tag contains commodity-related words
    for (const t of tags) {
      const tLower = t.toLowerCase();
      if (tLower.includes('commodity') || tLower.includes('oil') || tLower.includes('gold') || tLower.includes('metal')) {
        return CanonicalTopic.COMMODITIES;
      }
    }
  }

  // Direct category mappings
  const categoryMap: Record<string, CanonicalTopic> = {
    'economics': CanonicalTopic.MACRO,
    'economy': CanonicalTopic.MACRO,
    'financials': CanonicalTopic.RATES,
    'financial': CanonicalTopic.RATES,
    'sports': CanonicalTopic.SPORTS,
    'entertainment': CanonicalTopic.ENTERTAINMENT,
    'climate': CanonicalTopic.CLIMATE,
    'weather': CanonicalTopic.CLIMATE,
    'politics': CanonicalTopic.ELECTIONS,
    'elections': CanonicalTopic.ELECTIONS,
    'world': CanonicalTopic.GEOPOLITICS,
    'tech': CanonicalTopic.UNKNOWN,
    'technology': CanonicalTopic.UNKNOWN,
  };

  return categoryMap[cat] || CanonicalTopic.UNKNOWN;
}

/**
 * Run Kalshi series topic audit
 */
export async function runKalshiSeriesAudit(
  options: KalshiSeriesAuditOptions = {}
): Promise<void> {
  const { limit = 30 } = options;
  // showMarkets is always true for now - reserved for future use

  console.log('\n=== Kalshi Series Topic Audit (v3.0.8) ===\n');

  const prisma = getClient();

  // Step 1: Get category distribution with market counts
  console.log('[1/3] Fetching series categories...');

  const categoryCounts = await prisma.$queryRaw<Array<{
    category: string | null;
    series_count: bigint;
  }>>`
    SELECT category, COUNT(*)::bigint as series_count
    FROM kalshi_series
    GROUP BY category
    ORDER BY series_count DESC
  `;

  console.log(`  Found ${categoryCounts.length} categories\n`);

  // Step 2: Get market counts per category
  console.log('[2/3] Counting markets per category...');

  const categoryStats: SeriesCategoryStats[] = [];

  for (const row of categoryCounts) {
    const category = row.category;

    // Get series with this category
    const seriesInCategory = await prisma.kalshiSeries.findMany({
      where: { category },
      select: { ticker: true, tags: true },
      take: 100,
    });

    // Count markets with these series tickers
    const tickers = seriesInCategory.map(s => s.ticker);

    // Get all unique tags from series in this category
    const allTags: string[] = [];
    for (const s of seriesInCategory) {
      allTags.push(...s.tags);
    }
    const uniqueTags = [...new Set(allTags)];

    // Count markets (using eventTicker pattern matching)
    let marketCount = 0;
    if (tickers.length > 0) {
      // Use a sample of tickers to estimate
      const sampleTickers = tickers.slice(0, 50);
      for (const ticker of sampleTickers) {
        const count = await prisma.market.count({
          where: {
            venue: 'kalshi',
            metadata: {
              path: ['seriesTicker'],
              equals: ticker,
            },
          },
        });
        marketCount += count;
      }
      // Extrapolate if we sampled
      if (tickers.length > 50) {
        marketCount = Math.round(marketCount * (tickers.length / 50));
      }
    }

    const suggestedTopic = mapCategoryToTopic(category, uniqueTags);

    categoryStats.push({
      category,
      seriesCount: Number(row.series_count),
      marketCount,
      suggestedTopic,
      sampleTickers: tickers.slice(0, 5),
    });
  }

  // Step 3: Print results
  console.log('[3/3] Results:\n');
  console.log('--- Category → Topic Mapping ---\n');
  console.log(
    'Category'.padEnd(20) +
    'Series'.padStart(8) +
    'Markets'.padStart(10) +
    'Suggested Topic'.padStart(18) +
    '  Sample Tickers'
  );
  console.log('-'.repeat(90));

  for (const stat of categoryStats.slice(0, limit)) {
    console.log(
      (stat.category || 'NULL').padEnd(20) +
      String(stat.seriesCount).padStart(8) +
      String(stat.marketCount).padStart(10) +
      stat.suggestedTopic.padStart(18) +
      '  ' + stat.sampleTickers.slice(0, 3).join(', ')
    );
  }

  // Summary
  console.log('\n--- Topic Summary ---\n');

  const topicCounts: Record<string, { series: number; markets: number }> = {};
  for (const stat of categoryStats) {
    const topic = stat.suggestedTopic;
    if (!topicCounts[topic]) {
      topicCounts[topic] = { series: 0, markets: 0 };
    }
    topicCounts[topic].series += stat.seriesCount;
    topicCounts[topic].markets += stat.marketCount;
  }

  console.log('Topic'.padEnd(18) + 'Series'.padStart(10) + 'Markets (est)'.padStart(15));
  console.log('-'.repeat(43));
  for (const [topic, counts] of Object.entries(topicCounts).sort((a, b) => b[1].series - a[1].series)) {
    console.log(
      topic.padEnd(18) +
      String(counts.series).padStart(10) +
      String(counts.markets).padStart(15)
    );
  }

  // Show tags for interesting categories
  console.log('\n--- Tags Analysis (for ELECTIONS/COMMODITIES) ---\n');

  const interestingCategories = ['Elections', 'Politics', 'Financials', 'Economics'];
  for (const targetCat of interestingCategories) {
    const series = await prisma.kalshiSeries.findMany({
      where: { category: { equals: targetCat, mode: 'insensitive' } },
      select: { ticker: true, tags: true, title: true },
      take: 20,
    });

    if (series.length === 0) continue;

    console.log(`\n[${targetCat}] (${series.length} series shown)`);

    // Collect all tags
    const tagCounts: Record<string, number> = {};
    for (const s of series) {
      for (const tag of s.tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }

    const sortedTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);
    console.log('  Top tags: ' + sortedTags.slice(0, 10).map(([t, c]) => `${t}(${c})`).join(', '));

    // Show sample series
    console.log('  Sample series:');
    for (const s of series.slice(0, 5)) {
      console.log(`    ${s.ticker}: ${s.title?.substring(0, 50)}... [${s.tags.join(', ')}]`);
    }
  }

  console.log('\n=== Audit Complete ===\n');
}

/**
 * Kalshi Series Topic Audit Command (v3.0.9)
 *
 * Shows series by category/tags and their topic mappings.
 * v3.0.9: Added --topic filter to show series matching/near-matching a specific topic.
 *
 * Helps identify ELECTIONS/COMMODITIES/CLIMATE opportunities.
 */

import { getClient } from '@data-module/db';
import { CanonicalTopic, classifyKalshiSeries, type KalshiSeriesInfo } from '@data-module/core';

export interface KalshiSeriesAuditOptions {
  /** Limit number of categories to show */
  limit?: number;
  /** Filter by specific topic (shows series that map to this topic) */
  topic?: CanonicalTopic;
  /** Show candidate series (near-matches by title keywords) */
  showCandidates?: boolean;
}

export interface KalshiSeriesAuditResult {
  ok: boolean;
  topic?: CanonicalTopic;
  matchingSeries: Array<{
    ticker: string;
    title: string;
    category: string | null;
    tags: string[];
    classifiedTopic: CanonicalTopic;
  }>;
  candidateSeries: Array<{
    ticker: string;
    title: string;
    category: string | null;
    tags: string[];
    classifiedTopic: CanonicalTopic;
    matchReason: string;
  }>;
  categoryStats: Array<{
    category: string | null;
    seriesCount: number;
    suggestedTopic: CanonicalTopic;
  }>;
}

/**
 * Topic-specific keywords for candidate detection
 */
const TOPIC_KEYWORDS: Record<CanonicalTopic, string[]> = {
  [CanonicalTopic.CLIMATE]: [
    'temperature', 'weather', 'hurricane', 'storm', 'snow', 'rainfall',
    'drought', 'wildfire', 'heat', 'cold', 'flood', 'tornado', 'climate',
    'el nino', 'la nina', 'arctic', 'ice', 'warming',
  ],
  [CanonicalTopic.COMMODITIES]: [
    'oil', 'crude', 'wti', 'brent', 'gold', 'silver', 'copper', 'platinum',
    'natural gas', 'natgas', 'wheat', 'corn', 'soybeans', 'coffee', 'sugar',
    'commodity', 'nymex', 'comex', 'futures', 'barrel', 'ounce',
  ],
  [CanonicalTopic.ELECTIONS]: [
    'election', 'vote', 'president', 'senate', 'congress', 'governor',
    'democratic', 'republican', 'ballot', 'primary', 'caucus', 'nominee',
    'electoral', 'swing state', 'poll', 'approval rating',
  ],
  [CanonicalTopic.CRYPTO_DAILY]: [
    'bitcoin', 'btc', 'ethereum', 'eth', 'solana', 'sol', 'crypto',
    'dogecoin', 'doge', 'xrp', 'ripple',
  ],
  [CanonicalTopic.CRYPTO_INTRADAY]: [
    'bitcoin', 'btc', 'ethereum', 'eth', 'intraday', 'hourly', '15 min',
  ],
  [CanonicalTopic.MACRO]: [
    'cpi', 'gdp', 'inflation', 'unemployment', 'jobs', 'payroll', 'pce',
    'pmi', 'economic', 'recession', 'growth',
  ],
  [CanonicalTopic.RATES]: [
    'fed', 'fomc', 'interest rate', 'rate cut', 'rate hike', 'federal reserve',
    'basis points', 'bps', 'powell', 'central bank',
  ],
  [CanonicalTopic.SPORTS]: [
    'nba', 'nfl', 'mlb', 'nhl', 'soccer', 'football', 'basketball', 'baseball',
    'hockey', 'tennis', 'golf', 'ufc', 'mma', 'olympics', 'world cup',
  ],
  [CanonicalTopic.ENTERTAINMENT]: [
    'movie', 'film', 'oscar', 'grammy', 'emmy', 'award', 'tv', 'show',
    'music', 'album', 'celebrity', 'box office',
  ],
  [CanonicalTopic.GEOPOLITICS]: [
    'war', 'conflict', 'treaty', 'sanctions', 'military', 'nato', 'un',
    'diplomacy', 'foreign', 'international',
  ],
  [CanonicalTopic.FINANCE]: [
    's&p', 'sp500', 'nasdaq', 'dow', 'index', 'indices',
    'forex', 'eur/usd', 'usd/jpy', 'gbp/usd', 'currency',
    'treasury', 'bond', 'yield', 't-bill',
  ],
  [CanonicalTopic.UNKNOWN]: [],
  [CanonicalTopic.UNIVERSAL]: [],  // v3.0.16: Topic-agnostic - no specific keywords
};

/**
 * Map Kalshi category to CanonicalTopic (legacy function for category stats)
 */
function mapCategoryToTopic(category: string | null, tags: string[]): CanonicalTopic {
  if (!category) return CanonicalTopic.UNKNOWN;

  const cat = category.toLowerCase();
  const tagSet = new Set(tags.map(t => t.toLowerCase()));

  // Elections mapping
  if (cat === 'elections' || cat === 'politics') {
    return CanonicalTopic.ELECTIONS;
  }

  // Climate mapping
  if (cat === 'climate' || cat === 'weather') {
    return CanonicalTopic.CLIMATE;
  }

  // Commodities: Check for commodity-related tags in Economics/Financials
  if (cat === 'financials' || cat === 'economics' || cat === 'economy') {
    const commodityTags = ['oil', 'gold', 'silver', 'commodities', 'energy', 'metals', 'agriculture', 'natural gas', 'crude'];
    for (const tag of commodityTags) {
      if (tagSet.has(tag)) {
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
 * Check if title contains keywords for a topic
 */
function titleMatchesTopic(title: string, topic: CanonicalTopic): string | null {
  const keywords = TOPIC_KEYWORDS[topic] || [];
  const titleLower = title.toLowerCase();

  for (const keyword of keywords) {
    if (titleLower.includes(keyword)) {
      return keyword;
    }
  }
  return null;
}

/**
 * Run Kalshi series topic audit
 */
export async function runKalshiSeriesAudit(
  options: KalshiSeriesAuditOptions = {}
): Promise<KalshiSeriesAuditResult> {
  const { limit = 30, topic, showCandidates = true } = options;

  console.log(`\n=== Kalshi Series Topic Audit (v3.0.9) ===\n`);

  if (topic) {
    console.log(`Filter: topic = ${topic}`);
  }
  console.log();

  const prisma = getClient();

  // Load all series
  console.log('[1/4] Loading series cache...');
  const allSeries = await prisma.kalshiSeries.findMany({
    select: {
      ticker: true,
      title: true,
      category: true,
      tags: true,
    },
  });
  console.log(`  Loaded ${allSeries.length} series`);

  // Classify each series
  console.log('[2/4] Classifying series...');

  const matchingSeries: KalshiSeriesAuditResult['matchingSeries'] = [];
  const candidateSeries: KalshiSeriesAuditResult['candidateSeries'] = [];
  const categoryStats: Map<string | null, { count: number; topic: CanonicalTopic }> = new Map();

  for (const series of allSeries) {
    const seriesInfo: KalshiSeriesInfo = {
      ticker: series.ticker,
      title: series.title || '',
      category: series.category || undefined,
      tags: series.tags,
    };

    const classification = classifyKalshiSeries(seriesInfo);
    const classifiedTopic = classification.topic;

    // Update category stats
    const catKey = series.category;
    if (!categoryStats.has(catKey)) {
      categoryStats.set(catKey, { count: 0, topic: mapCategoryToTopic(catKey, series.tags) });
    }
    categoryStats.get(catKey)!.count++;

    // If filtering by topic
    if (topic) {
      // Check if directly classified as target topic
      if (classifiedTopic === topic) {
        matchingSeries.push({
          ticker: series.ticker,
          title: series.title || '',
          category: series.category,
          tags: series.tags,
          classifiedTopic,
        });
      } else if (showCandidates) {
        // Check if title contains topic keywords (candidate)
        const matchedKeyword = titleMatchesTopic(series.title || '', topic);
        if (matchedKeyword) {
          candidateSeries.push({
            ticker: series.ticker,
            title: series.title || '',
            category: series.category,
            tags: series.tags,
            classifiedTopic,
            matchReason: `Title contains "${matchedKeyword}"`,
          });
        }
      }
    }
  }

  // Build category stats array
  const categoryStatsArray = Array.from(categoryStats.entries())
    .map(([category, { count, topic: suggestedTopic }]) => ({
      category,
      seriesCount: count,
      suggestedTopic,
    }))
    .sort((a, b) => b.seriesCount - a.seriesCount);

  // Print results
  if (topic) {
    // Topic-filtered view
    console.log(`[3/4] Series matching ${topic}...\n`);

    console.log(`--- Direct Matches (classified as ${topic}) ---\n`);
    if (matchingSeries.length === 0) {
      console.log('  (none found)');
    } else {
      console.log(`Found ${matchingSeries.length} series:\n`);
      for (const s of matchingSeries.slice(0, limit)) {
        console.log(`  ${s.ticker}`);
        console.log(`    Title: ${s.title.substring(0, 60)}...`);
        console.log(`    Category: ${s.category || 'NULL'}, Tags: [${s.tags.slice(0, 5).join(', ')}]`);
      }
      if (matchingSeries.length > limit) {
        console.log(`  ... and ${matchingSeries.length - limit} more`);
      }
    }

    if (showCandidates) {
      console.log(`\n--- Candidates (title keywords, not classified as ${topic}) ---\n`);
      if (candidateSeries.length === 0) {
        console.log('  (none found)');
      } else {
        console.log(`Found ${candidateSeries.length} candidate series:\n`);
        for (const s of candidateSeries.slice(0, limit)) {
          console.log(`  ${s.ticker} → currently: ${s.classifiedTopic}`);
          console.log(`    Title: ${s.title.substring(0, 60)}...`);
          console.log(`    Reason: ${s.matchReason}`);
          console.log(`    Category: ${s.category || 'NULL'}, Tags: [${s.tags.slice(0, 5).join(', ')}]`);
        }
        if (candidateSeries.length > limit) {
          console.log(`  ... and ${candidateSeries.length - limit} more`);
        }
      }
    }

    // Summary
    console.log('\n[4/4] Summary\n');
    console.log(`Direct matches:  ${matchingSeries.length}`);
    console.log(`Candidates:      ${candidateSeries.length}`);

    if (matchingSeries.length === 0 && candidateSeries.length === 0) {
      console.log(`\nDiagnosis: No series map to ${topic} and no title keyword matches found.`);
      console.log('  → Check if Kalshi has markets in this category');
      console.log('  → May need to add new classification rules');
    } else if (matchingSeries.length === 0 && candidateSeries.length > 0) {
      console.log(`\nDiagnosis: ${candidateSeries.length} series have "${topic}" keywords but aren't classified.`);
      console.log('  → Consider adding category/tag rules for these series');
      console.log('  → Or add title-based fallback classification');
    }
  } else {
    // Full category view (legacy behavior)
    console.log('[3/4] Category → Topic Mapping...\n');
    console.log(
      'Category'.padEnd(20) +
      'Series'.padStart(8) +
      'Suggested Topic'.padStart(18)
    );
    console.log('-'.repeat(50));

    for (const stat of categoryStatsArray.slice(0, limit)) {
      console.log(
        (stat.category || 'NULL').padEnd(20) +
        String(stat.seriesCount).padStart(8) +
        stat.suggestedTopic.padStart(18)
      );
    }

    // Topic summary
    console.log('\n[4/4] Topic Summary\n');

    const topicCounts: Record<string, number> = {};
    for (const stat of categoryStatsArray) {
      const t = stat.suggestedTopic;
      topicCounts[t] = (topicCounts[t] || 0) + stat.seriesCount;
    }

    console.log('Topic'.padEnd(18) + 'Series'.padStart(10));
    console.log('-'.repeat(28));
    for (const [t, count] of Object.entries(topicCounts).sort((a, b) => b[1] - a[1])) {
      console.log(t.padEnd(18) + String(count).padStart(10));
    }

    // Show tags for interesting categories
    console.log('\n--- Tags Analysis ---\n');

    const interestingCategories = ['Climate', 'Weather', 'Financials', 'Economics'];
    for (const targetCat of interestingCategories) {
      const series = await prisma.kalshiSeries.findMany({
        where: { category: { equals: targetCat, mode: 'insensitive' } },
        select: { ticker: true, tags: true, title: true },
        take: 10,
      });

      if (series.length === 0) continue;

      console.log(`[${targetCat}] (${series.length} series shown)`);

      // Collect all tags
      const tagCounts: Record<string, number> = {};
      for (const s of series) {
        for (const tag of s.tags) {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        }
      }

      const sortedTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);
      if (sortedTags.length > 0) {
        console.log('  Top tags: ' + sortedTags.slice(0, 10).map(([t, c]) => `${t}(${c})`).join(', '));
      }

      // Show sample series
      console.log('  Sample series:');
      for (const s of series.slice(0, 3)) {
        console.log(`    ${s.ticker}: ${s.title?.substring(0, 50)}... [${s.tags.join(', ')}]`);
      }
      console.log();
    }
  }

  console.log('\n=== Audit Complete ===\n');

  return {
    ok: true,
    topic,
    matchingSeries,
    candidateSeries,
    categoryStats: categoryStatsArray,
  };
}

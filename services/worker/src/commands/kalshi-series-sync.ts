/**
 * Kalshi Series Sync Command (v3.0.1)
 *
 * Fetches Kalshi series data and stores it in the database.
 * This data is used for metadata-based taxonomy classification.
 */

import { getClient } from '@data-module/db';
import { KalshiAdapter } from '../adapters/kalshi.adapter.js';

export interface KalshiSeriesSyncOptions {
  dryRun?: boolean;
  limit?: number;
}

interface KalshiSeriesData {
  ticker: string;
  title: string;
  category: string;
  tags: string[];
  frequency?: string;
}

/**
 * Map Kalshi series category to canonical topic
 */
export function mapKalshiCategoryToTopic(category: string, tags: string[]): string {
  const cat = category.toLowerCase();
  const tagSet = new Set(tags.map(t => t.toLowerCase()));

  // Crypto
  if (cat === 'crypto' || tagSet.has('bitcoin') || tagSet.has('ethereum') || tagSet.has('crypto')) {
    return 'CRYPTO_DAILY';
  }

  // Economics/Macro
  if (cat === 'economics' || cat === 'economy' || tagSet.has('cpi') || tagSet.has('gdp') ||
      tagSet.has('inflation') || tagSet.has('jobs') || tagSet.has('employment')) {
    return 'MACRO';
  }

  // Financial/Rates
  if (cat === 'financial' || cat === 'financials' || tagSet.has('fed') || tagSet.has('fomc') ||
      tagSet.has('interest rates') || tagSet.has('central bank')) {
    return 'RATES';
  }

  // Politics/Elections
  if (cat === 'politics' || cat === 'elections' || tagSet.has('election') ||
      tagSet.has('president') || tagSet.has('congress') || tagSet.has('senate')) {
    return 'ELECTIONS';
  }

  // Sports
  if (cat === 'sports' || tagSet.has('nba') || tagSet.has('nfl') || tagSet.has('mlb') ||
      tagSet.has('nhl') || tagSet.has('soccer') || tagSet.has('olympics') ||
      tagSet.has('ufc') || tagSet.has('ncaa')) {
    return 'SPORTS';
  }

  // Entertainment
  if (cat === 'entertainment' || tagSet.has('movies') || tagSet.has('tv') ||
      tagSet.has('oscars') || tagSet.has('grammys') || tagSet.has('emmys')) {
    return 'ENTERTAINMENT';
  }

  // Climate/Weather
  if (cat === 'climate' || cat === 'weather' || tagSet.has('hurricane') ||
      tagSet.has('temperature') || tagSet.has('climate')) {
    return 'CLIMATE';
  }

  return 'UNKNOWN';
}

export async function runKalshiSeriesSync(options: KalshiSeriesSyncOptions = {}): Promise<void> {
  const { dryRun = false, limit } = options;

  console.log('\n=== Kalshi Series Sync (v3.0.1) ===\n');
  console.log(`Mode: ${dryRun ? 'DRY-RUN' : 'LIVE'}`);

  const adapter = new KalshiAdapter();
  const client = getClient();

  try {
    // Fetch all series from Kalshi API
    console.log('\nFetching series from Kalshi API...');
    const seriesData = await adapter.getAllSeriesWithCategories();
    console.log(`Fetched ${seriesData.length} series`);

    // Limit if specified
    const seriesToProcess = limit ? seriesData.slice(0, limit) : seriesData;

    // Group by category for stats
    const categoryStats = new Map<string, number>();
    const topicStats = new Map<string, number>();

    const processedSeries: KalshiSeriesData[] = [];

    for (const series of seriesToProcess) {
      const category = series.category || 'unknown';
      categoryStats.set(category, (categoryStats.get(category) || 0) + 1);

      const canonicalTopic = mapKalshiCategoryToTopic(category, series.tags);
      topicStats.set(canonicalTopic, (topicStats.get(canonicalTopic) || 0) + 1);

      processedSeries.push({
        ticker: series.ticker,
        title: series.title,
        category: category,
        tags: series.tags,
      });
    }

    // Print category distribution
    console.log('\n--- Kalshi Series by Category ---');
    const sortedCategories = [...categoryStats.entries()].sort((a, b) => b[1] - a[1]);
    for (const [cat, count] of sortedCategories.slice(0, 20)) {
      console.log(`  ${cat.padEnd(25)} ${count}`);
    }

    console.log('\n--- Mapped to Canonical Topics ---');
    const sortedTopics = [...topicStats.entries()].sort((a, b) => b[1] - a[1]);
    for (const [topic, count] of sortedTopics) {
      console.log(`  ${topic.padEnd(20)} ${count}`);
    }

    if (!dryRun) {
      console.log('\nUpserting series to database...');
      let upserted = 0;

      for (const series of processedSeries) {
        try {
          await client.kalshiSeries.upsert({
            where: { ticker: series.ticker },
            create: {
              ticker: series.ticker,
              title: series.title,
              category: series.category,
              tags: series.tags,
              lastSyncAt: new Date(),
            },
            update: {
              title: series.title,
              category: series.category,
              tags: series.tags,
              lastSyncAt: new Date(),
            },
          });
          upserted++;
        } catch (err) {
          console.error(`Failed to upsert series ${series.ticker}: ${err}`);
        }
      }

      console.log(`Upserted ${upserted} series to database`);
    } else {
      console.log('\nDRY-RUN: Would upsert', processedSeries.length, 'series');
    }

    // Print sample series for each topic
    console.log('\n--- Sample Series by Topic ---');
    const topicSamples = new Map<string, KalshiSeriesData[]>();
    for (const series of processedSeries) {
      const topic = mapKalshiCategoryToTopic(series.category, series.tags);
      if (!topicSamples.has(topic)) {
        topicSamples.set(topic, []);
      }
      const samples = topicSamples.get(topic)!;
      if (samples.length < 3) {
        samples.push(series);
      }
    }

    for (const [topic, samples] of topicSamples) {
      console.log(`\n${topic}:`);
      for (const s of samples) {
        console.log(`  - ${s.ticker}: ${s.title.slice(0, 50)} [${s.category}] tags=${s.tags.join(',')}`);
      }
    }

    console.log('\nDone.');
  } catch (err) {
    console.error('Kalshi series sync error:', err);
    throw err;
  }
}

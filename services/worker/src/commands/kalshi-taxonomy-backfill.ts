/**
 * Kalshi Taxonomy Backfill Command (v3.0.6)
 *
 * Backfills derivedTopic for Kalshi markets using series-based classification.
 * Reads series metadata from KalshiSeries table and applies taxonomy rules.
 *
 * Classification priority:
 * 1. Series ticker pattern matching (highest confidence)
 * 2. Series category + tags from cached KalshiSeries
 * 3. Title keyword analysis (fallback)
 */

import { getClient, type Venue } from '@data-module/db';
import {
  CanonicalTopic,
  classifyKalshiMarket,
  getKalshiSeriesTicker,
  getKalshiEventTicker,
  extractSeriesTickerFromEvent,
} from '@data-module/core';

export interface KalshiTaxonomyBackfillOptions {
  /** Dry run - don't update database */
  dryRun?: boolean;
  /** Limit number of markets to process */
  limit?: number;
  /** Only process markets with NULL derivedTopic */
  onlyNull?: boolean;
  /** Force re-classify even if derivedTopic exists */
  force?: boolean;
  /** Batch size for updates */
  batchSize?: number;
  /** Filter by current derivedTopic (e.g., 'UNKNOWN') */
  currentTopic?: string;
}

export interface KalshiTaxonomyBackfillResult {
  ok: boolean;
  totalProcessed: number;
  totalUpdated: number;
  topicDistribution: Record<string, number>;
  samplesByTopic: Record<string, Array<{ id: number; title: string; seriesTicker: string | null; classified: string }>>;
  errors: string[];
}

/**
 * Classify Kalshi market with series truth from database
 */
async function classifyWithSeriesTruth(
  market: {
    id: number;
    title: string;
    metadata: unknown;
    derivedTopic: string | null;
  },
  seriesCache: Map<string, { category: string | null; tags: string[] }>,
): Promise<{ topic: CanonicalTopic; source: string; seriesTicker: string | null }> {
  const metadata = market.metadata as Record<string, unknown> | null;

  // Extract series ticker
  let seriesTicker = getKalshiSeriesTicker(metadata);
  if (!seriesTicker) {
    const eventTicker = getKalshiEventTicker(metadata);
    if (eventTicker) {
      seriesTicker = extractSeriesTickerFromEvent(eventTicker);
    }
  }

  // Look up series in cache
  let seriesCategory: string | null = null;
  let seriesTags: string[] = [];

  if (seriesTicker && seriesCache.has(seriesTicker)) {
    const series = seriesCache.get(seriesTicker)!;
    seriesCategory = series.category;
    seriesTags = series.tags;
  }

  // Build enriched metadata for classification
  const enrichedMetadata: Record<string, unknown> = {
    ...(metadata || {}),
    // Add series truth data
    seriesCategory,
    seriesTags,
  };

  // Use existing classifyKalshiMarket with enriched metadata
  const result = classifyKalshiMarket(
    market.title,
    seriesCategory, // Pass series category
    enrichedMetadata,
  );

  // Determine source
  let source = 'TITLE';
  if (result.topic !== CanonicalTopic.UNKNOWN) {
    if (seriesTicker && result.confidence >= 0.9) {
      source = 'KALSHI_SERIES_TICKER';
    } else if (seriesCategory) {
      source = 'KALSHI_SERIES_CATEGORY';
    } else if (seriesTags.length > 0) {
      source = 'KALSHI_SERIES_TAGS';
    }
  }

  return {
    topic: result.topic,
    source,
    seriesTicker,
  };
}

/**
 * Run Kalshi taxonomy backfill
 */
export async function runKalshiTaxonomyBackfill(
  options: KalshiTaxonomyBackfillOptions = {},
): Promise<KalshiTaxonomyBackfillResult> {
  const {
    dryRun = false,
    limit,
    onlyNull = true,
    force = false,
    batchSize = 500,
    currentTopic,
  } = options;

  console.log('\n=== Kalshi Taxonomy Backfill (v3.0.6) ===\n');
  console.log(`Mode: ${dryRun ? 'DRY-RUN' : 'LIVE'}`);
  console.log(`Options: onlyNull=${onlyNull}, force=${force}, limit=${limit || 'none'}`);
  if (currentTopic) console.log(`Filter: currentTopic=${currentTopic}`);
  console.log();

  const prisma = getClient();
  const errors: string[] = [];

  // Step 1: Load series cache
  console.log('[1/4] Loading KalshiSeries cache...');
  const allSeries = await prisma.kalshiSeries.findMany({
    select: {
      ticker: true,
      category: true,
      tags: true,
    },
  });

  const seriesCache = new Map<string, { category: string | null; tags: string[] }>();
  for (const s of allSeries) {
    seriesCache.set(s.ticker, { category: s.category, tags: s.tags });
  }
  console.log(`  Loaded ${seriesCache.size} series`);

  // Step 2: Fetch Kalshi markets
  console.log('[2/4] Fetching Kalshi markets...');

  const whereClause: any = {
    venue: 'kalshi' as Venue,
  };

  if (onlyNull && !force) {
    whereClause.derivedTopic = null;
  } else if (currentTopic) {
    whereClause.derivedTopic = currentTopic === 'NULL' ? null : currentTopic;
  }

  const markets = await prisma.market.findMany({
    where: whereClause,
    select: {
      id: true,
      title: true,
      metadata: true,
      derivedTopic: true,
    },
    take: limit,
    orderBy: { id: 'asc' },
  });

  console.log(`  Found ${markets.length} markets to process`);

  // Step 3: Classify markets
  console.log('[3/4] Classifying markets...');

  const topicDistribution: Record<string, number> = {};
  const samplesByTopic: Record<string, Array<{ id: number; title: string; seriesTicker: string | null; classified: string }>> = {};
  const updates: Array<{ id: number; topic: string; source: string }> = [];

  for (const market of markets) {
    const classification = await classifyWithSeriesTruth(market, seriesCache);
    const topic = classification.topic;

    // Track distribution
    topicDistribution[topic] = (topicDistribution[topic] || 0) + 1;

    // Collect samples
    if (!samplesByTopic[topic]) {
      samplesByTopic[topic] = [];
    }
    if (samplesByTopic[topic].length < 5) {
      samplesByTopic[topic].push({
        id: market.id,
        title: market.title.substring(0, 60),
        seriesTicker: classification.seriesTicker,
        classified: topic,
      });
    }

    // Track updates needed
    if (market.derivedTopic !== topic || force) {
      updates.push({
        id: market.id,
        topic,
        source: classification.source,
      });
    }
  }

  // Print distribution
  console.log('\n--- Topic Distribution ---');
  const sortedTopics = Object.entries(topicDistribution).sort((a, b) => b[1] - a[1]);
  for (const [topic, count] of sortedTopics) {
    const pct = ((count / markets.length) * 100).toFixed(1);
    console.log(`  ${topic.padEnd(20)} ${String(count).padStart(8)} (${pct}%)`);
  }

  // Print samples
  console.log('\n--- Samples by Topic ---');
  for (const [topic, samples] of Object.entries(samplesByTopic)) {
    console.log(`\n${topic}:`);
    for (const s of samples) {
      console.log(`  [${s.id}] ${s.title}... (series: ${s.seriesTicker || 'N/A'})`);
    }
  }

  // Step 4: Apply updates
  let totalUpdated = 0;

  if (updates.length === 0) {
    console.log('\n[4/4] No updates needed');
  } else if (dryRun) {
    console.log(`\n[4/4] DRY-RUN: Would update ${updates.length} markets`);
  } else {
    console.log(`\n[4/4] Updating ${updates.length} markets...`);

    // Batch updates
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);

      try {
        await prisma.$transaction(
          batch.map((u) =>
            prisma.market.update({
              where: { id: u.id },
              data: {
                derivedTopic: u.topic,
                taxonomySource: u.source,
              },
            }),
          ),
        );
        totalUpdated += batch.length;

        if ((i + batchSize) % 2000 === 0 || i + batchSize >= updates.length) {
          console.log(`  Updated ${Math.min(i + batchSize, updates.length)} / ${updates.length}`);
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        errors.push(`Batch ${i}-${i + batchSize}: ${errorMsg}`);
        console.error(`  Error in batch ${i}: ${errorMsg}`);
      }
    }

    console.log(`  Total updated: ${totalUpdated}`);
  }

  // Summary
  console.log('\n--- Summary ---');
  console.log(`Total processed: ${markets.length}`);
  console.log(`Total to update: ${updates.length}`);
  console.log(`Actually updated: ${totalUpdated}`);
  console.log(`UNKNOWN rate: ${((topicDistribution['UNKNOWN'] || 0) / markets.length * 100).toFixed(1)}%`);

  if (errors.length > 0) {
    console.log(`\nErrors: ${errors.length}`);
    for (const e of errors.slice(0, 5)) {
      console.log(`  - ${e}`);
    }
  }

  return {
    ok: errors.length === 0,
    totalProcessed: markets.length,
    totalUpdated,
    topicDistribution,
    samplesByTopic,
    errors,
  };
}

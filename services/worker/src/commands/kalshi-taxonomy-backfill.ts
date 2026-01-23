/**
 * Kalshi Taxonomy Backfill Command (v3.0.8)
 *
 * Backfills derivedTopic for Kalshi markets using series-based classification.
 * Reads series metadata from KalshiSeries table and applies taxonomy rules.
 *
 * v3.0.8: Full coverage mode - processes ALL markets without limit by default.
 *         Uses cursor-based pagination for efficient memory usage.
 *         Target: ≤5% NULL derivedTopic after completion.
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
  /** Limit number of markets to process (default: unlimited) */
  limit?: number;
  /** Only process markets with NULL derivedTopic (default: true) */
  onlyNull?: boolean;
  /** Force re-classify even if derivedTopic exists */
  force?: boolean;
  /** Batch size for fetching (default: 10000) */
  fetchBatchSize?: number;
  /** Batch size for updates (default: 500) */
  updateBatchSize?: number;
  /** Filter by current derivedTopic (e.g., 'UNKNOWN') */
  currentTopic?: string;
  /** Filter by eventTicker pattern (e.g., 'KXBTC%' or 'KXCPI%,KXGDP%') */
  tickerPattern?: string;
}

export interface KalshiTaxonomyBackfillResult {
  ok: boolean;
  totalProcessed: number;
  totalUpdated: number;
  totalSkipped: number;
  nullRemaining: number;
  topicDistribution: Record<string, number>;
  samplesByTopic: Record<string, Array<{ id: number; title: string; seriesTicker: string | null; classified: string }>>;
  errors: string[];
}

/**
 * Classify Kalshi market with series truth from database
 */
function classifyWithSeriesTruth(
  market: {
    id: number;
    title: string;
    metadata: unknown;
    derivedTopic: string | null;
  },
  seriesCache: Map<string, { category: string | null; tags: string[] }>,
): { topic: CanonicalTopic; source: string; seriesTicker: string | null } {
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
 * Run Kalshi taxonomy backfill (v3.0.8)
 */
export async function runKalshiTaxonomyBackfill(
  options: KalshiTaxonomyBackfillOptions = {},
): Promise<KalshiTaxonomyBackfillResult> {
  const {
    dryRun = false,
    limit,
    onlyNull = true,
    force = false,
    fetchBatchSize = 10000,
    updateBatchSize = 500,
    currentTopic,
    tickerPattern,
  } = options;

  console.log('\n=== Kalshi Taxonomy Backfill (v3.0.8) ===\n');
  console.log(`Mode: ${dryRun ? 'DRY-RUN' : 'LIVE'}`);
  console.log(`Options: onlyNull=${onlyNull}, force=${force}, limit=${limit || 'unlimited'}`);
  console.log(`Batch sizes: fetch=${fetchBatchSize}, update=${updateBatchSize}`);
  if (currentTopic) console.log(`Filter: currentTopic=${currentTopic}`);
  if (tickerPattern) console.log(`Filter: tickerPattern=${tickerPattern}`);
  console.log();

  const prisma = getClient();
  const errors: string[] = [];

  // Step 1: Load series cache
  console.log('[1/5] Loading KalshiSeries cache...');
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

  // Step 2: Count total markets to process
  console.log('[2/5] Counting markets to process...');

  let totalCount: number;
  if (tickerPattern) {
    const patterns = tickerPattern.split(',').map(p => p.trim());
    const patternConditions = patterns.map(p => `(metadata->>'eventTicker')::text LIKE '${p}'`).join(' OR ');
    let whereConditions = `venue = 'kalshi' AND (${patternConditions})`;
    if (onlyNull && !force) {
      whereConditions += ` AND derived_topic IS NULL`;
    } else if (currentTopic) {
      whereConditions += currentTopic === 'NULL'
        ? ` AND derived_topic IS NULL`
        : ` AND derived_topic = '${currentTopic}'`;
    }
    const countResult = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
      `SELECT COUNT(*)::bigint as count FROM markets WHERE ${whereConditions}`
    );
    totalCount = Number(countResult[0].count);
  } else {
    const whereClause: any = {
      venue: 'kalshi' as Venue,
    };
    if (onlyNull && !force) {
      whereClause.derivedTopic = null;
    } else if (currentTopic) {
      whereClause.derivedTopic = currentTopic === 'NULL' ? null : currentTopic;
    }
    totalCount = await prisma.market.count({ where: whereClause });
  }

  const marketsToProcess = limit ? Math.min(totalCount, limit) : totalCount;
  console.log(`  Found ${totalCount} markets, will process ${marketsToProcess}`);

  // Step 3: Process markets in batches
  console.log('[3/5] Processing markets...\n');

  const topicDistribution: Record<string, number> = {};
  const samplesByTopic: Record<string, Array<{ id: number; title: string; seriesTicker: string | null; classified: string }>> = {};
  const updates: Array<{ id: number; topic: string; source: string }> = [];

  let processedCount = 0;
  let skippedCount = 0;
  let lastId = 0;

  while (processedCount < marketsToProcess) {
    const batchLimit = Math.min(fetchBatchSize, marketsToProcess - processedCount);

    let markets: Array<{
      id: number;
      title: string;
      metadata: unknown;
      derivedTopic: string | null;
    }>;

    if (tickerPattern) {
      const patterns = tickerPattern.split(',').map(p => p.trim());
      const patternConditions = patterns.map(p => `(metadata->>'eventTicker')::text LIKE '${p}'`).join(' OR ');
      let whereConditions = `venue = 'kalshi' AND (${patternConditions}) AND id > ${lastId}`;
      if (onlyNull && !force) {
        whereConditions += ` AND derived_topic IS NULL`;
      } else if (currentTopic) {
        whereConditions += currentTopic === 'NULL'
          ? ` AND derived_topic IS NULL`
          : ` AND derived_topic = '${currentTopic}'`;
      }

      markets = await prisma.$queryRawUnsafe(`
        SELECT id, title, metadata, derived_topic as "derivedTopic"
        FROM markets
        WHERE ${whereConditions}
        ORDER BY id ASC
        LIMIT ${batchLimit}
      `);
    } else {
      const whereClause: any = {
        venue: 'kalshi' as Venue,
        id: { gt: lastId },
      };
      if (onlyNull && !force) {
        whereClause.derivedTopic = null;
      } else if (currentTopic) {
        whereClause.derivedTopic = currentTopic === 'NULL' ? null : currentTopic;
      }

      markets = await prisma.market.findMany({
        where: whereClause,
        select: {
          id: true,
          title: true,
          metadata: true,
          derivedTopic: true,
        },
        take: batchLimit,
        orderBy: { id: 'asc' },
      });
    }

    if (markets.length === 0) break;

    // Update lastId for cursor
    lastId = markets[markets.length - 1].id;

    // Classify each market
    for (const market of markets) {
      const classification = classifyWithSeriesTruth(market, seriesCache);
      const topic = classification.topic;

      // Track distribution
      topicDistribution[topic] = (topicDistribution[topic] || 0) + 1;

      // Collect samples (max 5 per topic)
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
      } else {
        skippedCount++;
      }

      processedCount++;
    }

    // Progress report
    const pct = ((processedCount / marketsToProcess) * 100).toFixed(1);
    const unknownPct = ((topicDistribution['UNKNOWN'] || 0) / processedCount * 100).toFixed(1);
    process.stdout.write(`\r  Processed: ${processedCount}/${marketsToProcess} (${pct}%) | UNKNOWN: ${unknownPct}% | Updates queued: ${updates.length}`);
  }
  console.log('\n');

  // Print distribution
  console.log('--- Topic Distribution ---');
  const sortedTopics = Object.entries(topicDistribution).sort((a, b) => b[1] - a[1]);
  for (const [topic, count] of sortedTopics) {
    const pct = ((count / processedCount) * 100).toFixed(1);
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
    console.log('\n[4/5] No updates needed');
  } else if (dryRun) {
    console.log(`\n[4/5] DRY-RUN: Would update ${updates.length} markets`);
  } else {
    console.log(`\n[4/5] Updating ${updates.length} markets...`);

    // Batch updates with retry
    for (let i = 0; i < updates.length; i += updateBatchSize) {
      const batch = updates.slice(i, i + updateBatchSize);

      let retries = 3;
      while (retries > 0) {
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

          // Progress report every 5000
          if ((i + updateBatchSize) % 5000 < updateBatchSize || i + updateBatchSize >= updates.length) {
            const pct = ((Math.min(i + updateBatchSize, updates.length) / updates.length) * 100).toFixed(1);
            console.log(`  Updated: ${Math.min(i + updateBatchSize, updates.length)}/${updates.length} (${pct}%)`);
          }
          break; // Success, exit retry loop
        } catch (err) {
          retries--;
          const errorMsg = err instanceof Error ? err.message : String(err);
          if (retries === 0) {
            errors.push(`Batch ${i}-${i + updateBatchSize}: ${errorMsg}`);
            console.error(`  Error in batch ${i} (no retries left): ${errorMsg}`);
          } else {
            console.warn(`  Batch ${i} failed, retrying (${retries} left)...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }
    }

    console.log(`  Total updated: ${totalUpdated}`);
  }

  // Step 5: Get NULL remaining count
  console.log('\n[5/5] Checking NULL derivedTopic remaining...');
  const nullRemaining = await prisma.market.count({
    where: {
      venue: 'kalshi',
      derivedTopic: null,
    },
  });
  const totalKalshi = await prisma.market.count({
    where: { venue: 'kalshi' },
  });
  const nullPct = ((nullRemaining / totalKalshi) * 100).toFixed(1);
  const coveragePct = (100 - parseFloat(nullPct)).toFixed(1);

  // Summary
  console.log('\n========== Summary ==========');
  console.log(`Total Kalshi markets:  ${totalKalshi}`);
  console.log(`Processed:             ${processedCount}`);
  console.log(`Updates queued:        ${updates.length}`);
  console.log(`Actually updated:      ${totalUpdated}`);
  console.log(`Skipped (unchanged):   ${skippedCount}`);
  console.log(`NULL remaining:        ${nullRemaining} (${nullPct}%)`);
  console.log(`Coverage:              ${coveragePct}%`);
  console.log(`UNKNOWN rate:          ${((topicDistribution['UNKNOWN'] || 0) / processedCount * 100).toFixed(1)}%`);

  // Coverage status
  if (parseFloat(nullPct) <= 5) {
    console.log(`\n✓ SUCCESS: Coverage target (≥95%) achieved!`);
  } else {
    console.log(`\n✗ WARNING: Coverage ${coveragePct}% is below 95% target`);
  }

  if (errors.length > 0) {
    console.log(`\nErrors: ${errors.length}`);
    for (const e of errors.slice(0, 5)) {
      console.log(`  - ${e}`);
    }
  }

  if (dryRun) {
    console.log('\n[DRY-RUN] Run without --dry-run to apply changes');
  }

  return {
    ok: errors.length === 0,
    totalProcessed: processedCount,
    totalUpdated,
    totalSkipped: skippedCount,
    nullRemaining,
    topicDistribution,
    samplesByTopic,
    errors,
  };
}

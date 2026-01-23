/**
 * Polymarket Taxonomy Backfill Command (v3.0.7)
 *
 * Two modes:
 * 1. API mode (legacy v3.0.2): Fetches from Gamma API to populate pmCategories/pmTags
 * 2. Classify mode (v3.0.7): DB-only - runs classifyPolymarketMarketV3 on existing data
 *
 * The classify mode uses existing DB fields (pmEventTagSlugs, pmCategories, pmTags, title)
 * to derive topic and update derivedTopic + taxonomySource.
 */

import { getClient, Prisma, type Venue } from '@data-module/db';
import {
  withRetry,
  HttpError,
  parseRetryAfter,
  classifyPolymarketMarketV3,
  type PolymarketMarketInfoV3,
} from '@data-module/core';

export interface PolymarketTaxonomyBackfillOptions {
  lookbackHours?: number;
  dbLimit?: number;
  apply?: boolean;
  batchSize?: number;
  /** v3.0.7: Classify mode - run classification on existing DB data without API calls */
  classify?: boolean;
  /** Only process markets with NULL derivedTopic */
  onlyNull?: boolean;
  /** Force re-classify even if derivedTopic exists */
  force?: boolean;
  /** Filter by current derivedTopic (e.g., 'UNKNOWN') */
  currentTopic?: string;
}

export interface PolymarketTaxonomyBackfillResult {
  totalMarkets: number;
  marketsWithCategories: number;
  marketsWithTags: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  samples: Array<{
    id: number;
    externalId: string;
    title: string;
    categories: string[];
    tags: string[];
  }>;
  /** v3.0.7: Topic distribution (for classify mode) */
  topicDistribution?: Record<string, number>;
  /** v3.0.7: Sample markets by topic (for classify mode) */
  samplesByTopic?: Record<string, Array<{ id: number; title: string; source: string }>>;
}

const GAMMA_API_BASE = 'https://gamma-api.polymarket.com';

interface GammaCategory {
  id?: string;
  label?: string;
  slug?: string;
  parentCategory?: string;
}

interface GammaTag {
  id?: string;
  label?: string;
  slug?: string;
}

interface GammaMarketFull {
  id: number;
  question: string;
  categories?: GammaCategory[] | string;
  tags?: GammaTag[] | string;
  groupItemTitle?: string;
  // Event-level fields (when fetching via events endpoint)
  eventCategory?: string;
  eventSubcategory?: string;
}

/**
 * Parse JSON string or return array as-is
 */
function parseJsonArray<T>(value: T[] | string | undefined | null): T[] {
  if (!value) return [];
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return [];
    }
  }
  return value;
}

/**
 * Fetch market details from Gamma API
 */
async function fetchMarketFromGamma(marketId: string): Promise<GammaMarketFull | null> {
  const url = `${GAMMA_API_BASE}/markets/${marketId}`;

  try {
    const response = await withRetry(
      async () => {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) {
          const retryAfterMs = parseRetryAfter(res.headers.get('Retry-After'));
          throw new HttpError(
            `Gamma API error: ${res.status}`,
            res.status,
            retryAfterMs ? retryAfterMs / 1000 : undefined
          );
        }
        return res.json() as Promise<GammaMarketFull>;
      },
      {
        maxAttempts: 3,
        baseDelayMs: 500,
      }
    );
    return response;
  } catch (err) {
    console.error(`  Failed to fetch market ${marketId}: ${err}`);
    return null;
  }
}

/**
 * Batch fetch markets from Gamma API using the markets list endpoint
 * This is more efficient than individual fetches
 */
async function fetchMarketsFromGamma(marketIds: string[]): Promise<Map<string, GammaMarketFull>> {
  const results = new Map<string, GammaMarketFull>();

  // Gamma API doesn't support batch by ID, so we fetch individually
  // but with rate limiting
  for (let i = 0; i < marketIds.length; i++) {
    const marketId = marketIds[i];
    const market = await fetchMarketFromGamma(marketId);
    if (market) {
      results.set(String(market.id), market);
    }

    // Rate limit: pause every 10 requests
    if ((i + 1) % 10 === 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return results;
}

/**
 * v3.0.7: DB-only classification mode
 * Runs classifyPolymarketMarketV3 on existing DB data to populate derivedTopic
 */
async function runClassifyMode(
  options: PolymarketTaxonomyBackfillOptions
): Promise<PolymarketTaxonomyBackfillResult> {
  const {
    dbLimit = 50000,
    apply = false,
    batchSize = 500,
    onlyNull = true,
    force = false,
    currentTopic,
  } = options;

  console.log('\n=== Polymarket Taxonomy Backfill (v3.0.7) - CLASSIFY MODE ===\n');
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`Options: onlyNull=${onlyNull}, force=${force}, limit=${dbLimit || 'none'}`);
  if (currentTopic) console.log(`Filter: currentTopic=${currentTopic}`);
  console.log();

  const prisma = getClient();
  const errors: string[] = [];

  // Step 1: Fetch Polymarket markets
  console.log('[1/3] Fetching Polymarket markets...');

  const whereClause: any = {
    venue: 'polymarket' as Venue,
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
      pmEventTagSlugs: true,
      pmCategories: true,
      pmTags: true,
      pmEventTitle: true,
      pmEventSlug: true,
      derivedTopic: true,
    },
    take: dbLimit,
    orderBy: { id: 'asc' },
  });

  console.log(`  Found ${markets.length} markets to process`);

  // Step 2: Classify markets
  console.log('[2/3] Classifying markets...');

  const topicDistribution: Record<string, number> = {};
  const samplesByTopic: Record<string, Array<{ id: number; title: string; source: string }>> = {};
  const updates: Array<{ id: number; topic: string; source: string }> = [];

  for (const market of markets) {
    // Build PolymarketMarketInfoV3 from DB fields
    const marketInfo: PolymarketMarketInfoV3 = {
      title: market.title,
      // Convert pmEventTagSlugs (string[]) to eventTags format
      eventTags: market.pmEventTagSlugs?.map(slug => ({
        slug,
        label: slug.replace(/-/g, ' '),
      })),
      // Parse pmCategories from JSON
      pmCategories: Array.isArray(market.pmCategories)
        ? market.pmCategories as Array<{ slug: string; label: string }>
        : undefined,
      // Parse pmTags from JSON
      pmTags: Array.isArray(market.pmTags)
        ? market.pmTags as Array<{ slug: string; label: string }>
        : undefined,
    };

    const classification = classifyPolymarketMarketV3(marketInfo);
    const topic = classification.topic;
    const source = classification.taxonomySource;

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
        source,
      });
    }

    // Track updates needed
    if (market.derivedTopic !== topic || force) {
      updates.push({
        id: market.id,
        topic,
        source,
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
      console.log(`  [${s.id}] ${s.title}... (source: ${s.source})`);
    }
  }

  // Step 3: Apply updates
  let totalUpdated = 0;

  if (updates.length === 0) {
    console.log('\n[3/3] No updates needed');
  } else if (!apply) {
    console.log(`\n[3/3] DRY-RUN: Would update ${updates.length} markets`);
  } else {
    console.log(`\n[3/3] Updating ${updates.length} markets...`);

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

  if (!apply) {
    console.log('\n[DRY-RUN] Add --apply to actually update the database');
  }

  console.log('\nDone.');

  return {
    totalMarkets: markets.length,
    marketsWithCategories: 0,
    marketsWithTags: 0,
    updatedCount: totalUpdated,
    skippedCount: 0,
    errorCount: errors.length,
    samples: [],
    topicDistribution,
    samplesByTopic,
  };
}

export async function runPolymarketTaxonomyBackfill(
  options: PolymarketTaxonomyBackfillOptions = {}
): Promise<PolymarketTaxonomyBackfillResult> {
  // v3.0.7: If classify mode, use DB-only classification
  if (options.classify) {
    return runClassifyMode(options);
  }

  // Legacy v3.0.2 mode: Fetch from Gamma API
  const {
    lookbackHours = 720,
    dbLimit = 5000,
    apply = false,
    batchSize = 100,
  } = options;

  console.log(`\n=== Polymarket Taxonomy Backfill (v3.0.2) - API MODE ===\n`);
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`Lookback: ${lookbackHours}h`);
  console.log(`DB limit: ${dbLimit}`);
  console.log(`Batch size: ${batchSize}\n`);

  const client = getClient();
  const lookbackCutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

  // Fetch Polymarket markets that need taxonomy update
  console.log('Fetching markets from database...');
  const markets = await client.market.findMany({
    where: {
      venue: 'polymarket',
      status: { in: ['active', 'closed'] },
      closeTime: { gte: lookbackCutoff },
      // Only markets without taxonomy data
      pmCategories: { equals: Prisma.DbNull },
      pmTags: { equals: Prisma.DbNull },
    },
    select: {
      id: true,
      externalId: true,
      title: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: dbLimit,
  });

  console.log(`Found ${markets.length} markets needing taxonomy backfill\n`);

  const result: PolymarketTaxonomyBackfillResult = {
    totalMarkets: markets.length,
    marketsWithCategories: 0,
    marketsWithTags: 0,
    updatedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    samples: [],
  };

  // Process in batches
  for (let i = 0; i < markets.length; i += batchSize) {
    const batch = markets.slice(i, i + batchSize);
    console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(markets.length / batchSize)} (${batch.length} markets)...`);

    // Fetch from Gamma API
    const gammaData = await fetchMarketsFromGamma(batch.map(m => m.externalId));

    for (const market of batch) {
      const gammaMarket = gammaData.get(market.externalId);

      if (!gammaMarket) {
        result.skippedCount++;
        continue;
      }

      // Parse categories and tags
      const categories = parseJsonArray<GammaCategory>(gammaMarket.categories);
      const tags = parseJsonArray<GammaTag>(gammaMarket.tags);

      const pmCategories = categories
        .map(c => ({ slug: c.slug || '', label: c.label || '' }))
        .filter(c => c.slug || c.label);

      const pmTags = tags
        .map(t => ({ slug: t.slug || '', label: t.label || '' }))
        .filter(t => t.slug || t.label);

      if (pmCategories.length > 0) result.marketsWithCategories++;
      if (pmTags.length > 0) result.marketsWithTags++;

      // Collect samples
      if (result.samples.length < 20 && (pmCategories.length > 0 || pmTags.length > 0)) {
        result.samples.push({
          id: market.id,
          externalId: market.externalId,
          title: market.title.slice(0, 60),
          categories: pmCategories.map(c => c.slug || c.label),
          tags: pmTags.map(t => t.slug || t.label),
        });
      }

      if (apply) {
        try {
          await client.market.update({
            where: { id: market.id },
            data: {
              pmCategories: pmCategories.length > 0 ? pmCategories : Prisma.DbNull,
              pmTags: pmTags.length > 0 ? pmTags : Prisma.DbNull,
              taxonomySource: pmCategories.length > 0 ? 'PM_CATEGORIES' :
                              pmTags.length > 0 ? 'PM_TAGS' : null,
            },
          });
          result.updatedCount++;
        } catch (err) {
          console.error(`  Failed to update market ${market.id}: ${err}`);
          result.errorCount++;
        }
      } else {
        result.updatedCount++;
      }
    }

    // Rate limit between batches
    if (i + batchSize < markets.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // Print summary
  console.log('\n--- Summary ---');
  console.log(`Total markets: ${result.totalMarkets}`);
  console.log(`Markets with categories: ${result.marketsWithCategories}`);
  console.log(`Markets with tags: ${result.marketsWithTags}`);
  console.log(`Updated: ${result.updatedCount}`);
  console.log(`Skipped (not found in API): ${result.skippedCount}`);
  console.log(`Errors: ${result.errorCount}`);

  if (result.samples.length > 0) {
    console.log('\n--- Samples with Taxonomy ---');
    for (const sample of result.samples.slice(0, 10)) {
      console.log(`  [${sample.id}] ${sample.title}`);
      console.log(`    Categories: ${sample.categories.join(', ') || '(none)'}`);
      console.log(`    Tags: ${sample.tags.join(', ') || '(none)'}`);
    }
  }

  if (!apply) {
    console.log('\n[DRY-RUN] Add --apply to actually update the database');
  }

  console.log('\nDone.');
  return result;
}

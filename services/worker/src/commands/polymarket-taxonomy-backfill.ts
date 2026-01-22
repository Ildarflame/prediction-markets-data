/**
 * Polymarket Taxonomy Backfill Command (v3.0.2)
 *
 * Fetches Polymarket market data from Gamma API and populates
 * the taxonomy fields (pmCategories, pmTags, pmEventCategory, pmEventSubcategory)
 * for existing markets in the database.
 */

import { getClient, Prisma } from '@data-module/db';
import { withRetry, HttpError, parseRetryAfter } from '@data-module/core';

export interface PolymarketTaxonomyBackfillOptions {
  lookbackHours?: number;
  dbLimit?: number;
  apply?: boolean;
  batchSize?: number;
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

export async function runPolymarketTaxonomyBackfill(
  options: PolymarketTaxonomyBackfillOptions = {}
): Promise<PolymarketTaxonomyBackfillResult> {
  const {
    lookbackHours = 720,
    dbLimit = 5000,
    apply = false,
    batchSize = 100,
  } = options;

  console.log(`\n=== Polymarket Taxonomy Backfill (v3.0.2) ===\n`);
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

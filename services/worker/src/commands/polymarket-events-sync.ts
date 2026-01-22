/**
 * Polymarket Events Sync Command (v3.0.4)
 *
 * Fetches Polymarket events from Gamma API and persists:
 * - Event metadata (tags, series, category)
 * - Links markets to their events (pmEventId)
 * - Caches event data in markets table for efficient taxonomy
 *
 * Supports:
 * - Full sync (--full): Fetches ALL events with pagination
 * - Incremental sync (--since): Only events updated after timestamp
 * - Coverage report (polymarket:events:coverage): Show linking stats
 */

import { getClient, Prisma } from '@data-module/db';
import { withRetry, HttpError, parseRetryAfter } from '@data-module/core';

export interface PolymarketEventsSyncOptions {
  /** Max events to fetch (default: unlimited in full mode) */
  maxEvents?: number;
  /** Only active events (default: false for full sync) */
  activeOnly?: boolean;
  /** Apply changes to DB (default: false for dry-run) */
  apply?: boolean;
  /** Link markets to events (default: true) */
  linkMarkets?: boolean;
  /** Cache event data in markets table (default: true) */
  cacheEventData?: boolean;
  /** Full sync mode - fetch all events */
  full?: boolean;
  /** Incremental since timestamp */
  since?: Date;
}

export interface PolymarketEventsSyncResult {
  totalEvents: number;
  newEvents: number;
  updatedEvents: number;
  marketsLinked: number;
  marketsCached: number;
  tagDistribution: Record<string, number>;
  errors: string[];
  durationMs: number;
}

const GAMMA_API_BASE = 'https://gamma-api.polymarket.com';

interface GammaTag {
  id: string;
  label: string;
  slug: string;
}

interface GammaSeries {
  id: string;
  ticker: string;
  slug: string;
  title: string;
}

interface GammaMarket {
  id: string;
  question: string;
  slug: string;
}

interface GammaEvent {
  id: string;
  ticker: string;
  slug: string;
  title: string;
  category?: string;
  tags?: GammaTag[];
  series?: GammaSeries[];
  markets?: GammaMarket[];
  active: boolean;
  closed: boolean;
  volume?: number;
  liquidity?: number;
  updatedAt?: string;
}

interface GammaSportConfig {
  sport: string;
  series: string;
  tags: string;
}

/**
 * Fetch events from Gamma API with pagination
 */
async function fetchEventsFromGamma(options: {
  limit: number;
  offset: number;
  activeOnly: boolean;
}): Promise<GammaEvent[]> {
  const { limit, offset, activeOnly } = options;
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });

  if (activeOnly) {
    params.set('active', 'true');
    params.set('closed', 'false');
  }

  const url = `${GAMMA_API_BASE}/events?${params}`;

  const response = await withRetry(
    async () => {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) {
        const retryAfterMs = parseRetryAfter(res.headers.get('Retry-After'));
        throw new HttpError(
          `Gamma API error: ${res.status}`,
          res.status,
          retryAfterMs ? retryAfterMs / 1000 : undefined
        );
      }
      return res.json() as Promise<GammaEvent[]>;
    },
    {
      maxAttempts: 3,
      baseDelayMs: 1000,
    }
  );

  return response;
}

/**
 * Fetch sports configuration from Gamma API
 */
async function fetchSportsFromGamma(): Promise<GammaSportConfig[]> {
  const url = `${GAMMA_API_BASE}/sports`;

  const response = await withRetry(
    async () => {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        throw new HttpError(`Gamma API error: ${res.status}`, res.status);
      }
      return res.json() as Promise<GammaSportConfig[]>;
    },
    {
      maxAttempts: 3,
      baseDelayMs: 500,
    }
  );

  return response;
}

/**
 * Save sync state checkpoint
 */
async function saveSyncState(
  client: ReturnType<typeof getClient>,
  stats: { totalEvents: number; marketsLinked: number; errors: number }
): Promise<void> {
  await client.ingestionState.upsert({
    where: {
      venue_jobName: {
        venue: 'polymarket',
        jobName: 'events_sync',
      },
    },
    create: {
      venue: 'polymarket',
      jobName: 'events_sync',
      lastSuccessAt: new Date(),
      statsJson: stats as unknown as Prisma.InputJsonValue,
    },
    update: {
      lastSuccessAt: new Date(),
      statsJson: stats as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function runPolymarketEventsSync(
  options: PolymarketEventsSyncOptions = {}
): Promise<PolymarketEventsSyncResult> {
  const {
    maxEvents,
    activeOnly = false,
    apply = false,
    linkMarkets = true,
    cacheEventData = true,
    full = false,
  } = options;

  const startTime = Date.now();
  console.log(`\n=== Polymarket Events Sync (v3.0.4) ===\n`);
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`Sync type: ${full ? 'FULL' : maxEvents ? `LIMITED (${maxEvents})` : 'DEFAULT (2000)'}`);
  console.log(`Active only: ${activeOnly}`);
  console.log(`Link markets: ${linkMarkets}`);
  console.log(`Cache event data: ${cacheEventData}\n`);

  const client = getClient();
  const result: PolymarketEventsSyncResult = {
    totalEvents: 0,
    newEvents: 0,
    updatedEvents: 0,
    marketsLinked: 0,
    marketsCached: 0,
    tagDistribution: {},
    errors: [],
    durationMs: 0,
  };

  // Fetch sports config first
  console.log('Fetching sports configuration...');
  let sportsConfig: GammaSportConfig[] = [];
  try {
    sportsConfig = await fetchSportsFromGamma();
    console.log(`Loaded ${sportsConfig.length} sports configurations\n`);

    if (apply) {
      for (const sc of sportsConfig) {
        const seriesIds = sc.series ? sc.series.split(',').filter(Boolean) : [];
        const tagIds = sc.tags ? sc.tags.split(',').filter(Boolean) : [];

        await client.polymarketSport.upsert({
          where: { sport: sc.sport },
          create: {
            sport: sc.sport,
            seriesIds,
            tagIds,
          },
          update: {
            seriesIds,
            tagIds,
          },
        });
      }
      console.log(`Synced ${sportsConfig.length} sports to DB\n`);
    }
  } catch (err) {
    console.error(`Failed to fetch sports: ${err}`);
    result.errors.push(`Sports fetch failed: ${err}`);
  }

  // Determine limit
  const effectiveLimit = full ? Infinity : (maxEvents ?? 2000);
  const batchSize = 100;

  // Fetch events with pagination
  console.log('Fetching events from Gamma API...');
  let allEvents: GammaEvent[] = [];
  let offset = 0;
  let consecutiveEmpty = 0;

  while (allEvents.length < effectiveLimit) {
    const remaining = Math.min(batchSize, effectiveLimit - allEvents.length);

    const batch = await fetchEventsFromGamma({
      limit: remaining,
      offset,
      activeOnly,
    });

    if (batch.length === 0) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= 2) break; // Stop after 2 empty responses
    } else {
      consecutiveEmpty = 0;
      allEvents = allEvents.concat(batch);
    }

    offset += batchSize;

    if (allEvents.length % 500 === 0 || batch.length === 0) {
      console.log(`  Fetched ${allEvents.length} events (offset ${offset})...`);
    }

    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log(`\nTotal events fetched: ${allEvents.length}\n`);
  result.totalEvents = allEvents.length;

  // Build event data map for caching
  const eventDataMap = new Map<string, {
    title: string;
    slug: string;
    tagSlugs: string[];
    marketIds: string[];
  }>();

  // Process events
  console.log('Processing events...');
  for (const event of allEvents) {
    const tags = event.tags || [];

    // Count tags
    for (const tag of tags) {
      result.tagDistribution[tag.slug] = (result.tagDistribution[tag.slug] || 0) + 1;
    }

    // Collect market IDs
    const marketIds = (event.markets || []).map(m => String(m.id));

    // Store for caching
    eventDataMap.set(event.id, {
      title: event.title,
      slug: event.slug,
      tagSlugs: tags.map(t => t.slug),
      marketIds,
    });

    // Get series info
    const series = event.series && event.series.length > 0 ? event.series[0] : null;

    if (apply) {
      try {
        const existing = await client.polymarketEvent.findUnique({
          where: { externalId: event.id },
        });

        if (existing) {
          await client.polymarketEvent.update({
            where: { externalId: event.id },
            data: {
              slug: event.slug,
              title: event.title,
              category: event.category || null,
              tags: tags.length > 0 ? (tags as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
              seriesId: series?.id || null,
              seriesSlug: series?.slug || null,
              active: event.active,
              closed: event.closed,
              volume: event.volume || null,
              liquidity: event.liquidity || null,
              marketCount: marketIds.length,
              lastSyncAt: new Date(),
            },
          });
          result.updatedEvents++;
        } else {
          await client.polymarketEvent.create({
            data: {
              externalId: event.id,
              slug: event.slug,
              title: event.title,
              category: event.category || null,
              tags: tags.length > 0 ? (tags as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
              seriesId: series?.id || null,
              seriesSlug: series?.slug || null,
              active: event.active,
              closed: event.closed,
              volume: event.volume || null,
              liquidity: event.liquidity || null,
              marketCount: marketIds.length,
              lastSyncAt: new Date(),
            },
          });
          result.newEvents++;
        }
      } catch (err) {
        result.errors.push(`Event ${event.id}: ${err}`);
      }
    } else {
      // Dry run - just count
      result.newEvents++;
    }
  }

  // Link markets to events and cache event data
  if (apply && (linkMarkets || cacheEventData)) {
    console.log('\nLinking markets to events and caching data...');
    let linked = 0;
    let cached = 0;

    for (const [eventId, eventData] of eventDataMap) {
      for (const marketId of eventData.marketIds) {
        try {
          const updateData: Prisma.MarketUpdateManyMutationInput = {};

          if (linkMarkets) {
            updateData.pmEventId = eventId;
          }

          if (cacheEventData) {
            updateData.pmEventTitle = eventData.title;
            updateData.pmEventSlug = eventData.slug;
            updateData.pmEventTagSlugs = eventData.tagSlugs;
          }

          const updated = await client.market.updateMany({
            where: {
              venue: 'polymarket',
              externalId: marketId,
            },
            data: updateData,
          });

          if (updated.count > 0) {
            if (linkMarkets) linked += updated.count;
            if (cacheEventData) cached += updated.count;
          }
        } catch (err) {
          // Ignore - market might not exist in our DB
        }
      }
    }

    result.marketsLinked = linked;
    result.marketsCached = cached;
    console.log(`Linked ${linked} markets to events`);
    console.log(`Cached event data for ${cached} markets`);

    // Save sync state
    await saveSyncState(client, {
      totalEvents: result.totalEvents,
      marketsLinked: result.marketsLinked,
      errors: result.errors.length,
    });
  }

  result.durationMs = Date.now() - startTime;

  // Print summary
  console.log('\n--- Summary ---');
  console.log(`Total events: ${result.totalEvents}`);
  console.log(`New events: ${result.newEvents}`);
  console.log(`Updated events: ${result.updatedEvents}`);
  console.log(`Markets linked: ${result.marketsLinked}`);
  console.log(`Markets cached: ${result.marketsCached}`);
  console.log(`Errors: ${result.errors.length}`);
  console.log(`Duration: ${(result.durationMs / 1000).toFixed(1)}s`);

  // Top tags
  const sortedTags = Object.entries(result.tagDistribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  console.log('\n--- Top Tags ---');
  for (const [tag, count] of sortedTags) {
    console.log(`  ${tag.padEnd(30)} ${count}`);
  }

  if (!apply) {
    console.log('\n[DRY-RUN] Add --apply to persist changes');
  }

  console.log('\nDone.');
  return result;
}

/**
 * Coverage report for Polymarket events linkage
 */
export interface PolymarketEventsCoverageResult {
  totalMarkets: number;
  linkedMarkets: number;
  unlinkedMarkets: number;
  coveragePercent: number;
  totalEvents: number;
  eventsWithMarkets: number;
  sampleUnlinked: Array<{ id: number; externalId: string; title: string }>;
}

export async function runPolymarketEventsCoverage(): Promise<PolymarketEventsCoverageResult> {
  console.log('\n=== Polymarket Events Coverage (v3.0.4) ===\n');

  const client = getClient();

  // Count markets
  const totalMarkets = await client.market.count({
    where: { venue: 'polymarket' },
  });

  const linkedMarkets = await client.market.count({
    where: {
      venue: 'polymarket',
      pmEventId: { not: null },
    },
  });

  const unlinkedMarkets = totalMarkets - linkedMarkets;
  const coveragePercent = totalMarkets > 0 ? (linkedMarkets / totalMarkets) * 100 : 0;

  // Count events
  const totalEvents = await client.polymarketEvent.count();

  const eventsWithMarkets = await client.polymarketEvent.count({
    where: { marketCount: { gt: 0 } },
  });

  // Sample unlinked markets
  const sampleUnlinked = await client.market.findMany({
    where: {
      venue: 'polymarket',
      pmEventId: null,
      status: 'active',
    },
    select: {
      id: true,
      externalId: true,
      title: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  const result: PolymarketEventsCoverageResult = {
    totalMarkets,
    linkedMarkets,
    unlinkedMarkets,
    coveragePercent,
    totalEvents,
    eventsWithMarkets,
    sampleUnlinked,
  };

  // Print report
  console.log('--- Coverage Statistics ---');
  console.log(`Total PM markets:    ${totalMarkets.toLocaleString()}`);
  console.log(`Linked to events:    ${linkedMarkets.toLocaleString()}`);
  console.log(`Unlinked:            ${unlinkedMarkets.toLocaleString()}`);
  console.log(`Coverage:            ${coveragePercent.toFixed(1)}%`);
  console.log('');
  console.log(`Total events:        ${totalEvents.toLocaleString()}`);
  console.log(`Events with markets: ${eventsWithMarkets.toLocaleString()}`);

  if (sampleUnlinked.length > 0) {
    console.log('\n--- Sample Unlinked Markets (recent active) ---');
    for (const m of sampleUnlinked) {
      console.log(`  [${m.id}] ${m.title.substring(0, 70)}...`);
    }
  }

  // Alert if coverage < 90%
  if (coveragePercent < 90) {
    console.log(`\n⚠️  WARNING: Coverage is below 90%!`);
    console.log(`   Run: polymarket:events:sync --full --apply`);
  } else {
    console.log(`\n✅ Coverage is ${coveragePercent.toFixed(1)}% (target: >= 90%)`);
  }

  console.log('\nDone.');
  return result;
}

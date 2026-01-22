/**
 * Polymarket Events Sync Command (v3.0.3)
 *
 * Fetches Polymarket events from Gamma API and persists:
 * - Event metadata (tags, series, category)
 * - Links markets to their events (pmEventId)
 *
 * Events contain proper taxonomy tags that can be used for classification.
 */

import { getClient, Prisma } from '@data-module/db';
import { withRetry, HttpError, parseRetryAfter } from '@data-module/core';

export interface PolymarketEventsSyncOptions {
  limit?: number;
  activeOnly?: boolean;
  apply?: boolean;
  linkMarkets?: boolean;
}

export interface PolymarketEventsSyncResult {
  totalEvents: number;
  newEvents: number;
  updatedEvents: number;
  marketsLinked: number;
  tagDistribution: Record<string, number>;
  errors: string[];
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
}

/**
 * Fetch events from Gamma API with pagination
 */
async function fetchEventsFromGamma(options: {
  limit: number;
  activeOnly: boolean;
  offset?: number;
}): Promise<GammaEvent[]> {
  const { limit, activeOnly, offset = 0 } = options;
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

interface GammaSportConfig {
  sport: string;
  series: string;
  tags: string;
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

export async function runPolymarketEventsSync(
  options: PolymarketEventsSyncOptions = {}
): Promise<PolymarketEventsSyncResult> {
  const {
    limit = 1000,
    activeOnly = true,
    apply = false,
    linkMarkets = true,
  } = options;

  console.log(`\n=== Polymarket Events Sync (v3.0.3) ===\n`);
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`Limit: ${limit}`);
  console.log(`Active only: ${activeOnly}`);
  console.log(`Link markets: ${linkMarkets}\n`);

  const client = getClient();
  const result: PolymarketEventsSyncResult = {
    totalEvents: 0,
    newEvents: 0,
    updatedEvents: 0,
    marketsLinked: 0,
    tagDistribution: {},
    errors: [],
  };

  // Fetch sports config first
  console.log('Fetching sports configuration...');
  let sportsConfig: Array<{ sport: string; series: string; tags: string }> = [];
  try {
    sportsConfig = await fetchSportsFromGamma();
    console.log(`Loaded ${sportsConfig.length} sports configurations\n`);

    if (apply) {
      // Upsert sports config
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

  // Fetch events with pagination
  console.log('Fetching events from Gamma API...');
  let allEvents: GammaEvent[] = [];
  let offset = 0;
  const batchSize = 100;

  while (allEvents.length < limit) {
    const remaining = limit - allEvents.length;
    const fetchSize = Math.min(batchSize, remaining);

    const batch = await fetchEventsFromGamma({
      limit: fetchSize,
      activeOnly,
      offset,
    });

    if (batch.length === 0) break;

    allEvents = allEvents.concat(batch);
    offset += batch.length;

    console.log(`  Fetched ${allEvents.length} events...`);

    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log(`\nTotal events fetched: ${allEvents.length}\n`);
  result.totalEvents = allEvents.length;

  // Build sports lookup (seriesId -> sport)
  const seriesSportMap = new Map<string, string>();
  for (const sc of sportsConfig) {
    const seriesIds = sc.series ? sc.series.split(',').filter(Boolean) : [];
    for (const sid of seriesIds) {
      seriesSportMap.set(sid, sc.sport);
    }
  }

  // Process events
  console.log('Processing events...');
  const eventMarketMap = new Map<string, string[]>(); // eventId -> marketIds

  for (const event of allEvents) {
    // Count tags
    const tags = event.tags || [];
    for (const tag of tags) {
      result.tagDistribution[tag.slug] = (result.tagDistribution[tag.slug] || 0) + 1;
    }

    // Collect market IDs
    const marketIds = (event.markets || []).map(m => String(m.id));
    if (marketIds.length > 0) {
      eventMarketMap.set(event.id, marketIds);
    }

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

  // Link markets to events
  if (linkMarkets && apply) {
    console.log('\nLinking markets to events...');
    let linked = 0;

    for (const [eventId, marketIds] of eventMarketMap) {
      for (const marketId of marketIds) {
        try {
          const updated = await client.market.updateMany({
            where: {
              venue: 'polymarket',
              externalId: marketId,
              pmEventId: null, // Only update if not already linked
            },
            data: {
              pmEventId: eventId,
            },
          });
          linked += updated.count;
        } catch (err) {
          // Ignore - market might not exist in our DB
        }
      }
    }

    result.marketsLinked = linked;
    console.log(`Linked ${linked} markets to events`);
  }

  // Print summary
  console.log('\n--- Summary ---');
  console.log(`Total events: ${result.totalEvents}`);
  console.log(`New events: ${result.newEvents}`);
  console.log(`Updated events: ${result.updatedEvents}`);
  console.log(`Markets linked: ${result.marketsLinked}`);
  console.log(`Errors: ${result.errors.length}`);

  // Top tags
  const sortedTags = Object.entries(result.tagDistribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  console.log('\n--- Top Tags ---');
  for (const [tag, count] of sortedTags) {
    console.log(`  ${tag.padEnd(25)} ${count}`);
  }

  if (!apply) {
    console.log('\n[DRY-RUN] Add --apply to persist changes');
  }

  console.log('\nDone.');
  return result;
}

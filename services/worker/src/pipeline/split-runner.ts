import type { Venue, MarketDTO, DedupConfig } from '@data-module/core';
import { formatDuration, DEFAULT_DEDUP_CONFIG } from '@data-module/core';
import {
  getClient,
  MarketRepository,
  QuoteRepository,
  IngestionRepository,
  WatchlistRepository,
  type Venue as DbVenue,
} from '@data-module/db';
import { createAdapter, type VenueAdapter, type KalshiAuthConfig } from '../adapters/index.js';

// v2.6.7: Quotes mode from environment
const QUOTES_MODE = process.env.QUOTES_MODE || 'global';
const QUOTES_WATCHLIST_LIMIT = parseInt(process.env.QUOTES_WATCHLIST_LIMIT || '2000', 10);

export interface SplitRunnerConfig {
  venue: Venue;
  maxMarkets?: number;
  pageSize?: number;
  dedupConfig?: DedupConfig;
  kalshiAuth?: KalshiAuthConfig;
  marketsRefreshSeconds: number;
  quotesRefreshSeconds: number;
  quotesClosedLookbackHours: number;
  quotesMaxMarketsPerCycle?: number;
}

interface SyncResult {
  ok: boolean;
  durationMs: number;
  error?: string;
}

// v2.6.6: Track consecutive zero-fetch cycles for cursor reset protection
const zeroFetchCycles = new Map<string, number>();

/**
 * Sync markets only (no quotes)
 * v2.6.6: Added cursor reset protection when consecutive zero-fetch cycles detected
 */
async function syncMarkets(
  adapter: VenueAdapter,
  marketRepo: MarketRepository,
  ingestionRepo: IngestionRepository,
  venue: DbVenue,
  maxMarkets: number,
  pageSize: number
): Promise<SyncResult> {
  const startTime = Date.now();

  try {
    const state = await ingestionRepo.getOrCreateState(venue, 'markets');
    const allMarkets: MarketDTO[] = [];
    let cursor = state.cursor ?? undefined;
    let totalFetched = 0;

    while (totalFetched < maxMarkets) {
      console.log(`[${venue}:markets] Fetching (cursor: ${cursor ?? 'start'})...`);
      const result = await adapter.fetchMarkets({ cursor, limit: pageSize });
      allMarkets.push(...result.items);
      totalFetched += result.items.length;
      console.log(`[${venue}:markets] Fetched ${result.items.length} (total: ${totalFetched})`);

      // v2.6.6: If we got 0 results but had a cursor, check for stuck cursor
      if (result.items.length === 0 && cursor) {
        const key = `${venue}:markets`;
        const prevZero = zeroFetchCycles.get(key) || 0;
        zeroFetchCycles.set(key, prevZero + 1);

        if (prevZero + 1 >= 3) {
          console.warn(`[${venue}:markets] Detected ${prevZero + 1} consecutive zero-fetch cycles with cursor=${cursor}. Resetting cursor.`);
          await ingestionRepo.updateCursor(venue, 'markets', null);
          zeroFetchCycles.set(key, 0);
          break;
        }
      } else if (result.items.length > 0) {
        // Reset zero-fetch counter on successful fetch
        zeroFetchCycles.set(`${venue}:markets`, 0);
      }

      if (result.nextCursor) {
        await ingestionRepo.updateCursor(venue, 'markets', result.nextCursor);
        cursor = result.nextCursor;
      } else {
        // v2.6.6: Explicitly reset cursor when no nextCursor (end of data)
        console.log(`[${venue}:markets] Reached end of data, resetting cursor`);
        await ingestionRepo.updateCursor(venue, 'markets', null);
        zeroFetchCycles.set(`${venue}:markets`, 0);
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    console.log(`[${venue}:markets] Upserting ${allMarkets.length} markets...`);
    const upsertResult = await marketRepo.upsertMarkets(venue, allMarkets);
    console.log(`[${venue}:markets] Created: ${upsertResult.created}, Updated: ${upsertResult.updated}`);

    await ingestionRepo.updateWatermark(venue, 'markets', new Date());
    await ingestionRepo.markSuccess(venue, 'markets', {
      marketsFetched: allMarkets.length,
      marketsWritten: upsertResult.created + upsertResult.updated,
      outcomesFetched: allMarkets.reduce((s, m) => s + m.outcomes.length, 0),
      outcomesWritten: allMarkets.reduce((s, m) => s + m.outcomes.length, 0),
      quotesFetched: 0,
      quotesWritten: 0,
      quotesSkippedDedup: 0,
      durationMs: Date.now() - startTime,
    });

    return { ok: true, durationMs: Date.now() - startTime };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    await ingestionRepo.markError(venue, 'markets', errorMsg);
    console.error(`[${venue}:markets] Failed: ${errorMsg}`);
    return { ok: false, durationMs: Date.now() - startTime, error: errorMsg };
  }
}

/**
 * Sync quotes only (for existing markets)
 * v2.6.7: Supports two modes:
 * - 'watchlist': Only fetch quotes for markets in quote_watchlist (recommended)
 * - 'global': Original pagination-based approach
 */
async function syncQuotes(
  adapter: VenueAdapter,
  marketRepo: MarketRepository,
  quoteRepo: QuoteRepository,
  ingestionRepo: IngestionRepository,
  venue: DbVenue,
  closedLookbackHours: number,
  maxMarketsPerCycle: number,
  watchlistRepo?: WatchlistRepository
): Promise<SyncResult> {
  const startTime = Date.now();
  const quotesMode = QUOTES_MODE;

  try {
    let markets: Awaited<ReturnType<typeof marketRepo.getMarketsForQuotesSyncPaginated>>['markets'];
    let nextCursor: number | null = null;
    let totalEligible: number;
    let afterId: number | undefined;

    if (quotesMode === 'watchlist' && watchlistRepo) {
      // v2.6.7: Watchlist mode - only fetch quotes for watched markets
      const watchlistItems = await watchlistRepo.getMarketIdsForQuotes(venue, QUOTES_WATCHLIST_LIMIT);

      if (watchlistItems.length === 0) {
        console.log(`[${venue}:quotes] Watchlist mode: No markets in watchlist, skipping`);
        return { ok: true, durationMs: Date.now() - startTime };
      }

      // Count by priority bucket for logging
      const priorityBuckets: Record<number, number> = {};
      for (const item of watchlistItems) {
        priorityBuckets[item.priority] = (priorityBuckets[item.priority] || 0) + 1;
      }
      const bucketStr = Object.entries(priorityBuckets)
        .sort((a, b) => parseInt(b[0]) - parseInt(a[0]))
        .map(([p, c]) => `${p}:${c}`)
        .join('/');

      console.log(
        `[${venue}:quotes] Watchlist mode: Selected ${watchlistItems.length} markets ` +
          `(priority buckets: ${bucketStr})`
      );

      // Fetch markets by IDs
      const marketIds = watchlistItems.map((w: { marketId: number; priority: number }) => w.marketId);
      const prisma = getClient();
      markets = await prisma.market.findMany({
        where: {
          venue,
          id: { in: marketIds },
        },
        include: { outcomes: true },
      });

      totalEligible = watchlistItems.length;
    } else {
      // Original global mode with pagination
      const state = await ingestionRepo.getOrCreateState(venue, 'quotes');
      afterId = state.cursor ? parseInt(state.cursor, 10) : undefined;

      const result = await marketRepo.getMarketsForQuotesSyncPaginated(
        venue,
        {
          closedLookbackHours,
          limit: maxMarketsPerCycle,
          afterId: afterId && !isNaN(afterId) ? afterId : undefined,
        }
      );

      markets = result.markets;
      nextCursor = result.nextCursor;
      totalEligible = result.totalEligible;

      console.log(
        `[${venue}:quotes] Global mode: Selected ${markets.length}/${totalEligible} eligible markets` +
          (afterId ? ` (after ID ${afterId})` : '')
      );
    }

    if (markets.length === 0) {
      // Reset cursor if we've reached the end or no markets
      if (afterId) {
        console.log(`[${venue}:quotes] Reached end of market list, resetting cursor`);
        await ingestionRepo.updateCursor(venue, 'quotes', null);
      }
      return { ok: true, durationMs: Date.now() - startTime };
    }

    // Convert to MarketDTO
    const marketDTOs: MarketDTO[] = markets.map((m) => ({
      externalId: m.externalId,
      title: m.title,
      category: m.category ?? undefined,
      status: m.status as 'active' | 'closed' | 'resolved' | 'archived',
      closeTime: m.closeTime ?? undefined,
      outcomes: m.outcomes.map((o) => ({
        externalId: o.externalId ?? undefined,
        name: o.name,
        side: o.side as 'yes' | 'no' | 'other',
        metadata: o.metadata as Record<string, unknown> | undefined,
      })),
      metadata: m.metadata as Record<string, unknown> | undefined,
    }));

    const quotes = await adapter.fetchQuotes(marketDTOs);
    console.log(`[${venue}:quotes] Fetched ${quotes.length} quotes for ${markets.length} markets`);

    // Build outcome lookup
    const outcomeMap = new Map<string, number>();
    for (const market of markets) {
      for (const outcome of market.outcomes) {
        outcomeMap.set(`${market.externalId}:${outcome.name}`, outcome.id);
        if (outcome.externalId) {
          outcomeMap.set(`${market.externalId}:ext:${outcome.externalId}`, outcome.id);
        }
      }
    }

    // Map quotes
    const quoteInputs = quotes
      .map((q) => {
        let outcomeId = q.outcomeExternalId
          ? outcomeMap.get(`${q.marketExternalId}:ext:${q.outcomeExternalId}`)
          : undefined;
        if (!outcomeId) {
          outcomeId = outcomeMap.get(`${q.marketExternalId}:${q.outcomeName}`);
        }
        if (!outcomeId) return null;

        return {
          outcomeId,
          ts: q.ts,
          price: q.price,
          impliedProb: q.impliedProb,
          liquidity: q.liquidity,
          volume: q.volume,
          raw: q.raw,
        };
      })
      .filter((q): q is NonNullable<typeof q> => q !== null);

    const insertResult = await quoteRepo.insertQuotesWithDedup(quoteInputs);
    console.log(
      `[${venue}:quotes] Written: ${insertResult.inserted}, Skipped: ${insertResult.skipped}, InCycle: ${insertResult.skippedInCycle}`
    );

    // v2.6.7: Only update cursor in global mode (watchlist mode doesn't use cursor)
    if (quotesMode !== 'watchlist') {
      await ingestionRepo.updateCursor(venue, 'quotes', nextCursor ? String(nextCursor) : null);
    }

    await ingestionRepo.updateWatermark(venue, 'quotes', new Date());
    await ingestionRepo.markSuccess(venue, 'quotes', {
      marketsFetched: 0,
      marketsWritten: 0,
      outcomesFetched: 0,
      outcomesWritten: 0,
      quotesFetched: quotes.length,
      quotesWritten: insertResult.inserted,
      quotesSkippedDedup: insertResult.skipped + insertResult.skippedInCycle,
      durationMs: Date.now() - startTime,
    });

    return { ok: true, durationMs: Date.now() - startTime };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    await ingestionRepo.markError(venue, 'quotes', errorMsg);
    console.error(`[${venue}:quotes] Failed: ${errorMsg}`);
    return { ok: false, durationMs: Date.now() - startTime, error: errorMsg };
  }
}

/**
 * Run split ingestion loop with separate intervals for markets and quotes
 */
export async function runSplitIngestionLoop(config: SplitRunnerConfig): Promise<never> {
  const {
    venue,
    maxMarkets = 100000,
    pageSize = 100,
    marketsRefreshSeconds,
    quotesRefreshSeconds,
    quotesClosedLookbackHours,
    quotesMaxMarketsPerCycle = 2000,
  } = config;
  const dedupConfig = config.dedupConfig ?? DEFAULT_DEDUP_CONFIG;

  const prisma = getClient();
  const marketRepo = new MarketRepository(prisma);
  const quoteRepo = new QuoteRepository(prisma, dedupConfig);
  const ingestionRepo = new IngestionRepository(prisma);
  const watchlistRepo = new WatchlistRepository(prisma);

  const adapter = createAdapter(venue, {
    config: { pageSize },
    kalshiAuth: config.kalshiAuth,
  });

  console.log(`[${venue}] Starting split ingestion loop`);
  console.log(`[${venue}] Markets refresh: ${marketsRefreshSeconds}s, Quotes refresh: ${quotesRefreshSeconds}s`);
  console.log(`[${venue}] Quotes closed lookback: ${quotesClosedLookbackHours}h, Max markets/cycle: ${quotesMaxMarketsPerCycle}`);
  console.log(`[${venue}] Quotes mode: ${QUOTES_MODE} (limit: ${QUOTES_WATCHLIST_LIMIT})`);

  let lastMarketsSync = 0;
  let lastQuotesSync = 0;

  while (true) {
    const now = Date.now();

    // Check if markets sync is due
    if (now - lastMarketsSync >= marketsRefreshSeconds * 1000) {
      console.log(`[${venue}:markets] Starting sync...`);
      const result = await syncMarkets(
        adapter,
        marketRepo,
        ingestionRepo,
        venue as DbVenue,
        maxMarkets,
        pageSize
      );
      console.log(`[${venue}:markets] Completed in ${formatDuration(result.durationMs)}`);
      lastMarketsSync = Date.now();
    }

    // Check if quotes sync is due
    if (now - lastQuotesSync >= quotesRefreshSeconds * 1000) {
      console.log(`[${venue}:quotes] Starting sync...`);
      const result = await syncQuotes(
        adapter,
        marketRepo,
        quoteRepo,
        ingestionRepo,
        venue as DbVenue,
        quotesClosedLookbackHours,
        quotesMaxMarketsPerCycle,
        watchlistRepo
      );
      console.log(`[${venue}:quotes] Completed in ${formatDuration(result.durationMs)}`);
      lastQuotesSync = Date.now();
    }

    // Sleep for the shorter interval
    const nextCheck = Math.min(
      lastMarketsSync + marketsRefreshSeconds * 1000,
      lastQuotesSync + quotesRefreshSeconds * 1000
    );
    const sleepMs = Math.max(1000, nextCheck - Date.now());
    await new Promise((r) => setTimeout(r, sleepMs));
  }
}

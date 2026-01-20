import type { Venue, MarketDTO, DedupConfig } from '@data-module/core';
import { formatDuration, DEFAULT_DEDUP_CONFIG } from '@data-module/core';
import {
  getClient,
  MarketRepository,
  QuoteRepository,
  IngestionRepository,
  type Venue as DbVenue,
} from '@data-module/db';
import { createAdapter, type VenueAdapter, type KalshiAuthConfig } from '../adapters/index.js';

export interface SplitRunnerConfig {
  venue: Venue;
  maxMarkets?: number;
  pageSize?: number;
  dedupConfig?: DedupConfig;
  kalshiAuth?: KalshiAuthConfig;
  marketsRefreshSeconds: number;
  quotesRefreshSeconds: number;
  quotesClosedLookbackHours: number;
}

interface SyncResult {
  ok: boolean;
  durationMs: number;
  error?: string;
}

/**
 * Sync markets only (no quotes)
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

      if (result.nextCursor) {
        await ingestionRepo.updateCursor(venue, 'markets', result.nextCursor);
        cursor = result.nextCursor;
      } else {
        await ingestionRepo.updateCursor(venue, 'markets', null);
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
 */
async function syncQuotes(
  adapter: VenueAdapter,
  marketRepo: MarketRepository,
  quoteRepo: QuoteRepository,
  ingestionRepo: IngestionRepository,
  venue: DbVenue,
  closedLookbackHours: number
): Promise<SyncResult> {
  const startTime = Date.now();

  try {
    const markets = await marketRepo.getMarketsForQuotesSync(venue, closedLookbackHours);
    console.log(`[${venue}:quotes] Syncing quotes for ${markets.length} markets...`);

    if (markets.length === 0) {
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
    console.log(`[${venue}:quotes] Fetched ${quotes.length} quotes`);

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
    maxMarkets = 10000,
    pageSize = 100,
    marketsRefreshSeconds,
    quotesRefreshSeconds,
    quotesClosedLookbackHours,
  } = config;
  const dedupConfig = config.dedupConfig ?? DEFAULT_DEDUP_CONFIG;

  const prisma = getClient();
  const marketRepo = new MarketRepository(prisma);
  const quoteRepo = new QuoteRepository(prisma, dedupConfig);
  const ingestionRepo = new IngestionRepository(prisma);

  const adapter = createAdapter(venue, {
    config: { pageSize },
    kalshiAuth: config.kalshiAuth,
  });

  console.log(`[${venue}] Starting split ingestion loop`);
  console.log(`[${venue}] Markets refresh: ${marketsRefreshSeconds}s, Quotes refresh: ${quotesRefreshSeconds}s`);
  console.log(`[${venue}] Quotes closed lookback: ${quotesClosedLookbackHours}h`);

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
        quotesClosedLookbackHours
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

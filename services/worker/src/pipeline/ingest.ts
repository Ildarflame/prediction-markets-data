import type { Venue, MarketDTO, IngestionStats, DedupConfig } from '@data-module/core';
import { formatDuration, DEFAULT_DEDUP_CONFIG } from '@data-module/core';
import {
  getClient,
  MarketRepository,
  QuoteRepository,
  IngestionRepository,
  type Venue as DbVenue,
} from '@data-module/db';
import { createAdapter, type VenueAdapter, type KalshiAuthConfig, KalshiAdapter } from '../adapters/index.js';

export interface IngestOptions {
  venue: Venue;
  maxMarkets?: number;
  pageSize?: number;
  dedupConfig?: DedupConfig;
  kalshiAuth?: KalshiAuthConfig;
}

export interface IngestResult {
  ok: boolean;
  stats: IngestionStats;
  error?: string;
}

/**
 * Run a single ingestion cycle for a venue
 */
export async function runIngestion(options: IngestOptions): Promise<IngestResult> {
  const startTime = Date.now();
  const { venue, maxMarkets = 10000, pageSize = 100 } = options;
  const dedupConfig = options.dedupConfig ?? DEFAULT_DEDUP_CONFIG;

  const prisma = getClient();
  const marketRepo = new MarketRepository(prisma);
  const quoteRepo = new QuoteRepository(prisma, dedupConfig);
  const ingestionRepo = new IngestionRepository(prisma);

  // Start run tracking
  const { runId } = await ingestionRepo.startRun(venue as DbVenue);

  const stats: IngestionStats = {
    marketsFetched: 0,
    marketsWritten: 0,
    outcomesFetched: 0,
    outcomesWritten: 0,
    quotesFetched: 0,
    quotesWritten: 0,
    quotesSkippedDedup: 0,
    durationMs: 0,
  };

  try {
    console.log(`[${venue}] Starting ingestion...`);

    // Create adapter
    const adapter: VenueAdapter = createAdapter(venue, {
      config: { pageSize },
      kalshiAuth: options.kalshiAuth,
    });

    // Fetch markets - use fetchAllMarkets for Kalshi (supports catalog mode)
    let allMarkets: MarketDTO[] = [];

    if (adapter instanceof KalshiAdapter) {
      // Kalshi: use fetchAllMarkets which supports catalog mode
      allMarkets = await adapter.fetchAllMarkets((progress) => {
        console.log(`[${venue}] Progress: ${progress.totalMarkets} markets fetched`);
        if (progress.seriesFetched !== undefined) {
          console.log(`[${venue}] Series: ${progress.seriesFetched}, Events: ${progress.eventsFetched}`);
        }
      });
    } else {
      // Other venues: use pagination
      const state = await ingestionRepo.getOrCreateState(venue as DbVenue, 'markets');
      let cursor = state.cursor ?? undefined;
      let totalFetched = 0;

      while (totalFetched < maxMarkets) {
        console.log(`[${venue}] Fetching markets (cursor: ${cursor ?? 'start'})...`);

        const result = await adapter.fetchMarkets({ cursor, limit: pageSize });
        allMarkets.push(...result.items);
        totalFetched += result.items.length;

        console.log(`[${venue}] Fetched ${result.items.length} markets (total: ${totalFetched})`);

        // Update cursor checkpoint
        if (result.nextCursor) {
          await ingestionRepo.updateCursor(venue as DbVenue, 'markets', result.nextCursor);
          cursor = result.nextCursor;
        } else {
          // Reset cursor when we've fetched all
          await ingestionRepo.updateCursor(venue as DbVenue, 'markets', null);
          break;
        }

        // Respect rate limits
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    stats.marketsFetched = allMarkets.length;
    stats.outcomesFetched = allMarkets.reduce((sum, m) => sum + m.outcomes.length, 0);

    // Upsert markets and outcomes
    console.log(`[${venue}] Upserting ${allMarkets.length} markets...`);
    const upsertResult = await marketRepo.upsertMarkets(venue as DbVenue, allMarkets);
    stats.marketsWritten = upsertResult.created + upsertResult.updated;
    stats.outcomesWritten = stats.outcomesFetched; // All outcomes are written with their markets

    console.log(`[${venue}] Markets: ${upsertResult.created} created, ${upsertResult.updated} updated`);

    // Fetch quotes for active markets
    const activeMarkets = await marketRepo.getActiveMarkets(venue as DbVenue);
    console.log(`[${venue}] Fetching quotes for ${activeMarkets.length} active markets...`);

    // Convert to MarketDTO for adapter
    const marketDTOs: MarketDTO[] = activeMarkets.map((m) => ({
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
    stats.quotesFetched = quotes.length;

    console.log(`[${venue}] Processing ${quotes.length} quotes...`);

    // Build outcome lookup map
    const outcomeMap = new Map<string, number>();
    for (const market of activeMarkets) {
      for (const outcome of market.outcomes) {
        // Key by market external ID + outcome name
        const key = `${market.externalId}:${outcome.name}`;
        outcomeMap.set(key, outcome.id);

        // Also key by outcome external ID if available
        if (outcome.externalId) {
          outcomeMap.set(`${market.externalId}:ext:${outcome.externalId}`, outcome.id);
        }
      }
    }

    // Map quotes to QuoteInput
    const quoteInputs = quotes
      .map((q) => {
        // Try to find outcome by external ID first, then by name
        let outcomeId = q.outcomeExternalId
          ? outcomeMap.get(`${q.marketExternalId}:ext:${q.outcomeExternalId}`)
          : undefined;

        if (!outcomeId) {
          outcomeId = outcomeMap.get(`${q.marketExternalId}:${q.outcomeName}`);
        }

        if (!outcomeId) {
          console.warn(`[${venue}] No outcome found for ${q.marketExternalId}:${q.outcomeName}`);
          return null;
        }

        return {
          outcomeId,
          ts: q.ts,
          price: q.price,
          impliedProb: q.impliedProb,
          liquidity: q.liquidity,
          volume: q.volume,
        };
      })
      .filter((q): q is NonNullable<typeof q> => q !== null);

    // Insert quotes with dedup
    const insertResult = await quoteRepo.insertQuotesWithDedup(quoteInputs);
    stats.quotesWritten = insertResult.inserted;
    stats.quotesSkippedDedup = insertResult.skipped;

    console.log(
      `[${venue}] Quotes: ${insertResult.inserted} written, ${insertResult.skipped} skipped (dedup)`
    );

    // Update watermark
    await ingestionRepo.updateWatermark(venue as DbVenue, 'markets', new Date());

    // Mark success
    stats.durationMs = Date.now() - startTime;
    await ingestionRepo.markSuccess(venue as DbVenue, 'markets', stats);

    // Complete run
    await ingestionRepo.completeRun(
      runId,
      { markets: stats.marketsFetched, quotes: stats.quotesFetched },
      { markets: stats.marketsWritten, quotes: stats.quotesWritten }
    );

    console.log(`[${venue}] Ingestion completed in ${formatDuration(stats.durationMs)}`);

    return { ok: true, stats };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    stats.durationMs = Date.now() - startTime;
    await ingestionRepo.markError(venue as DbVenue, 'markets', errorMsg);
    await ingestionRepo.failRun(
      runId,
      errorMsg,
      { markets: stats.marketsFetched, quotes: stats.quotesFetched },
      { markets: stats.marketsWritten, quotes: stats.quotesWritten }
    );

    console.error(`[${venue}] Ingestion failed: ${errorMsg}`);

    return { ok: false, stats, error: errorMsg };
  }
}

/**
 * Run ingestion in a loop with interval
 */
export async function runIngestionLoop(
  options: IngestOptions & { intervalSeconds: number }
): Promise<never> {
  const { intervalSeconds, ...ingestOptions } = options;

  console.log(`Starting ingestion loop for ${options.venue} every ${intervalSeconds}s`);

  while (true) {
    await runIngestion(ingestOptions);

    console.log(`Waiting ${intervalSeconds}s before next ingestion...`);
    await new Promise((r) => setTimeout(r, intervalSeconds * 1000));
  }
}

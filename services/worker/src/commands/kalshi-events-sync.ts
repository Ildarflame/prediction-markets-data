/**
 * Kalshi Events Sync Command (v3.0.12)
 *
 * Syncs Kalshi events to database and links markets to events.
 * Critical for SPORTS matching - events contain team names and strike dates.
 *
 * Usage:
 *   kalshi:events:sync --lookback-days 14 --apply
 *   kalshi:events:sync --series KXNBA,KXNFL --apply
 */

import { getClient, KalshiEventRepository, type KalshiEventDTO } from '@data-module/db';
import { loadKalshiConfig, KALSHI_PROD_URL } from '../adapters/kalshi.config.js';
import { withRetry, HttpError, parseRetryAfter } from '@data-module/core';

interface KalshiEventAPI {
  event_ticker: string;
  series_ticker: string;
  title: string;
  subtitle?: string;
  category?: string;
  status?: string;
  strike_date?: string;
  mutually_exclusive?: boolean;
  markets_count?: number;
}

interface KalshiEventsResponse {
  events: KalshiEventAPI[];
  cursor?: string;
}

interface KalshiSeriesAPI {
  ticker: string;
  title: string;
  category?: string;
}

interface KalshiSeriesResponse {
  series: KalshiSeriesAPI[];
  cursor?: string;
}

// Sports-related series prefixes
const SPORTS_SERIES_PREFIXES = [
  'KXNBA', 'KXNFL', 'KXMLB', 'KXNHL', 'KXMLS',
  'KXEPL', 'KXUCL', 'KXUFC', 'KXPGA', 'KXF1',
  'KXNCAAF', 'KXNCAAB', 'KXTENNIS', 'KXGOLF',
  // Generic sports
  'KXSPORT', 'KXGAME', 'KXMATCH',
];

async function fetchWithRetry<T>(url: string): Promise<T> {
  return withRetry(
    async () => {
      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' },
      });
      if (!response.ok) {
        const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'));
        throw new HttpError(
          `Kalshi API error: ${response.status} ${response.statusText}`,
          response.status,
          retryAfterMs ? retryAfterMs / 1000 : undefined
        );
      }
      return response.json() as Promise<T>;
    },
    {
      maxAttempts: 5,
      baseDelayMs: 1000,
      onRetry: (err, attempt, delayMs) => {
        console.warn(`[kalshi:events:sync] Retry ${attempt} in ${delayMs}ms: ${err.message}`);
      },
    }
  );
}

async function fetchAllSeries(baseUrl: string): Promise<KalshiSeriesAPI[]> {
  const allSeries: KalshiSeriesAPI[] = [];
  let cursor: string | undefined;

  console.log('[kalshi:events:sync] Fetching all series...');

  do {
    const url = new URL(`${baseUrl}/series`);
    url.searchParams.set('limit', '200');
    if (cursor) {
      url.searchParams.set('cursor', cursor);
    }

    const data = await fetchWithRetry<KalshiSeriesResponse>(url.toString());
    allSeries.push(...data.series);
    cursor = data.cursor || undefined;

    if (cursor) {
      await new Promise(r => setTimeout(r, 100));
    }
  } while (cursor);

  console.log(`[kalshi:events:sync] Found ${allSeries.length} total series`);
  return allSeries;
}

async function fetchEventsForSeries(
  baseUrl: string,
  seriesTicker: string,
  status?: string
): Promise<KalshiEventAPI[]> {
  const allEvents: KalshiEventAPI[] = [];
  let cursor: string | undefined;

  do {
    const url = new URL(`${baseUrl}/events`);
    url.searchParams.set('series_ticker', seriesTicker);
    url.searchParams.set('limit', '200');
    if (status) {
      url.searchParams.set('status', status);
    }

    if (cursor) {
      url.searchParams.set('cursor', cursor);
    }

    const data = await fetchWithRetry<KalshiEventsResponse>(url.toString());
    allEvents.push(...data.events);
    cursor = data.cursor || undefined;

    if (cursor) {
      await new Promise(r => setTimeout(r, 100));
    }
  } while (cursor);

  return allEvents;
}

function mapEventToDTO(event: KalshiEventAPI): KalshiEventDTO {
  return {
    eventTicker: event.event_ticker,
    seriesTicker: event.series_ticker,
    title: event.title,
    subTitle: event.subtitle || null,
    category: event.category || null,
    status: event.status || null,
    strikeDate: event.strike_date ? new Date(event.strike_date) : null,
    mutuallyExclusive: event.mutually_exclusive ?? false,
    marketCount: event.markets_count ?? 0,
  };
}

export interface KalshiEventsSyncOptions {
  lookbackDays?: number;
  series?: string;
  allSeries?: boolean;
  status?: string;
  limit?: number;
  apply?: boolean;
  linkMarkets?: boolean;
}

export interface KalshiEventsSyncResult {
  eventsFound: number;
  eventsCreated: number;
  eventsUpdated: number;
  marketsLinked: number;
  coverage: number;
  errors: string[];
}

export async function runKalshiEventsSync(options: KalshiEventsSyncOptions): Promise<KalshiEventsSyncResult> {
  const prisma = getClient();
  const eventRepo = new KalshiEventRepository(prisma);
  const kalshiConfig = loadKalshiConfig();
  const baseUrl = kalshiConfig.baseUrl || KALSHI_PROD_URL;
  const dryRun = !options.apply;

  console.log('\n=== Kalshi Events Sync (v3.0.12) ===\n');
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Mode: ${dryRun ? 'DRY-RUN' : 'APPLY'}`);
  console.log(`Status filter: ${options.status || 'all'}`);

  const result: KalshiEventsSyncResult = {
    eventsFound: 0,
    eventsCreated: 0,
    eventsUpdated: 0,
    marketsLinked: 0,
    coverage: 0,
    errors: [],
  };

  try {
    // Step 1: Determine which series to sync
    let targetSeries: string[];

    if (options.series) {
      targetSeries = options.series.split(',').map((s: string) => s.trim().toUpperCase());
      console.log(`\nTarget series: ${targetSeries.join(', ')}`);
    } else if (options.allSeries) {
      const allSeries = await fetchAllSeries(baseUrl);
      targetSeries = allSeries.map(s => s.ticker);
      console.log(`\nSyncing ALL ${targetSeries.length} series`);
    } else {
      // Default: sports-related series
      const allSeries = await fetchAllSeries(baseUrl);
      targetSeries = allSeries
        .filter(s => {
          const ticker = s.ticker.toUpperCase();
          return SPORTS_SERIES_PREFIXES.some(prefix => ticker.startsWith(prefix)) ||
                 s.category?.toLowerCase() === 'sports';
        })
        .map(s => s.ticker);
      console.log(`\nFound ${targetSeries.length} sports-related series`);
    }

    if (targetSeries.length === 0) {
      console.log('\nNo series to sync. Try --all-series or --series <tickers>');
      return result;
    }

    // Step 2: Fetch events for each series
    const allEvents: KalshiEventDTO[] = [];
    const limit = options.limit ?? 1000;
    const seriesEventCounts: Record<string, number> = {};

    for (const seriesTicker of targetSeries) {
      console.log(`\n[${targetSeries.indexOf(seriesTicker) + 1}/${targetSeries.length}] Fetching events for ${seriesTicker}...`);

      try {
        const events = await fetchEventsForSeries(baseUrl, seriesTicker, options.status);
        const eventsToAdd = events.slice(0, limit).map(mapEventToDTO);
        allEvents.push(...eventsToAdd);
        seriesEventCounts[seriesTicker] = eventsToAdd.length;
        console.log(`  Found ${events.length} events, adding ${eventsToAdd.length}`);
      } catch (err) {
        const errMsg = `Error fetching ${seriesTicker}: ${err instanceof Error ? err.message : err}`;
        console.error(`  ${errMsg}`);
        result.errors.push(errMsg);
      }

      // Small delay between series
      await new Promise(r => setTimeout(r, 200));
    }

    result.eventsFound = allEvents.length;
    console.log(`\n--- Summary ---`);
    console.log(`Total events to sync: ${allEvents.length}`);

    // Top series by event count
    const sortedSeries = Object.entries(seriesEventCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    console.log(`\nTop series by event count:`);
    for (const [ticker, count] of sortedSeries) {
      console.log(`  ${ticker}: ${count}`);
    }

    // Step 3: Upsert to database
    if (dryRun) {
      console.log(`\n[DRY-RUN] Would upsert ${allEvents.length} events`);

      // Show sample events
      console.log(`\nSample events:`);
      for (const event of allEvents.slice(0, 10)) {
        console.log(`  ${event.eventTicker}: "${event.title}" ${event.subTitle ? `- "${event.subTitle}"` : ''}`);
        if (event.strikeDate) {
          console.log(`    Strike: ${event.strikeDate.toISOString()}`);
        }
      }
    } else {
      console.log(`\nUpserting ${allEvents.length} events...`);
      const upsertResult = await eventRepo.upsertEvents(allEvents);
      result.eventsCreated = upsertResult.created;
      result.eventsUpdated = upsertResult.updated;
      console.log(`  Created: ${upsertResult.created}`);
      console.log(`  Updated: ${upsertResult.updated}`);
      if (upsertResult.errors.length > 0) {
        console.log(`  Errors: ${upsertResult.errors.length}`);
        upsertResult.errors.slice(0, 5).forEach(e => console.log(`    ${e}`));
        result.errors.push(...upsertResult.errors);
      }
    }

    // Step 4: Link markets to events
    if (options.linkMarkets) {
      console.log(`\nLinking markets to events...`);
      const linkResult = await eventRepo.linkMarketsToEvents(dryRun);

      if (dryRun) {
        console.log(`[DRY-RUN] Would link markets to events`);
        console.log(`  Markets without kalshiEventTicker: ${linkResult.noEvent}`);
      } else {
        result.marketsLinked = linkResult.linked;
        console.log(`  Linked: ${linkResult.linked}`);
        console.log(`  Already linked: ${linkResult.alreadyLinked}`);
        console.log(`  No matching event: ${linkResult.noEvent}`);
      }
    }

    // Step 5: Show SPORTS stats
    console.log(`\n--- SPORTS Coverage ---`);
    const stats = await eventRepo.getSportsStats();
    console.log(`Total events in DB: ${stats.totalEvents}`);
    console.log(`SPORTS markets with event link: ${stats.linkedMarkets}`);
    console.log(`SPORTS markets without event link: ${stats.unlinkedMarkets}`);
    result.coverage = stats.linkedMarkets + stats.unlinkedMarkets > 0
      ? (stats.linkedMarkets / (stats.linkedMarkets + stats.unlinkedMarkets)) * 100
      : 0;
    console.log(`Event coverage: ${result.coverage.toFixed(1)}%`);

    if (stats.topSeriesTickers.length > 0) {
      console.log(`\nTop series in kalshi_events:`);
      for (const { seriesTicker, count } of stats.topSeriesTickers.slice(0, 5)) {
        console.log(`  ${seriesTicker}: ${count} events`);
      }
    }

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('Error:', errMsg);
    result.errors.push(errMsg);
  }

  return result;
}

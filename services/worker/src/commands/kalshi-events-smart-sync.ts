/**
 * Kalshi Events Smart Sync (v3.0.14)
 *
 * Синхронизирует только события, которые нужны существующим markets:
 * 1. Собирает уникальные eventTicker из markets.metadata
 * 2. Группирует по seriesTicker (извлекает prefix)
 * 3. Запрашивает только нужные серии из API
 * 4. Линкует markets к events
 *
 * v3.0.14: Added --non-mve-only option to sync only for non-MVE markets
 *
 * Это гораздо эффективнее чем sync всех 1130 серий.
 */

import { getClient, KalshiEventRepository, Prisma, type KalshiEventDTO } from '@data-module/db';
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

export interface SmartSyncOptions {
  topic?: string;        // Filter by derivedTopic (e.g., 'SPORTS')
  limit?: number;        // Max eventTickers to process
  apply?: boolean;       // Apply changes (default: dry-run)
  linkMarkets?: boolean; // Link markets to events after sync
  nonMveOnly?: boolean;  // v3.0.14: Only sync events for non-MVE markets (isMve = false)
}

export interface SmartSyncResult {
  uniqueEventTickers: number;
  uniqueSeriesTickers: number;
  eventsFound: number;
  eventsCreated: number;
  eventsUpdated: number;
  marketsLinked: number;
  errors: string[];
}

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
        console.warn(`[smart-sync] Retry ${attempt} in ${delayMs}ms: ${err.message}`);
      },
    }
  );
}

async function fetchEventsForSeries(
  baseUrl: string,
  seriesTicker: string
): Promise<KalshiEventAPI[]> {
  const allEvents: KalshiEventAPI[] = [];
  let cursor: string | undefined;

  do {
    const url = new URL(`${baseUrl}/events`);
    url.searchParams.set('series_ticker', seriesTicker);
    url.searchParams.set('limit', '200');
    if (cursor) {
      url.searchParams.set('cursor', cursor);
    }

    try {
      const data = await fetchWithRetry<KalshiEventsResponse>(url.toString());
      allEvents.push(...data.events);
      cursor = data.cursor || undefined;
    } catch (err) {
      // Some series may not exist or return errors
      console.warn(`[smart-sync] Error fetching ${seriesTicker}: ${err instanceof Error ? err.message : err}`);
      break;
    }

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

/**
 * Extract series ticker from event ticker
 * Examples:
 *   KXNBA-25JAN23-LAL-BOS → KXNBA
 *   KXNFLGAME-25JAN23-KC-BUF → KXNFLGAME
 *   KXNCAAMBGAME-123 → KXNCAAMBGAME
 */
function extractSeriesTicker(eventTicker: string): string | null {
  // Pattern: SERIES-DATE-TEAMS or SERIES-ID
  const match = eventTicker.match(/^([A-Z]+(?:[A-Z0-9]*[A-Z])?)/);
  if (match) {
    return match[1];
  }
  return null;
}

export async function runKalshiEventsSmartSync(options: SmartSyncOptions): Promise<SmartSyncResult> {
  const prisma = getClient();
  const eventRepo = new KalshiEventRepository(prisma);
  const kalshiConfig = loadKalshiConfig();
  const baseUrl = kalshiConfig.baseUrl || KALSHI_PROD_URL;
  const dryRun = !options.apply;

  console.log('\n=== Kalshi Events Smart Sync (v3.0.14) ===\n');
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Mode: ${dryRun ? 'DRY-RUN' : 'APPLY'}`);
  console.log(`Topic filter: ${options.topic || 'none'}`);
  console.log(`Non-MVE only: ${options.nonMveOnly ? 'YES' : 'NO'}`);
  console.log(`Limit: ${options.limit || 'unlimited'}`);

  const result: SmartSyncResult = {
    uniqueEventTickers: 0,
    uniqueSeriesTickers: 0,
    eventsFound: 0,
    eventsCreated: 0,
    eventsUpdated: 0,
    marketsLinked: 0,
    errors: [],
  };

  try {
    // Step 1: Get unique eventTickers from markets
    console.log('\n--- Step 1: Collecting eventTickers from markets ---');

    const topicFilter = options.topic
      ? Prisma.sql`AND derived_topic = ${options.topic}`
      : Prisma.empty;

    const nonMveFilter = options.nonMveOnly
      ? Prisma.sql`AND is_mve = false`
      : Prisma.empty;

    const limitClause = options.limit
      ? Prisma.sql`LIMIT ${options.limit}`
      : Prisma.sql`LIMIT 100000`;

    const marketEventTickers = await prisma.$queryRaw<Array<{ eventTicker: string }>>`
      SELECT DISTINCT metadata->>'eventTicker' as "eventTicker"
      FROM markets
      WHERE venue = 'kalshi'
        AND metadata->>'eventTicker' IS NOT NULL
        ${topicFilter}
        ${nonMveFilter}
      ${limitClause}
    `;

    result.uniqueEventTickers = marketEventTickers.length;
    console.log(`Found ${marketEventTickers.length} unique eventTickers in markets`);

    if (marketEventTickers.length === 0) {
      console.log('No eventTickers found. Nothing to sync.');
      return result;
    }

    // Step 2: Extract unique series tickers
    console.log('\n--- Step 2: Extracting series tickers ---');

    const seriesTickerSet = new Set<string>();
    const eventTickerToSeries = new Map<string, string>();

    for (const { eventTicker } of marketEventTickers) {
      const seriesTicker = extractSeriesTicker(eventTicker);
      if (seriesTicker) {
        seriesTickerSet.add(seriesTicker);
        eventTickerToSeries.set(eventTicker, seriesTicker);
      }
    }

    result.uniqueSeriesTickers = seriesTickerSet.size;
    console.log(`Extracted ${seriesTickerSet.size} unique series tickers`);

    // Show top series
    const seriesCounts = new Map<string, number>();
    for (const series of eventTickerToSeries.values()) {
      seriesCounts.set(series, (seriesCounts.get(series) || 0) + 1);
    }
    const topSeries = [...seriesCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15);

    console.log('\nTop series by eventTicker count:');
    for (const [series, count] of topSeries) {
      console.log(`  ${series}: ${count}`);
    }

    // Step 3: Fetch events from API
    console.log('\n--- Step 3: Fetching events from Kalshi API ---');

    const allEvents: KalshiEventDTO[] = [];
    const seriesArray = [...seriesTickerSet];
    let successfulSeries = 0;
    let failedSeries = 0;

    for (let i = 0; i < seriesArray.length; i++) {
      const seriesTicker = seriesArray[i];
      const progress = `[${i + 1}/${seriesArray.length}]`;

      try {
        const events = await fetchEventsForSeries(baseUrl, seriesTicker);
        if (events.length > 0) {
          allEvents.push(...events.map(mapEventToDTO));
          successfulSeries++;
          if (events.length > 10) {
            console.log(`${progress} ${seriesTicker}: ${events.length} events`);
          }
        }
      } catch (err) {
        failedSeries++;
        result.errors.push(`${seriesTicker}: ${err instanceof Error ? err.message : err}`);
      }

      // Rate limiting
      if (i % 10 === 0 && i > 0) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    result.eventsFound = allEvents.length;
    console.log(`\nFetched ${allEvents.length} events from ${successfulSeries} series (${failedSeries} failed)`);

    // Step 4: Filter to only events we need (matching our eventTickers)
    console.log('\n--- Step 4: Filtering to needed events ---');

    const neededEventTickers = new Set(marketEventTickers.map(m => m.eventTicker));
    const filteredEvents = allEvents.filter(e => neededEventTickers.has(e.eventTicker));

    console.log(`Filtered to ${filteredEvents.length} events matching market eventTickers`);
    console.log(`Coverage: ${((filteredEvents.length / neededEventTickers.size) * 100).toFixed(1)}%`);

    // Step 5: Upsert to database
    if (dryRun) {
      console.log(`\n[DRY-RUN] Would upsert ${filteredEvents.length} events`);

      // Show sample
      console.log('\nSample events:');
      for (const event of filteredEvents.slice(0, 10)) {
        console.log(`  ${event.eventTicker}: "${event.title}"`);
        if (event.subTitle) console.log(`    Subtitle: "${event.subTitle}"`);
        if (event.strikeDate) console.log(`    Strike: ${event.strikeDate.toISOString()}`);
      }
    } else {
      console.log(`\n--- Step 5: Upserting ${filteredEvents.length} events ---`);

      const upsertResult = await eventRepo.upsertEvents(filteredEvents);
      result.eventsCreated = upsertResult.created;
      result.eventsUpdated = upsertResult.updated;

      console.log(`Created: ${upsertResult.created}`);
      console.log(`Updated: ${upsertResult.updated}`);

      if (upsertResult.errors.length > 0) {
        console.log(`Errors: ${upsertResult.errors.length}`);
        result.errors.push(...upsertResult.errors.slice(0, 5));
      }
    }

    // Step 6: Link markets to events
    if (options.linkMarkets) {
      console.log('\n--- Step 6: Linking markets to events ---');

      const linkResult = await eventRepo.linkMarketsToEvents(dryRun);

      if (dryRun) {
        console.log(`[DRY-RUN] Would link markets to events`);
        console.log(`  Markets needing link: ${linkResult.noEvent}`);
      } else {
        result.marketsLinked = linkResult.linked;
        console.log(`Linked: ${linkResult.linked}`);
        console.log(`Already linked: ${linkResult.alreadyLinked}`);
        console.log(`No matching event: ${linkResult.noEvent}`);
      }
    }

    // Summary
    console.log('\n--- Summary ---');
    console.log(`Unique eventTickers in markets: ${result.uniqueEventTickers}`);
    console.log(`Unique series: ${result.uniqueSeriesTickers}`);
    console.log(`Events fetched: ${result.eventsFound}`);
    console.log(`Events matching markets: ${filteredEvents.length}`);
    console.log(`Coverage: ${((filteredEvents.length / result.uniqueEventTickers) * 100).toFixed(1)}%`);

    if (!dryRun) {
      console.log(`Events created: ${result.eventsCreated}`);
      console.log(`Events updated: ${result.eventsUpdated}`);
      console.log(`Markets linked: ${result.marketsLinked}`);
    }

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('Error:', errMsg);
    result.errors.push(errMsg);
  }

  return result;
}

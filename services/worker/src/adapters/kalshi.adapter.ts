import {
  type Venue,
  type MarketDTO,
  type QuoteDTO,
  type FetchMarketsResult,
  type FetchMarketsParams,
  type MarketStatus,
  type OutcomeSide,
  withRetry,
  HttpError,
  parseRetryAfter,
} from '@data-module/core';
import { type VenueAdapter, type AdapterConfig, DEFAULT_ADAPTER_CONFIG } from './types.js';
import { type KalshiConfig, loadKalshiConfig, formatKalshiConfig, KALSHI_PROD_URL } from './kalshi.config.js';
import { jwtCache } from '../utils/kalshi-auth.js';
import { ProxyAgent } from 'undici';

interface KalshiMarket {
  ticker: string;
  event_ticker: string;
  series_ticker?: string;
  market_type: string;
  title: string;
  subtitle?: string;
  status: 'unopened' | 'open' | 'paused' | 'closed' | 'settled';
  yes_bid: number;
  yes_ask: number;
  no_bid: number;
  no_ask: number;
  last_price: number;
  volume: number;
  volume_24h: number;
  open_interest: number;
  open_time?: string;
  close_time?: string;
  category?: string;
  // v3.0.15: MVE truth fields from API
  mve_collection_ticker?: string | null;
  mve_selected_legs?: Array<{
    event_ticker: string;
    market_ticker: string;
    side: string;
  }> | null;
}

interface KalshiMarketsResponse {
  markets: KalshiMarket[];
  cursor?: string;
}

interface KalshiSeries {
  ticker: string;
  title: string;
  category?: string;
  frequency?: string;
  tags?: string[];
}

interface KalshiSeriesResponse {
  series: KalshiSeries[];
  cursor?: string;
}

interface KalshiEvent {
  event_ticker: string;
  series_ticker: string;
  title: string;
  subtitle?: string;
  category?: string;
  status: string;
  markets?: KalshiMarket[];
}

interface KalshiEventsResponse {
  events: KalshiEvent[];
  cursor?: string;
}

interface KalshiOrderbook {
  orderbook: {
    yes: Array<[number, number]>;
    no: Array<[number, number]>;
  };
}

export interface KalshiAuthConfig {
  apiKeyId: string;
  privateKeyPem: string;
}

export interface KalshiFetchStats {
  pagesCompleted: number;
  totalMarkets: number;
  cursorPresent: boolean;
  seriesFetched?: number;
  eventsFetched?: number;
}

/**
 * Kalshi adapter with full pagination and catalog mode support
 */
export class KalshiAdapter implements VenueAdapter {
  readonly venue: Venue = 'kalshi';
  private readonly config: Required<AdapterConfig>;
  private readonly kalshiConfig: KalshiConfig;
  private readonly auth?: KalshiAuthConfig;
  private readonly proxyAgent?: ProxyAgent;

  constructor(config: AdapterConfig = {}, auth?: KalshiAuthConfig, kalshiConfig?: KalshiConfig) {
    this.kalshiConfig = kalshiConfig || loadKalshiConfig();
    this.config = {
      ...DEFAULT_ADAPTER_CONFIG,
      ...config,
      baseUrl: config.baseUrl || this.kalshiConfig.baseUrl || KALSHI_PROD_URL,
    };
    this.auth = auth;

    // Initialize proxy agent if KALSHI_PROXY_URL is set
    const proxyUrl = process.env.KALSHI_PROXY_URL;
    if (proxyUrl) {
      this.proxyAgent = new ProxyAgent(proxyUrl);
      console.log(`[kalshi] Using proxy: ${proxyUrl}`);
    }

    console.log(formatKalshiConfig(this.kalshiConfig));

    if (auth) {
      console.log('[kalshi] API authentication enabled');
    }
  }

  /**
   * Get the base URL being used
   */
  getBaseUrl(): string {
    return this.config.baseUrl;
  }

  /**
   * Fetch all markets with full pagination
   * Returns ALL markets up to globalCapMarkets
   */
  async fetchAllMarkets(onProgress?: (stats: KalshiFetchStats) => void): Promise<MarketDTO[]> {
    if (this.kalshiConfig.mode === 'catalog') {
      return this.fetchMarketsCatalogMode(onProgress);
    }
    return this.fetchMarketsDirectMode(onProgress);
  }

  /**
   * Direct mode: fetch from /markets endpoint with cursor pagination
   */
  private async fetchMarketsDirectMode(onProgress?: (stats: KalshiFetchStats) => void): Promise<MarketDTO[]> {
    const allMarkets: MarketDTO[] = [];
    let cursor: string | undefined;
    let page = 0;
    const { marketsLimit, maxPages, globalCapMarkets } = this.kalshiConfig;

    console.log(`[kalshi] Starting direct markets fetch (limit=${marketsLimit}, maxPages=${maxPages || 'unlimited'})`);

    do {
      const url = new URL(`${this.config.baseUrl}/markets`);
      url.searchParams.set('limit', String(marketsLimit));
      // Fetch all statuses, not just open
      // Don't set status filter to get all markets

      if (cursor) {
        url.searchParams.set('cursor', cursor);
      }

      const data = await this.fetchWithRetry<KalshiMarketsResponse>(url.toString());
      const items = data.markets.map(m => this.mapMarket(m));
      allMarkets.push(...items);

      cursor = data.cursor || undefined;
      page++;

      const stats: KalshiFetchStats = {
        pagesCompleted: page,
        totalMarkets: allMarkets.length,
        cursorPresent: !!cursor,
      };

      console.log(`[kalshi] Page ${page}: fetched ${items.length}, total ${allMarkets.length}, cursor=${!!cursor}`);
      onProgress?.(stats);

      // Check limits
      if (maxPages > 0 && page >= maxPages) {
        console.log(`[kalshi] Reached max pages limit (${maxPages})`);
        break;
      }

      if (allMarkets.length >= globalCapMarkets) {
        console.log(`[kalshi] Reached global cap (${globalCapMarkets})`);
        break;
      }

      // Small delay between pages to be nice to API
      if (cursor) {
        await this.delay(100);
      }
    } while (cursor);

    console.log(`[kalshi] Direct fetch complete: ${allMarkets.length} markets in ${page} pages`);
    return allMarkets;
  }

  /**
   * Catalog mode: fetch series -> events -> markets
   */
  private async fetchMarketsCatalogMode(onProgress?: (stats: KalshiFetchStats) => void): Promise<MarketDTO[]> {
    const allMarkets: MarketDTO[] = [];
    const { seriesTickers, seriesCategories, eventsStatus, withNestedMarkets, globalCapMarkets } = this.kalshiConfig;
    const seenTickers = new Set<string>();

    console.log(`[kalshi] Starting catalog fetch mode`);

    // Step 1: Get all series
    const series = await this.fetchAllSeries();
    console.log(`[kalshi] Found ${series.length} series`);

    // Filter series by tickers if specified
    let targetSeries = series;
    if (seriesTickers.length > 0) {
      const tickerSet = new Set(seriesTickers.map(t => t.toUpperCase()));
      targetSeries = series.filter(s => tickerSet.has(s.ticker.toUpperCase()));
      console.log(`[kalshi] Filtered to ${targetSeries.length} series by tickers`);
    }

    // Filter series by categories if specified
    if (seriesCategories.length > 0) {
      const categorySet = new Set(seriesCategories.map(c => c.toLowerCase()));
      targetSeries = targetSeries.filter(s => {
        const cat = (s.category || '').toLowerCase();
        return categorySet.has(cat) || seriesCategories.some(c => cat.includes(c));
      });
      console.log(`[kalshi] Filtered to ${targetSeries.length} series by categories: ${seriesCategories.join(', ')}`);
    }

    let eventsFetched = 0;

    // Step 2: For each series, get events with markets
    for (const s of targetSeries) {
      if (allMarkets.length >= globalCapMarkets) {
        console.log(`[kalshi] Reached global cap (${globalCapMarkets})`);
        break;
      }

      console.log(`[kalshi] Fetching events for series: ${s.ticker} (${s.title})`);

      const events = await this.fetchEventsForSeries(s.ticker, eventsStatus, withNestedMarkets);
      eventsFetched += events.length;

      for (const event of events) {
        if (allMarkets.length >= globalCapMarkets) break;

        // If events have nested markets, use them
        if (event.markets && event.markets.length > 0) {
          for (const m of event.markets) {
            if (!seenTickers.has(m.ticker)) {
              seenTickers.add(m.ticker);
              allMarkets.push(this.mapMarket(m));
            }
          }
        } else {
          // Otherwise fetch markets for this event
          const markets = await this.fetchMarketsForEvent(event.event_ticker);
          for (const m of markets) {
            if (!seenTickers.has(m.ticker)) {
              seenTickers.add(m.ticker);
              allMarkets.push(this.mapMarket(m));
            }
          }
        }
      }

      const stats: KalshiFetchStats = {
        pagesCompleted: 0,
        totalMarkets: allMarkets.length,
        cursorPresent: false,
        seriesFetched: targetSeries.indexOf(s) + 1,
        eventsFetched,
      };
      onProgress?.(stats);

      console.log(`[kalshi] Series ${s.ticker}: total markets now ${allMarkets.length}`);
    }

    console.log(`[kalshi] Catalog fetch complete: ${allMarkets.length} markets from ${targetSeries.length} series, ${eventsFetched} events`);
    return allMarkets;
  }

  /**
   * Fetch all series with pagination
   */
  private async fetchAllSeries(): Promise<KalshiSeries[]> {
    const allSeries: KalshiSeries[] = [];
    let cursor: string | undefined;

    do {
      const url = new URL(`${this.config.baseUrl}/series`);
      url.searchParams.set('limit', '200');
      if (cursor) {
        url.searchParams.set('cursor', cursor);
      }

      const data = await this.fetchWithRetry<KalshiSeriesResponse>(url.toString());
      allSeries.push(...data.series);
      cursor = data.cursor || undefined;

      if (cursor) {
        await this.delay(100);
      }
    } while (cursor);

    return allSeries;
  }

  /**
   * Fetch events for a specific series
   */
  private async fetchEventsForSeries(
    seriesTicker: string,
    statuses: string[],
    withNestedMarkets: boolean
  ): Promise<KalshiEvent[]> {
    const allEvents: KalshiEvent[] = [];
    let cursor: string | undefined;

    do {
      const url = new URL(`${this.config.baseUrl}/events`);
      url.searchParams.set('series_ticker', seriesTicker);
      url.searchParams.set('limit', '200');

      if (statuses.length > 0) {
        url.searchParams.set('status', statuses.join(','));
      }

      if (withNestedMarkets) {
        url.searchParams.set('with_nested_markets', 'true');
      }

      if (cursor) {
        url.searchParams.set('cursor', cursor);
      }

      const data = await this.fetchWithRetry<KalshiEventsResponse>(url.toString());
      allEvents.push(...data.events);
      cursor = data.cursor || undefined;

      if (cursor) {
        await this.delay(100);
      }
    } while (cursor);

    return allEvents;
  }

  /**
   * Fetch markets for a specific event
   */
  private async fetchMarketsForEvent(eventTicker: string): Promise<KalshiMarket[]> {
    const url = new URL(`${this.config.baseUrl}/markets`);
    url.searchParams.set('event_ticker', eventTicker);
    url.searchParams.set('limit', '1000');

    const data = await this.fetchWithRetry<KalshiMarketsResponse>(url.toString());
    return data.markets;
  }

  /**
   * Legacy fetchMarkets for compatibility with existing pipeline
   */
  async fetchMarkets(params?: FetchMarketsParams): Promise<FetchMarketsResult> {
    const limit = params?.limit ?? this.config.pageSize;
    const cursor = params?.cursor;

    const url = new URL(`${this.config.baseUrl}/markets`);
    url.searchParams.set('limit', String(limit));
    // Don't filter by status to get all markets

    if (cursor) {
      url.searchParams.set('cursor', cursor);
    }

    const data = await this.fetchWithRetry<KalshiMarketsResponse>(url.toString());
    const items = data.markets.map(m => this.mapMarket(m));
    const nextCursor = data.cursor || undefined;

    return { items, nextCursor };
  }

  async fetchQuotes(markets: MarketDTO[]): Promise<QuoteDTO[]> {
    if (this.auth) {
      return this.fetchQuotesWithOrderbook(markets);
    }
    return this.fetchQuotesFromMetadata(markets);
  }

  private async fetchQuotesWithOrderbook(markets: MarketDTO[]): Promise<QuoteDTO[]> {
    const quotes: QuoteDTO[] = [];
    const now = new Date();

    for (const market of markets) {
      try {
        const orderbook = await this.fetchOrderbook(market.externalId);

        if (orderbook.orderbook.yes?.length > 0) {
          const bestBid = orderbook.orderbook.yes[0];
          const totalLiquidity = orderbook.orderbook.yes.reduce((sum, [, qty]) => sum + qty, 0);
          const yesPrice = bestBid[0] / 100;

          quotes.push({
            marketExternalId: market.externalId,
            outcomeName: 'Yes',
            ts: now,
            price: yesPrice,
            impliedProb: yesPrice,
            liquidity: totalLiquidity,
            raw: {
              orderbookDepth: orderbook.orderbook.yes.length,
              levels: orderbook.orderbook.yes.slice(0, 5),
            },
          });
        }

        if (orderbook.orderbook.no?.length > 0) {
          const bestBid = orderbook.orderbook.no[0];
          const totalLiquidity = orderbook.orderbook.no.reduce((sum, [, qty]) => sum + qty, 0);
          const noPrice = bestBid[0] / 100;

          quotes.push({
            marketExternalId: market.externalId,
            outcomeName: 'No',
            ts: now,
            price: noPrice,
            impliedProb: noPrice,
            liquidity: totalLiquidity,
            raw: {
              orderbookDepth: orderbook.orderbook.no.length,
              levels: orderbook.orderbook.no.slice(0, 5),
            },
          });
        }
      } catch (err) {
        console.warn(`[kalshi] Failed to fetch orderbook for ${market.externalId}: ${err}`);
        const metaQuotes = this.quotesFromMetadata(market, now);
        quotes.push(...metaQuotes);
      }
    }

    return quotes;
  }

  private async fetchOrderbook(ticker: string): Promise<KalshiOrderbook> {
    const url = `${this.config.baseUrl}/markets/${ticker}/orderbook`;
    return this.fetchWithRetry<KalshiOrderbook>(url);
  }

  private fetchQuotesFromMetadata(markets: MarketDTO[]): QuoteDTO[] {
    const quotes: QuoteDTO[] = [];
    const now = new Date();

    for (const market of markets) {
      quotes.push(...this.quotesFromMetadata(market, now));
    }

    return quotes;
  }

  private quotesFromMetadata(market: MarketDTO, now: Date): QuoteDTO[] {
    const quotes: QuoteDTO[] = [];
    const meta = market.metadata as {
      yesBid?: number;
      yesAsk?: number;
      noBid?: number;
      noAsk?: number;
      lastPrice?: number;
      volume?: number;
      openInterest?: number;
    } | undefined;

    if (!meta) return quotes;

    if (meta.yesBid !== undefined && meta.yesAsk !== undefined) {
      const yesPrice = (meta.yesBid + meta.yesAsk) / 2 / 100;

      quotes.push({
        marketExternalId: market.externalId,
        outcomeName: 'Yes',
        ts: now,
        price: yesPrice,
        impliedProb: yesPrice,
        volume: meta.volume,
        raw: { bid: meta.yesBid, ask: meta.yesAsk, lastPrice: meta.lastPrice },
      });
    }

    if (meta.noBid !== undefined && meta.noAsk !== undefined) {
      const noPrice = (meta.noBid + meta.noAsk) / 2 / 100;

      quotes.push({
        marketExternalId: market.externalId,
        outcomeName: 'No',
        ts: now,
        price: noPrice,
        impliedProb: noPrice,
        volume: meta.volume,
        raw: { bid: meta.noBid, ask: meta.noAsk },
      });
    }

    return quotes;
  }

  private mapMarket(m: KalshiMarket): MarketDTO {
    let status: MarketStatus;
    switch (m.status) {
      case 'open':
      case 'unopened':
        status = 'active';
        break;
      case 'paused':
      case 'closed':
        status = 'closed';
        break;
      case 'settled':
        status = 'resolved';
        break;
      default:
        status = 'active';
    }

    const outcomes: Array<{ name: string; side: OutcomeSide; metadata?: Record<string, unknown> }> = [
      {
        name: 'Yes',
        side: 'yes',
        metadata: { bid: m.yes_bid, ask: m.yes_ask },
      },
      {
        name: 'No',
        side: 'no',
        metadata: { bid: m.no_bid, ask: m.no_ask },
      },
    ];

    return {
      externalId: m.ticker,
      title: m.title + (m.subtitle ? ` - ${m.subtitle}` : ''),
      category: m.category || m.event_ticker,
      status,
      closeTime: m.close_time ? new Date(m.close_time) : undefined,
      outcomes,
      metadata: {
        marketTicker: m.ticker, // v2.6.2: Also store market ticker in metadata
        eventTicker: m.event_ticker,
        seriesTicker: m.series_ticker,
        marketType: m.market_type,
        yesBid: m.yes_bid,
        yesAsk: m.yes_ask,
        noBid: m.no_bid,
        noAsk: m.no_ask,
        lastPrice: m.last_price,
        volume: m.volume,
        volume24h: m.volume_24h,
        openInterest: m.open_interest,
        // v3.0.15: MVE truth fields from API
        mveCollectionTicker: m.mve_collection_ticker || null,
        mveSelectedLegs: m.mve_selected_legs || null,
      },
    };
  }

  private async fetchWithRetry<T>(url: string): Promise<T> {
    return withRetry(
      async () => {
        const response = await this.fetchWithTimeout(url);
        if (!response.ok) {
          // Try to read the error response body
          let errorBody = '';
          try {
            errorBody = await response.text();
            console.log(`[kalshi] Error response body: ${errorBody}`);
          } catch (e) {
            // Ignore if we can't read the body
          }

          const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'));
          throw new HttpError(
            `Kalshi API error: ${response.status} ${response.statusText}${errorBody ? `: ${errorBody}` : ''}`,
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
          console.warn(`[kalshi] Retry ${attempt} in ${delayMs}ms: ${err.message}`);
        },
      }
    );
  }

  private async fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    // Build headers with JWT auth if available
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    // Copy existing headers if present
    if (options.headers) {
      const existing = options.headers as Record<string, string>;
      Object.assign(headers, existing);
    }

    // Add JWT authentication if configured
    if (this.auth) {
      const token = jwtCache.get({
        apiKeyId: this.auth.apiKeyId,
        privateKeyPem: this.auth.privateKeyPem,
        expiresIn: 300, // 5 minutes
      });
      headers['Authorization'] = `Bearer ${token}`;
      console.log(`[kalshi] JWT token generated (first 20 chars): ${token.substring(0, 20)}...`);
      console.log(`[kalshi] Authorization header: Bearer ${token.substring(0, 20)}...`);
    }

    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
        headers,
        // @ts-ignore - dispatcher is supported by undici-based fetch
        dispatcher: this.proxyAgent,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Smoke test: fetch a single market by ticker
   * Returns status code and market info if successful
   */
  async smokeTestTicker(ticker: string): Promise<{
    ticker: string;
    status: number;
    title?: string;
    category?: string;
    error?: string;
  }> {
    const url = `${this.config.baseUrl}/markets/${ticker}`;

    try {
      const response = await this.fetchWithTimeout(url);

      if (response.ok) {
        const data = await response.json() as { market: KalshiMarket };
        return {
          ticker,
          status: response.status,
          title: data.market?.title,
          category: data.market?.category || data.market?.event_ticker,
        };
      }

      return {
        ticker,
        status: response.status,
        error: response.statusText,
      };
    } catch (err) {
      return {
        ticker,
        status: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Get all series with categories (for discovery)
   */
  async getAllSeriesWithCategories(): Promise<Array<{
    ticker: string;
    title: string;
    category: string;
    tags: string[];
  }>> {
    const series = await this.fetchAllSeries();
    return series.map(s => ({
      ticker: s.ticker,
      title: s.title,
      category: s.category || 'unknown',
      tags: s.tags || [],
    }));
  }
}

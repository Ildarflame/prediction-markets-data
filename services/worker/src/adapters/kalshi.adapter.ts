import {
  type Venue,
  type MarketDTO,
  type QuoteDTO,
  type FetchMarketsResult,
  type FetchMarketsParams,
  type MarketStatus,
  type OutcomeSide,
  withRetry,
} from '@data-module/core';
import { type VenueAdapter, type AdapterConfig, DEFAULT_ADAPTER_CONFIG } from './types.js';

const KALSHI_API_BASE = 'https://api.elections.kalshi.com/trade-api/v2';

interface KalshiMarket {
  ticker: string;
  event_ticker: string;
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
}

interface KalshiMarketsResponse {
  markets: KalshiMarket[];
  cursor: string;
}

/**
 * Kalshi adapter using public API endpoints
 * Note: Orderbook endpoint requires authentication, using market bid/ask instead
 */
export class KalshiAdapter implements VenueAdapter {
  readonly venue: Venue = 'kalshi';
  private readonly config: Required<AdapterConfig>;

  constructor(config: AdapterConfig = {}) {
    this.config = {
      ...DEFAULT_ADAPTER_CONFIG,
      ...config,
      baseUrl: config.baseUrl || KALSHI_API_BASE,
    };
  }

  async fetchMarkets(params?: FetchMarketsParams): Promise<FetchMarketsResult> {
    const limit = params?.limit ?? this.config.pageSize;
    const cursor = params?.cursor;

    const url = new URL('/markets', this.config.baseUrl);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('status', 'open');

    if (cursor) {
      url.searchParams.set('cursor', cursor);
    }

    const response = await withRetry(
      () => this.fetchWithTimeout(url.toString()),
      {
        maxAttempts: 3,
        baseDelayMs: 1000,
        onRetry: (err, attempt) => {
          console.warn(`[kalshi] fetchMarkets retry ${attempt}: ${err.message}`);
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Kalshi API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as KalshiMarketsResponse;

    const items: MarketDTO[] = data.markets.map((m) => this.mapMarket(m));

    // Kalshi returns empty cursor for last page
    const nextCursor = data.cursor || undefined;

    return { items, nextCursor };
  }

  async fetchQuotes(markets: MarketDTO[]): Promise<QuoteDTO[]> {
    const quotes: QuoteDTO[] = [];
    const now = new Date();

    // For Kalshi, we already have bid/ask prices from the markets endpoint
    // No need for separate API calls
    for (const market of markets) {
      const meta = market.metadata as {
        yesBid?: number;
        yesAsk?: number;
        noBid?: number;
        noAsk?: number;
        lastPrice?: number;
        volume?: number;
        openInterest?: number;
      } | undefined;

      if (!meta) continue;

      // Yes outcome quote
      if (meta.yesBid !== undefined && meta.yesAsk !== undefined) {
        const yesPrice = (meta.yesBid + meta.yesAsk) / 2 / 100; // Convert cents to dollars

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

      // No outcome quote
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
    }

    return quotes;
  }

  private mapMarket(m: KalshiMarket): MarketDTO {
    // Map status
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

    // Binary market with Yes/No outcomes
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
        eventTicker: m.event_ticker,
        marketType: m.market_type,
        yesBid: m.yes_bid,
        yesAsk: m.yes_ask,
        noBid: m.no_bid,
        noAsk: m.no_ask,
        lastPrice: m.last_price,
        volume: m.volume,
        volume24h: m.volume_24h,
        openInterest: m.open_interest,
      },
    };
  }

  private async fetchWithTimeout(
    url: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          ...options.headers,
          'Accept': 'application/json',
        },
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

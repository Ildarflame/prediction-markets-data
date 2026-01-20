import * as crypto from 'node:crypto';
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

interface KalshiOrderbook {
  orderbook: {
    yes: Array<[number, number]>; // [price, quantity]
    no: Array<[number, number]>;
  };
}

export interface KalshiAuthConfig {
  apiKeyId: string;
  privateKeyPem: string;
}

/**
 * Kalshi adapter with optional API authentication for orderbook access
 */
export class KalshiAdapter implements VenueAdapter {
  readonly venue: Venue = 'kalshi';
  private readonly config: Required<AdapterConfig>;
  private readonly auth?: KalshiAuthConfig;

  constructor(config: AdapterConfig = {}, auth?: KalshiAuthConfig) {
    this.config = {
      ...DEFAULT_ADAPTER_CONFIG,
      ...config,
      baseUrl: config.baseUrl || KALSHI_API_BASE,
    };
    this.auth = auth;

    if (auth) {
      console.log('[kalshi] API authentication enabled - full orderbook access available');
    } else {
      console.log('[kalshi] No API auth - using public bid/ask from markets endpoint');
    }
  }

  async fetchMarkets(params?: FetchMarketsParams): Promise<FetchMarketsResult> {
    const limit = params?.limit ?? this.config.pageSize;
    const cursor = params?.cursor;

    const url = new URL(`${this.config.baseUrl}/markets`);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('status', 'open');

    if (cursor) {
      url.searchParams.set('cursor', cursor);
    }

    // Markets endpoint is public - no auth needed
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
    // If we have auth, fetch full orderbook for each market
    if (this.auth) {
      return this.fetchQuotesWithOrderbook(markets);
    }

    // Otherwise use bid/ask from markets metadata
    return this.fetchQuotesFromMetadata(markets);
  }

  /**
   * Fetch quotes using full orderbook (requires auth)
   */
  private async fetchQuotesWithOrderbook(markets: MarketDTO[]): Promise<QuoteDTO[]> {
    const quotes: QuoteDTO[] = [];
    const now = new Date();

    for (const market of markets) {
      try {
        const orderbook = await this.fetchOrderbook(market.externalId);

        // Process Yes side
        if (orderbook.orderbook.yes.length > 0) {
          const bestBid = orderbook.orderbook.yes[0];
          const totalLiquidity = orderbook.orderbook.yes.reduce((sum, [, qty]) => sum + qty, 0);
          const yesPrice = bestBid[0] / 100; // Convert cents to dollars

          quotes.push({
            marketExternalId: market.externalId,
            outcomeName: 'Yes',
            ts: now,
            price: yesPrice,
            impliedProb: yesPrice,
            liquidity: totalLiquidity,
            raw: {
              orderbookDepth: orderbook.orderbook.yes.length,
              levels: orderbook.orderbook.yes.slice(0, 5), // Top 5 levels
            },
          });
        }

        // Process No side
        if (orderbook.orderbook.no.length > 0) {
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
        // Fallback to metadata
        const metaQuotes = this.quotesFromMetadata(market, now);
        quotes.push(...metaQuotes);
      }
    }

    return quotes;
  }

  /**
   * Fetch orderbook for a specific market (public endpoint)
   */
  private async fetchOrderbook(ticker: string): Promise<KalshiOrderbook> {
    const url = `${this.config.baseUrl}/markets/${ticker}/orderbook`;

    const response = await withRetry(
      () => this.fetchWithTimeout(url),
      {
        maxAttempts: 3,
        baseDelayMs: 1000,
      }
    );

    if (!response.ok) {
      throw new Error(`Kalshi orderbook API error: ${response.status}`);
    }

    return (await response.json()) as KalshiOrderbook;
  }

  /**
   * Fetch with Kalshi API authentication (RSA-PSS signature)
   */
  private async fetchWithAuth(
    url: string,
    method: string,
    path: string
  ): Promise<Response> {
    if (!this.auth) {
      throw new Error('Auth required but not configured');
    }

    const timestamp = Date.now().toString();
    // Remove query parameters from path for signature (Kalshi requirement)
    const pathWithoutQuery = path.split('?')[0];
    const message = timestamp + method + pathWithoutQuery;


    // Sign with RSA-PSS SHA256
    const signature = crypto.sign('sha256', Buffer.from(message), {
      key: this.auth.privateKeyPem,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      return await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'KALSHI-ACCESS-KEY': this.auth.apiKeyId,
          'KALSHI-ACCESS-TIMESTAMP': timestamp,
          'KALSHI-ACCESS-SIGNATURE': signature.toString('base64'),
        },
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Fetch quotes from market metadata (no auth needed)
   */
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

    // Yes outcome quote
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

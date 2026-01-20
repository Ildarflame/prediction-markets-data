import {
  type Venue,
  type MarketDTO,
  type QuoteDTO,
  type FetchMarketsResult,
  type FetchMarketsParams,
  type MarketStatus,
  type OutcomeSide,
  withRetry,
  batch,
} from '@data-module/core';
import { type VenueAdapter, type AdapterConfig, DEFAULT_ADAPTER_CONFIG } from './types.js';

const GAMMA_API_BASE = 'https://gamma-api.polymarket.com';
const CLOB_API_BASE = 'https://clob.polymarket.com';

interface GammaMarket {
  id: number;
  question: string;
  conditionId: string;
  slug: string;
  outcomes: string[];
  outcomePrices: string[];
  clobTokenIds: string[];
  active: boolean;
  closed: boolean;
  enableOrderBook: boolean;
  liquidity: string;
  volume: string;
  bestBid?: string;
  bestAsk?: string;
  lastTradePrice?: string;
  endDate?: string;
  groupItemTitle?: string;
  category?: string;
}

interface ClobBook {
  market: string;
  asset_id: string;
  timestamp: string;
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
}

/**
 * Polymarket adapter using Gamma API for markets and CLOB API for prices
 */
export class PolymarketAdapter implements VenueAdapter {
  readonly venue: Venue = 'polymarket';
  private readonly config: Required<AdapterConfig>;

  constructor(config: AdapterConfig = {}) {
    this.config = {
      ...DEFAULT_ADAPTER_CONFIG,
      ...config,
      baseUrl: config.baseUrl || GAMMA_API_BASE,
    };
  }

  async fetchMarkets(params?: FetchMarketsParams): Promise<FetchMarketsResult> {
    const limit = params?.limit ?? this.config.pageSize;
    const offset = params?.cursor ? parseInt(params.cursor, 10) : 0;

    const url = new URL('/markets', this.config.baseUrl);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('active', 'true');
    url.searchParams.set('closed', 'false');

    const response = await withRetry(
      () => this.fetchWithTimeout(url.toString()),
      {
        maxAttempts: 3,
        baseDelayMs: 1000,
        onRetry: (err, attempt) => {
          console.warn(`[polymarket] fetchMarkets retry ${attempt}: ${err.message}`);
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Gamma API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as GammaMarket[];

    const items: MarketDTO[] = data.map((m) => this.mapMarket(m));

    // Determine if there are more results
    const nextCursor = data.length === limit ? String(offset + limit) : undefined;

    return { items, nextCursor };
  }

  async fetchQuotes(markets: MarketDTO[]): Promise<QuoteDTO[]> {
    const quotes: QuoteDTO[] = [];
    const now = new Date();

    // Collect all token IDs with their market/outcome mapping
    const tokenMap = new Map<string, { marketExternalId: string; outcomeName: string; side: OutcomeSide }>();

    for (const market of markets) {
      const tokenIds = (market.metadata?.clobTokenIds as string[]) || [];
      const outcomes = market.outcomes;

      for (let i = 0; i < Math.min(tokenIds.length, outcomes.length); i++) {
        tokenMap.set(tokenIds[i], {
          marketExternalId: market.externalId,
          outcomeName: outcomes[i].name,
          side: outcomes[i].side,
        });
      }
    }

    // Batch fetch orderbooks
    const tokenIds = Array.from(tokenMap.keys());
    const batches = batch(tokenIds, 50);

    for (const tokenBatch of batches) {
      try {
        const books = await this.fetchBooks(tokenBatch);

        for (const book of books) {
          const mapping = tokenMap.get(book.asset_id);
          if (!mapping) continue;

          // Calculate mid price from best bid/ask
          const bestBid = book.bids[0]?.price ? parseFloat(book.bids[0].price) : null;
          const bestAsk = book.asks[0]?.price ? parseFloat(book.asks[0].price) : null;

          let price: number;
          if (bestBid !== null && bestAsk !== null) {
            price = (bestBid + bestAsk) / 2;
          } else if (bestBid !== null) {
            price = bestBid;
          } else if (bestAsk !== null) {
            price = bestAsk;
          } else {
            continue; // No price available
          }

          // Calculate liquidity as sum of best bid/ask sizes
          const bidLiquidity = book.bids[0]?.size ? parseFloat(book.bids[0].size) : 0;
          const askLiquidity = book.asks[0]?.size ? parseFloat(book.asks[0].size) : 0;

          quotes.push({
            marketExternalId: mapping.marketExternalId,
            outcomeExternalId: book.asset_id,
            outcomeName: mapping.outcomeName,
            ts: now,
            price,
            impliedProb: price, // For binary markets, price ≈ implied probability
            liquidity: bidLiquidity + askLiquidity,
          });
        }
      } catch (err) {
        console.error(`[polymarket] Error fetching books batch: ${err}`);
      }
    }

    return quotes;
  }

  private async fetchBooks(tokenIds: string[]): Promise<ClobBook[]> {
    const url = `${CLOB_API_BASE}/books`;

    const response = await withRetry(
      () =>
        this.fetchWithTimeout(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tokenIds.map((id) => ({ token_id: id }))),
        }),
      {
        maxAttempts: 3,
        baseDelayMs: 1000,
      }
    );

    if (!response.ok) {
      throw new Error(`CLOB API error: ${response.status}`);
    }

    return (await response.json()) as ClobBook[];
  }

  private mapMarket(m: GammaMarket): MarketDTO {
    // Map status
    let status: MarketStatus;
    if (!m.active && m.closed) {
      status = 'resolved';
    } else if (m.closed) {
      status = 'closed';
    } else if (m.active) {
      status = 'active';
    } else {
      status = 'closed';
    }

    // Map outcomes
    const outcomes = m.outcomes.map((name, i): { externalId?: string; name: string; side: OutcomeSide; metadata?: Record<string, unknown> } => {
      const side: OutcomeSide =
        name.toLowerCase() === 'yes' ? 'yes' : name.toLowerCase() === 'no' ? 'no' : 'other';

      return {
        externalId: m.clobTokenIds[i],
        name,
        side,
        metadata: {
          price: m.outcomePrices[i],
        },
      };
    });

    return {
      externalId: String(m.id),
      title: m.question,
      category: m.category || m.groupItemTitle,
      status,
      closeTime: m.endDate ? new Date(m.endDate) : undefined,
      outcomes,
      metadata: {
        conditionId: m.conditionId,
        slug: m.slug,
        clobTokenIds: m.clobTokenIds,
        liquidity: m.liquidity,
        volume: m.volume,
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
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

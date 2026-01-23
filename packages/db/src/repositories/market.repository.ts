import type { PrismaClient, Market, Outcome, Venue, MarketStatus } from '@prisma/client';
import type { MarketDTO } from '@data-module/core';
import { processInChunks } from '../utils/chunked-processor.js';

export interface MarketWithOutcomes extends Market {
  outcomes: Outcome[];
}

export interface UpsertMarketsResult {
  created: number;
  updated: number;
  /** v2.6.4: Micro-batch processing stats */
  stats?: {
    batches: number;
    retries: number;
    batchSizeReductions: number;
    timeMs: number;
    errors: string[];
    /** v2.6.4: Count of batches skipped due to persistent errors */
    skippedBatches: number;
    /** v2.6.4: Items in skipped batches */
    skippedItems: number;
    /** v2.6.4: Final batch size after reductions */
    finalBatchSize: number;
  };
}

/**
 * Repository for market operations
 */
export class MarketRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Upsert markets and their outcomes in batches
   *
   * v2.6.4: Uses micro-batches with automatic batch size reduction on
   * NAPI/memory AND transaction timeout errors.
   * Default batch size reduced to 50 (from 200) to prevent transaction timeouts.
   */
  async upsertMarkets(
    venue: Venue,
    markets: MarketDTO[],
    batchSize = parseInt(process.env.KALSHI_DB_BATCH || '50', 10)
  ): Promise<UpsertMarketsResult> {
    let created = 0;
    let updated = 0;

    const processBatch = async (batch: MarketDTO[]): Promise<void> => {
      // v2.6.4: Add explicit timeout for transaction (30 seconds max)
      await this.prisma.$transaction(async (tx) => {
        for (const market of batch) {
          const existing = await tx.market.findUnique({
            where: {
              venue_externalId: {
                venue,
                externalId: market.externalId,
              },
            },
            // v2.6.3: Only select id, don't load metadata to reduce memory
            select: { id: true },
          });

          if (existing) {
            // Update market
            await tx.market.update({
              where: { id: existing.id },
              data: {
                title: market.title,
                category: market.category,
                status: market.status as MarketStatus,
                statusMeta: market.statusMeta as object | undefined,
                closeTime: market.closeTime,
                sourceUpdatedAt: market.sourceUpdatedAt,
                metadata: market.metadata as object,
                // v3.0.2: Polymarket taxonomy fields
                pmCategories: market.pmCategories as object | undefined,
                pmTags: market.pmTags as object | undefined,
                pmEventCategory: market.pmEventCategory,
                pmEventSubcategory: market.pmEventSubcategory,
                taxonomySource: market.taxonomySource,
              },
            });
            updated++;

            // Upsert outcomes
            for (const outcome of market.outcomes) {
              await tx.outcome.upsert({
                where: {
                  marketId_name: {
                    marketId: existing.id,
                    name: outcome.name,
                  },
                },
                create: {
                  marketId: existing.id,
                  externalId: outcome.externalId,
                  name: outcome.name,
                  side: outcome.side,
                  metadata: outcome.metadata as object,
                },
                update: {
                  externalId: outcome.externalId,
                  side: outcome.side,
                  metadata: outcome.metadata as object,
                },
              });
            }
          } else {
            // Create new market with outcomes
            await tx.market.create({
              data: {
                venue,
                externalId: market.externalId,
                title: market.title,
                category: market.category,
                status: market.status as MarketStatus,
                statusMeta: market.statusMeta as object | undefined,
                closeTime: market.closeTime,
                sourceUpdatedAt: market.sourceUpdatedAt,
                metadata: market.metadata as object,
                // v3.0.2: Polymarket taxonomy fields
                pmCategories: market.pmCategories as object | undefined,
                pmTags: market.pmTags as object | undefined,
                pmEventCategory: market.pmEventCategory,
                pmEventSubcategory: market.pmEventSubcategory,
                taxonomySource: market.taxonomySource,
                outcomes: {
                  create: market.outcomes.map((o) => ({
                    externalId: o.externalId,
                    name: o.name,
                    side: o.side,
                    metadata: o.metadata as object,
                  })),
                },
              },
            });
            created++;
          }
        }
      });
    };

    // v2.6.4: Use micro-batch processor with automatic retry and batch size reduction
    const stats = await processInChunks(markets, processBatch, {
      batchSize,
      minBatchSize: parseInt(process.env.KALSHI_DB_MIN_BATCH || '5', 10),
      maxRetries: 3,
      logPrefix: '[market-upsert]',
      verbose: process.env.KALSHI_VERBOSE === 'true',
    });

    return {
      created,
      updated,
      stats: {
        batches: stats.batches,
        retries: stats.retries,
        batchSizeReductions: stats.batchSizeReductions,
        timeMs: stats.timeMs,
        errors: stats.errors,
        // v2.6.4: Track skipped batches
        skippedBatches: stats.skippedBatches,
        skippedItems: stats.skippedItems,
        finalBatchSize: stats.finalBatchSize,
      },
    };
  }

  /**
   * Get active markets for a venue with their outcomes
   * v2.6.5: Added optional limit parameter to prevent OOM on large datasets
   */
  async getActiveMarkets(venue: Venue, limit?: number): Promise<MarketWithOutcomes[]> {
    return this.prisma.market.findMany({
      where: {
        venue,
        status: {
          in: ['active', 'closed'],
        },
      },
      include: {
        outcomes: true,
      },
      ...(limit ? { take: limit, orderBy: { updatedAt: 'desc' } } : {}),
    });
  }

  /**
   * Get markets eligible for quotes sync:
   * - all active markets
   * - closed markets within lookback window (if closeTime is set)
   */
  async getMarketsForQuotesSync(
    venue: Venue,
    closedLookbackHours = 24
  ): Promise<MarketWithOutcomes[]> {
    const lookbackCutoff = new Date(Date.now() - closedLookbackHours * 60 * 60 * 1000);

    return this.prisma.market.findMany({
      where: {
        venue,
        OR: [
          { status: 'active' },
          {
            status: 'closed',
            closeTime: { gte: lookbackCutoff },
          },
        ],
      },
      include: {
        outcomes: true,
      },
    });
  }

  /**
   * Get markets for quotes sync with pagination (for large datasets)
   * Uses cursor-based pagination for round-robin access
   */
  async getMarketsForQuotesSyncPaginated(
    venue: Venue,
    options: {
      closedLookbackHours?: number;
      limit?: number;
      afterId?: number;
    } = {}
  ): Promise<{ markets: MarketWithOutcomes[]; nextCursor: number | null; totalEligible: number }> {
    const { closedLookbackHours = 24, limit = 2000, afterId } = options;
    const lookbackCutoff = new Date(Date.now() - closedLookbackHours * 60 * 60 * 1000);

    const whereClause = {
      venue,
      OR: [
        { status: 'active' as const },
        {
          status: 'closed' as const,
          closeTime: { gte: lookbackCutoff },
        },
      ],
    };

    // Get total count of eligible markets
    const totalEligible = await this.prisma.market.count({ where: whereClause });

    // Fetch paginated markets
    const markets = await this.prisma.market.findMany({
      where: {
        ...whereClause,
        ...(afterId ? { id: { gt: afterId } } : {}),
      },
      include: {
        outcomes: true,
      },
      orderBy: { id: 'asc' },
      take: limit,
    });

    // Determine next cursor
    let nextCursor: number | null = null;
    if (markets.length === limit) {
      nextCursor = markets[markets.length - 1].id;
    }

    return { markets, nextCursor, totalEligible };
  }

  /**
   * Get market by venue and external ID
   */
  async getByExternalId(
    venue: Venue,
    externalId: string
  ): Promise<MarketWithOutcomes | null> {
    return this.prisma.market.findUnique({
      where: {
        venue_externalId: {
          venue,
          externalId,
        },
      },
      include: {
        outcomes: true,
      },
    });
  }

  /**
   * Update market status
   */
  async updateStatus(id: number, status: MarketStatus): Promise<Market> {
    return this.prisma.market.update({
      where: { id },
      data: { status },
    });
  }

  /**
   * Archive old markets
   * - resolved markets older than resolvedDays
   * - closed markets without resolution older than closedDays
   */
  async archiveOldMarkets(
    resolvedDays = 30,
    closedDays = 14
  ): Promise<{ archived: number }> {
    const now = new Date();
    const resolvedCutoff = new Date(now.getTime() - resolvedDays * 24 * 60 * 60 * 1000);
    const closedCutoff = new Date(now.getTime() - closedDays * 24 * 60 * 60 * 1000);

    const result = await this.prisma.market.updateMany({
      where: {
        status: { not: 'archived' },
        OR: [
          // Resolved markets older than resolvedDays
          {
            status: 'resolved',
            updatedAt: { lt: resolvedCutoff },
          },
          // Closed markets (not resolved) older than closedDays
          {
            status: 'closed',
            closeTime: { lt: closedCutoff },
          },
        ],
      },
      data: {
        status: 'archived',
      },
    });

    return { archived: result.count };
  }

  /**
   * Get market counts by status for a venue
   */
  async getStatusCounts(venue: Venue): Promise<Record<MarketStatus, number>> {
    const counts = await this.prisma.market.groupBy({
      by: ['status'],
      where: { venue },
      _count: { status: true },
    });

    const result: Record<MarketStatus, number> = {
      active: 0,
      closed: 0,
      resolved: 0,
      archived: 0,
    };

    for (const c of counts) {
      result[c.status] = c._count.status;
    }

    return result;
  }

  /**
   * Eligible market data for matching
   */
  /**
   * Get markets eligible for matching:
   * - status: active or closed within lookback
   * - binary markets: exactly 2 outcomes with sides yes/no
   *
   * v2.4.4: Added orderBy option to support different sorting strategies
   * - 'id': Order by ID desc (default, for general matching - newest markets first)
   * - 'closeTime': Order by closeTime desc (for macro matching - markets closing soon first)
   */
  async listEligibleMarkets(
    venue: Venue,
    options: {
      lookbackHours?: number;
      limit?: number;
      titleKeywords?: string[];
      /** Sort order: 'id' (default) or 'closeTime' (v2.4.4) */
      orderBy?: 'id' | 'closeTime';
    } = {}
  ): Promise<EligibleMarket[]> {
    const { lookbackHours = 24, limit = 5000, titleKeywords, orderBy = 'id' } = options;
    const lookbackCutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

    // Build where clause
    const statusConditions = [
      { status: 'active' as const },
      {
        status: 'closed' as const,
        closeTime: { gte: lookbackCutoff },
      },
    ];

    // Add keyword filter if specified (use AND to combine with status)
    let whereClause: any = {
      venue,
      OR: statusConditions,
    };

    if (titleKeywords && titleKeywords.length > 0) {
      whereClause = {
        AND: [
          { venue },
          { OR: statusConditions },
          {
            OR: titleKeywords.map(kw => ({
              title: { contains: kw, mode: 'insensitive' as const },
            })),
          },
        ],
      };
    }

    // Get markets with outcomes
    // v2.4.4: Use orderBy parameter to support different sorting strategies
    // - 'id' (default): newest markets first (for general matching)
    // - 'closeTime': markets closing soon first (for macro matching - includes old active markets)
    const markets = await this.prisma.market.findMany({
      where: whereClause,
      include: {
        outcomes: true,
      },
      orderBy: orderBy === 'closeTime'
        ? { closeTime: 'desc' }
        : { id: 'desc' },
      take: limit,
    });

    // Filter to binary markets (2 outcomes, yes/no sides)
    const eligible: EligibleMarket[] = [];

    for (const market of markets) {
      if (market.outcomes.length !== 2) continue;

      const sides = market.outcomes.map((o) => o.side);
      const hasYes = sides.includes('yes');
      const hasNo = sides.includes('no');

      if (!hasYes || !hasNo) continue;

      eligible.push({
        id: market.id,
        title: market.title,
        category: market.category,
        status: market.status,
        closeTime: market.closeTime,
        venue: market.venue,
        metadata: market.metadata as Record<string, unknown> | null,
        // v3.0.12: Include kalshiEventTicker for SPORTS enrichment
        kalshiEventTicker: market.kalshiEventTicker,
        // v3.0.14: Include isMve for MVE detection
        isMve: market.isMve,
      });
    }

    return eligible;
  }

  /**
   * List eligible crypto markets with token-safe regex patterns (v2.5.2)
   *
   * Uses PostgreSQL regex (~*) for word-boundary matching of tickers:
   * - "eth" matches "ETH price" and "$ETH" but NOT "Hegseth"
   * - "btc" matches "BTC price" and "$BTC" but NOT "BTCXYZ"
   * - "sol" matches "SOL price" and "$SOL" but NOT "solution"
   *
   * @param venue - Venue to search
   * @param options.lookbackHours - Hours to look back for closed markets
   * @param options.limit - Maximum markets to return
   * @param options.fullNameKeywords - Full name keywords (use ILIKE contains)
   * @param options.tickerPatterns - Ticker regex patterns for word-boundary matching
   * @param options.orderBy - Sort order ('closeTime' recommended for crypto)
   */
  async listEligibleMarketsCrypto(
    venue: Venue,
    options: {
      lookbackHours?: number;
      limit?: number;
      /** Full name keywords like 'bitcoin', 'ethereum' (ILIKE contains) */
      fullNameKeywords?: string[];
      /** Ticker regex patterns like '(^|[^a-z0-9])\\$?eth([^a-z0-9]|$)' */
      tickerPatterns?: string[];
      orderBy?: 'id' | 'closeTime';
    } = {}
  ): Promise<EligibleMarket[]> {
    const {
      lookbackHours = 720,
      limit = 5000,
      fullNameKeywords = [],
      tickerPatterns = [],
      orderBy = 'closeTime',
    } = options;

    const lookbackCutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

    // Build raw SQL for regex matching
    // PostgreSQL ~* is case-insensitive regex match
    const conditions: string[] = [];
    const params: any[] = [venue, lookbackCutoff];
    let paramIndex = 3;

    // Add full name keywords (ILIKE)
    for (const kw of fullNameKeywords) {
      conditions.push(`title ILIKE $${paramIndex}`);
      params.push(`%${kw}%`);
      paramIndex++;
    }

    // Add ticker regex patterns (~*)
    for (const pattern of tickerPatterns) {
      conditions.push(`title ~* $${paramIndex}`);
      params.push(pattern);
      paramIndex++;
    }

    if (conditions.length === 0) {
      // No keywords/patterns - return empty
      return [];
    }

    const keywordCondition = conditions.join(' OR ');
    const orderByClause = orderBy === 'closeTime' ? 'close_time DESC NULLS LAST' : 'id DESC';

    // Raw query for regex support
    // Note: Prisma maps "Market" model to "markets" table (@@map), columns to snake_case
    // Cast venue to "Venue" enum type for PostgreSQL compatibility
    // v3.0.12: Added kalshi_event_ticker for SPORTS enrichment
    // v3.0.14: Added is_mve for MVE detection
    const query = `
      SELECT m.id, m.title, m.category, m.status, m.close_time as "closeTime", m.venue, m.metadata, m.kalshi_event_ticker as "kalshiEventTicker", m.is_mve as "isMve"
      FROM markets m
      WHERE m.venue = $1::"Venue"
        AND (m.status = 'active' OR (m.status = 'closed' AND m.close_time >= $2))
        AND (${keywordCondition})
      ORDER BY ${orderByClause}
      LIMIT ${limit}
    `;

    const markets = await this.prisma.$queryRawUnsafe<Array<{
      id: number;
      title: string;
      category: string | null;
      status: string;
      closeTime: Date | null;
      venue: Venue;
      metadata: Record<string, unknown> | null;
      kalshiEventTicker: string | null;
      isMve: boolean | null;
    }>>(query, ...params);

    // Get outcomes for binary market filtering
    const marketIds = markets.map(m => m.id);
    if (marketIds.length === 0) return [];

    const outcomes = await this.prisma.outcome.findMany({
      where: { marketId: { in: marketIds } },
      select: { marketId: true, side: true },
    });

    // Group outcomes by market
    const outcomesByMarket = new Map<number, string[]>();
    for (const o of outcomes) {
      if (!outcomesByMarket.has(o.marketId)) {
        outcomesByMarket.set(o.marketId, []);
      }
      outcomesByMarket.get(o.marketId)!.push(o.side);
    }

    // Filter to binary markets (2 outcomes, yes/no sides)
    const eligible: EligibleMarket[] = [];
    for (const market of markets) {
      const sides = outcomesByMarket.get(market.id) || [];
      if (sides.length !== 2) continue;
      if (!sides.includes('yes') || !sides.includes('no')) continue;

      eligible.push({
        id: market.id,
        title: market.title,
        category: market.category,
        status: market.status,
        closeTime: market.closeTime,
        venue: market.venue,
        metadata: market.metadata,
        // v3.0.12: Include kalshiEventTicker for SPORTS enrichment
        kalshiEventTicker: market.kalshiEventTicker,
        // v3.0.14: Include isMve for MVE detection
        isMve: market.isMve,
      });
    }

    return eligible;
  }

  /**
   * List eligible markets by derivedTopic (v3.0.13)
   *
   * More precise than keyword matching for topics like SPORTS.
   * Uses the derivedTopic field set by taxonomy backfill.
   */
  async listMarketsByDerivedTopic(
    topic: string,
    options: {
      venue: Venue;
      lookbackHours?: number;
      limit?: number;
    }
  ): Promise<EligibleMarket[]> {
    const { venue, lookbackHours = 720, limit = 10000 } = options;
    const lookbackCutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

    const markets = await this.prisma.market.findMany({
      where: {
        venue,
        derivedTopic: topic,
        OR: [
          { status: 'active' },
          { status: 'closed', closeTime: { gte: lookbackCutoff } },
        ],
      },
      include: { outcomes: true },
      orderBy: { id: 'desc' },
      take: limit,
    });

    // Filter to binary markets (2 outcomes, yes/no sides)
    const eligible: EligibleMarket[] = [];

    for (const market of markets) {
      if (market.outcomes.length !== 2) continue;

      const sides = market.outcomes.map((o) => o.side);
      const hasYes = sides.includes('yes');
      const hasNo = sides.includes('no');

      if (!hasYes || !hasNo) continue;

      eligible.push({
        id: market.id,
        title: market.title,
        category: market.category,
        status: market.status,
        closeTime: market.closeTime,
        venue: market.venue,
        metadata: market.metadata as Record<string, unknown> | null,
        kalshiEventTicker: market.kalshiEventTicker,
        // v3.0.14: Include isMve for MVE detection
        isMve: market.isMve,
      });
    }

    return eligible;
  }
}

/**
 * Simplified market data for matching
 */
export interface EligibleMarket {
  id: number;
  title: string;
  category: string | null;
  status: string;
  closeTime: Date | null;
  venue: Venue;
  metadata?: Record<string, unknown> | null;
  // v3.0.12: Link to Kalshi event for SPORTS enrichment
  kalshiEventTicker?: string | null;
  // v3.0.14: MVE detection for Kalshi SPORTS
  isMve?: boolean | null;
}

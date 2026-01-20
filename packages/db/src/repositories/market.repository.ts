import type { PrismaClient, Market, Outcome, Venue, MarketStatus } from '@prisma/client';
import type { MarketDTO } from '@data-module/core';

export interface MarketWithOutcomes extends Market {
  outcomes: Outcome[];
}

export interface UpsertMarketsResult {
  created: number;
  updated: number;
}

/**
 * Repository for market operations
 */
export class MarketRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Upsert markets and their outcomes in batches
   */
  async upsertMarkets(
    venue: Venue,
    markets: MarketDTO[],
    batchSize = 100
  ): Promise<UpsertMarketsResult> {
    let created = 0;
    let updated = 0;

    // Process in batches
    for (let i = 0; i < markets.length; i += batchSize) {
      const batch = markets.slice(i, i + batchSize);

      await this.prisma.$transaction(async (tx) => {
        for (const market of batch) {
          const existing = await tx.market.findUnique({
            where: {
              venue_externalId: {
                venue,
                externalId: market.externalId,
              },
            },
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
    }

    return { created, updated };
  }

  /**
   * Get active markets for a venue with their outcomes
   */
  async getActiveMarkets(venue: Venue): Promise<MarketWithOutcomes[]> {
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
        closeTime: market.closeTime,
        venue: market.venue,
        metadata: market.metadata as Record<string, unknown> | null,
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
  closeTime: Date | null;
  venue: Venue;
  metadata?: Record<string, unknown> | null;
}

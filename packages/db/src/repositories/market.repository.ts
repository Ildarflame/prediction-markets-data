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
                closeTime: market.closeTime,
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
                closeTime: market.closeTime,
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
}

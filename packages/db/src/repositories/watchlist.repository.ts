/**
 * WatchlistRepository - Manage quote_watchlist table (v2.6.7)
 *
 * The watchlist defines which markets we should actively fetch quotes for,
 * instead of trying to quote all 1.2M markets.
 */

import type { PrismaClient, QuoteWatchlist, Venue } from '@prisma/client';

export interface WatchlistItem {
  venue: Venue;
  marketId: number;
  priority: number;
  reason: string;
}

export interface WatchlistStats {
  total: number;
  byVenue: Record<string, number>;
  byReason: Record<string, number>;
  byPriority: { priority: number; count: number }[];
}

export interface WatchlistWithMarket extends QuoteWatchlist {
  market: {
    id: number;
    externalId: string;
    title: string;
    status: string;
    closeTime: Date | null;
  };
}

/**
 * Repository for quote watchlist operations
 */
export class WatchlistRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Upsert many watchlist items
   * If exists, updates priority and reason
   */
  async upsertMany(items: WatchlistItem[]): Promise<{ created: number; updated: number }> {
    if (items.length === 0) return { created: 0, updated: 0 };

    let created = 0;
    let updated = 0;

    // Process in batches to avoid huge transactions
    const batchSize = 100;
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);

      await this.prisma.$transaction(async (tx) => {
        for (const item of batch) {
          const existing = await tx.quoteWatchlist.findUnique({
            where: {
              venue_marketId: {
                venue: item.venue,
                marketId: item.marketId,
              },
            },
          });

          if (existing) {
            // Update if priority is higher or reason changed
            if (item.priority > existing.priority || item.reason !== existing.reason) {
              await tx.quoteWatchlist.update({
                where: { id: existing.id },
                data: {
                  priority: Math.max(item.priority, existing.priority),
                  reason: item.priority >= existing.priority ? item.reason : existing.reason,
                },
              });
            }
            updated++;
          } else {
            await tx.quoteWatchlist.create({
              data: {
                venue: item.venue,
                marketId: item.marketId,
                priority: item.priority,
                reason: item.reason,
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
   * List watchlist items for a venue, ordered by priority desc
   */
  async list(options: {
    venue: Venue;
    limit?: number;
    offset?: number;
    includeMarket?: boolean;
  }): Promise<WatchlistWithMarket[]> {
    const { venue, limit = 100, offset = 0, includeMarket = true } = options;

    return this.prisma.quoteWatchlist.findMany({
      where: { venue },
      include: includeMarket
        ? {
            market: {
              select: {
                id: true,
                externalId: true,
                title: true,
                status: true,
                closeTime: true,
              },
            },
          }
        : undefined,
      orderBy: { priority: 'desc' },
      take: limit,
      skip: offset,
    }) as Promise<WatchlistWithMarket[]>;
  }

  /**
   * Get market IDs from watchlist for quotes sync
   */
  async getMarketIdsForQuotes(
    venue: Venue,
    limit: number
  ): Promise<{ marketId: number; priority: number }[]> {
    const items = await this.prisma.quoteWatchlist.findMany({
      where: { venue },
      select: { marketId: true, priority: true },
      orderBy: { priority: 'desc' },
      take: limit,
    });

    return items;
  }

  /**
   * Get statistics about the watchlist
   */
  async getStats(venue?: Venue): Promise<WatchlistStats> {
    const whereClause = venue ? { venue } : {};

    // Total count
    const total = await this.prisma.quoteWatchlist.count({ where: whereClause });

    // By venue
    const venueGroups = await this.prisma.quoteWatchlist.groupBy({
      by: ['venue'],
      where: whereClause,
      _count: { venue: true },
    });
    const byVenue: Record<string, number> = {};
    for (const g of venueGroups) {
      byVenue[g.venue] = g._count.venue;
    }

    // By reason
    const reasonGroups = await this.prisma.quoteWatchlist.groupBy({
      by: ['reason'],
      where: whereClause,
      _count: { reason: true },
    });
    const byReason: Record<string, number> = {};
    for (const g of reasonGroups) {
      byReason[g.reason] = g._count.reason;
    }

    // By priority
    const priorityGroups = await this.prisma.quoteWatchlist.groupBy({
      by: ['priority'],
      where: whereClause,
      _count: { priority: true },
    });
    const byPriority = priorityGroups
      .map((g) => ({ priority: g.priority, count: g._count.priority }))
      .sort((a, b) => b.priority - a.priority);

    return { total, byVenue, byReason, byPriority };
  }

  /**
   * Cleanup old watchlist entries
   */
  async cleanup(options: {
    olderThanDays: number;
    reason?: string;
    venue?: Venue;
    dryRun?: boolean;
  }): Promise<{ count: number; samples: QuoteWatchlist[] }> {
    const { olderThanDays, reason, venue, dryRun = false } = options;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const whereClause: Record<string, unknown> = {
      updatedAt: { lt: cutoffDate },
    };

    if (reason) {
      whereClause.reason = reason;
    }

    if (venue) {
      whereClause.venue = venue;
    }

    // Get samples before deletion
    const samples = await this.prisma.quoteWatchlist.findMany({
      where: whereClause,
      take: 20,
      orderBy: { updatedAt: 'asc' },
    });

    if (dryRun) {
      const count = await this.prisma.quoteWatchlist.count({ where: whereClause });
      return { count, samples };
    }

    const result = await this.prisma.quoteWatchlist.deleteMany({
      where: whereClause,
    });

    return { count: result.count, samples };
  }

  /**
   * Remove specific markets from watchlist
   */
  async remove(venue: Venue, marketIds: number[]): Promise<number> {
    if (marketIds.length === 0) return 0;

    const result = await this.prisma.quoteWatchlist.deleteMany({
      where: {
        venue,
        marketId: { in: marketIds },
      },
    });

    return result.count;
  }

  /**
   * Check if a market is in the watchlist
   */
  async isWatched(venue: Venue, marketId: number): Promise<boolean> {
    const count = await this.prisma.quoteWatchlist.count({
      where: { venue, marketId },
    });
    return count > 0;
  }
}

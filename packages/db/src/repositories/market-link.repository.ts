import type { PrismaClient, MarketLink, Venue, LinkStatus, Market, Outcome } from '@prisma/client';

export interface MarketLinkWithMarkets extends MarketLink {
  leftMarket: Market & { outcomes: Outcome[] };
  rightMarket: Market & { outcomes: Outcome[] };
}

export interface ListSuggestionsOptions {
  minScore?: number;
  status?: LinkStatus;
  limit?: number;
  offset?: number;
}

export interface UpsertSuggestionResult {
  link: MarketLink;
  created: boolean;
}

/**
 * Repository for market link operations
 */
export class MarketLinkRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Upsert a suggestion
   * If pair exists and status != confirmed, update score/reason
   * If pair exists and status == confirmed, skip
   */
  async upsertSuggestion(
    leftVenue: Venue,
    leftMarketId: number,
    rightVenue: Venue,
    rightMarketId: number,
    score: number,
    reason: string | null
  ): Promise<UpsertSuggestionResult> {
    // Check if exists
    const existing = await this.prisma.marketLink.findUnique({
      where: {
        leftVenue_leftMarketId_rightVenue_rightMarketId: {
          leftVenue,
          leftMarketId,
          rightVenue,
          rightMarketId,
        },
      },
    });

    if (existing) {
      // If confirmed, don't update
      if (existing.status === 'confirmed') {
        return { link: existing, created: false };
      }

      // Update score/reason for suggested/rejected
      const updated = await this.prisma.marketLink.update({
        where: { id: existing.id },
        data: {
          score,
          reason,
          status: 'suggested', // Reset to suggested if was rejected
        },
      });

      return { link: updated, created: false };
    }

    // Create new
    const link = await this.prisma.marketLink.create({
      data: {
        leftVenue,
        leftMarketId,
        rightVenue,
        rightMarketId,
        score,
        reason,
        status: 'suggested',
      },
    });

    return { link, created: true };
  }

  /**
   * List suggestions with optional filters
   */
  async listSuggestions(options: ListSuggestionsOptions = {}): Promise<MarketLinkWithMarkets[]> {
    const { minScore = 0, status, limit = 50, offset = 0 } = options;

    return this.prisma.marketLink.findMany({
      where: {
        score: { gte: minScore },
        ...(status ? { status } : {}),
      },
      include: {
        leftMarket: { include: { outcomes: true } },
        rightMarket: { include: { outcomes: true } },
      },
      orderBy: { score: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  /**
   * Get link by ID with market details
   */
  async getById(id: number): Promise<MarketLinkWithMarkets | null> {
    return this.prisma.marketLink.findUnique({
      where: { id },
      include: {
        leftMarket: { include: { outcomes: true } },
        rightMarket: { include: { outcomes: true } },
      },
    });
  }

  /**
   * Confirm a link
   */
  async confirm(id: number): Promise<MarketLink> {
    return this.prisma.marketLink.update({
      where: { id },
      data: { status: 'confirmed' },
    });
  }

  /**
   * Reject a link
   */
  async reject(id: number): Promise<MarketLink> {
    return this.prisma.marketLink.update({
      where: { id },
      data: { status: 'rejected' },
    });
  }

  /**
   * Check if a market already has a confirmed link
   */
  async hasConfirmedLink(venue: Venue, marketId: number): Promise<boolean> {
    const count = await this.prisma.marketLink.count({
      where: {
        status: 'confirmed',
        OR: [
          { leftVenue: venue, leftMarketId: marketId },
          { rightVenue: venue, rightMarketId: marketId },
        ],
      },
    });

    return count > 0;
  }

  /**
   * Get confirmed links for a venue
   */
  async getConfirmedLinks(venue: Venue): Promise<MarketLinkWithMarkets[]> {
    return this.prisma.marketLink.findMany({
      where: {
        status: 'confirmed',
        OR: [{ leftVenue: venue }, { rightVenue: venue }],
      },
      include: {
        leftMarket: { include: { outcomes: true } },
        rightMarket: { include: { outcomes: true } },
      },
      orderBy: { score: 'desc' },
    });
  }

  /**
   * Count links by status
   */
  async countByStatus(): Promise<Record<LinkStatus, number>> {
    const counts = await this.prisma.marketLink.groupBy({
      by: ['status'],
      _count: { status: true },
    });

    const result: Record<LinkStatus, number> = {
      suggested: 0,
      confirmed: 0,
      rejected: 0,
    };

    for (const c of counts) {
      result[c.status] = c._count.status;
    }

    return result;
  }
}

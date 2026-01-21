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
   * v2.6.2: Added algoVersion parameter
   * v2.6.3: Added topic parameter (derived from algoVersion if not provided)
   */
  async upsertSuggestion(
    leftVenue: Venue,
    leftMarketId: number,
    rightVenue: Venue,
    rightMarketId: number,
    score: number,
    reason: string | null,
    algoVersion?: string | null,
    topic?: string | null
  ): Promise<UpsertSuggestionResult> {
    // v2.6.3: Derive topic from algoVersion if not provided
    const effectiveTopic = topic ?? (algoVersion?.split('@')[0] || null);

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
          algoVersion,
          topic: effectiveTopic,
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
        algoVersion,
        topic: effectiveTopic,
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

  /**
   * v2.6.2: Get link statistics grouped by status and algoVersion
   */
  async getStats(): Promise<{
    byStatus: Record<LinkStatus, number>;
    byAlgoVersion: Array<{ algoVersion: string | null; count: number }>;
    byTopic: Array<{ topic: string; count: number }>;
    total: number;
  }> {
    // Count by status
    const statusCounts = await this.prisma.marketLink.groupBy({
      by: ['status'],
      _count: { status: true },
    });

    const byStatus: Record<LinkStatus, number> = {
      suggested: 0,
      confirmed: 0,
      rejected: 0,
    };

    let total = 0;
    for (const c of statusCounts) {
      byStatus[c.status] = c._count.status;
      total += c._count.status;
    }

    // Count by algoVersion
    const versionCounts = await this.prisma.marketLink.groupBy({
      by: ['algoVersion'],
      _count: { algoVersion: true },
    });

    const byAlgoVersion = versionCounts.map(c => ({
      algoVersion: c.algoVersion,
      count: c._count.algoVersion,
    })).sort((a, b) => b.count - a.count);

    // v2.6.3: Count by actual topic field (with fallback to algoVersion-derived topic)
    const topicCounts = await this.prisma.marketLink.groupBy({
      by: ['topic'],
      _count: { topic: true },
    });

    // Build topic counts map, also derive from algoVersion for null topics
    const topicMap = new Map<string, number>();
    for (const t of topicCounts) {
      if (t.topic) {
        topicMap.set(t.topic, (topicMap.get(t.topic) || 0) + t._count.topic);
      }
    }

    // For records without topic field, mark as legacy
    // v2.6.3+ all new records will have topic set
    const nullTopicCount = topicCounts.find(t => t.topic === null)?._count.topic || 0;
    if (nullTopicCount > 0) {
      topicMap.set('legacy (no topic)', nullTopicCount);
    }

    const byTopic = [...topicMap.entries()].map(([topic, count]) => ({ topic, count })).sort((a, b) => b.count - a.count);

    return { byStatus, byAlgoVersion, byTopic, total };
  }

  /**
   * v2.6.2: Delete old suggestions matching criteria
   * v2.6.3: Added topic filter
   * Returns count of deleted links
   */
  async cleanupSuggestions(options: {
    olderThanDays: number;
    status?: LinkStatus | 'all';
    algoVersion?: string;
    topic?: string;
    dryRun?: boolean;
  }): Promise<{ count: number; matches: MarketLink[] }> {
    const { olderThanDays, status = 'suggested', algoVersion, topic, dryRun = false } = options;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const whereClause: Record<string, unknown> = {
      updatedAt: { lt: cutoffDate },
    };

    if (status !== 'all') {
      whereClause.status = status;
    }

    if (algoVersion) {
      whereClause.algoVersion = algoVersion;
    }

    if (topic) {
      whereClause.topic = topic;
    }

    // Get matching links first
    const matches = await this.prisma.marketLink.findMany({
      where: whereClause,
      take: 1000, // Limit for safety
    });

    if (dryRun) {
      return { count: matches.length, matches };
    }

    // Delete matching links
    const result = await this.prisma.marketLink.deleteMany({
      where: whereClause,
    });

    return { count: result.count, matches };
  }

  /**
   * Confirm a link by pair (venue + marketId) - v2.6.0
   * Creates the link if it doesn't exist, or updates status to confirmed
   * Returns info about what happened
   */
  async confirmByPair(
    leftVenue: Venue,
    leftMarketId: number,
    rightVenue: Venue,
    rightMarketId: number,
    score: number,
    reason: string | null
  ): Promise<{ link: MarketLink; created: boolean; wasAlreadyConfirmed: boolean }> {
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
      if (existing.status === 'confirmed') {
        // Already confirmed, no changes needed
        return { link: existing, created: false, wasAlreadyConfirmed: true };
      }

      // Update to confirmed
      const updated = await this.prisma.marketLink.update({
        where: { id: existing.id },
        data: {
          status: 'confirmed',
          score,
          reason,
        },
      });

      return { link: updated, created: false, wasAlreadyConfirmed: false };
    }

    // Create new confirmed link
    const link = await this.prisma.marketLink.create({
      data: {
        leftVenue,
        leftMarketId,
        rightVenue,
        rightMarketId,
        score,
        reason,
        status: 'confirmed',
      },
    });

    return { link, created: true, wasAlreadyConfirmed: false };
  }
}

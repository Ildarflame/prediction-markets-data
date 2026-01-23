/**
 * Kalshi Event Repository (v3.0.12)
 *
 * Repository for Kalshi event operations.
 * Events contain team names and strike dates critical for SPORTS matching.
 */

import type { PrismaClient, KalshiEvent } from '@prisma/client';

export interface KalshiEventDTO {
  eventTicker: string;
  seriesTicker: string;
  title: string;
  subTitle?: string | null;
  category?: string | null;
  status?: string | null;
  strikeDate?: Date | null;
  mutuallyExclusive?: boolean;
  marketCount?: number;
}

export interface UpsertEventsResult {
  created: number;
  updated: number;
  errors: string[];
}

export interface EventSyncStats {
  totalEvents: number;
  linkedMarkets: number;
  unlinkedMarkets: number;
  topSeriesTickers: Array<{ seriesTicker: string; count: number }>;
}

/**
 * Repository for Kalshi event operations
 */
export class KalshiEventRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Upsert events in batches
   */
  async upsertEvents(events: KalshiEventDTO[], batchSize = 100): Promise<UpsertEventsResult> {
    let created = 0;
    let updated = 0;
    const errors: string[] = [];
    const now = new Date();

    for (let i = 0; i < events.length; i += batchSize) {
      const batch = events.slice(i, i + batchSize);

      try {
        await this.prisma.$transaction(async (tx) => {
          for (const event of batch) {
            const existing = await tx.kalshiEvent.findUnique({
              where: { eventTicker: event.eventTicker },
              select: { id: true },
            });

            if (existing) {
              await tx.kalshiEvent.update({
                where: { id: existing.id },
                data: {
                  seriesTicker: event.seriesTicker,
                  title: event.title,
                  subTitle: event.subTitle,
                  category: event.category,
                  status: event.status,
                  strikeDate: event.strikeDate,
                  mutuallyExclusive: event.mutuallyExclusive ?? false,
                  marketCount: event.marketCount ?? 0,
                  lastSyncAt: now,
                },
              });
              updated++;
            } else {
              await tx.kalshiEvent.create({
                data: {
                  eventTicker: event.eventTicker,
                  seriesTicker: event.seriesTicker,
                  title: event.title,
                  subTitle: event.subTitle,
                  category: event.category,
                  status: event.status,
                  strikeDate: event.strikeDate,
                  mutuallyExclusive: event.mutuallyExclusive ?? false,
                  marketCount: event.marketCount ?? 0,
                  lastSyncAt: now,
                },
              });
              created++;
            }
          }
        });
      } catch (err) {
        errors.push(`Batch ${i / batchSize + 1}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { created, updated, errors };
  }

  /**
   * Get event by ticker
   */
  async getByTicker(eventTicker: string): Promise<KalshiEvent | null> {
    return this.prisma.kalshiEvent.findUnique({
      where: { eventTicker },
    });
  }

  /**
   * Get events by series ticker
   */
  async getBySeriesTicker(seriesTicker: string, limit = 1000): Promise<KalshiEvent[]> {
    return this.prisma.kalshiEvent.findMany({
      where: { seriesTicker },
      orderBy: { strikeDate: 'desc' },
      take: limit,
    });
  }

  /**
   * Get events with upcoming strike dates
   */
  async getUpcoming(lookbackDays = 14, limit = 5000): Promise<KalshiEvent[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - lookbackDays);

    return this.prisma.kalshiEvent.findMany({
      where: {
        AND: [
          {
            OR: [
              { strikeDate: { gte: cutoff } },
              { strikeDate: null },  // Include events without strike date
            ],
          },
          {
            OR: [
              { status: 'open' },
              { status: null },
            ],
          },
        ],
      },
      orderBy: { strikeDate: 'asc' },
      take: limit,
    });
  }

  /**
   * Link markets to their events by extracting eventTicker from metadata
   */
  async linkMarketsToEvents(dryRun = false): Promise<{ linked: number; alreadyLinked: number; noEvent: number }> {
    // Find Kalshi markets with eventTicker in metadata but no kalshiEventTicker field
    const marketsToLink = await this.prisma.$queryRaw<Array<{ id: number; eventTicker: string }>>`
      SELECT m.id, m.metadata->>'eventTicker' as "eventTicker"
      FROM markets m
      WHERE m.venue = 'kalshi'
        AND m.metadata->>'eventTicker' IS NOT NULL
        AND m.kalshi_event_ticker IS NULL
      LIMIT 50000
    `;

    if (dryRun) {
      return {
        linked: 0,
        alreadyLinked: 0,
        noEvent: marketsToLink.length,
      };
    }

    let linked = 0;
    let noEvent = 0;

    // Batch update
    const batchSize = 1000;
    for (let i = 0; i < marketsToLink.length; i += batchSize) {
      const batch = marketsToLink.slice(i, i + batchSize);
      const eventTickers = [...new Set(batch.map(m => m.eventTicker))];

      // Check which events exist
      const existingEvents = await this.prisma.kalshiEvent.findMany({
        where: { eventTicker: { in: eventTickers } },
        select: { eventTicker: true },
      });
      const existingSet = new Set(existingEvents.map(e => e.eventTicker));

      for (const market of batch) {
        if (existingSet.has(market.eventTicker)) {
          await this.prisma.market.update({
            where: { id: market.id },
            data: { kalshiEventTicker: market.eventTicker },
          });
          linked++;
        } else {
          noEvent++;
        }
      }
    }

    // Count already linked
    const alreadyLinkedCount = await this.prisma.market.count({
      where: {
        venue: 'kalshi',
        kalshiEventTicker: { not: null },
      },
    });

    return { linked, alreadyLinked: alreadyLinkedCount - linked, noEvent };
  }

  /**
   * Get sync stats for SPORTS markets
   */
  async getSportsStats(derivedTopic = 'SPORTS'): Promise<EventSyncStats> {
    const totalEvents = await this.prisma.kalshiEvent.count();

    const linkedMarkets = await this.prisma.market.count({
      where: {
        venue: 'kalshi',
        derivedTopic,
        kalshiEventTicker: { not: null },
      },
    });

    const unlinkedMarkets = await this.prisma.market.count({
      where: {
        venue: 'kalshi',
        derivedTopic,
        kalshiEventTicker: null,
      },
    });

    // Top series by event count
    const topSeries = await this.prisma.kalshiEvent.groupBy({
      by: ['seriesTicker'],
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 10,
    });

    return {
      totalEvents,
      linkedMarkets,
      unlinkedMarkets,
      topSeriesTickers: topSeries.map(s => ({
        seriesTicker: s.seriesTicker,
        count: s._count.id,
      })),
    };
  }

  /**
   * Get events map for a list of event tickers (for batch lookup)
   */
  async getEventsMap(eventTickers: string[]): Promise<Map<string, KalshiEvent>> {
    const events = await this.prisma.kalshiEvent.findMany({
      where: { eventTicker: { in: eventTickers } },
    });

    return new Map(events.map(e => [e.eventTicker, e]));
  }

  /**
   * Count events by series ticker
   */
  async countBySeriesTicker(): Promise<Map<string, number>> {
    const counts = await this.prisma.kalshiEvent.groupBy({
      by: ['seriesTicker'],
      _count: { id: true },
    });

    return new Map(counts.map(c => [c.seriesTicker, c._count.id]));
  }
}

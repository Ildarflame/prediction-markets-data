import type { PrismaClient, Quote, LatestQuote, Venue } from '@prisma/client';
import type { DedupConfig } from '@data-module/core';
import { shouldRecordQuote, QuoteDeduplicator, DEFAULT_DEDUP_CONFIG } from '@data-module/core';
import { processInChunks, chunkArray } from '../utils/chunked-processor.js';

export interface InsertQuotesResult {
  inserted: number;
  skipped: number;
  skippedInCycle: number;
  /** v2.6.3: Chunked processing stats */
  stats?: {
    batches: number;
    retries: number;
    batchSizeReductions: number;
    timeMs: number;
  };
}

export interface QuoteInput {
  outcomeId: number;
  ts: Date;
  price: number;
  impliedProb: number;
  liquidity?: number;
  volume?: number;
  raw?: Record<string, unknown>;
}

/**
 * Repository for quote operations
 */
export class QuoteRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly dedupConfig: DedupConfig = DEFAULT_DEDUP_CONFIG
  ) {}

  /**
   * Insert quotes with deduplication
   * Uses latest_quotes table for dedup check + in-cycle deduplicator
   *
   * v2.6.3: Uses chunked processing with automatic batch size reduction
   * on NAPI/memory errors. Also batches latest quote upserts.
   */
  async insertQuotesWithDedup(
    quotes: QuoteInput[],
    batchSize = parseInt(process.env.KALSHI_QUOTE_BATCH || '500', 10)
  ): Promise<InsertQuotesResult> {
    let inserted = 0;
    let skipped = 0;
    let skippedInCycle = 0;

    // In-cycle deduplicator to prevent duplicates within same run
    const cycleDedup = new QuoteDeduplicator(this.dedupConfig);

    // Get current latest quotes for all outcomes
    // v2.6.3: Chunk the outcome IDs query too for large datasets
    const outcomeIds = [...new Set(quotes.map((q) => q.outcomeId))];
    const latestMap = new Map<number, LatestQuote>();

    // Fetch latest quotes in chunks to avoid large IN queries
    const outcomeChunks = chunkArray(outcomeIds, 1000);
    for (const chunk of outcomeChunks) {
      const latestQuotes = await this.prisma.latestQuote.findMany({
        where: {
          outcomeId: { in: chunk },
        },
        // v2.6.3: Don't load raw field when checking for dedup
        select: {
          outcomeId: true,
          ts: true,
          price: true,
          impliedProb: true,
          liquidity: true,
          volume: true,
        },
      });
      for (const lq of latestQuotes) {
        latestMap.set(lq.outcomeId, lq as LatestQuote);
      }
    }

    // Filter quotes based on dedup rules
    const quotesToInsert: QuoteInput[] = [];
    const latestUpdates = new Map<number, QuoteInput>();

    for (const quote of quotes) {
      // Check in-cycle dedup first
      if (cycleDedup.isDuplicate(quote.outcomeId, quote.price, quote.ts)) {
        skippedInCycle++;
        continue;
      }

      const latest = latestMap.get(quote.outcomeId);

      const shouldRecord = shouldRecordQuote(
        quote.price,
        latest?.price ?? null,
        latest?.ts ?? null,
        quote.ts,
        this.dedupConfig
      );

      if (shouldRecord) {
        quotesToInsert.push(quote);
        // Track latest for each outcome
        const existing = latestUpdates.get(quote.outcomeId);
        if (!existing || quote.ts > existing.ts) {
          latestUpdates.set(quote.outcomeId, quote);
        }
      } else {
        skipped++;
      }
    }

    // v2.6.3: Use chunked processor for quote insertion
    const insertStats = await processInChunks(
      quotesToInsert,
      async (batch) => {
        await this.prisma.quote.createMany({
          data: batch.map((q) => ({
            outcomeId: q.outcomeId,
            ts: q.ts,
            price: q.price,
            impliedProb: q.impliedProb,
            liquidity: q.liquidity,
            volume: q.volume,
            raw: q.raw as object | undefined,
          })),
          skipDuplicates: true,
        });
        inserted += batch.length;
      },
      {
        batchSize,
        minBatchSize: parseInt(process.env.KALSHI_DB_MIN_BATCH || '50', 10),
        maxRetries: 3,
        logPrefix: '[quote-insert]',
        verbose: process.env.KALSHI_VERBOSE === 'true',
      }
    );

    // v2.6.3: Batch upsert latest quotes instead of individual upserts
    const latestUpdatesList = [...latestUpdates.entries()];
    const latestBatchSize = parseInt(process.env.KALSHI_LATEST_BATCH || '100', 10);

    await processInChunks(
      latestUpdatesList,
      async (batch) => {
        // Use transaction for batch of latest quote upserts
        await this.prisma.$transaction(
          batch.map(([outcomeId, quote]) =>
            this.prisma.latestQuote.upsert({
              where: { outcomeId },
              create: {
                outcomeId,
                ts: quote.ts,
                price: quote.price,
                impliedProb: quote.impliedProb,
                liquidity: quote.liquidity,
                volume: quote.volume,
                raw: quote.raw as object | undefined,
              },
              update: {
                ts: quote.ts,
                price: quote.price,
                impliedProb: quote.impliedProb,
                liquidity: quote.liquidity,
                volume: quote.volume,
                raw: quote.raw as object | undefined,
              },
            })
          )
        );
      },
      {
        batchSize: latestBatchSize,
        minBatchSize: 10,
        maxRetries: 3,
        logPrefix: '[latest-upsert]',
        verbose: process.env.KALSHI_VERBOSE === 'true',
      }
    );

    return {
      inserted,
      skipped,
      skippedInCycle,
      stats: {
        batches: insertStats.batches,
        retries: insertStats.retries,
        batchSizeReductions: insertStats.batchSizeReductions,
        timeMs: insertStats.timeMs,
      },
    };
  }

  /**
   * Get latest quote for an outcome
   */
  async getLatestQuote(outcomeId: number): Promise<LatestQuote | null> {
    return this.prisma.latestQuote.findUnique({
      where: { outcomeId },
    });
  }

  /**
   * Get quote history for an outcome
   */
  async getQuoteHistory(
    outcomeId: number,
    limit = 100,
    offset = 0
  ): Promise<Quote[]> {
    return this.prisma.quote.findMany({
      where: { outcomeId },
      orderBy: { ts: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  /**
   * Count quotes for a venue
   */
  async countQuotes(venue: Venue): Promise<number> {
    const result = await this.prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*)::bigint as count
      FROM quotes q
      JOIN outcomes o ON q.outcome_id = o.id
      JOIN markets m ON o.market_id = m.id
      WHERE m.venue = ${venue}::"Venue"
    `;
    return Number(result[0].count);
  }

  /**
   * Get count of outcomes with fresh latest quotes
   */
  async countFreshLatestQuotes(
    venue: Venue,
    maxAgeMinutes = 10
  ): Promise<{ total: number; fresh: number }> {
    const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000);

    const result = await this.prisma.$queryRaw<[{ total: bigint; fresh: bigint }]>`
      SELECT
        COUNT(*)::bigint as total,
        COUNT(CASE WHEN lq.ts >= ${cutoff} THEN 1 END)::bigint as fresh
      FROM outcomes o
      JOIN markets m ON o.market_id = m.id
      LEFT JOIN latest_quotes lq ON o.id = lq.outcome_id
      WHERE m.venue = ${venue}::"Venue"
      AND m.status IN ('active', 'closed')
    `;

    return {
      total: Number(result[0].total),
      fresh: Number(result[0].fresh),
    };
  }
}

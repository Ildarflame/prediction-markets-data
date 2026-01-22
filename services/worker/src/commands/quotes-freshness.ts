/**
 * Quotes Freshness Check (v2.6.6)
 *
 * Diagnoses how fresh quotes are across markets:
 * - How many latest_quotes were updated recently
 * - Top stale markets (oldest quotes)
 * - Coverage: freshCount / eligibleCount
 *
 * Run: pnpm --filter @data-module/worker quotes:freshness --venue kalshi --minutes 10
 */

import { getClient, type Venue } from '@data-module/db';

export interface QuotesFreshnessOptions {
  venue: Venue;
  /** Minutes to consider "fresh" */
  minutes?: number;
  /** Max stale samples to show */
  limit?: number;
}

export interface StaleMarketSample {
  id: number;
  title: string;
  outcomeId: number;
  outcomeName: string;
  lastQuoteTs: Date;
  ageMinutes: number;
}

export interface QuotesFreshnessResult {
  venue: Venue;
  eligibleMarkets: number;
  eligibleOutcomes: number;
  freshOutcomes: number;
  staleOutcomes: number;
  coveragePercent: number;
  freshnessMinutes: number;
  staleSamples: StaleMarketSample[];
  cursor: {
    current: string | null;
    jobName: string;
  } | null;
}

export async function runQuotesFreshness(
  options: QuotesFreshnessOptions
): Promise<QuotesFreshnessResult> {
  const { venue, minutes = 10, limit = 20 } = options;
  const prisma = getClient();
  const now = new Date();
  const freshnessThreshold = new Date(now.getTime() - minutes * 60 * 1000);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[quotes:freshness] Quotes Freshness Check (v2.6.6)`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Venue: ${venue}`);
  console.log(`Freshness threshold: ${minutes} minutes (since ${freshnessThreshold.toISOString()})`);
  console.log();

  // 1. Count eligible markets (active + recently closed)
  const eligibleMarkets = await prisma.market.count({
    where: {
      venue,
      status: {
        in: ['active', 'closed'],
      },
    },
  });

  // 2. Count eligible outcomes (from eligible markets)
  const eligibleOutcomes = await prisma.outcome.count({
    where: {
      market: {
        venue,
        status: {
          in: ['active', 'closed'],
        },
      },
    },
  });

  // 3. Count fresh outcomes (latest_quote updated within threshold)
  const freshOutcomes = await prisma.latestQuote.count({
    where: {
      updatedAt: {
        gte: freshnessThreshold,
      },
      outcome: {
        market: {
          venue,
          status: {
            in: ['active', 'closed'],
          },
        },
      },
    },
  });

  // 4. Get stale samples (oldest latest_quotes)
  const staleSamplesRaw = await prisma.latestQuote.findMany({
    where: {
      outcome: {
        market: {
          venue,
          status: {
            in: ['active', 'closed'],
          },
        },
      },
    },
    orderBy: {
      updatedAt: 'asc',
    },
    take: limit,
    include: {
      outcome: {
        include: {
          market: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      },
    },
  });

  const staleSamples: StaleMarketSample[] = staleSamplesRaw.map((lq) => ({
    id: lq.outcome.market.id,
    title: lq.outcome.market.title,
    outcomeId: lq.outcomeId,
    outcomeName: lq.outcome.name,
    lastQuoteTs: lq.updatedAt,
    ageMinutes: Math.round((now.getTime() - lq.updatedAt.getTime()) / (60 * 1000)),
  }));

  // 5. Get current quotes cursor
  const cursorState = await prisma.ingestionState.findUnique({
    where: {
      venue_jobName: {
        venue,
        jobName: 'quotes',
      },
    },
    select: {
      cursor: true,
      jobName: true,
    },
  });

  const staleOutcomes = eligibleOutcomes - freshOutcomes;
  const coveragePercent = eligibleOutcomes > 0 ? (freshOutcomes / eligibleOutcomes) * 100 : 0;

  // Output
  console.log('[Summary]');
  console.log(`  Eligible markets:  ${eligibleMarkets.toLocaleString()}`);
  console.log(`  Eligible outcomes: ${eligibleOutcomes.toLocaleString()}`);
  console.log(`  Fresh outcomes:    ${freshOutcomes.toLocaleString()} (updated in last ${minutes}min)`);
  console.log(`  Stale outcomes:    ${staleOutcomes.toLocaleString()}`);
  console.log(`  Coverage:          ${coveragePercent.toFixed(2)}%`);
  console.log();

  if (cursorState) {
    console.log('[Quotes Cursor]');
    console.log(`  Job: ${cursorState.jobName}`);
    console.log(`  Current cursor: ${cursorState.cursor ?? 'null (start)'}`);
    console.log();
  }

  if (staleSamples.length > 0) {
    console.log(`[Top ${staleSamples.length} Stale Markets]`);
    for (const s of staleSamples) {
      console.log(`  [${s.id}] ${s.title.slice(0, 45)}...`);
      console.log(`         outcome=${s.outcomeName} lastQuote=${s.lastQuoteTs.toISOString()} (${s.ageMinutes}min ago)`);
    }
    console.log();
  }

  // Status
  if (coveragePercent >= 90) {
    console.log(`[Status] ✓ HEALTHY - ${coveragePercent.toFixed(1)}% coverage`);
  } else if (coveragePercent >= 50) {
    console.log(`[Status] ⚠️ DEGRADED - ${coveragePercent.toFixed(1)}% coverage (round-robin in progress)`);
  } else {
    console.log(`[Status] ✗ STALE - ${coveragePercent.toFixed(1)}% coverage (check quotes ingestion)`);
  }

  return {
    venue,
    eligibleMarkets,
    eligibleOutcomes,
    freshOutcomes,
    staleOutcomes,
    coveragePercent,
    freshnessMinutes: minutes,
    staleSamples,
    cursor: cursorState ? {
      current: cursorState.cursor,
      jobName: cursorState.jobName,
    } : null,
  };
}

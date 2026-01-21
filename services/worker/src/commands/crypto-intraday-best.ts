/**
 * crypto:intraday:best - Show best high-score intraday crypto matches (v2.6.3)
 *
 * Queries market_links for crypto_intraday suggestions with high scores
 */

import { type Venue } from '@data-module/core';
import {
  getClient,
  type Venue as DBVenue,
} from '@data-module/db';

export interface IntradayBestOptions {
  /** Minimum score filter */
  minScore?: number;
  /** Maximum results */
  limit?: number;
  /** Source venue */
  fromVenue?: Venue;
  /** Target venue */
  toVenue?: Venue;
}

export interface IntradayBestMatch {
  id: number;
  leftId: number;
  rightId: number;
  score: number;
  status: string;
  algoVersion: string | null;
  reason: string | null;
  leftTitle: string;
  rightTitle: string;
  leftCloseTime: Date | null;
  rightCloseTime: Date | null;
}

export interface IntradayBestResult {
  matches: IntradayBestMatch[];
  totalCount: number;
}

/**
 * Run crypto:intraday:best command
 */
export async function runIntradayBest(options: IntradayBestOptions): Promise<IntradayBestResult> {
  const {
    minScore = 0.85,
    limit = 50,
    fromVenue = 'kalshi',
    toVenue = 'polymarket',
  } = options;

  console.log(`\n${'='.repeat(80)}`);
  console.log(`[crypto:intraday:best] v2.6.3`);
  console.log(`${'='.repeat(80)}`);
  console.log(`From: ${fromVenue} -> To: ${toVenue}`);
  console.log(`Min score: ${minScore} | Limit: ${limit}`);
  console.log(`${'='.repeat(80)}\n`);

  const prisma = getClient();

  // Query market_links for intraday suggestions
  const links = await prisma.marketLink.findMany({
    where: {
      leftVenue: fromVenue as DBVenue,
      rightVenue: toVenue as DBVenue,
      algoVersion: { startsWith: 'crypto_intraday' },
      score: { gte: minScore },
    },
    orderBy: { score: 'desc' },
    take: limit,
  });

  // Get total count
  const totalCount = await prisma.marketLink.count({
    where: {
      leftVenue: fromVenue as DBVenue,
      rightVenue: toVenue as DBVenue,
      algoVersion: { startsWith: 'crypto_intraday' },
      score: { gte: minScore },
    },
  });

  if (links.length === 0) {
    console.log('No intraday matches found with specified criteria.');
    console.log('\nTo generate intraday matches, run:');
    console.log('  pnpm --filter @data-module/worker suggest-matches --topic crypto_intraday --from kalshi --to polymarket\n');
    return { matches: [], totalCount: 0 };
  }

  // Fetch market titles
  const leftIds = links.map(l => l.leftMarketId);
  const rightIds = links.map(l => l.rightMarketId);

  const leftMarkets = await prisma.market.findMany({
    where: { id: { in: leftIds } },
    select: { id: true, title: true, closeTime: true },
  });
  const rightMarkets = await prisma.market.findMany({
    where: { id: { in: rightIds } },
    select: { id: true, title: true, closeTime: true },
  });

  const leftMap = new Map(leftMarkets.map(m => [m.id, m]));
  const rightMap = new Map(rightMarkets.map(m => [m.id, m]));

  // Build matches
  const matches: IntradayBestMatch[] = [];
  for (const link of links) {
    const left = leftMap.get(link.leftMarketId);
    const right = rightMap.get(link.rightMarketId);

    matches.push({
      id: link.id,
      leftId: link.leftMarketId,
      rightId: link.rightMarketId,
      score: link.score,
      status: link.status,
      algoVersion: link.algoVersion,
      reason: link.reason,
      leftTitle: left?.title || `[Market ${link.leftMarketId}]`,
      rightTitle: right?.title || `[Market ${link.rightMarketId}]`,
      leftCloseTime: left?.closeTime || null,
      rightCloseTime: right?.closeTime || null,
    });
  }

  // Print results
  console.log(`[Results] Found ${totalCount} total matches (showing top ${matches.length})\n`);

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    console.log(`${'─'.repeat(80)}`);
    console.log(`#${i + 1} | Score: ${m.score.toFixed(3)} | Status: ${m.status}`);
    console.log(`[${fromVenue}] ${m.leftTitle}`);
    console.log(`  Close: ${m.leftCloseTime?.toISOString() || 'N/A'}`);
    console.log(`[${toVenue}] ${m.rightTitle}`);
    console.log(`  Close: ${m.rightCloseTime?.toISOString() || 'N/A'}`);
    if (m.reason) {
      console.log(`  Reason: ${m.reason}`);
    }
    console.log(`  Algo: ${m.algoVersion || 'N/A'}`);
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`[Summary]`);
  console.log(`  Total intraday matches (score >= ${minScore}): ${totalCount}`);
  console.log(`  Showing: ${matches.length}`);

  // Status breakdown
  const statusCounts = new Map<string, number>();
  for (const m of matches) {
    statusCounts.set(m.status, (statusCounts.get(m.status) || 0) + 1);
  }
  console.log(`\n[Status Breakdown]`);
  for (const [status, count] of statusCounts) {
    console.log(`  ${status}: ${count}`);
  }

  console.log(`${'='.repeat(80)}\n`);

  return { matches, totalCount };
}

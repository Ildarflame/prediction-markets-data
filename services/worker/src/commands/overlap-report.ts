/**
 * Overlap report command
 * Checks keyword overlap between venues in the database
 */

import { getClient } from '@data-module/db';

export interface OverlapReportOptions {
  keywords: string[];
}

export interface OverlapReportResult {
  keywords: string[];
  polymarket: {
    total: number;
    matching: number;
    byKeyword: Record<string, number>;
  };
  kalshi: {
    total: number;
    matching: number;
    byKeyword: Record<string, number>;
  };
  hasOverlap: boolean;
}

/**
 * Default keywords to check for overlap
 */
export const DEFAULT_OVERLAP_KEYWORDS = [
  'bitcoin', 'btc', 'ethereum', 'eth', 'crypto',
  'trump', 'biden', 'election', 'president', 'congress',
  'cpi', 'gdp', 'inflation', 'fed', 'interest rate',
  'ukraine', 'russia', 'china', 'war',
];

export async function runOverlapReport(options: OverlapReportOptions): Promise<OverlapReportResult> {
  const prisma = getClient();
  const keywords = options.keywords.length > 0 ? options.keywords : DEFAULT_OVERLAP_KEYWORDS;

  console.log(`\n[overlap-report] Checking keyword overlap between venues`);
  console.log(`[overlap-report] Keywords: ${keywords.join(', ')}\n`);

  // Get total counts
  const polymarketTotal = await prisma.market.count({ where: { venue: 'polymarket' } });
  const kalshiTotal = await prisma.market.count({ where: { venue: 'kalshi' } });

  console.log(`[overlap-report] Total markets:`);
  console.log(`  Polymarket: ${polymarketTotal}`);
  console.log(`  Kalshi: ${kalshiTotal}\n`);

  // Check each keyword
  const polymarketByKeyword: Record<string, number> = {};
  const kalshiByKeyword: Record<string, number> = {};
  let polymarketMatching = 0;
  let kalshiMatching = 0;

  const polymarketMatchingIds = new Set<number>();
  const kalshiMatchingIds = new Set<number>();

  console.log(`[overlap-report] Keyword matches:\n`);
  console.log('Keyword'.padEnd(20) + 'Polymarket'.padStart(12) + 'Kalshi'.padStart(12));
  console.log('-'.repeat(44));

  for (const keyword of keywords) {
    // Polymarket matches
    const polyMatches = await prisma.market.findMany({
      where: {
        venue: 'polymarket',
        title: { contains: keyword, mode: 'insensitive' },
      },
      select: { id: true },
    });

    polymarketByKeyword[keyword] = polyMatches.length;
    for (const m of polyMatches) {
      polymarketMatchingIds.add(m.id);
    }

    // Kalshi matches
    const kalshiMatches = await prisma.market.findMany({
      where: {
        venue: 'kalshi',
        title: { contains: keyword, mode: 'insensitive' },
      },
      select: { id: true },
    });

    kalshiByKeyword[keyword] = kalshiMatches.length;
    for (const m of kalshiMatches) {
      kalshiMatchingIds.add(m.id);
    }

    console.log(
      keyword.padEnd(20) +
      String(polyMatches.length).padStart(12) +
      String(kalshiMatches.length).padStart(12)
    );
  }

  polymarketMatching = polymarketMatchingIds.size;
  kalshiMatching = kalshiMatchingIds.size;

  console.log('-'.repeat(44));
  console.log(
    'UNIQUE MATCHING'.padEnd(20) +
    String(polymarketMatching).padStart(12) +
    String(kalshiMatching).padStart(12)
  );

  const hasOverlap = kalshiMatching > 0 && polymarketMatching > 0;

  console.log(`\n[overlap-report] Summary:`);
  console.log(`  Polymarket markets matching keywords: ${polymarketMatching} / ${polymarketTotal} (${((polymarketMatching / polymarketTotal) * 100).toFixed(1)}%)`);
  console.log(`  Kalshi markets matching keywords: ${kalshiMatching} / ${kalshiTotal} (${((kalshiMatching / kalshiTotal) * 100).toFixed(1)}%)`);

  if (!hasOverlap) {
    console.log(`\n[overlap-report] ⚠ NO OVERLAP DETECTED`);
    if (kalshiMatching === 0) {
      console.log(`  Kalshi dataset has no overlap keywords.`);
      console.log(`  Check: ingestion filters, base URL, or API authentication.`);
    }
    if (polymarketMatching === 0) {
      console.log(`  Polymarket dataset has no overlap keywords.`);
    }
  } else {
    console.log(`\n[overlap-report] ✓ Overlap detected - matching is possible`);
  }

  // Show sample matching markets from each venue
  if (polymarketMatching > 0) {
    console.log(`\n[overlap-report] Sample Polymarket markets with keywords:`);
    const samples = await prisma.market.findMany({
      where: {
        venue: 'polymarket',
        id: { in: Array.from(polymarketMatchingIds).slice(0, 5) },
      },
      select: { title: true },
    });
    for (const s of samples) {
      console.log(`  - ${s.title.substring(0, 80)}${s.title.length > 80 ? '...' : ''}`);
    }
  }

  if (kalshiMatching > 0) {
    console.log(`\n[overlap-report] Sample Kalshi markets with keywords:`);
    const samples = await prisma.market.findMany({
      where: {
        venue: 'kalshi',
        id: { in: Array.from(kalshiMatchingIds).slice(0, 5) },
      },
      select: { title: true },
    });
    for (const s of samples) {
      console.log(`  - ${s.title.substring(0, 80)}${s.title.length > 80 ? '...' : ''}`);
    }
  }

  return {
    keywords,
    polymarket: {
      total: polymarketTotal,
      matching: polymarketMatching,
      byKeyword: polymarketByKeyword,
    },
    kalshi: {
      total: kalshiTotal,
      matching: kalshiMatching,
      byKeyword: kalshiByKeyword,
    },
    hasOverlap,
  };
}

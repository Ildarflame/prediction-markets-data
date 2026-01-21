/**
 * crypto:brackets - Bracket series diagnostic command (v2.6.0)
 *
 * Analyzes bracket structure in crypto markets to understand
 * how many markets share entity+settleDate+comparator but differ by threshold
 */

import { type Venue } from '@data-module/core';
import {
  getClient,
  MarketRepository,
} from '@data-module/db';
import {
  CRYPTO_ENTITIES_V1,
  fetchEligibleCryptoMarkets,
  analyzeBrackets,
} from '../matching/index.js';

export interface CryptoBracketsOptions {
  /** Venue to analyze */
  venue?: Venue;
  /** Lookback hours */
  lookbackHours?: number;
  /** Limit markets */
  limit?: number;
  /** Top N brackets to show */
  topN?: number;
}

export interface CryptoBracketsResult {
  venue: Venue;
  totalMarkets: number;
  completeMarkets: number;
  uniqueBrackets: number;
  topBrackets: Array<{
    key: string;
    entity: string;
    settleDate: string;
    comparator: string;
    count: number;
    sampleThresholds: number[];
  }>;
}

/**
 * Run crypto:brackets diagnostic command
 */
export async function runCryptoBrackets(options: CryptoBracketsOptions = {}): Promise<CryptoBracketsResult> {
  const {
    venue = 'polymarket',
    lookbackHours = 720,
    limit = 5000,
    topN = 20,
  } = options;

  console.log(`\n${'='.repeat(80)}`);
  console.log(`[crypto:brackets] Bracket Series Diagnostic v2.6.0`);
  console.log(`${'='.repeat(80)}`);
  console.log(`Venue: ${venue} | Lookback: ${lookbackHours}h | Limit: ${limit}`);
  console.log(`${'='.repeat(80)}\n`);

  const prisma = getClient();
  const marketRepo = new MarketRepository(prisma);

  // Fetch crypto markets
  console.log(`[crypto:brackets] Fetching markets...`);
  const { markets, stats } = await fetchEligibleCryptoMarkets(marketRepo, {
    venue,
    lookbackHours,
    limit,
    entities: CRYPTO_ENTITIES_V1,
    excludeSports: true,
  });

  console.log(`  Total: ${stats.total} -> After filters: ${markets.length}`);
  console.log(`  With entity: ${stats.withCryptoEntity}, With date: ${stats.withSettleDate}`);

  // Analyze bracket structure
  console.log(`\n[crypto:brackets] Analyzing bracket structure...`);
  const analysis = analyzeBrackets(markets, topN);

  console.log(`  Total markets: ${analysis.totalMarkets}`);
  console.log(`  Complete markets (entity+date+comparator+numbers): ${analysis.completeMarkets}`);
  console.log(`  Unique bracket keys: ${analysis.uniqueBrackets}`);

  // Bracket size distribution
  console.log(`\n[crypto:brackets] Bracket size distribution:`);
  const sizeCounts = Array.from(analysis.bracketSizes.entries()).sort((a, b) => b[0] - a[0]);
  for (const [size, count] of sizeCounts.slice(0, 10)) {
    const pct = (count / analysis.uniqueBrackets * 100).toFixed(1);
    console.log(`  Size ${size}: ${count} brackets (${pct}%)`);
  }

  // Top brackets
  console.log(`\n[crypto:brackets] Top ${topN} brackets by size:`);
  console.log(`${'─'.repeat(80)}`);

  for (let i = 0; i < analysis.topBrackets.length; i++) {
    const b = analysis.topBrackets[i];
    console.log(`#${i + 1} | ${b.entity} | ${b.settleDate} | ${b.comparator} | ${b.count} markets`);
    if (b.sampleThresholds.length > 0) {
      const thresholds = b.sampleThresholds.map(t => `$${t.toLocaleString()}`).join(', ');
      console.log(`     Sample thresholds: ${thresholds}`);
    }
  }

  // Summary stats
  console.log(`\n${'='.repeat(80)}`);
  console.log(`[crypto:brackets] Summary:`);
  console.log(`  Bracket explosion ratio: ${(analysis.totalMarkets / Math.max(1, analysis.uniqueBrackets)).toFixed(1)}x`);
  console.log(`  Markets per bracket (avg): ${(analysis.totalMarkets / Math.max(1, analysis.uniqueBrackets)).toFixed(2)}`);

  // Calculate potential savings
  const largerBrackets = sizeCounts.filter(([size]) => size > 1);
  const marketsInLargerBrackets = largerBrackets.reduce((sum, [size, count]) => sum + size * count, 0);
  const potentialSavings = marketsInLargerBrackets - largerBrackets.reduce((sum, [, count]) => sum + count, 0);
  console.log(`  Potential savings (1 per bracket): ${potentialSavings} markets (${(potentialSavings / analysis.totalMarkets * 100).toFixed(1)}%)`);

  return {
    venue,
    totalMarkets: analysis.totalMarkets,
    completeMarkets: analysis.completeMarkets,
    uniqueBrackets: analysis.uniqueBrackets,
    topBrackets: analysis.topBrackets,
  };
}

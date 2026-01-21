/**
 * crypto:best, crypto:worst, crypto:sample - Quality review commands (v2.5.3)
 *
 * Displays crypto suggestions for quality review with detailed breakdown
 */

import { type Venue } from '@data-module/core';
import {
  getClient,
  MarketRepository,
  MarketLinkRepository,
  type Venue as DBVenue,
} from '@data-module/db';
import {
  CRYPTO_ENTITIES_V1,
  fetchEligibleCryptoMarkets,
  buildCryptoIndex,
  findCryptoCandidates,
  cryptoMatchScore,
  CryptoDateType,
  type CryptoMarket,
  type CryptoScoreResult,
} from '../matching/index.js';

export interface CryptoQualityOptions {
  /** Filter: 'best', 'worst', or 'sample' */
  mode: 'best' | 'worst' | 'sample';
  /** Minimum score filter (for 'best' mode) */
  minScore?: number;
  /** Maximum score filter (for 'worst' mode) */
  maxScore?: number;
  /** Maximum results to show */
  limit?: number;
  /** Random seed for 'sample' mode */
  seed?: number;
  /** From venue (default: kalshi) */
  fromVenue?: Venue;
  /** To venue (default: polymarket) */
  toVenue?: Venue;
  /** Lookback hours for market fetch */
  lookbackHours?: number;
}

export interface CryptoQualityMatch {
  leftId: number;
  rightId: number;
  score: number;
  tier: 'STRONG' | 'WEAK';
  entity: string;
  settleDateL: string | null;
  settleDateR: string | null;
  dateTypeL: CryptoDateType;
  dateTypeR: CryptoDateType;
  comparatorL: string | null;
  comparatorR: string | null;
  numbersL: number[];
  numbersR: number[];
  leftTitle: string;
  rightTitle: string;
  reason: string;
}

export interface CryptoQualityResult {
  mode: string;
  fromVenue: Venue;
  toVenue: Venue;
  totalPairs: number;
  matches: CryptoQualityMatch[];
}

/**
 * Seeded random number generator (simple LCG)
 */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/**
 * Shuffle array with seeded random
 */
function shuffleWithSeed<T>(arr: T[], seed: number): T[] {
  const result = [...arr];
  const random = seededRandom(seed);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Run crypto quality review command
 */
export async function runCryptoQuality(options: CryptoQualityOptions): Promise<CryptoQualityResult> {
  const {
    mode,
    minScore = 0.90,
    maxScore = 0.60,
    limit = 50,
    seed = 42,
    fromVenue = 'kalshi',
    toVenue = 'polymarket',
    lookbackHours = 720,
  } = options;

  console.log(`\n${'='.repeat(80)}`);
  console.log(`[crypto:${mode}] Quality Review v2.5.3`);
  console.log(`${'='.repeat(80)}`);
  console.log(`Mode: ${mode} | From: ${fromVenue} -> ${toVenue} | Lookback: ${lookbackHours}h`);
  if (mode === 'best') console.log(`Min score: ${minScore}`);
  if (mode === 'worst') console.log(`Max score: ${maxScore}`);
  if (mode === 'sample') console.log(`Seed: ${seed}`);
  console.log(`Limit: ${limit}`);
  console.log(`${'='.repeat(80)}\n`);

  const prisma = getClient();
  const marketRepo = new MarketRepository(prisma);

  // Fetch markets from both venues
  console.log(`[crypto:${mode}] Fetching markets...`);

  const { markets: leftMarkets } = await fetchEligibleCryptoMarkets(marketRepo, {
    venue: fromVenue,
    lookbackHours,
    limit: 5000,
    entities: CRYPTO_ENTITIES_V1,
    excludeSports: true,
  });

  const { markets: rightMarkets } = await fetchEligibleCryptoMarkets(marketRepo, {
    venue: toVenue,
    lookbackHours,
    limit: 5000,
    entities: CRYPTO_ENTITIES_V1,
    excludeSports: true,
  });

  console.log(`  ${fromVenue}: ${leftMarkets.length} markets`);
  console.log(`  ${toVenue}: ${rightMarkets.length} markets`);

  // Build index and score all pairs
  console.log(`[crypto:${mode}] Building index and scoring pairs...`);
  const cryptoIndex = buildCryptoIndex(rightMarkets);

  const allMatches: CryptoQualityMatch[] = [];

  for (const leftCrypto of leftMarkets) {
    const candidates = findCryptoCandidates(leftCrypto, cryptoIndex, true);

    for (const rightCrypto of candidates) {
      if (rightCrypto.market.id === leftCrypto.market.id) continue;

      const scoreResult = cryptoMatchScore(leftCrypto, rightCrypto);
      if (!scoreResult) continue;

      allMatches.push({
        leftId: leftCrypto.market.id,
        rightId: rightCrypto.market.id,
        score: scoreResult.score,
        tier: scoreResult.tier,
        entity: leftCrypto.signals.entity!,
        settleDateL: leftCrypto.signals.settleDate,
        settleDateR: rightCrypto.signals.settleDate,
        dateTypeL: scoreResult.dateTypeL,
        dateTypeR: scoreResult.dateTypeR,
        comparatorL: scoreResult.comparatorL,
        comparatorR: scoreResult.comparatorR,
        numbersL: leftCrypto.signals.numbers,
        numbersR: rightCrypto.signals.numbers,
        leftTitle: leftCrypto.market.title,
        rightTitle: rightCrypto.market.title,
        reason: scoreResult.reason,
      });
    }
  }

  console.log(`  Total scored pairs: ${allMatches.length}`);

  // Filter and sort based on mode
  let filteredMatches: CryptoQualityMatch[];

  switch (mode) {
    case 'best':
      filteredMatches = allMatches
        .filter(m => m.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
      break;

    case 'worst':
      filteredMatches = allMatches
        .filter(m => m.score <= maxScore)
        .sort((a, b) => a.score - b.score)
        .slice(0, limit);
      break;

    case 'sample':
      filteredMatches = shuffleWithSeed(allMatches, seed).slice(0, limit);
      break;

    default:
      filteredMatches = [];
  }

  // Print results
  console.log(`\n[crypto:${mode}] Results (${filteredMatches.length} matches):\n`);

  for (let i = 0; i < filteredMatches.length; i++) {
    const m = filteredMatches[i];
    console.log(`${'─'.repeat(80)}`);
    console.log(`#${i + 1} | Score: ${m.score.toFixed(3)} | Tier: ${m.tier} | Entity: ${m.entity}`);
    console.log(`${'─'.repeat(80)}`);
    console.log(`LEFT  [${m.leftId}]: ${m.leftTitle}`);
    console.log(`RIGHT [${m.rightId}]: ${m.rightTitle}`);
    console.log(``);
    console.log(`  SettleDate L: ${m.settleDateL || 'null'} (${m.dateTypeL})`);
    console.log(`  SettleDate R: ${m.settleDateR || 'null'} (${m.dateTypeR})`);
    console.log(`  Comparator L: ${m.comparatorL || 'null'} | R: ${m.comparatorR || 'null'}`);
    console.log(`  Numbers L: [${m.numbersL.join(', ')}] | R: [${m.numbersR.join(', ')}]`);
    console.log(`  Reason: ${m.reason}`);
    console.log(``);
  }

  // Summary stats
  console.log(`${'='.repeat(80)}`);
  console.log(`[crypto:${mode}] Summary:`);
  console.log(`  Total pairs scored: ${allMatches.length}`);
  console.log(`  Matches shown: ${filteredMatches.length}`);

  if (filteredMatches.length > 0) {
    const avgScore = filteredMatches.reduce((sum, m) => sum + m.score, 0) / filteredMatches.length;
    const strongCount = filteredMatches.filter(m => m.tier === 'STRONG').length;
    console.log(`  Avg score: ${avgScore.toFixed(3)}`);
    console.log(`  STRONG tier: ${strongCount}/${filteredMatches.length}`);

    // Date type distribution
    const dateTypeCounts = new Map<string, number>();
    for (const m of filteredMatches) {
      const key = `${m.dateTypeL}<->${m.dateTypeR}`;
      dateTypeCounts.set(key, (dateTypeCounts.get(key) || 0) + 1);
    }
    console.log(`  Date type pairs:`);
    for (const [key, count] of dateTypeCounts.entries()) {
      console.log(`    ${key}: ${count}`);
    }
  }

  return {
    mode,
    fromVenue,
    toVenue,
    totalPairs: allMatches.length,
    matches: filteredMatches,
  };
}

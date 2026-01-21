/**
 * crypto:eth-debug - ETH matching root-cause analysis (v2.6.1)
 *
 * Diagnoses why ETH matches are missing by analyzing:
 * 1. Market type distribution on both venues (ETH only)
 * 2. Date overlap between venues
 * 3. Sample pairs with score breakdown
 * 4. SAFE_RULE eligibility simulation
 */

import { type Venue } from '@data-module/core';
import {
  getClient,
  MarketRepository,
} from '@data-module/db';
import {
  CRYPTO_ENTITIES_V1,
  fetchEligibleCryptoMarkets,
  CryptoMarketType,
  buildCryptoIndex,
  findCryptoCandidates,
  cryptoMatchScore,
  areMarketTypesCompatible,
  type CryptoMarket,
} from '../matching/index.js';
import { validateAutoConfirm } from '../matching/cryptoAutoConfirm.js';

export interface EthDebugOptions {
  /** Source venue */
  from?: Venue;
  /** Target venue */
  to?: Venue;
  /** Lookback hours */
  lookbackHours?: number;
  /** Limit markets per venue */
  limit?: number;
  /** Min score for analysis */
  minScore?: number;
  /** Top N dates to analyze */
  topDates?: number;
}

export interface EthDebugResult {
  fromVenue: Venue;
  toVenue: Venue;
  leftMarkets: number;
  rightMarkets: number;
  typeDistribution: {
    left: Record<CryptoMarketType, number>;
    right: Record<CryptoMarketType, number>;
  };
  dateOverlap: Array<{
    date: string;
    leftCount: number;
    rightCount: number;
    potentialPairs: number;
  }>;
  samplePairs: Array<{
    leftId: number;
    leftTitle: string;
    rightId: number;
    rightTitle: string;
    score: number | null;
    failReason: string | null;
  }>;
  safeRuleStats: Record<string, number>;
}

/**
 * Run crypto:eth-debug diagnostic command
 */
export async function runCryptoEthDebug(options: EthDebugOptions = {}): Promise<EthDebugResult> {
  const {
    from = 'kalshi',
    to = 'polymarket',
    lookbackHours = 720,
    limit = 2000,
    minScore = 0.8,
    topDates = 10,
  } = options;

  console.log(`\n${'='.repeat(80)}`);
  console.log(`[crypto:eth-debug] ETH Matching Root-Cause Analysis v2.6.1`);
  console.log(`${'='.repeat(80)}`);
  console.log(`From: ${from} -> To: ${to} | Lookback: ${lookbackHours}h | Limit: ${limit}`);
  console.log(`Min score: ${minScore} | Top dates: ${topDates}`);
  console.log(`${'='.repeat(80)}\n`);

  const prisma = getClient();
  const marketRepo = new MarketRepository(prisma);

  // Fetch markets from both venues
  console.log(`[crypto:eth-debug] Fetching ETHEREUM markets from both venues...`);

  const [leftResult, rightResult] = await Promise.all([
    fetchEligibleCryptoMarkets(marketRepo, {
      venue: from,
      lookbackHours,
      limit,
      entities: CRYPTO_ENTITIES_V1,
      excludeSports: true,
    }),
    fetchEligibleCryptoMarkets(marketRepo, {
      venue: to,
      lookbackHours,
      limit,
      entities: CRYPTO_ENTITIES_V1,
      excludeSports: true,
    }),
  ]);

  // Filter to ETH only
  const leftMarkets = leftResult.markets.filter(m => m.signals.entity === 'ETHEREUM');
  const rightMarkets = rightResult.markets.filter(m => m.signals.entity === 'ETHEREUM');

  console.log(`  ${from}: ${leftMarkets.length} ETH markets`);
  console.log(`  ${to}: ${rightMarkets.length} ETH markets`);

  if (leftMarkets.length === 0 || rightMarkets.length === 0) {
    console.log(`\n  ⚠️  No ETHEREUM markets found on one or both venues.`);
    return {
      fromVenue: from,
      toVenue: to,
      leftMarkets: leftMarkets.length,
      rightMarkets: rightMarkets.length,
      typeDistribution: {
        left: {} as Record<CryptoMarketType, number>,
        right: {} as Record<CryptoMarketType, number>,
      },
      dateOverlap: [],
      samplePairs: [],
      safeRuleStats: {},
    };
  }

  // 1. Market type distribution
  console.log(`\n[crypto:eth-debug] Market Type Distribution:`);
  console.log(`${'─'.repeat(60)}`);

  const typeDistributionLeft: Record<CryptoMarketType, number> = {
    [CryptoMarketType.DAILY_THRESHOLD]: 0,
    [CryptoMarketType.DAILY_RANGE]: 0,
    [CryptoMarketType.YEARLY_THRESHOLD]: 0,
    [CryptoMarketType.INTRADAY_UPDOWN]: 0,
    [CryptoMarketType.UNKNOWN]: 0,
  };
  const typeDistributionRight: Record<CryptoMarketType, number> = { ...typeDistributionLeft };

  for (const m of leftMarkets) typeDistributionLeft[m.signals.marketType]++;
  for (const m of rightMarkets) typeDistributionRight[m.signals.marketType]++;

  const typeOrder: CryptoMarketType[] = [
    CryptoMarketType.DAILY_THRESHOLD,
    CryptoMarketType.DAILY_RANGE,
    CryptoMarketType.YEARLY_THRESHOLD,
    CryptoMarketType.INTRADAY_UPDOWN,
    CryptoMarketType.UNKNOWN,
  ];

  console.log(`${'Type'.padEnd(20)} | ${from.padStart(8)} | ${to.padStart(8)} | Match?`);
  console.log(`${'─'.repeat(55)}`);

  for (const mtype of typeOrder) {
    const leftCount = typeDistributionLeft[mtype];
    const rightCount = typeDistributionRight[mtype];
    const canMatch = mtype !== CryptoMarketType.INTRADAY_UPDOWN && mtype !== CryptoMarketType.UNKNOWN;
    const overlap = leftCount > 0 && rightCount > 0;
    const marker = canMatch && overlap ? '✓' : (canMatch && !overlap ? '✗ (no overlap)' : '✗ (excluded)');
    console.log(`${mtype.padEnd(20)} | ${leftCount.toString().padStart(8)} | ${rightCount.toString().padStart(8)} | ${marker}`);
  }

  // 2. Date overlap analysis
  console.log(`\n[crypto:eth-debug] Date Overlap Analysis:`);
  console.log(`${'─'.repeat(60)}`);

  // Build date maps
  const leftDateMap = new Map<string, CryptoMarket[]>();
  const rightDateMap = new Map<string, CryptoMarket[]>();

  for (const m of leftMarkets) {
    if (!m.signals.settleDate) continue;
    const date = m.signals.settleDate;
    if (!leftDateMap.has(date)) leftDateMap.set(date, []);
    leftDateMap.get(date)!.push(m);
  }

  for (const m of rightMarkets) {
    if (!m.signals.settleDate) continue;
    const date = m.signals.settleDate;
    if (!rightDateMap.has(date)) rightDateMap.set(date, []);
    rightDateMap.get(date)!.push(m);
  }

  // Find overlapping dates
  const dateOverlap: Array<{
    date: string;
    leftCount: number;
    rightCount: number;
    potentialPairs: number;
  }> = [];

  for (const [date, leftList] of leftDateMap) {
    const rightList = rightDateMap.get(date);
    if (rightList && rightList.length > 0) {
      dateOverlap.push({
        date,
        leftCount: leftList.length,
        rightCount: rightList.length,
        potentialPairs: leftList.length * rightList.length,
      });
    }
  }

  // Sort by potential pairs
  dateOverlap.sort((a, b) => b.potentialPairs - a.potentialPairs);

  if (dateOverlap.length === 0) {
    console.log(`  ⚠️  NO date overlap found between ${from} and ${to} for ETHEREUM!`);
    console.log(`\n  ${from} dates: ${[...leftDateMap.keys()].slice(0, 10).join(', ')}${leftDateMap.size > 10 ? '...' : ''}`);
    console.log(`  ${to} dates: ${[...rightDateMap.keys()].slice(0, 10).join(', ')}${rightDateMap.size > 10 ? '...' : ''}`);
  } else {
    console.log(`  Found ${dateOverlap.length} overlapping dates:`);
    console.log(`\n${'Date'.padEnd(12)} | ${from.padStart(6)} | ${to.padStart(6)} | Potential Pairs`);
    console.log(`${'─'.repeat(50)}`);

    for (let i = 0; i < Math.min(topDates, dateOverlap.length); i++) {
      const d = dateOverlap[i];
      console.log(`${d.date.padEnd(12)} | ${d.leftCount.toString().padStart(6)} | ${d.rightCount.toString().padStart(6)} | ${d.potentialPairs}`);
    }
  }

  // 3. Sample pairs analysis
  console.log(`\n[crypto:eth-debug] Sample Pairs Analysis:`);
  console.log(`${'─'.repeat(80)}`);

  const samplePairs: Array<{
    leftId: number;
    leftTitle: string;
    rightId: number;
    rightTitle: string;
    score: number | null;
    failReason: string | null;
  }> = [];

  const safeRuleStats: Record<string, number> = {
    total_scored: 0,
    passed_gates: 0,
    safe_for_confirm: 0,
    entity_mismatch: 0,
    date_type_mismatch: 0,
    date_not_exact: 0,
    comparator_mismatch: 0,
    number_incompatible: 0,
    text_sanity_low: 0,
    missing_fields: 0,
    type_incompatible: 0,
  };

  // Build index and score pairs
  if (dateOverlap.length > 0) {
    const rightIndex = buildCryptoIndex(rightMarkets);

    for (const leftMarket of leftMarkets.slice(0, 200)) {
      if (!leftMarket.signals.settleDate) continue;

      const candidates = findCryptoCandidates(leftMarket, rightIndex, true);
      if (candidates.length === 0) continue;

      for (const rightMarket of candidates.slice(0, 3)) {
        // Check market type compatibility first
        const typesCompatible = areMarketTypesCompatible(
          leftMarket.signals.marketType,
          rightMarket.signals.marketType
        );

        if (!typesCompatible) {
          safeRuleStats.type_incompatible++;
          if (samplePairs.length < 20) {
            samplePairs.push({
              leftId: leftMarket.market.id,
              leftTitle: leftMarket.market.title.slice(0, 50),
              rightId: rightMarket.market.id,
              rightTitle: rightMarket.market.title.slice(0, 50),
              score: null,
              failReason: `Type mismatch: ${leftMarket.signals.marketType} vs ${rightMarket.signals.marketType}`,
            });
          }
          continue;
        }

        const scoreResult = cryptoMatchScore(leftMarket, rightMarket);
        if (scoreResult) {
          safeRuleStats.total_scored++;
          safeRuleStats.passed_gates++;

          // Check SAFE_RULES
          const validation = validateAutoConfirm(leftMarket, rightMarket, scoreResult);
          if (validation.safe) {
            safeRuleStats.safe_for_confirm++;
          } else if (validation.rejectReason) {
            const reason = validation.rejectReason as string;
            if (safeRuleStats[reason] !== undefined) {
              safeRuleStats[reason]++;
            }
          }

          if (samplePairs.length < 20) {
            samplePairs.push({
              leftId: leftMarket.market.id,
              leftTitle: leftMarket.market.title.slice(0, 50),
              rightId: rightMarket.market.id,
              rightTitle: rightMarket.market.title.slice(0, 50),
              score: scoreResult.score,
              failReason: validation.safe ? null : (validation.rejectReason || 'unknown'),
            });
          }
        }
      }
    }
  }

  // Print sample pairs
  if (samplePairs.length > 0) {
    for (let i = 0; i < Math.min(10, samplePairs.length); i++) {
      const p = samplePairs[i];
      console.log(`\n#${i + 1} | Score: ${p.score?.toFixed(3) || 'N/A'} | ${p.failReason ? `FAIL: ${p.failReason}` : 'OK'}`);
      console.log(`  L [${p.leftId}]: ${p.leftTitle}...`);
      console.log(`  R [${p.rightId}]: ${p.rightTitle}...`);
    }
  } else {
    console.log(`  No scorable pairs found.`);
  }

  // 4. SAFE_RULE analysis
  console.log(`\n${'='.repeat(80)}`);
  console.log(`[crypto:eth-debug] SAFE_RULE Eligibility Summary:`);
  console.log(`${'─'.repeat(60)}`);
  console.log(`  Total pairs analyzed: ${safeRuleStats.total_scored + safeRuleStats.type_incompatible}`);
  console.log(`  Type compatible: ${safeRuleStats.total_scored}`);
  console.log(`  Passed score gates: ${safeRuleStats.passed_gates}`);
  console.log(`  Safe for auto-confirm: ${safeRuleStats.safe_for_confirm}`);

  console.log(`\n  Rejection reasons:`);
  const rejectReasons = [
    'type_incompatible',
    'entity_mismatch',
    'date_type_mismatch',
    'date_not_exact',
    'comparator_mismatch',
    'number_incompatible',
    'text_sanity_low',
    'missing_fields',
  ];
  for (const reason of rejectReasons) {
    if (safeRuleStats[reason] > 0) {
      console.log(`    ${reason}: ${safeRuleStats[reason]}`);
    }
  }

  // Root cause summary
  console.log(`\n${'='.repeat(80)}`);
  console.log(`[crypto:eth-debug] Root Cause Summary:`);
  console.log(`${'─'.repeat(60)}`);

  if (leftMarkets.length === 0) {
    console.log(`  ❌ No ETH markets on ${from}`);
  } else if (rightMarkets.length === 0) {
    console.log(`  ❌ No ETH markets on ${to}`);
  } else if (dateOverlap.length === 0) {
    console.log(`  ❌ No date overlap between venues for ETH`);
    console.log(`     ${from} dates are different from ${to} dates`);
  } else if (safeRuleStats.type_incompatible > safeRuleStats.total_scored) {
    console.log(`  ⚠️  Market type incompatibility is the main blocker`);
    console.log(`     ${from} and ${to} have different market type mixes for ETH`);
  } else if (safeRuleStats.safe_for_confirm === 0) {
    console.log(`  ⚠️  No pairs pass SAFE_RULES for auto-confirm`);
    if (safeRuleStats.date_not_exact > 0) {
      console.log(`     Main issue: date precision (${safeRuleStats.date_not_exact} pairs)`);
    }
    if (safeRuleStats.number_incompatible > 0) {
      console.log(`     Main issue: number mismatch (${safeRuleStats.number_incompatible} pairs)`);
    }
  } else {
    console.log(`  ✓ Found ${safeRuleStats.safe_for_confirm} safe ETH pairs for auto-confirm`);
  }

  return {
    fromVenue: from,
    toVenue: to,
    leftMarkets: leftMarkets.length,
    rightMarkets: rightMarkets.length,
    typeDistribution: {
      left: typeDistributionLeft,
      right: typeDistributionRight,
    },
    dateOverlap: dateOverlap.slice(0, topDates),
    samplePairs,
    safeRuleStats,
  };
}

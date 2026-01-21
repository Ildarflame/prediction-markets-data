/**
 * crypto:date-audit - Date extraction quality diagnostic (v2.6.0)
 *
 * Shows how settle dates are being extracted for crypto markets per venue.
 * Useful for identifying patterns where date extraction fails or is imprecise.
 */

import { type Venue } from '@data-module/core';
import {
  getClient,
  MarketRepository,
} from '@data-module/db';
import {
  CRYPTO_ENTITIES_V1,
  fetchEligibleCryptoMarkets,
  CryptoDateType,
  type CryptoMarket,
} from '../matching/index.js';

export interface CryptoDateAuditOptions {
  /** Venue to audit */
  venue?: Venue;
  /** Lookback hours */
  lookbackHours?: number;
  /** Limit markets */
  limit?: number;
  /** Sample size per dateType */
  samplePerType?: number;
}

export interface CryptoDateAuditResult {
  venue: Venue;
  totalMarkets: number;
  dateTypeCounts: Record<CryptoDateType, number>;
  samplesByType: Record<CryptoDateType, Array<{ id: number; title: string; date: string | null }>>;
}

/**
 * Run crypto:date-audit diagnostic command
 */
export async function runCryptoDateAudit(options: CryptoDateAuditOptions = {}): Promise<CryptoDateAuditResult> {
  const {
    venue = 'polymarket',
    lookbackHours = 720,
    limit = 5000,
    samplePerType = 10,
  } = options;

  console.log(`\n${'='.repeat(80)}`);
  console.log(`[crypto:date-audit] Date Extraction Audit v2.6.0`);
  console.log(`${'='.repeat(80)}`);
  console.log(`Venue: ${venue} | Lookback: ${lookbackHours}h | Limit: ${limit}`);
  console.log(`${'='.repeat(80)}\n`);

  const prisma = getClient();
  const marketRepo = new MarketRepository(prisma);

  // Fetch crypto markets
  console.log(`[crypto:date-audit] Fetching markets...`);
  const { markets, stats } = await fetchEligibleCryptoMarkets(marketRepo, {
    venue,
    lookbackHours,
    limit,
    entities: CRYPTO_ENTITIES_V1,
    excludeSports: true,
  });

  console.log(`  Total: ${stats.total} -> After filters: ${markets.length}`);
  console.log(`  With entity: ${stats.withCryptoEntity}, With date: ${stats.withSettleDate}`);

  // Count by date type
  const dateTypeCounts: Record<CryptoDateType, number> = {
    [CryptoDateType.DAY_EXACT]: 0,
    [CryptoDateType.MONTH_END]: 0,
    [CryptoDateType.QUARTER]: 0,
    [CryptoDateType.CLOSE_TIME]: 0,
    [CryptoDateType.UNKNOWN]: 0,
  };

  // Collect samples per type
  const samplesByType: Record<CryptoDateType, CryptoMarket[]> = {
    [CryptoDateType.DAY_EXACT]: [],
    [CryptoDateType.MONTH_END]: [],
    [CryptoDateType.QUARTER]: [],
    [CryptoDateType.CLOSE_TIME]: [],
    [CryptoDateType.UNKNOWN]: [],
  };

  for (const market of markets) {
    const dateType = market.signals.dateType;
    dateTypeCounts[dateType]++;

    if (samplesByType[dateType].length < samplePerType) {
      samplesByType[dateType].push(market);
    }
  }

  // Print stats
  console.log(`\n[crypto:date-audit] Date Type Distribution:`);
  console.log(`${'─'.repeat(50)}`);

  const typeOrder: CryptoDateType[] = [
    CryptoDateType.DAY_EXACT,
    CryptoDateType.MONTH_END,
    CryptoDateType.QUARTER,
    CryptoDateType.CLOSE_TIME,
    CryptoDateType.UNKNOWN,
  ];

  for (const dtype of typeOrder) {
    const count = dateTypeCounts[dtype];
    const pct = markets.length > 0 ? ((count / markets.length) * 100).toFixed(1) : '0.0';
    console.log(`  ${dtype.padEnd(12)}: ${count.toString().padStart(5)} (${pct.padStart(5)}%)`);
  }

  // Print samples for each type
  for (const dtype of typeOrder) {
    const samples = samplesByType[dtype];
    if (samples.length === 0) continue;

    console.log(`\n${'='.repeat(80)}`);
    console.log(`[crypto:date-audit] Samples for ${dtype}:`);
    console.log(`${'─'.repeat(80)}`);

    for (let i = 0; i < samples.length; i++) {
      const m = samples[i];
      console.log(`${(i + 1).toString().padStart(2)}. [${m.market.id}] ${m.market.title.slice(0, 70)}${m.market.title.length > 70 ? '...' : ''}`);
      console.log(`    Entity: ${m.signals.entity} | Date: ${m.signals.settleDate || 'null'}`);
      if (m.signals.settlePeriod) {
        console.log(`    Period: ${m.signals.settlePeriod}`);
      }
      if (m.market.closeTime) {
        console.log(`    CloseTime: ${m.market.closeTime.toISOString().slice(0, 10)}`);
      }
    }
  }

  // Problem analysis
  const closeTimePct = markets.length > 0 ? (dateTypeCounts[CryptoDateType.CLOSE_TIME] / markets.length) * 100 : 0;
  const unknownPct = markets.length > 0 ? (dateTypeCounts[CryptoDateType.UNKNOWN] / markets.length) * 100 : 0;

  console.log(`\n${'='.repeat(80)}`);
  console.log(`[crypto:date-audit] Analysis:`);
  console.log(`  Precise dates (DAY_EXACT): ${dateTypeCounts[CryptoDateType.DAY_EXACT]}`);
  console.log(`  Period dates (MONTH_END + QUARTER): ${dateTypeCounts[CryptoDateType.MONTH_END] + dateTypeCounts[CryptoDateType.QUARTER]}`);
  console.log(`  Fallback dates (CLOSE_TIME): ${dateTypeCounts[CryptoDateType.CLOSE_TIME]} (${closeTimePct.toFixed(1)}%)`);
  console.log(`  No dates (UNKNOWN): ${dateTypeCounts[CryptoDateType.UNKNOWN]} (${unknownPct.toFixed(1)}%)`);

  if (closeTimePct > 30 || unknownPct > 10) {
    console.log(`\n  ⚠️  High rate of imprecise/missing dates detected.`);
    console.log(`     Consider improving title parsing for ${venue} patterns.`);
  }

  // Convert samples for return type
  const resultSamples: Record<CryptoDateType, Array<{ id: number; title: string; date: string | null }>> = {
    [CryptoDateType.DAY_EXACT]: [],
    [CryptoDateType.MONTH_END]: [],
    [CryptoDateType.QUARTER]: [],
    [CryptoDateType.CLOSE_TIME]: [],
    [CryptoDateType.UNKNOWN]: [],
  };

  for (const dtype of typeOrder) {
    resultSamples[dtype] = samplesByType[dtype].map(m => ({
      id: m.market.id,
      title: m.market.title,
      date: m.signals.settleDate,
    }));
  }

  return {
    venue,
    totalMarkets: markets.length,
    dateTypeCounts,
    samplesByType: resultSamples,
  };
}

/**
 * crypto:truth-date-audit - Truth settle date source diagnostic (v2.6.1)
 *
 * Shows where settle dates are coming from:
 * - API_CLOSE: From venue API close_time/endDate (most reliable)
 * - TITLE_PARSE: Parsed from title with DAY precision
 * - FALLBACK_CLOSE: Fallback to closeTime when title parsing failed
 * - MISSING: No settle date available
 */

import { type Venue } from '@data-module/core';
import {
  getClient,
  MarketRepository,
} from '@data-module/db';
import {
  CRYPTO_ENTITIES_V1,
  fetchEligibleCryptoMarkets,
  TruthSettleSource,
  CryptoDateType,
  type CryptoMarket,
} from '../matching/index.js';

export interface TruthDateAuditOptions {
  /** Venue to audit */
  venue?: Venue;
  /** Entity filter (BITCOIN, ETHEREUM, or all) */
  entity?: string;
  /** Lookback hours */
  lookbackHours?: number;
  /** Limit markets */
  limit?: number;
  /** Sample size per source */
  samplePerSource?: number;
}

export interface TruthDateAuditResult {
  venue: Venue;
  entity: string | 'all';
  totalMarkets: number;
  sourceCounts: Record<TruthSettleSource, number>;
  dateTypeCounts: Record<CryptoDateType, number>;
  samplesBySource: Record<TruthSettleSource, Array<{
    id: number;
    title: string;
    settleDate: string | null;
    dateType: CryptoDateType;
    closeTime: string | null;
  }>>;
}

/**
 * Run crypto:truth-date-audit diagnostic command
 */
export async function runCryptoTruthDateAudit(options: TruthDateAuditOptions = {}): Promise<TruthDateAuditResult> {
  const {
    venue = 'polymarket',
    entity = 'all',
    lookbackHours = 720,
    limit = 5000,
    samplePerSource = 10,
  } = options;

  console.log(`\n${'='.repeat(80)}`);
  console.log(`[crypto:truth-date-audit] Truth Settle Date Audit v2.6.1`);
  console.log(`${'='.repeat(80)}`);
  console.log(`Venue: ${venue} | Entity: ${entity} | Lookback: ${lookbackHours}h | Limit: ${limit}`);
  console.log(`${'='.repeat(80)}\n`);

  const prisma = getClient();
  const marketRepo = new MarketRepository(prisma);

  // Fetch crypto markets
  console.log(`[crypto:truth-date-audit] Fetching markets...`);
  const { markets, stats } = await fetchEligibleCryptoMarkets(marketRepo, {
    venue,
    lookbackHours,
    limit,
    entities: CRYPTO_ENTITIES_V1,
    excludeSports: true,
  });

  console.log(`  Total: ${stats.total} -> After filters: ${markets.length}`);
  console.log(`  With entity: ${stats.withCryptoEntity}, With date: ${stats.withSettleDate}`);

  // Filter by entity if specified
  const filteredMarkets = entity === 'all'
    ? markets
    : markets.filter(m => m.signals.entity === entity.toUpperCase());

  console.log(`  Entity filter "${entity}": ${filteredMarkets.length} markets`);

  // Count by source
  const sourceCounts: Record<TruthSettleSource, number> = {
    [TruthSettleSource.API_CLOSE]: 0,
    [TruthSettleSource.TITLE_PARSE]: 0,
    [TruthSettleSource.FALLBACK_CLOSE]: 0,
    [TruthSettleSource.MISSING]: 0,
  };

  // Count by dateType
  const dateTypeCounts: Record<CryptoDateType, number> = {
    [CryptoDateType.DAY_EXACT]: 0,
    [CryptoDateType.MONTH_END]: 0,
    [CryptoDateType.QUARTER]: 0,
    [CryptoDateType.CLOSE_TIME]: 0,
    [CryptoDateType.UNKNOWN]: 0,
  };

  // Collect samples per source
  const samplesBySource: Record<TruthSettleSource, CryptoMarket[]> = {
    [TruthSettleSource.API_CLOSE]: [],
    [TruthSettleSource.TITLE_PARSE]: [],
    [TruthSettleSource.FALLBACK_CLOSE]: [],
    [TruthSettleSource.MISSING]: [],
  };

  for (const market of filteredMarkets) {
    const source = market.signals.settleSource;
    const dateType = market.signals.dateType;

    sourceCounts[source]++;
    dateTypeCounts[dateType]++;

    if (samplesBySource[source].length < samplePerSource) {
      samplesBySource[source].push(market);
    }
  }

  // Print source distribution
  console.log(`\n[crypto:truth-date-audit] Settle Source Distribution:`);
  console.log(`${'─'.repeat(60)}`);

  const sourceOrder: TruthSettleSource[] = [
    TruthSettleSource.API_CLOSE,
    TruthSettleSource.TITLE_PARSE,
    TruthSettleSource.FALLBACK_CLOSE,
    TruthSettleSource.MISSING,
  ];

  for (const src of sourceOrder) {
    const count = sourceCounts[src];
    const pct = filteredMarkets.length > 0 ? ((count / filteredMarkets.length) * 100).toFixed(1) : '0.0';
    const marker = src === TruthSettleSource.API_CLOSE || src === TruthSettleSource.TITLE_PARSE ? '✓' : '⚠';
    console.log(`  ${marker} ${src.padEnd(16)}: ${count.toString().padStart(5)} (${pct.padStart(5)}%)`);
  }

  // Print date type distribution
  console.log(`\n[crypto:truth-date-audit] Date Type Distribution:`);
  console.log(`${'─'.repeat(60)}`);

  const dateTypeOrder: CryptoDateType[] = [
    CryptoDateType.DAY_EXACT,
    CryptoDateType.MONTH_END,
    CryptoDateType.QUARTER,
    CryptoDateType.CLOSE_TIME,
    CryptoDateType.UNKNOWN,
  ];

  for (const dtype of dateTypeOrder) {
    const count = dateTypeCounts[dtype];
    const pct = filteredMarkets.length > 0 ? ((count / filteredMarkets.length) * 100).toFixed(1) : '0.0';
    console.log(`  ${dtype.padEnd(12)}: ${count.toString().padStart(5)} (${pct.padStart(5)}%)`);
  }

  // Print samples for each source
  for (const src of sourceOrder) {
    const samples = samplesBySource[src];
    if (samples.length === 0) continue;

    console.log(`\n${'='.repeat(80)}`);
    console.log(`[crypto:truth-date-audit] Samples for ${src}:`);
    console.log(`${'─'.repeat(80)}`);

    for (let i = 0; i < samples.length; i++) {
      const m = samples[i];
      console.log(`${(i + 1).toString().padStart(2)}. [${m.market.id}] ${m.market.title.slice(0, 65)}${m.market.title.length > 65 ? '...' : ''}`);
      console.log(`    Entity: ${m.signals.entity} | Date: ${m.signals.settleDate || 'null'} | Type: ${m.signals.dateType}`);
      if (m.market.closeTime) {
        console.log(`    CloseTime: ${m.market.closeTime.toISOString().slice(0, 19)}`);
      }
    }
  }

  // Analysis
  const reliablePct = filteredMarkets.length > 0
    ? ((sourceCounts[TruthSettleSource.API_CLOSE] + sourceCounts[TruthSettleSource.TITLE_PARSE]) / filteredMarkets.length) * 100
    : 0;
  const fallbackPct = filteredMarkets.length > 0
    ? (sourceCounts[TruthSettleSource.FALLBACK_CLOSE] / filteredMarkets.length) * 100
    : 0;
  const missingPct = filteredMarkets.length > 0
    ? (sourceCounts[TruthSettleSource.MISSING] / filteredMarkets.length) * 100
    : 0;

  console.log(`\n${'='.repeat(80)}`);
  console.log(`[crypto:truth-date-audit] Analysis:`);
  console.log(`  Reliable sources (API_CLOSE + TITLE_PARSE): ${reliablePct.toFixed(1)}%`);
  console.log(`  Fallback (FALLBACK_CLOSE): ${fallbackPct.toFixed(1)}%`);
  console.log(`  Missing: ${missingPct.toFixed(1)}%`);

  if (fallbackPct > 20 || missingPct > 5) {
    console.log(`\n  ⚠️  High rate of fallback/missing settle sources detected.`);
    console.log(`     Consider improving title parsing patterns for ${venue}.`);
  }

  // Convert samples for return type
  const resultSamples: Record<TruthSettleSource, Array<{
    id: number;
    title: string;
    settleDate: string | null;
    dateType: CryptoDateType;
    closeTime: string | null;
  }>> = {
    [TruthSettleSource.API_CLOSE]: [],
    [TruthSettleSource.TITLE_PARSE]: [],
    [TruthSettleSource.FALLBACK_CLOSE]: [],
    [TruthSettleSource.MISSING]: [],
  };

  for (const src of sourceOrder) {
    resultSamples[src] = samplesBySource[src].map(m => ({
      id: m.market.id,
      title: m.market.title,
      settleDate: m.signals.settleDate,
      dateType: m.signals.dateType,
      closeTime: m.market.closeTime?.toISOString() || null,
    }));
  }

  return {
    venue,
    entity: entity === 'all' ? 'all' : entity.toUpperCase(),
    totalMarkets: filteredMarkets.length,
    sourceCounts,
    dateTypeCounts,
    samplesBySource: resultSamples,
  };
}

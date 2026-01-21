/**
 * crypto:type-audit - Market type classification diagnostic (v2.6.1)
 *
 * Shows distribution of CryptoMarketType:
 * - DAILY_THRESHOLD: "BTC above $96k on Jan 23"
 * - DAILY_RANGE: "BTC between $95k-$97k on Jan 23"
 * - YEARLY_THRESHOLD: "BTC above $X by end of 2026"
 * - INTRADAY_UPDOWN: "BTC Up or Down next 15 minutes"
 * - UNKNOWN: Cannot classify
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
  type CryptoMarket,
} from '../matching/index.js';

export interface TypeAuditOptions {
  /** Venue to audit */
  venue?: Venue;
  /** Entity filter (BITCOIN, ETHEREUM, or all) */
  entity?: string;
  /** Lookback hours */
  lookbackHours?: number;
  /** Limit markets */
  limit?: number;
  /** Sample size per type */
  samplePerType?: number;
}

export interface TypeAuditResult {
  venue: Venue;
  entity: string | 'all';
  totalMarkets: number;
  typeCounts: Record<CryptoMarketType, number>;
  samplesByType: Record<CryptoMarketType, Array<{
    id: number;
    title: string;
    settleDate: string | null;
    comparator: string | null;
    numbers: number[];
  }>>;
}

/**
 * Run crypto:type-audit diagnostic command
 */
export async function runCryptoTypeAudit(options: TypeAuditOptions = {}): Promise<TypeAuditResult> {
  const {
    venue = 'kalshi',
    entity = 'all',
    lookbackHours = 720,
    limit = 5000,
    samplePerType = 10,
  } = options;

  console.log(`\n${'='.repeat(80)}`);
  console.log(`[crypto:type-audit] Market Type Classification Audit v2.6.1`);
  console.log(`${'='.repeat(80)}`);
  console.log(`Venue: ${venue} | Entity: ${entity} | Lookback: ${lookbackHours}h | Limit: ${limit}`);
  console.log(`${'='.repeat(80)}\n`);

  const prisma = getClient();
  const marketRepo = new MarketRepository(prisma);

  // Fetch crypto markets
  console.log(`[crypto:type-audit] Fetching markets...`);
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

  // Count by market type
  const typeCounts: Record<CryptoMarketType, number> = {
    [CryptoMarketType.DAILY_THRESHOLD]: 0,
    [CryptoMarketType.DAILY_RANGE]: 0,
    [CryptoMarketType.YEARLY_THRESHOLD]: 0,
    [CryptoMarketType.INTRADAY_UPDOWN]: 0,
    [CryptoMarketType.UNKNOWN]: 0,
  };

  // Collect samples per type
  const samplesByType: Record<CryptoMarketType, CryptoMarket[]> = {
    [CryptoMarketType.DAILY_THRESHOLD]: [],
    [CryptoMarketType.DAILY_RANGE]: [],
    [CryptoMarketType.YEARLY_THRESHOLD]: [],
    [CryptoMarketType.INTRADAY_UPDOWN]: [],
    [CryptoMarketType.UNKNOWN]: [],
  };

  for (const market of filteredMarkets) {
    const marketType = market.signals.marketType;
    typeCounts[marketType]++;

    if (samplesByType[marketType].length < samplePerType) {
      samplesByType[marketType].push(market);
    }
  }

  // Print type distribution
  console.log(`\n[crypto:type-audit] Market Type Distribution:`);
  console.log(`${'─'.repeat(60)}`);

  const typeOrder: CryptoMarketType[] = [
    CryptoMarketType.DAILY_THRESHOLD,
    CryptoMarketType.DAILY_RANGE,
    CryptoMarketType.YEARLY_THRESHOLD,
    CryptoMarketType.INTRADAY_UPDOWN,
    CryptoMarketType.UNKNOWN,
  ];

  const typeDescriptions: Record<CryptoMarketType, string> = {
    [CryptoMarketType.DAILY_THRESHOLD]: 'Daily price threshold (above/below)',
    [CryptoMarketType.DAILY_RANGE]: 'Daily price range (between)',
    [CryptoMarketType.YEARLY_THRESHOLD]: 'Year-end / long-term threshold',
    [CryptoMarketType.INTRADAY_UPDOWN]: 'Intraday up/down (minutes/hours)',
    [CryptoMarketType.UNKNOWN]: 'Unknown / unclassified',
  };

  for (const mtype of typeOrder) {
    const count = typeCounts[mtype];
    const pct = filteredMarkets.length > 0 ? ((count / filteredMarkets.length) * 100).toFixed(1) : '0.0';
    const matchable = mtype !== CryptoMarketType.INTRADAY_UPDOWN && mtype !== CryptoMarketType.UNKNOWN;
    const marker = matchable ? '✓' : '✗';
    console.log(`  ${marker} ${mtype.padEnd(18)}: ${count.toString().padStart(5)} (${pct.padStart(5)}%) - ${typeDescriptions[mtype]}`);
  }

  // Print samples for each type
  for (const mtype of typeOrder) {
    const samples = samplesByType[mtype];
    if (samples.length === 0) continue;

    console.log(`\n${'='.repeat(80)}`);
    console.log(`[crypto:type-audit] Samples for ${mtype}:`);
    console.log(`${'─'.repeat(80)}`);

    for (let i = 0; i < samples.length; i++) {
      const m = samples[i];
      console.log(`${(i + 1).toString().padStart(2)}. [${m.market.id}] ${m.market.title.slice(0, 65)}${m.market.title.length > 65 ? '...' : ''}`);
      console.log(`    Entity: ${m.signals.entity} | Date: ${m.signals.settleDate || 'null'} | Type: ${m.signals.dateType}`);
      console.log(`    Comparator: ${m.signals.comparator || 'null'} | Numbers: ${m.signals.numbers.length > 0 ? m.signals.numbers.map(n => `$${n.toLocaleString()}`).join(', ') : 'none'}`);
    }
  }

  // Analysis
  const matchablePct = filteredMarkets.length > 0
    ? ((typeCounts[CryptoMarketType.DAILY_THRESHOLD] +
       typeCounts[CryptoMarketType.DAILY_RANGE] +
       typeCounts[CryptoMarketType.YEARLY_THRESHOLD]) / filteredMarkets.length) * 100
    : 0;
  const intradayPct = filteredMarkets.length > 0
    ? (typeCounts[CryptoMarketType.INTRADAY_UPDOWN] / filteredMarkets.length) * 100
    : 0;
  const unknownPct = filteredMarkets.length > 0
    ? (typeCounts[CryptoMarketType.UNKNOWN] / filteredMarkets.length) * 100
    : 0;

  console.log(`\n${'='.repeat(80)}`);
  console.log(`[crypto:type-audit] Analysis:`);
  console.log(`  Matchable types (DAILY_THRESHOLD + DAILY_RANGE + YEARLY): ${matchablePct.toFixed(1)}%`);
  console.log(`  Excluded intraday: ${intradayPct.toFixed(1)}%`);
  console.log(`  Unknown/unclassified: ${unknownPct.toFixed(1)}%`);

  if (intradayPct > 30) {
    console.log(`\n  ℹ️  High intraday market count. These are excluded from matching by default.`);
  }
  if (unknownPct > 10) {
    console.log(`\n  ⚠️  High unknown market type rate. Consider improving classification patterns.`);
  }

  // Convert samples for return type
  const resultSamples: Record<CryptoMarketType, Array<{
    id: number;
    title: string;
    settleDate: string | null;
    comparator: string | null;
    numbers: number[];
  }>> = {
    [CryptoMarketType.DAILY_THRESHOLD]: [],
    [CryptoMarketType.DAILY_RANGE]: [],
    [CryptoMarketType.YEARLY_THRESHOLD]: [],
    [CryptoMarketType.INTRADAY_UPDOWN]: [],
    [CryptoMarketType.UNKNOWN]: [],
  };

  for (const mtype of typeOrder) {
    resultSamples[mtype] = samplesByType[mtype].map(m => ({
      id: m.market.id,
      title: m.market.title,
      settleDate: m.signals.settleDate,
      comparator: m.signals.comparator,
      numbers: m.signals.numbers,
    }));
  }

  return {
    venue,
    entity: entity === 'all' ? 'all' : entity.toUpperCase(),
    totalMarkets: filteredMarkets.length,
    typeCounts,
    samplesByType: resultSamples,
  };
}

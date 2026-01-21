/**
 * crypto:series-audit - Series/Event ticker distribution analysis (v2.6.2)
 *
 * Shows what crypto markets exist in DB grouped by series/event/market tickers.
 * Helps diagnose coverage issues and understand market type distribution.
 */

import { type Venue } from '@data-module/core';
import {
  getKalshiSeriesTicker,
  getKalshiEventTicker,
  getTickerPrefix,
  isKalshiIntradayTicker,
} from '@data-module/core';
import {
  getClient,
  MarketRepository,
  type EligibleMarket,
} from '@data-module/db';
import {
  CRYPTO_ENTITIES_V1,
  extractCryptoSignals,
  CryptoMarketType,
} from '../matching/index.js';

export interface SeriesAuditOptions {
  /** Venue to audit */
  venue?: Venue;
  /** Entity filter (BITCOIN, ETHEREUM, or 'all') */
  entity?: string;
  /** Lookback hours */
  lookbackHours?: number;
  /** Limit markets to fetch */
  limit?: number;
  /** Sample size per group */
  samplePerGroup?: number;
  /** Top N groups to show */
  topGroups?: number;
}

export interface SeriesGroup {
  ticker: string;
  totalCount: number;
  eligibleCount: number;
  typeDistribution: Record<CryptoMarketType, number>;
  closeTimeMin: Date | null;
  closeTimeMax: Date | null;
  samples: Array<{
    id: number;
    title: string;
    marketType: CryptoMarketType;
    eventTicker: string | null;
  }>;
  isIntraday: boolean;
}

export interface SeriesAuditResult {
  venue: Venue;
  entity: string;
  totalInDB: number;
  afterKeywordFilter: number;
  bySeriesTicker: SeriesGroup[];
  byEventTickerPrefix: SeriesGroup[];
  summary: {
    hasMatchableDailyMarkets: boolean;
    intradayCount: number;
    dailyCount: number;
    yearlyCount: number;
    unknownCount: number;
  };
}

/**
 * Run crypto:series-audit diagnostic command
 */
export async function runCryptoSeriesAudit(options: SeriesAuditOptions = {}): Promise<SeriesAuditResult> {
  const {
    venue = 'kalshi',
    entity = 'all',
    lookbackHours = 720,
    limit = 20000,
    samplePerGroup = 10,
    topGroups = 30,
  } = options;

  console.log(`\n${'='.repeat(80)}`);
  console.log(`[crypto:series-audit] Series/Event Ticker Analysis v2.6.2`);
  console.log(`${'='.repeat(80)}`);
  console.log(`Venue: ${venue} | Entity: ${entity} | Lookback: ${lookbackHours}h | Limit: ${limit}`);
  console.log(`${'='.repeat(80)}\n`);

  const prisma = getClient();
  const marketRepo = new MarketRepository(prisma);

  // Build entity filter
  const entityFilter = entity === 'all'
    ? CRYPTO_ENTITIES_V1
    : [entity.toUpperCase()];
  const entitySet = new Set(entityFilter);

  // Build keyword patterns for crypto
  const fullNameKeywords = ['bitcoin', 'btc', 'ethereum', 'eth', 'solana', 'sol'];
  const tickerPatterns = [
    '(^|[^a-z0-9])\\$?btc([^a-z0-9]|$)',
    '(^|[^a-z0-9])\\$?eth([^a-z0-9]|$)',
    '(^|[^a-z0-9])\\$?sol([^a-z0-9]|$)',
  ];

  console.log(`[crypto:series-audit] Fetching all crypto markets from DB...`);

  // Fetch ALL markets (not just eligible) to understand full coverage
  const allMarkets = await marketRepo.listEligibleMarketsCrypto(venue as Venue, {
    lookbackHours,
    limit,
    fullNameKeywords,
    tickerPatterns,
    orderBy: 'closeTime', // Use closeTime to avoid id-desc bias
  });

  console.log(`  Fetched: ${allMarkets.length} markets`);

  // Process each market to extract signals and group by tickers
  const seriesGroups = new Map<string, {
    markets: Array<{ market: EligibleMarket; signals: ReturnType<typeof extractCryptoSignals> }>;
    isIntraday: boolean;
  }>();
  const eventPrefixGroups = new Map<string, {
    markets: Array<{ market: EligibleMarket; signals: ReturnType<typeof extractCryptoSignals> }>;
    isIntraday: boolean;
  }>();

  let afterKeywordFilter = 0;

  for (const market of allMarkets) {
    const signals = extractCryptoSignals(market);

    // Apply entity filter
    if (entity !== 'all' && signals.entity !== entity.toUpperCase()) {
      continue;
    }

    // Skip if no crypto entity detected
    if (!signals.entity || !entitySet.has(signals.entity)) {
      continue;
    }

    afterKeywordFilter++;

    // Get tickers
    const seriesTicker = getKalshiSeriesTicker(market.metadata) || 'UNKNOWN';
    const eventTicker = getKalshiEventTicker(market.metadata);
    const eventPrefix = getTickerPrefix(eventTicker) || 'UNKNOWN';
    const isIntraday = isKalshiIntradayTicker(eventTicker);

    // Group by series ticker
    if (!seriesGroups.has(seriesTicker)) {
      seriesGroups.set(seriesTicker, { markets: [], isIntraday });
    }
    seriesGroups.get(seriesTicker)!.markets.push({ market, signals });

    // Group by event ticker prefix
    if (!eventPrefixGroups.has(eventPrefix)) {
      eventPrefixGroups.set(eventPrefix, { markets: [], isIntraday });
    }
    eventPrefixGroups.get(eventPrefix)!.markets.push({ market, signals });
  }

  console.log(`  After entity filter "${entity}": ${afterKeywordFilter} markets`);
  console.log(`  Unique series tickers: ${seriesGroups.size}`);
  console.log(`  Unique event ticker prefixes: ${eventPrefixGroups.size}`);

  // Build result groups
  function buildGroupResult(
    ticker: string,
    data: { markets: Array<{ market: EligibleMarket; signals: ReturnType<typeof extractCryptoSignals> }>; isIntraday: boolean }
  ): SeriesGroup {
    const { markets, isIntraday } = data;

    const typeDistribution: Record<CryptoMarketType, number> = {
      [CryptoMarketType.DAILY_THRESHOLD]: 0,
      [CryptoMarketType.DAILY_RANGE]: 0,
      [CryptoMarketType.YEARLY_THRESHOLD]: 0,
      [CryptoMarketType.INTRADAY_UPDOWN]: 0,
      [CryptoMarketType.UNKNOWN]: 0,
    };

    let closeTimeMin: Date | null = null;
    let closeTimeMax: Date | null = null;
    let eligibleCount = 0;

    for (const { market, signals } of markets) {
      typeDistribution[signals.marketType]++;

      // Check "eligible" = has entity + settleDate + marketType is matchable
      const isEligible =
        signals.entity !== null &&
        signals.settleDate !== null &&
        signals.marketType !== CryptoMarketType.INTRADAY_UPDOWN &&
        signals.marketType !== CryptoMarketType.UNKNOWN;

      if (isEligible) {
        eligibleCount++;
      }

      if (market.closeTime) {
        if (!closeTimeMin || market.closeTime < closeTimeMin) {
          closeTimeMin = market.closeTime;
        }
        if (!closeTimeMax || market.closeTime > closeTimeMax) {
          closeTimeMax = market.closeTime;
        }
      }
    }

    // Get samples
    const samples = markets.slice(0, samplePerGroup).map(({ market, signals }) => ({
      id: market.id,
      title: market.title.slice(0, 70),
      marketType: signals.marketType,
      eventTicker: getKalshiEventTicker(market.metadata),
    }));

    return {
      ticker,
      totalCount: markets.length,
      eligibleCount,
      typeDistribution,
      closeTimeMin,
      closeTimeMax,
      samples,
      isIntraday,
    };
  }

  // Sort groups by total count descending
  const seriesResults = Array.from(seriesGroups.entries())
    .map(([ticker, data]) => buildGroupResult(ticker, data))
    .sort((a, b) => b.totalCount - a.totalCount)
    .slice(0, topGroups);

  const eventPrefixResults = Array.from(eventPrefixGroups.entries())
    .map(([ticker, data]) => buildGroupResult(ticker, data))
    .sort((a, b) => b.totalCount - a.totalCount)
    .slice(0, topGroups);

  // Print series ticker distribution
  console.log(`\n[crypto:series-audit] Top Series Tickers:`);
  console.log(`${'─'.repeat(100)}`);
  console.log(`${'Ticker'.padEnd(20)} | ${'Total'.padStart(7)} | ${'Eligible'.padStart(8)} | ${'Daily'.padStart(6)} | ${'Range'.padStart(6)} | ${'Yearly'.padStart(6)} | ${'Intra'.padStart(6)} | ${'Unk'.padStart(5)} | Intraday?`);
  console.log(`${'─'.repeat(100)}`);

  for (const group of seriesResults) {
    const d = group.typeDistribution;
    console.log(
      `${group.ticker.padEnd(20)} | ` +
      `${group.totalCount.toString().padStart(7)} | ` +
      `${group.eligibleCount.toString().padStart(8)} | ` +
      `${d[CryptoMarketType.DAILY_THRESHOLD].toString().padStart(6)} | ` +
      `${d[CryptoMarketType.DAILY_RANGE].toString().padStart(6)} | ` +
      `${d[CryptoMarketType.YEARLY_THRESHOLD].toString().padStart(6)} | ` +
      `${d[CryptoMarketType.INTRADAY_UPDOWN].toString().padStart(6)} | ` +
      `${d[CryptoMarketType.UNKNOWN].toString().padStart(5)} | ` +
      `${group.isIntraday ? 'YES' : 'no'}`
    );
  }

  // Print event ticker prefix distribution
  console.log(`\n[crypto:series-audit] Top Event Ticker Prefixes:`);
  console.log(`${'─'.repeat(100)}`);
  console.log(`${'Prefix'.padEnd(20)} | ${'Total'.padStart(7)} | ${'Eligible'.padStart(8)} | ${'Daily'.padStart(6)} | ${'Range'.padStart(6)} | ${'Yearly'.padStart(6)} | ${'Intra'.padStart(6)} | ${'Unk'.padStart(5)} | Intraday?`);
  console.log(`${'─'.repeat(100)}`);

  for (const group of eventPrefixResults) {
    const d = group.typeDistribution;
    console.log(
      `${group.ticker.padEnd(20)} | ` +
      `${group.totalCount.toString().padStart(7)} | ` +
      `${group.eligibleCount.toString().padStart(8)} | ` +
      `${d[CryptoMarketType.DAILY_THRESHOLD].toString().padStart(6)} | ` +
      `${d[CryptoMarketType.DAILY_RANGE].toString().padStart(6)} | ` +
      `${d[CryptoMarketType.YEARLY_THRESHOLD].toString().padStart(6)} | ` +
      `${d[CryptoMarketType.INTRADAY_UPDOWN].toString().padStart(6)} | ` +
      `${d[CryptoMarketType.UNKNOWN].toString().padStart(5)} | ` +
      `${group.isIntraday ? 'YES' : 'no'}`
    );
  }

  // Print samples for top non-intraday groups
  console.log(`\n${'='.repeat(80)}`);
  console.log(`[crypto:series-audit] Samples from NON-INTRADAY event prefixes:`);

  const nonIntradayGroups = eventPrefixResults.filter(g => !g.isIntraday && g.eligibleCount > 0);
  if (nonIntradayGroups.length === 0) {
    console.log(`  ⚠️  NO non-intraday groups with eligible markets found!`);
  } else {
    for (const group of nonIntradayGroups.slice(0, 5)) {
      console.log(`\n${'─'.repeat(80)}`);
      console.log(`[${group.ticker}] Total: ${group.totalCount}, Eligible: ${group.eligibleCount}`);
      for (const sample of group.samples.slice(0, 5)) {
        console.log(`  [${sample.id}] ${sample.marketType.padEnd(18)} | ${sample.title}...`);
      }
    }
  }

  // Print samples for intraday groups
  console.log(`\n${'='.repeat(80)}`);
  console.log(`[crypto:series-audit] Samples from INTRADAY event prefixes:`);

  const intradayGroups = eventPrefixResults.filter(g => g.isIntraday);
  if (intradayGroups.length === 0) {
    console.log(`  No intraday groups found.`);
  } else {
    for (const group of intradayGroups.slice(0, 3)) {
      console.log(`\n${'─'.repeat(80)}`);
      console.log(`[${group.ticker}] Total: ${group.totalCount} (INTRADAY)`);
      for (const sample of group.samples.slice(0, 3)) {
        console.log(`  [${sample.id}] ${sample.marketType.padEnd(18)} | ${sample.title}...`);
      }
    }
  }

  // Calculate summary
  let intradayCount = 0;
  let dailyCount = 0;
  let yearlyCount = 0;
  let unknownCount = 0;

  for (const group of eventPrefixResults) {
    const d = group.typeDistribution;
    intradayCount += d[CryptoMarketType.INTRADAY_UPDOWN];
    dailyCount += d[CryptoMarketType.DAILY_THRESHOLD] + d[CryptoMarketType.DAILY_RANGE];
    yearlyCount += d[CryptoMarketType.YEARLY_THRESHOLD];
    unknownCount += d[CryptoMarketType.UNKNOWN];
  }

  const hasMatchableDailyMarkets = dailyCount > 0 || yearlyCount > 0;

  // Print summary
  console.log(`\n${'='.repeat(80)}`);
  console.log(`[crypto:series-audit] Summary for ${entity} on ${venue}:`);
  console.log(`${'─'.repeat(60)}`);
  console.log(`  Total in DB after keyword filter: ${afterKeywordFilter}`);
  console.log(`  Intraday (INTRADAY_UPDOWN): ${intradayCount} (${((intradayCount / afterKeywordFilter) * 100).toFixed(1)}%)`);
  console.log(`  Daily (DAILY_THRESHOLD + DAILY_RANGE): ${dailyCount} (${((dailyCount / afterKeywordFilter) * 100).toFixed(1)}%)`);
  console.log(`  Yearly (YEARLY_THRESHOLD): ${yearlyCount} (${((yearlyCount / afterKeywordFilter) * 100).toFixed(1)}%)`);
  console.log(`  Unknown: ${unknownCount} (${((unknownCount / afterKeywordFilter) * 100).toFixed(1)}%)`);
  console.log(`\n  ✓ Has matchable daily/yearly markets in DB: ${hasMatchableDailyMarkets ? 'YES' : 'NO'}`);

  if (!hasMatchableDailyMarkets) {
    console.log(`\n  ❌ ROOT CAUSE: No DAILY_THRESHOLD/DAILY_RANGE/YEARLY markets exist for ${entity} on ${venue}.`);
    console.log(`     The venue only has INTRADAY_UPDOWN markets for this crypto entity.`);
  }

  return {
    venue: venue as Venue,
    entity,
    totalInDB: allMarkets.length,
    afterKeywordFilter,
    bySeriesTicker: seriesResults,
    byEventTickerPrefix: eventPrefixResults,
    summary: {
      hasMatchableDailyMarkets,
      intradayCount,
      dailyCount,
      yearlyCount,
      unknownCount,
    },
  };
}

/**
 * crypto:eligible-explain - Explain why eligible selection produced certain results (v2.6.2)
 *
 * Walks through each filtering stage to show where markets are being excluded.
 * Helps diagnose coverage issues like "100% intraday" or "no daily markets".
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
  extractCryptoSignals,
  CryptoMarketType,
} from '../matching/index.js';

export interface EligibleExplainOptions {
  /** Venue to analyze */
  venue?: Venue;
  /** Entity filter (BITCOIN, ETHEREUM) */
  entity?: string;
  /** Lookback hours */
  lookbackHours?: number;
  /** Limit markets to fetch */
  limit?: number;
  /** Mode: daily (default) or intraday */
  mode?: 'daily' | 'intraday';
}

export interface EligibleExplainResult {
  venue: Venue;
  entity: string;
  mode: 'daily' | 'intraday';
  stages: {
    totalInDB: number;
    afterKeywordFilter: number;
    afterEntityFilter: number;
    afterStatusFilter: number;
    afterLookbackFilter: number;
    afterIntradayExclusion: number;
    afterMatchableTypeFilter: number;
  };
  finalByMarketType: Record<CryptoMarketType, number>;
  topSeriesRemaining: Array<{
    ticker: string;
    count: number;
    isIntraday: boolean;
  }>;
  diagnosis: string;
  hasDailyMarkets: boolean;
}

/**
 * Run crypto:eligible-explain diagnostic command
 */
export async function runCryptoEligibleExplain(options: EligibleExplainOptions = {}): Promise<EligibleExplainResult> {
  const {
    venue = 'kalshi',
    entity = 'ETHEREUM',
    lookbackHours = 720,
    limit = 4000,
    mode = 'daily',
  } = options;

  console.log(`\n${'='.repeat(80)}`);
  console.log(`[crypto:eligible-explain] Eligibility Pipeline Analysis v2.6.2`);
  console.log(`${'='.repeat(80)}`);
  console.log(`Venue: ${venue} | Entity: ${entity} | Mode: ${mode}`);
  console.log(`Lookback: ${lookbackHours}h | Limit: ${limit}`);
  console.log(`${'='.repeat(80)}\n`);

  const prisma = getClient();
  const marketRepo = new MarketRepository(prisma);

  // Stage 1: Total in DB (estimated from keyword query)
  console.log(`[Stage 1] Fetching crypto markets from DB for ${venue}...`);
  // We'll get the actual count from the keyword query below

  // Stage 2: After keyword filter
  console.log(`\n[Stage 2] Applying crypto keyword filter...`);
  const fullNameKeywords = ['bitcoin', 'btc', 'ethereum', 'eth', 'solana', 'sol'];
  const tickerPatterns = [
    '(^|[^a-z0-9])\\$?btc([^a-z0-9]|$)',
    '(^|[^a-z0-9])\\$?eth([^a-z0-9]|$)',
    '(^|[^a-z0-9])\\$?sol([^a-z0-9]|$)',
  ];

  const marketsAfterKeyword = await marketRepo.listEligibleMarketsCrypto(venue as Venue, {
    lookbackHours: 8760, // 1 year - to see all available data
    limit: 50000,
    fullNameKeywords,
    tickerPatterns,
    orderBy: 'closeTime',
  });
  console.log(`  After keyword filter (1 year window): ${marketsAfterKeyword.length}`);

  // Stage 3: Apply entity filter
  console.log(`\n[Stage 3] Applying entity filter (${entity})...`);
  const entityUpper = entity.toUpperCase();
  const marketsWithEntity: Array<{ market: EligibleMarket; signals: ReturnType<typeof extractCryptoSignals> }> = [];

  for (const market of marketsAfterKeyword) {
    const signals = extractCryptoSignals(market);
    if (signals.entity === entityUpper) {
      marketsWithEntity.push({ market, signals });
    }
  }
  console.log(`  After entity filter: ${marketsWithEntity.length}`);

  // Stage 4: Status filter (already applied in query - active or closed within window)
  console.log(`\n[Stage 4] Status filter is applied in DB query (active or recently closed)...`);

  // Stage 5: Lookback filter
  console.log(`\n[Stage 5] Applying lookback filter (${lookbackHours}h)...`);
  const lookbackCutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
  const marketsInWindow = marketsWithEntity.filter(({ market }) => {
    if (!market.closeTime) return true; // No closeTime = assume active
    return market.closeTime >= lookbackCutoff;
  });
  console.log(`  After lookback filter: ${marketsInWindow.length}`);

  // Stage 6: Intraday exclusion (for daily mode)
  console.log(`\n[Stage 6] Applying intraday exclusion (mode: ${mode})...`);
  let marketsAfterIntraday = marketsInWindow;

  if (mode === 'daily') {
    marketsAfterIntraday = marketsInWindow.filter(({ market, signals }) => {
      const eventTicker = getKalshiEventTicker(market.metadata);
      // Exclude if ticker indicates intraday OR marketType is INTRADAY_UPDOWN
      if (isKalshiIntradayTicker(eventTicker)) {
        return false;
      }
      if (signals.marketType === CryptoMarketType.INTRADAY_UPDOWN) {
        return false;
      }
      return true;
    });
    console.log(`  After intraday exclusion: ${marketsAfterIntraday.length}`);
    console.log(`  Excluded as intraday: ${marketsInWindow.length - marketsAfterIntraday.length}`);
  } else {
    // For intraday mode, KEEP only intraday
    marketsAfterIntraday = marketsInWindow.filter(({ market, signals }) => {
      const eventTicker = getKalshiEventTicker(market.metadata);
      return isKalshiIntradayTicker(eventTicker) || signals.marketType === CryptoMarketType.INTRADAY_UPDOWN;
    });
    console.log(`  After keeping only intraday: ${marketsAfterIntraday.length}`);
  }

  // Stage 7: Matchable type filter
  console.log(`\n[Stage 7] Applying matchable type filter...`);
  const matchableTypes = mode === 'daily'
    ? new Set([CryptoMarketType.DAILY_THRESHOLD, CryptoMarketType.DAILY_RANGE, CryptoMarketType.YEARLY_THRESHOLD])
    : new Set([CryptoMarketType.INTRADAY_UPDOWN]);

  const finalMarkets = marketsAfterIntraday.filter(({ signals }) => {
    return matchableTypes.has(signals.marketType);
  });
  console.log(`  After matchable type filter: ${finalMarkets.length}`);

  // Count by market type
  const typeDistribution: Record<CryptoMarketType, number> = {
    [CryptoMarketType.DAILY_THRESHOLD]: 0,
    [CryptoMarketType.DAILY_RANGE]: 0,
    [CryptoMarketType.YEARLY_THRESHOLD]: 0,
    [CryptoMarketType.INTRADAY_UPDOWN]: 0,
    [CryptoMarketType.UNKNOWN]: 0,
  };

  for (const { signals } of finalMarkets) {
    typeDistribution[signals.marketType]++;
  }

  // Group remaining by series ticker
  const seriesGroups = new Map<string, { count: number; isIntraday: boolean }>();
  for (const { market } of finalMarkets) {
    const seriesTicker = getKalshiSeriesTicker(market.metadata) || 'UNKNOWN';
    const eventTicker = getKalshiEventTicker(market.metadata);
    const isIntraday = isKalshiIntradayTicker(eventTicker);

    if (!seriesGroups.has(seriesTicker)) {
      seriesGroups.set(seriesTicker, { count: 0, isIntraday });
    }
    seriesGroups.get(seriesTicker)!.count++;
  }

  const topSeries = Array.from(seriesGroups.entries())
    .map(([ticker, data]) => ({ ticker, ...data }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  // Print type distribution
  console.log(`\n[crypto:eligible-explain] Final Market Type Distribution:`);
  console.log(`${'─'.repeat(60)}`);
  for (const [mtype, count] of Object.entries(typeDistribution)) {
    if (count > 0) {
      const pct = finalMarkets.length > 0 ? ((count / finalMarkets.length) * 100).toFixed(1) : '0.0';
      console.log(`  ${mtype.padEnd(20)}: ${count.toString().padStart(6)} (${pct.padStart(5)}%)`);
    }
  }

  // Print top series
  console.log(`\n[crypto:eligible-explain] Top Series Tickers Remaining:`);
  console.log(`${'─'.repeat(60)}`);
  if (topSeries.length === 0) {
    console.log(`  (none)`);
  } else {
    for (const s of topSeries) {
      console.log(`  ${s.ticker.padEnd(25)}: ${s.count.toString().padStart(5)} ${s.isIntraday ? '(INTRADAY)' : ''}`);
    }
  }

  // Diagnosis
  let diagnosis: string;
  const hasDailyMarkets =
    typeDistribution[CryptoMarketType.DAILY_THRESHOLD] > 0 ||
    typeDistribution[CryptoMarketType.DAILY_RANGE] > 0 ||
    typeDistribution[CryptoMarketType.YEARLY_THRESHOLD] > 0;

  if (mode === 'daily') {
    if (finalMarkets.length === 0) {
      if (marketsWithEntity.length === 0) {
        diagnosis = `NO_DATA: No ${entity} markets found in DB for ${venue}.`;
      } else if (marketsInWindow.length === 0) {
        diagnosis = `OUT_OF_WINDOW: ${entity} markets exist but none within ${lookbackHours}h lookback.`;
      } else if (marketsAfterIntraday.length === 0) {
        diagnosis = `ALL_INTRADAY: All ${entity} markets on ${venue} are INTRADAY_UPDOWN. No daily markets exist.`;
      } else {
        diagnosis = `TYPE_MISMATCH: Markets exist but none have matchable types (DAILY_THRESHOLD/RANGE/YEARLY).`;
      }
    } else {
      diagnosis = `OK: Found ${finalMarkets.length} eligible daily markets for ${entity} on ${venue}.`;
    }
  } else {
    if (finalMarkets.length === 0) {
      diagnosis = `NO_INTRADAY: No INTRADAY_UPDOWN markets found for ${entity} on ${venue}.`;
    } else {
      diagnosis = `OK: Found ${finalMarkets.length} eligible intraday markets for ${entity} on ${venue}.`;
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`[crypto:eligible-explain] DIAGNOSIS:`);
  console.log(`${'─'.repeat(60)}`);
  console.log(`  ${diagnosis}`);

  // Additional explanation if ALL_INTRADAY
  if (diagnosis.startsWith('ALL_INTRADAY')) {
    console.log(`\n  Breakdown of intraday-excluded markets:`);
    const intradayByPrefix = new Map<string, number>();
    for (const { market } of marketsInWindow) {
      const eventTicker = getKalshiEventTicker(market.metadata);
      const prefix = getTickerPrefix(eventTicker) || 'UNKNOWN';
      intradayByPrefix.set(prefix, (intradayByPrefix.get(prefix) || 0) + 1);
    }
    const sortedPrefixes = Array.from(intradayByPrefix.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    for (const [prefix, count] of sortedPrefixes) {
      const isIntra = isKalshiIntradayTicker(prefix);
      console.log(`    ${prefix.padEnd(20)}: ${count.toString().padStart(5)} ${isIntra ? '(INTRADAY pattern)' : ''}`);
    }
  }

  return {
    venue: venue as Venue,
    entity: entityUpper,
    mode,
    stages: {
      totalInDB: marketsAfterKeyword.length, // This is after keyword filter, not true total
      afterKeywordFilter: marketsAfterKeyword.length,
      afterEntityFilter: marketsWithEntity.length,
      afterStatusFilter: marketsWithEntity.length, // Applied in query
      afterLookbackFilter: marketsInWindow.length,
      afterIntradayExclusion: marketsAfterIntraday.length,
      afterMatchableTypeFilter: finalMarkets.length,
    },
    finalByMarketType: typeDistribution,
    topSeriesRemaining: topSeries,
    diagnosis,
    hasDailyMarkets,
  };
}

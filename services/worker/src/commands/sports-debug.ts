/**
 * Sports Debug Commands (v3.0.13)
 *
 * Diagnostics for SPORTS pipeline:
 * - sports:audit - Show SPORTS market breakdown by eligibility
 * - sports:sample - Show sample markets with signals
 * - sports:eligible - Show eligible markets count
 * - sports:event-coverage - Show event coverage for SPORTS markets
 */

import { getClient, MarketRepository, KalshiEventRepository } from '@data-module/db';
import type { Venue } from '@data-module/core';
import {
  extractSportsSignals,
  isEligibleSportsMarket,
  isEligibleSportsMarketV2,
  getExclusionReason,
  SPORTS_KEYWORDS,
  toSportsEventData,
  type SportsSignals,
  type SportsEventData,
} from '../matching/signals/sportsSignals.js';

// ============================================================================
// TYPES
// ============================================================================

export interface SportsAuditOptions {
  venue: Venue;
  limit?: number;
  lookbackHours?: number;
  useV2?: boolean;  // Use v2 eligibility rules
  withEvents?: boolean;  // Fetch event data for enrichment
}

export interface SportsAuditResult {
  venue: Venue;
  totalMarkets: number;
  eligibleV1: number;
  eligibleV2: number;
  eventEnriched: number;
  byLeague: Record<string, number>;
  byMarketType: Record<string, number>;
  byExcludeReason: Record<string, number>;
  teamsFromEvent: number;
  timeFromEvent: number;
}

export interface SportsSampleOptions {
  venue: Venue;
  limit?: number;
  lookbackHours?: number;
  filter?: 'eligible' | 'excluded' | 'all';
  withEvents?: boolean;
}

export interface SportsSampleResult {
  markets: Array<{
    id: number;
    title: string;
    signals: SportsSignals;
    eligibleV1: boolean;
    eligibleV2: boolean;
    exclusionReason: string | null;
    eventEnriched: boolean;
  }>;
}

export interface SportsEligibleOptions {
  lookbackHours?: number;
  limit?: number;
  useV2?: boolean;
  withEvents?: boolean;
}

export interface SportsEligibleResult {
  kalshiTotal: number;
  kalshiEligible: number;
  kalshiEventEnriched: number;
  polymarketTotal: number;
  polymarketEligible: number;
}

// ============================================================================
// AUDIT COMMAND
// ============================================================================

export async function runSportsAudit(options: SportsAuditOptions): Promise<SportsAuditResult> {
  const prisma = getClient();
  const marketRepo = new MarketRepository(prisma);
  const eventRepo = new KalshiEventRepository(prisma);

  const {
    venue,
    limit = 10000,
    lookbackHours = 720,
    useV2 = false,
    withEvents = true,
  } = options;

  console.log(`\n=== Sports Audit (v3.0.13) ===\n`);
  console.log(`Venue: ${venue}`);
  console.log(`Lookback: ${lookbackHours}h`);
  console.log(`Limit: ${limit}`);
  console.log(`V2 eligibility: ${useV2}`);
  console.log(`With events: ${withEvents}`);

  // v3.0.13: Use derivedTopic for Kalshi, keywords for Polymarket
  let markets;
  if (venue === 'kalshi') {
    markets = await marketRepo.listMarketsByDerivedTopic('SPORTS', {
      venue: 'kalshi',
      lookbackHours,
      limit,
    });
    console.log(`\nFetched ${markets.length} Kalshi markets with derivedTopic=SPORTS`);
  } else {
    markets = await marketRepo.listEligibleMarkets(venue, {
      lookbackHours,
      limit,
      titleKeywords: SPORTS_KEYWORDS,
    });
    console.log(`\nFetched ${markets.length} markets with sports keywords`);
  }

  // Build event map for Kalshi
  const eventDataMap = new Map<string, SportsEventData>();
  if (venue === 'kalshi' && withEvents) {
    const eventTickers = new Set<string>();
    for (const market of markets) {
      if (market.kalshiEventTicker) {
        eventTickers.add(market.kalshiEventTicker);
      } else {
        const metadata = market.metadata as Record<string, unknown> | null;
        if (metadata?.eventTicker) {
          eventTickers.add(String(metadata.eventTicker));
        }
      }
    }

    if (eventTickers.size > 0) {
      console.log(`Fetching ${eventTickers.size} events for enrichment...`);
      const eventsMap = await eventRepo.getEventsMap([...eventTickers]);
      for (const [ticker, event] of eventsMap) {
        eventDataMap.set(ticker, toSportsEventData(event));
      }
      console.log(`Found ${eventDataMap.size} events in DB`);
    }
  }

  // Process markets
  const result: SportsAuditResult = {
    venue,
    totalMarkets: markets.length,
    eligibleV1: 0,
    eligibleV2: 0,
    eventEnriched: 0,
    byLeague: {},
    byMarketType: {},
    byExcludeReason: {},
    teamsFromEvent: 0,
    timeFromEvent: 0,
  };

  for (const market of markets) {
    // Get event data
    let eventData: SportsEventData | undefined;
    if (market.kalshiEventTicker) {
      eventData = eventDataMap.get(market.kalshiEventTicker);
    } else {
      const metadata = market.metadata as Record<string, unknown> | null;
      if (metadata?.eventTicker) {
        eventData = eventDataMap.get(String(metadata.eventTicker));
      }
    }

    const signals = extractSportsSignals(market, eventData);

    // Track league
    const league = signals.eventKey.league || 'UNKNOWN';
    result.byLeague[league] = (result.byLeague[league] || 0) + 1;

    // Track market type
    const marketType = signals.line.marketType || 'UNKNOWN';
    result.byMarketType[marketType] = (result.byMarketType[marketType] || 0) + 1;

    // Track event enrichment
    if (signals.eventKey.teamsSource === 'event') {
      result.teamsFromEvent++;
      result.eventEnriched++;
    }
    if (signals.eventKey.startTimeSource === 'event') {
      result.timeFromEvent++;
    }

    // Check eligibility
    if (isEligibleSportsMarket(signals)) {
      result.eligibleV1++;
    }
    if (isEligibleSportsMarketV2(signals)) {
      result.eligibleV2++;
    }

    // Track exclusion reason
    const exclusionReason = getExclusionReason(signals);
    if (exclusionReason) {
      result.byExcludeReason[exclusionReason] = (result.byExcludeReason[exclusionReason] || 0) + 1;
    }
  }

  // Print results
  console.log(`\n--- Eligibility ---`);
  console.log(`Total markets: ${result.totalMarkets}`);
  console.log(`Eligible (V1): ${result.eligibleV1} (${((result.eligibleV1 / result.totalMarkets) * 100).toFixed(1)}%)`);
  console.log(`Eligible (V2): ${result.eligibleV2} (${((result.eligibleV2 / result.totalMarkets) * 100).toFixed(1)}%)`);
  console.log(`Event-enriched: ${result.eventEnriched}`);

  console.log(`\n--- Data Sources ---`);
  console.log(`Teams from event: ${result.teamsFromEvent}`);
  console.log(`Time from event: ${result.timeFromEvent}`);

  console.log(`\n--- By League ---`);
  const sortedLeagues = Object.entries(result.byLeague).sort((a, b) => b[1] - a[1]);
  for (const [league, count] of sortedLeagues.slice(0, 10)) {
    console.log(`  ${league}: ${count}`);
  }

  console.log(`\n--- By Market Type ---`);
  const sortedTypes = Object.entries(result.byMarketType).sort((a, b) => b[1] - a[1]);
  for (const [type, count] of sortedTypes) {
    console.log(`  ${type}: ${count}`);
  }

  console.log(`\n--- Exclusion Reasons (top 10) ---`);
  const sortedReasons = Object.entries(result.byExcludeReason).sort((a, b) => b[1] - a[1]);
  for (const [reason, count] of sortedReasons.slice(0, 10)) {
    console.log(`  ${reason}: ${count}`);
  }

  return result;
}

// ============================================================================
// SAMPLE COMMAND
// ============================================================================

export async function runSportsSample(options: SportsSampleOptions): Promise<SportsSampleResult> {
  const prisma = getClient();
  const marketRepo = new MarketRepository(prisma);
  const eventRepo = new KalshiEventRepository(prisma);

  const {
    venue,
    limit = 20,
    lookbackHours = 720,
    filter = 'all',
    withEvents = true,
  } = options;

  console.log(`\n=== Sports Sample (v3.0.13) ===\n`);
  console.log(`Venue: ${venue}`);
  console.log(`Filter: ${filter}`);
  console.log(`Limit: ${limit}`);

  // v3.0.13: Use derivedTopic for Kalshi, keywords for Polymarket
  let markets;
  if (venue === 'kalshi') {
    markets = await marketRepo.listMarketsByDerivedTopic('SPORTS', {
      venue: 'kalshi',
      lookbackHours,
      limit: 5000, // Fetch more to filter
    });
  } else {
    markets = await marketRepo.listEligibleMarkets(venue, {
      lookbackHours,
      limit: 5000, // Fetch more to filter
      titleKeywords: SPORTS_KEYWORDS,
    });
  }

  // Build event map
  const eventDataMap = new Map<string, SportsEventData>();
  if (venue === 'kalshi' && withEvents) {
    const eventTickers = new Set<string>();
    for (const market of markets) {
      if (market.kalshiEventTicker) {
        eventTickers.add(market.kalshiEventTicker);
      } else {
        const metadata = market.metadata as Record<string, unknown> | null;
        if (metadata?.eventTicker) {
          eventTickers.add(String(metadata.eventTicker));
        }
      }
    }

    if (eventTickers.size > 0) {
      const eventsMap = await eventRepo.getEventsMap([...eventTickers]);
      for (const [ticker, event] of eventsMap) {
        eventDataMap.set(ticker, toSportsEventData(event));
      }
    }
  }

  // Process and filter
  const samples: SportsSampleResult['markets'] = [];

  for (const market of markets) {
    if (samples.length >= limit) break;

    let eventData: SportsEventData | undefined;
    if (market.kalshiEventTicker) {
      eventData = eventDataMap.get(market.kalshiEventTicker);
    } else {
      const metadata = market.metadata as Record<string, unknown> | null;
      if (metadata?.eventTicker) {
        eventData = eventDataMap.get(String(metadata.eventTicker));
      }
    }

    const signals = extractSportsSignals(market, eventData);
    const eligibleV1 = isEligibleSportsMarket(signals);
    const eligibleV2 = isEligibleSportsMarketV2(signals);
    const exclusionReason = getExclusionReason(signals);

    // Apply filter
    if (filter === 'eligible' && !eligibleV2) continue;
    if (filter === 'excluded' && eligibleV2) continue;

    samples.push({
      id: market.id,
      title: market.title,
      signals,
      eligibleV1,
      eligibleV2,
      exclusionReason,
      eventEnriched: signals.eventKey.teamsSource === 'event',
    });
  }

  // Print samples
  console.log(`\n--- Sample Markets (${samples.length}) ---\n`);

  for (const sample of samples) {
    console.log(`[${sample.id}] ${sample.title}`);
    console.log(`  League: ${sample.signals.eventKey.league}`);
    console.log(`  Teams: "${sample.signals.eventKey.teamA_norm}" vs "${sample.signals.eventKey.teamB_norm}" (from: ${sample.signals.eventKey.teamsSource})`);
    console.log(`  Time: ${sample.signals.eventKey.startBucket} (from: ${sample.signals.eventKey.startTimeSource})`);
    console.log(`  Type: ${sample.signals.line.marketType}, Line: ${sample.signals.line.lineValue ?? 'N/A'}`);
    console.log(`  Eligible V1: ${sample.eligibleV1 ? '✓' : '✗'}, V2: ${sample.eligibleV2 ? '✓' : '✗'}`);
    if (sample.exclusionReason) {
      console.log(`  Exclusion: ${sample.exclusionReason}`);
    }
    if (sample.eventEnriched) {
      console.log(`  Event-enriched: ✓`);
    }
    console.log();
  }

  return { markets: samples };
}

// ============================================================================
// ELIGIBLE COMMAND
// ============================================================================

export async function runSportsEligible(options: SportsEligibleOptions): Promise<SportsEligibleResult> {
  const prisma = getClient();
  const marketRepo = new MarketRepository(prisma);
  const eventRepo = new KalshiEventRepository(prisma);

  const {
    lookbackHours = 720,
    limit = 20000,
    useV2 = true,
    withEvents = true,
  } = options;

  console.log(`\n=== Sports Eligible (v3.0.13) ===\n`);
  console.log(`Lookback: ${lookbackHours}h`);
  console.log(`Limit: ${limit}`);
  console.log(`V2 eligibility: ${useV2}`);
  console.log(`With events: ${withEvents}`);

  const eligibilityFn = useV2 ? isEligibleSportsMarketV2 : isEligibleSportsMarket;

  // Kalshi - v3.0.13: Use derivedTopic instead of keywords
  console.log(`\n--- Kalshi ---`);
  const kalshiMarkets = await marketRepo.listMarketsByDerivedTopic('SPORTS', {
    venue: 'kalshi',
    lookbackHours,
    limit,
  });

  // Build event map for Kalshi
  const eventDataMap = new Map<string, SportsEventData>();
  if (withEvents) {
    const eventTickers = new Set<string>();
    for (const market of kalshiMarkets) {
      if (market.kalshiEventTicker) {
        eventTickers.add(market.kalshiEventTicker);
      } else {
        const metadata = market.metadata as Record<string, unknown> | null;
        if (metadata?.eventTicker) {
          eventTickers.add(String(metadata.eventTicker));
        }
      }
    }

    if (eventTickers.size > 0) {
      console.log(`Fetching ${eventTickers.size} events...`);
      const eventsMap = await eventRepo.getEventsMap([...eventTickers]);
      for (const [ticker, event] of eventsMap) {
        eventDataMap.set(ticker, toSportsEventData(event));
      }
      console.log(`Found ${eventDataMap.size} events`);
    }
  }

  let kalshiEligible = 0;
  let kalshiEventEnriched = 0;
  for (const market of kalshiMarkets) {
    let eventData: SportsEventData | undefined;
    if (market.kalshiEventTicker) {
      eventData = eventDataMap.get(market.kalshiEventTicker);
    } else {
      const metadata = market.metadata as Record<string, unknown> | null;
      if (metadata?.eventTicker) {
        eventData = eventDataMap.get(String(metadata.eventTicker));
      }
    }

    const signals = extractSportsSignals(market, eventData);
    if (signals.eventKey.teamsSource === 'event') {
      kalshiEventEnriched++;
    }
    if (eligibilityFn(signals)) {
      kalshiEligible++;
    }
  }

  console.log(`Total: ${kalshiMarkets.length}`);
  console.log(`Eligible: ${kalshiEligible}`);
  console.log(`Event-enriched: ${kalshiEventEnriched}`);

  // Polymarket
  console.log(`\n--- Polymarket ---`);
  const polymarketMarkets = await marketRepo.listEligibleMarkets('polymarket', {
    lookbackHours,
    limit,
    titleKeywords: SPORTS_KEYWORDS,
  });

  let polymarketEligible = 0;
  for (const market of polymarketMarkets) {
    const signals = extractSportsSignals(market);
    if (eligibilityFn(signals)) {
      polymarketEligible++;
    }
  }

  console.log(`Total: ${polymarketMarkets.length}`);
  console.log(`Eligible: ${polymarketEligible}`);

  // Summary
  console.log(`\n--- Summary ---`);
  console.log(`Kalshi eligible: ${kalshiEligible} / ${kalshiMarkets.length}`);
  console.log(`Polymarket eligible: ${polymarketEligible} / ${polymarketMarkets.length}`);

  const canMatch = Math.min(kalshiEligible, polymarketEligible);
  console.log(`\nPotential matching pairs: up to ${canMatch}`);

  return {
    kalshiTotal: kalshiMarkets.length,
    kalshiEligible,
    kalshiEventEnriched,
    polymarketTotal: polymarketMarkets.length,
    polymarketEligible,
  };
}

// ============================================================================
// EVENT COVERAGE COMMAND (v3.0.13)
// ============================================================================

export interface EventCoverageOptions {
  topic?: string;
  venue?: 'kalshi';
}

export interface EventCoverageResult {
  marketsWithEventTicker: number;
  uniqueEventTickers: number;
  eventsInDb: number;
  marketsLinked: number;
  coverage: number;
}

/**
 * Check event coverage for Kalshi SPORTS markets (v3.0.13)
 */
export async function runSportsEventCoverage(options: EventCoverageOptions): Promise<EventCoverageResult> {
  const prisma = getClient();

  const { topic = 'SPORTS' } = options;

  console.log(`\n=== Sports Event Coverage (v3.0.13) ===\n`);
  console.log(`Topic: ${topic}`);

  // Count markets with eventTicker in metadata
  const withEventTickerResult = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count
    FROM markets
    WHERE venue = 'kalshi'
      AND derived_topic = ${topic}
      AND metadata->>'eventTicker' IS NOT NULL
  `;
  const marketsWithEventTicker = Number(withEventTickerResult[0]?.count ?? 0);

  // Count unique eventTickers in markets
  const uniqueTickersResult = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(DISTINCT metadata->>'eventTicker') as count
    FROM markets
    WHERE venue = 'kalshi'
      AND derived_topic = ${topic}
      AND metadata->>'eventTicker' IS NOT NULL
  `;
  const uniqueEventTickers = Number(uniqueTickersResult[0]?.count ?? 0);

  // Count events in DB
  const eventsInDb = await prisma.kalshiEvent.count();

  // Count markets linked to events (have kalshiEventTicker set)
  const linkedResult = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count
    FROM markets
    WHERE venue = 'kalshi'
      AND derived_topic = ${topic}
      AND kalshi_event_ticker IS NOT NULL
  `;
  const marketsLinked = Number(linkedResult[0]?.count ?? 0);

  const coverage = marketsWithEventTicker > 0
    ? (marketsLinked / marketsWithEventTicker) * 100
    : 0;

  console.log(`
Event Coverage Report (topic: ${topic})
================================
Markets with eventTicker:  ${marketsWithEventTicker.toLocaleString()}
Unique eventTickers:       ${uniqueEventTickers.toLocaleString()}
Events in DB:              ${eventsInDb.toLocaleString()}
Markets linked:            ${marketsLinked.toLocaleString()}
Coverage:                  ${coverage.toFixed(1)}%
`);

  // Show sample unlinked markets
  if (marketsWithEventTicker > marketsLinked) {
    console.log(`\n--- Sample Unlinked Markets ---`);

    const unlinked = await prisma.$queryRaw<Array<{ id: number; title: string; eventTicker: string }>>`
      SELECT id, title, metadata->>'eventTicker' as "eventTicker"
      FROM markets
      WHERE venue = 'kalshi'
        AND derived_topic = ${topic}
        AND metadata->>'eventTicker' IS NOT NULL
        AND kalshi_event_ticker IS NULL
      LIMIT 10
    `;

    for (const row of unlinked) {
      console.log(`  [${row.id}] ${row.eventTicker}: ${row.title.slice(0, 60)}...`);
    }
  }

  return {
    marketsWithEventTicker,
    uniqueEventTickers,
    eventsInDb,
    marketsLinked,
    coverage,
  };
}

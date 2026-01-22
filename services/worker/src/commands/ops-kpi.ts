/**
 * ops:kpi - Key Performance Indicators Dashboard (v2.6.8)
 *
 * Displays 6 key health metrics:
 * 1. Suggested links total
 * 2. Confirmed links total
 * 3. Confirmed links last 24h
 * 4. Watchlist total + priority breakdown
 * 5. Quotes freshness (per venue)
 * 6. Ingestion health summary
 *
 * Run: pnpm --filter @data-module/worker ops:kpi
 */

import { getClient, WatchlistRepository, MarketLinkRepository, type Venue } from '@data-module/db';

export interface OpsKpiResult {
  timestamp: string;
  links: {
    suggested: number;
    confirmed: number;
    rejected: number;
    confirmedLast24h: number;
    avgScoreConfirmed: number;
    avgScoreSuggested: number;
    byTopic: Record<string, { suggested: number; confirmed: number }>;
  };
  watchlist: {
    total: number;
    byVenue: Record<string, number>;
    byPriority: Record<number, number>;
  };
  quotesFreshness: {
    venue: string;
    quotesLast5m: number;
    quotesLast1h: number;
    latestQuoteAge: string;
    healthy: boolean;
  }[];
  ingestion: {
    venue: string;
    lastMarketsSync: string;
    lastQuotesSync: string;
    marketsError: string | null;
    quotesError: string | null;
    healthy: boolean;
  }[];
  overall: {
    healthy: boolean;
    issues: string[];
  };
}

export async function runOpsKpi(): Promise<OpsKpiResult> {
  const prisma = getClient();
  const watchlistRepo = new WatchlistRepository(prisma);
  const linkRepo = new MarketLinkRepository(prisma);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[ops:kpi] Key Performance Indicators (v2.6.8)`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log();

  const issues: string[] = [];

  // 1. Links Statistics
  console.log('[1/6] Links Statistics');
  const linkStats = await linkRepo.getStats();

  const suggested = linkStats.byStatus.suggested || 0;
  const confirmed = linkStats.byStatus.confirmed || 0;
  const rejected = linkStats.byStatus.rejected || 0;
  const avgScoreConfirmed = linkStats.avgScoreByStatus.confirmed || 0;
  const avgScoreSuggested = linkStats.avgScoreByStatus.suggested || 0;

  console.log(`  Suggested: ${suggested.toLocaleString()}`);
  console.log(`  Confirmed: ${confirmed.toLocaleString()}`);
  console.log(`  Rejected:  ${rejected.toLocaleString()}`);
  console.log(`  Avg Score (confirmed): ${avgScoreConfirmed.toFixed(3)}`);
  console.log(`  Avg Score (suggested): ${avgScoreSuggested.toFixed(3)}`);

  // Count confirmed in last 24h
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const confirmedLast24h = await prisma.marketLink.count({
    where: {
      status: 'confirmed',
      updatedAt: { gte: last24h },
    },
  });
  console.log(`  Confirmed (last 24h): ${confirmedLast24h}`);

  // By topic breakdown
  const byTopic: Record<string, { suggested: number; confirmed: number }> = {};
  for (const topic of Object.keys(linkStats.byTopic)) {
    // Get breakdown by status for this topic
    const topicConfirmed = await prisma.marketLink.count({
      where: { topic, status: 'confirmed' },
    });
    const topicSuggested = await prisma.marketLink.count({
      where: { topic, status: 'suggested' },
    });
    byTopic[topic] = { suggested: topicSuggested, confirmed: topicConfirmed };
  }

  console.log('  [By Topic]');
  for (const [topic, stats] of Object.entries(byTopic)) {
    console.log(`    ${topic.padEnd(18)} suggested=${String(stats.suggested).padStart(6)} confirmed=${String(stats.confirmed).padStart(4)}`);
  }
  console.log();

  if (confirmed < 100) {
    issues.push(`Low confirmed links: ${confirmed} (target: 100+)`);
  }

  // 2. Confirmed last 24h
  console.log('[2/6] Confirmed Links (Last 24h)');
  console.log(`  Count: ${confirmedLast24h}`);
  if (confirmedLast24h === 0) {
    console.log('  ⚠️  No new confirmations in last 24h');
    issues.push('No new link confirmations in last 24h');
  }
  console.log();

  // 3. Watchlist Statistics
  console.log('[3/6] Watchlist Statistics');
  const watchlistStats = await watchlistRepo.getStats();

  console.log(`  Total: ${watchlistStats.total.toLocaleString()}`);
  console.log('  [By Venue]');
  for (const [venue, count] of Object.entries(watchlistStats.byVenue)) {
    console.log(`    ${venue}: ${count}`);
  }
  console.log('  [By Priority]');
  for (const { priority, count } of watchlistStats.byPriority) {
    const label = priority === 100 ? 'confirmed' : priority === 80 ? 'candidate-safe' : priority === 50 ? 'top_suggested' : 'other';
    console.log(`    ${priority} (${label}): ${count}`);
  }
  console.log();

  if (watchlistStats.total < 500) {
    issues.push(`Low watchlist count: ${watchlistStats.total} (target: 500+)`);
  }

  // 4. Quotes Freshness
  console.log('[4/6] Quotes Freshness');
  const venues: Venue[] = ['kalshi', 'polymarket'];
  const quotesFreshness: OpsKpiResult['quotesFreshness'] = [];

  for (const venue of venues) {
    const cutoff5m = new Date(Date.now() - 5 * 60 * 1000);
    const cutoff1h = new Date(Date.now() - 60 * 60 * 1000);

    const quotesLast5m = await prisma.quote.count({
      where: {
        outcome: { market: { venue } },
        ts: { gte: cutoff5m },
      },
    });

    const quotesLast1h = await prisma.quote.count({
      where: {
        outcome: { market: { venue } },
        ts: { gte: cutoff1h },
      },
    });

    // Get latest quote
    const latestQuote = await prisma.quote.findFirst({
      where: { outcome: { market: { venue } } },
      orderBy: { ts: 'desc' },
      select: { ts: true },
    });

    let latestQuoteAge = 'N/A';
    if (latestQuote) {
      const ageMs = Date.now() - latestQuote.ts.getTime();
      const ageMinutes = Math.floor(ageMs / 60000);
      latestQuoteAge = ageMinutes < 60 ? `${ageMinutes}m ago` : `${Math.floor(ageMinutes / 60)}h ago`;
    }

    const healthy = quotesLast5m > 0;
    const status = healthy ? '✓' : '⚠️';

    console.log(`  [${venue}]`);
    console.log(`    Last 5m:  ${quotesLast5m.toLocaleString()} ${status}`);
    console.log(`    Last 1h:  ${quotesLast1h.toLocaleString()}`);
    console.log(`    Latest:   ${latestQuoteAge}`);

    quotesFreshness.push({
      venue,
      quotesLast5m,
      quotesLast1h,
      latestQuoteAge,
      healthy,
    });

    if (!healthy) {
      issues.push(`No fresh quotes for ${venue} (last 5m)`);
    }
  }
  console.log();

  // 5. Ingestion Health
  console.log('[5/6] Ingestion Health');
  const ingestion: OpsKpiResult['ingestion'] = [];

  for (const venue of venues) {
    // Get ingestion states
    const marketsState = await prisma.ingestionState.findUnique({
      where: { venue_jobName: { venue, jobName: 'markets' } },
    });
    const quotesState = await prisma.ingestionState.findUnique({
      where: { venue_jobName: { venue, jobName: 'quotes' } },
    });

    const lastMarketsSync = marketsState?.lastSuccessAt
      ? formatAge(marketsState.lastSuccessAt)
      : 'never';
    const lastQuotesSync = quotesState?.lastSuccessAt
      ? formatAge(quotesState.lastSuccessAt)
      : 'never';

    const marketsError = marketsState?.lastError || null;
    const quotesError = quotesState?.lastError || null;

    const healthy = !marketsError && !quotesError &&
      marketsState?.lastSuccessAt && quotesState?.lastSuccessAt;

    const status = healthy ? '✓' : '⚠️';

    console.log(`  [${venue}] ${status}`);
    console.log(`    Markets: ${lastMarketsSync}${marketsError ? ` (error: ${marketsError.slice(0, 50)})` : ''}`);
    console.log(`    Quotes:  ${lastQuotesSync}${quotesError ? ` (error: ${quotesError.slice(0, 50)})` : ''}`);

    ingestion.push({
      venue,
      lastMarketsSync,
      lastQuotesSync,
      marketsError,
      quotesError,
      healthy: !!healthy,
    });

    if (marketsError) {
      issues.push(`${venue} markets ingestion error`);
    }
    if (quotesError) {
      issues.push(`${venue} quotes ingestion error`);
    }
  }
  console.log();

  // 6. Overall Health
  console.log('[6/6] Overall Health');
  const overallHealthy = issues.length === 0;

  if (overallHealthy) {
    console.log('  ✓ All systems healthy');
  } else {
    console.log(`  ⚠️  ${issues.length} issue(s) detected:`);
    for (const issue of issues) {
      console.log(`    - ${issue}`);
    }
  }
  console.log();

  // Summary box
  console.log(`${'='.repeat(60)}`);
  console.log(`[KPI Summary]`);
  console.log(`  Links:     ${confirmed} confirmed / ${suggested} suggested`);
  console.log(`  Watchlist: ${watchlistStats.total} markets`);
  console.log(`  Quotes:    ${quotesFreshness.map(q => `${q.venue}=${q.quotesLast5m}`).join(', ')} (5m)`);
  console.log(`  Health:    ${overallHealthy ? '✓ OK' : `⚠️ ${issues.length} issues`}`);
  console.log(`${'='.repeat(60)}`);

  return {
    timestamp: new Date().toISOString(),
    links: {
      suggested,
      confirmed,
      rejected,
      confirmedLast24h,
      avgScoreConfirmed,
      avgScoreSuggested,
      byTopic,
    },
    watchlist: {
      total: watchlistStats.total,
      byVenue: watchlistStats.byVenue,
      byPriority: Object.fromEntries(watchlistStats.byPriority.map(p => [p.priority, p.count])),
    },
    quotesFreshness,
    ingestion,
    overall: {
      healthy: overallHealthy,
      issues,
    },
  };
}

function formatAge(date: Date): string {
  const ageMs = Date.now() - date.getTime();
  const ageMinutes = Math.floor(ageMs / 60000);

  if (ageMinutes < 1) return 'just now';
  if (ageMinutes < 60) return `${ageMinutes}m ago`;
  if (ageMinutes < 1440) return `${Math.floor(ageMinutes / 60)}h ago`;
  return `${Math.floor(ageMinutes / 1440)}d ago`;
}

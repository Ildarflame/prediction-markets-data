/**
 * ops:run v3 - V3 Operations Runner (v3.0.7)
 *
 * Orchestrates the full V3 operational loop for configured topics:
 * 0. Preflight: Check topic overlap (skip topics with zero overlap)
 * 1. v3:suggest-matches per topic
 * 2. v3:auto-confirm (using pipeline rules)
 * 3. v3:auto-reject (using pipeline rules)
 * 4. watchlist:sync
 * 5. quotes freshness check
 * 6. KPI print
 *
 * Optionally runs taxonomy maintenance:
 * - polymarket:events:sync incremental
 * - kalshi:series:sync incremental
 *
 * v3.0.7: Added preflight overlap check (default: on)
 *
 * Run: ops:run --mode v3 --topics CRYPTO_DAILY,MACRO,RATES --apply
 */

import { getClient, type Venue } from '@data-module/db';
import { CanonicalTopic, MATCHABLE_TOPICS } from '@data-module/core';
import {
  runMatchingV3,
  registerAllPipelines,
  parseTopicString,
  getRegisteredPipelineInfos,
} from '../matching/index.js';
import { runLinksWatchlistSync } from './links-watchlist-sync.js';
import { runOpsKpi } from './ops-kpi.js';
import { runPolymarketEventsSync } from './polymarket-events-sync.js';
import { runKalshiSeriesSync } from './kalshi-series-sync.js';

export interface OpsV3Options {
  /** Topics to process (comma-separated or array) */
  topics?: string | CanonicalTopic[];
  /** Run suggest-matches per topic */
  suggestMatches?: boolean;
  /** Run auto-confirm */
  autoConfirm?: boolean;
  /** Run auto-reject */
  autoReject?: boolean;
  /** Run watchlist sync */
  watchlistSync?: boolean;
  /** Run quotes freshness check */
  quotesFreshnessCheck?: boolean;
  /** Run taxonomy maintenance (events/series sync) */
  withTaxonomyMaintenance?: boolean;
  /** Actually apply changes (default: dry-run) */
  apply?: boolean;
  /** Source venue */
  fromVenue?: Venue;
  /** Target venue */
  toVenue?: Venue;
  /** Lookback hours */
  lookbackHours?: number;
  /** Limits */
  limitLeft?: number;
  limitRight?: number;
  maxPerLeft?: number;
  maxPerRight?: number;
  /** Min score for suggestions */
  minScore?: number;
  /** Confirm limit per topic */
  confirmLimit?: number;
  /** Reject limit per topic */
  rejectLimit?: number;
  /** v3.0.7: Run preflight overlap check (default: true) */
  preflight?: boolean;
}

interface StepResult {
  name: string;
  success: boolean;
  durationMs: number;
  summary: string;
  error?: string;
}

export interface OpsV3Result {
  success: boolean;
  dryRun: boolean;
  totalDurationMs: number;
  steps: StepResult[];
  summary: {
    suggested?: number;
    confirmed?: number;
    rejected?: number;
    watchlistTotal?: number;
    byTopic?: Record<string, { suggested: number; confirmed: number; rejected: number }>;
  };
}

// Default matchable topics for V3
const V3_DEFAULT_TOPICS: CanonicalTopic[] = [
  CanonicalTopic.CRYPTO_DAILY,
  CanonicalTopic.CRYPTO_INTRADAY,
  CanonicalTopic.MACRO,
  CanonicalTopic.RATES,
  CanonicalTopic.COMMODITIES,
];

/**
 * Parse topics from string or array
 */
function parseTopics(input?: string | CanonicalTopic[]): CanonicalTopic[] {
  if (!input) return V3_DEFAULT_TOPICS;

  if (Array.isArray(input)) {
    return input.filter(t => MATCHABLE_TOPICS.includes(t as any));
  }

  return input
    .split(',')
    .map(t => parseTopicString(t.trim()))
    .filter((t): t is CanonicalTopic => t !== null && MATCHABLE_TOPICS.includes(t as any));
}

/**
 * Run V3 operations loop
 */
export async function runOpsV3(options: OpsV3Options = {}): Promise<OpsV3Result> {
  const {
    topics: topicsInput,
    suggestMatches = true,
    autoConfirm = true,
    autoReject = true,
    watchlistSync = true,
    quotesFreshnessCheck = true,
    withTaxonomyMaintenance = false,
    apply = false,
    fromVenue = 'kalshi',
    toVenue = 'polymarket',
    lookbackHours = 720,
    limitLeft = 2000,
    limitRight = 20000,
    maxPerLeft = 3,
    maxPerRight = 8,
    minScore = 0.60,
    confirmLimit = 500,
    rejectLimit = 2000,
    preflight = true,
  } = options;

  const dryRun = !apply;
  const startTime = Date.now();
  const steps: StepResult[] = [];
  const summary: OpsV3Result['summary'] = { byTopic: {} };

  // Register all pipelines
  registerAllPipelines();

  // Parse topics
  const topics = parseTopics(topicsInput);

  // Filter to topics with registered pipelines
  const pipelinesInfo = getRegisteredPipelineInfos();
  const registeredTopics = new Set(pipelinesInfo.map(p => p.topic));
  const enabledTopics = topics.filter(t => {
    if (!registeredTopics.has(t)) {
      console.warn(`[Warning] No pipeline for topic ${t}, skipping`);
      return false;
    }
    return true;
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[ops:run v3] V3 Operations Runner (v3.0.7)`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : '⚠️  APPLY'}`);
  console.log(`Topics: ${enabledTopics.join(', ')}`);
  console.log(`Direction: ${fromVenue} -> ${toVenue}`);
  console.log(`Lookback: ${lookbackHours}h`);
  console.log(`Operations:`);
  if (preflight) console.log(`  - preflight overlap check`);
  if (suggestMatches) console.log(`  - suggest-matches (${limitLeft} left, ${limitRight} right)`);
  if (autoConfirm) console.log(`  - auto-confirm (limit ${confirmLimit})`);
  if (autoReject) console.log(`  - auto-reject (limit ${rejectLimit})`);
  if (watchlistSync) console.log(`  - watchlist-sync`);
  if (quotesFreshnessCheck) console.log(`  - quotes-freshness-check`);
  if (withTaxonomyMaintenance) console.log(`  - taxonomy-maintenance (events/series sync)`);
  console.log();

  // No topics enabled
  if (enabledTopics.length === 0) {
    console.log('[Error] No valid topics with pipelines. Available:');
    for (const p of pipelinesInfo) {
      console.log(`  - ${p.topic} (${p.algoVersion})`);
    }
    return {
      success: false,
      dryRun,
      totalDurationMs: Date.now() - startTime,
      steps: [],
      summary: {},
    };
  }

  const prisma = getClient();
  const cutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

  // ============================================================
  // Step 0: Preflight Overlap Check (v3.0.7)
  // ============================================================
  const topicsWithOverlap: CanonicalTopic[] = [];
  const topicsSkipped: CanonicalTopic[] = [];

  if (preflight) {
    const preflightStart = Date.now();
    console.log(`\n${'─'.repeat(40)}`);
    console.log(`[Preflight] Checking topic overlap`);
    console.log(`${'─'.repeat(40)}`);

    // Get counts per topic for both venues using GROUP BY
    const leftCounts = await prisma.market.groupBy({
      by: ['derivedTopic'],
      where: {
        venue: fromVenue,
        status: 'active',
        closeTime: { gte: cutoff },
      },
      _count: { id: true },
    });

    const rightCounts = await prisma.market.groupBy({
      by: ['derivedTopic'],
      where: {
        venue: toVenue,
        status: 'active',
        closeTime: { gte: cutoff },
      },
      _count: { id: true },
    });

    const leftCountMap = new Map<string | null, number>();
    for (const row of leftCounts) {
      leftCountMap.set(row.derivedTopic, row._count.id);
    }

    const rightCountMap = new Map<string | null, number>();
    for (const row of rightCounts) {
      rightCountMap.set(row.derivedTopic, row._count.id);
    }

    // Check each topic for overlap
    for (const topic of enabledTopics) {
      const leftCount = leftCountMap.get(topic) || 0;
      const rightCount = rightCountMap.get(topic) || 0;
      const hasOverlap = leftCount > 0 && rightCount > 0;

      if (hasOverlap) {
        console.log(`  ✓ ${topic.padEnd(20)} ${fromVenue}=${leftCount} ${toVenue}=${rightCount}`);
        topicsWithOverlap.push(topic);
      } else {
        console.log(`  ✗ ${topic.padEnd(20)} ${fromVenue}=${leftCount} ${toVenue}=${rightCount} [SKIPPED]`);
        topicsSkipped.push(topic);
      }
    }

    steps.push({
      name: 'preflight:overlap-check',
      success: true,
      durationMs: Date.now() - preflightStart,
      summary: `${topicsWithOverlap.length} topics with overlap, ${topicsSkipped.length} skipped`,
    });

    if (topicsSkipped.length > 0) {
      console.log(`\n  [Warning] ${topicsSkipped.length} topic(s) skipped due to zero overlap`);
      console.log(`  Run kalshi:taxonomy:backfill --apply to populate derivedTopic`);
    }

    if (topicsWithOverlap.length === 0) {
      console.log(`\n[Error] No topics with overlap. Run taxonomy:overlap to diagnose.`);
      return {
        success: false,
        dryRun,
        totalDurationMs: Date.now() - startTime,
        steps,
        summary: {},
      };
    }
  } else {
    // No preflight - use all enabled topics
    topicsWithOverlap.push(...enabledTopics);
  }

  // ============================================================
  // Step 0: Taxonomy Maintenance (if enabled)
  // ============================================================
  if (withTaxonomyMaintenance) {
    // PM events sync (incremental)
    const pmSyncStart = Date.now();
    console.log(`\n${'─'.repeat(40)}`);
    console.log(`[Step] taxonomy-maintenance: polymarket:events:sync`);
    console.log(`${'─'.repeat(40)}`);

    try {
      await runPolymarketEventsSync({
        maxEvents: 2000,
        full: false,
        linkMarkets: true,
        cacheEventData: true,
        apply: !dryRun,
      });

      steps.push({
        name: 'taxonomy:pm-events-sync',
        success: true,
        durationMs: Date.now() - pmSyncStart,
        summary: 'Incremental sync completed',
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Error] PM events sync failed: ${errorMsg}`);
      steps.push({
        name: 'taxonomy:pm-events-sync',
        success: false,
        durationMs: Date.now() - pmSyncStart,
        summary: 'Failed',
        error: errorMsg,
      });
    }

    // Kalshi series sync (incremental)
    const kalshiSyncStart = Date.now();
    console.log(`\n${'─'.repeat(40)}`);
    console.log(`[Step] taxonomy-maintenance: kalshi:series:sync`);
    console.log(`${'─'.repeat(40)}`);

    try {
      await runKalshiSeriesSync({
        dryRun,
      });

      steps.push({
        name: 'taxonomy:kalshi-series-sync',
        success: true,
        durationMs: Date.now() - kalshiSyncStart,
        summary: 'Series sync completed',
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Error] Kalshi series sync failed: ${errorMsg}`);
      steps.push({
        name: 'taxonomy:kalshi-series-sync',
        success: false,
        durationMs: Date.now() - kalshiSyncStart,
        summary: 'Failed',
        error: errorMsg,
      });
    }
  }

  // ============================================================
  // Step 1: Suggest Matches per Topic
  // ============================================================
  let totalSuggested = 0;
  let totalConfirmed = 0;
  let totalRejected = 0;

  if (suggestMatches) {
    for (const topic of topicsWithOverlap) {
      const stepStart = Date.now();
      console.log(`\n${'─'.repeat(40)}`);
      console.log(`[Step] v3:suggest-matches --topic ${topic}`);
      console.log(`${'─'.repeat(40)}`);

      try {
        const result = await runMatchingV3({
          fromVenue: fromVenue as any,
          toVenue: toVenue as any,
          canonicalTopic: topic,
          lookbackHours,
          limits: {
            maxLeft: limitLeft,
            maxRight: limitRight,
            maxPerLeft,
            maxPerRight,
          },
          minScore,
          mode: dryRun ? 'dry-run' : 'suggest',
          autoConfirm,
          autoReject,
        });

        const topicSuggested = result.suggestionsCreated;
        const topicConfirmed = result.autoConfirmed;
        const topicRejected = result.autoRejected;

        totalSuggested += topicSuggested;
        totalConfirmed += topicConfirmed;
        totalRejected += topicRejected;

        summary.byTopic![topic] = {
          suggested: topicSuggested,
          confirmed: topicConfirmed,
          rejected: topicRejected,
        };

        steps.push({
          name: `v3:suggest:${topic}`,
          success: result.errors.length === 0,
          durationMs: Date.now() - stepStart,
          summary: `Suggested: ${topicSuggested}, Confirmed: ${topicConfirmed}, Rejected: ${topicRejected}`,
          error: result.errors.length > 0 ? result.errors.join('; ') : undefined,
        });

        console.log(`  Topic: ${topic} (${result.algoVersion})`);
        console.log(`  Markets: ${result.leftCount} left, ${result.rightCount} right`);
        console.log(`  Suggested: ${topicSuggested}, Confirmed: ${topicConfirmed}, Rejected: ${topicRejected}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[Error] suggest-matches:${topic} failed: ${errorMsg}`);
        steps.push({
          name: `v3:suggest:${topic}`,
          success: false,
          durationMs: Date.now() - stepStart,
          summary: 'Failed',
          error: errorMsg,
        });
      }
    }
  }

  summary.suggested = totalSuggested;
  summary.confirmed = totalConfirmed;
  summary.rejected = totalRejected;

  // ============================================================
  // Step 2: Watchlist Sync
  // ============================================================
  if (watchlistSync) {
    const stepStart = Date.now();
    console.log(`\n${'─'.repeat(40)}`);
    console.log(`[Step] watchlist-sync`);
    console.log(`${'─'.repeat(40)}`);

    try {
      const result = await runLinksWatchlistSync({
        dryRun,
        minScoreSuggested: 0.85,
        maxTotal: 2000,
        maxPerVenue: 1000,
        maxSuggested: 500,
      });

      summary.watchlistTotal = result.totalItems;
      steps.push({
        name: 'watchlist-sync',
        success: true,
        durationMs: Date.now() - stepStart,
        summary: `Total: ${result.totalItems}, Created: ${result.created}, Updated: ${result.updated}`,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Error] watchlist-sync failed: ${errorMsg}`);
      steps.push({
        name: 'watchlist-sync',
        success: false,
        durationMs: Date.now() - stepStart,
        summary: 'Failed',
        error: errorMsg,
      });
    }
  }

  // ============================================================
  // Step 3: Quotes Freshness Check
  // ============================================================
  if (quotesFreshnessCheck) {
    const stepStart = Date.now();
    console.log(`\n${'─'.repeat(40)}`);
    console.log(`[Step] quotes-freshness-check`);
    console.log(`${'─'.repeat(40)}`);

    try {
      const venues: Venue[] = ['kalshi', 'polymarket'];
      const freshnessMinutes = 5;
      const results: string[] = [];

      for (const venue of venues) {
        const cutoff = new Date(Date.now() - freshnessMinutes * 60 * 1000);

        const recentQuotes = await prisma.quote.count({
          where: {
            outcome: {
              market: { venue },
            },
            ts: { gte: cutoff },
          },
        });

        const status = recentQuotes > 0 ? '✓' : '✗';
        results.push(`${venue}: ${status} ${recentQuotes} quotes in last ${freshnessMinutes}m`);
        console.log(`  [${venue}] ${recentQuotes} quotes in last ${freshnessMinutes}m ${recentQuotes > 0 ? '✓' : '⚠️'}`);
      }

      steps.push({
        name: 'quotes-freshness',
        success: true,
        durationMs: Date.now() - stepStart,
        summary: results.join(', '),
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Error] quotes-freshness failed: ${errorMsg}`);
      steps.push({
        name: 'quotes-freshness',
        success: false,
        durationMs: Date.now() - stepStart,
        summary: 'Failed',
        error: errorMsg,
      });
    }
  }

  // ============================================================
  // Step 4: KPI Print
  // ============================================================
  const kpiStart = Date.now();
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`[Step] ops:kpi`);
  console.log(`${'─'.repeat(40)}`);

  try {
    await runOpsKpi();
    steps.push({
      name: 'ops:kpi',
      success: true,
      durationMs: Date.now() - kpiStart,
      summary: 'KPI printed',
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Error] ops:kpi failed: ${errorMsg}`);
    steps.push({
      name: 'ops:kpi',
      success: false,
      durationMs: Date.now() - kpiStart,
      summary: 'Failed',
      error: errorMsg,
    });
  }

  // ============================================================
  // Final Summary
  // ============================================================
  const totalDurationMs = Date.now() - startTime;
  const failedSteps = steps.filter(s => !s.success);
  const success = failedSteps.length === 0;

  console.log();
  console.log(`${'='.repeat(60)}`);
  console.log(`[ops:run v3] Final Summary`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Status: ${success ? '✓ SUCCESS' : '✗ FAILED'}`);
  console.log(`Duration: ${(totalDurationMs / 1000).toFixed(1)}s`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLIED'}`);
  console.log();

  console.log('[Steps]');
  for (const step of steps) {
    const status = step.success ? '✓' : '✗';
    console.log(`  ${status} ${step.name.padEnd(30)} ${(step.durationMs / 1000).toFixed(1)}s  ${step.summary}`);
    if (step.error) {
      console.log(`    Error: ${step.error}`);
    }
  }

  if (Object.keys(summary).length > 0) {
    console.log();
    console.log('[Results]');
    if (summary.suggested !== undefined) console.log(`  Suggested: ${summary.suggested}`);
    if (summary.confirmed !== undefined) console.log(`  Confirmed: ${summary.confirmed}`);
    if (summary.rejected !== undefined) console.log(`  Rejected: ${summary.rejected}`);
    if (summary.watchlistTotal !== undefined) console.log(`  Watchlist: ${summary.watchlistTotal}`);

    if (summary.byTopic && Object.keys(summary.byTopic).length > 0) {
      console.log();
      console.log('[By Topic]');
      for (const [topic, stats] of Object.entries(summary.byTopic)) {
        console.log(`  ${topic}: suggested=${stats.suggested} confirmed=${stats.confirmed} rejected=${stats.rejected}`);
      }
    }
  }

  if (failedSteps.length > 0) {
    console.log();
    console.log(`[Warning] ${failedSteps.length} step(s) failed:`);
    for (const step of failedSteps) {
      console.log(`  - ${step.name}: ${step.error || 'Unknown error'}`);
    }
  }

  return {
    success,
    dryRun,
    totalDurationMs,
    steps,
    summary,
  };
}

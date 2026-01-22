/**
 * ops:run - Scheduled Operations Runner (v2.6.8)
 *
 * Orchestrates the full operational loop:
 * 1. suggest-matches per topic
 * 2. links:auto-confirm
 * 3. links:auto-reject
 * 4. links:watchlist:sync
 * 5. quotes freshness check
 *
 * Docker-friendly: exit 0 on success, exit 1 on critical failure.
 *
 * Run: pnpm --filter @data-module/worker ops:run --topics crypto_daily,macro --dry-run
 * Run: pnpm --filter @data-module/worker ops:run --auto-confirm --auto-reject --watchlist-sync
 */

import { getClient, type Venue } from '@data-module/db';
import { runAutoConfirm } from './links-auto-confirm.js';
import { runLinksAutoReject } from './links-auto-reject.js';
import { runLinksWatchlistSync } from './links-watchlist-sync.js';

export interface OpsRunOptions {
  /** Topics to process (comma-separated) */
  topics?: string;
  /** Run suggest-matches */
  suggestMatches?: boolean;
  /** Run auto-confirm (with --apply if specified) */
  autoConfirm?: boolean;
  /** Run auto-reject (with --apply if specified) */
  autoReject?: boolean;
  /** Run watchlist sync */
  watchlistSync?: boolean;
  /** Run quotes freshness check */
  quotesFreshnessCheck?: boolean;
  /** Actually apply changes (default: dry-run) */
  apply?: boolean;
  /** Limit for suggest-matches per topic */
  matchLimit?: number;
  /** Limit for auto-confirm */
  confirmLimit?: number;
  /** Limit for auto-reject */
  rejectLimit?: number;
}

interface StepResult {
  name: string;
  success: boolean;
  durationMs: number;
  summary: string;
  error?: string;
}

export interface OpsRunResult {
  success: boolean;
  dryRun: boolean;
  totalDurationMs: number;
  steps: StepResult[];
  summary: {
    suggested?: number;
    confirmed?: number;
    rejected?: number;
    watchlistTotal?: number;
  };
}

const TOPICS = ['crypto_daily', 'crypto_intraday', 'macro'] as const;

export async function runOps(options: OpsRunOptions = {}): Promise<OpsRunResult> {
  const {
    topics = 'crypto_daily,macro',
    suggestMatches = false,
    autoConfirm = false,
    autoReject = false,
    watchlistSync = false,
    quotesFreshnessCheck = false,
    apply = false,
    matchLimit = 500,
    confirmLimit = 500,
    rejectLimit = 2000,
  } = options;

  const dryRun = !apply;
  const startTime = Date.now();
  const steps: StepResult[] = [];
  const summary: OpsRunResult['summary'] = {};

  // Parse topics
  const topicsToProcess = topics.split(',').map(t => t.trim()).filter(t => TOPICS.includes(t as typeof TOPICS[number]));

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[ops:run] Scheduled Operations Runner (v2.6.8)`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : '⚠️  APPLY'}`);
  console.log(`Topics: ${topicsToProcess.join(', ')}`);
  console.log(`Operations:`);
  if (suggestMatches) console.log(`  - suggest-matches (limit ${matchLimit})`);
  if (autoConfirm) console.log(`  - auto-confirm (limit ${confirmLimit})`);
  if (autoReject) console.log(`  - auto-reject (limit ${rejectLimit})`);
  if (watchlistSync) console.log(`  - watchlist-sync`);
  if (quotesFreshnessCheck) console.log(`  - quotes-freshness-check`);
  console.log();

  // No operations selected - show help
  if (!suggestMatches && !autoConfirm && !autoReject && !watchlistSync && !quotesFreshnessCheck) {
    console.log('[Warning] No operations selected. Use flags to enable:');
    console.log('  --suggest-matches   Run suggest-matches for each topic');
    console.log('  --auto-confirm      Run auto-confirm');
    console.log('  --auto-reject       Run auto-reject');
    console.log('  --watchlist-sync    Run watchlist sync');
    console.log('  --quotes-freshness-check  Check quotes freshness');
    console.log('  --apply             Apply changes (default: dry-run)');
    console.log();
    console.log('Example:');
    console.log('  ops:run --auto-confirm --auto-reject --watchlist-sync --apply');

    return {
      success: true,
      dryRun,
      totalDurationMs: Date.now() - startTime,
      steps: [],
      summary: {},
    };
  }

  const prisma = getClient();

  // Step 1: suggest-matches per topic (if enabled)
  if (suggestMatches) {
    for (const topic of topicsToProcess) {
      const stepStart = Date.now();
      console.log(`\n${'─'.repeat(40)}`);
      console.log(`[Step] suggest-matches --topic ${topic}`);
      console.log(`${'─'.repeat(40)}`);

      try {
        // Import and run suggest-matches dynamically
        const { runSuggestMatches } = await import('./suggest-matches.js');

        // Determine from/to venues based on topic
        const fromVenue: Venue = 'polymarket';
        const toVenue: Venue = 'kalshi';

        await runSuggestMatches({
          fromVenue,
          toVenue,
          topic: topic as 'crypto_daily' | 'crypto_intraday' | 'macro',
          limitLeft: matchLimit,
        });

        steps.push({
          name: `suggest-matches:${topic}`,
          success: true,
          durationMs: Date.now() - stepStart,
          summary: `Completed for ${topic}`,
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[Error] suggest-matches:${topic} failed: ${errorMsg}`);
        steps.push({
          name: `suggest-matches:${topic}`,
          success: false,
          durationMs: Date.now() - stepStart,
          summary: 'Failed',
          error: errorMsg,
        });
      }
    }
  }

  // Step 2: auto-confirm (if enabled)
  if (autoConfirm) {
    const stepStart = Date.now();
    console.log(`\n${'─'.repeat(40)}`);
    console.log(`[Step] auto-confirm`);
    console.log(`${'─'.repeat(40)}`);

    try {
      const result = await runAutoConfirm({
        topic: 'all',
        limit: confirmLimit,
        dryRun,
        apply: !dryRun,
      });

      summary.confirmed = result.confirmed;
      steps.push({
        name: 'auto-confirm',
        success: true,
        durationMs: Date.now() - stepStart,
        summary: `Candidates: ${result.candidates}, Confirmed: ${result.confirmed}`,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Error] auto-confirm failed: ${errorMsg}`);
      steps.push({
        name: 'auto-confirm',
        success: false,
        durationMs: Date.now() - stepStart,
        summary: 'Failed',
        error: errorMsg,
      });
    }
  }

  // Step 3: auto-reject (if enabled)
  if (autoReject) {
    const stepStart = Date.now();
    console.log(`\n${'─'.repeat(40)}`);
    console.log(`[Step] auto-reject`);
    console.log(`${'─'.repeat(40)}`);

    try {
      const result = await runLinksAutoReject({
        topic: 'all',
        minAgeHours: 24,
        limit: rejectLimit,
        apply: !dryRun,
      });

      summary.rejected = result.rejected;
      steps.push({
        name: 'auto-reject',
        success: true,
        durationMs: Date.now() - stepStart,
        summary: `Candidates: ${result.candidates}, Rejected: ${result.rejected}`,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Error] auto-reject failed: ${errorMsg}`);
      steps.push({
        name: 'auto-reject',
        success: false,
        durationMs: Date.now() - stepStart,
        summary: 'Failed',
        error: errorMsg,
      });
    }
  }

  // Step 4: watchlist-sync (if enabled)
  if (watchlistSync) {
    const stepStart = Date.now();
    console.log(`\n${'─'.repeat(40)}`);
    console.log(`[Step] watchlist-sync`);
    console.log(`${'─'.repeat(40)}`);

    try {
      const result = await runLinksWatchlistSync({
        dryRun,
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

  // Step 5: quotes freshness check (if enabled)
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

  // Final summary
  const totalDurationMs = Date.now() - startTime;
  const failedSteps = steps.filter(s => !s.success);
  const success = failedSteps.length === 0;

  console.log();
  console.log(`${'='.repeat(60)}`);
  console.log(`[ops:run] Final Summary`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Status: ${success ? '✓ SUCCESS' : '✗ FAILED'}`);
  console.log(`Duration: ${(totalDurationMs / 1000).toFixed(1)}s`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLIED'}`);
  console.log();

  console.log('[Steps]');
  for (const step of steps) {
    const status = step.success ? '✓' : '✗';
    console.log(`  ${status} ${step.name.padEnd(25)} ${(step.durationMs / 1000).toFixed(1)}s  ${step.summary}`);
    if (step.error) {
      console.log(`    Error: ${step.error}`);
    }
  }

  if (Object.keys(summary).length > 0) {
    console.log();
    console.log('[Results]');
    if (summary.confirmed !== undefined) console.log(`  Confirmed: ${summary.confirmed}`);
    if (summary.rejected !== undefined) console.log(`  Rejected: ${summary.rejected}`);
    if (summary.watchlistTotal !== undefined) console.log(`  Watchlist: ${summary.watchlistTotal}`);
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

/**
 * Kalshi Ingestion Diagnostics (v2.6.3)
 *
 * Diagnoses Kalshi ingestion health and identifies stuck/failing states.
 * v2.6.3: Added NAPI error detection and batch configuration hints.
 */

import {
  getClient,
  IngestionRepository,
  isNapiOrMemoryError,
  type Venue,
} from '@data-module/db';

// ============================================================
// Environment Configuration
// ============================================================

const KALSHI_STUCK_THRESHOLD_MIN = parseInt(
  process.env.KALSHI_STUCK_THRESHOLD_MIN || '30',
  10
);
const KALSHI_MAX_FAILURES_IN_ROW = parseInt(
  process.env.KALSHI_MAX_FAILURES_IN_ROW || '5',
  10
);

// ============================================================
// Types
// ============================================================

export interface IngestionDiagOptions {
  venue?: Venue;
  showRuns?: number;
}

export interface IngestionDiagResult {
  venue: Venue;
  status: 'OK' | 'STUCK' | 'FAILING' | 'UNKNOWN';
  reason: string | null;
  lastSuccessAt: Date | null;
  lastSuccessAgeMinutes: number | null;
  failuresInRow: number;
  errorCategories: Record<string, number>;
  recentRuns: Array<{
    id: number;
    startedAt: Date;
    finishedAt: Date | null;
    ok: boolean;
    errorShort: string | null;
    durationSec: number | null;
  }>;
  thresholds: {
    stuckMinutes: number;
    maxFailuresInRow: number;
  };
  /** v2.6.3: NAPI/memory error detection */
  napiErrorsDetected: boolean;
  napiErrorCount: number;
  batchConfig: {
    dbBatch: number;
    quoteBatch: number;
    latestBatch: number;
    minBatch: number;
    engineType: string;
  };
}

// ============================================================
// Main Function
// ============================================================

export async function runKalshiIngestionDiag(
  options: IngestionDiagOptions = {}
): Promise<IngestionDiagResult> {
  const { venue = 'kalshi', showRuns = 20 } = options;

  const prisma = getClient();
  const ingestionRepo = new IngestionRepository(prisma);

  // v2.6.3: Read batch configuration
  const batchConfig = {
    dbBatch: parseInt(process.env.KALSHI_DB_BATCH || '200', 10),
    quoteBatch: parseInt(process.env.KALSHI_QUOTE_BATCH || '500', 10),
    latestBatch: parseInt(process.env.KALSHI_LATEST_BATCH || '100', 10),
    minBatch: parseInt(process.env.KALSHI_DB_MIN_BATCH || '10', 10),
    engineType: process.env.PRISMA_CLIENT_ENGINE_TYPE || 'library',
  };

  console.log('================================================================================');
  console.log(`[kalshi:ingestion:diag] Ingestion Diagnostics v2.6.3`);
  console.log('================================================================================');
  console.log(`Venue: ${venue}`);
  console.log(`Thresholds: STUCK if age > ${KALSHI_STUCK_THRESHOLD_MIN}m OR failures > ${KALSHI_MAX_FAILURES_IN_ROW}`);
  console.log('================================================================================\n');

  // Get ingestion state
  const states = await ingestionRepo.getStates(venue);
  const marketsState = states.find(s => s.jobName === 'markets');

  // Get consecutive failures
  const failuresInRow = await ingestionRepo.countConsecutiveFailures(venue, 'markets');

  // Get last successful run
  const lastSuccess = await ingestionRepo.getLastSuccessfulRun(venue, 'markets');

  // Get error categories
  const errorCategories = await ingestionRepo.getErrorCategories(venue, 50);

  // Get recent runs
  const recentRuns = await ingestionRepo.getRecentRunsDetailed(venue, showRuns);

  // v2.6.3: Detect NAPI/memory errors in recent runs
  let napiErrorCount = 0;
  for (const run of recentRuns) {
    if (run.errorText && isNapiOrMemoryError(new Error(run.errorText))) {
      napiErrorCount++;
    }
  }
  const napiErrorsDetected = napiErrorCount > 0;

  // Calculate metrics
  const now = new Date();
  const lastSuccessAt = lastSuccess?.finishedAt || marketsState?.lastSuccessAt || null;
  const lastSuccessAgeMinutes = lastSuccessAt
    ? Math.round((now.getTime() - lastSuccessAt.getTime()) / 1000 / 60)
    : null;

  // Determine status
  let status: 'OK' | 'STUCK' | 'FAILING' | 'UNKNOWN' = 'UNKNOWN';
  let reason: string | null = null;

  if (lastSuccessAgeMinutes === null) {
    status = 'UNKNOWN';
    reason = 'No successful runs found';
  } else if (lastSuccessAgeMinutes > KALSHI_STUCK_THRESHOLD_MIN) {
    status = 'STUCK';
    reason = `Last success was ${lastSuccessAgeMinutes}m ago (threshold: ${KALSHI_STUCK_THRESHOLD_MIN}m)`;
  } else if (failuresInRow >= KALSHI_MAX_FAILURES_IN_ROW) {
    status = 'FAILING';
    reason = `${failuresInRow} consecutive failures (threshold: ${KALSHI_MAX_FAILURES_IN_ROW})`;
  } else if (failuresInRow > 0) {
    status = 'FAILING';
    reason = `${failuresInRow} recent failures, but within threshold`;
  } else {
    status = 'OK';
    reason = null;
  }

  // Print status
  const statusIcon = status === 'OK' ? '✓' : status === 'STUCK' ? '✗' : '⚠';
  console.log(`[Status] ${statusIcon} ${status}`);
  if (reason) {
    console.log(`[Reason] ${reason}`);
  }
  console.log('');

  // Print summary
  console.log('[Summary]');
  console.log(`  Last success: ${lastSuccessAt ? lastSuccessAt.toISOString() : 'never'}`);
  console.log(`  Age: ${lastSuccessAgeMinutes !== null ? `${lastSuccessAgeMinutes}m` : 'N/A'}`);
  console.log(`  Failures in row: ${failuresInRow}`);
  console.log(`  Last error: ${marketsState?.lastError?.substring(0, 100) || 'none'}${marketsState?.lastError && marketsState.lastError.length > 100 ? '...' : ''}`);
  console.log('');

  // v2.6.3: Print batch configuration
  console.log('[Batch Configuration (v2.6.3)]');
  console.log(`  KALSHI_DB_BATCH: ${batchConfig.dbBatch}`);
  console.log(`  KALSHI_QUOTE_BATCH: ${batchConfig.quoteBatch}`);
  console.log(`  KALSHI_LATEST_BATCH: ${batchConfig.latestBatch}`);
  console.log(`  KALSHI_DB_MIN_BATCH: ${batchConfig.minBatch}`);
  console.log(`  PRISMA_CLIENT_ENGINE_TYPE: ${batchConfig.engineType}`);
  console.log('');

  // v2.6.3: NAPI error detection and hints
  if (napiErrorsDetected) {
    console.log('[⚠ NAPI/Memory Errors Detected]');
    console.log(`  Found ${napiErrorCount} NAPI/memory-related errors in recent runs.`);
    console.log('');
    console.log('  Recommended actions:');
    console.log('  1. Reduce batch sizes (try KALSHI_DB_BATCH=100, KALSHI_QUOTE_BATCH=200)');
    console.log('  2. Set PRISMA_CLIENT_ENGINE_TYPE=binary to use binary engine');
    console.log('  3. Enable verbose logging: KALSHI_VERBOSE=true');
    console.log('  4. Check system memory and restart if needed');
    console.log('');
  }

  // Print error categories
  console.log('[Error Categories (last 50 failed runs)]');
  const totalErrors = Object.values(errorCategories).reduce((a, b) => a + b, 0);
  if (totalErrors === 0) {
    console.log('  No recent errors');
  } else {
    for (const [category, count] of Object.entries(errorCategories)) {
      if (count > 0) {
        const pct = Math.round((count / totalErrors) * 100);
        console.log(`  ${category.padEnd(20)} ${count} (${pct}%)`);
      }
    }
  }
  console.log('');

  // Print recent runs table
  console.log(`[Recent Runs (last ${showRuns})]`);
  console.log('ID      | Status | Started              | Duration | Error');
  console.log('--------+--------+----------------------+----------+------------------------------------------');

  const formattedRuns = recentRuns.map(run => {
    const durationSec = run.finishedAt
      ? Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000)
      : null;
    const errorShort = run.errorText
      ? run.errorText.substring(0, 40) + (run.errorText.length > 40 ? '...' : '')
      : null;

    return {
      id: run.id,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      ok: run.ok,
      errorShort,
      durationSec,
    };
  });

  for (const run of formattedRuns) {
    const statusStr = run.ok ? '✓ OK' : '✗ FAIL';
    const startedStr = run.startedAt.toISOString().replace('T', ' ').substring(0, 19);
    const durationStr = run.durationSec !== null ? `${run.durationSec}s` : 'running';
    const errorStr = run.errorShort || '';

    console.log(
      `${String(run.id).padStart(7)} | ${statusStr.padEnd(6)} | ${startedStr} | ${durationStr.padEnd(8)} | ${errorStr}`
    );
  }

  console.log('');

  // Return result
  return {
    venue,
    status,
    reason,
    lastSuccessAt,
    lastSuccessAgeMinutes,
    failuresInRow,
    errorCategories,
    recentRuns: formattedRuns,
    thresholds: {
      stuckMinutes: KALSHI_STUCK_THRESHOLD_MIN,
      maxFailuresInRow: KALSHI_MAX_FAILURES_IN_ROW,
    },
    // v2.6.3: NAPI error detection
    napiErrorsDetected,
    napiErrorCount,
    batchConfig,
  };
}

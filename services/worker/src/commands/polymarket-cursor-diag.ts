/**
 * Polymarket Ingestion Cursor Diagnostics (v2.6.6)
 *
 * Shows current cursor state and detects stuck/runaway cursors.
 *
 * Run: pnpm --filter @data-module/worker polymarket:ingestion:cursor
 */

import { getClient } from '@data-module/db';

export interface PolymarketCursorResult {
  currentCursor: string | null;
  cursorAsNumber: number | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  statsJson: Record<string, unknown> | null;
  warnings: string[];
  recommendation: string | null;
}

export async function runPolymarketCursorDiag(): Promise<PolymarketCursorResult> {
  const prisma = getClient();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[polymarket:ingestion:cursor] Cursor Diagnostics (v2.6.6)`);
  console.log(`${'='.repeat(60)}`);

  // Get cursor state for markets job
  const state = await prisma.ingestionState.findUnique({
    where: {
      venue_jobName: {
        venue: 'polymarket',
        jobName: 'markets',
      },
    },
  });

  if (!state) {
    console.log('[Status] No ingestion state found for polymarket:markets');
    return {
      currentCursor: null,
      cursorAsNumber: null,
      lastSuccessAt: null,
      lastError: null,
      statsJson: null,
      warnings: ['No ingestion state found - run ingestion first'],
      recommendation: 'Run polymarket ingestion to initialize state',
    };
  }

  const cursorNum = state.cursor ? parseInt(state.cursor, 10) : null;
  const warnings: string[] = [];
  let recommendation: string | null = null;

  // Get total market count
  const totalMarkets = await prisma.market.count({
    where: { venue: 'polymarket' },
  });

  // Get recent runs to check for patterns
  const recentRuns = await prisma.ingestionRun.findMany({
    where: {
      venue: 'polymarket',
      jobName: { in: ['markets', 'ingest'] },
    },
    orderBy: { startedAt: 'desc' },
    take: 10,
    select: {
      startedAt: true,
      ok: true,
      fetchedCounts: true,
      writtenCounts: true,
    },
  });

  // Check for stuck cursor (cursor > totalMarkets + buffer)
  if (cursorNum !== null && cursorNum > totalMarkets + 10000) {
    warnings.push(
      `Cursor (${cursorNum}) is significantly higher than total markets (${totalMarkets}). ` +
      `This may indicate the cursor is not resetting properly.`
    );
    recommendation = 'Consider resetting cursor with: UPDATE ingestion_state SET cursor = NULL WHERE venue = \'polymarket\' AND job_name = \'markets\'';
  }

  // Check for consecutive zero-fetch runs
  let consecutiveZeroFetch = 0;
  for (const run of recentRuns) {
    const fetched = (run.fetchedCounts as Record<string, number> | null)?.markets ?? 0;
    if (fetched === 0) {
      consecutiveZeroFetch++;
    } else {
      break;
    }
  }

  if (consecutiveZeroFetch >= 3) {
    warnings.push(
      `${consecutiveZeroFetch} consecutive runs with 0 markets fetched. ` +
      `The cursor may be stuck past the end of available data.`
    );
    if (!recommendation) {
      recommendation = 'Reset cursor to restart from beginning';
    }
  }

  // Output
  console.log(`\n[Cursor State]`);
  console.log(`  Current cursor: ${state.cursor ?? 'null (start)'}`);
  console.log(`  Cursor as offset: ${cursorNum ?? 0}`);
  console.log(`  Last success: ${state.lastSuccessAt?.toISOString() ?? 'never'}`);
  console.log(`  Last error: ${state.lastError ?? 'none'}`);
  console.log();

  console.log(`[Database Stats]`);
  console.log(`  Total polymarket markets: ${totalMarkets.toLocaleString()}`);
  console.log(`  Cursor vs total: ${cursorNum ?? 0} / ${totalMarkets}`);
  console.log();

  console.log(`[Recent Runs] (last ${recentRuns.length})`);
  for (const run of recentRuns.slice(0, 5)) {
    const fetched = (run.fetchedCounts as Record<string, number> | null)?.markets ?? '?';
    const written = (run.writtenCounts as Record<string, number> | null)?.markets ?? '?';
    const status = run.ok ? '✓' : '✗';
    console.log(`  ${status} ${run.startedAt.toISOString()} - fetched: ${fetched}, written: ${written}`);
  }
  console.log();

  if (warnings.length > 0) {
    console.log(`[Warnings]`);
    for (const w of warnings) {
      console.log(`  ⚠️  ${w}`);
    }
    console.log();
  }

  if (recommendation) {
    console.log(`[Recommendation]`);
    console.log(`  ${recommendation}`);
    console.log();
  }

  const status = warnings.length === 0 ? '✓ HEALTHY' : '⚠️ NEEDS ATTENTION';
  console.log(`[Status] ${status}`);

  return {
    currentCursor: state.cursor,
    cursorAsNumber: cursorNum,
    lastSuccessAt: state.lastSuccessAt,
    lastError: state.lastError,
    statsJson: state.statsJson as Record<string, unknown> | null,
    warnings,
    recommendation,
  };
}

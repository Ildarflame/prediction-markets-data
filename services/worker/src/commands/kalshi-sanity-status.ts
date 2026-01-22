/**
 * Kalshi Market Status Sanity Check (v2.6.6)
 *
 * Diagnoses status/closeTime anomalies:
 * - Active markets with closeTime in the past
 * - Closed/resolved/archived markets with closeTime in the future
 *
 * Run: pnpm --filter @data-module/worker kalshi:sanity:status
 */

import { getClient } from '@data-module/db';

export interface KalshiSanityStatusOptions {
  /** Max samples to show per category */
  limit?: number;
  /** Days back to consider for analysis */
  days?: number;
}

export interface AnomalySample {
  id: number;
  externalId: string;
  title: string;
  status: string;
  closeTime: Date | null;
  metadata?: Record<string, unknown> | null;
}

export interface KalshiSanityStatusResult {
  ok: boolean;
  counts: {
    totalActive: number;
    activeButCloseInPast: number;
    closedButCloseInFuture: number;
  };
  samples: {
    activeButCloseInPast: AnomalySample[];
    closedButCloseInFuture: AnomalySample[];
  };
  anomalyRate: number;
  threshold: number;
  warnings: string[];
}

export async function runKalshiSanityStatus(
  options: KalshiSanityStatusOptions = {}
): Promise<KalshiSanityStatusResult> {
  const { limit = 20, days = 30 } = options;
  const prisma = getClient();
  const now = new Date();
  const lookbackCutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[kalshi:sanity:status] Market Status Sanity Check (v2.6.6)`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Now: ${now.toISOString()}`);
  console.log(`Lookback: ${days} days (since ${lookbackCutoff.toISOString()})`);
  console.log();

  // 1. Count total active markets
  const totalActive = await prisma.market.count({
    where: {
      venue: 'kalshi',
      status: 'active',
    },
  });

  // 2. Count active markets with closeTime in the past
  const activeButCloseInPast = await prisma.market.count({
    where: {
      venue: 'kalshi',
      status: 'active',
      closeTime: {
        lt: now,
      },
    },
  });

  // 3. Count closed/resolved/archived markets with closeTime in the future
  const closedButCloseInFuture = await prisma.market.count({
    where: {
      venue: 'kalshi',
      status: {
        in: ['closed', 'resolved', 'archived'],
      },
      closeTime: {
        gt: now,
      },
    },
  });

  // 4. Sample active but close in past
  const activeButCloseInPastSamples = await prisma.market.findMany({
    where: {
      venue: 'kalshi',
      status: 'active',
      closeTime: {
        lt: now,
      },
    },
    select: {
      id: true,
      externalId: true,
      title: true,
      status: true,
      closeTime: true,
      metadata: true,
    },
    orderBy: {
      closeTime: 'desc',
    },
    take: limit,
  });

  // 5. Sample closed but close in future
  const closedButCloseInFutureSamples = await prisma.market.findMany({
    where: {
      venue: 'kalshi',
      status: {
        in: ['closed', 'resolved', 'archived'],
      },
      closeTime: {
        gt: now,
      },
    },
    select: {
      id: true,
      externalId: true,
      title: true,
      status: true,
      closeTime: true,
      metadata: true,
    },
    orderBy: {
      closeTime: 'asc',
    },
    take: limit,
  });

  // Calculate anomaly rate
  const totalAnomalies = activeButCloseInPast + closedButCloseInFuture;
  const anomalyRate = totalActive > 0 ? totalAnomalies / totalActive : 0;
  const threshold = 0.005; // 0.5% or <1000 absolute

  // Determine OK status
  const ok = anomalyRate < threshold || totalAnomalies < 1000;

  // Build warnings
  const warnings: string[] = [];
  if (activeButCloseInPast > 0) {
    warnings.push(
      `${activeButCloseInPast} markets are ACTIVE but closeTime is in the past. ` +
      `Possible causes: (a) status mapping issue on ingestion, (b) closeTime timezone parse error, ` +
      `(c) stale/legacy markets not updated.`
    );
  }
  if (closedButCloseInFuture > 0) {
    warnings.push(
      `${closedButCloseInFuture} markets are CLOSED/RESOLVED/ARCHIVED but closeTime is in the future. ` +
      `Possible causes: (a) premature closure, (b) manual status override, (c) API inconsistency.`
    );
  }

  // Output
  console.log('[Counts]');
  console.log(`  Total active:                ${totalActive.toLocaleString()}`);
  console.log(`  Active but closeTime past:   ${activeButCloseInPast.toLocaleString()} (${(activeButCloseInPast / totalActive * 100).toFixed(2)}%)`);
  console.log(`  Closed but closeTime future: ${closedButCloseInFuture.toLocaleString()}`);
  console.log();

  if (activeButCloseInPastSamples.length > 0) {
    console.log(`[Samples: Active but closeTime in past] (${activeButCloseInPastSamples.length})`);
    for (const s of activeButCloseInPastSamples) {
      const age = s.closeTime ? Math.round((now.getTime() - s.closeTime.getTime()) / (60 * 60 * 1000)) : 'N/A';
      console.log(`  [${s.id}] ${s.title.slice(0, 50)}...`);
      console.log(`         status=${s.status} closeTime=${s.closeTime?.toISOString()} (${age}h ago)`);
    }
    console.log();
  }

  if (closedButCloseInFutureSamples.length > 0) {
    console.log(`[Samples: Closed but closeTime in future] (${closedButCloseInFutureSamples.length})`);
    for (const s of closedButCloseInFutureSamples) {
      const until = s.closeTime ? Math.round((s.closeTime.getTime() - now.getTime()) / (60 * 60 * 1000)) : 'N/A';
      console.log(`  [${s.id}] ${s.title.slice(0, 50)}...`);
      console.log(`         status=${s.status} closeTime=${s.closeTime?.toISOString()} (in ${until}h)`);
    }
    console.log();
  }

  if (warnings.length > 0) {
    console.log('[Warnings]');
    for (const w of warnings) {
      console.log(`  ⚠️  ${w}`);
    }
    console.log();
  }

  console.log(`[Result] ${ok ? '✓ PASS' : '✗ FAIL'} - Anomaly rate: ${(anomalyRate * 100).toFixed(2)}% (threshold: ${(threshold * 100).toFixed(2)}%)`);

  return {
    ok,
    counts: {
      totalActive,
      activeButCloseInPast,
      closedButCloseInFuture,
    },
    samples: {
      activeButCloseInPast: activeButCloseInPastSamples.map(s => ({
        ...s,
        metadata: s.metadata as Record<string, unknown> | null,
      })),
      closedButCloseInFuture: closedButCloseInFutureSamples.map(s => ({
        ...s,
        metadata: s.metadata as Record<string, unknown> | null,
      })),
    },
    anomalyRate,
    threshold,
    warnings,
  };
}

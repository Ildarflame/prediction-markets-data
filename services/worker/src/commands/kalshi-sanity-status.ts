/**
 * Kalshi Market Status Sanity Check (v2.6.6, v2.6.7)
 *
 * Diagnoses status/closeTime anomalies:
 * - Active markets with closeTime in the past
 * - Closed/resolved/archived markets with closeTime in the future
 *
 * v2.6.7: Added minor/major buckets based on grace period
 * - minor: within grace period (e.g., 60 minutes)
 * - major: beyond grace period (stale_active)
 *
 * Run: pnpm --filter @data-module/worker kalshi:sanity:status
 */

import { getClient } from '@data-module/db';

export interface KalshiSanityStatusOptions {
  /** Max samples to show per category */
  limit?: number;
  /** Days back to consider for analysis */
  days?: number;
  /** Grace period in minutes for minor/major classification (default: 60) */
  graceMinutes?: number;
}

export interface AnomalySample {
  id: number;
  externalId: string;
  title: string;
  status: string;
  closeTime: Date | null;
  ageMinutes?: number;
  metadata?: Record<string, unknown> | null;
}

export interface KalshiSanityStatusResult {
  ok: boolean;
  counts: {
    totalActive: number;
    activeButCloseInPast: number;
    closedButCloseInFuture: number;
    /** v2.6.7: Minor anomalies (within grace period) */
    minorAnomalies: number;
    /** v2.6.7: Major anomalies (beyond grace period) */
    majorAnomalies: number;
  };
  samples: {
    activeButCloseInPast: AnomalySample[];
    closedButCloseInFuture: AnomalySample[];
    /** v2.6.7: Top 20 major anomalies with age info */
    majorSamples: AnomalySample[];
  };
  anomalyRate: number;
  threshold: number;
  graceMinutes: number;
  warnings: string[];
}

export async function runKalshiSanityStatus(
  options: KalshiSanityStatusOptions = {}
): Promise<KalshiSanityStatusResult> {
  const { limit = 20, days = 30, graceMinutes = 60 } = options;
  const prisma = getClient();
  const now = new Date();
  const lookbackCutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const graceCutoff = new Date(now.getTime() - graceMinutes * 60 * 1000);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[kalshi:sanity:status] Market Status Sanity Check (v2.6.7)`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Now: ${now.toISOString()}`);
  console.log(`Lookback: ${days} days (since ${lookbackCutoff.toISOString()})`);
  console.log(`Grace period: ${graceMinutes} minutes`);
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

  // v2.6.7: Count minor anomalies (within grace period)
  const minorAnomalies = await prisma.market.count({
    where: {
      venue: 'kalshi',
      status: 'active',
      closeTime: {
        lt: now,
        gte: graceCutoff,
      },
    },
  });

  // v2.6.7: Count major anomalies (beyond grace period)
  const majorAnomalies = await prisma.market.count({
    where: {
      venue: 'kalshi',
      status: 'active',
      closeTime: {
        lt: graceCutoff,
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

  // v2.6.7: Sample major anomalies (beyond grace period) with age info
  const majorSamplesRaw = await prisma.market.findMany({
    where: {
      venue: 'kalshi',
      status: 'active',
      closeTime: {
        lt: graceCutoff,
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
      closeTime: 'desc', // Most recent first (least stale)
    },
    take: limit,
  });

  // Add age info to major samples
  const majorSamples: AnomalySample[] = majorSamplesRaw.map((s) => ({
    ...s,
    ageMinutes: s.closeTime ? Math.round((now.getTime() - s.closeTime.getTime()) / (60 * 1000)) : undefined,
    metadata: s.metadata as Record<string, unknown> | null,
  }));

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
  console.log(`    - Minor (within ${graceMinutes}m):    ${minorAnomalies.toLocaleString()}`);
  console.log(`    - Major (beyond ${graceMinutes}m):    ${majorAnomalies.toLocaleString()}`);
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

  // v2.6.7: Show major anomalies with detailed age info
  if (majorSamples.length > 0) {
    console.log(`[Major Anomalies: Active but closeTime > ${graceMinutes}m in past] (top ${majorSamples.length})`);
    for (const s of majorSamples) {
      const ageHours = s.ageMinutes ? Math.round(s.ageMinutes / 60) : 'N/A';
      const ageDays = s.ageMinutes ? (s.ageMinutes / 60 / 24).toFixed(1) : 'N/A';
      console.log(`  [${s.id}] ${s.title.slice(0, 50)}...`);
      console.log(`         status=${s.status} closeTime=${s.closeTime?.toISOString()}`);
      console.log(`         age: ${s.ageMinutes}m (${ageHours}h / ${ageDays}d)`);
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
      minorAnomalies,
      majorAnomalies,
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
      majorSamples,
    },
    anomalyRate,
    threshold,
    graceMinutes,
    warnings,
  };
}

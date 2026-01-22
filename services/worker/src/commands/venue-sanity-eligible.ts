/**
 * venue:sanity:eligible - Eligibility diagnostics command (v2.6.7)
 *
 * Shows eligibility statistics and samples for a venue/topic combination.
 * Helps diagnose why markets are being filtered out.
 *
 * Run: pnpm --filter @data-module/worker venue:sanity:eligible --venue kalshi --topic crypto_daily
 */

import { getClient, type Venue } from '@data-module/db';
import {
  buildEligibleWhere,
  summarizeEligibility,
  getDefaultLookbackHours,
  getDefaultForwardHours,
  type Topic,
  type MarketForEligibility,
} from '../eligibility/index.js';

export interface VenueSanityEligibleOptions {
  venue: Venue;
  topic?: Topic;
  limit?: number;
  sample?: number;
  graceMinutes?: number;
}

export interface VenueSanityEligibleResult {
  venue: Venue;
  topic: Topic;
  config: {
    lookbackHours: number;
    forwardHours: number;
    graceMinutes: number;
  };
  counts: {
    totalInDb: number;
    eligible: number;
    excluded: number;
  };
  byReason: Record<string, number>;
  samples: Array<{
    reason: string;
    markets: Array<{
      id: number;
      title: string;
      status: string;
      closeTime: Date | null;
      ageInfo: string;
    }>;
  }>;
}

export async function runVenueSanityEligible(
  options: VenueSanityEligibleOptions
): Promise<VenueSanityEligibleResult> {
  const {
    venue,
    topic = 'crypto_daily',
    limit = 10000,
    sample = 5,
    graceMinutes = parseInt(process.env.ELIGIBILITY_GRACE_MINUTES || '60', 10),
  } = options;

  const now = new Date();
  const prisma = getClient();

  const lookbackHours = getDefaultLookbackHours(topic);
  const forwardHours = getDefaultForwardHours(topic);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[venue:sanity:eligible] Eligibility Diagnostics (v2.6.7)`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Venue: ${venue}`);
  console.log(`Topic: ${topic}`);
  console.log(`Now: ${now.toISOString()}`);
  console.log(`Config:`);
  console.log(`  lookbackHours: ${lookbackHours}`);
  console.log(`  forwardHours: ${forwardHours}`);
  console.log(`  graceMinutes: ${graceMinutes}`);
  console.log(`  limit: ${limit}`);
  console.log();

  // Step 1: Count total markets in DB for this venue
  const totalInDb = await prisma.market.count({
    where: { venue },
  });
  console.log(`[1/3] Total markets in DB for ${venue}: ${totalInDb.toLocaleString()}`);

  // Step 2: Get markets using eligibility filter
  const { where } = buildEligibleWhere({
    venue,
    topic,
    now,
    graceMinutes,
  });

  const eligibleCount = await prisma.market.count({ where });
  console.log(`[2/3] Eligible markets (filter applied): ${eligibleCount.toLocaleString()}`);

  // Step 3: Fetch sample of ALL markets (not just eligible) to analyze exclusions
  const allMarkets = await prisma.market.findMany({
    where: { venue },
    select: {
      id: true,
      title: true,
      status: true,
      closeTime: true,
      venue: true,
      category: true,
    },
    orderBy: { closeTime: 'desc' },
    take: limit,
  });

  console.log(`[3/3] Analyzing ${allMarkets.length} markets for exclusion reasons...`);
  console.log();

  // Summarize eligibility
  const summary = summarizeEligibility(
    allMarkets as MarketForEligibility[],
    now,
    graceMinutes,
    sample
  );

  // Output summary
  console.log('[Eligibility Summary]');
  console.log(`  Total analyzed: ${summary.total.toLocaleString()}`);
  console.log(`  Eligible: ${summary.eligible.toLocaleString()} (${((summary.eligible / summary.total) * 100).toFixed(1)}%)`);
  console.log(`  Excluded: ${summary.excluded.toLocaleString()} (${((summary.excluded / summary.total) * 100).toFixed(1)}%)`);
  console.log();

  // Output reasons
  console.log('[Exclusion Reasons]');
  const sortedReasons = Object.entries(summary.byReason)
    .sort((a, b) => b[1] - a[1]);

  for (const [reason, count] of sortedReasons) {
    const pct = ((count / summary.total) * 100).toFixed(1);
    console.log(`  ${reason.padEnd(20)} ${String(count).padStart(8)} (${pct}%)`);
  }
  console.log();

  // Output samples
  if (summary.samples.length > 0) {
    console.log('[Sample Excluded Markets]');
    for (const group of summary.samples) {
      console.log(`\n  --- ${group.reason} ---`);
      for (const m of group.markets) {
        console.log(`  [${m.id}] ${m.title}`);
        console.log(`         status=${m.status}, closeTime=${m.closeTime?.toISOString() || 'null'} (${m.ageInfo})`);
      }
    }
  }

  console.log();
  console.log(`[Result] Eligible: ${eligibleCount.toLocaleString()} / ${totalInDb.toLocaleString()} (${((eligibleCount / totalInDb) * 100).toFixed(1)}%)`);

  return {
    venue,
    topic,
    config: {
      lookbackHours,
      forwardHours,
      graceMinutes,
    },
    counts: {
      totalInDb,
      eligible: eligibleCount,
      excluded: totalInDb - eligibleCount,
    },
    byReason: summary.byReason,
    samples: summary.samples,
  };
}

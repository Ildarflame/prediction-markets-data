/**
 * links:auto-reject - Auto-reject low-quality suggested links (v2.6.8)
 *
 * Uses REJECT_RULES to identify obvious garbage:
 * - Score below hard floor (topic-specific)
 * - Entity mismatch detected
 * - Incompatible market types (daily vs intraday)
 * - Large settle date mismatch
 * - Text sanity below floor
 *
 * CAUTION: Default is dry-run mode. Use --apply to actually reject.
 *
 * Run: pnpm --filter @data-module/worker links:auto-reject --dry-run
 *      pnpm --filter @data-module/worker links:auto-reject --topic crypto_daily --min-age-hours 24 --apply
 */

import { getClient, type LinkStatus } from '@data-module/db';
import {
  evaluateRejectRules,
  formatRejectEvaluation,
  HARD_FLOOR_SCORES,
  type Topic,
  type RejectEvaluation,
} from '../ops/reject-rules.js';

export interface LinksAutoRejectOptions {
  /** Filter by topic (default: all) */
  topic?: Topic | 'all';
  /** Minimum age in hours before rejecting (default: 24) */
  minAgeHours?: number;
  /** Override hard floor score for rejection */
  maxScore?: number;
  /** Maximum links to process (default: 5000) */
  limit?: number;
  /** Actually apply rejections (default: dry-run) */
  apply?: boolean;
  /** Show detailed evaluation for each link */
  explain?: boolean;
}

export interface LinksAutoRejectResult {
  dryRun: boolean;
  candidates: number;
  rejected: number;
  kept: number;
  avgScore: number;
  byReason: Record<string, number>;
  byTopic: Record<string, { rejected: number; kept: number }>;
  samples: Array<{
    id: number;
    score: number;
    topic: string | null;
    leftTitle: string;
    rightTitle: string;
    rejectReasons: string[];
  }>;
}

export async function runLinksAutoReject(
  options: LinksAutoRejectOptions = {}
): Promise<LinksAutoRejectResult> {
  const {
    topic = 'all',
    minAgeHours = 24,
    maxScore,
    limit = 5000,
    apply = false,
    explain = false,
  } = options;

  const dryRun = !apply;
  const prisma = getClient();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[links:auto-reject] Auto-Reject Low-Quality Links (v2.6.8)`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Options:`);
  console.log(`  topic: ${topic}`);
  console.log(`  minAgeHours: ${minAgeHours}`);
  console.log(`  maxScore: ${maxScore ?? 'default per topic'}`);
  console.log(`  limit: ${limit}`);
  console.log(`  Mode: ${dryRun ? 'DRY RUN' : '⚠️  APPLY (will reject)'}`);
  if (explain) console.log(`  explain: enabled`);
  console.log();

  console.log('[Hard Floor Scores by Topic]');
  for (const [t, score] of Object.entries(HARD_FLOOR_SCORES)) {
    console.log(`  ${t}: ${score}`);
  }
  console.log();

  // Build where clause
  const whereClause: Record<string, unknown> = {
    status: 'suggested' as LinkStatus,
  };

  if (topic !== 'all') {
    whereClause.topic = topic;
  }

  // Fetch suggested links
  const links = await prisma.marketLink.findMany({
    where: whereClause,
    include: {
      leftMarket: { include: { outcomes: true } },
      rightMarket: { include: { outcomes: true } },
    },
    orderBy: { score: 'asc' },
    take: limit,
  });

  console.log(`[Analysis] Found ${links.length} suggested links to analyze`);
  console.log();

  // Analyze each link
  const toReject: Array<{
    id: number;
    score: number;
    topic: string | null;
    leftTitle: string;
    rightTitle: string;
    rejectReasons: string[];
    evaluation: RejectEvaluation;
  }> = [];

  const kept: Array<{ id: number; score: number; topic: string | null }> = [];
  const byReason: Record<string, number> = {};
  const byTopic: Record<string, { rejected: number; kept: number }> = {};
  let scoreSum = 0;

  for (const link of links) {
    scoreSum += link.score;
    const effectiveTopic = link.topic || topic;

    // Initialize topic stats
    if (!byTopic[effectiveTopic]) {
      byTopic[effectiveTopic] = { rejected: 0, kept: 0 };
    }

    // Evaluate reject rules
    const evaluation = evaluateRejectRules(link, effectiveTopic, minAgeHours);

    if (explain && toReject.length < 10) {
      console.log(`[Link ${link.id}] score=${link.score.toFixed(3)} topic=${effectiveTopic}`);
      console.log(`  L: ${link.leftMarket.title.slice(0, 50)}...`);
      console.log(`  R: ${link.rightMarket.title.slice(0, 50)}...`);
      console.log(formatRejectEvaluation(evaluation).split('\n').map(l => '  ' + l).join('\n'));
      console.log();
    }

    if (evaluation.reject) {
      toReject.push({
        id: link.id,
        score: link.score,
        topic: link.topic,
        leftTitle: link.leftMarket.title,
        rightTitle: link.rightMarket.title,
        rejectReasons: evaluation.rejectionReasons,
        evaluation,
      });

      byTopic[effectiveTopic].rejected++;

      // Track rejection reasons
      for (const reason of evaluation.rejectionReasons) {
        byReason[reason] = (byReason[reason] || 0) + 1;
      }
    } else {
      kept.push({
        id: link.id,
        score: link.score,
        topic: link.topic,
      });
      byTopic[effectiveTopic].kept++;
    }
  }

  // Summary
  console.log(`${'='.repeat(60)}`);
  console.log(`[Summary]`);
  console.log(`  Candidates analyzed: ${links.length}`);
  console.log(`  Would reject:        ${toReject.length}`);
  console.log(`  Kept:                ${kept.length}`);
  console.log(`  Avg score:           ${links.length > 0 ? (scoreSum / links.length).toFixed(3) : 'N/A'}`);
  console.log();

  // Show breakdown by reason
  console.log('[By Rejection Reason]');
  const sortedReasons = Object.entries(byReason).sort((a, b) => b[1] - a[1]);
  if (sortedReasons.length === 0) {
    console.log('  (none)');
  } else {
    for (const [reason, count] of sortedReasons) {
      console.log(`  ${reason.padEnd(25)} ${String(count).padStart(5)}`);
    }
  }
  console.log();

  // Show breakdown by topic
  console.log('[By Topic]');
  for (const [t, stats] of Object.entries(byTopic)) {
    console.log(`  ${t.padEnd(18)} rejected=${String(stats.rejected).padStart(5)} kept=${String(stats.kept).padStart(5)}`);
  }
  console.log();

  // Show samples
  const samples = toReject.slice(0, 20);
  if (samples.length > 0) {
    console.log(`[Samples] (${samples.length} of ${toReject.length})`);
    for (const s of samples) {
      const leftShort = s.leftTitle.length > 35 ? s.leftTitle.slice(0, 32) + '...' : s.leftTitle;
      const rightShort = s.rightTitle.length > 35 ? s.rightTitle.slice(0, 32) + '...' : s.rightTitle;
      console.log(`  [${s.id}] score=${s.score.toFixed(3)} | ${s.rejectReasons.join(', ')}`);
      console.log(`    L: ${leftShort}`);
      console.log(`    R: ${rightShort}`);
    }
    console.log();
  }

  // Apply or dry-run
  if (dryRun) {
    console.log(`[DRY RUN] Would reject ${toReject.length} links`);
    console.log();
    console.log('Run with --apply to actually reject these links.');
  } else {
    console.log(`[Rejecting] ${toReject.length} links...`);

    let rejected = 0;
    const batchSize = 100;

    for (let i = 0; i < toReject.length; i += batchSize) {
      const batch = toReject.slice(i, i + batchSize);

      for (const item of batch) {
        const rejectReason = `auto_reject@2.6.8:${item.rejectReasons.join('+')}`;
        await prisma.marketLink.update({
          where: { id: item.id },
          data: {
            status: 'rejected',
            reason: rejectReason,
          },
        });
        rejected++;
      }

      if (i + batchSize < toReject.length) {
        console.log(`  Progress: ${Math.min(i + batchSize, toReject.length)}/${toReject.length}`);
      }
    }

    console.log(`[Done] Rejected ${rejected} links`);
  }

  return {
    dryRun,
    candidates: links.length,
    rejected: dryRun ? 0 : toReject.length,
    kept: kept.length,
    avgScore: links.length > 0 ? scoreSum / links.length : 0,
    byReason,
    byTopic,
    samples: samples.map(s => ({
      id: s.id,
      score: s.score,
      topic: s.topic,
      leftTitle: s.leftTitle,
      rightTitle: s.rightTitle,
      rejectReasons: s.rejectReasons,
    })),
  };
}

/**
 * links:auto-reject - Auto-reject low-quality suggested links (v2.6.7)
 *
 * Auto-rejects suggested links that match rejection criteria:
 * - Score below threshold (default: 0.55)
 * - Older than N days (default: 14)
 * - Entity mismatch detected in reason
 * - Date incompatibility detected in reason
 *
 * CAUTION: Default is dry-run mode. Use --apply to actually reject.
 *
 * Run: pnpm --filter @data-module/worker links:auto-reject --dry-run
 *      pnpm --filter @data-module/worker links:auto-reject --apply --older-than-days 14
 */

import { getClient } from '@data-module/db';

export interface LinksAutoRejectOptions {
  /** Maximum score to reject (links with score < this) */
  maxScore?: number;
  /** Only reject links older than N days */
  olderThanDays?: number;
  /** Filter by topic */
  topic?: string;
  /** Actually apply rejections (default: dry-run) */
  apply?: boolean;
}

export interface LinksAutoRejectResult {
  dryRun: boolean;
  rejected: number;
  byReason: Record<string, number>;
  samples: Array<{
    id: number;
    score: number;
    topic: string | null;
    leftTitle: string;
    rightTitle: string;
    rejectReason: string;
  }>;
}

// Patterns in reason that indicate entity mismatch
const ENTITY_MISMATCH_PATTERNS = [
  /entity mismatch/i,
  /different entit/i,
  /wrong entity/i,
  /asset mismatch/i,
];

// Patterns in reason that indicate date/settle incompatibility
const DATE_MISMATCH_PATTERNS = [
  /date mismatch/i,
  /settle.*mismatch/i,
  /different.*date/i,
  /incompatible.*period/i,
  /period mismatch/i,
];

function detectRejectReason(
  score: number,
  maxScore: number,
  reason: string | null,
  age: number,
  olderThanDays: number
): string | null {
  // Check score threshold
  if (score < maxScore) {
    return `low_score (${score.toFixed(3)} < ${maxScore})`;
  }

  // Check age
  if (age > olderThanDays) {
    return `stale (${age}d > ${olderThanDays}d threshold)`;
  }

  // Check reason patterns
  if (reason) {
    for (const pattern of ENTITY_MISMATCH_PATTERNS) {
      if (pattern.test(reason)) {
        return 'entity_mismatch';
      }
    }
    for (const pattern of DATE_MISMATCH_PATTERNS) {
      if (pattern.test(reason)) {
        return 'date_incompatible';
      }
    }
  }

  return null;
}

export async function runLinksAutoReject(
  options: LinksAutoRejectOptions = {}
): Promise<LinksAutoRejectResult> {
  const {
    maxScore = 0.55,
    olderThanDays = 14,
    topic,
    apply = false,
  } = options;

  const dryRun = !apply;
  const prisma = getClient();
  const now = new Date();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[links:auto-reject] Auto-Reject Low-Quality Links (v2.6.7)`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Options:`);
  console.log(`  maxScore: ${maxScore}`);
  console.log(`  olderThanDays: ${olderThanDays}`);
  if (topic) console.log(`  topic: ${topic}`);
  console.log(`  apply: ${apply} (${dryRun ? 'DRY RUN' : 'LIVE'})`);
  console.log();

  // Build base where clause
  const whereClause: Record<string, unknown> = {
    status: 'suggested',
  };

  if (topic) {
    whereClause.topic = topic;
  }

  // Fetch all suggested links matching criteria
  const links = await prisma.marketLink.findMany({
    where: whereClause,
    include: {
      leftMarket: { select: { title: true } },
      rightMarket: { select: { title: true } },
    },
    orderBy: { score: 'asc' },
  });

  console.log(`[Analysis] Found ${links.length} suggested links to analyze`);

  // Analyze each link
  const toReject: Array<{
    id: number;
    score: number;
    topic: string | null;
    leftTitle: string;
    rightTitle: string;
    rejectReason: string;
  }> = [];
  const byReason: Record<string, number> = {};

  for (const link of links) {
    const ageMs = now.getTime() - link.createdAt.getTime();
    const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));

    const rejectReason = detectRejectReason(
      link.score,
      maxScore,
      link.reason,
      ageDays,
      olderThanDays
    );

    if (rejectReason) {
      toReject.push({
        id: link.id,
        score: link.score,
        topic: link.topic,
        leftTitle: link.leftMarket.title,
        rightTitle: link.rightMarket.title,
        rejectReason,
      });

      // Extract base reason type
      const reasonType = rejectReason.split(' ')[0];
      byReason[reasonType] = (byReason[reasonType] || 0) + 1;
    }
  }

  console.log(`[Results] ${toReject.length} links identified for rejection`);
  console.log();

  // Show breakdown by reason
  console.log('[By Reason]');
  for (const [reason, count] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason.padEnd(20)} ${count}`);
  }
  console.log();

  // Show samples (up to 20)
  const samples = toReject.slice(0, 20);
  if (samples.length > 0) {
    console.log(`[Samples] (${samples.length} of ${toReject.length})`);
    for (const s of samples) {
      const leftShort = s.leftTitle.length > 30 ? s.leftTitle.slice(0, 27) + '...' : s.leftTitle;
      const rightShort = s.rightTitle.length > 30 ? s.rightTitle.slice(0, 27) + '...' : s.rightTitle;
      console.log(`  [${s.id}] score=${s.score.toFixed(3)} | ${s.rejectReason}`);
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

    const idsToReject = toReject.map((l) => l.id);

    // Batch update in chunks
    const batchSize = 100;
    let rejected = 0;

    for (let i = 0; i < idsToReject.length; i += batchSize) {
      const batch = idsToReject.slice(i, i + batchSize);
      const result = await prisma.marketLink.updateMany({
        where: { id: { in: batch } },
        data: { status: 'rejected' },
      });
      rejected += result.count;
    }

    console.log(`[Done] Rejected ${rejected} links`);
  }

  return {
    dryRun,
    rejected: dryRun ? 0 : toReject.length,
    byReason,
    samples,
  };
}

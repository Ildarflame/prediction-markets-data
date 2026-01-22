/**
 * links:queue - Show suggested links for review (v2.6.7)
 *
 * Displays a prioritized queue of suggested links for manual review.
 * Sorted by score DESC, then createdAt DESC.
 *
 * Run: pnpm --filter @data-module/worker links:queue --topic crypto_daily --limit 20
 */

import { getClient, type LinkStatus } from '@data-module/db';

export interface LinksQueueOptions {
  topic?: string;
  minScore?: number;
  limit?: number;
  status?: LinkStatus;
}

export interface LinksQueueItem {
  id: number;
  topic: string | null;
  algoVersion: string | null;
  score: number;
  status: LinkStatus;
  leftTitle: string;
  rightTitle: string;
  reason: string | null;
  createdAt: Date;
}

export interface LinksQueueResult {
  total: number;
  items: LinksQueueItem[];
}

export async function runLinksQueue(
  options: LinksQueueOptions = {}
): Promise<LinksQueueResult> {
  const { topic, minScore = 0.55, limit = 50, status = 'suggested' } = options;
  const prisma = getClient();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[links:queue] Suggested Links Review Queue (v2.6.7)`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Options:`);
  console.log(`  topic: ${topic || 'all'}`);
  console.log(`  minScore: ${minScore}`);
  console.log(`  status: ${status}`);
  console.log(`  limit: ${limit}`);
  console.log();

  // Build where clause
  const whereClause: Record<string, unknown> = {
    status,
    score: { gte: minScore },
  };

  if (topic) {
    whereClause.topic = topic;
  }

  // Get total count
  const total = await prisma.marketLink.count({ where: whereClause });

  // Get items with market details
  const links = await prisma.marketLink.findMany({
    where: whereClause,
    include: {
      leftMarket: { select: { title: true } },
      rightMarket: { select: { title: true } },
    },
    orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  });

  console.log(`[Results] Showing ${links.length} of ${total} links`);
  console.log();

  if (links.length === 0) {
    console.log('  (no links match criteria)');
    return { total, items: [] };
  }

  // Header
  console.log(
    '  ' +
      'ID'.padEnd(8) +
      'Score'.padEnd(8) +
      'Topic'.padEnd(18) +
      'Left Title'.padEnd(40) +
      'Right Title'
  );
  console.log('  ' + '-'.repeat(120));

  const items: LinksQueueItem[] = [];

  for (const link of links) {
    const leftTitle = link.leftMarket.title.length > 38
      ? link.leftMarket.title.slice(0, 35) + '...'
      : link.leftMarket.title;
    const rightTitle = link.rightMarket.title.length > 38
      ? link.rightMarket.title.slice(0, 35) + '...'
      : link.rightMarket.title;

    console.log(
      '  ' +
        String(link.id).padEnd(8) +
        link.score.toFixed(3).padEnd(8) +
        (link.topic || 'unknown').padEnd(18) +
        leftTitle.padEnd(40) +
        rightTitle
    );

    // Show reason if present (truncated)
    if (link.reason) {
      const shortReason = link.reason.length > 100
        ? link.reason.slice(0, 97) + '...'
        : link.reason;
      console.log('    ' + `[reason: ${shortReason}]`);
    }

    items.push({
      id: link.id,
      topic: link.topic,
      algoVersion: link.algoVersion,
      score: link.score,
      status: link.status,
      leftTitle: link.leftMarket.title,
      rightTitle: link.rightMarket.title,
      reason: link.reason,
      createdAt: link.createdAt,
    });
  }

  console.log();
  console.log('[Actions]');
  console.log('  To confirm: pnpm --filter @data-module/worker confirm-match --id <ID>');
  console.log('  To reject:  pnpm --filter @data-module/worker reject-match --id <ID>');

  return { total, items };
}

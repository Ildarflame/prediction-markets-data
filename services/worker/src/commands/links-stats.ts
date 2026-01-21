/**
 * links:stats - Show market link statistics (v2.6.2)
 *
 * Displays counts by status, algoVersion, and topic
 */

import { getClient, MarketLinkRepository } from '@data-module/db';

export interface LinksStatsResult {
  byStatus: Record<string, number>;
  byAlgoVersion: Array<{ algoVersion: string | null; count: number }>;
  byTopic: Array<{ topic: string; count: number }>;
  total: number;
}

/**
 * Run links:stats command
 */
export async function runLinksStats(): Promise<LinksStatsResult> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[links:stats] Market Link Statistics (v2.6.2)`);
  console.log(`${'='.repeat(60)}\n`);

  const prisma = getClient();
  const linkRepo = new MarketLinkRepository(prisma);

  const stats = await linkRepo.getStats();

  // Print by status
  console.log('[By Status]');
  console.log(`  suggested:  ${String(stats.byStatus.suggested).padStart(8)}`);
  console.log(`  confirmed:  ${String(stats.byStatus.confirmed).padStart(8)}`);
  console.log(`  rejected:   ${String(stats.byStatus.rejected).padStart(8)}`);
  console.log(`  ${'─'.repeat(20)}`);
  console.log(`  TOTAL:      ${String(stats.total).padStart(8)}`);

  // Print by topic
  console.log('\n[By Topic]');
  if (stats.byTopic.length === 0) {
    console.log('  (no data)');
  } else {
    for (const t of stats.byTopic) {
      console.log(`  ${(t.topic || 'unknown').padEnd(20)} ${String(t.count).padStart(8)}`);
    }
  }

  // Print by algoVersion
  console.log('\n[By AlgoVersion]');
  if (stats.byAlgoVersion.length === 0) {
    console.log('  (no data)');
  } else {
    for (const v of stats.byAlgoVersion.slice(0, 20)) {
      console.log(`  ${(v.algoVersion || '(null)').padEnd(30)} ${String(v.count).padStart(8)}`);
    }
    if (stats.byAlgoVersion.length > 20) {
      console.log(`  ... and ${stats.byAlgoVersion.length - 20} more versions`);
    }
  }

  return stats;
}

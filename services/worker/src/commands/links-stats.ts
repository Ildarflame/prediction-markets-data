/**
 * links:stats - Show market link statistics (v2.6.3, v2.6.6)
 *
 * Displays counts by status, algoVersion, and topic
 * v2.6.3: Added topic field support
 * v2.6.6: Added avgScore by status
 */

import { getClient, MarketLinkRepository } from '@data-module/db';

export interface LinksStatsResult {
  byStatus: Record<string, number>;
  avgScoreByStatus: Record<string, number | null>;
  byAlgoVersion: Array<{ algoVersion: string | null; count: number }>;
  byTopic: Array<{ topic: string; count: number }>;
  total: number;
}

/**
 * Run links:stats command
 */
export async function runLinksStats(): Promise<LinksStatsResult> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[links:stats] Market Link Statistics (v2.6.6)`);
  console.log(`${'='.repeat(60)}\n`);

  const prisma = getClient();
  const linkRepo = new MarketLinkRepository(prisma);

  const stats = await linkRepo.getStats();

  // Helper to format score
  const fmtScore = (score: number | null) => score !== null ? score.toFixed(3) : 'N/A';

  // Print by status with avgScore (v2.6.6)
  console.log('[By Status]');
  console.log(`  ${'Status'.padEnd(12)} ${'Count'.padStart(8)} ${'Avg Score'.padStart(10)}`);
  console.log(`  ${'─'.repeat(32)}`);
  console.log(`  ${'suggested'.padEnd(12)} ${String(stats.byStatus.suggested).padStart(8)} ${fmtScore(stats.avgScoreByStatus.suggested).padStart(10)}`);
  console.log(`  ${'confirmed'.padEnd(12)} ${String(stats.byStatus.confirmed).padStart(8)} ${fmtScore(stats.avgScoreByStatus.confirmed).padStart(10)}`);
  console.log(`  ${'rejected'.padEnd(12)} ${String(stats.byStatus.rejected).padStart(8)} ${fmtScore(stats.avgScoreByStatus.rejected).padStart(10)}`);
  console.log(`  ${'─'.repeat(32)}`);
  console.log(`  ${'TOTAL'.padEnd(12)} ${String(stats.total).padStart(8)}`);

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

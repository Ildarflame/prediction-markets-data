/**
 * Macro Counts Command (v2.4.5)
 *
 * Shows macro entity counts per venue with sample titles.
 * Useful for verifying entity extraction and understanding data distribution.
 */

import type { Venue as CoreVenue } from '@data-module/core';
import { buildFingerprint } from '@data-module/core';
import {
  getClient,
  MarketRepository,
  type Venue,
} from '@data-module/db';

export interface MacroCountsOptions {
  venue: CoreVenue;
  lookbackHours?: number;
  limit?: number;
  samplesPerEntity?: number;
}

interface EntityStats {
  count: number;
  samples: Array<{ id: number; title: string }>;
}

/**
 * Run macro:counts to show entity distribution for a venue
 */
export async function runMacroCounts(options: MacroCountsOptions): Promise<void> {
  const {
    venue,
    lookbackHours = 720, // 30 days
    limit = 5000,
    samplesPerEntity = 5,
  } = options;

  const prisma = getClient();
  const marketRepo = new MarketRepository(prisma);

  console.log(`\n[macro:counts] Analyzing macro entities for ${venue}`);
  console.log(`[macro:counts] Lookback: ${lookbackHours}h, limit: ${limit}`);

  // Fetch markets using closeTime ordering (v2.4.4)
  // v2.4.6: Added 'jobs', 'employment', 'claims', 'ism', 'purchasing' for Polymarket NFP patterns
  const MACRO_KEYWORDS = [
    'cpi', 'gdp', 'inflation', 'unemployment', 'jobless',
    'payrolls', 'nonfarm', 'nfp', 'fed', 'fomc',
    'rates', 'interest', 'pce', 'pmi',
    'jobs', 'employment', 'claims', 'ism', 'purchasing',
  ];

  const markets = await marketRepo.listEligibleMarkets(venue as Venue, {
    lookbackHours,
    limit,
    titleKeywords: MACRO_KEYWORDS,
    orderBy: 'closeTime',
  });

  console.log(`[macro:counts] Fetched ${markets.length} markets with macro keywords\n`);

  // Build entity stats
  const entityStats = new Map<string, EntityStats>();
  let marketsWithMacroEntities = 0;
  let marketsWithoutMacroEntities = 0;

  for (const market of markets) {
    const fingerprint = buildFingerprint(market.title, market.closeTime, { metadata: market.metadata });

    if (fingerprint.macroEntities?.size) {
      marketsWithMacroEntities++;
      for (const entity of fingerprint.macroEntities) {
        const stats = entityStats.get(entity) || { count: 0, samples: [] };
        stats.count++;
        if (stats.samples.length < samplesPerEntity) {
          stats.samples.push({ id: market.id, title: market.title });
        }
        entityStats.set(entity, stats);
      }
    } else {
      marketsWithoutMacroEntities++;
    }
  }

  // Print summary
  console.log(`[macro:counts] Markets with macro entities: ${marketsWithMacroEntities}`);
  console.log(`[macro:counts] Markets without macro entities: ${marketsWithoutMacroEntities}`);
  console.log(`\n${'Entity'.padEnd(20)} | ${'Count'.padStart(6)}`);
  console.log('-'.repeat(30));

  // Sort by count descending
  const sortedEntities = Array.from(entityStats.entries())
    .sort((a, b) => b[1].count - a[1].count);

  for (const [entity, stats] of sortedEntities) {
    console.log(`${entity.padEnd(20)} | ${String(stats.count).padStart(6)}`);
  }

  console.log('-'.repeat(30));
  console.log(`${'TOTAL'.padEnd(20)} | ${String(marketsWithMacroEntities).padStart(6)}`);

  // Print samples per entity
  console.log(`\n[macro:counts] Sample titles per entity (top ${samplesPerEntity}):\n`);

  for (const [entity, stats] of sortedEntities) {
    console.log(`${entity}:`);
    for (const sample of stats.samples) {
      const truncTitle = sample.title.length > 70
        ? sample.title.substring(0, 67) + '...'
        : sample.title;
      console.log(`  [${sample.id}] ${truncTitle}`);
    }
    console.log('');
  }

  console.log(`[macro:counts] Complete.`);

  await prisma.$disconnect();
}

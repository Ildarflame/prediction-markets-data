/**
 * crypto:counts - Diagnostic command for crypto market counts (v2.5.0)
 *
 * Shows strict/broad DB counts, detected counts, and detection rate
 * Similar to macro:audit-pack but for crypto entities
 */

import { type Venue } from '@data-module/core';
import { getClient, type MarketStatus } from '@data-module/db';
import {
  CRYPTO_ENTITIES_V1,
  CRYPTO_KEYWORDS_STRICT,
  CRYPTO_KEYWORDS_BROAD,
  extractCryptoEntity,
} from '../matching/index.js';

export interface CryptoCountsOptions {
  venue: Venue;
  lookbackHours?: number;
  limit?: number;
  includeResolved?: boolean;
  allTime?: boolean;
}

export interface CryptoEntityCount {
  entity: string;
  dbStrict: number;
  dbBroad: number;
  detected: number;
  rateStrict: number;
  samples: string[];
}

export interface CryptoCountsResult {
  venue: Venue;
  entities: CryptoEntityCount[];
  totals: {
    dbStrict: number;
    dbBroad: number;
    detected: number;
  };
}

/**
 * Run crypto:counts command
 */
export async function runCryptoCounts(options: CryptoCountsOptions): Promise<CryptoCountsResult> {
  const {
    venue,
    lookbackHours = 720,
    limit = 5000,
    includeResolved = false,
    allTime = false,
  } = options;

  console.log(`\n${'='.repeat(80)}`);
  console.log(`[crypto:counts] ${venue}`);
  console.log(`${'='.repeat(80)}`);
  console.log(`Lookback: ${allTime ? 'ALL-TIME' : `${lookbackHours}h`} | Limit: ${limit} | Include resolved: ${includeResolved}`);
  console.log(`${'='.repeat(80)}\n`);

  const prisma = getClient();

  // Status filter
  const statusFilter: MarketStatus[] = ['active', 'closed'];
  if (includeResolved) {
    statusFilter.push('resolved', 'archived');
  }

  const entityCounts: CryptoEntityCount[] = [];
  let totalDbStrict = 0;
  let totalDbBroad = 0;
  let totalDetected = 0;

  for (const entity of CRYPTO_ENTITIES_V1) {
    const strictKeywords = CRYPTO_KEYWORDS_STRICT[entity] || [];
    const broadKeywords = [...strictKeywords, ...CRYPTO_KEYWORDS_BROAD];

    // DB strict count
    const strictMarkets = await prisma.market.findMany({
      where: {
        venue,
        status: { in: statusFilter },
        OR: strictKeywords.map(kw => ({ title: { contains: kw, mode: 'insensitive' as const } })),
      },
      select: { id: true, title: true, metadata: true },
      take: limit,
    });

    // DB broad count (includes generic "crypto", "token", etc.)
    const broadMarkets = await prisma.market.findMany({
      where: {
        venue,
        status: { in: statusFilter },
        OR: broadKeywords.map(kw => ({ title: { contains: kw, mode: 'insensitive' as const } })),
      },
      select: { id: true, title: true, metadata: true },
      take: limit,
    });

    // Run extraction on strict markets to count detected
    let detected = 0;
    const samples: string[] = [];

    for (const m of strictMarkets) {
      const extractedEntity = extractCryptoEntity(m.title, m.metadata as Record<string, unknown> | null);
      if (extractedEntity === entity) {
        detected++;
        if (samples.length < 3) {
          samples.push(m.title.slice(0, 60) + (m.title.length > 60 ? '...' : ''));
        }
      }
    }

    const dbStrict = strictMarkets.length;
    const dbBroad = broadMarkets.length;
    const rateStrict = dbStrict > 0 ? (detected / dbStrict) * 100 : 0;

    entityCounts.push({
      entity,
      dbStrict,
      dbBroad,
      detected,
      rateStrict,
      samples,
    });

    totalDbStrict += dbStrict;
    totalDbBroad += dbBroad;
    totalDetected += detected;
  }

  // Print table
  console.log('Entity          | Strict | Broad | Detect | Rate%  | Verdict');
  console.log('----------------+--------+-------+--------+--------+------------------');

  for (const ec of entityCounts) {
    const verdict = ec.dbStrict === 0
      ? 'NO DATA'
      : ec.rateStrict >= 90
        ? '✅'
        : ec.rateStrict >= 50
          ? 'PARTIAL'
          : 'LOW';

    console.log(
      `${ec.entity.padEnd(15)} | ${String(ec.dbStrict).padStart(6)} | ${String(ec.dbBroad).padStart(5)} | ${String(ec.detected).padStart(6)} | ${ec.rateStrict.toFixed(1).padStart(5)}% | ${verdict}`
    );
  }

  console.log('----------------+--------+-------+--------+--------+------------------');
  const totalRate = totalDbStrict > 0 ? (totalDetected / totalDbStrict) * 100 : 0;
  console.log(
    `${'TOTAL'.padEnd(15)} | ${String(totalDbStrict).padStart(6)} | ${String(totalDbBroad).padStart(5)} | ${String(totalDetected).padStart(6)} | ${totalRate.toFixed(1).padStart(5)}%`
  );

  // Print samples
  console.log('\n[Samples per entity]');
  for (const ec of entityCounts) {
    if (ec.samples.length > 0) {
      console.log(`\n${ec.entity}:`);
      for (const s of ec.samples) {
        console.log(`  - ${s}`);
      }
    }
  }

  return {
    venue,
    entities: entityCounts,
    totals: {
      dbStrict: totalDbStrict,
      dbBroad: totalDbBroad,
      detected: totalDetected,
    },
  };
}

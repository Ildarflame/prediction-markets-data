/**
 * crypto:counts - Diagnostic command for crypto market counts (v2.5.0, v2.6.2)
 *
 * Shows strict/broad DB counts, detected counts, and detection rate
 * Similar to macro:audit-pack but for crypto entities
 *
 * v2.6.2: Added --topic option to filter by crypto_daily or crypto_intraday
 */

import { type Venue } from '@data-module/core';
import { getClient, type MarketStatus } from '@data-module/db';
import {
  CRYPTO_ENTITIES_V1,
  CRYPTO_KEYWORDS_STRICT,
  CRYPTO_KEYWORDS_BROAD,
  extractCryptoEntity,
} from '../matching/index.js';

/**
 * v2.6.2: Simple intraday detection based on title patterns and metadata
 * Simplified version that doesn't require full signal extraction
 */
function isIntradayMarket(title: string, metadata: Record<string, unknown> | null): boolean {
  const lower = title.toLowerCase();

  // Check metadata for intraday indicators
  if (metadata) {
    const marketType = metadata.marketType || metadata.market_type;
    if (typeof marketType === 'string') {
      if (marketType.toLowerCase().includes('binary') && lower.includes('up or down')) {
        return true;
      }
    }

    const eventTicker = metadata.eventTicker || metadata.event_ticker;
    if (typeof eventTicker === 'string') {
      if (/UPDOWN|INTRADAY/i.test(eventTicker)) {
        return true;
      }
    }
  }

  // Check title for intraday patterns
  const intradayPatterns = [
    /\b(?:next\s+)?(?:\d+\s+)?(?:minute|min|hour|hr)s?\b/i,
    /\btoday\s+(?:at|by)\b/i,
    /\b(?:at|by)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm|ET|EST|UTC)\b/i,
    /\bup\s+or\s+down\b/i,
    /\bintraday\b/i,
    /\bdaily\s+candle\s+change\b/i,
  ];
  for (const pattern of intradayPatterns) {
    if (pattern.test(title)) {
      return true;
    }
  }

  return false;
}

/** Topic filter for crypto counts */
export type CryptoTopic = 'crypto' | 'crypto_daily' | 'crypto_intraday';

export interface CryptoCountsOptions {
  venue: Venue;
  lookbackHours?: number;
  limit?: number;
  includeResolved?: boolean;
  allTime?: boolean;
  /** v2.6.2: Filter by topic (crypto_daily, crypto_intraday, or crypto for all) */
  topic?: CryptoTopic;
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
    topic = 'crypto',
  } = options;

  console.log(`\n${'='.repeat(80)}`);
  console.log(`[crypto:counts] ${venue} | topic=${topic}`);
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
    // v2.6.2: Apply topic filter based on market type
    let detected = 0;
    const samples: string[] = [];

    for (const m of strictMarkets) {
      const extractedEntity = extractCryptoEntity(m.title, m.metadata as Record<string, unknown> | null);
      if (extractedEntity === entity) {
        // v2.6.2: Filter by market type based on topic
        if (topic !== 'crypto') {
          const isIntraday = isIntradayMarket(m.title, m.metadata as Record<string, unknown> | null);

          if (topic === 'crypto_daily' && isIntraday) {
            continue; // Skip intraday markets when looking for daily
          }
          if (topic === 'crypto_intraday' && !isIntraday) {
            continue; // Skip daily markets when looking for intraday
          }
        }

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

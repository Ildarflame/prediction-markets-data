/**
 * crypto:overlap - Cross-venue overlap report for crypto markets (v2.5.0, v2.6.2)
 *
 * Shows how many markets exist on both venues for each entity and settleDate
 *
 * v2.6.2: Added --topic option for daily/intraday filtering
 */

import { type Venue } from '@data-module/core';
import { getClient, MarketRepository } from '@data-module/db';
import {
  CRYPTO_ENTITIES_V1,
  fetchEligibleCryptoMarkets,
  fetchIntradayCryptoMarkets,
  collectCryptoSettleDates,
  collectCryptoSamplesByEntity,
  type IntradayMarket,
} from '../matching/index.js';

/** Topic filter for crypto overlap */
export type CryptoOverlapTopic = 'crypto' | 'crypto_daily' | 'crypto_intraday';

export interface CryptoOverlapOptions {
  fromVenue: Venue;
  toVenue: Venue;
  lookbackHours?: number;
  limit?: number;
  /** v2.6.2: Filter by topic */
  topic?: CryptoOverlapTopic;
}

export interface CryptoOverlapResult {
  fromVenue: Venue;
  toVenue: Venue;
  fromCount: number;
  toCount: number;
  entityOverlap: Map<string, {
    fromCount: number;
    toCount: number;
    fromDates: Set<string>;
    toDates: Set<string>;
    dateOverlap: Set<string>;
  }>;
}

/**
 * Run crypto:overlap command
 */
export async function runCryptoOverlap(options: CryptoOverlapOptions): Promise<CryptoOverlapResult> {
  const {
    fromVenue,
    toVenue,
    lookbackHours = 720,
    limit = 5000,
    topic = 'crypto',
  } = options;

  console.log(`\n${'='.repeat(80)}`);
  console.log(`[crypto:overlap] ${fromVenue} → ${toVenue} | topic=${topic}`);
  console.log(`${'='.repeat(80)}`);
  console.log(`Lookback: ${lookbackHours}h | Limit: ${limit}`);
  console.log(`${'='.repeat(80)}\n`);

  const prisma = getClient();
  const marketRepo = new MarketRepository(prisma);

  // v2.6.2: Determine excludeIntraday based on topic
  const excludeIntraday = topic === 'crypto_daily';

  // v2.6.2: For crypto_intraday, use separate intraday pipeline
  if (topic === 'crypto_intraday') {
    console.log(`Fetching INTRADAY ${fromVenue} markets...`);
    const { markets: fromIntraday, stats: fromStats } = await fetchIntradayCryptoMarkets(marketRepo, {
      venue: fromVenue,
      lookbackHours,
      limit,
      entities: CRYPTO_ENTITIES_V1,
    });
    console.log(`  Total: ${fromStats.total} → Intraday: ${fromIntraday.length} (${fromStats.withCryptoEntity} with entity)`);

    console.log(`Fetching INTRADAY ${toVenue} markets...`);
    const { markets: toIntraday, stats: toStats } = await fetchIntradayCryptoMarkets(marketRepo, {
      venue: toVenue,
      lookbackHours,
      limit,
      entities: CRYPTO_ENTITIES_V1,
    });
    console.log(`  Total: ${toStats.total} → Intraday: ${toIntraday.length} (${toStats.withCryptoEntity} with entity)`);

    // Build intraday overlap report (by entity + timeBucket)
    return runIntradayOverlapReport(fromVenue, toVenue, fromIntraday, toIntraday);
  }

  // Fetch from both venues (daily/all crypto)
  console.log(`Fetching ${fromVenue} markets...`);
  const { markets: fromMarkets, stats: fromStats } = await fetchEligibleCryptoMarkets(marketRepo, {
    venue: fromVenue,
    lookbackHours,
    limit,
    entities: CRYPTO_ENTITIES_V1,
    excludeIntraday,
  });
  console.log(`  Total: ${fromStats.total} → After filters: ${fromMarkets.length} (${fromStats.withCryptoEntity} with entity)`);

  console.log(`Fetching ${toVenue} markets...`);
  const { markets: toMarkets, stats: toStats } = await fetchEligibleCryptoMarkets(marketRepo, {
    venue: toVenue,
    lookbackHours,
    limit,
    entities: CRYPTO_ENTITIES_V1,
    excludeIntraday,
  });
  console.log(`  Total: ${toStats.total} → After filters: ${toMarkets.length} (${toStats.withCryptoEntity} with entity)`);

  // Collect dates by entity
  const fromDates = collectCryptoSettleDates(fromMarkets);
  const toDates = collectCryptoSettleDates(toMarkets);

  // Build overlap report
  const entityOverlap = new Map<string, {
    fromCount: number;
    toCount: number;
    fromDates: Set<string>;
    toDates: Set<string>;
    dateOverlap: Set<string>;
  }>();

  for (const entity of CRYPTO_ENTITIES_V1) {
    const fromEntityDates = fromDates.get(entity) || new Set();
    const toEntityDates = toDates.get(entity) || new Set();

    // Count markets per entity
    const fromEntityCount = fromMarkets.filter(m => m.signals.entity === entity).length;
    const toEntityCount = toMarkets.filter(m => m.signals.entity === entity).length;

    // Find date overlap
    const dateOverlap = new Set<string>();
    for (const d of fromEntityDates) {
      if (toEntityDates.has(d)) {
        dateOverlap.add(d);
      }
    }

    entityOverlap.set(entity, {
      fromCount: fromEntityCount,
      toCount: toEntityCount,
      fromDates: fromEntityDates,
      toDates: toEntityDates,
      dateOverlap,
    });
  }

  // Print table
  console.log('\n[Entity Overlap Summary]');
  console.log('Entity          | From   | To     | From Dates | To Dates | Date Overlap');
  console.log('----------------+--------+--------+------------+----------+-------------');

  let totalFrom = 0;
  let totalTo = 0;
  let totalDateOverlap = 0;

  for (const entity of CRYPTO_ENTITIES_V1) {
    const data = entityOverlap.get(entity)!;
    console.log(
      `${entity.padEnd(15)} | ${String(data.fromCount).padStart(6)} | ${String(data.toCount).padStart(6)} | ${String(data.fromDates.size).padStart(10)} | ${String(data.toDates.size).padStart(8)} | ${String(data.dateOverlap.size).padStart(12)}`
    );
    totalFrom += data.fromCount;
    totalTo += data.toCount;
    totalDateOverlap += data.dateOverlap.size;
  }

  console.log('----------------+--------+--------+------------+----------+-------------');
  console.log(
    `${'TOTAL'.padEnd(15)} | ${String(totalFrom).padStart(6)} | ${String(totalTo).padStart(6)} | ${' '.repeat(10)} | ${' '.repeat(8)} | ${String(totalDateOverlap).padStart(12)}`
  );

  // Show date overlap details
  console.log('\n[Date Overlap Details]');
  for (const entity of CRYPTO_ENTITIES_V1) {
    const data = entityOverlap.get(entity)!;
    if (data.dateOverlap.size > 0) {
      const sortedDates = [...data.dateOverlap].sort();
      console.log(`\n${entity}: ${sortedDates.length} overlapping dates`);
      for (const date of sortedDates.slice(0, 10)) {
        const fromCount = fromMarkets.filter(m => m.signals.entity === entity && m.signals.settleDate === date).length;
        const toCount = toMarkets.filter(m => m.signals.entity === entity && m.signals.settleDate === date).length;
        console.log(`  ${date}: ${fromCount} ${fromVenue} × ${toCount} ${toVenue}`);
      }
      if (sortedDates.length > 10) {
        console.log(`  ... and ${sortedDates.length - 10} more dates`);
      }
    } else {
      console.log(`\n${entity}: NO date overlap`);
      // Show sample dates from each venue
      const fromSample = [...data.fromDates].sort().slice(0, 5);
      const toSample = [...data.toDates].sort().slice(0, 5);
      if (fromSample.length > 0) {
        console.log(`  ${fromVenue} dates: ${fromSample.join(', ')}`);
      }
      if (toSample.length > 0) {
        console.log(`  ${toVenue} dates: ${toSample.join(', ')}`);
      }
    }
  }

  // Show sample markets
  console.log('\n[Sample Markets]');
  const fromSamples = collectCryptoSamplesByEntity(fromMarkets, 3);
  const toSamples = collectCryptoSamplesByEntity(toMarkets, 3);

  for (const entity of CRYPTO_ENTITIES_V1) {
    console.log(`\n${entity}:`);
    const fSamples = fromSamples.get(entity) || [];
    const tSamples = toSamples.get(entity) || [];

    if (fSamples.length > 0) {
      console.log(`  ${fromVenue}:`);
      for (const s of fSamples) {
        console.log(`    [${s.settleDate}] ${s.title.slice(0, 50)}...`);
      }
    }
    if (tSamples.length > 0) {
      console.log(`  ${toVenue}:`);
      for (const s of tSamples) {
        console.log(`    [${s.settleDate}] ${s.title.slice(0, 50)}...`);
      }
    }
  }

  return {
    fromVenue,
    toVenue,
    fromCount: fromMarkets.length,
    toCount: toMarkets.length,
    entityOverlap,
  };
}

/**
 * v2.6.2: Helper function for intraday overlap report
 * Uses timeBucket instead of settleDate for grouping
 */
function runIntradayOverlapReport(
  fromVenue: Venue,
  toVenue: Venue,
  fromMarkets: IntradayMarket[],
  toMarkets: IntradayMarket[]
): CryptoOverlapResult {
  // Build overlap report by entity + timeBucket
  const entityOverlap = new Map<string, {
    fromCount: number;
    toCount: number;
    fromDates: Set<string>;  // Actually timeBuckets
    toDates: Set<string>;    // Actually timeBuckets
    dateOverlap: Set<string>;
  }>();

  for (const entity of CRYPTO_ENTITIES_V1) {
    const fromEntityMarkets = fromMarkets.filter(m => m.signals.entity === entity);
    const toEntityMarkets = toMarkets.filter(m => m.signals.entity === entity);

    const fromBuckets = new Set(fromEntityMarkets.map(m => m.signals.timeBucket).filter(Boolean) as string[]);
    const toBuckets = new Set(toEntityMarkets.map(m => m.signals.timeBucket).filter(Boolean) as string[]);

    // Find bucket overlap
    const bucketOverlap = new Set<string>();
    for (const b of fromBuckets) {
      if (toBuckets.has(b)) {
        bucketOverlap.add(b);
      }
    }

    entityOverlap.set(entity, {
      fromCount: fromEntityMarkets.length,
      toCount: toEntityMarkets.length,
      fromDates: fromBuckets,
      toDates: toBuckets,
      dateOverlap: bucketOverlap,
    });
  }

  // Print table
  console.log('\n[Intraday Entity Overlap Summary]');
  console.log('Entity          | From   | To     | From Buckets | To Buckets | Bucket Overlap');
  console.log('----------------+--------+--------+--------------+------------+---------------');

  let totalFrom = 0;
  let totalTo = 0;
  let totalBucketOverlap = 0;

  for (const entity of CRYPTO_ENTITIES_V1) {
    const data = entityOverlap.get(entity)!;
    console.log(
      `${entity.padEnd(15)} | ${String(data.fromCount).padStart(6)} | ${String(data.toCount).padStart(6)} | ${String(data.fromDates.size).padStart(12)} | ${String(data.toDates.size).padStart(10)} | ${String(data.dateOverlap.size).padStart(14)}`
    );
    totalFrom += data.fromCount;
    totalTo += data.toCount;
    totalBucketOverlap += data.dateOverlap.size;
  }

  console.log('----------------+--------+--------+--------------+------------+---------------');
  console.log(
    `${'TOTAL'.padEnd(15)} | ${String(totalFrom).padStart(6)} | ${String(totalTo).padStart(6)} | ${' '.repeat(12)} | ${' '.repeat(10)} | ${String(totalBucketOverlap).padStart(14)}`
  );

  // Show bucket overlap details
  console.log('\n[TimeBucket Overlap Details]');
  for (const entity of CRYPTO_ENTITIES_V1) {
    const data = entityOverlap.get(entity)!;
    if (data.dateOverlap.size > 0) {
      const sortedBuckets = [...data.dateOverlap].sort();
      console.log(`\n${entity}: ${sortedBuckets.length} overlapping buckets`);
      for (const bucket of sortedBuckets.slice(0, 10)) {
        const fromCount = fromMarkets.filter(m => m.signals.entity === entity && m.signals.timeBucket === bucket).length;
        const toCount = toMarkets.filter(m => m.signals.entity === entity && m.signals.timeBucket === bucket).length;
        console.log(`  ${bucket}: ${fromCount} ${fromVenue} × ${toCount} ${toVenue}`);
      }
      if (sortedBuckets.length > 10) {
        console.log(`  ... and ${sortedBuckets.length - 10} more buckets`);
      }
    } else {
      console.log(`\n${entity}: NO bucket overlap`);
      const fromSample = [...data.fromDates].sort().slice(0, 5);
      const toSample = [...data.toDates].sort().slice(0, 5);
      if (fromSample.length > 0) {
        console.log(`  ${fromVenue} buckets: ${fromSample.join(', ')}`);
      }
      if (toSample.length > 0) {
        console.log(`  ${toVenue} buckets: ${toSample.join(', ')}`);
      }
    }
  }

  // Show sample markets
  console.log('\n[Sample Intraday Markets]');
  for (const entity of CRYPTO_ENTITIES_V1) {
    const fromSamples = fromMarkets.filter(m => m.signals.entity === entity).slice(0, 3);
    const toSamples = toMarkets.filter(m => m.signals.entity === entity).slice(0, 3);

    if (fromSamples.length > 0 || toSamples.length > 0) {
      console.log(`\n${entity}:`);
      if (fromSamples.length > 0) {
        console.log(`  ${fromVenue}:`);
        for (const m of fromSamples) {
          console.log(`    [${m.signals.timeBucket}] ${m.market.title.slice(0, 50)}...`);
        }
      }
      if (toSamples.length > 0) {
        console.log(`  ${toVenue}:`);
        for (const m of toSamples) {
          console.log(`    [${m.signals.timeBucket}] ${m.market.title.slice(0, 50)}...`);
        }
      }
    }
  }

  return {
    fromVenue,
    toVenue,
    fromCount: fromMarkets.length,
    toCount: toMarkets.length,
    entityOverlap,
  };
}

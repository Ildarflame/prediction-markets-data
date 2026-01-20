/**
 * crypto:overlap - Cross-venue overlap report for crypto markets (v2.5.0)
 *
 * Shows how many markets exist on both venues for each entity and settleDate
 */

import { type Venue } from '@data-module/core';
import { getClient, MarketRepository } from '@data-module/db';
import {
  CRYPTO_ENTITIES_V1,
  fetchEligibleCryptoMarkets,
  collectCryptoSettleDates,
  collectCryptoSamplesByEntity,
} from '../matching/index.js';

export interface CryptoOverlapOptions {
  fromVenue: Venue;
  toVenue: Venue;
  lookbackHours?: number;
  limit?: number;
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
  } = options;

  console.log(`\n${'='.repeat(80)}`);
  console.log(`[crypto:overlap] ${fromVenue} → ${toVenue}`);
  console.log(`${'='.repeat(80)}`);
  console.log(`Lookback: ${lookbackHours}h | Limit: ${limit}`);
  console.log(`${'='.repeat(80)}\n`);

  const prisma = getClient();
  const marketRepo = new MarketRepository(prisma);

  // Fetch from both venues
  console.log(`Fetching ${fromVenue} markets...`);
  const { markets: fromMarkets, stats: fromStats } = await fetchEligibleCryptoMarkets(marketRepo, {
    venue: fromVenue,
    lookbackHours,
    limit,
    entities: CRYPTO_ENTITIES_V1,
  });
  console.log(`  Total: ${fromStats.total} → After filters: ${fromMarkets.length} (${fromStats.withCryptoEntity} with entity)`);

  console.log(`Fetching ${toVenue} markets...`);
  const { markets: toMarkets, stats: toStats } = await fetchEligibleCryptoMarkets(marketRepo, {
    venue: toVenue,
    lookbackHours,
    limit,
    entities: CRYPTO_ENTITIES_V1,
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

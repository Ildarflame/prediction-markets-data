/**
 * Macro Period Overlap Report (v2.4.2)
 *
 * Shows period overlap statistics for each macro entity between venues.
 * Uses the SAME pipeline as suggest-matches --topic macro for consistency.
 */

import type { Venue as CoreVenue } from '@data-module/core';
import { getClient, MarketRepository } from '@data-module/db';
import {
  fetchEligibleMacroMarkets,
  collectMacroPeriods,
  collectSamplesByEntity,
  type FetchMacroMarketsStats,
} from '../matching/index.js';

export interface MacroOverlapOptions {
  fromVenue: CoreVenue;
  toVenue: CoreVenue;
  lookbackHours?: number;
  limitLeft?: number;
  limitRight?: number;
  macroMinYear?: number;
  macroMaxYear?: number;
  sampleCount?: number;
}

interface PeriodStats {
  leftPeriods: Set<string>;
  rightPeriods: Set<string>;
  overlapPeriods: Set<string>;
  leftOnlyPeriods: Set<string>;
  rightOnlyPeriods: Set<string>;
}

/**
 * Print pipeline stats
 */
function printPipelineStats(venue: string, stats: FetchMacroMarketsStats): void {
  console.log(`[macro-overlap] ${venue}: ${stats.total} -> ${stats.afterKeywordFilter} (kw) -> ${stats.afterSportsFilter} (sports) -> ${stats.afterTopicFilter} (topic) -> ${stats.afterYearFilter} (year)`);
  if (stats.excludedYearLow > 0 || stats.excludedYearHigh > 0 || stats.excludedNoYear > 0) {
    console.log(`[macro-overlap]   year filter: excluded ${stats.excludedYearLow} (low), ${stats.excludedYearHigh} (high), ${stats.excludedNoYear} (no year)`);
  }
  console.log(`[macro-overlap]   with macro entity: ${stats.withMacroEntity}, with period: ${stats.withPeriod}`);
}

/**
 * Run macro period overlap report
 */
export async function runMacroOverlap(options: MacroOverlapOptions): Promise<void> {
  const {
    fromVenue,
    toVenue,
    lookbackHours = 24, // Match suggest-matches default
    limitLeft = 2000,   // Match suggest-matches default
    limitRight = 20000, // Match suggest-matches default
    macroMinYear,
    macroMaxYear,
    sampleCount = 0,
  } = options;

  // Defaults for year window
  const currentYear = new Date().getFullYear();
  const minYear = macroMinYear ?? currentYear - 1;
  const maxYear = macroMaxYear ?? currentYear + 1;

  const prisma = getClient();
  const marketRepo = new MarketRepository(prisma);

  console.log(`\n[macro-overlap] Period Overlap Report v2.4.2: ${fromVenue} <-> ${toVenue}`);
  console.log(`[macro-overlap] Year window: ${minYear}-${maxYear}`);
  console.log(`[macro-overlap] Lookback: ${lookbackHours}h, limits: left=${limitLeft}, right=${limitRight}`);
  console.log(`[macro-overlap] Using unified pipeline (same as suggest-matches --topic macro)`);

  // Fetch markets using unified pipeline
  console.log(`\n[macro-overlap] Fetching macro markets from ${fromVenue}...`);
  const { markets: leftMarkets, stats: leftStats } = await fetchEligibleMacroMarkets(marketRepo, {
    venue: fromVenue,
    lookbackHours,
    limit: limitLeft,
    macroMinYear: minYear,
    macroMaxYear: maxYear,
  });
  printPipelineStats(fromVenue, leftStats);

  console.log(`\n[macro-overlap] Fetching macro markets from ${toVenue}...`);
  const { markets: rightMarkets, stats: rightStats } = await fetchEligibleMacroMarkets(marketRepo, {
    venue: toVenue,
    lookbackHours,
    limit: limitRight,
    macroMinYear: minYear,
    macroMaxYear: maxYear,
  });
  printPipelineStats(toVenue, rightStats);

  // Collect macro periods using unified function
  console.log(`\n[macro-overlap] Collecting macro entity periods...`);
  const leftEntityPeriods = collectMacroPeriods(leftMarkets);
  const rightEntityPeriods = collectMacroPeriods(rightMarkets);

  // Get all unique entities
  const allEntities = new Set([
    ...leftEntityPeriods.keys(),
    ...rightEntityPeriods.keys(),
  ]);
  const sortedEntities = Array.from(allEntities).sort();

  if (sortedEntities.length === 0) {
    console.log(`\n[macro-overlap] No macro entities found in either venue.`);
    console.log(`[macro-overlap] Left markets with entity: ${leftStats.withMacroEntity}/${leftMarkets.length}`);
    console.log(`[macro-overlap] Right markets with entity: ${rightStats.withMacroEntity}/${rightMarkets.length}`);
    return;
  }

  // Calculate stats for each entity
  const entityStats = new Map<string, PeriodStats>();

  for (const entity of sortedEntities) {
    const leftPeriods = leftEntityPeriods.get(entity) || new Set<string>();
    const rightPeriods = rightEntityPeriods.get(entity) || new Set<string>();

    const overlapPeriods = new Set<string>();
    const leftOnlyPeriods = new Set<string>();
    const rightOnlyPeriods = new Set<string>();

    for (const p of leftPeriods) {
      if (rightPeriods.has(p)) {
        overlapPeriods.add(p);
      } else {
        leftOnlyPeriods.add(p);
      }
    }

    for (const p of rightPeriods) {
      if (!leftPeriods.has(p)) {
        rightOnlyPeriods.add(p);
      }
    }

    entityStats.set(entity, {
      leftPeriods,
      rightPeriods,
      overlapPeriods,
      leftOnlyPeriods,
      rightOnlyPeriods,
    });
  }

  // Count markets per entity
  const leftMarketsByEntity = new Map<string, number>();
  const rightMarketsByEntity = new Map<string, number>();

  for (const { signals } of leftMarkets) {
    for (const entity of signals.entities) {
      leftMarketsByEntity.set(entity, (leftMarketsByEntity.get(entity) || 0) + 1);
    }
  }
  for (const { signals } of rightMarkets) {
    for (const entity of signals.entities) {
      rightMarketsByEntity.set(entity, (rightMarketsByEntity.get(entity) || 0) + 1);
    }
  }

  // Print summary table
  console.log(`\n${'Entity'.padEnd(15)} | ${'L-mkts'.padStart(7)} | ${'R-mkts'.padStart(7)} | ${'L-pers'.padStart(7)} | ${'R-pers'.padStart(7)} | ${'Overlap'.padStart(7)} | ${'L-only'.padStart(7)} | ${'R-only'.padStart(7)}`);
  console.log('-'.repeat(90));

  for (const entity of sortedEntities) {
    const stats = entityStats.get(entity)!;
    const leftMkts = leftMarketsByEntity.get(entity) || 0;
    const rightMkts = rightMarketsByEntity.get(entity) || 0;
    console.log(
      `${entity.padEnd(15)} | ${String(leftMkts).padStart(7)} | ${String(rightMkts).padStart(7)} | ${String(stats.leftPeriods.size).padStart(7)} | ${String(stats.rightPeriods.size).padStart(7)} | ${String(stats.overlapPeriods.size).padStart(7)} | ${String(stats.leftOnlyPeriods.size).padStart(7)} | ${String(stats.rightOnlyPeriods.size).padStart(7)}`
    );
  }
  console.log('-'.repeat(90));

  // Print details for each entity
  for (const entity of sortedEntities) {
    const stats = entityStats.get(entity)!;

    console.log(`\n=== ${entity} ===`);

    if (stats.overlapPeriods.size > 0) {
      const overlap = Array.from(stats.overlapPeriods).sort().slice(0, 10);
      console.log(`  Overlap (${stats.overlapPeriods.size}): ${overlap.join(', ')}${stats.overlapPeriods.size > 10 ? '...' : ''}`);
    } else {
      console.log(`  Overlap: NONE`);
    }

    if (stats.leftOnlyPeriods.size > 0) {
      const leftOnly = Array.from(stats.leftOnlyPeriods).sort().slice(0, 10);
      console.log(`  ${fromVenue}-only (${stats.leftOnlyPeriods.size}): ${leftOnly.join(', ')}${stats.leftOnlyPeriods.size > 10 ? '...' : ''}`);
    }

    if (stats.rightOnlyPeriods.size > 0) {
      const rightOnly = Array.from(stats.rightOnlyPeriods).sort().slice(0, 10);
      console.log(`  ${toVenue}-only (${stats.rightOnlyPeriods.size}): ${rightOnly.join(', ')}${stats.rightOnlyPeriods.size > 10 ? '...' : ''}`);
    }
  }

  // Print sample markets if requested
  if (sampleCount > 0) {
    console.log(`\n[macro-overlap] Sample markets (--sample ${sampleCount}):`);

    const leftSamples = collectSamplesByEntity(leftMarkets, sampleCount);
    const rightSamples = collectSamplesByEntity(rightMarkets, sampleCount);

    for (const entity of sortedEntities) {
      console.log(`\n--- ${entity} ---`);

      const leftList = leftSamples.get(entity) || [];
      if (leftList.length > 0) {
        console.log(`  ${fromVenue}:`);
        for (const s of leftList) {
          console.log(`    [${s.period || 'no-period'}] ID=${s.id} "${s.title.substring(0, 60)}${s.title.length > 60 ? '...' : ''}"`);
        }
      } else {
        console.log(`  ${fromVenue}: (none)`);
      }

      const rightList = rightSamples.get(entity) || [];
      if (rightList.length > 0) {
        console.log(`  ${toVenue}:`);
        for (const s of rightList) {
          console.log(`    [${s.period || 'no-period'}] ID=${s.id} "${s.title.substring(0, 60)}${s.title.length > 60 ? '...' : ''}"`);
        }
      } else {
        console.log(`  ${toVenue}: (none)`);
      }
    }
  }

  console.log(`\n[macro-overlap] Report complete.`);
}

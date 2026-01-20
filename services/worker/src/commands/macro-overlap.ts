/**
 * Macro Period Overlap Report (v2.4.1)
 *
 * Shows period overlap statistics for each macro entity between venues.
 * Helps identify why match rate might be low (e.g., no overlapping periods).
 */

import type { Venue as CoreVenue } from '@data-module/core';
import {
  buildFingerprint,
  extractPeriod,
  type MacroPeriod,
} from '@data-module/core';
import {
  getClient,
  MarketRepository,
  type Venue,
  type EligibleMarket,
} from '@data-module/db';

export interface MacroOverlapOptions {
  fromVenue: CoreVenue;
  toVenue: CoreVenue;
  lookbackHours?: number;
  limitLeft?: number;
  limitRight?: number;
  macroMinYear?: number;
  macroMaxYear?: number;
}

interface PeriodStats {
  leftPeriods: Set<string>;
  rightPeriods: Set<string>;
  overlapPeriods: Set<string>;
  leftOnlyPeriods: Set<string>;
  rightOnlyPeriods: Set<string>;
}

/**
 * Build a period key string from a MacroPeriod
 */
function buildPeriodKey(period: MacroPeriod): string | null {
  if (!period.type || !period.year) return null;

  if (period.type === 'month' && period.month) {
    return `${period.year}-${String(period.month).padStart(2, '0')}`;
  } else if (period.type === 'quarter' && period.quarter) {
    return `${period.year}-Q${period.quarter}`;
  } else if (period.type === 'year') {
    return `${period.year}`;
  }
  return null;
}

/**
 * Collect macro entity -> periods from a list of markets
 */
function collectMacroPeriods(
  markets: EligibleMarket[],
  minYear?: number,
  maxYear?: number
): Map<string, Set<string>> {
  const entityPeriods = new Map<string, Set<string>>();

  for (const market of markets) {
    const fingerprint = buildFingerprint(market.title, market.closeTime, { metadata: market.metadata });

    if (!fingerprint.macroEntities?.size) continue;

    const period = fingerprint.period || extractPeriod(market.title, market.closeTime);
    const periodKey = buildPeriodKey(period);

    // Skip if no period or outside year window
    if (!periodKey) continue;
    if (period.year && minYear && period.year < minYear) continue;
    if (period.year && maxYear && period.year > maxYear) continue;

    for (const entity of fingerprint.macroEntities) {
      if (!entityPeriods.has(entity)) {
        entityPeriods.set(entity, new Set());
      }
      entityPeriods.get(entity)!.add(periodKey);
    }
  }

  return entityPeriods;
}

/**
 * Run macro period overlap report
 */
export async function runMacroOverlap(options: MacroOverlapOptions): Promise<void> {
  const {
    fromVenue,
    toVenue,
    lookbackHours = 720, // 30 days default for broader view
    limitLeft = 10000,
    limitRight = 50000,
    macroMinYear,
    macroMaxYear,
  } = options;

  // Defaults for year window
  const currentYear = new Date().getFullYear();
  const minYear = macroMinYear ?? currentYear - 1;
  const maxYear = macroMaxYear ?? currentYear + 1;

  const prisma = getClient();
  const marketRepo = new MarketRepository(prisma);

  console.log(`\n[macro-overlap] Period Overlap Report: ${fromVenue} <-> ${toVenue}`);
  console.log(`[macro-overlap] Year window: ${minYear}-${maxYear}`);
  console.log(`[macro-overlap] Lookback: ${lookbackHours}h, limits: left=${limitLeft}, right=${limitRight}`);

  // Fetch markets from both venues
  console.log(`\n[macro-overlap] Fetching markets from ${fromVenue}...`);
  const leftMarkets = await marketRepo.listEligibleMarkets(fromVenue as Venue, {
    lookbackHours,
    limit: limitLeft,
  });
  console.log(`[macro-overlap] ${fromVenue}: ${leftMarkets.length} markets`);

  console.log(`[macro-overlap] Fetching markets from ${toVenue}...`);
  const rightMarkets = await marketRepo.listEligibleMarkets(toVenue as Venue, {
    lookbackHours,
    limit: limitRight,
  });
  console.log(`[macro-overlap] ${toVenue}: ${rightMarkets.length} markets`);

  // Collect macro periods
  console.log(`\n[macro-overlap] Collecting macro entity periods...`);
  const leftEntityPeriods = collectMacroPeriods(leftMarkets, minYear, maxYear);
  const rightEntityPeriods = collectMacroPeriods(rightMarkets, minYear, maxYear);

  // Get all unique entities
  const allEntities = new Set([
    ...leftEntityPeriods.keys(),
    ...rightEntityPeriods.keys(),
  ]);
  const sortedEntities = Array.from(allEntities).sort();

  if (sortedEntities.length === 0) {
    console.log(`\n[macro-overlap] No macro entities found in either venue.`);
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

  // Print summary table
  console.log(`\n${'Entity'.padEnd(15)} | ${'Left'.padStart(6)} | ${'Right'.padStart(6)} | ${'Overlap'.padStart(7)} | ${'L-only'.padStart(7)} | ${'R-only'.padStart(7)}`);
  console.log('-'.repeat(70));

  for (const entity of sortedEntities) {
    const stats = entityStats.get(entity)!;
    console.log(
      `${entity.padEnd(15)} | ${String(stats.leftPeriods.size).padStart(6)} | ${String(stats.rightPeriods.size).padStart(6)} | ${String(stats.overlapPeriods.size).padStart(7)} | ${String(stats.leftOnlyPeriods.size).padStart(7)} | ${String(stats.rightOnlyPeriods.size).padStart(7)}`
    );
  }
  console.log('-'.repeat(70));

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

  console.log(`\n[macro-overlap] Report complete.`);
}

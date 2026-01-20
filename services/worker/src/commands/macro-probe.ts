/**
 * Macro Probe Command (v2.4.2)
 *
 * Diagnoses whether a macro entity (e.g., GDP) is missing from data
 * or just not being detected by the extractor.
 */

import type { Venue as CoreVenue } from '@data-module/core';
import { buildFingerprint } from '@data-module/core';
import {
  getClient,
  type Venue,
} from '@data-module/db';

export interface MacroProbeOptions {
  venue: CoreVenue;
  entity: string;
  lookbackHours?: number;
  limit?: number;
  macroMinYear?: number;
  macroMaxYear?: number;
}

/**
 * Entity-specific search patterns for probing
 * These are patterns that SHOULD match the entity but might be missed by the extractor
 */
const ENTITY_SEARCH_PATTERNS: Record<string, string[]> = {
  GDP: [
    '%gdp%',
    '%gross domestic%',
    '%economic growth%',
  ],
  CPI: [
    '%cpi%',
    '%consumer price%',
    '%inflation%',
  ],
  UNEMPLOYMENT: [
    '%unemployment%',
    '%jobless%',
    '%labor market%',
  ],
  FED_RATE: [
    '%fed%rate%',
    '%federal%rate%',
    '%interest rate%',
    '%fomc%',
  ],
  NFP: [
    '%nonfarm%',
    '%non-farm%',
    '%payrolls%',
  ],
  PCE: [
    '%pce%',
    '%personal consumption%',
  ],
  PPI: [
    '%ppi%',
    '%producer price%',
  ],
};

/**
 * Run macro probe to diagnose entity detection issues
 */
export async function runMacroProbe(options: MacroProbeOptions): Promise<void> {
  const {
    venue,
    entity,
    lookbackHours = 720, // 30 days for broader search
    limit = 100,
    macroMinYear,
    macroMaxYear,
  } = options;

  const entityUpper = entity.toUpperCase();
  const patterns = ENTITY_SEARCH_PATTERNS[entityUpper] || [`%${entity.toLowerCase()}%`];

  const currentYear = new Date().getFullYear();
  const minYear = macroMinYear ?? currentYear - 1;
  const maxYear = macroMaxYear ?? currentYear + 1;

  const prisma = getClient();

  console.log(`\n[macro-probe] Probing ${entityUpper} on ${venue}`);
  console.log(`[macro-probe] Year window: ${minYear}-${maxYear}`);
  console.log(`[macro-probe] Lookback: ${lookbackHours}h, limit: ${limit}`);
  console.log(`[macro-probe] Search patterns: ${patterns.join(', ')}`);

  // Build the cutoff date
  const cutoffDate = new Date();
  cutoffDate.setHours(cutoffDate.getHours() - lookbackHours);

  // Build OR conditions for title search
  const titleConditions = patterns.map(p => ({
    title: { contains: p.replace(/%/g, ''), mode: 'insensitive' as const },
  }));

  // Query markets by title patterns
  console.log(`\n[macro-probe] Searching for markets by title patterns...`);

  const foundByTitle = await prisma.market.findMany({
    where: {
      venue: venue as Venue,
      closeTime: { gte: cutoffDate },
      OR: titleConditions,
    },
    select: {
      id: true,
      title: true,
      closeTime: true,
      metadata: true,
    },
    orderBy: { closeTime: 'desc' },
    take: limit,
  });

  console.log(`[macro-probe] Found by title: ${foundByTitle.length} markets`);

  if (foundByTitle.length === 0) {
    console.log(`\n[macro-probe] RESULT: No ${entityUpper} markets found in ${venue} data.`);
    console.log(`[macro-probe] This suggests ${venue} either:`);
    console.log(`  1. Does not have ${entityUpper} markets`);
    console.log(`  2. Uses different terminology (check search patterns)`);
    console.log(`  3. Markets are outside the lookback window (${lookbackHours}h)`);
    return;
  }

  // Show sample titles found
  console.log(`\n[macro-probe] Sample titles found by search:`);
  const samplesToShow = Math.min(10, foundByTitle.length);
  for (let i = 0; i < samplesToShow; i++) {
    const m = foundByTitle[i];
    const closeDate = m.closeTime ? m.closeTime.toISOString().split('T')[0] : 'N/A';
    console.log(`  [${closeDate}] ID=${m.id} "${m.title.substring(0, 70)}${m.title.length > 70 ? '...' : ''}"`);
  }
  if (foundByTitle.length > samplesToShow) {
    console.log(`  ... and ${foundByTitle.length - samplesToShow} more`);
  }

  // Run extractor on found markets
  console.log(`\n[macro-probe] Running extractor on found markets...`);

  let detectedCount = 0;
  let notDetectedCount = 0;
  const detected: Array<{ id: number; title: string; entities: string[] }> = [];
  const notDetected: Array<{ id: number; title: string; entities: string[] }> = [];

  for (const market of foundByTitle) {
    const fingerprint = buildFingerprint(market.title, market.closeTime, { metadata: market.metadata as Record<string, unknown> });
    const extractedEntities = fingerprint.macroEntities ? Array.from(fingerprint.macroEntities) : [];

    // Check if target entity was detected
    if (extractedEntities.includes(entityUpper)) {
      detectedCount++;
      if (detected.length < 5) {
        detected.push({ id: market.id, title: market.title, entities: extractedEntities });
      }
    } else {
      notDetectedCount++;
      if (notDetected.length < 10) {
        notDetected.push({ id: market.id, title: market.title, entities: extractedEntities });
      }
    }
  }

  const detectionRate = ((detectedCount / foundByTitle.length) * 100).toFixed(1);
  console.log(`\n[macro-probe] Extractor detection: ${detectedCount}/${foundByTitle.length} (${detectionRate}%)`);

  if (detected.length > 0) {
    console.log(`\n[macro-probe] Markets correctly detected as ${entityUpper}:`);
    for (const m of detected) {
      console.log(`  ID=${m.id} [${m.entities.join(',')}] "${m.title.substring(0, 60)}${m.title.length > 60 ? '...' : ''}"`);
    }
  }

  if (notDetected.length > 0) {
    console.log(`\n[macro-probe] Markets NOT detected as ${entityUpper} (need rule update?):`);
    for (const m of notDetected) {
      const entitiesStr = m.entities.length > 0 ? m.entities.join(',') : 'none';
      console.log(`  ID=${m.id} [${entitiesStr}] "${m.title.substring(0, 60)}${m.title.length > 60 ? '...' : ''}"`);
    }
  }

  // Summary
  console.log(`\n[macro-probe] SUMMARY for ${entityUpper} on ${venue}:`);
  if (detectedCount === 0 && foundByTitle.length > 0) {
    console.log(`  STATUS: EXTRACTION ISSUE`);
    console.log(`  Found ${foundByTitle.length} markets by title, but 0 detected by extractor.`);
    console.log(`  ACTION: Update macro entity extraction rules for ${entityUpper}.`);
  } else if (detectedCount > 0 && notDetectedCount > 0) {
    console.log(`  STATUS: PARTIAL DETECTION`);
    console.log(`  ${detectedCount}/${foundByTitle.length} markets detected (${detectionRate}%).`);
    console.log(`  ACTION: Check missed titles above - may need additional patterns.`);
  } else if (detectedCount === foundByTitle.length) {
    console.log(`  STATUS: OK`);
    console.log(`  All ${detectedCount} markets correctly detected as ${entityUpper}.`);
  }

  console.log(`\n[macro-probe] Probe complete.`);
}

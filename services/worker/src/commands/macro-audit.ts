/**
 * macro:audit - Fact-check macro entity detection in DB (v2.4.6)
 *
 * Purpose: Diagnose why certain macro entities show 0 matches
 * by comparing DB keyword scan vs extractor detection
 */

import { type Venue } from '@data-module/core';
import {
  tokenizeForEntities,
  extractMacroEntities,
} from '@data-module/core';
import { getClient, type Prisma } from '@data-module/db';

// Keyword patterns for DB scan (ILIKE patterns)
const ENTITY_KEYWORDS: Record<string, string[]> = {
  NFP: [
    '%nfp%',
    '%nonfarm%',
    '%non-farm%',
    '%payroll%',
    '%jobs added%',
    '%jobs report%',
    '%employment situation%',
  ],
  JOBLESS_CLAIMS: [
    '%jobless%claim%',
    '%initial claim%',
    '%unemployment claim%',
    '%weekly claim%',
    '%continuing claim%',
  ],
  PMI: [
    '%pmi%',
    '%purchasing manager%',
    '%ism manufacturing%',
    '%ism services%',
  ],
  PCE: [
    '%pce%',
    '%personal consumption%',
    '%core pce%',
  ],
  CPI: [
    '%cpi%',
    '%consumer price%',
    '%inflation%',
  ],
  GDP: [
    '%gdp%',
    '%gross domestic%',
  ],
  UNEMPLOYMENT_RATE: [
    '%unemployment rate%',
    '%jobless rate%',
    '%unemployment%',
  ],
  FED_RATE: [
    '%fed rate%',
    '%fed fund%',
    '%federal fund%',
    '%rate cut%',
    '%rate hike%',
    '%interest rate%',
  ],
  FOMC: [
    '%fomc%',
    '%federal reserve%',
    '%fed meeting%',
  ],
};

export interface MacroAuditOptions {
  venue: Venue;
  entity: string;
  limit?: number;
}

export interface MacroAuditResult {
  status: 'OK' | 'EXTRACTION_ISSUE' | 'INGESTION_OR_FILTERING';
  foundByKeywords: number;
  detectedAsEntity: number;
  detectionRate: number;
  missedTitles: string[];
}

/**
 * Run macro audit - fact check entity detection in DB
 */
export async function runMacroAudit(options: MacroAuditOptions): Promise<MacroAuditResult> {
  const { venue, entity, limit = 200 } = options;
  const entityUpper = entity.toUpperCase();

  console.log(`\n[macro:audit] FACT CHECK: ${entityUpper} on ${venue}`);
  console.log(`${'='.repeat(60)}\n`);

  const keywords = ENTITY_KEYWORDS[entityUpper];
  if (!keywords) {
    console.log(`[ERROR] Unknown entity: ${entityUpper}`);
    console.log(`[INFO] Supported: ${Object.keys(ENTITY_KEYWORDS).join(', ')}`);
    return {
      status: 'OK',
      foundByKeywords: 0,
      detectedAsEntity: 0,
      detectionRate: 0,
      missedTitles: [],
    };
  }

  const prisma = getClient();

  // STEP 1: DB keyword scan (ILIKE)
  console.log(`[STEP 1] DB Keyword Scan (ILIKE patterns)`);
  console.log(`Patterns: ${keywords.slice(0, 3).join(', ')}...`);

  // Build OR conditions for all keywords
  const orConditions: Prisma.MarketWhereInput[] = keywords.map(kw => ({
    title: { contains: kw.replace(/%/g, ''), mode: 'insensitive' as const },
  }));

  const foundMarkets = await prisma.market.findMany({
    where: {
      venue,
      OR: orConditions,
    },
    select: {
      id: true,
      title: true,
      closeTime: true,
    },
    take: limit,
    orderBy: { closeTime: 'desc' },
  });

  const foundByKeywords = foundMarkets.length;
  console.log(`\n>>> found_by_keywords: ${foundByKeywords}`);

  if (foundByKeywords === 0) {
    console.log(`\n[VERDICT] STATUS=INGESTION_OR_FILTERING`);
    console.log(`  No markets found with keywords in DB.`);
    console.log(`  Possible causes:`);
    console.log(`    1. Markets not ingested yet`);
    console.log(`    2. Filtered out by eligibility rules`);
    console.log(`    3. Different terminology on this venue`);
    return {
      status: 'INGESTION_OR_FILTERING',
      foundByKeywords: 0,
      detectedAsEntity: 0,
      detectionRate: 0,
      missedTitles: [],
    };
  }

  // Print sample titles
  console.log(`\n[SAMPLE] Top ${Math.min(20, foundByKeywords)} titles from DB:`);
  for (let i = 0; i < Math.min(20, foundByKeywords); i++) {
    const m = foundMarkets[i];
    console.log(`  [${m.id}] ${m.title.slice(0, 70)}${m.title.length > 70 ? '...' : ''}`);
  }

  // STEP 2: Run extractor on found markets
  console.log(`\n[STEP 2] Extractor Detection`);

  let detectedCount = 0;
  const missedTitles: string[] = [];

  for (const market of foundMarkets) {
    const tokens = tokenizeForEntities(market.title);
    const macroEntities = extractMacroEntities(tokens, market.title.toLowerCase());

    // Check if target entity detected
    if (macroEntities.has(entityUpper)) {
      detectedCount++;
    } else {
      missedTitles.push(market.title);
    }
  }

  const detectionRate = foundByKeywords > 0 ? (detectedCount / foundByKeywords) * 100 : 0;

  console.log(`\n>>> detected_as_entity: ${detectedCount}`);
  console.log(`>>> detection_rate: ${detectionRate.toFixed(1)}%`);

  // Print missed titles
  if (missedTitles.length > 0) {
    console.log(`\n[MISSED] Top ${Math.min(20, missedTitles.length)} titles where keyword found but extractor missed:`);
    for (let i = 0; i < Math.min(20, missedTitles.length); i++) {
      const title = missedTitles[i];
      // Show what extractor DID find
      const tokens = tokenizeForEntities(title);
      const found = extractMacroEntities(tokens, title.toLowerCase());
      const foundStr = found.size > 0 ? `[found: ${Array.from(found).join(',')}]` : '[found: NONE]';
      console.log(`  ${foundStr} ${title.slice(0, 60)}${title.length > 60 ? '...' : ''}`);
    }
  }

  // STEP 3: Verdict
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[VERDICT]`);

  let status: 'OK' | 'EXTRACTION_ISSUE' | 'INGESTION_OR_FILTERING';

  if (foundByKeywords > 50 && detectionRate < 30) {
    status = 'EXTRACTION_ISSUE';
    console.log(`  STATUS=EXTRACTION_ISSUE`);
    console.log(`  Keywords found ${foundByKeywords} markets, but extractor only detected ${detectionRate.toFixed(1)}%`);
    console.log(`  ACTION: Need to expand extractor aliases/patterns for ${entityUpper}`);
  } else if (foundByKeywords < 5) {
    status = 'INGESTION_OR_FILTERING';
    console.log(`  STATUS=INGESTION_OR_FILTERING`);
    console.log(`  Very few markets (${foundByKeywords}) found in DB with keywords`);
    console.log(`  ACTION: Check if venue has these markets, or if they're filtered`);
  } else if (detectionRate >= 70) {
    status = 'OK';
    console.log(`  STATUS=OK`);
    console.log(`  Found ${foundByKeywords} markets, detection rate ${detectionRate.toFixed(1)}% is good`);
  } else {
    status = 'EXTRACTION_ISSUE';
    console.log(`  STATUS=EXTRACTION_ISSUE (partial)`);
    console.log(`  Detection rate ${detectionRate.toFixed(1)}% could be improved`);
    console.log(`  ACTION: Review missed patterns and expand extractor`);
  }

  console.log(`\n[macro:audit] Complete.`);

  return {
    status,
    foundByKeywords,
    detectedAsEntity: detectedCount,
    detectionRate,
    missedTitles: missedTitles.slice(0, 50),
  };
}

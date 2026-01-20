/**
 * macro:audit - Fact-check macro entity detection (v2.4.7)
 *
 * Two-phase audit:
 * A) DB FACT SCAN - raw keyword search without eligibility filters
 * B) PIPELINE WINDOW SCAN - what actually participates in matching
 *
 * Provides ironclad diagnostics with clear verdicts.
 */

import { type Venue } from '@data-module/core';
import {
  tokenizeForEntities,
  extractMacroEntities,
  extractPeriod,
  type MacroPeriod,
} from '@data-module/core';
import { getClient, Prisma, MarketRepository, type Venue as DBVenue } from '@data-module/db';

// ============================================================
// STEP 1: Audit Contract - Verdict Enum
// ============================================================

/**
 * Audit verdict - ironclad status for macro entity presence
 */
export enum AuditVerdict {
  /** Entity found in current window, extractor works */
  PRESENT_IN_WINDOW = 'PRESENT_IN_WINDOW',
  /** Entity exists in DB but outside current window/filters */
  PRESENT_OUTSIDE_WINDOW = 'PRESENT_OUTSIDE_WINDOW',
  /** Entity exists in DB but extractor fails to detect most */
  PRESENT_BUT_EXTRACTION_ISSUE = 'PRESENT_BUT_EXTRACTION_ISSUE',
  /** No data found in DB at all (by keywords or metadata) */
  NO_DATA_IN_DB = 'NO_DATA_IN_DB',
  /** Too few samples to make definitive conclusion */
  AMBIGUOUS = 'AMBIGUOUS',
}

/** Human-readable verdict descriptions (exported for use in reports) */
export const VERDICT_DESCRIPTIONS: Record<AuditVerdict, string> = {
  [AuditVerdict.PRESENT_IN_WINDOW]: 'Entity detected in current pipeline window',
  [AuditVerdict.PRESENT_OUTSIDE_WINDOW]: 'Entity exists in DB but not in current window/filters',
  [AuditVerdict.PRESENT_BUT_EXTRACTION_ISSUE]: 'Entity in DB but extractor misses most matches',
  [AuditVerdict.NO_DATA_IN_DB]: 'No markets found in DB with these keywords',
  [AuditVerdict.AMBIGUOUS]: 'Too few samples for definitive conclusion',
};

// ============================================================
// v2.4.9: Word-boundary regex matchers for safe keyword detection
// ============================================================

/**
 * Check if a word appears with word boundaries in text
 * Handles punctuation: "PMI?", "(PMI)", "PMI.", "PMI:" etc.
 */
function hasWordBoundary(text: string, word: string): boolean {
  const regex = new RegExp(`\\b${word}\\b`, 'i');
  return regex.test(text);
}

/**
 * PMI-specific validation using word boundaries
 * Returns true only if:
 * - \bpmi\b appears in text, OR
 * - "purchasing managers index" phrase appears, OR
 * - \bism\b appears AND (\bpmi\b is within 3 tokens OR "purchasing managers index" exists)
 */
function validatePMIMatch(title: string): boolean {
  const lower = title.toLowerCase();

  // Check for explicit PMI with word boundary
  if (hasWordBoundary(lower, 'pmi')) {
    return true;
  }

  // Check for full phrase
  if (lower.includes('purchasing managers index')) {
    return true;
  }

  // Check ISM + context: ISM must be present AND either PMI nearby or full phrase
  if (hasWordBoundary(lower, 'ism')) {
    // ISM is present, check for PMI within reasonable distance or full phrase
    // We already checked full phrase above, so just check if PMI appears at all with boundary
    if (hasWordBoundary(lower, 'pmi')) {
      return true;
    }
  }

  return false;
}

/**
 * Entity-specific post-filter for DB scan results
 * Filters out false positives that pass substring match but fail word-boundary check
 */
function postFilterDBResults(
  entity: string,
  markets: Array<{ id: number; title: string; status: string; closeTime: Date | null; createdAt: Date; metadata: unknown }>,
): typeof markets {
  if (entity === 'PMI') {
    return markets.filter(m => validatePMIMatch(m.title));
  }
  // Other entities can have their own filters added here
  return markets;
}

// ============================================================
// Keyword patterns for DB scan
// ============================================================

const ENTITY_KEYWORDS: Record<string, string[]> = {
  NFP: [
    'nfp', 'nonfarm', 'non-farm', 'payroll', 'payrolls',
    'jobs added', 'jobs report', 'employment situation',
    'add jobs', 'lose jobs',
    'jobs in january', 'jobs in february', 'jobs in march',
    'jobs in april', 'jobs in may', 'jobs in june',
    'jobs in july', 'jobs in august', 'jobs in september',
    'jobs in october', 'jobs in november', 'jobs in december',
  ],
  JOBLESS_CLAIMS: [
    'jobless claims', 'initial claims', 'unemployment claims',
    'weekly claims', 'continuing claims', 'initial jobless',
  ],
  PMI: [
    // v2.4.9: Use broad keywords for DB scan, filter with regex word-boundary post-processing
    // This catches all potential PMI markets, then postFilterDBResults removes false positives
    'pmi', // will be filtered by validatePMIMatch() to exclude "DeepMind" etc.
    'purchasing managers index', // full phrase (not "purchasing manager" singular)
    'ism manufacturing', 'ism services',
  ],
  PCE: [
    'pce', 'personal consumption', 'core pce',
  ],
  CPI: [
    'cpi', 'consumer price', 'inflation',
  ],
  GDP: [
    'gdp', 'gross domestic',
  ],
  UNEMPLOYMENT_RATE: [
    'unemployment rate', 'jobless rate',
  ],
  FED_RATE: [
    // v2.4.8: Require Fed/FOMC context to avoid BOE/BOJ/credit card false positives
    'fed rate', 'fed fund', 'federal fund', 'fed funds',
    'fed cut', 'fed hike', 'fed increases', 'fed decreases',
    'fomc rate', 'fomc cut', 'fomc hike',
    // Generic rate cut/hike only with Fed context (handled by OR in query)
    'fed emergency rate', 'federal reserve rate',
  ],
  FOMC: [
    'fomc', 'federal reserve', 'fed meeting',
  ],
};

// ============================================================
// Options and Result types
// ============================================================

export interface MacroAuditOptions {
  venue: Venue;
  entity: string;
  /** All-time mode: disable lookback for pipeline scan */
  allTime?: boolean;
  /** Include resolved/archived markets in pipeline scan */
  includeResolved?: boolean;
  /** Limit for DB fact scan (default 2000) */
  dbLimit?: number;
  /** Lookback hours for window mode (default 720 = 30 days) */
  lookbackHours?: number;
}

/** Status breakdown counts */
interface StatusBreakdown {
  active: number;
  closed: number;
  resolved: number;
  archived: number;
}

/** DB Fact Scan result */
interface DBFactResult {
  foundTitleCount: number;
  foundMetaCount: number;
  statusBreakdown: StatusBreakdown;
  closeTimeMin: Date | null;
  closeTimeMax: Date | null;
  createdAtMin: Date | null;
  createdAtMax: Date | null;
  sampleNewest: Array<{ id: number; title: string; status: string; closeTime: Date | null }>;
  sampleOldest: Array<{ id: number; title: string; status: string; closeTime: Date | null }>;
}

/** Pipeline Window Scan result */
interface PipelineResult {
  eligibleCount: number;
  detectedCount: number;
  detectionRate: number;
  statusBreakdown: StatusBreakdown;
  periodDistribution: Map<string, number>;
  samplesDetected: Array<{ id: number; title: string; period: MacroPeriod | null }>;
  samplesMissed: Array<{ id: number; title: string; foundEntities: string[] }>;
}

/** Full audit result */
export interface MacroAuditResult {
  verdict: AuditVerdict;
  verdictReason: string;
  mode: 'window' | 'all-time';
  includeResolved: boolean;
  dbFact: DBFactResult;
  pipeline: PipelineResult;
}

// ============================================================
// STEP 2: Two-phase scan implementation
// ============================================================

/**
 * Phase A: DB Fact Scan - raw keyword search without eligibility filters
 * v2.4.9: Added entity parameter for post-filtering (e.g., PMI word-boundary check)
 */
async function runDBFactScan(
  venue: Venue,
  entity: string,
  keywords: string[],
  dbLimit: number,
): Promise<DBFactResult> {
  const prisma = getClient();

  // Build OR conditions for title keywords
  const titleConditions: Prisma.MarketWhereInput[] = keywords.map(kw => ({
    title: { contains: kw, mode: 'insensitive' as const },
  }));

  // Query: all markets matching keywords (no status/time filter)
  // Fetch more than dbLimit to account for post-filtering
  const rawMarkets = await prisma.market.findMany({
    where: {
      venue,
      OR: titleConditions,
    },
    select: {
      id: true,
      title: true,
      status: true,
      closeTime: true,
      createdAt: true,
      metadata: true,
    },
    orderBy: { closeTime: 'desc' },
    take: dbLimit * 2, // Fetch extra for post-filtering
  });

  // v2.4.9: Apply entity-specific post-filtering (e.g., PMI word-boundary)
  const markets = postFilterDBResults(entity, rawMarkets).slice(0, dbLimit);

  // Also check metadata (separate query for count only)
  const metaCount = await prisma.market.count({
    where: {
      venue,
      metadata: { not: Prisma.DbNull },
      OR: keywords.map(kw => ({
        metadata: { path: [], string_contains: kw },
      })),
    },
  });

  // Calculate status breakdown
  const statusBreakdown: StatusBreakdown = { active: 0, closed: 0, resolved: 0, archived: 0 };
  for (const m of markets) {
    statusBreakdown[m.status as keyof StatusBreakdown]++;
  }

  // Find min/max dates
  const closeTimes = markets.map(m => m.closeTime).filter((d): d is Date => d !== null);
  const createdAts = markets.map(m => m.createdAt);

  const closeTimeMin = closeTimes.length > 0 ? new Date(Math.min(...closeTimes.map(d => d.getTime()))) : null;
  const closeTimeMax = closeTimes.length > 0 ? new Date(Math.max(...closeTimes.map(d => d.getTime()))) : null;
  const createdAtMin = createdAts.length > 0 ? new Date(Math.min(...createdAts.map(d => d.getTime()))) : null;
  const createdAtMax = createdAts.length > 0 ? new Date(Math.max(...createdAts.map(d => d.getTime()))) : null;

  // Get samples (newest and oldest by closeTime)
  const sortedByClose = [...markets].sort((a, b) => {
    if (!a.closeTime && !b.closeTime) return 0;
    if (!a.closeTime) return 1;
    if (!b.closeTime) return -1;
    return b.closeTime.getTime() - a.closeTime.getTime();
  });

  const sampleNewest = sortedByClose.slice(0, 20).map(m => ({
    id: m.id,
    title: m.title,
    status: m.status,
    closeTime: m.closeTime,
  }));

  const sampleOldest = sortedByClose.slice(-20).reverse().map(m => ({
    id: m.id,
    title: m.title,
    status: m.status,
    closeTime: m.closeTime,
  }));

  return {
    foundTitleCount: markets.length,
    foundMetaCount: metaCount,
    statusBreakdown,
    closeTimeMin,
    closeTimeMax,
    createdAtMin,
    createdAtMax,
    sampleNewest,
    sampleOldest,
  };
}

/**
 * Phase B: Pipeline Window Scan - what actually participates in matching
 */
async function runPipelineScan(
  venue: Venue,
  entityUpper: string,
  keywords: string[],
  options: { allTime: boolean; includeResolved: boolean; lookbackHours: number; limit: number },
): Promise<PipelineResult> {
  const prisma = getClient();
  const marketRepo = new MarketRepository(prisma);

  // Build status filter
  const statuses: string[] = ['active', 'closed'];
  if (options.includeResolved) {
    statuses.push('resolved', 'archived');
  }

  // Fetch eligible markets (with or without lookback)
  const lookback = options.allTime ? 8760 * 10 : options.lookbackHours; // 10 years for all-time

  const markets = await marketRepo.listEligibleMarkets(venue as DBVenue, {
    lookbackHours: lookback,
    limit: options.limit,
    titleKeywords: keywords,
    orderBy: 'closeTime',
  });

  // Filter by status if needed
  const filteredMarkets = options.includeResolved
    ? markets
    : markets.filter(m => m.status === 'active' || m.status === 'closed');

  // Run extractor on each market
  const samplesDetected: PipelineResult['samplesDetected'] = [];
  const samplesMissed: PipelineResult['samplesMissed'] = [];
  const periodDistribution = new Map<string, number>();
  const statusBreakdown: StatusBreakdown = { active: 0, closed: 0, resolved: 0, archived: 0 };

  let detectedCount = 0;

  for (const market of filteredMarkets) {
    statusBreakdown[market.status as keyof StatusBreakdown]++;

    const tokens = tokenizeForEntities(market.title);
    const macroEntities = extractMacroEntities(tokens, market.title.toLowerCase());
    const period = extractPeriod(market.title, market.closeTime ?? undefined);

    if (macroEntities.has(entityUpper)) {
      detectedCount++;

      // Track period distribution
      const periodKey = period.type
        ? `${period.type}:${period.year || '?'}${period.month ? '-' + period.month : ''}${period.quarter ? '-Q' + period.quarter : ''}`
        : 'unknown';
      periodDistribution.set(periodKey, (periodDistribution.get(periodKey) || 0) + 1);

      if (samplesDetected.length < 20) {
        samplesDetected.push({ id: market.id, title: market.title, period });
      }
    } else {
      // Check if keyword matches but extractor missed
      const titleLower = market.title.toLowerCase();
      const hasKeyword = keywords.some(kw => titleLower.includes(kw.toLowerCase()));
      if (hasKeyword && samplesMissed.length < 20) {
        samplesMissed.push({
          id: market.id,
          title: market.title,
          foundEntities: Array.from(macroEntities),
        });
      }
    }
  }

  const detectionRate = filteredMarkets.length > 0
    ? (detectedCount / filteredMarkets.length) * 100
    : 0;

  return {
    eligibleCount: filteredMarkets.length,
    detectedCount,
    detectionRate,
    statusBreakdown,
    periodDistribution,
    samplesDetected,
    samplesMissed,
  };
}

/**
 * Determine verdict based on DB fact and pipeline results
 */
function determineVerdict(dbFact: DBFactResult, pipeline: PipelineResult): { verdict: AuditVerdict; reason: string } {
  const totalDbFound = dbFact.foundTitleCount + dbFact.foundMetaCount;

  // NO_DATA_IN_DB: nothing found in DB at all
  if (totalDbFound === 0) {
    return {
      verdict: AuditVerdict.NO_DATA_IN_DB,
      reason: 'No markets found in DB with these keywords (title or metadata)',
    };
  }

  // AMBIGUOUS: too few samples
  if (totalDbFound < 5 && pipeline.detectedCount === 0) {
    return {
      verdict: AuditVerdict.AMBIGUOUS,
      reason: `Only ${totalDbFound} markets in DB, 0 detected - need manual review`,
    };
  }

  // PRESENT_IN_WINDOW: entity detected in pipeline
  if (pipeline.detectedCount > 0) {
    if (pipeline.detectionRate >= 70) {
      return {
        verdict: AuditVerdict.PRESENT_IN_WINDOW,
        reason: `${pipeline.detectedCount} detected (${pipeline.detectionRate.toFixed(1)}% rate) - working correctly`,
      };
    } else if (pipeline.detectionRate >= 30) {
      return {
        verdict: AuditVerdict.PRESENT_IN_WINDOW,
        reason: `${pipeline.detectedCount} detected (${pipeline.detectionRate.toFixed(1)}% rate) - partial coverage`,
      };
    } else {
      return {
        verdict: AuditVerdict.PRESENT_BUT_EXTRACTION_ISSUE,
        reason: `Only ${pipeline.detectionRate.toFixed(1)}% detection rate - extractor needs improvement`,
      };
    }
  }

  // PRESENT_OUTSIDE_WINDOW: found in DB but not in pipeline
  if (dbFact.foundTitleCount > 0 && pipeline.eligibleCount === 0) {
    return {
      verdict: AuditVerdict.PRESENT_OUTSIDE_WINDOW,
      reason: `${dbFact.foundTitleCount} in DB but 0 in pipeline window - check lookback/filters`,
    };
  }

  // PRESENT_BUT_EXTRACTION_ISSUE: found in pipeline window but extractor misses all
  if (pipeline.eligibleCount > 0 && pipeline.detectedCount === 0) {
    if (pipeline.samplesMissed.length > 0) {
      return {
        verdict: AuditVerdict.PRESENT_BUT_EXTRACTION_ISSUE,
        reason: `${pipeline.eligibleCount} eligible, 0 detected - extractor misses all matches`,
      };
    } else {
      return {
        verdict: AuditVerdict.PRESENT_OUTSIDE_WINDOW,
        reason: `${pipeline.eligibleCount} eligible but keywords don't match - different terminology?`,
      };
    }
  }

  return {
    verdict: AuditVerdict.AMBIGUOUS,
    reason: 'Unable to determine - need manual review',
  };
}

// ============================================================
// Main audit function
// ============================================================

/**
 * Run macro audit v2.4.7 - two-phase fact check
 */
export async function runMacroAudit(options: MacroAuditOptions): Promise<MacroAuditResult> {
  const {
    venue,
    entity,
    allTime = false,
    includeResolved = false,
    dbLimit = 2000,
    lookbackHours = 720,
  } = options;

  const entityUpper = entity.toUpperCase();
  const mode = allTime ? 'all-time' : 'window';

  console.log(`\n[macro:audit v2.4.7] ${entityUpper} on ${venue}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`MODE: ${mode}, includeResolved=${includeResolved}`);
  console.log(`${'='.repeat(60)}\n`);

  const keywords = ENTITY_KEYWORDS[entityUpper];
  if (!keywords) {
    console.log(`[ERROR] Unknown entity: ${entityUpper}`);
    console.log(`[INFO] Supported: ${Object.keys(ENTITY_KEYWORDS).join(', ')}`);
    const emptyResult: MacroAuditResult = {
      verdict: AuditVerdict.NO_DATA_IN_DB,
      verdictReason: 'Unknown entity',
      mode,
      includeResolved,
      dbFact: {
        foundTitleCount: 0,
        foundMetaCount: 0,
        statusBreakdown: { active: 0, closed: 0, resolved: 0, archived: 0 },
        closeTimeMin: null,
        closeTimeMax: null,
        createdAtMin: null,
        createdAtMax: null,
        sampleNewest: [],
        sampleOldest: [],
      },
      pipeline: {
        eligibleCount: 0,
        detectedCount: 0,
        detectionRate: 0,
        statusBreakdown: { active: 0, closed: 0, resolved: 0, archived: 0 },
        periodDistribution: new Map(),
        samplesDetected: [],
        samplesMissed: [],
      },
    };
    return emptyResult;
  }

  // ============================================================
  // PHASE A: DB Fact Scan
  // ============================================================
  console.log(`[PHASE A] DB FACT SCAN (no eligibility filters)`);
  console.log(`Keywords: ${keywords.slice(0, 4).join(', ')}${keywords.length > 4 ? '...' : ''}`);
  console.log(`DB limit: ${dbLimit}\n`);

  const dbFact = await runDBFactScan(venue, entityUpper, keywords, dbLimit);

  console.log(`>>> found_in_title: ${dbFact.foundTitleCount}`);
  console.log(`>>> found_in_meta:  ${dbFact.foundMetaCount}`);
  console.log(`>>> status: active=${dbFact.statusBreakdown.active}, closed=${dbFact.statusBreakdown.closed}, resolved=${dbFact.statusBreakdown.resolved}, archived=${dbFact.statusBreakdown.archived}`);

  if (dbFact.closeTimeMin && dbFact.closeTimeMax) {
    console.log(`>>> closeTime range: ${dbFact.closeTimeMin.toISOString().slice(0, 10)} to ${dbFact.closeTimeMax.toISOString().slice(0, 10)}`);
  }
  if (dbFact.createdAtMin && dbFact.createdAtMax) {
    console.log(`>>> createdAt range: ${dbFact.createdAtMin.toISOString().slice(0, 10)} to ${dbFact.createdAtMax.toISOString().slice(0, 10)}`);
  }

  if (dbFact.sampleNewest.length > 0) {
    console.log(`\n[DB SAMPLES - NEWEST by closeTime] (top ${Math.min(10, dbFact.sampleNewest.length)}):`);
    for (let i = 0; i < Math.min(10, dbFact.sampleNewest.length); i++) {
      const s = dbFact.sampleNewest[i];
      const dateStr = s.closeTime ? s.closeTime.toISOString().slice(0, 10) : 'no-date';
      console.log(`  [${s.status}] [${dateStr}] ${s.title.slice(0, 55)}${s.title.length > 55 ? '...' : ''}`);
    }
  }

  if (dbFact.sampleOldest.length > 0 && dbFact.foundTitleCount > 10) {
    console.log(`\n[DB SAMPLES - OLDEST by closeTime] (top ${Math.min(5, dbFact.sampleOldest.length)}):`);
    for (let i = 0; i < Math.min(5, dbFact.sampleOldest.length); i++) {
      const s = dbFact.sampleOldest[i];
      const dateStr = s.closeTime ? s.closeTime.toISOString().slice(0, 10) : 'no-date';
      console.log(`  [${s.status}] [${dateStr}] ${s.title.slice(0, 55)}${s.title.length > 55 ? '...' : ''}`);
    }
  }

  // ============================================================
  // PHASE B: Pipeline Window Scan
  // ============================================================
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`[PHASE B] PIPELINE WINDOW SCAN`);
  console.log(`Mode: ${mode}, lookbackHours=${allTime ? 'unlimited' : lookbackHours}, includeResolved=${includeResolved}\n`);

  const pipeline = await runPipelineScan(venue, entityUpper, keywords, {
    allTime,
    includeResolved,
    lookbackHours,
    limit: allTime ? 5000 : 2000,
  });

  console.log(`>>> eligible_count:    ${pipeline.eligibleCount}`);
  console.log(`>>> detected_count:    ${pipeline.detectedCount}`);
  console.log(`>>> detection_rate:    ${pipeline.detectionRate.toFixed(1)}%`);
  console.log(`>>> status: active=${pipeline.statusBreakdown.active}, closed=${pipeline.statusBreakdown.closed}, resolved=${pipeline.statusBreakdown.resolved}`);

  if (pipeline.periodDistribution.size > 0) {
    console.log(`\n[PERIOD DISTRIBUTION] (top 10):`);
    const sortedPeriods = Array.from(pipeline.periodDistribution.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    for (const [period, count] of sortedPeriods) {
      console.log(`  ${period}: ${count}`);
    }
  }

  if (pipeline.samplesDetected.length > 0) {
    console.log(`\n[DETECTED SAMPLES] (top ${Math.min(10, pipeline.samplesDetected.length)}):`);
    for (let i = 0; i < Math.min(10, pipeline.samplesDetected.length); i++) {
      const s = pipeline.samplesDetected[i];
      console.log(`  [${s.id}] ${s.title.slice(0, 60)}${s.title.length > 60 ? '...' : ''}`);
    }
  }

  if (pipeline.samplesMissed.length > 0) {
    console.log(`\n[MISSED SAMPLES - keyword found but extractor missed] (top ${Math.min(10, pipeline.samplesMissed.length)}):`);
    for (let i = 0; i < Math.min(10, pipeline.samplesMissed.length); i++) {
      const s = pipeline.samplesMissed[i];
      const foundStr = s.foundEntities.length > 0 ? `[found: ${s.foundEntities.join(',')}]` : '[found: NONE]';
      console.log(`  ${foundStr} ${s.title.slice(0, 50)}${s.title.length > 50 ? '...' : ''}`);
    }
  }

  // ============================================================
  // VERDICT
  // ============================================================
  const { verdict, reason } = determineVerdict(dbFact, pipeline);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`VERDICT: ${verdict}`);
  console.log(`REASON:  ${reason}`);
  console.log(`${'='.repeat(60)}\n`);

  const prisma = getClient();
  await prisma.$disconnect();

  return {
    verdict,
    verdictReason: reason,
    mode,
    includeResolved,
    dbFact,
    pipeline,
  };
}

// ============================================================
// STEP 5: Audit Pack - batch audit multiple entities
// ============================================================

export interface AuditPackOptions {
  venue: Venue;
  entities?: string[];
  allTime?: boolean;
  includeResolved?: boolean;
}

export interface AuditPackRow {
  entity: string;
  dbFound: number;
  windowEligible: number;
  detected: number;
  verdict: AuditVerdict;
}

/**
 * Run audit pack - batch audit multiple entities with compact output
 */
export async function runAuditPack(options: AuditPackOptions): Promise<AuditPackRow[]> {
  const {
    venue,
    entities = Object.keys(ENTITY_KEYWORDS),
    allTime = false,
    includeResolved = false,
  } = options;

  const mode = allTime ? 'all-time' : 'window';

  console.log(`\n[macro:audit-pack v2.4.7] ${venue}`);
  console.log(`${'='.repeat(70)}`);
  console.log(`MODE: ${mode}, includeResolved=${includeResolved}`);
  console.log(`${'='.repeat(70)}\n`);

  const results: AuditPackRow[] = [];

  // Print header
  console.log(`${'Entity'.padEnd(18)} | ${'DB Found'.padStart(8)} | ${'Eligible'.padStart(8)} | ${'Detected'.padStart(8)} | Verdict`);
  console.log(`${'-'.repeat(18)}-+-${'-'.repeat(8)}-+-${'-'.repeat(8)}-+-${'-'.repeat(8)}-+-${'-'.repeat(25)}`);

  for (const entity of entities) {
    const entityUpper = entity.toUpperCase();
    if (!ENTITY_KEYWORDS[entityUpper]) continue;

    // Run audit silently (suppress console output)
    const originalLog = console.log;
    console.log = () => {}; // Suppress

    try {
      const result = await runMacroAudit({
        venue,
        entity: entityUpper,
        allTime,
        includeResolved,
      });

      const row: AuditPackRow = {
        entity: entityUpper,
        dbFound: result.dbFact.foundTitleCount,
        windowEligible: result.pipeline.eligibleCount,
        detected: result.pipeline.detectedCount,
        verdict: result.verdict,
      };
      results.push(row);

      // Restore and print row
      console.log = originalLog;
      const verdictShort = row.verdict.replace('PRESENT_', '').replace('_', ' ');
      console.log(
        `${row.entity.padEnd(18)} | ${String(row.dbFound).padStart(8)} | ${String(row.windowEligible).padStart(8)} | ${String(row.detected).padStart(8)} | ${verdictShort}`
      );
    } catch (err) {
      console.log = originalLog;
      console.log(`${entityUpper.padEnd(18)} | ${'ERROR'.padStart(8)} | ${'-'.padStart(8)} | ${'-'.padStart(8)} | ERROR`);
    }
  }

  console.log(`${'-'.repeat(70)}`);
  console.log(`\n[macro:audit-pack] Complete.\n`);

  return results;
}

/** Get supported entities */
export function getSupportedEntities(): string[] {
  return Object.keys(ENTITY_KEYWORDS);
}

/**
 * Format availability string - prevents false "venue doesn't have X" claims
 * v2.4.7: Use this instead of raw counts to clarify window vs all-time
 */
export function formatAvailability(
  windowCount: number,
  allTimeCount?: number,
): string {
  if (allTimeCount !== undefined) {
    if (windowCount === 0 && allTimeCount === 0) {
      return '0 in DB (all-time)';
    } else if (windowCount === 0 && allTimeCount > 0) {
      return `0 in window (${allTimeCount} in DB)`;
    } else {
      return `${windowCount} in window`;
    }
  } else {
    // No all-time data available
    if (windowCount === 0) {
      return '0 in window (run --all-time for full scan)';
    } else {
      return `${windowCount} in window`;
    }
  }
}

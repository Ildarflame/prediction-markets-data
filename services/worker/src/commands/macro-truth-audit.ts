/**
 * macro:truth-audit - Ground-truth verification for macro entity presence
 *
 * Verifies whether a venue truly has NO DATA or if it's a filtering/ingestion issue.
 *
 * Three phases:
 * A) DB ALL-TIME SCAN - Raw text search, no eligibility filters, optional include resolved
 * B) ELIGIBLE WINDOW SCAN - Same pipeline as suggest-matches --topic macro
 * C) EXTRACTION SCAN - Run extractor on Phase A samples to verify detection
 *
 * Verdicts:
 * - EXISTS_AND_ELIGIBLE: Found in DB and passes eligibility filters
 * - EXISTS_ALL_TIME_BUT_NOT_ELIGIBLE: Found in DB but filtered out (resolved/window)
 * - EXISTS_BUT_EXTRACTION_ISSUE: Found but extractor doesn't detect
 * - NO_DATA_ALL_TIME: Not found in DB even with broadest search
 * - AMBIGUOUS: DB limit too low, may have more data
 */

import { type Venue } from '@data-module/core';
import {
  tokenizeForEntities,
  extractMacroEntities,
} from '@data-module/core';
import { getClient, Prisma, MarketRepository, type MarketStatus } from '@data-module/db';

// ============================================================
// Verdicts
// ============================================================

export enum TruthVerdict {
  /** Found in DB AND passes eligibility filters */
  EXISTS_AND_ELIGIBLE = 'EXISTS_AND_ELIGIBLE',
  /** Found in DB but filtered out (resolved/archived/outside window) */
  EXISTS_ALL_TIME_BUT_NOT_ELIGIBLE = 'EXISTS_ALL_TIME_BUT_NOT_ELIGIBLE',
  /** Found in DB but extractor doesn't detect the entity */
  EXISTS_BUT_EXTRACTION_ISSUE = 'EXISTS_BUT_EXTRACTION_ISSUE',
  /** Not found in DB even with broadest search */
  NO_DATA_ALL_TIME = 'NO_DATA_ALL_TIME',
  /** DB limit too low, may have more data */
  AMBIGUOUS = 'AMBIGUOUS',
}

export const VERDICT_DESCRIPTIONS: Record<TruthVerdict, string> = {
  [TruthVerdict.EXISTS_AND_ELIGIBLE]: 'Entity found in DB and eligible for matching',
  [TruthVerdict.EXISTS_ALL_TIME_BUT_NOT_ELIGIBLE]: 'Entity in DB but outside eligible window (resolved/archived)',
  [TruthVerdict.EXISTS_BUT_EXTRACTION_ISSUE]: 'Entity in DB but extractor fails to detect',
  [TruthVerdict.NO_DATA_ALL_TIME]: 'No markets found in DB with these keywords (all-time)',
  [TruthVerdict.AMBIGUOUS]: 'DB limit reached - may have more data, increase --db-limit',
};

// ============================================================
// Entity-specific search patterns (very broad for truth audit)
// ============================================================

interface EntitySearchPatterns {
  /** Primary patterns - must match at least one */
  primary: string[];
  /** Secondary patterns - helpful but not required */
  secondary: string[];
  /** Description for logging */
  description: string;
}

const TRUTH_AUDIT_PATTERNS: Record<string, EntitySearchPatterns> = {
  JOBLESS_CLAIMS: {
    primary: ['jobless', 'initial claims', 'unemployment claims', 'weekly claims', 'continuing claims'],
    secondary: ['claims', 'jobless rate'],
    description: 'Jobless/unemployment claims data',
  },
  PMI: {
    primary: ['pmi', 'purchasing manager', 'ism manufacturing', 'ism services', 'ism pmi'],
    secondary: ['purchasing', 'managers index'],
    description: 'Purchasing Managers Index',
  },
  PCE: {
    primary: ['pce', 'personal consumption', 'core pce'],
    secondary: ['consumption expenditure'],
    description: 'Personal Consumption Expenditures',
  },
  CPI: {
    primary: ['cpi', 'consumer price', 'inflation'],
    secondary: ['core cpi', 'headline cpi'],
    description: 'Consumer Price Index',
  },
  NFP: {
    primary: ['nfp', 'nonfarm', 'non-farm', 'payroll', 'jobs added', 'jobs report'],
    secondary: ['employment situation', 'add jobs', 'lose jobs'],
    description: 'Non-Farm Payrolls',
  },
  GDP: {
    primary: ['gdp', 'gross domestic'],
    secondary: ['economic growth'],
    description: 'Gross Domestic Product',
  },
  FED_RATE: {
    primary: ['fed rate', 'federal funds', 'fed fund', 'fomc rate'],
    secondary: ['fed cut', 'fed hike', 'interest rate'],
    description: 'Federal Reserve Interest Rate',
  },
  FOMC: {
    primary: ['fomc', 'federal reserve', 'fed meeting'],
    secondary: ['fed decision'],
    description: 'Federal Open Market Committee',
  },
  UNEMPLOYMENT_RATE: {
    primary: ['unemployment rate', 'jobless rate'],
    secondary: ['unemployment'],
    description: 'Unemployment Rate',
  },
};

// ============================================================
// Options and Result types
// ============================================================

export interface TruthAuditOptions {
  venue: Venue;
  entity: string;
  /** Include resolved/archived markets in all scans */
  includeResolved?: boolean;
  /** DB limit for Phase A (default 5000) */
  dbLimit?: number;
  /** Number of samples to show (default 20) */
  sampleSize?: number;
  /** Lookback hours for eligible window (default 720 = 30 days) */
  lookbackHours?: number;
}

interface MarketSample {
  id: number;
  title: string;
  status: string;
  closeTime: Date | null;
  createdAt: Date;
}

interface PhaseAResult {
  totalFound: number;
  hitDbLimit: boolean;
  byStatus: {
    active: number;
    closed: number;
    resolved: number;
    archived: number;
  };
  closeTimeMin: Date | null;
  closeTimeMax: Date | null;
  createdAtMin: Date | null;
  createdAtMax: Date | null;
  samples: MarketSample[];
}

interface PhaseBResult {
  eligibleCount: number;
  byStatus: {
    active: number;
    closed: number;
  };
  samples: MarketSample[];
}

interface PhaseCResult {
  totalScanned: number;
  detected: number;
  missed: number;
  detectionRate: number;
  samplesDetected: Array<MarketSample & { extractedEntities: string[] }>;
  samplesMissed: Array<MarketSample & { extractedEntities: string[] }>;
}

export interface TruthAuditResult {
  entity: string;
  venue: Venue;
  verdict: TruthVerdict;
  verdictReason: string;
  phaseA: PhaseAResult;
  phaseB: PhaseBResult;
  phaseC: PhaseCResult;
}

// ============================================================
// Phase A: DB All-Time Scan
// ============================================================

async function runPhaseA(
  venue: Venue,
  patterns: EntitySearchPatterns,
  options: { includeResolved: boolean; dbLimit: number; sampleSize: number }
): Promise<PhaseAResult> {
  const prisma = getClient();

  // Build OR conditions for all primary + secondary patterns
  const allPatterns = [...patterns.primary, ...patterns.secondary];
  const titleConditions: Prisma.MarketWhereInput[] = allPatterns.map(kw => ({
    title: { contains: kw, mode: 'insensitive' as const },
  }));

  // Status filter
  const statusFilter: MarketStatus[] = ['active', 'closed'];
  if (options.includeResolved) {
    statusFilter.push('resolved', 'archived');
  }

  // Query all-time (no closeTime filter)
  const markets = await prisma.market.findMany({
    where: {
      venue,
      status: { in: statusFilter },
      OR: titleConditions,
    },
    select: {
      id: true,
      title: true,
      status: true,
      closeTime: true,
      createdAt: true,
    },
    orderBy: { closeTime: 'desc' },
    take: options.dbLimit,
  });

  // Calculate status breakdown
  const byStatus = { active: 0, closed: 0, resolved: 0, archived: 0 };
  for (const m of markets) {
    byStatus[m.status as keyof typeof byStatus]++;
  }

  // Find date ranges
  const closeTimes = markets.map(m => m.closeTime).filter((d): d is Date => d !== null);
  const createdAts = markets.map(m => m.createdAt);

  const closeTimeMin = closeTimes.length > 0 ? new Date(Math.min(...closeTimes.map(d => d.getTime()))) : null;
  const closeTimeMax = closeTimes.length > 0 ? new Date(Math.max(...closeTimes.map(d => d.getTime()))) : null;
  const createdAtMin = createdAts.length > 0 ? new Date(Math.min(...createdAts.map(d => d.getTime()))) : null;
  const createdAtMax = createdAts.length > 0 ? new Date(Math.max(...createdAts.map(d => d.getTime()))) : null;

  // Get samples (newest by closeTime)
  const samples = markets.slice(0, options.sampleSize).map(m => ({
    id: m.id,
    title: m.title,
    status: m.status,
    closeTime: m.closeTime,
    createdAt: m.createdAt,
  }));

  return {
    totalFound: markets.length,
    hitDbLimit: markets.length >= options.dbLimit,
    byStatus,
    closeTimeMin,
    closeTimeMax,
    createdAtMin,
    createdAtMax,
    samples,
  };
}

// ============================================================
// Phase B: Eligible Window Scan (same as suggest-matches)
// ============================================================

async function runPhaseB(
  venue: Venue,
  patterns: EntitySearchPatterns,
  options: { lookbackHours: number; sampleSize: number }
): Promise<PhaseBResult> {
  const prisma = getClient();
  const marketRepo = new MarketRepository(prisma);

  // Use the same eligible markets pipeline as suggest-matches
  const allPatterns = [...patterns.primary, ...patterns.secondary];

  const markets = await marketRepo.listEligibleMarkets(venue, {
    lookbackHours: options.lookbackHours,
    limit: 5000,
    titleKeywords: allPatterns,
    orderBy: 'closeTime',
  });

  // Calculate status breakdown
  const byStatus = { active: 0, closed: 0 };
  for (const m of markets) {
    if (m.status === 'active') byStatus.active++;
    else if (m.status === 'closed') byStatus.closed++;
  }

  // Get samples
  const samples = markets.slice(0, options.sampleSize).map(m => ({
    id: m.id,
    title: m.title,
    status: m.status,
    closeTime: m.closeTime,
    createdAt: new Date(), // Not available from listEligibleMarkets, use placeholder
  }));

  return {
    eligibleCount: markets.length,
    byStatus,
    samples,
  };
}

// ============================================================
// Phase C: Extraction Scan
// ============================================================

async function runPhaseC(
  entity: string,
  phaseAMarkets: MarketSample[],
  sampleSize: number
): Promise<PhaseCResult> {
  const detected: Array<MarketSample & { extractedEntities: string[] }> = [];
  const missed: Array<MarketSample & { extractedEntities: string[] }> = [];

  for (const market of phaseAMarkets) {
    const tokens = tokenizeForEntities(market.title);
    const entities = extractMacroEntities(tokens, market.title.toLowerCase());
    const entityList = Array.from(entities);

    if (entities.has(entity)) {
      detected.push({ ...market, extractedEntities: entityList });
    } else {
      missed.push({ ...market, extractedEntities: entityList });
    }
  }

  const total = phaseAMarkets.length;
  const detectionRate = total > 0 ? detected.length / total : 0;

  return {
    totalScanned: total,
    detected: detected.length,
    missed: missed.length,
    detectionRate,
    samplesDetected: detected.slice(0, sampleSize),
    samplesMissed: missed.slice(0, sampleSize),
  };
}

// ============================================================
// Main audit function
// ============================================================

export async function runTruthAudit(options: TruthAuditOptions): Promise<TruthAuditResult> {
  const {
    venue,
    entity,
    includeResolved = true, // Default true for truth audit
    dbLimit = 5000,
    sampleSize = 20,
    lookbackHours = 720,
  } = options;

  const entityUpper = entity.toUpperCase();
  const patterns = TRUTH_AUDIT_PATTERNS[entityUpper];

  if (!patterns) {
    throw new Error(`Unknown entity: ${entityUpper}. Supported: ${Object.keys(TRUTH_AUDIT_PATTERNS).join(', ')}`);
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`[macro:truth-audit] ${entityUpper} on ${venue}`);
  console.log(`${'='.repeat(80)}`);
  console.log(`Entity: ${patterns.description}`);
  console.log(`Include resolved/archived: ${includeResolved}`);
  console.log(`DB limit: ${dbLimit} | Sample size: ${sampleSize} | Lookback: ${lookbackHours}h`);
  console.log(`Primary patterns: ${patterns.primary.join(', ')}`);
  console.log(`Secondary patterns: ${patterns.secondary.join(', ')}`);
  console.log(`${'='.repeat(80)}\n`);

  // ============================================================
  // PHASE A: DB All-Time Scan
  // ============================================================
  console.log(`[PHASE A] DB ALL-TIME SCAN`);
  console.log(`Searching for ANY market matching patterns (no window filter)...\n`);

  const phaseA = await runPhaseA(venue, patterns, { includeResolved, dbLimit, sampleSize });

  console.log(`>>> Total found: ${phaseA.totalFound}${phaseA.hitDbLimit ? ' (HIT LIMIT - may have more!)' : ''}`);
  console.log(`>>> By status: active=${phaseA.byStatus.active}, closed=${phaseA.byStatus.closed}, resolved=${phaseA.byStatus.resolved}, archived=${phaseA.byStatus.archived}`);

  if (phaseA.closeTimeMin && phaseA.closeTimeMax) {
    console.log(`>>> closeTime range: ${phaseA.closeTimeMin.toISOString().slice(0, 10)} to ${phaseA.closeTimeMax.toISOString().slice(0, 10)}`);
  }
  if (phaseA.createdAtMin && phaseA.createdAtMax) {
    console.log(`>>> createdAt range: ${phaseA.createdAtMin.toISOString().slice(0, 10)} to ${phaseA.createdAtMax.toISOString().slice(0, 10)}`);
  }

  if (phaseA.samples.length > 0) {
    console.log(`\n[Phase A Samples] (top ${Math.min(10, phaseA.samples.length)}):`);
    for (let i = 0; i < Math.min(10, phaseA.samples.length); i++) {
      const s = phaseA.samples[i];
      const dateStr = s.closeTime ? s.closeTime.toISOString().slice(0, 10) : 'no-date';
      console.log(`  [${s.status}] [${dateStr}] ${s.title.slice(0, 70)}...`);
    }
  }

  // ============================================================
  // PHASE B: Eligible Window Scan
  // ============================================================
  console.log(`\n${'─'.repeat(80)}`);
  console.log(`[PHASE B] ELIGIBLE WINDOW SCAN`);
  console.log(`Using same pipeline as suggest-matches --topic macro (lookback=${lookbackHours}h)...\n`);

  const phaseB = await runPhaseB(venue, patterns, { lookbackHours, sampleSize });

  console.log(`>>> Eligible count: ${phaseB.eligibleCount}`);
  console.log(`>>> By status: active=${phaseB.byStatus.active}, closed=${phaseB.byStatus.closed}`);

  if (phaseB.samples.length > 0) {
    console.log(`\n[Phase B Samples] (top ${Math.min(5, phaseB.samples.length)}):`);
    for (let i = 0; i < Math.min(5, phaseB.samples.length); i++) {
      const s = phaseB.samples[i];
      const dateStr = s.closeTime ? s.closeTime.toISOString().slice(0, 10) : 'no-date';
      console.log(`  [${s.status}] [${dateStr}] ${s.title.slice(0, 70)}...`);
    }
  }

  // ============================================================
  // PHASE C: Extraction Scan
  // ============================================================
  console.log(`\n${'─'.repeat(80)}`);
  console.log(`[PHASE C] EXTRACTION SCAN`);
  console.log(`Running extractor on Phase A samples to verify detection...\n`);

  const phaseC = await runPhaseC(entityUpper, phaseA.samples, sampleSize);

  console.log(`>>> Scanned: ${phaseC.totalScanned}`);
  console.log(`>>> Detected: ${phaseC.detected} (${(phaseC.detectionRate * 100).toFixed(1)}%)`);
  console.log(`>>> Missed: ${phaseC.missed}`);

  if (phaseC.samplesMissed.length > 0) {
    console.log(`\n[Extraction MISSED] (top ${Math.min(5, phaseC.samplesMissed.length)}):`);
    for (let i = 0; i < Math.min(5, phaseC.samplesMissed.length); i++) {
      const s = phaseC.samplesMissed[i];
      console.log(`  [found: ${s.extractedEntities.join(', ') || 'NONE'}] ${s.title.slice(0, 60)}...`);
    }
  }

  // ============================================================
  // Determine Verdict
  // ============================================================
  let verdict: TruthVerdict;
  let verdictReason: string;

  if (phaseA.totalFound === 0) {
    verdict = TruthVerdict.NO_DATA_ALL_TIME;
    verdictReason = 'No markets found in DB matching any patterns (all-time search)';
  } else if (phaseA.hitDbLimit) {
    verdict = TruthVerdict.AMBIGUOUS;
    verdictReason = `Hit DB limit (${dbLimit}), may have more data. Increase --db-limit`;
  } else if (phaseB.eligibleCount > 0) {
    if (phaseC.detectionRate >= 0.5) {
      verdict = TruthVerdict.EXISTS_AND_ELIGIBLE;
      verdictReason = `Found ${phaseA.totalFound} in DB, ${phaseB.eligibleCount} eligible, ${(phaseC.detectionRate * 100).toFixed(0)}% extracted`;
    } else {
      verdict = TruthVerdict.EXISTS_BUT_EXTRACTION_ISSUE;
      verdictReason = `Found ${phaseA.totalFound} in DB, ${phaseB.eligibleCount} eligible, but only ${(phaseC.detectionRate * 100).toFixed(0)}% extracted - check patterns`;
    }
  } else if (phaseA.totalFound > 0 && phaseB.eligibleCount === 0) {
    verdict = TruthVerdict.EXISTS_ALL_TIME_BUT_NOT_ELIGIBLE;
    verdictReason = `Found ${phaseA.totalFound} in DB (resolved=${phaseA.byStatus.resolved}, archived=${phaseA.byStatus.archived}) but 0 eligible in window`;
  } else {
    verdict = TruthVerdict.AMBIGUOUS;
    verdictReason = 'Unexpected state - check data';
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`VERDICT: ${verdict}`);
  console.log(`REASON:  ${verdictReason}`);
  console.log(`${'='.repeat(80)}\n`);

  return {
    entity: entityUpper,
    venue,
    verdict,
    verdictReason,
    phaseA,
    phaseB,
    phaseC,
  };
}

// ============================================================
// Batch audit for multiple entities
// ============================================================

export async function runTruthAuditBatch(
  venue: Venue,
  entities: string[],
  options: Omit<TruthAuditOptions, 'venue' | 'entity'>
): Promise<TruthAuditResult[]> {
  const results: TruthAuditResult[] = [];

  for (const entity of entities) {
    try {
      const result = await runTruthAudit({ venue, entity, ...options });
      results.push(result);
    } catch (err) {
      console.error(`Error auditing ${entity}:`, err);
    }
  }

  // Print summary table
  console.log(`\n${'='.repeat(80)}`);
  console.log(`[SUMMARY] Truth Audit for ${venue}`);
  console.log(`${'='.repeat(80)}\n`);

  console.log(`${'Entity'.padEnd(18)} | ${'DB All-Time'.padStart(10)} | ${'Eligible'.padStart(8)} | ${'Extract%'.padStart(8)} | Verdict`);
  console.log(`${'-'.repeat(18)}-+-${'-'.repeat(10)}-+-${'-'.repeat(8)}-+-${'-'.repeat(8)}-+-${'-'.repeat(30)}`);

  for (const r of results) {
    const extractPct = r.phaseC.totalScanned > 0 ? `${(r.phaseC.detectionRate * 100).toFixed(0)}%` : '-';
    console.log(
      `${r.entity.padEnd(18)} | ${String(r.phaseA.totalFound).padStart(10)} | ${String(r.phaseB.eligibleCount).padStart(8)} | ${extractPct.padStart(8)} | ${r.verdict}`
    );
  }

  console.log(`${'-'.repeat(80)}\n`);

  return results;
}

/** Get supported entities for truth audit */
export function getSupportedTruthAuditEntities(): string[] {
  return Object.keys(TRUTH_AUDIT_PATTERNS);
}

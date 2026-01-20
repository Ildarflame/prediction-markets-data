/**
 * crypto:truth-audit - Ground-truth verification for crypto markets (v2.5.0)
 *
 * Verifies whether a venue truly has data for crypto entities
 * Three phases similar to macro:truth-audit
 */

import { type Venue } from '@data-module/core';
import { getClient, MarketRepository, type MarketStatus } from '@data-module/db';
import {
  CRYPTO_ENTITIES_V1,
  CRYPTO_KEYWORDS_STRICT,
  extractCryptoEntity,
  extractCryptoSignals,
  fetchEligibleCryptoMarkets,
} from '../matching/index.js';

// ============================================================
// Types
// ============================================================

export enum CryptoTruthVerdict {
  EXISTS_AND_ELIGIBLE = 'EXISTS_AND_ELIGIBLE',
  EXISTS_ALL_TIME_BUT_NOT_ELIGIBLE = 'EXISTS_ALL_TIME_BUT_NOT_ELIGIBLE',
  EXISTS_BUT_EXTRACTION_ISSUE = 'EXISTS_BUT_EXTRACTION_ISSUE',
  NO_DATA_ALL_TIME = 'NO_DATA_ALL_TIME',
  AMBIGUOUS = 'AMBIGUOUS',
}

export const CRYPTO_VERDICT_DESCRIPTIONS: Record<CryptoTruthVerdict, string> = {
  [CryptoTruthVerdict.EXISTS_AND_ELIGIBLE]: 'Found in DB and passes eligibility filters',
  [CryptoTruthVerdict.EXISTS_ALL_TIME_BUT_NOT_ELIGIBLE]: 'Found in DB but filtered out by eligibility',
  [CryptoTruthVerdict.EXISTS_BUT_EXTRACTION_ISSUE]: 'Found but extractor doesn\'t detect correctly',
  [CryptoTruthVerdict.NO_DATA_ALL_TIME]: 'Not found in DB even with broadest search',
  [CryptoTruthVerdict.AMBIGUOUS]: 'Unclear - may need more investigation',
};

export interface CryptoTruthAuditOptions {
  venue: Venue;
  entity: string;
  includeResolved?: boolean;
  dbLimit?: number;
  sampleSize?: number;
  lookbackHours?: number;
}

export interface CryptoTruthAuditResult {
  venue: Venue;
  entity: string;
  phaseA: {
    total: number;
    byStatus: Record<string, number>;
    samples: Array<{ title: string; status: string; settleDate: string | null }>;
  };
  phaseB: {
    eligible: number;
    byStatus: Record<string, number>;
    samples: Array<{ title: string; status: string; settleDate: string | null }>;
  };
  phaseC: {
    scanned: number;
    detected: number;
    missed: Array<{ title: string; found: string | null }>;
  };
  verdict: CryptoTruthVerdict;
  reason: string;
}


// ============================================================
// Main Functions
// ============================================================

export async function runCryptoTruthAudit(options: CryptoTruthAuditOptions): Promise<CryptoTruthAuditResult> {
  const {
    venue,
    entity,
    includeResolved = true,
    dbLimit = 5000,
    sampleSize = 20,
    lookbackHours = 720,
  } = options;

  const keywords = CRYPTO_KEYWORDS_STRICT[entity] || [];

  console.log(`\n${'='.repeat(80)}`);
  console.log(`[crypto:truth-audit] ${entity} on ${venue}`);
  console.log(`${'='.repeat(80)}`);
  console.log(`Include resolved/archived: ${includeResolved}`);
  console.log(`DB limit: ${dbLimit} | Sample size: ${sampleSize} | Lookback: ${lookbackHours}h`);
  console.log(`Keywords: ${keywords.join(', ')}`);
  console.log(`${'='.repeat(80)}`);

  // Phase A: DB ALL-TIME SCAN
  console.log('\n[PHASE A] DB ALL-TIME SCAN');
  console.log('Searching for ANY market matching keywords (no window filter)...\n');

  const prisma = getClient();
  const statusFilter: MarketStatus[] = ['active', 'closed'];
  if (includeResolved) {
    statusFilter.push('resolved', 'archived');
  }

  const phaseAMarkets = await prisma.market.findMany({
    where: {
      venue,
      status: { in: statusFilter },
      OR: keywords.map(kw => ({ title: { contains: kw, mode: 'insensitive' as const } })),
    },
    select: { id: true, title: true, status: true, closeTime: true, createdAt: true, metadata: true },
    orderBy: { closeTime: 'desc' },
    take: dbLimit,
  });

  const phaseAByStatus: Record<string, number> = {};
  for (const m of phaseAMarkets) {
    phaseAByStatus[m.status] = (phaseAByStatus[m.status] || 0) + 1;
  }

  console.log(`>>> Total found: ${phaseAMarkets.length}`);
  console.log(`>>> By status: ${Object.entries(phaseAByStatus).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`);

  if (phaseAMarkets.length > 0) {
    const dates = phaseAMarkets.filter(m => m.closeTime).map(m => m.closeTime!);
    if (dates.length > 0) {
      const minDate = new Date(Math.min(...dates.map(d => d.getTime()))).toISOString().slice(0, 10);
      const maxDate = new Date(Math.max(...dates.map(d => d.getTime()))).toISOString().slice(0, 10);
      console.log(`>>> closeTime range: ${minDate} to ${maxDate}`);
    }

    console.log(`\n[Phase A Samples] (top ${Math.min(sampleSize, phaseAMarkets.length)}):`);
    for (const m of phaseAMarkets.slice(0, sampleSize)) {
      const dateStr = m.closeTime ? m.closeTime.toISOString().slice(0, 10) : 'no-date';
      console.log(`  [${m.status}] [${dateStr}] ${m.title.slice(0, 60)}...`);
    }
  }

  const phaseA: CryptoTruthAuditResult['phaseA'] = {
    total: phaseAMarkets.length,
    byStatus: phaseAByStatus,
    samples: phaseAMarkets.slice(0, sampleSize).map(m => {
      const signals = extractCryptoSignals({
        id: m.id,
        venue,
        title: m.title,
        category: null,
        status: m.status,
        closeTime: m.closeTime,
        metadata: m.metadata as Record<string, unknown> | null,
      });
      return { title: m.title, status: m.status, settleDate: signals.settleDate };
    }),
  };

  // Phase B: ELIGIBLE WINDOW SCAN
  console.log(`\n${'-'.repeat(80)}`);
  console.log('[PHASE B] ELIGIBLE WINDOW SCAN');
  console.log(`Using same pipeline as suggest-matches --topic crypto (lookback=${lookbackHours}h)...\n`);

  const marketRepo = new MarketRepository(prisma);
  const { markets: phaseBMarkets } = await fetchEligibleCryptoMarkets(marketRepo, {
    venue,
    lookbackHours,
    limit: dbLimit,
    entities: [entity],
  });

  const phaseBByStatus: Record<string, number> = {};
  for (const m of phaseBMarkets) {
    phaseBByStatus[m.market.status] = (phaseBByStatus[m.market.status] || 0) + 1;
  }

  console.log(`>>> Eligible count: ${phaseBMarkets.length}`);
  console.log(`>>> By status: ${Object.entries(phaseBByStatus).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`);

  if (phaseBMarkets.length > 0) {
    console.log(`\n[Phase B Samples] (top ${Math.min(5, phaseBMarkets.length)}):`);
    for (const m of phaseBMarkets.slice(0, 5)) {
      const dateStr = m.market.closeTime ? m.market.closeTime.toISOString().slice(0, 10) : 'no-date';
      console.log(`  [${m.market.status}] [${dateStr}] ${m.market.title.slice(0, 60)}...`);
    }
  }

  const phaseB: CryptoTruthAuditResult['phaseB'] = {
    eligible: phaseBMarkets.length,
    byStatus: phaseBByStatus,
    samples: phaseBMarkets.slice(0, sampleSize).map(m => ({
      title: m.market.title,
      status: m.market.status,
      settleDate: m.signals.settleDate,
    })),
  };

  // Phase C: EXTRACTION SCAN
  console.log(`\n${'-'.repeat(80)}`);
  console.log('[PHASE C] EXTRACTION SCAN');
  console.log('Running extractor on Phase A samples to verify detection...\n');

  const scanCount = Math.min(phaseAMarkets.length, sampleSize * 2);
  let detected = 0;
  const missed: Array<{ title: string; found: string | null }> = [];

  for (let i = 0; i < scanCount; i++) {
    const m = phaseAMarkets[i];
    const extractedEntity = extractCryptoEntity(m.title, m.metadata as Record<string, unknown> | null);

    if (extractedEntity === entity) {
      detected++;
    } else {
      if (missed.length < sampleSize) {
        missed.push({ title: m.title, found: extractedEntity });
      }
    }
  }

  const detectRate = scanCount > 0 ? (detected / scanCount) * 100 : 0;
  console.log(`>>> Scanned: ${scanCount}`);
  console.log(`>>> Detected: ${detected} (${detectRate.toFixed(1)}%)`);
  console.log(`>>> Missed: ${missed.length}`);

  if (missed.length > 0) {
    console.log(`\n[Extraction MISSED] (top ${Math.min(sampleSize, missed.length)}):`);
    for (const m of missed.slice(0, sampleSize)) {
      console.log(`  [found: ${m.found || 'NONE'}] ${m.title.slice(0, 60)}...`);
    }
  }

  const phaseC: CryptoTruthAuditResult['phaseC'] = {
    scanned: scanCount,
    detected,
    missed,
  };

  // Determine verdict
  let verdict: CryptoTruthVerdict;
  let reason: string;

  if (phaseA.total === 0) {
    verdict = CryptoTruthVerdict.NO_DATA_ALL_TIME;
    reason = 'No markets found in DB matching any keywords (all-time search)';
  } else if (phaseB.eligible === 0 && phaseA.total > 0) {
    verdict = CryptoTruthVerdict.EXISTS_ALL_TIME_BUT_NOT_ELIGIBLE;
    reason = `Found ${phaseA.total} in DB but 0 pass eligibility (window/status filter)`;
  } else if (detectRate < 50) {
    verdict = CryptoTruthVerdict.EXISTS_BUT_EXTRACTION_ISSUE;
    reason = `Found ${phaseA.total} in DB, ${phaseB.eligible} eligible, but only ${detectRate.toFixed(0)}% extracted - check patterns`;
  } else {
    verdict = CryptoTruthVerdict.EXISTS_AND_ELIGIBLE;
    reason = `Found ${phaseA.total} in DB, ${phaseB.eligible} eligible, ${detectRate.toFixed(0)}% extracted`;
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`VERDICT: ${verdict}`);
  console.log(`REASON:  ${reason}`);
  console.log(`${'='.repeat(80)}\n`);

  return {
    venue,
    entity,
    phaseA,
    phaseB,
    phaseC,
    verdict,
    reason,
  };
}

/**
 * Run batch truth audit for multiple entities
 */
export async function runCryptoTruthAuditBatch(
  venue: Venue,
  entities: readonly string[],
  options: Omit<CryptoTruthAuditOptions, 'venue' | 'entity'>
): Promise<void> {
  const results: CryptoTruthAuditResult[] = [];

  for (const entity of entities) {
    const result = await runCryptoTruthAudit({ ...options, venue, entity });
    results.push(result);
  }

  // Print summary table
  console.log(`\n${'='.repeat(80)}`);
  console.log(`[SUMMARY] Crypto Truth Audit for ${venue}`);
  console.log(`${'='.repeat(80)}\n`);

  console.log('Entity          | DB All-Time | Eligible | Extract% | Verdict');
  console.log('----------------+------------+----------+----------+-------------------------------');

  for (const r of results) {
    const extractRate = r.phaseC.scanned > 0 ? Math.round((r.phaseC.detected / r.phaseC.scanned) * 100) : 0;
    const extractStr = r.phaseA.total === 0 ? '-' : `${extractRate}%`;

    console.log(
      `${r.entity.padEnd(15)} | ${String(r.phaseA.total).padStart(10)} | ${String(r.phaseB.eligible).padStart(8)} | ${extractStr.padStart(8)} | ${r.verdict}`
    );
  }

  console.log('-'.repeat(80));
}

/**
 * Get supported entities for crypto truth audit
 */
export function getSupportedCryptoTruthAuditEntities(): readonly string[] {
  return CRYPTO_ENTITIES_V1;
}

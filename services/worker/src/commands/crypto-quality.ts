/**
 * crypto:best, crypto:worst, crypto:sample - Quality review commands (v2.6.0)
 *
 * Displays crypto suggestions for quality review with detailed breakdown
 * v2.6.0: Added --apply flag for auto-confirming safe matches
 */

import { type Venue } from '@data-module/core';
import {
  getClient,
  MarketRepository,
  MarketLinkRepository,
  type Venue as DBVenue,
} from '@data-module/db';
import {
  CRYPTO_ENTITIES_V1,
  fetchEligibleCryptoMarkets,
  buildCryptoIndex,
  findCryptoCandidates,
  cryptoMatchScore,
  CryptoDateType,
  type CryptoMarket,
  type CryptoScoreResult,
} from '../matching/index.js';
import {
  validateAutoConfirm,
  createEmptyAutoConfirmStats,
  updateStatsFromRejectReason,
  type AutoConfirmValidation,
} from '../matching/cryptoAutoConfirm.js';

/** Extended match with validation info for auto-confirm */
interface CryptoQualityMatchWithValidation extends CryptoQualityMatch {
  validation?: AutoConfirmValidation;
  leftCrypto?: CryptoMarket;
  rightCrypto?: CryptoMarket;
  scoreResult?: CryptoScoreResult;
}

export interface CryptoQualityOptions {
  /** Filter: 'best', 'worst', or 'sample' */
  mode: 'best' | 'worst' | 'sample';
  /** Minimum score filter (for 'best' mode) */
  minScore?: number;
  /** Maximum score filter (for 'worst' mode) */
  maxScore?: number;
  /** Maximum results to show */
  limit?: number;
  /** Random seed for 'sample' mode */
  seed?: number;
  /** From venue (default: kalshi) */
  fromVenue?: Venue;
  /** To venue (default: polymarket) */
  toVenue?: Venue;
  /** Lookback hours for market fetch */
  lookbackHours?: number;
  /** v2.6.0: Apply auto-confirm for safe matches */
  apply?: boolean;
  /** v2.6.0: Dry-run mode (show what would be confirmed) */
  dryRun?: boolean;
}

export interface CryptoQualityMatch {
  leftId: number;
  rightId: number;
  score: number;
  tier: 'STRONG' | 'WEAK';
  entity: string;
  settleDateL: string | null;
  settleDateR: string | null;
  dateTypeL: CryptoDateType;
  dateTypeR: CryptoDateType;
  comparatorL: string | null;
  comparatorR: string | null;
  numbersL: number[];
  numbersR: number[];
  leftTitle: string;
  rightTitle: string;
  reason: string;
}

export interface CryptoQualityResult {
  mode: string;
  fromVenue: Venue;
  toVenue: Venue;
  totalPairs: number;
  matches: CryptoQualityMatch[];
}

/**
 * Seeded random number generator (simple LCG)
 */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/**
 * Shuffle array with seeded random
 */
function shuffleWithSeed<T>(arr: T[], seed: number): T[] {
  const result = [...arr];
  const random = seededRandom(seed);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Run crypto quality review command
 */
export async function runCryptoQuality(options: CryptoQualityOptions): Promise<CryptoQualityResult> {
  const {
    mode,
    minScore = 0.90,
    maxScore = 0.60,
    limit = 50,
    seed = 42,
    fromVenue = 'kalshi',
    toVenue = 'polymarket',
    lookbackHours = 720,
  } = options;

  console.log(`\n${'='.repeat(80)}`);
  console.log(`[crypto:${mode}] Quality Review v2.5.3`);
  console.log(`${'='.repeat(80)}`);
  console.log(`Mode: ${mode} | From: ${fromVenue} -> ${toVenue} | Lookback: ${lookbackHours}h`);
  if (mode === 'best') console.log(`Min score: ${minScore}`);
  if (mode === 'worst') console.log(`Max score: ${maxScore}`);
  if (mode === 'sample') console.log(`Seed: ${seed}`);
  console.log(`Limit: ${limit}`);
  console.log(`${'='.repeat(80)}\n`);

  const prisma = getClient();
  const marketRepo = new MarketRepository(prisma);

  // Fetch markets from both venues
  console.log(`[crypto:${mode}] Fetching markets...`);

  const { markets: leftMarkets } = await fetchEligibleCryptoMarkets(marketRepo, {
    venue: fromVenue,
    lookbackHours,
    limit: 5000,
    entities: CRYPTO_ENTITIES_V1,
    excludeSports: true,
  });

  const { markets: rightMarkets } = await fetchEligibleCryptoMarkets(marketRepo, {
    venue: toVenue,
    lookbackHours,
    limit: 5000,
    entities: CRYPTO_ENTITIES_V1,
    excludeSports: true,
  });

  console.log(`  ${fromVenue}: ${leftMarkets.length} markets`);
  console.log(`  ${toVenue}: ${rightMarkets.length} markets`);

  // Build index and score all pairs
  console.log(`[crypto:${mode}] Building index and scoring pairs...`);
  const cryptoIndex = buildCryptoIndex(rightMarkets);

  // Use extended type to track validation data when needed
  const allMatches: CryptoQualityMatchWithValidation[] = [];

  for (const leftCrypto of leftMarkets) {
    const candidates = findCryptoCandidates(leftCrypto, cryptoIndex, true);

    for (const rightCrypto of candidates) {
      if (rightCrypto.market.id === leftCrypto.market.id) continue;

      const scoreResult = cryptoMatchScore(leftCrypto, rightCrypto);
      if (!scoreResult) continue;

      const match: CryptoQualityMatchWithValidation = {
        leftId: leftCrypto.market.id,
        rightId: rightCrypto.market.id,
        score: scoreResult.score,
        tier: scoreResult.tier,
        entity: leftCrypto.signals.entity!,
        settleDateL: leftCrypto.signals.settleDate,
        settleDateR: rightCrypto.signals.settleDate,
        dateTypeL: scoreResult.dateTypeL,
        dateTypeR: scoreResult.dateTypeR,
        comparatorL: scoreResult.comparatorL,
        comparatorR: scoreResult.comparatorR,
        numbersL: leftCrypto.signals.numbers,
        numbersR: rightCrypto.signals.numbers,
        leftTitle: leftCrypto.market.title,
        rightTitle: rightCrypto.market.title,
        reason: scoreResult.reason,
        // Store references for auto-confirm validation
        leftCrypto,
        rightCrypto,
        scoreResult,
      };

      allMatches.push(match);
    }
  }

  console.log(`  Total scored pairs: ${allMatches.length}`);

  // Filter and sort based on mode
  let filteredMatches: CryptoQualityMatchWithValidation[];

  switch (mode) {
    case 'best':
      filteredMatches = allMatches
        .filter(m => m.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
      break;

    case 'worst':
      filteredMatches = allMatches
        .filter(m => m.score <= maxScore)
        .sort((a, b) => a.score - b.score)
        .slice(0, limit);
      break;

    case 'sample':
      filteredMatches = shuffleWithSeed(allMatches, seed).slice(0, limit);
      break;

    default:
      filteredMatches = [];
  }

  // Auto-confirm logic (v2.6.0)
  const stats = createEmptyAutoConfirmStats();
  const confirmedPairs: CryptoQualityMatchWithValidation[] = [];
  const linkRepo = new MarketLinkRepository(prisma);

  if (options.apply || options.dryRun) {
    console.log(`\n[crypto:${mode}] Running SAFE_RULES validation...`);

    for (const m of filteredMatches) {
      stats.scanned++;

      // Validate using SAFE_RULES
      if (m.leftCrypto && m.rightCrypto && m.scoreResult) {
        const validation = validateAutoConfirm(m.leftCrypto, m.rightCrypto, m.scoreResult);
        m.validation = validation;

        if (validation.safe) {
          confirmedPairs.push(m);
        } else {
          updateStatsFromRejectReason(stats, validation.rejectReason);
        }
      }
    }

    console.log(`  Scanned: ${stats.scanned}`);
    console.log(`  Safe for auto-confirm: ${confirmedPairs.length}`);

    // Apply auto-confirm if --apply (not --dry-run)
    if (options.apply && !options.dryRun) {
      console.log(`\n[crypto:${mode}] Applying auto-confirm to ${confirmedPairs.length} safe matches...`);

      for (const m of confirmedPairs) {
        try {
          const result = await linkRepo.confirmByPair(
            fromVenue as DBVenue,
            m.leftId,
            toVenue as DBVenue,
            m.rightId,
            m.score,
            m.reason
          );

          if (result.wasAlreadyConfirmed) {
            stats.alreadyConfirmed++;
          } else if (result.created) {
            stats.confirmed++;
          } else {
            stats.updatedExistingLinks++;
            stats.confirmed++;
          }
        } catch (err) {
          console.error(`  Error confirming ${m.leftId}<->${m.rightId}: ${err}`);
        }
      }

      console.log(`  Newly confirmed: ${stats.confirmed}`);
      console.log(`  Already confirmed: ${stats.alreadyConfirmed}`);
      console.log(`  Updated existing: ${stats.updatedExistingLinks}`);
    } else {
      console.log(`\n[crypto:${mode}] DRY-RUN: Would confirm ${confirmedPairs.length} matches`);
    }
  }

  // Print results
  console.log(`\n[crypto:${mode}] Results (${filteredMatches.length} matches):\n`);

  for (let i = 0; i < filteredMatches.length; i++) {
    const m = filteredMatches[i];
    const safeTag = m.validation ? (m.validation.safe ? ' [SAFE]' : ` [SKIP: ${m.validation.rejectReason}]`) : '';
    console.log(`${'─'.repeat(80)}`);
    console.log(`#${i + 1} | Score: ${m.score.toFixed(3)} | Tier: ${m.tier} | Entity: ${m.entity}${safeTag}`);
    console.log(`${'─'.repeat(80)}`);
    console.log(`LEFT  [${m.leftId}]: ${m.leftTitle}`);
    console.log(`RIGHT [${m.rightId}]: ${m.rightTitle}`);
    console.log(``);
    console.log(`  SettleDate L: ${m.settleDateL || 'null'} (${m.dateTypeL})`);
    console.log(`  SettleDate R: ${m.settleDateR || 'null'} (${m.dateTypeR})`);
    console.log(`  Comparator L: ${m.comparatorL || 'null'} | R: ${m.comparatorR || 'null'}`);
    console.log(`  Numbers L: [${m.numbersL.join(', ')}] | R: [${m.numbersR.join(', ')}]`);
    console.log(`  Reason: ${m.reason}`);
    console.log(``);
  }

  // Summary stats
  console.log(`${'='.repeat(80)}`);
  console.log(`[crypto:${mode}] Summary:`);
  console.log(`  Total pairs scored: ${allMatches.length}`);
  console.log(`  Matches shown: ${filteredMatches.length}`);

  if (filteredMatches.length > 0) {
    const avgScore = filteredMatches.reduce((sum, m) => sum + m.score, 0) / filteredMatches.length;
    const strongCount = filteredMatches.filter(m => m.tier === 'STRONG').length;
    console.log(`  Avg score: ${avgScore.toFixed(3)}`);
    console.log(`  STRONG tier: ${strongCount}/${filteredMatches.length}`);

    // Date type distribution
    const dateTypeCounts = new Map<string, number>();
    for (const m of filteredMatches) {
      const key = `${m.dateTypeL}<->${m.dateTypeR}`;
      dateTypeCounts.set(key, (dateTypeCounts.get(key) || 0) + 1);
    }
    console.log(`  Date type pairs:`);
    for (const [key, count] of dateTypeCounts.entries()) {
      console.log(`    ${key}: ${count}`);
    }
  }

  // Auto-confirm summary (v2.6.0)
  if (options.apply || options.dryRun) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[crypto:${mode}] Auto-Confirm Summary (v2.6.0):`);
    console.log(`  Scanned: ${stats.scanned}`);
    console.log(`  Confirmed: ${stats.confirmed}`);
    console.log(`  Already confirmed: ${stats.alreadyConfirmed}`);
    console.log(`  Updated existing: ${stats.updatedExistingLinks}`);
    console.log(`  Skipped by rule:`);
    console.log(`    entity_mismatch: ${stats.skippedByRule.entityMismatch}`);
    console.log(`    date_type_mismatch: ${stats.skippedByRule.dateTypeMismatch}`);
    console.log(`    date_not_exact: ${stats.skippedByRule.dateNotExact}`);
    console.log(`    comparator_mismatch: ${stats.skippedByRule.comparatorMismatch}`);
    console.log(`    number_incompatible: ${stats.skippedByRule.numberIncompatible}`);
    console.log(`    text_sanity_low: ${stats.skippedByRule.textSanityLow}`);
    console.log(`    missing_fields: ${stats.skippedByRule.missingFields}`);

    // Print sample of confirmed pairs
    if (confirmedPairs.length > 0) {
      const sampleSize = Math.min(10, confirmedPairs.length);
      console.log(`\n  Sample of ${sampleSize} confirmed pairs:`);
      for (let i = 0; i < sampleSize; i++) {
        const m = confirmedPairs[i];
        console.log(`    ${i + 1}. [${m.leftId}] <-> [${m.rightId}] | ${m.entity} | ${m.score.toFixed(3)}`);
        console.log(`       L: ${m.leftTitle.slice(0, 60)}...`);
        console.log(`       R: ${m.rightTitle.slice(0, 60)}...`);
      }
    }
  }

  return {
    mode,
    fromVenue,
    toVenue,
    totalPairs: allMatches.length,
    matches: filteredMatches,
  };
}

import type { Venue as CoreVenue } from '@data-module/core';
import {
  buildFingerprint,
  normalizeTitleForFuzzy,
  entityScore,
  numberScore,
  dateScore,
  tokenize,
  jaccard,
  type MarketFingerprint,
} from '@data-module/core';
import {
  getClient,
  MarketRepository,
  MarketLinkRepository,
  type Venue,
  type EligibleMarket,
} from '@data-module/db';
import { distance } from 'fastest-levenshtein';

export interface SuggestMatchesOptions {
  fromVenue: CoreVenue;
  toVenue: CoreVenue;
  minScore?: number;
  topK?: number;
  lookbackHours?: number;
  limitLeft?: number;
  debugMarketId?: number;
}

export interface SuggestMatchesResult {
  leftCount: number;
  rightCount: number;
  candidatesConsidered: number;
  suggestionsCreated: number;
  suggestionsUpdated: number;
  skippedConfirmed: number;
  errors: string[];
}

/**
 * Market with precomputed fingerprint
 */
interface IndexedMarket {
  market: EligibleMarket;
  fingerprint: MarketFingerprint;
  normalizedTitle: string;
}

/**
 * Entity-based inverted index for candidate generation
 */
interface EntityIndex {
  byEntity: Map<string, Set<number>>;
  byYear: Map<number, Set<number>>;
  markets: Map<number, IndexedMarket>;
}

/**
 * Build entity-based index for target markets
 */
function buildEntityIndex(markets: EligibleMarket[]): EntityIndex {
  const byEntity = new Map<string, Set<number>>();
  const byYear = new Map<number, Set<number>>();
  const marketsMap = new Map<number, IndexedMarket>();

  for (const market of markets) {
    const fingerprint = buildFingerprint(market.title, market.closeTime);
    const normalizedTitle = normalizeTitleForFuzzy(market.title);

    const indexed: IndexedMarket = { market, fingerprint, normalizedTitle };
    marketsMap.set(market.id, indexed);

    // Index by entities
    for (const entity of fingerprint.entities) {
      if (!byEntity.has(entity)) {
        byEntity.set(entity, new Set());
      }
      byEntity.get(entity)!.add(market.id);
    }

    // Index by year from dates
    for (const date of fingerprint.dates) {
      if (date.year) {
        if (!byYear.has(date.year)) {
          byYear.set(date.year, new Set());
        }
        byYear.get(date.year)!.add(market.id);
      }
    }

    // Also index by closeTime year
    if (market.closeTime) {
      const year = market.closeTime.getFullYear();
      if (!byYear.has(year)) {
        byYear.set(year, new Set());
      }
      byYear.get(year)!.add(market.id);
    }
  }

  return { byEntity, byYear, markets: marketsMap };
}

/**
 * Find candidate markets using entity and date overlap
 */
function findCandidatesByEntity(
  leftFingerprint: MarketFingerprint,
  leftCloseTime: Date | null,
  index: EntityIndex,
  maxCandidates: number = 500
): Set<number> {
  const candidates = new Set<number>();
  const entityScores = new Map<number, number>();

  // Find candidates that share at least one entity
  for (const entity of leftFingerprint.entities) {
    const marketIds = index.byEntity.get(entity);
    if (marketIds) {
      for (const id of marketIds) {
        candidates.add(id);
        entityScores.set(id, (entityScores.get(id) || 0) + 1);
      }
    }
  }

  // If we have too many candidates, prioritize by entity overlap count
  if (candidates.size > maxCandidates) {
    const sorted = Array.from(candidates).sort((a, b) =>
      (entityScores.get(b) || 0) - (entityScores.get(a) || 0)
    );
    return new Set(sorted.slice(0, maxCandidates));
  }

  // If no entities found, try year-based filtering
  if (candidates.size === 0) {
    // Get year from dates or closeTime
    let year: number | undefined;
    if (leftFingerprint.dates.length > 0 && leftFingerprint.dates[0].year) {
      year = leftFingerprint.dates[0].year;
    } else if (leftCloseTime) {
      year = leftCloseTime.getFullYear();
    }

    if (year) {
      const yearMarkets = index.byYear.get(year);
      if (yearMarkets) {
        for (const id of yearMarkets) {
          candidates.add(id);
          if (candidates.size >= maxCandidates) break;
        }
      }
    }
  }

  return candidates;
}

/**
 * Calculate fuzzy title similarity using Levenshtein distance
 * Returns score 0-1 where 1 is exact match
 */
function fuzzyTitleScore(titleA: string, titleB: string): number {
  if (titleA === titleB) return 1.0;

  const maxLen = Math.max(titleA.length, titleB.length);
  if (maxLen === 0) return 0;

  const dist = distance(titleA, titleB);
  const similarity = 1 - (dist / maxLen);

  return Math.max(0, similarity);
}

/**
 * Calculate weighted match score using multiple signals
 * Weights: 0.35 entity + 0.25 date + 0.25 number + 0.10 fuzzy + 0.05 jaccard
 */
function calculateMatchScore(
  left: IndexedMarket,
  right: IndexedMarket
): { score: number; reason: string; breakdown: Record<string, number> } {
  // Entity score (0-1)
  const entScore = entityScore(left.fingerprint.entities, right.fingerprint.entities);

  // Date score (0-1)
  const leftDate = left.fingerprint.dates[0];
  const rightDate = right.fingerprint.dates[0];
  const dtScore = dateScore(leftDate, rightDate);

  // Number score (0-1)
  const numScore = numberScore(left.fingerprint.numbers, right.fingerprint.numbers);

  // Fuzzy title score (0-1)
  const fzScore = fuzzyTitleScore(left.normalizedTitle, right.normalizedTitle);

  // Jaccard score (0-1) - on tokenized titles
  const leftTokens = tokenize(left.market.title);
  const rightTokens = tokenize(right.market.title);
  const jcScore = jaccard(leftTokens, rightTokens);

  // Weighted combination
  const score =
    0.35 * entScore +
    0.25 * dtScore +
    0.25 * numScore +
    0.10 * fzScore +
    0.05 * jcScore;

  const breakdown = {
    entity: entScore,
    date: dtScore,
    number: numScore,
    fuzzy: fzScore,
    jaccard: jcScore,
  };

  const reason = `ent=${entScore.toFixed(2)} dt=${dtScore.toFixed(2)} num=${numScore.toFixed(2)} fz=${fzScore.toFixed(2)} jc=${jcScore.toFixed(2)}`;

  return { score, reason, breakdown };
}

/**
 * Debug a single market - show top candidates with breakdown
 */
async function debugMarket(
  marketId: number,
  fromVenue: CoreVenue,
  toVenue: CoreVenue,
  lookbackHours: number
): Promise<void> {
  const prisma = getClient();
  const marketRepo = new MarketRepository(prisma);

  console.log(`\n[debug] Analyzing market ID ${marketId} from ${fromVenue}...\n`);

  // Get the source market
  const leftMarkets = await marketRepo.listEligibleMarkets(fromVenue as Venue, {
    lookbackHours,
    limit: 10000,
  });

  const leftMarket = leftMarkets.find(m => m.id === marketId);
  if (!leftMarket) {
    console.error(`Market ${marketId} not found in ${fromVenue}`);
    return;
  }

  console.log(`Source market:`);
  console.log(`  ID: ${leftMarket.id}`);
  console.log(`  Title: ${leftMarket.title}`);
  console.log(`  Category: ${leftMarket.category || 'N/A'}`);
  console.log(`  Close time: ${leftMarket.closeTime?.toISOString() || 'N/A'}`);

  const leftFingerprint = buildFingerprint(leftMarket.title, leftMarket.closeTime);
  console.log(`  Entities: ${leftFingerprint.entities.join(', ') || 'none'}`);
  console.log(`  Numbers: ${leftFingerprint.numbers.join(', ') || 'none'}`);
  console.log(`  Dates: ${leftFingerprint.dates.map(d => d.raw).join(', ') || 'none'}`);
  console.log(`  Comparator: ${leftFingerprint.comparator}`);
  console.log(`  Fingerprint: ${leftFingerprint.fingerprint}`);

  // Get target markets
  console.log(`\nFetching target markets from ${toVenue}...`);
  const rightMarkets = await marketRepo.listEligibleMarkets(toVenue as Venue, {
    lookbackHours,
    limit: 10000,
  });

  console.log(`Found ${rightMarkets.length} markets from ${toVenue}`);

  // Build index
  const index = buildEntityIndex(rightMarkets);

  // Find candidates
  const candidateIds = findCandidatesByEntity(leftFingerprint, leftMarket.closeTime, index, 1000);
  console.log(`Found ${candidateIds.size} candidates by entity overlap\n`);

  // Score all candidates
  const leftIndexed: IndexedMarket = {
    market: leftMarket,
    fingerprint: leftFingerprint,
    normalizedTitle: normalizeTitleForFuzzy(leftMarket.title),
  };

  const scores: Array<{
    market: EligibleMarket;
    score: number;
    reason: string;
    breakdown: Record<string, number>;
    fingerprint: MarketFingerprint;
  }> = [];

  for (const rightId of candidateIds) {
    const rightIndexed = index.markets.get(rightId);
    if (!rightIndexed) continue;

    const result = calculateMatchScore(leftIndexed, rightIndexed);
    scores.push({
      market: rightIndexed.market,
      score: result.score,
      reason: result.reason,
      breakdown: result.breakdown,
      fingerprint: rightIndexed.fingerprint,
    });
  }

  // Sort by score
  scores.sort((a, b) => b.score - a.score);

  // Show top 20
  console.log(`Top 20 candidates:\n`);
  console.log('Rank | Score | Entity | Date   | Number | Fuzzy  | Jaccard | Title');
  console.log('-'.repeat(120));

  for (let i = 0; i < Math.min(20, scores.length); i++) {
    const s = scores[i];
    const truncTitle = s.market.title.length > 50 ? s.market.title.slice(0, 47) + '...' : s.market.title;
    console.log(
      `${String(i + 1).padStart(4)} | ${s.score.toFixed(3)} | ${s.breakdown.entity.toFixed(3)}  | ${s.breakdown.date.toFixed(3)}  | ${s.breakdown.number.toFixed(3)}  | ${s.breakdown.fuzzy.toFixed(3)}  | ${s.breakdown.jaccard.toFixed(3)}   | ${truncTitle}`
    );
  }

  console.log('\nDetailed top 5:\n');
  for (let i = 0; i < Math.min(5, scores.length); i++) {
    const s = scores[i];
    console.log(`#${i + 1} (score=${s.score.toFixed(4)}):`);
    console.log(`  Title: ${s.market.title}`);
    console.log(`  ID: ${s.market.id}`);
    console.log(`  Entities: ${s.fingerprint.entities.join(', ') || 'none'}`);
    console.log(`  Numbers: ${s.fingerprint.numbers.join(', ') || 'none'}`);
    console.log(`  Dates: ${s.fingerprint.dates.map(d => d.raw).join(', ') || 'none'}`);
    console.log(`  Breakdown: ${s.reason}`);
    console.log('');
  }
}

/**
 * Run suggest-matches job with fingerprint-based matching
 */
export async function runSuggestMatches(options: SuggestMatchesOptions): Promise<SuggestMatchesResult> {
  const {
    fromVenue,
    toVenue,
    minScore = 0.55,
    topK = 10,
    lookbackHours = 24,
    limitLeft = 2000,
    debugMarketId,
  } = options;

  // Handle debug mode
  if (debugMarketId !== undefined) {
    await debugMarket(debugMarketId, fromVenue, toVenue, lookbackHours);
    return {
      leftCount: 0,
      rightCount: 0,
      candidatesConsidered: 0,
      suggestionsCreated: 0,
      suggestionsUpdated: 0,
      skippedConfirmed: 0,
      errors: [],
    };
  }

  const prisma = getClient();
  const marketRepo = new MarketRepository(prisma);
  const linkRepo = new MarketLinkRepository(prisma);

  const result: SuggestMatchesResult = {
    leftCount: 0,
    rightCount: 0,
    candidatesConsidered: 0,
    suggestionsCreated: 0,
    suggestionsUpdated: 0,
    skippedConfirmed: 0,
    errors: [],
  };

  console.log(`[matching] Starting suggest-matches v2: ${fromVenue} -> ${toVenue}`);
  console.log(`[matching] minScore=${minScore}, topK=${topK}, lookbackHours=${lookbackHours}, limitLeft=${limitLeft}`);

  try {
    // Fetch eligible markets from both venues
    console.log(`[matching] Fetching eligible markets from ${fromVenue}...`);
    const leftMarkets = await marketRepo.listEligibleMarkets(fromVenue as Venue, {
      lookbackHours,
      limit: limitLeft,
    });
    result.leftCount = leftMarkets.length;
    console.log(`[matching] Found ${leftMarkets.length} eligible markets from ${fromVenue}`);

    console.log(`[matching] Fetching eligible markets from ${toVenue}...`);
    const rightMarkets = await marketRepo.listEligibleMarkets(toVenue as Venue, {
      lookbackHours,
      limit: 10000,
    });
    result.rightCount = rightMarkets.length;
    console.log(`[matching] Found ${rightMarkets.length} eligible markets from ${toVenue}`);

    if (leftMarkets.length === 0 || rightMarkets.length === 0) {
      console.log(`[matching] No markets to match`);
      return result;
    }

    // Build entity-based index for right markets
    console.log(`[matching] Building entity index for ${toVenue}...`);
    const index = buildEntityIndex(rightMarkets);
    console.log(`[matching] Index built: ${index.byEntity.size} unique entities, ${index.byYear.size} years`);

    // Get set of markets that already have confirmed links
    const confirmedLeft = new Set<number>();
    for (const market of leftMarkets) {
      const hasConfirmed = await linkRepo.hasConfirmedLink(fromVenue as Venue, market.id);
      if (hasConfirmed) {
        confirmedLeft.add(market.id);
      }
    }
    console.log(`[matching] ${confirmedLeft.size} markets from ${fromVenue} already have confirmed links`);

    // Process each left market
    console.log(`[matching] Processing matches...`);
    let processed = 0;
    let noEntityCount = 0;

    for (const leftMarket of leftMarkets) {
      // Skip if already has confirmed link
      if (confirmedLeft.has(leftMarket.id)) {
        result.skippedConfirmed++;
        continue;
      }

      const leftFingerprint = buildFingerprint(leftMarket.title, leftMarket.closeTime);
      const leftIndexed: IndexedMarket = {
        market: leftMarket,
        fingerprint: leftFingerprint,
        normalizedTitle: normalizeTitleForFuzzy(leftMarket.title),
      };

      // Track markets with no entities
      if (leftFingerprint.entities.length === 0) {
        noEntityCount++;
      }

      // Find candidates using entity index
      const candidateIds = findCandidatesByEntity(leftFingerprint, leftMarket.closeTime, index);
      result.candidatesConsidered += candidateIds.size;

      // Score candidates and find top-k
      const scores: Array<{ rightId: number; score: number; reason: string }> = [];

      for (const rightId of candidateIds) {
        const rightIndexed = index.markets.get(rightId);
        if (!rightIndexed) continue;

        const matchResult = calculateMatchScore(leftIndexed, rightIndexed);

        if (matchResult.score >= minScore) {
          scores.push({
            rightId,
            score: matchResult.score,
            reason: matchResult.reason,
          });
        }
      }

      // Sort by score and take top-k
      scores.sort((a, b) => b.score - a.score);
      const topCandidates = scores.slice(0, topK);

      // Save suggestions
      for (const candidate of topCandidates) {
        try {
          const upsertResult = await linkRepo.upsertSuggestion(
            fromVenue as Venue,
            leftMarket.id,
            toVenue as Venue,
            candidate.rightId,
            candidate.score,
            candidate.reason
          );

          if (upsertResult.created) {
            result.suggestionsCreated++;
          } else {
            result.suggestionsUpdated++;
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Failed to save suggestion for ${leftMarket.id}: ${errMsg}`);
        }
      }

      processed++;
      if (processed % 100 === 0) {
        console.log(`[matching] Processed ${processed}/${leftMarkets.length - confirmedLeft.size} markets...`);
      }
    }

    console.log(`\n[matching] Suggest-matches v2 complete:`);
    console.log(`  Left markets (${fromVenue}): ${result.leftCount}`);
    console.log(`  Right markets (${toVenue}): ${result.rightCount}`);
    console.log(`  Skipped (already confirmed): ${result.skippedConfirmed}`);
    console.log(`  Candidates considered: ${result.candidatesConsidered}`);
    console.log(`  Suggestions created: ${result.suggestionsCreated}`);
    console.log(`  Suggestions updated: ${result.suggestionsUpdated}`);
    console.log(`  Markets with no entities: ${noEntityCount}`);

    if (result.errors.length > 0) {
      console.log(`  Errors: ${result.errors.length}`);
    }

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errors.push(errorMsg);
    console.error(`[matching] Failed: ${errorMsg}`);
  }

  return result;
}

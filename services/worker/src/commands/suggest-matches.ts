import type { Venue as CoreVenue } from '@data-module/core';
import {
  tokenize,
  matchScore,
  buildTokenIndex,
  findCandidates,
  type MatchableMarket,
} from '@data-module/core';
import {
  getClient,
  MarketRepository,
  MarketLinkRepository,
  type Venue,
  type EligibleMarket,
} from '@data-module/db';

export interface SuggestMatchesOptions {
  fromVenue: CoreVenue;
  toVenue: CoreVenue;
  minScore?: number;
  topK?: number;
  lookbackHours?: number;
  limitLeft?: number;
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
 * Convert EligibleMarket to MatchableMarket
 */
function toMatchable(market: EligibleMarket): MatchableMarket {
  return {
    id: market.id,
    title: market.title,
    category: market.category,
    closeTime: market.closeTime,
    venue: market.venue,
  };
}

/**
 * Run suggest-matches job
 * Finds potential matches between two venues and stores suggestions
 */
export async function runSuggestMatches(options: SuggestMatchesOptions): Promise<SuggestMatchesResult> {
  const {
    fromVenue,
    toVenue,
    minScore = 0.75,
    topK = 10,
    lookbackHours = 24,
    limitLeft = 2000,
  } = options;

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

  console.log(`[matching] Starting suggest-matches: ${fromVenue} -> ${toVenue}`);
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
      limit: 10000, // Higher limit for target venue
    });
    result.rightCount = rightMarkets.length;
    console.log(`[matching] Found ${rightMarkets.length} eligible markets from ${toVenue}`);

    if (leftMarkets.length === 0 || rightMarkets.length === 0) {
      console.log(`[matching] No markets to match`);
      return result;
    }

    // Build inverted index for right markets
    console.log(`[matching] Building token index for ${toVenue}...`);
    const rightMatchable = rightMarkets.map(toMatchable);
    const tokenIndex = buildTokenIndex(rightMatchable);
    const rightMap = new Map(rightMarkets.map((m) => [m.id, m]));

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

    for (const leftMarket of leftMarkets) {
      // Skip if already has confirmed link
      if (confirmedLeft.has(leftMarket.id)) {
        result.skippedConfirmed++;
        continue;
      }

      const leftMatchable = toMatchable(leftMarket);
      const leftTokens = tokenize(leftMarket.title);

      // Find candidates using inverted index
      const candidateIds = findCandidates(leftTokens, tokenIndex);
      result.candidatesConsidered += candidateIds.size;

      // Score candidates and find top-k
      const scores: Array<{ rightId: number; score: number; reason: string }> = [];

      for (const rightId of candidateIds) {
        const rightMarket = rightMap.get(rightId);
        if (!rightMarket) continue;

        const rightMatchable = toMatchable(rightMarket);
        const result = matchScore(leftMatchable, rightMatchable);

        if (result.score >= minScore) {
          scores.push({
            rightId,
            score: result.score,
            reason: result.reason,
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

    console.log(`\n[matching] Suggest-matches complete:`);
    console.log(`  Left markets (${fromVenue}): ${result.leftCount}`);
    console.log(`  Right markets (${toVenue}): ${result.rightCount}`);
    console.log(`  Skipped (already confirmed): ${result.skippedConfirmed}`);
    console.log(`  Candidates considered: ${result.candidatesConsidered}`);
    console.log(`  Suggestions created: ${result.suggestionsCreated}`);
    console.log(`  Suggestions updated: ${result.suggestionsUpdated}`);

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

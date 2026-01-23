/**
 * Engine V3 - Unified Matching Orchestrator (v3.0.0)
 *
 * Main entry point for cross-venue market matching.
 * Uses the dispatcher to route to topic-specific pipelines.
 */

import { CanonicalTopic } from '@data-module/core';
import {
  getClient,
  MarketRepository,
  MarketLinkRepository,
} from '@data-module/db';
import {
  getPipeline,
  hasPipeline,
  getRegisteredTopics,
} from './dispatcher.js';
import type {
  EngineV3Options,
  EngineV3Result,
  EngineV3Stats,
  ScoredCandidate,
  SuggestionToWrite,
} from './engineV3.types.js';
import {
  DEFAULT_LIMITS,
  DEFAULT_MIN_SCORES,
  DEFAULT_LOOKBACK_HOURS,
} from './engineV3.types.js';

/**
 * Initialize empty stats
 */
function initStats(): EngineV3Stats {
  return {
    marketsFetched: { left: 0, right: 0 },
    marketsAfterFilter: { left: 0, right: 0 },
    indexSize: 0,
    candidatesEvaluated: 0,
    candidatesPassedGates: 0,
    candidatesAboveThreshold: 0,
    finalSuggestions: 0,
    scoreDistribution: {
      '0.9+': 0,
      '0.8-0.9': 0,
      '0.7-0.8': 0,
      '0.6-0.7': 0,
      '<0.6': 0,
    },
  };
}

/**
 * Update score distribution
 */
function updateScoreDistribution(
  distribution: EngineV3Stats['scoreDistribution'],
  score: number
): void {
  if (score >= 0.9) distribution['0.9+']++;
  else if (score >= 0.8) distribution['0.8-0.9']++;
  else if (score >= 0.7) distribution['0.7-0.8']++;
  else if (score >= 0.6) distribution['0.6-0.7']++;
  else distribution['<0.6']++;
}

/**
 * Run matching for a specific topic using V3 engine
 */
export async function runMatchingV3(options: EngineV3Options): Promise<EngineV3Result> {
  const startTime = Date.now();
  const errors: string[] = [];
  const stats = initStats();

  const {
    fromVenue,
    toVenue,
    canonicalTopic,
    lookbackHours = DEFAULT_LOOKBACK_HOURS[canonicalTopic] || 720,
    limits = DEFAULT_LIMITS[canonicalTopic] || {},
    minScore = DEFAULT_MIN_SCORES[canonicalTopic] || 0.60,
    mode = 'suggest',
    autoConfirm = false,
    autoReject = false,
    debugMarketId,
    useV3Eligibility = false,
  } = options;

  // Get pipeline for topic
  const pipeline = getPipeline(canonicalTopic);
  if (!pipeline) {
    const registered = getRegisteredTopics().join(', ');
    return {
      topic: canonicalTopic,
      algoVersion: 'unknown',
      leftCount: 0,
      rightCount: 0,
      suggestionsCreated: 0,
      autoConfirmed: 0,
      autoRejected: 0,
      durationMs: Date.now() - startTime,
      errors: [`No pipeline registered for topic ${canonicalTopic}. Registered: ${registered}`],
      stats,
    };
  }

  const algoVersion = pipeline.algoVersion;
  console.log(`[engineV3] Running ${canonicalTopic} pipeline (${algoVersion})`);
  console.log(`[engineV3] From: ${fromVenue} -> To: ${toVenue}`);
  console.log(`[engineV3] Lookback: ${lookbackHours}h, minScore: ${minScore}`);

  // Initialize repositories
  const client = getClient();
  const marketRepo = new MarketRepository(client);
  const linkRepo = new MarketLinkRepository(client);

  try {
    // ================================================================
    // Step 1: Fetch markets from both venues
    // ================================================================
    console.log('[engineV3] Step 1: Fetching markets...');

    // v3.0.14: excludeSports should be false for SPORTS topic
    const excludeSports = canonicalTopic !== CanonicalTopic.SPORTS;

    const [leftMarkets, rightMarkets] = await Promise.all([
      pipeline.fetchMarkets(marketRepo, {
        venue: fromVenue,
        lookbackHours,
        limit: limits.maxLeft || 2000,
        excludeSports,
        useV3Eligibility,
      }),
      pipeline.fetchMarkets(marketRepo, {
        venue: toVenue,
        lookbackHours,
        limit: limits.maxRight || 20000,
        excludeSports,
        useV3Eligibility,
      }),
    ]);

    stats.marketsFetched.left = leftMarkets.length;
    stats.marketsFetched.right = rightMarkets.length;
    stats.marketsAfterFilter.left = leftMarkets.length;
    stats.marketsAfterFilter.right = rightMarkets.length;

    console.log(`[engineV3] Fetched: ${leftMarkets.length} left, ${rightMarkets.length} right`);

    if (leftMarkets.length === 0 || rightMarkets.length === 0) {
      return {
        topic: canonicalTopic,
        algoVersion,
        leftCount: leftMarkets.length,
        rightCount: rightMarkets.length,
        suggestionsCreated: 0,
        autoConfirmed: 0,
        autoRejected: 0,
        durationMs: Date.now() - startTime,
        errors: leftMarkets.length === 0 ? ['No left markets found'] : ['No right markets found'],
        stats,
      };
    }

    // ================================================================
    // Step 2: Build index from right (target) markets
    // ================================================================
    console.log('[engineV3] Step 2: Building index...');
    const index = pipeline.buildIndex(rightMarkets);
    stats.indexSize = index.size;
    console.log(`[engineV3] Index size: ${index.size} keys`);

    // ================================================================
    // Step 3: Find and score candidates
    // ================================================================
    console.log('[engineV3] Step 3: Finding and scoring candidates...');
    const allCandidates: ScoredCandidate<any, any>[] = [];

    // Debug single market if specified
    const marketsToProcess = debugMarketId
      ? leftMarkets.filter((m) => m.market.id === debugMarketId)
      : leftMarkets;

    for (const leftMarket of marketsToProcess) {
      // Find candidates
      const candidates = pipeline.findCandidates(leftMarket, index);

      for (const rightMarket of candidates) {
        stats.candidatesEvaluated++;

        // Skip self-match
        if (leftMarket.market.id === rightMarket.market.id) {
          continue;
        }

        // Check hard gates
        const gateResult = pipeline.checkHardGates(leftMarket, rightMarket);
        if (!gateResult.passed) {
          continue;
        }
        stats.candidatesPassedGates++;

        // Score
        const scoreResult = pipeline.score(leftMarket, rightMarket);
        if (!scoreResult) {
          continue;
        }

        // Update distribution
        updateScoreDistribution(stats.scoreDistribution, scoreResult.score);

        // Check min score
        if (scoreResult.score >= minScore) {
          stats.candidatesAboveThreshold++;
          allCandidates.push({
            left: leftMarket,
            right: rightMarket,
            score: scoreResult,
          });
        }
      }
    }

    console.log(`[engineV3] Candidates: ${stats.candidatesEvaluated} evaluated, ${stats.candidatesPassedGates} passed gates, ${stats.candidatesAboveThreshold} above threshold`);

    // ================================================================
    // Step 4: Apply deduplication
    // ================================================================
    console.log('[engineV3] Step 4: Applying dedup...');
    const dedupedCandidates = pipeline.applyDedup(allCandidates, {
      maxPerLeft: limits.maxPerLeft,
      maxPerRight: limits.maxPerRight,
    });
    stats.finalSuggestions = dedupedCandidates.length;
    console.log(`[engineV3] After dedup: ${dedupedCandidates.length} suggestions`);

    // ================================================================
    // Step 5: Write suggestions to DB (if not dry-run)
    // ================================================================
    let suggestionsCreated = 0;
    let autoConfirmedCount = 0;
    let autoRejectedCount = 0;

    if (mode === 'suggest' && dedupedCandidates.length > 0) {
      console.log('[engineV3] Step 5: Writing suggestions to DB...');

      for (const candidate of dedupedCandidates) {
        const suggestion: SuggestionToWrite = {
          leftVenue: fromVenue,
          leftMarketId: candidate.left.market.id,
          rightVenue: toVenue,
          rightMarketId: candidate.right.market.id,
          score: candidate.score.score,
          reason: candidate.score.reason,
          algoVersion,
          topic: canonicalTopic,
        };

        // Check auto-confirm
        let status: 'suggested' | 'confirmed' | 'rejected' = 'suggested';

        if (autoConfirm && pipeline.supportsAutoConfirm && pipeline.shouldAutoConfirm) {
          const confirmResult = pipeline.shouldAutoConfirm(
            candidate.left,
            candidate.right,
            candidate.score
          );
          if (confirmResult.shouldConfirm) {
            status = 'confirmed';
            autoConfirmedCount++;
          }
        }

        // Check auto-reject (only if not already confirmed)
        if (status === 'suggested' && autoReject && pipeline.supportsAutoReject && pipeline.shouldAutoReject) {
          const rejectResult = pipeline.shouldAutoReject(
            candidate.left,
            candidate.right,
            candidate.score
          );
          if (rejectResult.shouldReject) {
            status = 'rejected';
            autoRejectedCount++;
          }
        }

        // Upsert to DB
        try {
          await linkRepo.upsertSuggestionV3({
            leftVenue: suggestion.leftVenue,
            leftMarketId: suggestion.leftMarketId,
            rightVenue: suggestion.rightVenue,
            rightMarketId: suggestion.rightMarketId,
            score: suggestion.score,
            reason: suggestion.reason,
            algoVersion: suggestion.algoVersion,
            topic: suggestion.topic,
            status,
          });
          suggestionsCreated++;
        } catch (err) {
          errors.push(`Failed to write suggestion: ${err}`);
        }
      }

      console.log(`[engineV3] Written: ${suggestionsCreated} suggestions (${autoConfirmedCount} auto-confirmed, ${autoRejectedCount} auto-rejected)`);
    } else if (mode === 'dry-run') {
      console.log('[engineV3] Dry-run mode - not writing to DB');
      suggestionsCreated = dedupedCandidates.length;

      // Still check auto-confirm/reject for stats
      if (autoConfirm && pipeline.supportsAutoConfirm && pipeline.shouldAutoConfirm) {
        for (const candidate of dedupedCandidates) {
          const confirmResult = pipeline.shouldAutoConfirm(
            candidate.left,
            candidate.right,
            candidate.score
          );
          if (confirmResult.shouldConfirm) {
            autoConfirmedCount++;
          }
        }
      }

      if (autoReject && pipeline.supportsAutoReject && pipeline.shouldAutoReject) {
        for (const candidate of dedupedCandidates) {
          const rejectResult = pipeline.shouldAutoReject(
            candidate.left,
            candidate.right,
            candidate.score
          );
          if (rejectResult.shouldReject) {
            autoRejectedCount++;
          }
        }
      }
    }

    // ================================================================
    // Return result
    // ================================================================
    const durationMs = Date.now() - startTime;
    console.log(`[engineV3] Complete in ${durationMs}ms`);

    return {
      topic: canonicalTopic,
      algoVersion,
      leftCount: leftMarkets.length,
      rightCount: rightMarkets.length,
      suggestionsCreated,
      autoConfirmed: autoConfirmedCount,
      autoRejected: autoRejectedCount,
      durationMs,
      errors,
      stats,
    };
  } catch (err) {
    return {
      topic: canonicalTopic,
      algoVersion: pipeline.algoVersion,
      leftCount: 0,
      rightCount: 0,
      suggestionsCreated: 0,
      autoConfirmed: 0,
      autoRejected: 0,
      durationMs: Date.now() - startTime,
      errors: [`Engine error: ${err}`],
      stats,
    };
  }
}

/**
 * Run matching for multiple topics
 */
export async function runMatchingV3Multi(
  topics: CanonicalTopic[],
  baseOptions: Omit<EngineV3Options, 'canonicalTopic'>
): Promise<Map<CanonicalTopic, EngineV3Result>> {
  const results = new Map<CanonicalTopic, EngineV3Result>();

  for (const topic of topics) {
    if (!hasPipeline(topic)) {
      console.log(`[engineV3] Skipping ${topic} - no pipeline registered`);
      continue;
    }

    const result = await runMatchingV3({
      ...baseOptions,
      canonicalTopic: topic,
    });
    results.set(topic, result);
  }

  return results;
}

/**
 * Print summary of engine results
 */
export function printEngineV3Summary(results: Map<CanonicalTopic, EngineV3Result>): void {
  console.log('\n=== Engine V3 Summary ===\n');

  let totalSuggestions = 0;
  let totalConfirmed = 0;
  let totalRejected = 0;

  for (const [topic, result] of results) {
    console.log(`${topic} (${result.algoVersion}):`);
    console.log(`  Markets: ${result.leftCount} left, ${result.rightCount} right`);
    console.log(`  Suggestions: ${result.suggestionsCreated}`);
    console.log(`  Auto-confirmed: ${result.autoConfirmed}`);
    console.log(`  Auto-rejected: ${result.autoRejected}`);
    console.log(`  Duration: ${result.durationMs}ms`);

    if (result.errors.length > 0) {
      console.log(`  Errors: ${result.errors.join(', ')}`);
    }

    totalSuggestions += result.suggestionsCreated;
    totalConfirmed += result.autoConfirmed;
    totalRejected += result.autoRejected;
    console.log('');
  }

  console.log('Total:');
  console.log(`  Suggestions: ${totalSuggestions}`);
  console.log(`  Auto-confirmed: ${totalConfirmed}`);
  console.log(`  Auto-rejected: ${totalRejected}`);
}

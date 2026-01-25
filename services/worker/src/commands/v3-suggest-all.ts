/**
 * V3 Suggest All Topics Command (v3.1.0)
 *
 * Runs engineV3 matching for multiple topics at once.
 * Creates links with correct topic tags for auto-confirm/auto-reject.
 */

import type { Venue } from '@data-module/core';
import { CanonicalTopic } from '@data-module/core';
import { runV3SuggestMatches } from './v3-suggest-matches.js';
import { registerAllPipelines, getRegisteredTopics, IMPLEMENTED_TOPICS } from '../matching/index.js';

export interface V3SuggestAllOptions {
  fromVenue: Venue;
  toVenue: Venue;
  topics?: string[];        // Topic names or empty for all
  lookbackHours?: number;
  limitLeft?: number;
  limitRight?: number;
  minScore?: number;
  dryRun?: boolean;
  autoConfirm?: boolean;
  autoReject?: boolean;
}

export async function runV3SuggestAll(options: V3SuggestAllOptions): Promise<void> {
  const {
    fromVenue,
    toVenue,
    topics,
    lookbackHours,
    limitLeft = 5000,
    limitRight = 50000,
    minScore,
    dryRun = false,
    autoConfirm = false,
    autoReject = false,
  } = options;

  // Register all pipelines
  registerAllPipelines();

  console.log('\\n============================================================');
  console.log('[v3:suggest-all] Cross-Venue Matching for All Topics (v3.1.0)');
  console.log('============================================================');
  console.log(`From: ${fromVenue} → To: ${toVenue}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : '⚠️  APPLY'}`);
  console.log(`Lookback: ${lookbackHours ?? 'default per-topic'}`);
  console.log(`Min Score: ${minScore ?? 'default per-topic'}`);
  console.log(`Limits: left=${limitLeft}, right=${limitRight}`);
  console.log(`Auto-confirm: ${autoConfirm}, Auto-reject: ${autoReject}`);

  // Determine which topics to process
  let topicsToProcess: string[];

  if (topics && topics.length > 0) {
    topicsToProcess = topics;
  } else {
    // Get all registered topics, exclude UNIVERSAL (fallback)
    const registered = getRegisteredTopics();
    topicsToProcess = registered
      .filter(t => t !== CanonicalTopic.UNIVERSAL && IMPLEMENTED_TOPICS.includes(t));
  }

  console.log(`\\nTopics (${topicsToProcess.length}): ${topicsToProcess.join(', ')}`);

  let totalSuggestions = 0;
  let totalConfirmed = 0;
  let totalRejected = 0;
  const results: Array<{
    topic: string;
    ok: boolean;
    suggestions: number;
    confirmed: number;
    rejected: number;
    errors: string[];
  }> = [];

  // Run matching for each topic sequentially
  for (const topic of topicsToProcess) {
    console.log(`\\n────────────────────────────────────────`);
    console.log(`[Topic] ${topic}`);
    console.log(`────────────────────────────────────────`);

    try {
      const result = await runV3SuggestMatches({
        fromVenue,
        toVenue,
        topic,
        lookbackHours,
        limitLeft,
        limitRight,
        minScore,
        dryRun,
        autoConfirm,
        autoReject,
        useV3Eligibility: true,
      });

      totalSuggestions += result.suggestionsCreated;
      totalConfirmed += result.autoConfirmed;
      totalRejected += result.autoRejected;

      results.push({
        topic,
        ok: result.ok,
        suggestions: result.suggestionsCreated,
        confirmed: result.autoConfirmed,
        rejected: result.autoRejected,
        errors: result.errors,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[${topic}] Failed: ${errorMsg}`);
      results.push({
        topic,
        ok: false,
        suggestions: 0,
        confirmed: 0,
        rejected: 0,
        errors: [errorMsg],
      });
    }
  }

  // Print summary
  console.log('\\n============================================================');
  console.log('[Summary]');
  console.log('============================================================');
  console.log(`Total Suggestions: ${totalSuggestions}`);
  console.log(`Total Confirmed:   ${totalConfirmed}`);
  console.log(`Total Rejected:    ${totalRejected}`);

  console.log('\\n[By Topic]');
  for (const result of results) {
    const status = result.ok ? '✓' : '❌';
    console.log(
      `  ${status} ${result.topic.padEnd(18)} ` +
      `suggestions=${result.suggestions.toString().padStart(4)} ` +
      `confirmed=${result.confirmed.toString().padStart(3)} ` +
      `rejected=${result.rejected.toString().padStart(3)}`
    );
    if (result.errors.length > 0) {
      for (const err of result.errors) {
        console.log(`      Error: ${err}`);
      }
    }
  }

  if (dryRun) {
    console.log('\\n[DRY RUN] No changes made. Run without --dry-run to create suggestions.');
  } else {
    console.log('\\n[APPLIED] Suggestions written to database.');
    console.log('\\nNext steps:');
    console.log('  1. node services/worker/dist/cli.js links:stats');
    console.log('  2. node services/worker/dist/cli.js links:auto-confirm --apply');
    console.log('  3. node services/worker/dist/cli.js links:auto-reject --apply');
    console.log('  4. node services/worker/dist/cli.js links:watchlist:sync');
  }

  console.log('\\nDone.');
}

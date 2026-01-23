/**
 * V3 Suggest Matches Command (v3.0.0)
 *
 * Runs the V3 matching engine for a specific topic.
 */

import type { Venue as CoreVenue, CanonicalTopic } from '@data-module/core';
import {
  runMatchingV3,
  registerAllPipelines,
  getRegisteredTopics,
  parseTopicString,
  type EngineV3Options,
} from '../matching/index.js';

export interface V3SuggestMatchesOptions {
  fromVenue: CoreVenue;
  toVenue: CoreVenue;
  topic: string;
  lookbackHours?: number;
  limitLeft?: number;
  limitRight?: number;
  maxPerLeft?: number;
  maxPerRight?: number;
  minScore?: number;
  dryRun?: boolean;
  autoConfirm?: boolean;
  autoReject?: boolean;
  debugMarketId?: number;
  useV3Eligibility?: boolean;  // v3.0.14: MVE filtering for SPORTS
}

export interface V3SuggestMatchesResult {
  ok: boolean;
  topic: CanonicalTopic;
  suggestionsCreated: number;
  autoConfirmed: number;
  autoRejected: number;
  errors: string[];
}

export async function runV3SuggestMatches(options: V3SuggestMatchesOptions): Promise<V3SuggestMatchesResult> {
  const {
    fromVenue,
    toVenue,
    topic,
    lookbackHours = 720,
    limitLeft = 2000,
    limitRight = 20000,
    maxPerLeft = 5,
    maxPerRight = 5,
    minScore = 0.60,
    dryRun = false,
    autoConfirm = false,
    autoReject = false,
    debugMarketId,
    useV3Eligibility,
  } = options;

  // Register pipelines
  registerAllPipelines();

  // Parse topic
  const canonicalTopic = parseTopicString(topic);
  if (!canonicalTopic) {
    const validTopics = getRegisteredTopics().join(', ');
    console.error(`Invalid topic: ${topic}. Valid topics: ${validTopics}`);
    return {
      ok: false,
      topic: 'UNKNOWN' as CanonicalTopic,
      suggestionsCreated: 0,
      autoConfirmed: 0,
      autoRejected: 0,
      errors: [`Invalid topic: ${topic}`],
    };
  }

  // Check if pipeline is registered
  const registeredTopics = getRegisteredTopics();
  if (!registeredTopics.includes(canonicalTopic)) {
    console.error(`No pipeline registered for topic: ${canonicalTopic}`);
    console.error(`Registered topics: ${registeredTopics.join(', ')}`);
    return {
      ok: false,
      topic: canonicalTopic,
      suggestionsCreated: 0,
      autoConfirmed: 0,
      autoRejected: 0,
      errors: [`No pipeline for topic: ${canonicalTopic}`],
    };
  }

  // v3.0.14: Default to V3 eligibility for SPORTS topic (MVE filtering)
  const effectiveUseV3Eligibility = useV3Eligibility ?? (canonicalTopic === 'SPORTS');

  console.log('\n=== V3 Suggest Matches ===\n');
  console.log(`Topic: ${canonicalTopic}`);
  console.log(`From: ${fromVenue} -> To: ${toVenue}`);
  console.log(`Lookback: ${lookbackHours}h`);
  console.log(`Limits: ${limitLeft} left, ${limitRight} right, ${maxPerLeft}/left, ${maxPerRight}/right`);
  console.log(`Min score: ${minScore}`);
  console.log(`Mode: ${dryRun ? 'dry-run' : 'suggest'}`);
  console.log(`Auto-confirm: ${autoConfirm}, Auto-reject: ${autoReject}`);
  console.log(`V3 Eligibility: ${effectiveUseV3Eligibility}`);
  if (debugMarketId) {
    console.log(`Debug market ID: ${debugMarketId}`);
  }

  // Run engine
  const engineOptions: EngineV3Options = {
    fromVenue: fromVenue as any,
    toVenue: toVenue as any,
    canonicalTopic,
    lookbackHours,
    limits: {
      maxLeft: limitLeft,
      maxRight: limitRight,
      maxPerLeft,
      maxPerRight,
    },
    minScore,
    mode: dryRun ? 'dry-run' : 'suggest',
    autoConfirm,
    autoReject,
    debugMarketId,
    useV3Eligibility: effectiveUseV3Eligibility,
  };

  const result = await runMatchingV3(engineOptions);

  // Print summary
  console.log('\n--- Result ---');
  console.log(`Topic: ${result.topic} (${result.algoVersion})`);
  console.log(`Markets: ${result.leftCount} left, ${result.rightCount} right`);
  console.log(`Suggestions: ${result.suggestionsCreated}`);
  console.log(`Auto-confirmed: ${result.autoConfirmed}`);
  console.log(`Auto-rejected: ${result.autoRejected}`);
  console.log(`Duration: ${result.durationMs}ms`);

  if (result.errors.length > 0) {
    console.log(`Errors: ${result.errors.join(', ')}`);
  }

  // Print score distribution
  console.log('\nScore distribution:');
  console.log(`  0.9+:    ${result.stats.scoreDistribution['0.9+']}`);
  console.log(`  0.8-0.9: ${result.stats.scoreDistribution['0.8-0.9']}`);
  console.log(`  0.7-0.8: ${result.stats.scoreDistribution['0.7-0.8']}`);
  console.log(`  0.6-0.7: ${result.stats.scoreDistribution['0.6-0.7']}`);
  console.log(`  <0.6:    ${result.stats.scoreDistribution['<0.6']}`);

  return {
    ok: result.errors.length === 0,
    topic: result.topic,
    suggestionsCreated: result.suggestionsCreated,
    autoConfirmed: result.autoConfirmed,
    autoRejected: result.autoRejected,
    errors: result.errors,
  };
}

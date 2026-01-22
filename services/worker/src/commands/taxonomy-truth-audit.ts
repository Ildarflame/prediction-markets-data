/**
 * Taxonomy Truth Audit Command (v3.0.1)
 *
 * Validates taxonomy classification accuracy by checking:
 * 1. Known markets (ground truth examples)
 * 2. Random samples from each topic
 * 3. UNKNOWN classification rates
 */

import { getClient } from '@data-module/db';
import {
  CanonicalTopic,
  classifyMarket,
  classifyKalshiMarketWithSeries,
  extractSeriesTickerFromEvent,
  isMatchableTopic,
} from '@data-module/core';

export interface TaxonomyTruthAuditOptions {
  venue?: 'kalshi' | 'polymarket';
  topic?: CanonicalTopic;
  sampleSize?: number;
  showMisclassified?: boolean;
}

export interface TaxonomyTruthAuditResult {
  venue: string;
  totalMarkets: number;
  classifiedMarkets: number;
  unknownMarkets: number;
  unknownRate: number;
  topicDistribution: Record<string, number>;
  misclassifiedSamples: Array<{
    id: number;
    title: string;
    expected: CanonicalTopic;
    actual: CanonicalTopic;
    reason: string;
  }>;
  ok: boolean;
}

/**
 * Ground truth examples for validation
 * Format: { title pattern -> expected topic }
 */
const GROUND_TRUTH_KALSHI: Array<{ pattern: RegExp; expected: CanonicalTopic }> = [
  // Crypto
  { pattern: /bitcoin.*\$?\d+,?\d*k?/i, expected: CanonicalTopic.CRYPTO_DAILY },
  { pattern: /btc.*price/i, expected: CanonicalTopic.CRYPTO_DAILY },
  { pattern: /ethereum.*\$?\d+,?\d*k?/i, expected: CanonicalTopic.CRYPTO_DAILY },
  { pattern: /eth.*price/i, expected: CanonicalTopic.CRYPTO_DAILY },

  // Macro
  { pattern: /cpi.*[0-9.]+%/i, expected: CanonicalTopic.MACRO },
  { pattern: /inflation.*[0-9.]+%/i, expected: CanonicalTopic.MACRO },
  { pattern: /gdp.*q[1-4]/i, expected: CanonicalTopic.MACRO },
  { pattern: /unemployment.*[0-9.]+%/i, expected: CanonicalTopic.MACRO },
  { pattern: /nonfarm payrolls/i, expected: CanonicalTopic.MACRO },

  // Rates
  { pattern: /fed.*rate.*cut/i, expected: CanonicalTopic.RATES },
  { pattern: /fomc.*rate/i, expected: CanonicalTopic.RATES },
  { pattern: /interest rate.*[0-9.]+%/i, expected: CanonicalTopic.RATES },
  { pattern: /fed funds/i, expected: CanonicalTopic.RATES },

  // Elections
  { pattern: /president.*win/i, expected: CanonicalTopic.ELECTIONS },
  { pattern: /election.*president/i, expected: CanonicalTopic.ELECTIONS },
  { pattern: /senate.*win/i, expected: CanonicalTopic.ELECTIONS },
  { pattern: /governor.*win/i, expected: CanonicalTopic.ELECTIONS },
  { pattern: /trump.*president/i, expected: CanonicalTopic.ELECTIONS },
];

const GROUND_TRUTH_POLYMARKET: Array<{ pattern: RegExp; expected: CanonicalTopic }> = [
  // Crypto
  { pattern: /bitcoin.*\$?\d+,?\d*k?/i, expected: CanonicalTopic.CRYPTO_DAILY },
  { pattern: /btc.*price/i, expected: CanonicalTopic.CRYPTO_DAILY },
  { pattern: /ethereum.*\$?\d+,?\d*k?/i, expected: CanonicalTopic.CRYPTO_DAILY },

  // Macro
  { pattern: /cpi.*[0-9.]+%/i, expected: CanonicalTopic.MACRO },
  { pattern: /inflation.*[0-9.]+%/i, expected: CanonicalTopic.MACRO },

  // Elections
  { pattern: /president.*win/i, expected: CanonicalTopic.ELECTIONS },
  { pattern: /will.*win.*election/i, expected: CanonicalTopic.ELECTIONS },
  { pattern: /trump.*\d{4}/i, expected: CanonicalTopic.ELECTIONS },
];

export async function runTaxonomyTruthAudit(
  options: TaxonomyTruthAuditOptions = {}
): Promise<TaxonomyTruthAuditResult> {
  const {
    venue = 'kalshi',
    topic,
    sampleSize = 100,
    showMisclassified = true,
  } = options;

  console.log(`\n=== Taxonomy Truth Audit (v3.0.1) ===\n`);
  console.log(`Venue: ${venue}`);
  if (topic) console.log(`Topic filter: ${topic}`);
  console.log(`Sample size: ${sampleSize}\n`);

  const client = getClient();

  // Fetch recent eligible markets
  const markets = await client.market.findMany({
    where: {
      venue,
      status: 'active',
      closeTime: { gte: new Date() },
    },
    select: {
      id: true,
      externalId: true,
      title: true,
      category: true,
      metadata: true,
      derivedTopic: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: sampleSize * 10, // Get more to have samples for each topic
  });

  console.log(`Fetched ${markets.length} eligible markets\n`);

  // Load Kalshi series for metadata classification
  let seriesMap = new Map<string, { category: string; tags: string[] }>();
  if (venue === 'kalshi') {
    const series = await client.kalshiSeries.findMany({
      select: { ticker: true, category: true, tags: true },
    });
    for (const s of series) {
      seriesMap.set(s.ticker, { category: s.category || '', tags: s.tags });
    }
    console.log(`Loaded ${seriesMap.size} Kalshi series for lookup\n`);
  }

  // Classify markets and track results
  const topicDistribution: Record<string, number> = {};
  const misclassifiedSamples: TaxonomyTruthAuditResult['misclassifiedSamples'] = [];
  let unknownCount = 0;

  const groundTruth = venue === 'kalshi' ? GROUND_TRUTH_KALSHI : GROUND_TRUTH_POLYMARKET;

  for (const market of markets) {
    // Classify using current taxonomy rules
    let classification;

    if (venue === 'kalshi') {
      // Try series-based classification first
      const eventTicker = market.externalId;
      const seriesTicker = extractSeriesTickerFromEvent(eventTicker);
      const seriesData = seriesTicker ? seriesMap.get(seriesTicker) : null;

      if (seriesData) {
        classification = classifyKalshiMarketWithSeries(seriesData.category, seriesData.tags);
      }

      if (!classification || classification.topic === CanonicalTopic.UNKNOWN) {
        classification = classifyMarket({
          venue,
          title: market.title,
          category: market.category || undefined,
          metadata: market.metadata as Record<string, unknown> | undefined,
        });
      }
    } else {
      classification = classifyMarket({
        venue,
        title: market.title,
        category: market.category || undefined,
        metadata: market.metadata as Record<string, unknown> | undefined,
      });
    }

    const classifiedTopic = classification.topic;

    // Count topic distribution
    topicDistribution[classifiedTopic] = (topicDistribution[classifiedTopic] || 0) + 1;

    if (classifiedTopic === CanonicalTopic.UNKNOWN) {
      unknownCount++;
    }

    // Check against ground truth
    for (const gt of groundTruth) {
      if (gt.pattern.test(market.title)) {
        if (classifiedTopic !== gt.expected && showMisclassified) {
          if (misclassifiedSamples.length < 20) {
            misclassifiedSamples.push({
              id: market.id,
              title: market.title.slice(0, 80),
              expected: gt.expected,
              actual: classifiedTopic,
              reason: classification.reason || 'unknown',
            });
          }
        }
        break;
      }
    }
  }

  // Print results
  console.log('--- Topic Distribution ---');
  const sortedTopics = Object.entries(topicDistribution).sort((a, b) => b[1] - a[1]);
  for (const [t, count] of sortedTopics) {
    const pct = ((count / markets.length) * 100).toFixed(1);
    const matchable = isMatchableTopic(t as CanonicalTopic) ? '✓' : ' ';
    console.log(`  ${matchable} ${t.padEnd(18)} ${String(count).padStart(5)} (${pct}%)`);
  }

  const unknownRate = markets.length > 0 ? unknownCount / markets.length : 0;
  console.log(`\n--- Summary ---`);
  console.log(`Total markets: ${markets.length}`);
  console.log(`Unknown: ${unknownCount} (${(unknownRate * 100).toFixed(1)}%)`);
  console.log(`Classified (non-UNKNOWN): ${markets.length - unknownCount}`);

  // Matchable topics coverage
  const matchableCount = Object.entries(topicDistribution)
    .filter(([t]) => isMatchableTopic(t as CanonicalTopic))
    .reduce((sum, [, count]) => sum + count, 0);
  console.log(`Matchable topics: ${matchableCount} (${((matchableCount / markets.length) * 100).toFixed(1)}%)`);

  if (misclassifiedSamples.length > 0) {
    console.log(`\n--- Misclassified Samples (${misclassifiedSamples.length}) ---`);
    for (const sample of misclassifiedSamples.slice(0, 10)) {
      console.log(`  [${sample.id}] ${sample.title}`);
      console.log(`    Expected: ${sample.expected}, Got: ${sample.actual}`);
      console.log(`    Reason: ${sample.reason}`);
    }
  }

  // UNKNOWN samples
  if (unknownCount > 0) {
    console.log(`\n--- UNKNOWN Samples ---`);
    const unknownSamples = markets
      .filter((m) => {
        const classification = classifyMarket({
          venue,
          title: m.title,
          category: m.category || undefined,
          metadata: m.metadata as Record<string, unknown> | undefined,
        });
        return classification.topic === CanonicalTopic.UNKNOWN;
      })
      .slice(0, 10);

    for (const sample of unknownSamples) {
      console.log(`  [${sample.id}] ${sample.title.slice(0, 70)}`);
      console.log(`    Category: ${sample.category || 'none'}`);
    }
  }

  // Determine if audit passed
  const ok = unknownRate < 0.30; // Pass if less than 30% UNKNOWN

  console.log(`\n--- Verdict: ${ok ? 'PASS' : 'FAIL'} ---`);
  if (!ok) {
    console.log(`UNKNOWN rate ${(unknownRate * 100).toFixed(1)}% exceeds 30% threshold`);
  }

  return {
    venue,
    totalMarkets: markets.length,
    classifiedMarkets: markets.length - unknownCount,
    unknownMarkets: unknownCount,
    unknownRate,
    topicDistribution,
    misclassifiedSamples,
    ok,
  };
}

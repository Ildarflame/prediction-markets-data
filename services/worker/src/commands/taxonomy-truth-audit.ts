/**
 * Taxonomy Truth Audit Command (v3.0.2)
 *
 * Validates taxonomy classification accuracy by checking:
 * 1. Known markets (ground truth examples)
 * 2. Random samples from each topic
 * 3. UNKNOWN classification rates
 *
 * v3.0.2: Added CSV output, pmCategories/pmTags display, V2 classifier for Polymarket
 */

import * as fs from 'node:fs';
import { getClient } from '@data-module/db';
import {
  CanonicalTopic,
  classifyMarket,
  classifyPolymarketMarketV2,
  extractSeriesTickerFromEvent,
  isMatchableTopic,
  classifyKalshiSeries,
} from '@data-module/core';

export interface TaxonomyTruthAuditOptions {
  venue?: 'kalshi' | 'polymarket';
  topic?: CanonicalTopic;
  sampleSize?: number;
  showMisclassified?: boolean;
  csvOutput?: string;
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
  unknownSamples: Array<{
    id: number;
    title: string;
    category: string | null;
    pmCategories: string[];
    pmTags: string[];
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
  { pattern: /federal reserve.*cut/i, expected: CanonicalTopic.RATES },
  { pattern: /federal reserve.*hike/i, expected: CanonicalTopic.RATES },

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

/**
 * Extract pmCategories from market data
 */
function extractPmCategories(market: { pmCategories?: unknown }): string[] {
  if (!market.pmCategories || !Array.isArray(market.pmCategories)) return [];
  return market.pmCategories
    .map((c: { slug?: string; label?: string }) => c.slug || c.label || '')
    .filter(Boolean);
}

/**
 * Extract pmTags from market data
 */
function extractPmTags(market: { pmTags?: unknown }): string[] {
  if (!market.pmTags || !Array.isArray(market.pmTags)) return [];
  return market.pmTags
    .map((t: { slug?: string; label?: string }) => t.slug || t.label || '')
    .filter(Boolean);
}

export async function runTaxonomyTruthAudit(
  options: TaxonomyTruthAuditOptions = {}
): Promise<TaxonomyTruthAuditResult> {
  const {
    venue = 'kalshi',
    topic,
    sampleSize = 100,
    showMisclassified = true,
    csvOutput,
  } = options;

  console.log(`\n=== Taxonomy Truth Audit (v3.0.2) ===\n`);
  console.log(`Venue: ${venue}`);
  if (topic) console.log(`Topic filter: ${topic}`);
  console.log(`Sample size: ${sampleSize}`);
  if (csvOutput) console.log(`CSV output: ${csvOutput}`);
  console.log();

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
      // v3.0.2: Include PM taxonomy fields
      pmCategories: true,
      pmTags: true,
      pmEventCategory: true,
      pmEventSubcategory: true,
      taxonomySource: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: sampleSize * 10, // Get more to have samples for each topic
  });

  console.log(`Fetched ${markets.length} eligible markets\n`);

  // Load Kalshi series for metadata classification
  let seriesMap = new Map<string, { category: string; tags: string[]; title: string }>();
  if (venue === 'kalshi') {
    const series = await client.kalshiSeries.findMany({
      select: { ticker: true, category: true, tags: true, title: true },
    });
    for (const s of series) {
      seriesMap.set(s.ticker, { category: s.category || '', tags: s.tags, title: s.title });
    }
    console.log(`Loaded ${seriesMap.size} Kalshi series for lookup\n`);
  }

  // Classify markets and track results
  const topicDistribution: Record<string, number> = {};
  const misclassifiedSamples: TaxonomyTruthAuditResult['misclassifiedSamples'] = [];
  const unknownSamples: TaxonomyTruthAuditResult['unknownSamples'] = [];
  let unknownCount = 0;

  const groundTruth = venue === 'kalshi' ? GROUND_TRUTH_KALSHI : GROUND_TRUTH_POLYMARKET;

  // CSV rows for export
  const csvRows: string[][] = [[
    'id', 'title', 'category', 'pmCategories', 'pmTags', 'classifiedTopic', 'confidence', 'reason', 'matchesGroundTruth'
  ]];

  for (const market of markets) {
    // Classify using current taxonomy rules
    let classification;

    if (venue === 'kalshi') {
      // Try series-based classification first
      const eventTicker = market.externalId;
      const seriesTicker = extractSeriesTickerFromEvent(eventTicker);
      const seriesData = seriesTicker ? seriesMap.get(seriesTicker) : null;

      if (seriesData) {
        // Use classifyKalshiSeries with title for RATES override
        classification = classifyKalshiSeries({
          ticker: seriesTicker || '',
          title: seriesData.title,
          category: seriesData.category,
          tags: seriesData.tags,
        });
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
      // v3.0.2: Use V2 classifier for Polymarket
      const pmCats = extractPmCategories(market);
      const pmTgs = extractPmTags(market);

      classification = classifyPolymarketMarketV2({
        title: market.title,
        category: market.category || undefined,
        groupItemTitle: (market.metadata as any)?.groupItemTitle,
        tags: (market.metadata as any)?.tags,
        pmCategories: pmCats.length > 0 ? pmCats.map(s => ({ slug: s, label: s })) : undefined,
        pmTags: pmTgs.length > 0 ? pmTgs.map(s => ({ slug: s, label: s })) : undefined,
        pmEventCategory: market.pmEventCategory || undefined,
        pmEventSubcategory: market.pmEventSubcategory || undefined,
      });
    }

    const classifiedTopic = classification.topic;

    // Count topic distribution
    topicDistribution[classifiedTopic] = (topicDistribution[classifiedTopic] || 0) + 1;

    if (classifiedTopic === CanonicalTopic.UNKNOWN) {
      unknownCount++;

      // Collect unknown samples with metadata
      if (unknownSamples.length < 30) {
        unknownSamples.push({
          id: market.id,
          title: market.title.slice(0, 70),
          category: market.category,
          pmCategories: extractPmCategories(market),
          pmTags: extractPmTags(market),
          reason: classification.reason || 'unknown',
        });
      }
    }

    // Check against ground truth
    let matchesGroundTruth = '';
    for (const gt of groundTruth) {
      if (gt.pattern.test(market.title)) {
        if (classifiedTopic === gt.expected) {
          matchesGroundTruth = 'yes';
        } else {
          matchesGroundTruth = 'no';
          if (showMisclassified && misclassifiedSamples.length < 20) {
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

    // Add to CSV
    csvRows.push([
      String(market.id),
      market.title.slice(0, 100).replace(/,/g, ';'),
      market.category || '',
      extractPmCategories(market).join('|'),
      extractPmTags(market).join('|'),
      classifiedTopic,
      String(classification.confidence),
      classification.reason || '',
      matchesGroundTruth,
    ]);
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

  // UNKNOWN samples with metadata (v3.0.2)
  if (unknownSamples.length > 0) {
    console.log(`\n--- UNKNOWN Samples (${unknownSamples.length}) ---`);
    for (const sample of unknownSamples.slice(0, 10)) {
      console.log(`  [${sample.id}] ${sample.title}`);
      console.log(`    Category: ${sample.category || '(none)'}`);
      if (sample.pmCategories.length > 0) {
        console.log(`    pmCategories: ${sample.pmCategories.join(', ')}`);
      }
      if (sample.pmTags.length > 0) {
        console.log(`    pmTags: ${sample.pmTags.join(', ')}`);
      }
      console.log(`    Reason: ${sample.reason}`);
    }
  }

  // Write CSV output
  if (csvOutput) {
    const csv = csvRows.map(row => row.join(',')).join('\n');
    fs.writeFileSync(csvOutput, csv);
    console.log(`\nCSV written to: ${csvOutput}`);
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
    unknownSamples,
    ok,
  };
}

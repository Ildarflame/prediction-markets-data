/**
 * Taxonomy Truth Audit Command (v3.0.3)
 *
 * Validates taxonomy classification accuracy by checking:
 * 1. Known markets (ground truth examples)
 * 2. Random samples from each topic
 * 3. UNKNOWN classification rates
 * 4. taxonomySource distribution
 *
 * v3.0.2: Added CSV output, pmCategories/pmTags display, V2 classifier
 * v3.0.3: V3 classifier with event-level tags, taxonomySource tracking, SPORTS detection
 */

import * as fs from 'node:fs';
import { getClient } from '@data-module/db';
import {
  CanonicalTopic,
  classifyMarket,
  classifyPolymarketMarketV3,
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
  taxonomySourceDistribution: Record<string, number>;
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
    eventTags: string[];
    reason: string;
  }>;
  ok: boolean;
}

/**
 * Ground truth examples for Kalshi
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

/**
 * Ground truth examples for Polymarket (v3.0.3: added sports)
 */
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

  // Sports (v3.0.3)
  { pattern: /\b(nba|nfl|mlb|nhl)\b.*spread/i, expected: CanonicalTopic.SPORTS },
  { pattern: /\bspread:?\s*[+-]?\d+\.?\d*/i, expected: CanonicalTopic.SPORTS },
  { pattern: /\bo\/u\s*\d+\.?\d*/i, expected: CanonicalTopic.SPORTS },
  { pattern: /super bowl/i, expected: CanonicalTopic.SPORTS },
  { pattern: /\bvs\.?\s+\w+.*winner/i, expected: CanonicalTopic.SPORTS },
];

/**
 * Extract tags from event data
 */
function extractEventTags(eventTags: unknown): Array<{ slug: string; label: string }> {
  if (!eventTags || !Array.isArray(eventTags)) return [];
  return eventTags
    .filter((t): t is { slug?: string; label?: string } => typeof t === 'object' && t !== null)
    .map(t => ({ slug: t.slug || '', label: t.label || '' }))
    .filter(t => t.slug || t.label);
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

  console.log(`\n=== Taxonomy Truth Audit (v3.0.3) ===\n`);
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
      pmCategories: true,
      pmTags: true,
      pmEventCategory: true,
      pmEventSubcategory: true,
      pmEventId: true,
      taxonomySource: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: sampleSize * 10,
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

  // Load Polymarket events for event-level tags (v3.0.3)
  let eventMap = new Map<string, { tags: unknown; category: string | null }>();
  let sportsSeriesSet = new Set<string>();
  if (venue === 'polymarket') {
    const events = await client.polymarketEvent.findMany({
      select: { externalId: true, tags: true, category: true, seriesId: true },
    });
    for (const e of events) {
      eventMap.set(e.externalId, { tags: e.tags, category: e.category });
    }
    console.log(`Loaded ${eventMap.size} Polymarket events for lookup`);

    // Load sports config
    const sports = await client.polymarketSport.findMany({
      select: { sport: true, seriesIds: true },
    });
    for (const s of sports) {
      for (const sid of s.seriesIds) {
        sportsSeriesSet.add(sid);
      }
    }
    console.log(`Loaded ${sports.length} sports configurations\n`);
  }

  // Classify markets and track results
  const topicDistribution: Record<string, number> = {};
  const taxonomySourceDistribution: Record<string, number> = {};
  const misclassifiedSamples: TaxonomyTruthAuditResult['misclassifiedSamples'] = [];
  const unknownSamples: TaxonomyTruthAuditResult['unknownSamples'] = [];
  let unknownCount = 0;

  const groundTruth = venue === 'kalshi' ? GROUND_TRUTH_KALSHI : GROUND_TRUTH_POLYMARKET;

  // CSV rows for export
  const csvRows: string[][] = [[
    'id', 'title', 'category', 'eventTags', 'classifiedTopic', 'taxonomySource', 'confidence', 'reason', 'matchesGroundTruth'
  ]];

  for (const market of markets) {
    let classification: { topic: CanonicalTopic; confidence: number; reason?: string; taxonomySource?: string };

    if (venue === 'kalshi') {
      // Try series-based classification first
      const eventTicker = market.externalId;
      const seriesTicker = extractSeriesTickerFromEvent(eventTicker);
      const seriesData = seriesTicker ? seriesMap.get(seriesTicker) : null;

      if (seriesData) {
        const result = classifyKalshiSeries({
          ticker: seriesTicker || '',
          title: seriesData.title,
          category: seriesData.category,
          tags: seriesData.tags,
        });
        classification = { ...result, taxonomySource: 'KALSHI_SERIES' };
      } else {
        const result = classifyMarket({
          venue,
          title: market.title,
          category: market.category || undefined,
          metadata: market.metadata as Record<string, unknown> | undefined,
        });
        classification = { ...result, taxonomySource: 'KALSHI_CATEGORY' };
      }
    } else {
      // v3.0.3: Use V3 classifier with event-level tags
      const eventData = market.pmEventId ? eventMap.get(market.pmEventId) : null;
      const eventTags = eventData ? extractEventTags(eventData.tags) : [];

      classification = classifyPolymarketMarketV3({
        title: market.title,
        category: market.category || undefined,
        groupItemTitle: (market.metadata as any)?.groupItemTitle,
        tags: (market.metadata as any)?.tags,
        pmCategories: market.pmCategories as any,
        pmTags: market.pmTags as any,
        pmEventCategory: market.pmEventCategory || eventData?.category || undefined,
        pmEventSubcategory: market.pmEventSubcategory || undefined,
        eventTags: eventTags.length > 0 ? eventTags : undefined,
        eventCategory: eventData?.category || undefined,
      });
    }

    const classifiedTopic = classification.topic;
    const taxonomySource = classification.taxonomySource || 'UNKNOWN';

    // Count distributions
    topicDistribution[classifiedTopic] = (topicDistribution[classifiedTopic] || 0) + 1;
    taxonomySourceDistribution[taxonomySource] = (taxonomySourceDistribution[taxonomySource] || 0) + 1;

    if (classifiedTopic === CanonicalTopic.UNKNOWN) {
      unknownCount++;

      // Collect unknown samples
      if (unknownSamples.length < 30) {
        const eventData = market.pmEventId ? eventMap.get(market.pmEventId) : null;
        const eventTags = eventData ? extractEventTags(eventData.tags) : [];

        unknownSamples.push({
          id: market.id,
          title: market.title.slice(0, 70),
          category: market.category,
          eventTags: eventTags.map(t => t.slug || t.label),
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
    const eventData = market.pmEventId ? eventMap.get(market.pmEventId) : null;
    const eventTags = eventData ? extractEventTags(eventData.tags) : [];

    csvRows.push([
      String(market.id),
      market.title.slice(0, 100).replace(/,/g, ';'),
      market.category || '',
      eventTags.map(t => t.slug).join('|'),
      classifiedTopic,
      taxonomySource,
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

  // v3.0.3: Show taxonomySource distribution
  console.log('\n--- Taxonomy Source Distribution ---');
  const sortedSources = Object.entries(taxonomySourceDistribution).sort((a, b) => b[1] - a[1]);
  for (const [src, count] of sortedSources) {
    const pct = ((count / markets.length) * 100).toFixed(1);
    console.log(`  ${src.padEnd(20)} ${String(count).padStart(5)} (${pct}%)`);
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

  // UNKNOWN samples with event tags (v3.0.3)
  if (unknownSamples.length > 0) {
    console.log(`\n--- UNKNOWN Samples (${unknownSamples.length}) ---`);
    for (const sample of unknownSamples.slice(0, 10)) {
      console.log(`  [${sample.id}] ${sample.title}`);
      console.log(`    Category: ${sample.category || '(none)'}`);
      if (sample.eventTags.length > 0) {
        console.log(`    Event tags: ${sample.eventTags.join(', ')}`);
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

  // Determine if audit passed (v3.0.3: lower threshold to 25%)
  const ok = unknownRate < 0.25;

  console.log(`\n--- Verdict: ${ok ? 'PASS' : 'FAIL'} ---`);
  if (!ok) {
    console.log(`UNKNOWN rate ${(unknownRate * 100).toFixed(1)}% exceeds 25% threshold`);
  }

  return {
    venue,
    totalMarkets: markets.length,
    classifiedMarkets: markets.length - unknownCount,
    unknownMarkets: unknownCount,
    unknownRate,
    topicDistribution,
    taxonomySourceDistribution,
    misclassifiedSamples,
    unknownSamples,
    ok,
  };
}

/**
 * Taxonomy Coverage Command (v3.0.0)
 *
 * Shows coverage report for canonical topics across venues.
 */

import {
  CanonicalTopic,
  classifyMarket,
  ALL_CANONICAL_TOPICS,
  isMatchableTopic,
} from '@data-module/core';
import {
  getClient,
  MarketRepository,
  MarketLinkRepository,
} from '@data-module/db';

export interface TaxonomyCoverageOptions {
  topic?: CanonicalTopic;
  lookbackHours?: number;
  limit?: number;
  sampleSize?: number;
}

interface TopicStats {
  topic: CanonicalTopic;
  kalshiCount: number;
  polymarketCount: number;
  confirmedLinks: number;
  suggestedLinks: number;
  overlapPotential: number;
  samples: {
    kalshi: string[];
    polymarket: string[];
  };
}

export async function runTaxonomyCoverage(options: TaxonomyCoverageOptions = {}): Promise<void> {
  const {
    topic,
    lookbackHours = 720,
    limit = 10000,
    sampleSize = 3,
  } = options;

  console.log('\n=== Taxonomy Coverage Report (v3.0.0) ===\n');
  console.log(`Lookback: ${lookbackHours}h, Limit: ${limit}`);

  const client = getClient();
  const marketRepo = new MarketRepository(client);
  const linkRepo = new MarketLinkRepository(client);

  // Fetch markets from both venues
  console.log('\nFetching markets...');
  const [kalshiMarkets, polymarketMarkets] = await Promise.all([
    marketRepo.listEligibleMarkets('kalshi', { lookbackHours, limit }),
    marketRepo.listEligibleMarkets('polymarket', { lookbackHours, limit }),
  ]);

  console.log(`Fetched: ${kalshiMarkets.length} Kalshi, ${polymarketMarkets.length} Polymarket`);

  // Get link counts (simplified - we'll add getStatsByTopic later if needed)
  const linksByTopic = new Map<string, { confirmed: number; suggested: number }>();
  // For now, initialize empty - link stats can be added when method is implemented
  void linkRepo; // Mark as used

  // Classify markets
  const topicStats = new Map<CanonicalTopic, TopicStats>();

  // Initialize stats
  for (const t of ALL_CANONICAL_TOPICS) {
    topicStats.set(t, {
      topic: t,
      kalshiCount: 0,
      polymarketCount: 0,
      confirmedLinks: linksByTopic.get(t)?.confirmed || 0,
      suggestedLinks: linksByTopic.get(t)?.suggested || 0,
      overlapPotential: 0,
      samples: { kalshi: [], polymarket: [] },
    });
  }
  // Also add UNKNOWN
  topicStats.set(CanonicalTopic.UNKNOWN, {
    topic: CanonicalTopic.UNKNOWN,
    kalshiCount: 0,
    polymarketCount: 0,
    confirmedLinks: 0,
    suggestedLinks: 0,
    overlapPotential: 0,
    samples: { kalshi: [], polymarket: [] },
  });

  // Classify Kalshi markets
  for (const market of kalshiMarkets) {
    const classification = classifyMarket({
      venue: 'kalshi',
      title: market.title,
      category: market.category ?? undefined,
      metadata: market.metadata ?? undefined,
    });
    const stats = topicStats.get(classification.topic)!;
    stats.kalshiCount++;
    if (stats.samples.kalshi.length < sampleSize) {
      stats.samples.kalshi.push(market.title.slice(0, 80));
    }
  }

  // Classify Polymarket markets
  for (const market of polymarketMarkets) {
    const classification = classifyMarket({
      venue: 'polymarket',
      title: market.title,
      category: market.category ?? undefined,
      metadata: market.metadata ?? undefined,
    });
    const stats = topicStats.get(classification.topic)!;
    stats.polymarketCount++;
    if (stats.samples.polymarket.length < sampleSize) {
      stats.samples.polymarket.push(market.title.slice(0, 80));
    }
  }

  // Calculate overlap potential
  for (const stats of topicStats.values()) {
    stats.overlapPotential = Math.min(stats.kalshiCount, stats.polymarketCount);
  }

  // Filter by topic if specified
  const topicsToShow = topic
    ? [topic]
    : [...ALL_CANONICAL_TOPICS, CanonicalTopic.UNKNOWN];

  // Print report
  console.log('\n');
  console.log('Topic'.padEnd(20) + 'Kalshi'.padStart(8) + 'Poly'.padStart(8) + 'Overlap'.padStart(10) + 'Confirmed'.padStart(10) + 'Suggested'.padStart(10) + 'Pipeline'.padStart(10));
  console.log('-'.repeat(76));

  let totalKalshi = 0;
  let totalPolymarket = 0;
  let totalOverlap = 0;
  let totalConfirmed = 0;
  let totalSuggested = 0;

  for (const t of topicsToShow) {
    const stats = topicStats.get(t);
    if (!stats) continue;

    const hasP = isMatchableTopic(t) ? 'YES' : 'no';

    console.log(
      t.padEnd(20) +
      String(stats.kalshiCount).padStart(8) +
      String(stats.polymarketCount).padStart(8) +
      String(stats.overlapPotential).padStart(10) +
      String(stats.confirmedLinks).padStart(10) +
      String(stats.suggestedLinks).padStart(10) +
      hasP.padStart(10)
    );

    totalKalshi += stats.kalshiCount;
    totalPolymarket += stats.polymarketCount;
    totalOverlap += stats.overlapPotential;
    totalConfirmed += stats.confirmedLinks;
    totalSuggested += stats.suggestedLinks;
  }

  console.log('-'.repeat(76));
  console.log(
    'TOTAL'.padEnd(20) +
    String(totalKalshi).padStart(8) +
    String(totalPolymarket).padStart(8) +
    String(totalOverlap).padStart(10) +
    String(totalConfirmed).padStart(10) +
    String(totalSuggested).padStart(10)
  );

  // Show samples for specific topic
  if (topic) {
    const stats = topicStats.get(topic);
    if (stats) {
      console.log(`\n--- Samples for ${topic} ---`);
      console.log('\nKalshi:');
      for (const sample of stats.samples.kalshi) {
        console.log(`  - ${sample}`);
      }
      console.log('\nPolymarket:');
      for (const sample of stats.samples.polymarket) {
        console.log(`  - ${sample}`);
      }
    }
  }

  console.log('\nDone.');
}

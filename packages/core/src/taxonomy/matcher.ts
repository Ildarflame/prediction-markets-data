/**
 * Taxonomy Matcher (v3.0.0)
 *
 * Unified market topic classification that combines venue-specific rules
 * with title analysis to determine the canonical topic for any market.
 */

import {
  CanonicalTopic,
  TopicClassification,
  TopicSource,
  MarketTopicInfo,
} from './types.js';
import { classifyKalshiMarket } from './kalshiRules.js';
import { classifyPolymarketMarket, extractPolymarketTags } from './polymarketRules.js';

/**
 * Title-based fallback rules (venue-agnostic)
 * Used when venue-specific rules don't match
 */
const FALLBACK_TITLE_PATTERNS: Array<{
  pattern: RegExp;
  topic: CanonicalTopic;
  confidence: number;
  description: string;
}> = [
  // Crypto
  { pattern: /\$?\bbitcoin\b|\$btc\b/i, topic: CanonicalTopic.CRYPTO_DAILY, confidence: 0.85, description: 'Bitcoin' },
  { pattern: /\$?\bethereum\b|\$eth\b/i, topic: CanonicalTopic.CRYPTO_DAILY, confidence: 0.85, description: 'Ethereum' },
  { pattern: /\bcrypto(?:currency)?\b/i, topic: CanonicalTopic.CRYPTO_DAILY, confidence: 0.70, description: 'Crypto keyword' },

  // Macro
  { pattern: /\b(?:cpi|inflation|gdp|nfp|pce|pmi)\b/i, topic: CanonicalTopic.MACRO, confidence: 0.85, description: 'Macro indicator' },
  { pattern: /\bunemployment\b/i, topic: CanonicalTopic.MACRO, confidence: 0.80, description: 'Unemployment' },

  // Rates
  { pattern: /\b(?:fomc|fed(?:eral reserve)?|interest rate)\b/i, topic: CanonicalTopic.RATES, confidence: 0.80, description: 'Rates keyword' },
  { pattern: /\brate (?:cut|hike|decision)\b/i, topic: CanonicalTopic.RATES, confidence: 0.75, description: 'Rate action' },

  // Elections
  { pattern: /\b(?:election|president(?:ial)?|senate|congress)\b/i, topic: CanonicalTopic.ELECTIONS, confidence: 0.75, description: 'Election keyword' },
];

/**
 * Classify a market by title only (fallback)
 */
function classifyByTitle(title: string): TopicClassification | null {
  for (const rule of FALLBACK_TITLE_PATTERNS) {
    if (rule.pattern.test(title)) {
      return {
        topic: rule.topic,
        confidence: rule.confidence,
        source: TopicSource.TITLE_KEYWORDS,
        reason: rule.description,
      };
    }
  }
  return null;
}

/**
 * Main classification function - determines canonical topic for any market
 *
 * Priority:
 * 1. Venue-specific rules (ticker patterns, categories)
 * 2. Title keyword analysis
 * 3. Metadata analysis
 * 4. Fallback to UNKNOWN
 */
export function classifyMarket(market: MarketTopicInfo): TopicClassification {
  // 1. Try venue-specific classification
  if (market.venue === 'kalshi') {
    const kalshiResult = classifyKalshiMarket(
      market.title,
      market.category,
      market.metadata
    );
    if (kalshiResult.topic !== CanonicalTopic.UNKNOWN) {
      return kalshiResult;
    }
  } else if (market.venue === 'polymarket') {
    const tags = extractPolymarketTags(market.metadata);
    const polyResult = classifyPolymarketMarket({
      title: market.title,
      category: market.category,
      groupItemTitle: market.metadata?.groupItemTitle as string | undefined,
      tags,
    });
    if (polyResult.topic !== CanonicalTopic.UNKNOWN) {
      return polyResult;
    }
  }

  // 2. Try title-based fallback
  const titleResult = classifyByTitle(market.title);
  if (titleResult) {
    return titleResult;
  }

  // 3. Return unknown
  return {
    topic: CanonicalTopic.UNKNOWN,
    confidence: 0.0,
    source: TopicSource.FALLBACK,
    reason: 'No classification rule matched',
  };
}

/**
 * Check if two markets have compatible topics for matching
 */
export function areTopicsCompatible(
  topicA: CanonicalTopic,
  topicB: CanonicalTopic
): boolean {
  // Same topic is always compatible
  if (topicA === topicB) {
    return true;
  }

  // UNKNOWN is not compatible with anything
  if (topicA === CanonicalTopic.UNKNOWN || topicB === CanonicalTopic.UNKNOWN) {
    return false;
  }

  // Special case: CRYPTO_DAILY and CRYPTO_INTRADAY are NOT compatible
  // They use different matching strategies
  if (
    (topicA === CanonicalTopic.CRYPTO_DAILY && topicB === CanonicalTopic.CRYPTO_INTRADAY) ||
    (topicA === CanonicalTopic.CRYPTO_INTRADAY && topicB === CanonicalTopic.CRYPTO_DAILY)
  ) {
    return false;
  }

  // All other topics must match exactly
  return false;
}

/**
 * Get all markets that match a specific topic
 */
export function filterByTopic<T extends { title: string; venue: 'kalshi' | 'polymarket'; category?: string; metadata?: Record<string, unknown> }>(
  markets: T[],
  topic: CanonicalTopic,
  minConfidence: number = 0.5
): T[] {
  return markets.filter((market) => {
    const classification = classifyMarket({
      venue: market.venue as 'kalshi' | 'polymarket',
      title: market.title,
      category: market.category,
      metadata: market.metadata,
    });
    return classification.topic === topic && classification.confidence >= minConfidence;
  });
}

/**
 * Batch classify markets
 */
export function classifyMarkets(
  markets: MarketTopicInfo[]
): Map<string, TopicClassification> {
  const results = new Map<string, TopicClassification>();

  for (const market of markets) {
    const key = `${market.venue}:${market.title.substring(0, 50)}`;
    const classification = classifyMarket(market);
    results.set(key, classification);
  }

  return results;
}

/**
 * Get topic distribution for a list of markets
 */
export function getTopicDistribution(
  markets: MarketTopicInfo[]
): Map<CanonicalTopic, number> {
  const distribution = new Map<CanonicalTopic, number>();

  // Initialize all topics
  for (const topic of Object.values(CanonicalTopic)) {
    distribution.set(topic as CanonicalTopic, 0);
  }

  // Count markets per topic
  for (const market of markets) {
    const classification = classifyMarket(market);
    const count = distribution.get(classification.topic) || 0;
    distribution.set(classification.topic, count + 1);
  }

  return distribution;
}

/**
 * Check if a market is likely an intraday crypto market
 * Helper for filtering daily vs intraday
 */
export function isIntradayCrypto(market: MarketTopicInfo): boolean {
  const classification = classifyMarket(market);
  return classification.topic === CanonicalTopic.CRYPTO_INTRADAY;
}

/**
 * Check if a market is likely a rates market
 */
export function isRatesMarket(market: MarketTopicInfo): boolean {
  const classification = classifyMarket(market);
  return classification.topic === CanonicalTopic.RATES;
}

/**
 * Check if a market is likely an elections market
 */
export function isElectionsMarket(market: MarketTopicInfo): boolean {
  const classification = classifyMarket(market);
  return classification.topic === CanonicalTopic.ELECTIONS;
}

/**
 * Get the best topic for a market pair
 * Used when matching to determine which pipeline to use
 */
export function getBestTopicForPair(
  marketA: MarketTopicInfo,
  marketB: MarketTopicInfo
): CanonicalTopic | null {
  const classA = classifyMarket(marketA);
  const classB = classifyMarket(marketB);

  // Both must have a non-UNKNOWN topic
  if (classA.topic === CanonicalTopic.UNKNOWN || classB.topic === CanonicalTopic.UNKNOWN) {
    return null;
  }

  // Topics must be compatible
  if (!areTopicsCompatible(classA.topic, classB.topic)) {
    return null;
  }

  // Return the topic with higher confidence
  return classA.confidence >= classB.confidence ? classA.topic : classB.topic;
}

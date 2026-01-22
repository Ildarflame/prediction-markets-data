/**
 * Taxonomy Module (v3.0.0)
 *
 * Unified topic classification for cross-venue market matching.
 * Provides rules and utilities for mapping venue-specific categories
 * to canonical topics.
 */

// Types
export {
  CanonicalTopic,
  TopicClassification,
  TopicSource,
  TopicRule,
  VenueTopic,
  KalshiSeriesInfo,
  PolymarketMarketInfo,
  MarketTopicInfo,
  TopicCoverage,
  ALL_CANONICAL_TOPICS,
  MATCHABLE_TOPICS,
  isMatchableTopic,
} from './types.js';

// Kalshi rules
export {
  KALSHI_TICKER_RULES,
  KALSHI_CATEGORY_MAP,
  classifyKalshiByTicker,
  classifyKalshiByCategory,
  classifyKalshiSeries,
  classifyKalshiMarket,
} from './kalshiRules.js';

// Polymarket rules
export {
  POLYMARKET_CATEGORY_MAP,
  POLYMARKET_TITLE_RULES,
  classifyPolymarketByCategory,
  classifyPolymarketByTitle,
  classifyPolymarketMarket,
  extractPolymarketTags,
} from './polymarketRules.js';

// Unified matcher
export {
  classifyMarket,
  areTopicsCompatible,
  filterByTopic,
  classifyMarkets,
  getTopicDistribution,
  isIntradayCrypto,
  isRatesMarket,
  isElectionsMarket,
  getBestTopicForPair,
} from './matcher.js';

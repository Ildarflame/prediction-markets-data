/**
 * Taxonomy Module (v3.0.2)
 *
 * Unified topic classification for cross-venue market matching.
 * Provides rules and utilities for mapping venue-specific categories
 * to canonical topics.
 *
 * v3.0.1: Added series-based classification support
 * v3.0.2: Metadata-first Polymarket classification, precedence rules
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
  KALSHI_TAG_MAP,
  classifyKalshiByTicker,
  classifyKalshiByCategory,
  classifyKalshiByTags,
  classifyKalshiSeries,
  classifyKalshiMarket,
  classifyKalshiMarketWithSeries,
  extractSeriesTickerFromEvent,
} from './kalshiRules.js';

// Polymarket rules
export {
  POLYMARKET_CATEGORY_MAP,
  POLYMARKET_TITLE_RULES,
  PM_TAG_MAP,
  classifyPolymarketByCategory,
  classifyPolymarketByTitle,
  classifyPolymarketByTags,
  classifyPolymarketByPmCategories,
  classifyPolymarketMarket,
  classifyPolymarketMarketV2,
  classifyPolymarketMarketV3,
  extractPolymarketTags,
  type PolymarketMarketInfoV2,
  type PolymarketMarketInfoV3,
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

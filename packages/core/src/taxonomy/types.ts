/**
 * Taxonomy Types (v3.0.1)
 *
 * Unified topic classification system for cross-venue market matching.
 * Maps venue-specific categories/tags to canonical topics.
 *
 * v3.0.1: Added series-based classification support
 */

/**
 * Canonical topics for cross-venue matching
 * These are the top-level categories that enable matching across venues
 */
export enum CanonicalTopic {
  CRYPTO_DAILY = 'CRYPTO_DAILY',
  CRYPTO_INTRADAY = 'CRYPTO_INTRADAY',
  MACRO = 'MACRO',
  RATES = 'RATES',
  ELECTIONS = 'ELECTIONS',
  GEOPOLITICS = 'GEOPOLITICS',
  SPORTS = 'SPORTS',
  ENTERTAINMENT = 'ENTERTAINMENT',
  CLIMATE = 'CLIMATE',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Topic classification result
 */
export interface TopicClassification {
  /** Primary canonical topic */
  topic: CanonicalTopic;
  /** Confidence score 0-1 */
  confidence: number;
  /** Source of classification */
  source: TopicSource;
  /** Optional sub-topic for more specific matching */
  subTopic?: string;
  /** Debug info about why this classification was made */
  reason?: string;
}

/**
 * Source of topic classification
 */
export enum TopicSource {
  /** From topic_map table */
  DATABASE = 'database',
  /** From hardcoded rules */
  RULE = 'rule',
  /** From ticker/series pattern */
  TICKER_PATTERN = 'ticker_pattern',
  /** From title keyword analysis */
  TITLE_KEYWORDS = 'title_keywords',
  /** From category field */
  CATEGORY = 'category',
  /** From metadata analysis */
  METADATA = 'metadata',
  /** From series metadata (category + tags) */
  SERIES_METADATA = 'series_metadata',
  /** From event metadata */
  EVENT_METADATA = 'event_metadata',
  /** Fallback/unknown */
  FALLBACK = 'fallback',
}

/**
 * Venue-specific topic info for mapping
 */
export interface VenueTopic {
  venue: 'kalshi' | 'polymarket';
  /** Original topic/category from venue */
  venueTopic: string;
  /** Mapped canonical topic */
  canonicalTopic: CanonicalTopic;
  /** Confidence of mapping */
  confidence: number;
  /** Source of mapping */
  source: 'manual' | 'auto' | 'rule';
}

/**
 * Topic mapping rule
 */
export interface TopicRule {
  /** Pattern to match (regex or exact) */
  pattern: string | RegExp;
  /** Target canonical topic */
  topic: CanonicalTopic;
  /** Confidence of this rule */
  confidence: number;
  /** Optional sub-topic */
  subTopic?: string;
  /** Description of what this rule matches */
  description?: string;
}

/**
 * Kalshi series metadata for topic classification
 */
export interface KalshiSeriesInfo {
  ticker: string;
  title: string;
  category?: string;
  frequency?: string;
  tags: string[];
}

/**
 * Polymarket market metadata for topic classification
 */
export interface PolymarketMarketInfo {
  title: string;
  category?: string;
  groupItemTitle?: string;
  tags?: string[];
}

/**
 * Market info for topic classification (venue-agnostic)
 */
export interface MarketTopicInfo {
  venue: 'kalshi' | 'polymarket';
  title: string;
  category?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Topic coverage statistics
 */
export interface TopicCoverage {
  topic: CanonicalTopic;
  kalshiCount: number;
  polymarketCount: number;
  overlapPotential: number;
  matchedLinks: number;
  suggestedLinks: number;
}

/**
 * All canonical topics as array (for iteration)
 */
export const ALL_CANONICAL_TOPICS = Object.values(CanonicalTopic).filter(
  (v) => v !== CanonicalTopic.UNKNOWN
) as CanonicalTopic[];

/**
 * Topics that support automated matching (have pipelines)
 */
export const MATCHABLE_TOPICS = [
  CanonicalTopic.CRYPTO_DAILY,
  CanonicalTopic.CRYPTO_INTRADAY,
  CanonicalTopic.MACRO,
  CanonicalTopic.RATES,
  CanonicalTopic.ELECTIONS,
] as const;

/**
 * Check if a topic has an automated pipeline
 */
export function isMatchableTopic(topic: CanonicalTopic): boolean {
  return (MATCHABLE_TOPICS as readonly CanonicalTopic[]).includes(topic);
}

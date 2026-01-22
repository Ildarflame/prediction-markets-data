/**
 * Kalshi Taxonomy Rules (v3.0.0)
 *
 * Maps Kalshi series tickers and categories to canonical topics.
 * Based on analysis of Kalshi API series data.
 */

import { CanonicalTopic, TopicRule, KalshiSeriesInfo, TopicClassification, TopicSource } from './types.js';
import { getKalshiEventTicker, getKalshiSeriesTicker } from '../utils.js';

/**
 * Kalshi ticker prefix rules
 * Order matters - first match wins
 */
export const KALSHI_TICKER_RULES: TopicRule[] = [
  // Crypto Daily - Price brackets for specific dates
  { pattern: /^KXBTC(?!UPDOWN|15MIN|1HR|30MIN)/i, topic: CanonicalTopic.CRYPTO_DAILY, confidence: 0.95, description: 'Bitcoin daily price' },
  { pattern: /^KXETH(?!UPDOWN|15MIN|1HR|30MIN)/i, topic: CanonicalTopic.CRYPTO_DAILY, confidence: 0.95, description: 'Ethereum daily price' },
  { pattern: /^KXSOL(?!UPDOWN|15MIN|1HR|30MIN)/i, topic: CanonicalTopic.CRYPTO_DAILY, confidence: 0.95, description: 'Solana daily price' },
  { pattern: /^KXDOGE(?!UPDOWN|15MIN|1HR|30MIN)/i, topic: CanonicalTopic.CRYPTO_DAILY, confidence: 0.95, description: 'Dogecoin daily price' },
  { pattern: /^KXXRP(?!UPDOWN|15MIN|1HR|30MIN)/i, topic: CanonicalTopic.CRYPTO_DAILY, confidence: 0.95, description: 'XRP daily price' },

  // Crypto Intraday - Up/down and short-term markets
  { pattern: /UPDOWN/i, topic: CanonicalTopic.CRYPTO_INTRADAY, confidence: 0.98, description: 'Crypto up/down intraday' },
  { pattern: /15MIN/i, topic: CanonicalTopic.CRYPTO_INTRADAY, confidence: 0.98, description: 'Crypto 15-minute' },
  { pattern: /30MIN/i, topic: CanonicalTopic.CRYPTO_INTRADAY, confidence: 0.98, description: 'Crypto 30-minute' },
  { pattern: /1HR/i, topic: CanonicalTopic.CRYPTO_INTRADAY, confidence: 0.98, description: 'Crypto 1-hour' },
  { pattern: /INTRADAY/i, topic: CanonicalTopic.CRYPTO_INTRADAY, confidence: 0.98, description: 'Crypto intraday' },

  // Macro - Economic indicators
  { pattern: /^KXCPI/i, topic: CanonicalTopic.MACRO, confidence: 0.98, description: 'CPI inflation' },
  { pattern: /^KXGDP/i, topic: CanonicalTopic.MACRO, confidence: 0.98, description: 'GDP growth' },
  { pattern: /^KXNFP/i, topic: CanonicalTopic.MACRO, confidence: 0.98, description: 'Non-farm payrolls' },
  { pattern: /^KXPCE/i, topic: CanonicalTopic.MACRO, confidence: 0.98, description: 'PCE inflation' },
  { pattern: /^KXPMI/i, topic: CanonicalTopic.MACRO, confidence: 0.98, description: 'PMI data' },
  { pattern: /^KXJOBLESS/i, topic: CanonicalTopic.MACRO, confidence: 0.98, description: 'Jobless claims' },
  { pattern: /^KXUNEMP/i, topic: CanonicalTopic.MACRO, confidence: 0.98, description: 'Unemployment rate' },

  // Rates - Central bank decisions
  { pattern: /^KXFEDFUNDS/i, topic: CanonicalTopic.RATES, confidence: 0.98, description: 'Fed funds rate' },
  { pattern: /^FOMC/i, topic: CanonicalTopic.RATES, confidence: 0.98, description: 'FOMC decision' },
  { pattern: /^KXFED/i, topic: CanonicalTopic.RATES, confidence: 0.95, description: 'Fed related' },
  { pattern: /FED.*RATE/i, topic: CanonicalTopic.RATES, confidence: 0.90, description: 'Fed rate' },
  { pattern: /RATE.*CUT/i, topic: CanonicalTopic.RATES, confidence: 0.85, description: 'Rate cut' },
  { pattern: /RATE.*HIKE/i, topic: CanonicalTopic.RATES, confidence: 0.85, description: 'Rate hike' },

  // Elections - Political outcomes
  { pattern: /^PRES/i, topic: CanonicalTopic.ELECTIONS, confidence: 0.95, description: 'Presidential' },
  { pattern: /^KXPRES/i, topic: CanonicalTopic.ELECTIONS, confidence: 0.95, description: 'Presidential (KX)' },
  { pattern: /^SENATE/i, topic: CanonicalTopic.ELECTIONS, confidence: 0.95, description: 'Senate' },
  { pattern: /^HOUSE/i, topic: CanonicalTopic.ELECTIONS, confidence: 0.90, description: 'House' },
  { pattern: /^GOV/i, topic: CanonicalTopic.ELECTIONS, confidence: 0.90, description: 'Governor' },
  { pattern: /ELECTION/i, topic: CanonicalTopic.ELECTIONS, confidence: 0.85, description: 'Election' },
  { pattern: /^KXTRUMP/i, topic: CanonicalTopic.ELECTIONS, confidence: 0.90, description: 'Trump related' },
  { pattern: /^KXBIDEN/i, topic: CanonicalTopic.ELECTIONS, confidence: 0.90, description: 'Biden related' },

  // Sports - Exclude from matching
  { pattern: /^KXMVESPORT/i, topic: CanonicalTopic.SPORTS, confidence: 0.98, description: 'Esports' },
  { pattern: /^KXMVENBASI/i, topic: CanonicalTopic.SPORTS, confidence: 0.98, description: 'Basketball' },
  { pattern: /^KXNCAAMBGA/i, topic: CanonicalTopic.SPORTS, confidence: 0.98, description: 'NCAA' },
  { pattern: /^KXTABLETEN/i, topic: CanonicalTopic.SPORTS, confidence: 0.98, description: 'Table tennis' },
  { pattern: /^KXNBAREB/i, topic: CanonicalTopic.SPORTS, confidence: 0.98, description: 'NBA' },
  { pattern: /^KXNFL/i, topic: CanonicalTopic.SPORTS, confidence: 0.98, description: 'NFL' },
  { pattern: /^KXMLB/i, topic: CanonicalTopic.SPORTS, confidence: 0.98, description: 'MLB' },
  { pattern: /^KXNHL/i, topic: CanonicalTopic.SPORTS, confidence: 0.98, description: 'NHL' },
];

/**
 * Kalshi category to topic mapping
 */
export const KALSHI_CATEGORY_MAP: Record<string, CanonicalTopic> = {
  // Crypto
  'crypto': CanonicalTopic.CRYPTO_DAILY,
  'cryptocurrency': CanonicalTopic.CRYPTO_DAILY,
  'bitcoin': CanonicalTopic.CRYPTO_DAILY,
  'ethereum': CanonicalTopic.CRYPTO_DAILY,

  // Macro
  'economics': CanonicalTopic.MACRO,
  'economy': CanonicalTopic.MACRO,
  'inflation': CanonicalTopic.MACRO,
  'gdp': CanonicalTopic.MACRO,
  'employment': CanonicalTopic.MACRO,

  // Rates
  'fed': CanonicalTopic.RATES,
  'fomc': CanonicalTopic.RATES,
  'interest rates': CanonicalTopic.RATES,
  'central bank': CanonicalTopic.RATES,

  // Elections
  'politics': CanonicalTopic.ELECTIONS,
  'election': CanonicalTopic.ELECTIONS,
  'elections': CanonicalTopic.ELECTIONS,
  'us politics': CanonicalTopic.ELECTIONS,

  // Sports
  'sports': CanonicalTopic.SPORTS,
  'esports': CanonicalTopic.SPORTS,
  'nba': CanonicalTopic.SPORTS,
  'nfl': CanonicalTopic.SPORTS,
  'mlb': CanonicalTopic.SPORTS,

  // Entertainment
  'entertainment': CanonicalTopic.ENTERTAINMENT,
  'awards': CanonicalTopic.ENTERTAINMENT,
  'oscars': CanonicalTopic.ENTERTAINMENT,
};

/**
 * Classify a Kalshi market/series by ticker
 */
export function classifyKalshiByTicker(ticker: string): TopicClassification | null {
  for (const rule of KALSHI_TICKER_RULES) {
    const pattern = typeof rule.pattern === 'string'
      ? new RegExp(rule.pattern, 'i')
      : rule.pattern;

    if (pattern.test(ticker)) {
      return {
        topic: rule.topic,
        confidence: rule.confidence,
        source: TopicSource.TICKER_PATTERN,
        subTopic: rule.subTopic,
        reason: rule.description,
      };
    }
  }
  return null;
}

/**
 * Classify a Kalshi market/series by category
 */
export function classifyKalshiByCategory(category: string): TopicClassification | null {
  const normalized = category.toLowerCase().trim();
  const topic = KALSHI_CATEGORY_MAP[normalized];

  if (topic) {
    return {
      topic,
      confidence: 0.80,
      source: TopicSource.CATEGORY,
      reason: `Category: ${category}`,
    };
  }
  return null;
}

/**
 * Classify a Kalshi series using all available info
 */
export function classifyKalshiSeries(series: KalshiSeriesInfo): TopicClassification {
  // 1. Try ticker pattern first (highest priority)
  const tickerResult = classifyKalshiByTicker(series.ticker);
  if (tickerResult && tickerResult.confidence >= 0.85) {
    return tickerResult;
  }

  // 2. Try category mapping
  if (series.category) {
    const categoryResult = classifyKalshiByCategory(series.category);
    if (categoryResult) {
      // If ticker also matched but with lower confidence, boost category result
      if (tickerResult) {
        return {
          ...tickerResult,
          confidence: Math.min(1.0, tickerResult.confidence + 0.05),
        };
      }
      return categoryResult;
    }
  }

  // 3. Try tag analysis
  if (series.tags.length > 0) {
    for (const tag of series.tags) {
      const tagLower = tag.toLowerCase();
      const topic = KALSHI_CATEGORY_MAP[tagLower];
      if (topic) {
        return {
          topic,
          confidence: 0.70,
          source: TopicSource.METADATA,
          reason: `Tag: ${tag}`,
        };
      }
    }
  }

  // 4. Return ticker result if it exists (even with lower confidence)
  if (tickerResult) {
    return tickerResult;
  }

  // 5. Fallback to unknown
  return {
    topic: CanonicalTopic.UNKNOWN,
    confidence: 0.0,
    source: TopicSource.FALLBACK,
    reason: 'No matching rule',
  };
}

/**
 * Classify a Kalshi market using metadata
 */
export function classifyKalshiMarket(
  _title: string,
  category?: string | null,
  metadata?: Record<string, unknown> | null
): TopicClassification {
  // 1. Try event ticker from metadata
  const eventTicker = getKalshiEventTicker(metadata);
  if (eventTicker) {
    const tickerResult = classifyKalshiByTicker(eventTicker);
    if (tickerResult && tickerResult.confidence >= 0.85) {
      return tickerResult;
    }
  }

  // 2. Try series ticker from metadata
  const seriesTicker = getKalshiSeriesTicker(metadata);
  if (seriesTicker) {
    const tickerResult = classifyKalshiByTicker(seriesTicker);
    if (tickerResult && tickerResult.confidence >= 0.85) {
      return tickerResult;
    }
  }

  // 3. Try category
  if (category) {
    const categoryResult = classifyKalshiByCategory(category);
    if (categoryResult) {
      return categoryResult;
    }
  }

  // 4. Fallback to title-based classification (handled by matcher.ts)
  return {
    topic: CanonicalTopic.UNKNOWN,
    confidence: 0.0,
    source: TopicSource.FALLBACK,
    reason: 'No Kalshi-specific match',
  };
}

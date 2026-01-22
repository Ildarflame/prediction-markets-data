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
 * Kalshi series CATEGORY to topic mapping (case-insensitive)
 * Based on actual Kalshi API series categories
 */
export const KALSHI_CATEGORY_MAP: Record<string, CanonicalTopic> = {
  // Crypto - primary category
  'crypto': CanonicalTopic.CRYPTO_DAILY,
  'cryptocurrency': CanonicalTopic.CRYPTO_DAILY,

  // Economics/Macro - primary category
  'economics': CanonicalTopic.MACRO,
  'economy': CanonicalTopic.MACRO,

  // Financial - often contains rates
  'financial': CanonicalTopic.RATES,
  'financials': CanonicalTopic.RATES,

  // Politics - elections
  'politics': CanonicalTopic.ELECTIONS,
  'elections': CanonicalTopic.ELECTIONS,

  // Sports - primary category
  'sports': CanonicalTopic.SPORTS,

  // Entertainment - primary category
  'entertainment': CanonicalTopic.ENTERTAINMENT,

  // Climate/Weather
  'climate': CanonicalTopic.CLIMATE,
  'weather': CanonicalTopic.CLIMATE,

  // Tech - map to UNKNOWN for now (could be its own topic)
  'tech': CanonicalTopic.UNKNOWN,
  'technology': CanonicalTopic.UNKNOWN,

  // World events - geopolitics
  'world': CanonicalTopic.GEOPOLITICS,
  'geopolitics': CanonicalTopic.GEOPOLITICS,
};

/**
 * Kalshi series TAG to topic mapping (case-insensitive)
 * Tags provide more specific classification than categories
 */
export const KALSHI_TAG_MAP: Record<string, CanonicalTopic> = {
  // Crypto tags
  'bitcoin': CanonicalTopic.CRYPTO_DAILY,
  'ethereum': CanonicalTopic.CRYPTO_DAILY,
  'solana': CanonicalTopic.CRYPTO_DAILY,
  'crypto': CanonicalTopic.CRYPTO_DAILY,

  // Macro tags
  'cpi': CanonicalTopic.MACRO,
  'gdp': CanonicalTopic.MACRO,
  'inflation': CanonicalTopic.MACRO,
  'jobs': CanonicalTopic.MACRO,
  'employment': CanonicalTopic.MACRO,
  'nfp': CanonicalTopic.MACRO,
  'pce': CanonicalTopic.MACRO,
  'pmi': CanonicalTopic.MACRO,
  'unemployment': CanonicalTopic.MACRO,

  // Rates tags
  'fed': CanonicalTopic.RATES,
  'fomc': CanonicalTopic.RATES,
  'interest rates': CanonicalTopic.RATES,
  'federal reserve': CanonicalTopic.RATES,

  // Elections tags
  'election': CanonicalTopic.ELECTIONS,
  'president': CanonicalTopic.ELECTIONS,
  'presidential': CanonicalTopic.ELECTIONS,
  'congress': CanonicalTopic.ELECTIONS,
  'senate': CanonicalTopic.ELECTIONS,
  'governor': CanonicalTopic.ELECTIONS,

  // Sports tags
  'nba': CanonicalTopic.SPORTS,
  'nfl': CanonicalTopic.SPORTS,
  'mlb': CanonicalTopic.SPORTS,
  'nhl': CanonicalTopic.SPORTS,
  'ncaa': CanonicalTopic.SPORTS,
  'soccer': CanonicalTopic.SPORTS,
  'olympics': CanonicalTopic.SPORTS,
  'ufc': CanonicalTopic.SPORTS,
  'mma': CanonicalTopic.SPORTS,
  'tennis': CanonicalTopic.SPORTS,
  'golf': CanonicalTopic.SPORTS,
  'f1': CanonicalTopic.SPORTS,
  'formula 1': CanonicalTopic.SPORTS,

  // Entertainment tags
  'movies': CanonicalTopic.ENTERTAINMENT,
  'tv': CanonicalTopic.ENTERTAINMENT,
  'oscars': CanonicalTopic.ENTERTAINMENT,
  'grammys': CanonicalTopic.ENTERTAINMENT,
  'emmys': CanonicalTopic.ENTERTAINMENT,
  'awards': CanonicalTopic.ENTERTAINMENT,

  // Climate tags
  'hurricane': CanonicalTopic.CLIMATE,
  'temperature': CanonicalTopic.CLIMATE,
  'weather': CanonicalTopic.CLIMATE,
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
 * Classify a Kalshi series by tags
 */
export function classifyKalshiByTags(tags: string[]): TopicClassification | null {
  for (const tag of tags) {
    const tagLower = tag.toLowerCase().trim();
    const topic = KALSHI_TAG_MAP[tagLower];
    if (topic && topic !== CanonicalTopic.UNKNOWN) {
      return {
        topic,
        confidence: 0.85,
        source: TopicSource.SERIES_METADATA,
        reason: `Tag: ${tag}`,
      };
    }
  }
  return null;
}

/**
 * Classify a Kalshi series using all available info (v3.0.1)
 * Priority: 1) Category 2) Tags 3) Ticker pattern
 * Series metadata takes priority over ticker heuristics
 */
export function classifyKalshiSeries(series: KalshiSeriesInfo): TopicClassification {
  // 1. Try category mapping first (most reliable for series)
  if (series.category) {
    const categoryResult = classifyKalshiByCategory(series.category);
    if (categoryResult && categoryResult.topic !== CanonicalTopic.UNKNOWN) {
      // Boost confidence if tags also match
      const tagResult = classifyKalshiByTags(series.tags);
      if (tagResult && tagResult.topic === categoryResult.topic) {
        return {
          ...categoryResult,
          confidence: Math.min(1.0, categoryResult.confidence + 0.10),
          reason: `Category: ${series.category}, Tag: ${series.tags.join(',')}`,
        };
      }
      return categoryResult;
    }
  }

  // 2. Try tag analysis
  if (series.tags.length > 0) {
    const tagResult = classifyKalshiByTags(series.tags);
    if (tagResult) {
      return tagResult;
    }
  }

  // 3. Fallback to ticker pattern (only for crypto daily/intraday split)
  const tickerResult = classifyKalshiByTicker(series.ticker);
  if (tickerResult) {
    return {
      ...tickerResult,
      confidence: tickerResult.confidence * 0.9, // Slightly lower confidence for ticker-only
      reason: `Ticker fallback: ${tickerResult.reason}`,
    };
  }

  // 4. Fallback to unknown
  return {
    topic: CanonicalTopic.UNKNOWN,
    confidence: 0.0,
    source: TopicSource.FALLBACK,
    reason: 'No matching rule',
  };
}

/**
 * Extract series ticker from event ticker
 * Event tickers are formatted as: SERIES-EVENT_SUFFIX
 * e.g., "KXBTC-24JAN01" -> "KXBTC"
 * e.g., "KXMVESPORTSMULTIGAMEEXTENDED-S2025ABC" -> "KXMVESPORTSMULTIGAMEEXTENDED"
 */
export function extractSeriesTickerFromEvent(eventTicker: string): string | null {
  if (!eventTicker) return null;

  // Common patterns:
  // 1. SERIES-DATE (e.g., KXBTC-24JAN01)
  // 2. SERIES-S2025XXX (e.g., KXMVESPORTS-S2025ABC)
  // 3. SERIES-E2025XXX (e.g., KXCPI-E2025JAN)

  const match = eventTicker.match(/^([A-Z0-9]+?)(?:-[0-9]{2}[A-Z]{3}|-[SE][0-9]{4}|-[A-Z0-9]+$)/i);
  if (match) {
    return match[1];
  }

  // Fallback: take everything before the first hyphen followed by digits or S/E
  const parts = eventTicker.split('-');
  if (parts.length > 1) {
    return parts[0];
  }

  return eventTicker;
}

/**
 * Classify a Kalshi market using series info from database
 * This is the preferred method when series data is available
 */
export function classifyKalshiMarketWithSeries(
  seriesCategory: string | null,
  seriesTags: string[] | null
): TopicClassification | null {
  if (!seriesCategory && (!seriesTags || seriesTags.length === 0)) {
    return null;
  }

  // Use series classification logic
  return classifyKalshiSeries({
    ticker: '', // Not needed for classification
    title: '',
    category: seriesCategory || undefined,
    tags: seriesTags || [],
  });
}

/**
 * Classify a Kalshi market using metadata (v3.0.1)
 * Priority: 1) Series metadata 2) Ticker patterns 3) Category field
 */
export function classifyKalshiMarket(
  _title: string,
  category?: string | null,
  metadata?: Record<string, unknown> | null
): TopicClassification {
  // 1. Try series ticker from metadata and classify by ticker pattern
  const seriesTicker = getKalshiSeriesTicker(metadata);
  if (seriesTicker) {
    const tickerResult = classifyKalshiByTicker(seriesTicker);
    if (tickerResult && tickerResult.confidence >= 0.85) {
      return tickerResult;
    }
  }

  // 2. Try event ticker from metadata
  const eventTicker = getKalshiEventTicker(metadata);
  if (eventTicker) {
    // Try to extract series ticker from event ticker
    const derivedSeriesTicker = extractSeriesTickerFromEvent(eventTicker);
    if (derivedSeriesTicker) {
      const tickerResult = classifyKalshiByTicker(derivedSeriesTicker);
      if (tickerResult && tickerResult.confidence >= 0.85) {
        return tickerResult;
      }
    }

    // Try event ticker directly
    const eventTickerResult = classifyKalshiByTicker(eventTicker);
    if (eventTickerResult && eventTickerResult.confidence >= 0.85) {
      return eventTickerResult;
    }
  }

  // 3. Try category (may contain event ticker, not actual category)
  if (category) {
    // Check if category looks like a ticker (starts with KX)
    if (category.startsWith('KX') || category.startsWith('kx')) {
      const derivedSeriesTicker = extractSeriesTickerFromEvent(category);
      if (derivedSeriesTicker) {
        const tickerResult = classifyKalshiByTicker(derivedSeriesTicker);
        if (tickerResult) {
          return tickerResult;
        }
      }
    }

    // Try as actual category
    const categoryResult = classifyKalshiByCategory(category);
    if (categoryResult && categoryResult.topic !== CanonicalTopic.UNKNOWN) {
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

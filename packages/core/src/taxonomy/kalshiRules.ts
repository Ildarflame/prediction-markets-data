/**
 * Kalshi Taxonomy Rules (v3.0.10)
 *
 * Maps Kalshi series tickers and categories to canonical topics.
 * Based on analysis of Kalshi API series data.
 *
 * v3.0.2: Added RATES override for Economics category when rate keywords present
 * v3.0.8: Added COMMODITIES detection via tags, improved ELECTIONS coverage
 * v3.0.9: Added CLIMATE classification (category "Climate and Weather", ticker patterns, tags)
 * v3.0.10: Fixed COMMODITIES false positives (KXGOLDCARDS, KXGASOSR), added WTI/SPR/AAA patterns
 */

import { CanonicalTopic, TopicRule, KalshiSeriesInfo, TopicClassification, TopicSource } from './types.js';
import { getKalshiEventTicker, getKalshiSeriesTicker } from '../utils.js';

/**
 * Rate-related keywords for RATES override (v3.0.2)
 * If a market has category "Economics" but contains these keywords, classify as RATES
 */
const RATE_KEYWORDS = /\b(fed(?:eral)?\s+reserve|fomc|rate\s+cut|rate\s+hike|interest\s+rate|basis\s+points?|bps|fed\s+funds?)\b/i;

/**
 * Commodity-related tags for COMMODITIES classification (v3.0.10)
 * If a market has these tags (regardless of category), classify as COMMODITIES
 * Note: 'energy' and 'gas' removed - too broad (would catch EV markets, generic)
 */
const COMMODITY_TAGS = new Set([
  'oil', 'crude', 'crude oil', 'wti', 'brent',
  'oil and energy',  // Actual Kalshi tag for commodities
  'gold', 'silver', 'platinum', 'palladium',
  'metals', 'precious metals',
  'natural gas',  // Specific, not just 'gas'
  'commodities', 'commodity',
  'agriculture', 'wheat', 'corn', 'soybeans', 'coffee', 'sugar',
  'copper', 'aluminum', 'iron',
]);

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
  // v3.0.8: Require crypto prefix (BTC/ETH/SOL/DOGE/XRP) to avoid misclassifying non-crypto UPDOWN markets
  { pattern: /^KX(BTC|ETH|SOL|DOGE|XRP).*UPDOWN/i, topic: CanonicalTopic.CRYPTO_INTRADAY, confidence: 0.98, description: 'Crypto up/down intraday' },
  { pattern: /^KX(BTC|ETH|SOL|DOGE|XRP).*15MIN/i, topic: CanonicalTopic.CRYPTO_INTRADAY, confidence: 0.98, description: 'Crypto 15-minute' },
  { pattern: /^KX(BTC|ETH|SOL|DOGE|XRP).*30MIN/i, topic: CanonicalTopic.CRYPTO_INTRADAY, confidence: 0.98, description: 'Crypto 30-minute' },
  { pattern: /^KX(BTC|ETH|SOL|DOGE|XRP).*1HR/i, topic: CanonicalTopic.CRYPTO_INTRADAY, confidence: 0.98, description: 'Crypto 1-hour' },
  { pattern: /^KX(BTC|ETH|SOL|DOGE|XRP).*INTRADAY/i, topic: CanonicalTopic.CRYPTO_INTRADAY, confidence: 0.98, description: 'Crypto intraday' },
  // Also catch any intraday pattern for known crypto tickers
  { pattern: /^KXCRYPTO.*INTRADAY/i, topic: CanonicalTopic.CRYPTO_INTRADAY, confidence: 0.98, description: 'Crypto intraday generic' },

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

  // Elections - Political outcomes (v3.0.8: expanded patterns)
  { pattern: /^PRES/i, topic: CanonicalTopic.ELECTIONS, confidence: 0.95, description: 'Presidential' },
  { pattern: /^KXPRES/i, topic: CanonicalTopic.ELECTIONS, confidence: 0.95, description: 'Presidential (KX)' },
  { pattern: /^SENATE/i, topic: CanonicalTopic.ELECTIONS, confidence: 0.95, description: 'Senate' },
  { pattern: /^HOUSE/i, topic: CanonicalTopic.ELECTIONS, confidence: 0.90, description: 'House' },
  { pattern: /^GOV/i, topic: CanonicalTopic.ELECTIONS, confidence: 0.90, description: 'Governor' },
  { pattern: /ELECTION/i, topic: CanonicalTopic.ELECTIONS, confidence: 0.85, description: 'Election' },
  { pattern: /^KXTRUMP/i, topic: CanonicalTopic.ELECTIONS, confidence: 0.90, description: 'Trump related' },
  { pattern: /^KXBIDEN/i, topic: CanonicalTopic.ELECTIONS, confidence: 0.90, description: 'Biden related' },
  { pattern: /^KXPOLITICS/i, topic: CanonicalTopic.ELECTIONS, confidence: 0.90, description: 'Politics' },
  { pattern: /^KXCONGRESS/i, topic: CanonicalTopic.ELECTIONS, confidence: 0.90, description: 'Congress' },
  { pattern: /^KXPOLICY/i, topic: CanonicalTopic.ELECTIONS, confidence: 0.85, description: 'Policy' },

  // Commodities - Prices and futures (v3.0.10: fixed false positives)
  // Oil
  { pattern: /^KXOIL/i, topic: CanonicalTopic.COMMODITIES, confidence: 0.95, description: 'Oil price' },
  { pattern: /^OIL/i, topic: CanonicalTopic.COMMODITIES, confidence: 0.95, description: 'Oil price (legacy)' },
  { pattern: /^KXCRUDE/i, topic: CanonicalTopic.COMMODITIES, confidence: 0.95, description: 'Crude oil' },
  // WTI - both KX and legacy prefixes
  { pattern: /^KXWTI/i, topic: CanonicalTopic.COMMODITIES, confidence: 0.95, description: 'WTI oil' },
  { pattern: /^WTI/i, topic: CanonicalTopic.COMMODITIES, confidence: 0.95, description: 'WTI oil (legacy)' },
  { pattern: /^KXBRENT/i, topic: CanonicalTopic.COMMODITIES, confidence: 0.95, description: 'Brent oil' },
  // Natural gas - KXNGAS only, NOT KXGAS (would catch KXGASOSR = Georgia elections!)
  { pattern: /^KXNGAS/i, topic: CanonicalTopic.COMMODITIES, confidence: 0.95, description: 'Natural gas' },
  { pattern: /^KXNGASMAX/i, topic: CanonicalTopic.COMMODITIES, confidence: 0.95, description: 'Natural gas max' },
  // AAA gas prices (retail gasoline, not natural gas)
  { pattern: /^KXAAAGASM?/i, topic: CanonicalTopic.COMMODITIES, confidence: 0.95, description: 'AAA gas price' },
  { pattern: /^AAAGASM?/i, topic: CanonicalTopic.COMMODITIES, confidence: 0.95, description: 'AAA gas price (legacy)' },
  // SPR - Strategic Petroleum Reserve
  { pattern: /^KXSPR/i, topic: CanonicalTopic.COMMODITIES, confidence: 0.95, description: 'SPR petroleum' },
  { pattern: /^SPR/i, topic: CanonicalTopic.COMMODITIES, confidence: 0.95, description: 'SPR petroleum (legacy)' },
  // Precious metals - exclude false positives (GOLDCARD, GOLDEN*, SILVERSTATES, SILVERAPPROVE)
  { pattern: /^KXGOLD(?!CARD|EN)/i, topic: CanonicalTopic.COMMODITIES, confidence: 0.95, description: 'Gold price' },
  { pattern: /^KXSILVER(?!STATE|APPROVE)/i, topic: CanonicalTopic.COMMODITIES, confidence: 0.95, description: 'Silver price' },
  // Base metals
  { pattern: /^KXCOPPER/i, topic: CanonicalTopic.COMMODITIES, confidence: 0.95, description: 'Copper' },
  // Energy (generic - lower priority)
  { pattern: /^KXENERGY/i, topic: CanonicalTopic.COMMODITIES, confidence: 0.90, description: 'Energy' },

  // Climate/Weather (v3.0.9, v3.0.10: added EV market share)
  { pattern: /^KXHUR/i, topic: CanonicalTopic.CLIMATE, confidence: 0.95, description: 'Hurricane' },
  { pattern: /^HUR/i, topic: CanonicalTopic.CLIMATE, confidence: 0.95, description: 'Hurricane (legacy)' },
  { pattern: /^KXHIGH/i, topic: CanonicalTopic.CLIMATE, confidence: 0.90, description: 'High temperature' },
  { pattern: /^KXLOW/i, topic: CanonicalTopic.CLIMATE, confidence: 0.90, description: 'Low temperature' },
  { pattern: /^KXSNOW/i, topic: CanonicalTopic.CLIMATE, confidence: 0.95, description: 'Snowfall' },
  { pattern: /^KXHEAT/i, topic: CanonicalTopic.CLIMATE, confidence: 0.95, description: 'Heat' },
  { pattern: /^KXRAIN/i, topic: CanonicalTopic.CLIMATE, confidence: 0.95, description: 'Rainfall' },
  { pattern: /^KXFLOOD/i, topic: CanonicalTopic.CLIMATE, confidence: 0.95, description: 'Flood' },
  { pattern: /^KXWILDFIRE/i, topic: CanonicalTopic.CLIMATE, confidence: 0.95, description: 'Wildfire' },
  { pattern: /^KXTORNADO/i, topic: CanonicalTopic.CLIMATE, confidence: 0.95, description: 'Tornado' },
  // EV market share - climate-related (v3.0.10)
  { pattern: /^KXEVSHARE/i, topic: CanonicalTopic.CLIMATE, confidence: 0.90, description: 'EV market share' },
  { pattern: /^EVSHARE/i, topic: CanonicalTopic.CLIMATE, confidence: 0.90, description: 'EV market share (legacy)' },
  { pattern: /^EVMKT/i, topic: CanonicalTopic.CLIMATE, confidence: 0.90, description: 'EV market' },

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

  // Climate/Weather (v3.0.9: added composite category "climate and weather")
  'climate': CanonicalTopic.CLIMATE,
  'weather': CanonicalTopic.CLIMATE,
  'climate and weather': CanonicalTopic.CLIMATE,

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

  // Climate tags (v3.0.10: added EV, electric vehicles)
  'hurricane': CanonicalTopic.CLIMATE,
  'hurricanes': CanonicalTopic.CLIMATE,
  'temperature': CanonicalTopic.CLIMATE,
  'daily temperature': CanonicalTopic.CLIMATE,
  'weather': CanonicalTopic.CLIMATE,
  'snow': CanonicalTopic.CLIMATE,
  'snow and rain': CanonicalTopic.CLIMATE,
  'rainfall': CanonicalTopic.CLIMATE,
  'natural disasters': CanonicalTopic.CLIMATE,
  'storm': CanonicalTopic.CLIMATE,
  'tornado': CanonicalTopic.CLIMATE,
  'flood': CanonicalTopic.CLIMATE,
  'drought': CanonicalTopic.CLIMATE,
  'wildfire': CanonicalTopic.CLIMATE,
  'heat': CanonicalTopic.CLIMATE,
  'cold': CanonicalTopic.CLIMATE,
  // EV/Electric vehicles (v3.0.10)
  'ev': CanonicalTopic.CLIMATE,
  'electric vehicles': CanonicalTopic.CLIMATE,
  'electric vehicle': CanonicalTopic.CLIMATE,

  // Commodities tags (v3.0.10: removed 'energy' - too broad, catches EV markets)
  'oil': CanonicalTopic.COMMODITIES,
  'crude': CanonicalTopic.COMMODITIES,
  'crude oil': CanonicalTopic.COMMODITIES,
  'wti': CanonicalTopic.COMMODITIES,
  'brent': CanonicalTopic.COMMODITIES,
  'oil and energy': CanonicalTopic.COMMODITIES,  // Specific Kalshi tag
  'gold': CanonicalTopic.COMMODITIES,
  'silver': CanonicalTopic.COMMODITIES,
  'platinum': CanonicalTopic.COMMODITIES,
  'palladium': CanonicalTopic.COMMODITIES,
  'metals': CanonicalTopic.COMMODITIES,
  'precious metals': CanonicalTopic.COMMODITIES,
  'natural gas': CanonicalTopic.COMMODITIES,
  // 'energy' removed - too broad (v3.0.10)
  'commodities': CanonicalTopic.COMMODITIES,
  'commodity': CanonicalTopic.COMMODITIES,
  'agriculture': CanonicalTopic.COMMODITIES,
  'wheat': CanonicalTopic.COMMODITIES,
  'corn': CanonicalTopic.COMMODITIES,
  'soybeans': CanonicalTopic.COMMODITIES,
  'coffee': CanonicalTopic.COMMODITIES,
  'sugar': CanonicalTopic.COMMODITIES,
  'copper': CanonicalTopic.COMMODITIES,
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
 * Check if tags contain commodity-related keywords (v3.0.10)
 * Note: Removed partial matching to avoid false positives (e.g., "Energy" → 'oil and energy')
 */
function hasCommodityTags(tags: string[]): boolean {
  for (const tag of tags) {
    const tagLower = tag.toLowerCase().trim();
    if (COMMODITY_TAGS.has(tagLower)) {
      return true;
    }
  }
  return false;
}

/**
 * Classify a Kalshi series using all available info (v3.0.10)
 * Priority: 1) High-confidence ticker patterns 2) Tags 3) Category 4) Fallback ticker
 *
 * v3.0.2: Check tags first to allow RATES override for Economics category
 * v3.0.8: Added COMMODITIES detection via tags
 * v3.0.10: Check ticker patterns FIRST for specific overrides (EV→CLIMATE, etc.)
 */
export function classifyKalshiSeries(series: KalshiSeriesInfo): TopicClassification {
  // 0. Check high-confidence ticker patterns FIRST (v3.0.10: prevents false positives)
  // This catches EV series that have "Energy" tag but should be CLIMATE
  const tickerFirst = classifyKalshiByTicker(series.ticker);
  if (tickerFirst && tickerFirst.confidence >= 0.90) {
    return tickerFirst;
  }

  // 1. Try tag analysis (v3.0.2/v3.0.8: allows RATES/COMMODITIES override)
  if (series.tags.length > 0) {
    // v3.0.8: Check for commodity tags first (highest priority for commodity detection)
    if (hasCommodityTags(series.tags)) {
      return {
        topic: CanonicalTopic.COMMODITIES,
        confidence: 0.90,
        source: TopicSource.SERIES_METADATA,
        reason: `COMMODITIES: tags contain commodity keywords`,
      };
    }

    const tagResult = classifyKalshiByTags(series.tags);
    if (tagResult && tagResult.topic !== CanonicalTopic.UNKNOWN) {
      return tagResult;
    }
  }

  // 2. Try category mapping
  if (series.category) {
    const categoryResult = classifyKalshiByCategory(series.category);
    if (categoryResult && categoryResult.topic !== CanonicalTopic.UNKNOWN) {
      // v3.0.2: Check for RATES override when category is Economics/Macro
      // Fed rate markets often have category "Economics" but should be RATES
      if (categoryResult.topic === CanonicalTopic.MACRO) {
        // Check title for rate keywords
        if (RATE_KEYWORDS.test(series.title)) {
          return {
            topic: CanonicalTopic.RATES,
            confidence: 0.90,
            source: TopicSource.TITLE_KEYWORDS,
            reason: `RATES override: title contains rate keywords (category was ${series.category})`,
          };
        }
        // Check tags for rate keywords
        const tagsLower = series.tags.map(t => t.toLowerCase()).join(' ');
        if (/\b(fed|fomc|interest|rate|central bank)\b/i.test(tagsLower)) {
          return {
            topic: CanonicalTopic.RATES,
            confidence: 0.90,
            source: TopicSource.SERIES_METADATA,
            reason: `RATES override: tags contain rate keywords (category was ${series.category})`,
          };
        }
      }
      return categoryResult;
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

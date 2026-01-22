/**
 * Polymarket Taxonomy Rules (v3.0.1)
 *
 * Maps Polymarket categories and tags to canonical topics.
 * Based on analysis of Polymarket Gamma API data.
 *
 * v3.0.1: Updated to handle actual Gamma API category formats
 */

import { CanonicalTopic, TopicRule, PolymarketMarketInfo, TopicClassification, TopicSource } from './types.js';

/**
 * Polymarket category to topic mapping
 * Categories come from the market's category field or groupItemTitle
 *
 * Note: Polymarket Gamma API uses various category formats:
 * - Hyphenated slugs: "US-current-affairs", "pop-culture"
 * - Title case: "Crypto", "Sports"
 * - Event-specific: "2024 Election", "Super Bowl"
 *
 * We normalize all to lowercase and handle both formats.
 */
export const POLYMARKET_CATEGORY_MAP: Record<string, CanonicalTopic> = {
  // === Gamma API native categories (hyphenated slugs) ===
  'us-current-affairs': CanonicalTopic.ELECTIONS,
  'us current affairs': CanonicalTopic.ELECTIONS,
  'world-current-affairs': CanonicalTopic.GEOPOLITICS,
  'world current affairs': CanonicalTopic.GEOPOLITICS,
  'pop-culture': CanonicalTopic.ENTERTAINMENT,
  'pop culture': CanonicalTopic.ENTERTAINMENT,
  'science-tech': CanonicalTopic.UNKNOWN, // Broad category
  'science tech': CanonicalTopic.UNKNOWN,
  'business': CanonicalTopic.MACRO,

  // === Crypto ===
  'crypto': CanonicalTopic.CRYPTO_DAILY,
  'cryptocurrency': CanonicalTopic.CRYPTO_DAILY,
  'bitcoin': CanonicalTopic.CRYPTO_DAILY,
  'ethereum': CanonicalTopic.CRYPTO_DAILY,
  'btc': CanonicalTopic.CRYPTO_DAILY,
  'eth': CanonicalTopic.CRYPTO_DAILY,
  'defi': CanonicalTopic.CRYPTO_DAILY,
  'web3': CanonicalTopic.CRYPTO_DAILY,
  'solana': CanonicalTopic.CRYPTO_DAILY,
  'sol': CanonicalTopic.CRYPTO_DAILY,
  'doge': CanonicalTopic.CRYPTO_DAILY,
  'dogecoin': CanonicalTopic.CRYPTO_DAILY,
  'xrp': CanonicalTopic.CRYPTO_DAILY,
  'ripple': CanonicalTopic.CRYPTO_DAILY,

  // === Macro / Economics ===
  'economics': CanonicalTopic.MACRO,
  'economy': CanonicalTopic.MACRO,
  'inflation': CanonicalTopic.MACRO,
  'cpi': CanonicalTopic.MACRO,
  'gdp': CanonicalTopic.MACRO,
  'jobs': CanonicalTopic.MACRO,
  'employment': CanonicalTopic.MACRO,
  'unemployment': CanonicalTopic.MACRO,
  'labor': CanonicalTopic.MACRO,
  'nfp': CanonicalTopic.MACRO,
  'payrolls': CanonicalTopic.MACRO,
  'recession': CanonicalTopic.MACRO,

  // === Rates / Central Banks ===
  'fed': CanonicalTopic.RATES,
  'fomc': CanonicalTopic.RATES,
  'federal reserve': CanonicalTopic.RATES,
  'federal-reserve': CanonicalTopic.RATES,
  'interest rate': CanonicalTopic.RATES,
  'interest-rate': CanonicalTopic.RATES,
  'interest rates': CanonicalTopic.RATES,
  'interest-rates': CanonicalTopic.RATES,
  'central bank': CanonicalTopic.RATES,
  'central-bank': CanonicalTopic.RATES,
  'ecb': CanonicalTopic.RATES,
  'bank of england': CanonicalTopic.RATES,
  'bank-of-england': CanonicalTopic.RATES,
  'rate cut': CanonicalTopic.RATES,
  'rate-cut': CanonicalTopic.RATES,
  'rate hike': CanonicalTopic.RATES,
  'rate-hike': CanonicalTopic.RATES,

  // === Elections / Politics ===
  'politics': CanonicalTopic.ELECTIONS,
  'election': CanonicalTopic.ELECTIONS,
  'elections': CanonicalTopic.ELECTIONS,
  'political': CanonicalTopic.ELECTIONS,
  'president': CanonicalTopic.ELECTIONS,
  'presidential': CanonicalTopic.ELECTIONS,
  'senate': CanonicalTopic.ELECTIONS,
  'congress': CanonicalTopic.ELECTIONS,
  'house': CanonicalTopic.ELECTIONS,
  'governor': CanonicalTopic.ELECTIONS,
  '2024 election': CanonicalTopic.ELECTIONS,
  '2024-election': CanonicalTopic.ELECTIONS,
  '2025 election': CanonicalTopic.ELECTIONS,
  '2025-election': CanonicalTopic.ELECTIONS,
  '2026 election': CanonicalTopic.ELECTIONS,
  '2026-election': CanonicalTopic.ELECTIONS,
  'trump': CanonicalTopic.ELECTIONS,
  'biden': CanonicalTopic.ELECTIONS,
  'harris': CanonicalTopic.ELECTIONS,
  'midterms': CanonicalTopic.ELECTIONS,
  'primary': CanonicalTopic.ELECTIONS,
  'primaries': CanonicalTopic.ELECTIONS,
  'democratic': CanonicalTopic.ELECTIONS,
  'republican': CanonicalTopic.ELECTIONS,
  'gop': CanonicalTopic.ELECTIONS,
  'dnc': CanonicalTopic.ELECTIONS,
  'rnc': CanonicalTopic.ELECTIONS,

  // === Geopolitics ===
  'geopolitics': CanonicalTopic.GEOPOLITICS,
  'international': CanonicalTopic.GEOPOLITICS,
  'war': CanonicalTopic.GEOPOLITICS,
  'conflict': CanonicalTopic.GEOPOLITICS,
  'ukraine': CanonicalTopic.GEOPOLITICS,
  'russia': CanonicalTopic.GEOPOLITICS,
  'china': CanonicalTopic.GEOPOLITICS,
  'israel': CanonicalTopic.GEOPOLITICS,
  'gaza': CanonicalTopic.GEOPOLITICS,
  'middle east': CanonicalTopic.GEOPOLITICS,
  'middle-east': CanonicalTopic.GEOPOLITICS,
  'nato': CanonicalTopic.GEOPOLITICS,
  'sanctions': CanonicalTopic.GEOPOLITICS,

  // === Sports ===
  'sports': CanonicalTopic.SPORTS,
  'esports': CanonicalTopic.SPORTS,
  'e-sports': CanonicalTopic.SPORTS,
  'nba': CanonicalTopic.SPORTS,
  'nfl': CanonicalTopic.SPORTS,
  'mlb': CanonicalTopic.SPORTS,
  'nhl': CanonicalTopic.SPORTS,
  'soccer': CanonicalTopic.SPORTS,
  'football': CanonicalTopic.SPORTS,
  'basketball': CanonicalTopic.SPORTS,
  'baseball': CanonicalTopic.SPORTS,
  'hockey': CanonicalTopic.SPORTS,
  'tennis': CanonicalTopic.SPORTS,
  'golf': CanonicalTopic.SPORTS,
  'boxing': CanonicalTopic.SPORTS,
  'mma': CanonicalTopic.SPORTS,
  'ufc': CanonicalTopic.SPORTS,
  'olympics': CanonicalTopic.SPORTS,
  'super bowl': CanonicalTopic.SPORTS,
  'super-bowl': CanonicalTopic.SPORTS,
  'world cup': CanonicalTopic.SPORTS,
  'world-cup': CanonicalTopic.SPORTS,
  'march madness': CanonicalTopic.SPORTS,
  'march-madness': CanonicalTopic.SPORTS,
  'ncaa': CanonicalTopic.SPORTS,
  'f1': CanonicalTopic.SPORTS,
  'formula 1': CanonicalTopic.SPORTS,
  'formula-1': CanonicalTopic.SPORTS,

  // === Entertainment ===
  'entertainment': CanonicalTopic.ENTERTAINMENT,
  'awards': CanonicalTopic.ENTERTAINMENT,
  'oscars': CanonicalTopic.ENTERTAINMENT,
  'grammys': CanonicalTopic.ENTERTAINMENT,
  'emmys': CanonicalTopic.ENTERTAINMENT,
  'golden globes': CanonicalTopic.ENTERTAINMENT,
  'golden-globes': CanonicalTopic.ENTERTAINMENT,
  'tv': CanonicalTopic.ENTERTAINMENT,
  'movies': CanonicalTopic.ENTERTAINMENT,
  'music': CanonicalTopic.ENTERTAINMENT,
  'celebrity': CanonicalTopic.ENTERTAINMENT,
  'celebrities': CanonicalTopic.ENTERTAINMENT,

  // === Climate / Weather ===
  'climate': CanonicalTopic.CLIMATE,
  'weather': CanonicalTopic.CLIMATE,
  'hurricane': CanonicalTopic.CLIMATE,
  'temperature': CanonicalTopic.CLIMATE,
  'global warming': CanonicalTopic.CLIMATE,
  'global-warming': CanonicalTopic.CLIMATE,
};

/**
 * Polymarket title keyword rules for topic detection
 * Used when category/tags don't provide clear classification
 */
export const POLYMARKET_TITLE_RULES: TopicRule[] = [
  // Crypto Daily
  { pattern: /\bbitcoin\b/i, topic: CanonicalTopic.CRYPTO_DAILY, confidence: 0.90, description: 'Bitcoin in title' },
  { pattern: /\bbtc\b/i, topic: CanonicalTopic.CRYPTO_DAILY, confidence: 0.85, description: 'BTC in title' },
  { pattern: /\bethereum\b/i, topic: CanonicalTopic.CRYPTO_DAILY, confidence: 0.90, description: 'Ethereum in title' },
  { pattern: /\beth\b(?!nic|ics|er)/i, topic: CanonicalTopic.CRYPTO_DAILY, confidence: 0.80, description: 'ETH in title' },
  { pattern: /\bsolana\b/i, topic: CanonicalTopic.CRYPTO_DAILY, confidence: 0.90, description: 'Solana in title' },
  { pattern: /\$(?:BTC|ETH|SOL|DOGE|XRP)\b/i, topic: CanonicalTopic.CRYPTO_DAILY, confidence: 0.95, description: 'Crypto ticker symbol' },

  // Macro
  { pattern: /\bcpi\b/i, topic: CanonicalTopic.MACRO, confidence: 0.95, description: 'CPI in title' },
  { pattern: /\binflation\b/i, topic: CanonicalTopic.MACRO, confidence: 0.90, description: 'Inflation in title' },
  { pattern: /\bgdp\b/i, topic: CanonicalTopic.MACRO, confidence: 0.95, description: 'GDP in title' },
  { pattern: /\bnon-?farm payrolls?\b/i, topic: CanonicalTopic.MACRO, confidence: 0.95, description: 'NFP in title' },
  { pattern: /\bnfp\b/i, topic: CanonicalTopic.MACRO, confidence: 0.95, description: 'NFP abbreviation' },
  { pattern: /\bunemployment rate\b/i, topic: CanonicalTopic.MACRO, confidence: 0.95, description: 'Unemployment rate' },
  { pattern: /\bjobless claims\b/i, topic: CanonicalTopic.MACRO, confidence: 0.95, description: 'Jobless claims' },
  { pattern: /\bpce\b/i, topic: CanonicalTopic.MACRO, confidence: 0.95, description: 'PCE in title' },
  { pattern: /\bpmi\b/i, topic: CanonicalTopic.MACRO, confidence: 0.90, description: 'PMI in title' },

  // Rates
  { pattern: /\bfed(?:eral reserve)?\b.*\brate/i, topic: CanonicalTopic.RATES, confidence: 0.95, description: 'Fed rate' },
  { pattern: /\bfomc\b/i, topic: CanonicalTopic.RATES, confidence: 0.95, description: 'FOMC in title' },
  { pattern: /\bfed funds?\b/i, topic: CanonicalTopic.RATES, confidence: 0.95, description: 'Fed funds' },
  { pattern: /\binterest rate\b/i, topic: CanonicalTopic.RATES, confidence: 0.85, description: 'Interest rate' },
  { pattern: /\brate (?:cut|hike|hold)\b/i, topic: CanonicalTopic.RATES, confidence: 0.85, description: 'Rate action' },
  { pattern: /\bcentral bank\b/i, topic: CanonicalTopic.RATES, confidence: 0.85, description: 'Central bank' },
  { pattern: /\becb\b/i, topic: CanonicalTopic.RATES, confidence: 0.90, description: 'ECB in title' },
  { pattern: /\bbank of england\b/i, topic: CanonicalTopic.RATES, confidence: 0.90, description: 'BoE in title' },
  { pattern: /\bbasis points?\b/i, topic: CanonicalTopic.RATES, confidence: 0.80, description: 'Basis points' },
  { pattern: /\b\d+\s*bps?\b/i, topic: CanonicalTopic.RATES, confidence: 0.75, description: 'BPS value' },

  // Elections
  { pattern: /\bpresident(?:ial)?\b/i, topic: CanonicalTopic.ELECTIONS, confidence: 0.85, description: 'Presidential' },
  { pattern: /\belection\b/i, topic: CanonicalTopic.ELECTIONS, confidence: 0.80, description: 'Election' },
  { pattern: /\bsenate\b/i, topic: CanonicalTopic.ELECTIONS, confidence: 0.85, description: 'Senate' },
  { pattern: /\bcongress(?:man|woman|ional)?\b/i, topic: CanonicalTopic.ELECTIONS, confidence: 0.80, description: 'Congress' },
  { pattern: /\bgovernor\b/i, topic: CanonicalTopic.ELECTIONS, confidence: 0.85, description: 'Governor' },
  { pattern: /\btrump\b/i, topic: CanonicalTopic.ELECTIONS, confidence: 0.75, description: 'Trump' },
  { pattern: /\bbiden\b/i, topic: CanonicalTopic.ELECTIONS, confidence: 0.75, description: 'Biden' },
  { pattern: /\bharris\b/i, topic: CanonicalTopic.ELECTIONS, confidence: 0.75, description: 'Harris' },
  { pattern: /\bwin\s+(?:the\s+)?(?:\d{4}\s+)?(?:presidential\s+)?election\b/i, topic: CanonicalTopic.ELECTIONS, confidence: 0.90, description: 'Win election' },
];

/**
 * Normalize a category string for lookup
 * Handles hyphenated slugs, title case, etc.
 */
function normalizeCategory(category: string): string[] {
  const base = category.toLowerCase().trim();

  // Return multiple variants to check
  const variants = [base];

  // Add hyphen-to-space variant: "us-current-affairs" -> "us current affairs"
  if (base.includes('-')) {
    variants.push(base.replace(/-/g, ' '));
  }

  // Add space-to-hyphen variant: "pop culture" -> "pop-culture"
  if (base.includes(' ')) {
    variants.push(base.replace(/\s+/g, '-'));
  }

  return variants;
}

/**
 * Classify by Polymarket category
 * Handles various category formats from Gamma API
 */
export function classifyPolymarketByCategory(category: string): TopicClassification | null {
  const variants = normalizeCategory(category);

  for (const variant of variants) {
    const topic = POLYMARKET_CATEGORY_MAP[variant];
    if (topic) {
      return {
        topic,
        confidence: 0.85,
        source: TopicSource.CATEGORY,
        reason: `Category: ${category}`,
      };
    }
  }

  // Try partial word matching for compound categories
  // e.g., "us-current-affairs" contains "politics"
  const words = category.toLowerCase().replace(/-/g, ' ').split(/\s+/);
  for (const word of words) {
    const topic = POLYMARKET_CATEGORY_MAP[word];
    if (topic && topic !== CanonicalTopic.UNKNOWN) {
      return {
        topic,
        confidence: 0.70, // Lower confidence for partial match
        source: TopicSource.CATEGORY,
        reason: `Category word: ${word} (from ${category})`,
      };
    }
  }

  return null;
}

/**
 * Classify by Polymarket title keywords
 */
export function classifyPolymarketByTitle(title: string): TopicClassification | null {
  for (const rule of POLYMARKET_TITLE_RULES) {
    const pattern = typeof rule.pattern === 'string'
      ? new RegExp(rule.pattern, 'i')
      : rule.pattern;

    if (pattern.test(title)) {
      return {
        topic: rule.topic,
        confidence: rule.confidence,
        source: TopicSource.TITLE_KEYWORDS,
        subTopic: rule.subTopic,
        reason: rule.description,
      };
    }
  }
  return null;
}

/**
 * Classify a Polymarket market using all available info
 */
export function classifyPolymarketMarket(market: PolymarketMarketInfo): TopicClassification {
  // 1. Try category first
  if (market.category) {
    const categoryResult = classifyPolymarketByCategory(market.category);
    if (categoryResult && categoryResult.confidence >= 0.80) {
      return categoryResult;
    }
  }

  // 2. Try groupItemTitle
  if (market.groupItemTitle) {
    const groupResult = classifyPolymarketByCategory(market.groupItemTitle);
    if (groupResult) {
      return {
        ...groupResult,
        confidence: groupResult.confidence * 0.9, // Slightly lower confidence
        reason: `Group: ${market.groupItemTitle}`,
      };
    }
  }

  // 3. Try title keyword analysis
  const titleResult = classifyPolymarketByTitle(market.title);
  if (titleResult) {
    return titleResult;
  }

  // 4. Try tags
  if (market.tags && market.tags.length > 0) {
    for (const tag of market.tags) {
      const tagLower = tag.toLowerCase();
      const topic = POLYMARKET_CATEGORY_MAP[tagLower];
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

  // 5. Fallback to unknown
  return {
    topic: CanonicalTopic.UNKNOWN,
    confidence: 0.0,
    source: TopicSource.FALLBACK,
    reason: 'No matching rule',
  };
}

/**
 * Extract tags from Polymarket metadata
 */
export function extractPolymarketTags(metadata: Record<string, unknown> | null | undefined): string[] {
  if (!metadata) return [];

  const tags: string[] = [];

  // Extract category
  if (typeof metadata.category === 'string') {
    tags.push(metadata.category);
  }

  // Extract groupItemTitle
  if (typeof metadata.groupItemTitle === 'string') {
    tags.push(metadata.groupItemTitle);
  }

  // Extract tags array
  if (Array.isArray(metadata.tags)) {
    for (const tag of metadata.tags) {
      if (typeof tag === 'string') {
        tags.push(tag);
      }
    }
  }

  return tags;
}

/**
 * Polymarket Taxonomy Rules (v3.0.2)
 *
 * Maps Polymarket categories and tags to canonical topics.
 * Based on analysis of Polymarket Gamma API data.
 *
 * v3.0.1: Updated to handle actual Gamma API category formats
 * v3.0.2: Metadata-first classification using pmCategories/pmTags from DB
 *         Added precedence rules (crypto overrides politics for price markets)
 */

import { CanonicalTopic, TopicRule, PolymarketMarketInfo, TopicClassification, TopicSource } from './types.js';

/**
 * Extended market info with v3.0.2 taxonomy fields
 */
export interface PolymarketMarketInfoV2 extends PolymarketMarketInfo {
  pmCategories?: Array<{ slug: string; label: string }>;
  pmTags?: Array<{ slug: string; label: string }>;
  pmEventCategory?: string;
  pmEventSubcategory?: string;
}

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

  // === Commodities (v3.0.4) ===
  'commodities': CanonicalTopic.COMMODITIES,
  'oil': CanonicalTopic.COMMODITIES,
  'crude oil': CanonicalTopic.COMMODITIES,
  'crude-oil': CanonicalTopic.COMMODITIES,
  'wti': CanonicalTopic.COMMODITIES,
  'brent': CanonicalTopic.COMMODITIES,
  'petroleum': CanonicalTopic.COMMODITIES,
  'gold': CanonicalTopic.COMMODITIES,
  'silver': CanonicalTopic.COMMODITIES,
  'copper': CanonicalTopic.COMMODITIES,
  'natural gas': CanonicalTopic.COMMODITIES,
  'natural-gas': CanonicalTopic.COMMODITIES,
  'natgas': CanonicalTopic.COMMODITIES,
  'corn': CanonicalTopic.COMMODITIES,
  'wheat': CanonicalTopic.COMMODITIES,
  'soybeans': CanonicalTopic.COMMODITIES,
  'soy': CanonicalTopic.COMMODITIES,
  'agriculture': CanonicalTopic.COMMODITIES,
  'futures': CanonicalTopic.COMMODITIES,
};

/**
 * Polymarket tag slug to topic mapping (v3.0.3)
 * Tags come from event.tags[] array in Gamma API
 * Based on actual API response analysis
 */
export const PM_TAG_MAP: Record<string, CanonicalTopic> = {
  // === Crypto ===
  'crypto': CanonicalTopic.CRYPTO_DAILY,
  'bitcoin': CanonicalTopic.CRYPTO_DAILY,
  'btc': CanonicalTopic.CRYPTO_DAILY,
  'ethereum': CanonicalTopic.CRYPTO_DAILY,
  'eth': CanonicalTopic.CRYPTO_DAILY,
  'solana': CanonicalTopic.CRYPTO_DAILY,
  'sol': CanonicalTopic.CRYPTO_DAILY,
  'dogecoin': CanonicalTopic.CRYPTO_DAILY,
  'doge': CanonicalTopic.CRYPTO_DAILY,
  'xrp': CanonicalTopic.CRYPTO_DAILY,
  'cryptocurrency': CanonicalTopic.CRYPTO_DAILY,
  'defi': CanonicalTopic.CRYPTO_DAILY,
  'microstrategy': CanonicalTopic.CRYPTO_DAILY,
  'coinbase': CanonicalTopic.CRYPTO_DAILY,
  'exchange': CanonicalTopic.CRYPTO_DAILY,

  // === Macro / Finance ===
  'inflation': CanonicalTopic.MACRO,
  'cpi': CanonicalTopic.MACRO,
  'gdp': CanonicalTopic.MACRO,
  'jobs': CanonicalTopic.MACRO,
  'employment': CanonicalTopic.MACRO,
  'unemployment': CanonicalTopic.MACRO,
  'economy': CanonicalTopic.MACRO,
  'recession': CanonicalTopic.MACRO,
  'finance': CanonicalTopic.MACRO,
  'business': CanonicalTopic.MACRO,
  'stocks': CanonicalTopic.MACRO,
  'ipos': CanonicalTopic.MACRO,
  'tariffs': CanonicalTopic.MACRO,

  // === Rates ===
  'fed': CanonicalTopic.RATES,
  'fomc': CanonicalTopic.RATES,
  'interest-rates': CanonicalTopic.RATES,
  'federal-reserve': CanonicalTopic.RATES,

  // === Elections / Politics ===
  'politics': CanonicalTopic.ELECTIONS,
  'elections': CanonicalTopic.ELECTIONS,
  'us-politics': CanonicalTopic.ELECTIONS,
  'uptspt-politics': CanonicalTopic.ELECTIONS,  // Gamma API actual slug
  'trump': CanonicalTopic.ELECTIONS,
  'trump-presidency': CanonicalTopic.ELECTIONS,
  'biden': CanonicalTopic.ELECTIONS,
  'harris': CanonicalTopic.ELECTIONS,
  '2024-election': CanonicalTopic.ELECTIONS,
  '2025-election': CanonicalTopic.ELECTIONS,
  '2026-election': CanonicalTopic.ELECTIONS,
  'congress': CanonicalTopic.ELECTIONS,
  'senate': CanonicalTopic.ELECTIONS,
  'governor': CanonicalTopic.ELECTIONS,
  'immigration': CanonicalTopic.ELECTIONS,
  'immigrationborder': CanonicalTopic.ELECTIONS,

  // === Sports (expanded with actual Gamma tags) ===
  'sports': CanonicalTopic.SPORTS,
  'nba': CanonicalTopic.SPORTS,
  'nfl': CanonicalTopic.SPORTS,
  'nfl-playoffs': CanonicalTopic.SPORTS,
  'mlb': CanonicalTopic.SPORTS,
  'nhl': CanonicalTopic.SPORTS,
  'soccer': CanonicalTopic.SPORTS,
  'football': CanonicalTopic.SPORTS,
  'basketball': CanonicalTopic.SPORTS,
  'baseball': CanonicalTopic.SPORTS,
  'hockey': CanonicalTopic.SPORTS,
  'tennis': CanonicalTopic.SPORTS,
  'golf': CanonicalTopic.SPORTS,
  'ufc': CanonicalTopic.SPORTS,
  'mma': CanonicalTopic.SPORTS,
  'boxing': CanonicalTopic.SPORTS,
  'esports': CanonicalTopic.SPORTS,
  'olympics': CanonicalTopic.SPORTS,
  'f1': CanonicalTopic.SPORTS,
  'formula-1': CanonicalTopic.SPORTS,
  'ncaab': CanonicalTopic.SPORTS,
  'ncaaf': CanonicalTopic.SPORTS,
  'march-madness': CanonicalTopic.SPORTS,
  'super-bowl': CanonicalTopic.SPORTS,
  'superbowl': CanonicalTopic.SPORTS,
  'epl': CanonicalTopic.SPORTS,       // English Premier League
  'lal': CanonicalTopic.SPORTS,       // La Liga
  'ucl': CanonicalTopic.SPORTS,       // UEFA Champions League
  'cowboys-vs-eagles': CanonicalTopic.SPORTS,
  'afc': CanonicalTopic.SPORTS,
  'nfc': CanonicalTopic.SPORTS,
  'awards': CanonicalTopic.SPORTS,    // Sports awards like MVP

  // === Entertainment ===
  'entertainment': CanonicalTopic.ENTERTAINMENT,
  'pop-culture': CanonicalTopic.ENTERTAINMENT,
  'movies': CanonicalTopic.ENTERTAINMENT,
  'tv': CanonicalTopic.ENTERTAINMENT,
  'music': CanonicalTopic.ENTERTAINMENT,
  'oscars': CanonicalTopic.ENTERTAINMENT,
  'grammys': CanonicalTopic.ENTERTAINMENT,
  'emmys': CanonicalTopic.ENTERTAINMENT,
  'celebrities': CanonicalTopic.ENTERTAINMENT,
  'streaming': CanonicalTopic.ENTERTAINMENT,

  // === Geopolitics ===
  'geopolitics': CanonicalTopic.GEOPOLITICS,
  'war': CanonicalTopic.GEOPOLITICS,
  'ukraine': CanonicalTopic.GEOPOLITICS,
  'russia': CanonicalTopic.GEOPOLITICS,
  'china': CanonicalTopic.GEOPOLITICS,
  'middle-east': CanonicalTopic.GEOPOLITICS,
  'world': CanonicalTopic.GEOPOLITICS,
  'france': CanonicalTopic.GEOPOLITICS,
  'macron': CanonicalTopic.GEOPOLITICS,
  'resign': CanonicalTopic.GEOPOLITICS,

  // === Climate ===
  'climate': CanonicalTopic.CLIMATE,
  'weather': CanonicalTopic.CLIMATE,
  'hurricane': CanonicalTopic.CLIMATE,
  'temperature': CanonicalTopic.CLIMATE,

  // === Tech (mapped to MACRO for now) ===
  'tech': CanonicalTopic.MACRO,
  'ai': CanonicalTopic.MACRO,
  'deepseek': CanonicalTopic.MACRO,

  // === Commodities (v3.0.4) ===
  'commodities': CanonicalTopic.COMMODITIES,
  'oil': CanonicalTopic.COMMODITIES,
  'crude': CanonicalTopic.COMMODITIES,
  'crude-oil': CanonicalTopic.COMMODITIES,
  'wti': CanonicalTopic.COMMODITIES,
  'brent': CanonicalTopic.COMMODITIES,
  'energy': CanonicalTopic.COMMODITIES,
  'nymex-crude-oil-futures': CanonicalTopic.COMMODITIES,
  'gold': CanonicalTopic.COMMODITIES,
  'silver': CanonicalTopic.COMMODITIES,
  'copper': CanonicalTopic.COMMODITIES,
  'comex-gold-futures': CanonicalTopic.COMMODITIES,
  'comex-silver-futures': CanonicalTopic.COMMODITIES,
  'natgas': CanonicalTopic.COMMODITIES,
  'natural-gas': CanonicalTopic.COMMODITIES,
  'corn': CanonicalTopic.COMMODITIES,
  'wheat': CanonicalTopic.COMMODITIES,
  'soy': CanonicalTopic.COMMODITIES,
  'soybeans': CanonicalTopic.COMMODITIES,
  'agriculture': CanonicalTopic.COMMODITIES,
  'futures': CanonicalTopic.COMMODITIES,
  // NOTE: 'daily' and 'up-or-down' removed - too generic, causes crypto misclassification
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

  // Commodities (v3.0.4)
  { pattern: /\bcrude\s*oil\b/i, topic: CanonicalTopic.COMMODITIES, confidence: 0.95, description: 'Crude Oil' },
  { pattern: /\b(?:wti|brent)\b/i, topic: CanonicalTopic.COMMODITIES, confidence: 0.95, description: 'WTI/Brent' },
  { pattern: /\boil\s*\(cl\)/i, topic: CanonicalTopic.COMMODITIES, confidence: 0.95, description: 'Oil (CL)' },
  { pattern: /\bgold\s*\(gc\)/i, topic: CanonicalTopic.COMMODITIES, confidence: 0.95, description: 'Gold (GC)' },
  { pattern: /\bsilver\s*\(si\)/i, topic: CanonicalTopic.COMMODITIES, confidence: 0.95, description: 'Silver (SI)' },
  { pattern: /\bnatural\s*gas\b/i, topic: CanonicalTopic.COMMODITIES, confidence: 0.95, description: 'Natural Gas' },
  { pattern: /\b(?:nymex|comex)\b/i, topic: CanonicalTopic.COMMODITIES, confidence: 0.90, description: 'NYMEX/COMEX' },
  { pattern: /\bsettle\s+(?:over|above|below|under)\s+\$\d/i, topic: CanonicalTopic.COMMODITIES, confidence: 0.85, description: 'Settle price threshold' },
  { pattern: /\bfinal\s+trading\s+day\b/i, topic: CanonicalTopic.COMMODITIES, confidence: 0.80, description: 'Final trading day' },
  { pattern: /\bcorn\s*\(c\)/i, topic: CanonicalTopic.COMMODITIES, confidence: 0.95, description: 'Corn (C)' },
  { pattern: /\bwheat\s*\(w\)/i, topic: CanonicalTopic.COMMODITIES, confidence: 0.95, description: 'Wheat (W)' },
  { pattern: /\bsoybeans?\s*\(s\)/i, topic: CanonicalTopic.COMMODITIES, confidence: 0.95, description: 'Soybeans (S)' },
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

/**
 * Check if title indicates a crypto price market (for precedence rules)
 */
function isCryptoPriceMarket(title: string): boolean {
  const cryptoAssets = /\b(bitcoin|btc|ethereum|eth|solana|sol|doge|xrp)\b/i;
  const priceIndicators = /(\$\d|price|above|below|reach|hit|\d+k|\d+,\d{3})/i;

  return cryptoAssets.test(title) && priceIndicators.test(title);
}

/**
 * Check if title indicates a crypto intraday "up or down" market
 * These are short-term direction prediction markets (e.g., "Bitcoin Up or Down - January 22, 4:25PM-4:30PM ET")
 */
function isCryptoIntradayMarket(title: string): boolean {
  const cryptoAssets = /\b(bitcoin|btc|ethereum|eth|solana|sol|doge|xrp)\b/i;
  const intradayPatterns = /\b(up\s+or\s+down|up\/down|updown)\b/i;
  const timePatterns = /\d{1,2}:\d{2}\s*(AM|PM|ET|UTC)/i;

  // Must have crypto asset AND (up or down pattern OR time pattern like "4:25PM")
  return cryptoAssets.test(title) && (intradayPatterns.test(title) || timePatterns.test(title));
}

/**
 * Classify by pmTags array (v3.0.2)
 */
export function classifyPolymarketByTags(
  pmTags: Array<{ slug: string; label: string }> | null | undefined
): TopicClassification | null {
  if (!pmTags || pmTags.length === 0) return null;

  for (const tag of pmTags) {
    const slug = tag.slug?.toLowerCase();
    const label = tag.label?.toLowerCase();

    // Try slug first
    if (slug && PM_TAG_MAP[slug]) {
      return {
        topic: PM_TAG_MAP[slug],
        confidence: 0.85,
        source: TopicSource.METADATA,
        reason: `PM tag: ${tag.slug}`,
      };
    }

    // Try label
    if (label && PM_TAG_MAP[label]) {
      return {
        topic: PM_TAG_MAP[label],
        confidence: 0.80,
        source: TopicSource.METADATA,
        reason: `PM tag label: ${tag.label}`,
      };
    }

    // Try in main category map
    if (slug && POLYMARKET_CATEGORY_MAP[slug]) {
      return {
        topic: POLYMARKET_CATEGORY_MAP[slug],
        confidence: 0.80,
        source: TopicSource.METADATA,
        reason: `PM tag (category map): ${tag.slug}`,
      };
    }
  }

  return null;
}

/**
 * Classify by pmCategories array (v3.0.2)
 */
export function classifyPolymarketByPmCategories(
  pmCategories: Array<{ slug: string; label: string }> | null | undefined
): TopicClassification | null {
  if (!pmCategories || pmCategories.length === 0) return null;

  for (const cat of pmCategories) {
    const slug = cat.slug?.toLowerCase();
    const label = cat.label?.toLowerCase();

    // Try slug first
    if (slug) {
      const topic = POLYMARKET_CATEGORY_MAP[slug];
      if (topic && topic !== CanonicalTopic.UNKNOWN) {
        return {
          topic,
          confidence: 0.90,
          source: TopicSource.CATEGORY,
          reason: `PM category: ${cat.slug}`,
        };
      }
    }

    // Try label
    if (label) {
      const topic = POLYMARKET_CATEGORY_MAP[label];
      if (topic && topic !== CanonicalTopic.UNKNOWN) {
        return {
          topic,
          confidence: 0.85,
          source: TopicSource.CATEGORY,
          reason: `PM category label: ${cat.label}`,
        };
      }
    }
  }

  return null;
}

/**
 * Classify a Polymarket market using metadata-first approach (v3.0.2)
 *
 * Priority:
 * 1. Precedence rules (crypto price market overrides politics)
 * 2. pmCategories (from Gamma API categories[])
 * 3. pmTags (from Gamma API tags[])
 * 4. pmEventCategory/pmEventSubcategory
 * 5. Legacy category field
 * 6. Title keyword heuristics
 */
export function classifyPolymarketMarketV2(market: PolymarketMarketInfoV2): TopicClassification {
  // === Precedence Rule: Crypto price markets override other classifications ===
  // If the title clearly indicates a crypto price market, classify as CRYPTO_DAILY
  // even if categories/tags suggest politics (e.g., "Will Bitcoin reach $100k before Trump...")
  if (isCryptoPriceMarket(market.title)) {
    return {
      topic: CanonicalTopic.CRYPTO_DAILY,
      confidence: 0.95,
      source: TopicSource.TITLE_KEYWORDS,
      reason: 'Precedence: crypto price market',
    };
  }

  // 1. Try pmCategories (highest priority metadata)
  if (market.pmCategories && market.pmCategories.length > 0) {
    const catResult = classifyPolymarketByPmCategories(market.pmCategories);
    if (catResult && catResult.topic !== CanonicalTopic.UNKNOWN) {
      return catResult;
    }
  }

  // 2. Try pmTags
  if (market.pmTags && market.pmTags.length > 0) {
    const tagResult = classifyPolymarketByTags(market.pmTags);
    if (tagResult && tagResult.topic !== CanonicalTopic.UNKNOWN) {
      return tagResult;
    }
  }

  // 3. Try pmEventCategory
  if (market.pmEventCategory) {
    const eventResult = classifyPolymarketByCategory(market.pmEventCategory);
    if (eventResult && eventResult.topic !== CanonicalTopic.UNKNOWN) {
      return {
        ...eventResult,
        source: TopicSource.EVENT_METADATA,
        reason: `PM event category: ${market.pmEventCategory}`,
      };
    }
  }

  // 4. Try legacy category field
  if (market.category) {
    const categoryResult = classifyPolymarketByCategory(market.category);
    if (categoryResult && categoryResult.confidence >= 0.80 && categoryResult.topic !== CanonicalTopic.UNKNOWN) {
      return categoryResult;
    }
  }

  // 5. Try groupItemTitle
  if (market.groupItemTitle) {
    const groupResult = classifyPolymarketByCategory(market.groupItemTitle);
    if (groupResult && groupResult.topic !== CanonicalTopic.UNKNOWN) {
      return {
        ...groupResult,
        confidence: groupResult.confidence * 0.9,
        reason: `Group: ${market.groupItemTitle}`,
      };
    }
  }

  // 6. Try title keyword heuristics (fallback)
  const titleResult = classifyPolymarketByTitle(market.title);
  if (titleResult) {
    return titleResult;
  }

  // 7. Try legacy tags
  if (market.tags && market.tags.length > 0) {
    for (const tag of market.tags) {
      const tagLower = tag.toLowerCase();
      const topic = POLYMARKET_CATEGORY_MAP[tagLower] || PM_TAG_MAP[tagLower];
      if (topic && topic !== CanonicalTopic.UNKNOWN) {
        return {
          topic,
          confidence: 0.70,
          source: TopicSource.METADATA,
          reason: `Legacy tag: ${tag}`,
        };
      }
    }
  }

  // 8. Fallback to unknown
  return {
    topic: CanonicalTopic.UNKNOWN,
    confidence: 0.0,
    source: TopicSource.FALLBACK,
    reason: 'No matching rule',
  };
}

/**
 * Extended market info with v3.0.3 event-level tags
 */
export interface PolymarketMarketInfoV3 extends PolymarketMarketInfoV2 {
  /** Event-level tags from polymarket_events table */
  eventTags?: Array<{ id?: string; slug: string; label: string }>;
  /** Event category (e.g., "Sports") */
  eventCategory?: string;
  /** Series ID for sports detection */
  seriesId?: string;
  /** Sport code if detected (e.g., "nba", "nfl") */
  sportCode?: string;
}

/**
 * Check if market is a sports market by title patterns
 */
function isSportsMarketByTitle(title: string): boolean {
  const sportsPatterns = [
    /\b(nba|nfl|mlb|nhl|ncaa|afc|nfc)\b/i,
    /\b(spread|moneyline|o\/u|over\/under|total points)\b/i,
    /\bvs\.?\s+/i,  // Team vs Team
    /\b(championship|playoff|super bowl|world series)\b/i,
    /\b(quarter|half|1h|2h)\s+(spread|o\/u|total)/i,
    /\b(assists?|rebounds?|points?)\s+o\/u/i,  // Player props
  ];

  return sportsPatterns.some(p => p.test(title));
}

/**
 * Classify a Polymarket market using event-first approach (v3.0.3)
 *
 * Priority:
 * 1. Precedence rules (crypto price market overrides everything)
 * 2. Event tags from polymarket_events table (highest quality taxonomy)
 * 3. Sports detection (by sportCode, seriesId, or title patterns)
 * 4. pmCategories/pmTags (market-level metadata)
 * 5. Legacy category + title heuristics
 *
 * Returns taxonomySource for debugging:
 * - PM_EVENT_TAGS: Classified from event.tags[]
 * - PM_SPORTS: Classified as sports (from config or title)
 * - PM_CATEGORIES: From market-level pmCategories
 * - PM_TAGS: From market-level pmTags
 * - TITLE: From title keyword heuristics
 * - UNKNOWN: Could not classify
 */
export function classifyPolymarketMarketV3(market: PolymarketMarketInfoV3): TopicClassification & { taxonomySource: string } {
  // === 1a. Precedence Rule: Crypto price markets override everything ===
  if (isCryptoPriceMarket(market.title)) {
    return {
      topic: CanonicalTopic.CRYPTO_DAILY,
      confidence: 0.95,
      source: TopicSource.TITLE_KEYWORDS,
      reason: 'Precedence: crypto price market',
      taxonomySource: 'TITLE',
    };
  }

  // === 1b. Precedence Rule: Crypto intraday "up or down" markets ===
  if (isCryptoIntradayMarket(market.title)) {
    return {
      topic: CanonicalTopic.CRYPTO_DAILY, // Note: CRYPTO_INTRADAY is a sub-type, mapped via topic detection
      confidence: 0.95,
      source: TopicSource.TITLE_KEYWORDS,
      reason: 'Precedence: crypto intraday market',
      taxonomySource: 'TITLE',
    };
  }

  // === 2. Event tags (highest quality - from polymarket_events) ===
  if (market.eventTags && market.eventTags.length > 0) {
    // Try each tag in order
    for (const tag of market.eventTags) {
      const slug = tag.slug?.toLowerCase();

      if (slug && PM_TAG_MAP[slug]) {
        return {
          topic: PM_TAG_MAP[slug],
          confidence: 0.90,
          source: TopicSource.EVENT_METADATA,
          reason: `Event tag: ${tag.slug}`,
          taxonomySource: 'PM_EVENT_TAGS',
        };
      }
    }
  }

  // === 3. Sports detection ===
  // 3a. By explicit sport code (from polymarket_sports config)
  if (market.sportCode) {
    return {
      topic: CanonicalTopic.SPORTS,
      confidence: 0.95,
      source: TopicSource.EVENT_METADATA,
      reason: `Sport: ${market.sportCode}`,
      taxonomySource: 'PM_SPORTS',
    };
  }

  // 3b. By event category = "Sports"
  if (market.eventCategory?.toLowerCase() === 'sports') {
    return {
      topic: CanonicalTopic.SPORTS,
      confidence: 0.90,
      source: TopicSource.EVENT_METADATA,
      reason: 'Event category: Sports',
      taxonomySource: 'PM_SPORTS',
    };
  }

  // 3c. By title patterns (spread, o/u, vs, etc.)
  if (isSportsMarketByTitle(market.title)) {
    return {
      topic: CanonicalTopic.SPORTS,
      confidence: 0.85,
      source: TopicSource.TITLE_KEYWORDS,
      reason: 'Sports pattern in title',
      taxonomySource: 'PM_SPORTS',
    };
  }

  // === 4. Market-level pmCategories ===
  if (market.pmCategories && market.pmCategories.length > 0) {
    const catResult = classifyPolymarketByPmCategories(market.pmCategories);
    if (catResult && catResult.topic !== CanonicalTopic.UNKNOWN) {
      return {
        ...catResult,
        taxonomySource: 'PM_CATEGORIES',
      };
    }
  }

  // === 5. Market-level pmTags ===
  if (market.pmTags && market.pmTags.length > 0) {
    const tagResult = classifyPolymarketByTags(market.pmTags);
    if (tagResult && tagResult.topic !== CanonicalTopic.UNKNOWN) {
      return {
        ...tagResult,
        taxonomySource: 'PM_TAGS',
      };
    }
  }

  // === 6. pmEventCategory (legacy) ===
  if (market.pmEventCategory) {
    const eventResult = classifyPolymarketByCategory(market.pmEventCategory);
    if (eventResult && eventResult.topic !== CanonicalTopic.UNKNOWN) {
      return {
        ...eventResult,
        source: TopicSource.EVENT_METADATA,
        reason: `PM event category: ${market.pmEventCategory}`,
        taxonomySource: 'PM_CATEGORIES',
      };
    }
  }

  // === 7. Legacy category field ===
  if (market.category) {
    const categoryResult = classifyPolymarketByCategory(market.category);
    if (categoryResult && categoryResult.confidence >= 0.80 && categoryResult.topic !== CanonicalTopic.UNKNOWN) {
      return {
        ...categoryResult,
        taxonomySource: 'PM_CATEGORIES',
      };
    }
  }

  // === 8. Title keyword heuristics ===
  const titleResult = classifyPolymarketByTitle(market.title);
  if (titleResult) {
    return {
      ...titleResult,
      taxonomySource: 'TITLE',
    };
  }

  // === 9. Fallback to unknown ===
  return {
    topic: CanonicalTopic.UNKNOWN,
    confidence: 0.0,
    source: TopicSource.FALLBACK,
    reason: 'No matching rule',
    taxonomySource: 'UNKNOWN',
  };
}


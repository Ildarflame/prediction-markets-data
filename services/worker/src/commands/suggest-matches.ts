import type { Venue as CoreVenue } from '@data-module/core';
import {
  buildFingerprint,
  normalizeTitleForFuzzy,
  entityScore,
  numberScore,
  dateScore,
  passesDateGate,
  tokenize,
  jaccard,
  tokenizeForEntities,
  MarketIntent,
  type MarketFingerprint,
} from '@data-module/core';
import {
  getClient,
  MarketRepository,
  MarketLinkRepository,
  type Venue,
  type EligibleMarket,
} from '@data-module/db';
import { distance } from 'fastest-levenshtein';

/**
 * Sports exclusion patterns for Kalshi
 * Based on eventTicker prefixes that indicate sports/esports markets
 */
export const KALSHI_SPORTS_PREFIXES = [
  'KXMVESPORT',   // Esports multi-game
  'KXMVENBASI',   // NBA parlays
  'KXNCAAMBGA',   // NCAA basketball
  'KXTABLETEN',   // Table tennis
  'KXNBAREB',     // NBA rebounds
  'KXNFL',        // NFL
];

/**
 * Keywords in title that indicate sports/esports markets
 */
export const SPORTS_TITLE_KEYWORDS = [
  // Player stat patterns (e.g., "yes Player: 10+")
  'yes ',         // Parlay format starts with "yes"
  ': 1+', ': 2+', ': 3+', ': 4+', ': 5+', ': 6+', ': 7+', ': 8+', ': 9+',
  ': 10+', ': 15+', ': 20+', ': 25+', ': 30+', ': 40+', ': 50+',
  'points scored', 'wins by over', 'wins by under',
  'first quarter', 'second quarter', 'third quarter', 'fourth quarter',
  'steals', 'rebounds', 'assists', 'touchdowns', 'yards',
  'kill handicap', 'tower handicap', 'map handicap', // Esports
];

/**
 * Esports exclusion patterns for Polymarket
 */
export const POLYMARKET_ESPORTS_KEYWORDS = [
  'kill handicap', 'tower handicap', 'map handicap',
  'ninjas in pyjamas', 'team we', 'forze', 'sangal',
  'esports', 'dota', 'league of legends', 'cs:go', 'valorant',
];

/**
 * Extended market info with metadata for filtering
 */
interface MarketWithMeta extends EligibleMarket {
  metadata?: Record<string, unknown> | null;
}

/**
 * Check if a Kalshi market should be excluded based on eventTicker prefix
 */
function isKalshiSportsMarket(metadata: Record<string, unknown> | null | undefined, prefixes: string[]): boolean {
  if (!metadata) return false;
  const eventTicker = metadata.eventTicker || metadata.event_ticker;
  if (typeof eventTicker !== 'string') return false;

  return prefixes.some(prefix => eventTicker.startsWith(prefix));
}

/**
 * Check if a market title contains sports keywords
 * Uses substring matching for sports patterns (intentional - patterns like ": 10+" need this)
 */
function hasSportsTitleKeyword(title: string, keywords: string[]): boolean {
  const lowerTitle = title.toLowerCase();
  return keywords.some(keyword => lowerTitle.includes(keyword.toLowerCase()));
}

/**
 * Check if a market title contains at least one keyword using TOKEN-based matching
 * This prevents "Hegseth" from matching keyword "eth"
 */
function hasKeywordToken(title: string, keywords: string[]): boolean {
  const titleTokens = new Set(tokenizeForEntities(title));
  // Also add some common variations
  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    // Check if keyword appears as a token (exact match)
    if (titleTokens.has(kwLower)) {
      return true;
    }
    // For multi-word keywords, check if all words appear as consecutive tokens
    const kwTokens = tokenizeForEntities(kw);
    if (kwTokens.length > 1) {
      const titleTokenArr = tokenizeForEntities(title);
      // Check for consecutive match
      for (let i = 0; i <= titleTokenArr.length - kwTokens.length; i++) {
        let allMatch = true;
        for (let j = 0; j < kwTokens.length; j++) {
          if (titleTokenArr[i + j] !== kwTokens[j]) {
            allMatch = false;
            break;
          }
        }
        if (allMatch) return true;
      }
    }
  }
  return false;
}

/**
 * Post-filter markets to ensure they match keywords using token-based matching
 * The database query uses substring matching which can produce false positives
 */
function filterByKeywordTokens(
  markets: EligibleMarket[],
  keywords: string[]
): { filtered: EligibleMarket[]; removed: number } {
  if (keywords.length === 0) {
    return { filtered: markets, removed: 0 };
  }
  const filtered: EligibleMarket[] = [];
  let removed = 0;
  for (const market of markets) {
    if (hasKeywordToken(market.title, keywords)) {
      filtered.push(market);
    } else {
      removed++;
    }
  }
  return { filtered, removed };
}

/**
 * Filter out sports markets from eligible markets
 */
function filterSportsMarkets(
  markets: MarketWithMeta[],
  venue: string,
  options: {
    excludeKalshiPrefixes?: string[];
    excludeTitleKeywords?: string[];
  }
): { filtered: EligibleMarket[]; stats: { prefixExcluded: number; keywordExcluded: number } } {
  const { excludeKalshiPrefixes = [], excludeTitleKeywords = [] } = options;
  const filtered: EligibleMarket[] = [];
  let prefixExcluded = 0;
  let keywordExcluded = 0;

  for (const market of markets) {
    // Check Kalshi eventTicker prefix
    if (venue === 'kalshi' && excludeKalshiPrefixes.length > 0) {
      if (isKalshiSportsMarket(market.metadata, excludeKalshiPrefixes)) {
        prefixExcluded++;
        continue;
      }
    }

    // Check title keywords
    if (excludeTitleKeywords.length > 0) {
      if (hasSportsTitleKeyword(market.title, excludeTitleKeywords)) {
        keywordExcluded++;
        continue;
      }
    }

    filtered.push(market);
  }

  return { filtered, stats: { prefixExcluded, keywordExcluded } };
}

/**
 * Topic filter types for market matching
 */
export type TopicFilter = 'crypto' | 'macro' | 'politics' | 'all';

/**
 * Topic-specific entities for filtering
 * Markets must have at least one entity from the topic set to match
 */
export const TOPIC_ENTITIES: Record<Exclude<TopicFilter, 'all'>, string[]> = {
  crypto: [
    'BITCOIN', 'ETHEREUM', 'SOLANA', 'XRP', 'DOGECOIN', 'CARDANO', 'BNB',
    'AVALANCHE', 'POLYGON', 'POLKADOT', 'CHAINLINK', 'LITECOIN',
  ],
  macro: [
    'CPI', 'GDP', 'NFP', 'FOMC', 'FED_RATE', 'UNEMPLOYMENT', 'INFLATION',
    'INTEREST_RATE', 'PPI', 'PCE',
  ],
  politics: [
    'DONALD_TRUMP', 'DONALD_TRUMP_JR', 'JOE_BIDEN', 'HUNTER_BIDEN',
    'KAMALA_HARRIS', 'RON_DESANTIS', 'GAVIN_NEWSOM', 'NIKKI_HALEY',
    'VIVEK_RAMASWAMY', 'MIKE_PENCE', 'RFK_JR', 'BARACK_OBAMA', 'MICHELLE_OBAMA',
    'ELON_MUSK', 'JEFF_BEZOS', 'NANCY_PELOSI', 'KEVIN_MCCARTHY',
    'CHUCK_SCHUMER', 'MITCH_MCCONNELL', 'AOC', 'BERNIE_SANDERS', 'ELIZABETH_WARREN',
    'VLADIMIR_PUTIN', 'VOLODYMYR_ZELENSKY', 'XI_JINPING', 'BENJAMIN_NETANYAHU',
    'US_PRESIDENTIAL_ELECTION', 'US_SENATE', 'US_HOUSE', 'US_MIDTERMS',
  ],
};

/**
 * Topic-specific keywords for filtering
 * Markets must have at least one keyword from the topic set (fallback if no entity)
 */
export const TOPIC_KEYWORDS: Record<Exclude<TopicFilter, 'all'>, string[]> = {
  crypto: [
    'bitcoin', 'btc', 'ethereum', 'eth', 'solana', 'sol', 'crypto',
    'xrp', 'ripple', 'doge', 'dogecoin', 'cardano', 'ada',
  ],
  macro: [
    'cpi', 'gdp', 'inflation', 'fed', 'fomc', 'interest rate', 'unemployment',
    'nonfarm', 'payrolls', 'pce', 'ppi', 'jobs report',
  ],
  politics: [
    'trump', 'biden', 'harris', 'election', 'president', 'presidential',
    'congress', 'senate', 'house', 'governor', 'democrats', 'republicans',
    'putin', 'zelensky', 'ukraine', 'russia', 'china', 'xi jinping',
  ],
};

export interface SuggestMatchesOptions {
  fromVenue: CoreVenue;
  toVenue: CoreVenue;
  minScore?: number;
  topK?: number;
  lookbackHours?: number;
  limitLeft?: number;
  limitRight?: number;
  debugMarketId?: number;
  requireOverlapKeywords?: boolean;
  targetKeywords?: string[];
  // Topic filter - defines entity and keyword requirements
  topic?: TopicFilter;
  // Sports exclusion options
  excludeSports?: boolean;
  excludeKalshiPrefixes?: string[];
  excludeTitleKeywords?: string[];
}

export interface SuggestMatchesResult {
  leftCount: number;
  rightCount: number;
  candidatesConsidered: number;
  suggestionsCreated: number;
  suggestionsUpdated: number;
  skippedConfirmed: number;
  skippedNoOverlap: number;
  skippedDateGate: number;
  skippedTextGate: number;
  errors: string[];
}

/**
 * Market with precomputed fingerprint
 */
interface IndexedMarket {
  market: EligibleMarket;
  fingerprint: MarketFingerprint;
  normalizedTitle: string;
}

/**
 * Entity-based inverted index for candidate generation
 */
interface EntityIndex {
  byEntity: Map<string, Set<number>>;
  byYear: Map<number, Set<number>>;
  markets: Map<number, IndexedMarket>;
}

/**
 * Build entity-based index for target markets
 */
function buildEntityIndex(markets: EligibleMarket[]): EntityIndex {
  const byEntity = new Map<string, Set<number>>();
  const byYear = new Map<number, Set<number>>();
  const marketsMap = new Map<number, IndexedMarket>();

  for (const market of markets) {
    // Pass metadata for Kalshi ticker entity extraction
    const fingerprint = buildFingerprint(market.title, market.closeTime, { metadata: market.metadata });
    const normalizedTitle = normalizeTitleForFuzzy(market.title);

    const indexed: IndexedMarket = { market, fingerprint, normalizedTitle };
    marketsMap.set(market.id, indexed);

    // Index by entities
    for (const entity of fingerprint.entities) {
      if (!byEntity.has(entity)) {
        byEntity.set(entity, new Set());
      }
      byEntity.get(entity)!.add(market.id);
    }

    // Index by year from dates
    for (const date of fingerprint.dates) {
      if (date.year) {
        if (!byYear.has(date.year)) {
          byYear.set(date.year, new Set());
        }
        byYear.get(date.year)!.add(market.id);
      }
    }

    // Also index by closeTime year
    if (market.closeTime) {
      const year = market.closeTime.getFullYear();
      if (!byYear.has(year)) {
        byYear.set(year, new Set());
      }
      byYear.get(year)!.add(market.id);
    }
  }

  return { byEntity, byYear, markets: marketsMap };
}

/**
 * Find candidate markets using entity and date overlap
 */
function findCandidatesByEntity(
  leftFingerprint: MarketFingerprint,
  leftCloseTime: Date | null,
  index: EntityIndex,
  maxCandidates: number = 500
): Set<number> {
  const candidates = new Set<number>();
  const entityScores = new Map<number, number>();

  // Find candidates that share at least one entity
  for (const entity of leftFingerprint.entities) {
    const marketIds = index.byEntity.get(entity);
    if (marketIds) {
      for (const id of marketIds) {
        candidates.add(id);
        entityScores.set(id, (entityScores.get(id) || 0) + 1);
      }
    }
  }

  // If we have too many candidates, prioritize by entity overlap count
  if (candidates.size > maxCandidates) {
    const sorted = Array.from(candidates).sort((a, b) =>
      (entityScores.get(b) || 0) - (entityScores.get(a) || 0)
    );
    return new Set(sorted.slice(0, maxCandidates));
  }

  // If no entities found, try year-based filtering
  if (candidates.size === 0) {
    // Get year from dates or closeTime
    let year: number | undefined;
    if (leftFingerprint.dates.length > 0 && leftFingerprint.dates[0].year) {
      year = leftFingerprint.dates[0].year;
    } else if (leftCloseTime) {
      year = leftCloseTime.getFullYear();
    }

    if (year) {
      const yearMarkets = index.byYear.get(year);
      if (yearMarkets) {
        for (const id of yearMarkets) {
          candidates.add(id);
          if (candidates.size >= maxCandidates) break;
        }
      }
    }
  }

  return candidates;
}

/**
 * Check if two titles share at least one keyword
 * Used as a prefilter to skip obviously unrelated markets
 */
function hasKeywordOverlap(titleA: string, titleB: string): boolean {
  const wordsA = new Set(titleA.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(titleB.toLowerCase().split(/\s+/).filter(w => w.length > 2));

  for (const word of wordsA) {
    if (wordsB.has(word)) {
      return true;
    }
  }
  return false;
}

/**
 * Calculate fuzzy title similarity using Levenshtein distance
 * Returns score 0-1 where 1 is exact match
 */
function fuzzyTitleScore(titleA: string, titleB: string): number {
  if (titleA === titleB) return 1.0;

  const maxLen = Math.max(titleA.length, titleB.length);
  if (maxLen === 0) return 0;

  const dist = distance(titleA, titleB);
  const similarity = 1 - (dist / maxLen);

  return Math.max(0, similarity);
}

// Intent-based text similarity thresholds to prevent false positives
// PRICE_DATE markets require stricter thresholds (price+date must be precise)
// Other intents can use relaxed thresholds to increase match coverage

// Strict thresholds for PRICE_DATE intent
const PRICE_DATE_MIN_TEXT_SIMILARITY = 0.20;  // (jaccard + fuzzy) / 2 must exceed this
const PRICE_DATE_MIN_JACCARD = 0.10;          // jaccard alone must exceed this

// Relaxed thresholds for other intents (ELECTION, METRIC_DATE, GENERAL)
const RELAXED_MIN_TEXT_SIMILARITY = 0.12;
const RELAXED_MIN_JACCARD = 0.05;

/**
 * Calculate weighted match score using multiple signals
 * Weights: 0.35 entity + 0.25 date + 0.25 number + 0.10 fuzzy + 0.05 jaccard
 * Returns score=0 if date gate fails for PRICE_DATE markets
 * Returns score=0 if text similarity is below minimum threshold (hard gate)
 */
function calculateMatchScore(
  left: IndexedMarket,
  right: IndexedMarket
): { score: number; reason: string; breakdown: Record<string, number>; dateGateFailed: boolean; textGateFailed: boolean } {
  // Date gating check - strict matching for PRICE_DATE markets
  const leftDate = left.fingerprint.dates[0];
  const rightDate = right.fingerprint.dates[0];
  const passesGate = passesDateGate(leftDate, rightDate, left.fingerprint.intent, right.fingerprint.intent);

  // If date gate fails for date-sensitive markets, return 0 score
  if (!passesGate) {
    return {
      score: 0,
      reason: `DATE_GATE_FAIL (${left.fingerprint.intent}/${right.fingerprint.intent})`,
      breakdown: { entity: 0, date: 0, number: 0, fuzzy: 0, jaccard: 0 },
      dateGateFailed: true,
      textGateFailed: false,
    };
  }

  // Entity score (0-1)
  const entScore = entityScore(left.fingerprint.entities, right.fingerprint.entities);

  // Date score (0-1)
  const dtScore = dateScore(leftDate, rightDate);

  // Number score (0-1)
  const numScore = numberScore(left.fingerprint.numbers, right.fingerprint.numbers);

  // Fuzzy title score (0-1)
  const fzScore = fuzzyTitleScore(left.normalizedTitle, right.normalizedTitle);

  // Jaccard score (0-1) - on tokenized titles
  const leftTokens = tokenize(left.market.title);
  const rightTokens = tokenize(right.market.title);
  const jcScore = jaccard(leftTokens, rightTokens);

  // HARD GATE: Require minimum text similarity
  // This prevents matches like "Trump Greenland Tariffs" vs "Trump pardon" where
  // entity matches but titles are semantically different
  //
  // Intent-based thresholds:
  // - PRICE_DATE requires stricter thresholds (price+date precision matters)
  // - Other intents use relaxed thresholds to increase match coverage
  const isPriceDateIntent =
    left.fingerprint.intent === MarketIntent.PRICE_DATE ||
    right.fingerprint.intent === MarketIntent.PRICE_DATE;

  const minTextSimilarity = isPriceDateIntent ? PRICE_DATE_MIN_TEXT_SIMILARITY : RELAXED_MIN_TEXT_SIMILARITY;
  const minJaccard = isPriceDateIntent ? PRICE_DATE_MIN_JACCARD : RELAXED_MIN_JACCARD;

  const textSimilarity = (jcScore + fzScore) / 2;
  if (textSimilarity < minTextSimilarity || jcScore < minJaccard) {
    const reason = jcScore < minJaccard
      ? `TEXT_GATE_FAIL (jc=${jcScore.toFixed(3)} < ${minJaccard})`
      : `TEXT_GATE_FAIL (sim=${textSimilarity.toFixed(3)} < ${minTextSimilarity})`;
    return {
      score: 0,
      reason,
      breakdown: { entity: entScore, date: dtScore, number: numScore, fuzzy: fzScore, jaccard: jcScore },
      dateGateFailed: false,
      textGateFailed: true,
    };
  }

  // Weighted combination
  const score =
    0.35 * entScore +
    0.25 * dtScore +
    0.25 * numScore +
    0.10 * fzScore +
    0.05 * jcScore;

  const breakdown = {
    entity: entScore,
    date: dtScore,
    number: numScore,
    fuzzy: fzScore,
    jaccard: jcScore,
  };

  const reason = `ent=${entScore.toFixed(2)} dt=${dtScore.toFixed(2)} num=${numScore.toFixed(2)} fz=${fzScore.toFixed(2)} jc=${jcScore.toFixed(2)}`;

  return { score, reason, breakdown, dateGateFailed: false, textGateFailed: false };
}

/**
 * Check if a market matches a topic based on entities or keywords
 * @param market - Market to check
 * @param fingerprint - Pre-computed fingerprint (if available)
 * @param topic - Topic to match against
 * @returns true if market matches the topic
 */
function matchesTopic(
  market: EligibleMarket,
  fingerprint: MarketFingerprint | null,
  topic: Exclude<TopicFilter, 'all'>
): boolean {
  const topicEntities = new Set(TOPIC_ENTITIES[topic]);
  const topicKeywords = TOPIC_KEYWORDS[topic];

  // Check entities first (most reliable)
  if (fingerprint) {
    for (const entity of fingerprint.entities) {
      if (topicEntities.has(entity)) {
        return true;
      }
    }
  }

  // Fallback to keyword matching in title
  return hasKeywordToken(market.title, topicKeywords);
}

/**
 * Filter markets by topic
 * @param markets - Markets to filter
 * @param topic - Topic filter ('all' returns all markets)
 * @returns Filtered markets and count of removed
 */
function filterByTopic(
  markets: EligibleMarket[],
  topic: TopicFilter
): { filtered: EligibleMarket[]; removed: number } {
  if (topic === 'all') {
    return { filtered: markets, removed: 0 };
  }

  const filtered: EligibleMarket[] = [];
  let removed = 0;

  for (const market of markets) {
    // Compute fingerprint for entity extraction
    const fingerprint = buildFingerprint(market.title, market.closeTime, { metadata: market.metadata });
    if (matchesTopic(market, fingerprint, topic)) {
      filtered.push(market);
    } else {
      removed++;
    }
  }

  return { filtered, removed };
}

/**
 * Common options for fetching eligible markets
 */
interface FetchMarketsOptions {
  venue: CoreVenue;
  lookbackHours: number;
  limit: number;
  targetKeywords: string[];
  topic: TopicFilter;
  excludeSports: boolean;
  excludeKalshiPrefixes: string[];
  excludeTitleKeywords: string[];
}

/**
 * Pipeline stats for market fetching
 */
interface FetchMarketsStats {
  total: number;
  afterKeywordFilter: number;
  afterSportsFilter: number;
  afterTopicFilter: number;
}

/**
 * Fetch eligible markets with all filters applied
 * This is the unified pipeline used by both debug and full run modes
 */
async function fetchEligibleMarkets(
  marketRepo: MarketRepository,
  options: FetchMarketsOptions
): Promise<{ markets: EligibleMarket[]; stats: FetchMarketsStats }> {
  const {
    venue,
    lookbackHours,
    limit,
    targetKeywords,
    topic,
    excludeSports,
    excludeKalshiPrefixes,
    excludeTitleKeywords,
  } = options;

  // Step 1: Fetch from DB with keyword filter
  let markets = await marketRepo.listEligibleMarkets(venue as Venue, {
    lookbackHours,
    limit,
    titleKeywords: targetKeywords.length > 0 ? targetKeywords : undefined,
  });
  const total = markets.length;

  // Step 2: Apply token-based keyword post-filter (DB uses substring matching)
  if (targetKeywords.length > 0) {
    const { filtered } = filterByKeywordTokens(markets, targetKeywords);
    markets = filtered;
  }
  const afterKeywordFilter = markets.length;

  // Step 3: Apply sports filtering
  if (excludeSports) {
    const polyKeywords = venue === 'polymarket' ? [...excludeTitleKeywords, ...POLYMARKET_ESPORTS_KEYWORDS] : excludeTitleKeywords;
    const { filtered } = filterSportsMarkets(markets, venue, {
      excludeKalshiPrefixes: venue === 'kalshi' ? excludeKalshiPrefixes : [],
      excludeTitleKeywords: polyKeywords,
    });
    markets = filtered;
  }
  const afterSportsFilter = markets.length;

  // Step 4: Apply topic filtering
  if (topic !== 'all') {
    const { filtered } = filterByTopic(markets, topic);
    markets = filtered;
  }
  const afterTopicFilter = markets.length;

  return {
    markets,
    stats: { total, afterKeywordFilter, afterSportsFilter, afterTopicFilter },
  };
}

/**
 * Debug a single market - show top candidates with breakdown
 * Uses the SAME pipeline as runSuggestMatches for market fetching
 */
async function debugMarket(
  marketId: number,
  fromVenue: CoreVenue,
  toVenue: CoreVenue,
  options: {
    lookbackHours: number;
    limitLeft: number;
    limitRight: number;
    targetKeywords: string[];
    topic: TopicFilter;
    excludeSports: boolean;
    excludeKalshiPrefixes: string[];
    excludeTitleKeywords: string[];
  }
): Promise<void> {
  const prisma = getClient();
  const marketRepo = new MarketRepository(prisma);

  console.log(`\n[debug v2.3] Analyzing market ID ${marketId} from ${fromVenue}...\n`);
  console.log(`[debug] Using unified pipeline with full run settings:`);
  console.log(`[debug] lookbackHours=${options.lookbackHours}, limitLeft=${options.limitLeft}, limitRight=${options.limitRight}`);
  console.log(`[debug] topic=${options.topic}, excludeSports=${options.excludeSports}, keywords=${options.targetKeywords.length}`);

  // Fetch source markets using unified pipeline
  const { markets: leftMarkets, stats: leftStats } = await fetchEligibleMarkets(marketRepo, {
    venue: fromVenue,
    lookbackHours: options.lookbackHours,
    limit: options.limitLeft,
    targetKeywords: options.targetKeywords,
    topic: options.topic,
    excludeSports: options.excludeSports,
    excludeKalshiPrefixes: options.excludeKalshiPrefixes,
    excludeTitleKeywords: options.excludeTitleKeywords,
  });

  console.log(`\n[debug] ${fromVenue} markets: ${leftStats.total} -> ${leftStats.afterKeywordFilter} (kw) -> ${leftStats.afterSportsFilter} (sports) -> ${leftStats.afterTopicFilter} (topic)`);

  const leftMarket = leftMarkets.find(m => m.id === marketId);
  if (!leftMarket) {
    // Market not found in filtered set - try to find why
    const allMarkets = await marketRepo.listEligibleMarkets(fromVenue as Venue, {
      lookbackHours: options.lookbackHours,
      limit: 50000,
    });
    const rawMarket = allMarkets.find(m => m.id === marketId);
    if (rawMarket) {
      console.error(`Market ${marketId} found in raw data but filtered out.`);
      console.error(`Title: ${rawMarket.title}`);

      // Check why it was filtered
      const hasKeyword = hasKeywordToken(rawMarket.title, options.targetKeywords);
      const isSports = hasSportsTitleKeyword(rawMarket.title, options.excludeTitleKeywords);
      console.error(`Has target keyword: ${hasKeyword}`);
      console.error(`Is sports market: ${isSports}`);
    } else {
      console.error(`Market ${marketId} not found in ${fromVenue} (lookback=${options.lookbackHours}h)`);
    }
    return;
  }

  console.log(`\nSource market:`);
  console.log(`  ID: ${leftMarket.id}`);
  console.log(`  Title: ${leftMarket.title}`);
  console.log(`  Category: ${leftMarket.category || 'N/A'}`);
  console.log(`  Close time: ${leftMarket.closeTime?.toISOString() || 'N/A'}`);

  // Show metadata if available (for Kalshi)
  if (leftMarket.metadata) {
    const eventTicker = (leftMarket.metadata as Record<string, unknown>).eventTicker || (leftMarket.metadata as Record<string, unknown>).event_ticker;
    if (eventTicker) {
      console.log(`  Event ticker: ${eventTicker}`);
    }
  }

  const leftFingerprint = buildFingerprint(leftMarket.title, leftMarket.closeTime, { metadata: leftMarket.metadata });
  console.log(`  Entities: ${leftFingerprint.entities.join(', ') || 'none'}`);
  console.log(`  Numbers: ${leftFingerprint.numbers.join(', ') || 'none'}`);

  // Show dates with precision
  if (leftFingerprint.dates.length > 0) {
    const dateInfo = leftFingerprint.dates.map(d => `${d.raw} (${d.precision})`).join(', ');
    console.log(`  Dates: ${dateInfo}`);
  } else {
    console.log(`  Dates: none`);
  }

  console.log(`  Comparator: ${leftFingerprint.comparator}`);
  console.log(`  Intent: ${leftFingerprint.intent}`);
  console.log(`  Fingerprint: ${leftFingerprint.fingerprint}`);
  const isPriceDate = leftFingerprint.intent === MarketIntent.PRICE_DATE;
  console.log(`  Text gate: sim>=${isPriceDate ? PRICE_DATE_MIN_TEXT_SIMILARITY : RELAXED_MIN_TEXT_SIMILARITY}, jc>=${isPriceDate ? PRICE_DATE_MIN_JACCARD : RELAXED_MIN_JACCARD} (${isPriceDate ? 'PRICE_DATE strict' : 'relaxed'})`);

  // Fetch target markets using unified pipeline
  const { markets: rightMarkets, stats: rightStats } = await fetchEligibleMarkets(marketRepo, {
    venue: toVenue,
    lookbackHours: options.lookbackHours,
    limit: options.limitRight,
    targetKeywords: options.targetKeywords,
    topic: options.topic,
    excludeSports: options.excludeSports,
    excludeKalshiPrefixes: options.excludeKalshiPrefixes,
    excludeTitleKeywords: options.excludeTitleKeywords,
  });

  console.log(`\n[debug] ${toVenue} markets: ${rightStats.total} -> ${rightStats.afterKeywordFilter} (kw) -> ${rightStats.afterSportsFilter} (sports) -> ${rightStats.afterTopicFilter} (topic)`);

  // Build index
  const index = buildEntityIndex(rightMarkets);
  console.log(`[debug] Index: ${index.byEntity.size} unique entities, ${index.byYear.size} years`);

  // Find candidates
  const candidateIds = findCandidatesByEntity(leftFingerprint, leftMarket.closeTime, index, 1000);
  console.log(`[debug] Found ${candidateIds.size} candidates by entity overlap\n`);

  // Score all candidates
  const leftIndexed: IndexedMarket = {
    market: leftMarket,
    fingerprint: leftFingerprint,
    normalizedTitle: normalizeTitleForFuzzy(leftMarket.title),
  };

  const scores: Array<{
    market: EligibleMarket;
    score: number;
    reason: string;
    breakdown: Record<string, number>;
    fingerprint: MarketFingerprint;
    dateGateFailed: boolean;
    textGateFailed: boolean;
  }> = [];

  let dateGateFailCount = 0;
  let textGateFailCount = 0;

  for (const rightId of candidateIds) {
    const rightIndexed = index.markets.get(rightId);
    if (!rightIndexed) continue;

    const result = calculateMatchScore(leftIndexed, rightIndexed);
    if (result.dateGateFailed) {
      dateGateFailCount++;
    }
    if (result.textGateFailed) {
      textGateFailCount++;
    }
    scores.push({
      market: rightIndexed.market,
      score: result.score,
      reason: result.reason,
      breakdown: result.breakdown,
      fingerprint: rightIndexed.fingerprint,
      dateGateFailed: result.dateGateFailed,
      textGateFailed: result.textGateFailed,
    });
  }

  // Sort by score (gate failures at the bottom)
  scores.sort((a, b) => {
    const aFailed = a.dateGateFailed || a.textGateFailed;
    const bFailed = b.dateGateFailed || b.textGateFailed;
    if (aFailed && !bFailed) return 1;
    if (!aFailed && bFailed) return -1;
    return b.score - a.score;
  });

  console.log(`Gate failures: date=${dateGateFailCount}, text=${textGateFailCount} / ${candidateIds.size} candidates`);

  // Count passing scores
  const passingScores = scores.filter(s => !s.dateGateFailed && !s.textGateFailed);
  console.log(`Passing candidates (no gate failures): ${passingScores.length}`);

  // Show top 20
  console.log(`\nTop 20 candidates:\n`);
  console.log('Rank | Score | Gate | Intent      | Entity | Date   | Number | Title');
  console.log('-'.repeat(130));

  for (let i = 0; i < Math.min(20, scores.length); i++) {
    const s = scores[i];
    const truncTitle = s.market.title.length > 45 ? s.market.title.slice(0, 42) + '...' : s.market.title;
    const gateStatus = s.dateGateFailed ? 'DATE' : (s.textGateFailed ? 'TEXT' : 'OK  ');
    const intent = s.fingerprint.intent.padEnd(11);
    console.log(
      `${String(i + 1).padStart(4)} | ${s.score.toFixed(3)} | ${gateStatus} | ${intent} | ${s.breakdown.entity.toFixed(3)}  | ${s.breakdown.date.toFixed(3)}  | ${s.breakdown.number.toFixed(3)}  | ${truncTitle}`
    );
  }

  console.log('\nDetailed top 5:\n');
  for (let i = 0; i < Math.min(5, scores.length); i++) {
    const s = scores[i];
    const gateIcon = s.dateGateFailed ? '[DATE FAIL]' : (s.textGateFailed ? '[TEXT FAIL]' : '[PASS]');
    console.log(`#${i + 1} (score=${s.score.toFixed(4)}) ${gateIcon}:`);
    console.log(`  Title: ${s.market.title}`);
    console.log(`  ID: ${s.market.id}`);
    console.log(`  Intent: ${s.fingerprint.intent}`);
    console.log(`  Entities: ${s.fingerprint.entities.join(', ') || 'none'}`);
    console.log(`  Numbers: ${s.fingerprint.numbers.join(', ') || 'none'}`);

    // Show dates with precision
    if (s.fingerprint.dates.length > 0) {
      const dateInfo = s.fingerprint.dates.map(d => `${d.raw} (${d.precision})`).join(', ');
      console.log(`  Dates: ${dateInfo}`);
    } else {
      console.log(`  Dates: none`);
    }

    console.log(`  Breakdown: ${s.reason}`);
    if (s.dateGateFailed) {
      console.log(`  Status: DATE_GATE_FAILED - intents: source=${leftFingerprint.intent}, target=${s.fingerprint.intent}`);
    } else if (s.textGateFailed) {
      const textSim = ((s.breakdown.jaccard + s.breakdown.fuzzy) / 2).toFixed(3);
      const isPriceDatePair = leftFingerprint.intent === MarketIntent.PRICE_DATE || s.fingerprint.intent === MarketIntent.PRICE_DATE;
      const minSim = isPriceDatePair ? PRICE_DATE_MIN_TEXT_SIMILARITY : RELAXED_MIN_TEXT_SIMILARITY;
      const minJc = isPriceDatePair ? PRICE_DATE_MIN_JACCARD : RELAXED_MIN_JACCARD;
      console.log(`  Status: TEXT_GATE_FAILED - sim=${textSim}, jc=${s.breakdown.jaccard.toFixed(3)} (min: sim>=${minSim}, jc>=${minJc}, ${isPriceDatePair ? 'strict' : 'relaxed'})`);
    }
    console.log('');
  }
}

/**
 * Run suggest-matches job with fingerprint-based matching
 */
// Default keywords for matching political/economic markets
const MATCHING_KEYWORDS = [
  'trump', 'biden', 'harris', 'election', 'president', 'congress', 'senate', 'house',
  'bitcoin', 'btc', 'ethereum', 'eth', 'crypto',
  'cpi', 'gdp', 'inflation', 'fed', 'rate',
  'ukraine', 'russia', 'china', 'war',
];

export async function runSuggestMatches(options: SuggestMatchesOptions): Promise<SuggestMatchesResult> {
  const {
    fromVenue,
    toVenue,
    minScore = 0.6,  // Raised from 0.55 for better quality
    topK = 10,
    lookbackHours = 24,
    limitLeft = 2000,
    limitRight = 20000,
    debugMarketId,
    requireOverlapKeywords = true,
    targetKeywords = MATCHING_KEYWORDS,
    // Topic filter - 'all' by default for backwards compatibility
    topic = 'all',
    // Sports exclusion options - enabled by default
    excludeSports = true,
    excludeKalshiPrefixes = excludeSports ? KALSHI_SPORTS_PREFIXES : [],
    excludeTitleKeywords = excludeSports ? SPORTS_TITLE_KEYWORDS : [],
  } = options;

  // Handle debug mode - uses the same unified pipeline as full run
  if (debugMarketId !== undefined) {
    await debugMarket(debugMarketId, fromVenue, toVenue, {
      lookbackHours,
      limitLeft,
      limitRight,
      targetKeywords,
      topic,
      excludeSports,
      excludeKalshiPrefixes,
      excludeTitleKeywords,
    });
    return {
      leftCount: 0,
      rightCount: 0,
      candidatesConsidered: 0,
      suggestionsCreated: 0,
      suggestionsUpdated: 0,
      skippedConfirmed: 0,
      skippedNoOverlap: 0,
      skippedDateGate: 0,
      skippedTextGate: 0,
      errors: [],
    };
  }

  const prisma = getClient();
  const marketRepo = new MarketRepository(prisma);
  const linkRepo = new MarketLinkRepository(prisma);

  const result: SuggestMatchesResult = {
    leftCount: 0,
    rightCount: 0,
    candidatesConsidered: 0,
    suggestionsCreated: 0,
    suggestionsUpdated: 0,
    skippedConfirmed: 0,
    skippedNoOverlap: 0,
    skippedDateGate: 0,
    skippedTextGate: 0,
    errors: [],
  };

  console.log(`[matching] Starting suggest-matches v2.3: ${fromVenue} -> ${toVenue}`);
  console.log(`[matching] minScore=${minScore}, topK=${topK}, lookbackHours=${lookbackHours}, limitLeft=${limitLeft}, limitRight=${limitRight}, requireOverlap=${requireOverlapKeywords}`);
  console.log(`[matching] Topic filter: ${topic}`);
  console.log(`[matching] Target keywords: ${targetKeywords.slice(0, 10).join(', ')}${targetKeywords.length > 10 ? '...' : ''}`);
  console.log(`[matching] Sports exclusion: ${excludeSports ? 'enabled' : 'disabled'} (prefixes: ${excludeKalshiPrefixes.length}, keywords: ${excludeTitleKeywords.length})`);

  try {
    // Fetch eligible markets from both venues using unified pipeline
    console.log(`[matching] Fetching eligible markets from ${fromVenue}...`);
    const { markets: leftMarkets, stats: leftStats } = await fetchEligibleMarkets(marketRepo, {
      venue: fromVenue,
      lookbackHours,
      limit: limitLeft,
      targetKeywords,
      topic,
      excludeSports,
      excludeKalshiPrefixes,
      excludeTitleKeywords,
    });
    result.leftCount = leftMarkets.length;
    console.log(`[matching] ${fromVenue}: ${leftStats.total} -> ${leftStats.afterKeywordFilter} (kw) -> ${leftStats.afterSportsFilter} (sports) -> ${leftStats.afterTopicFilter} (topic)`);

    console.log(`[matching] Fetching eligible markets from ${toVenue}...`);
    const { markets: rightMarkets, stats: rightStats } = await fetchEligibleMarkets(marketRepo, {
      venue: toVenue,
      lookbackHours,
      limit: limitRight,
      targetKeywords,
      topic,
      excludeSports,
      excludeKalshiPrefixes,
      excludeTitleKeywords,
    });
    result.rightCount = rightMarkets.length;
    console.log(`[matching] ${toVenue}: ${rightStats.total} -> ${rightStats.afterKeywordFilter} (kw) -> ${rightStats.afterSportsFilter} (sports) -> ${rightStats.afterTopicFilter} (topic)`);

    if (leftMarkets.length === 0 || rightMarkets.length === 0) {
      console.log(`[matching] No markets to match`);
      return result;
    }

    // Build entity-based index for right markets
    console.log(`[matching] Building entity index for ${toVenue}...`);
    const index = buildEntityIndex(rightMarkets);
    console.log(`[matching] Index built: ${index.byEntity.size} unique entities, ${index.byYear.size} years`);

    // Get set of markets that already have confirmed links
    const confirmedLeft = new Set<number>();
    for (const market of leftMarkets) {
      const hasConfirmed = await linkRepo.hasConfirmedLink(fromVenue as Venue, market.id);
      if (hasConfirmed) {
        confirmedLeft.add(market.id);
      }
    }
    console.log(`[matching] ${confirmedLeft.size} markets from ${fromVenue} already have confirmed links`);

    // Process each left market
    console.log(`[matching] Processing matches...`);
    let processed = 0;
    let noEntityCount = 0;

    for (const leftMarket of leftMarkets) {
      // Skip if already has confirmed link
      if (confirmedLeft.has(leftMarket.id)) {
        result.skippedConfirmed++;
        continue;
      }

      const leftFingerprint = buildFingerprint(leftMarket.title, leftMarket.closeTime, { metadata: leftMarket.metadata });
      const leftIndexed: IndexedMarket = {
        market: leftMarket,
        fingerprint: leftFingerprint,
        normalizedTitle: normalizeTitleForFuzzy(leftMarket.title),
      };

      // Track markets with no entities
      if (leftFingerprint.entities.length === 0) {
        noEntityCount++;
      }

      // Find candidates using entity index
      const candidateIds = findCandidatesByEntity(leftFingerprint, leftMarket.closeTime, index);
      result.candidatesConsidered += candidateIds.size;

      // Score candidates and find top-k
      const scores: Array<{ rightId: number; score: number; reason: string }> = [];

      for (const rightId of candidateIds) {
        const rightIndexed = index.markets.get(rightId);
        if (!rightIndexed) continue;

        // Skip if no keyword overlap (prefilter)
        if (requireOverlapKeywords) {
          if (!hasKeywordOverlap(leftMarket.title, rightIndexed.market.title)) {
            result.skippedNoOverlap++;
            continue;
          }
        }

        const matchResult = calculateMatchScore(leftIndexed, rightIndexed);

        // Track date gate failures
        if (matchResult.dateGateFailed) {
          result.skippedDateGate++;
          continue;
        }

        // Track text gate failures
        if (matchResult.textGateFailed) {
          result.skippedTextGate++;
          continue;
        }

        if (matchResult.score >= minScore) {
          scores.push({
            rightId,
            score: matchResult.score,
            reason: matchResult.reason,
          });
        }
      }

      // Sort by score and take top-k
      scores.sort((a, b) => b.score - a.score);
      const topCandidates = scores.slice(0, topK);

      // Save suggestions
      for (const candidate of topCandidates) {
        try {
          const upsertResult = await linkRepo.upsertSuggestion(
            fromVenue as Venue,
            leftMarket.id,
            toVenue as Venue,
            candidate.rightId,
            candidate.score,
            candidate.reason
          );

          if (upsertResult.created) {
            result.suggestionsCreated++;
          } else {
            result.suggestionsUpdated++;
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Failed to save suggestion for ${leftMarket.id}: ${errMsg}`);
        }
      }

      processed++;
      if (processed % 100 === 0) {
        console.log(`[matching] Processed ${processed}/${leftMarkets.length - confirmedLeft.size} markets...`);
      }
    }

    console.log(`\n[matching] Suggest-matches v2.3 complete:`);
    console.log(`  Left markets (${fromVenue}): ${result.leftCount}`);
    console.log(`  Right markets (${toVenue}): ${result.rightCount}`);
    console.log(`  Skipped (already confirmed): ${result.skippedConfirmed}`);
    console.log(`  Skipped (no keyword overlap): ${result.skippedNoOverlap}`);
    console.log(`  Skipped (date gate): ${result.skippedDateGate}`);
    console.log(`  Skipped (text gate): ${result.skippedTextGate}`);
    console.log(`  Candidates considered: ${result.candidatesConsidered}`);
    console.log(`  Suggestions created: ${result.suggestionsCreated}`);
    console.log(`  Suggestions updated: ${result.suggestionsUpdated}`);
    console.log(`  Markets with no entities: ${noEntityCount}`);

    if (result.errors.length > 0) {
      console.log(`  Errors: ${result.errors.length}`);
    }

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errors.push(errorMsg);
    console.error(`[matching] Failed: ${errorMsg}`);
  }

  return result;
}

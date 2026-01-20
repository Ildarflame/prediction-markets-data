/**
 * Matching utilities for cross-venue market comparison
 * Simple rule-based matching: text normalization + word overlap + time proximity + category
 */

// English stop words to remove from titles
const STOP_WORDS = new Set([
  'will', 'the', 'a', 'an', 'to', 'in', 'on', 'for', 'of', 'does', 'is', 'are',
  'be', 'during', 'under', 'over', 'than', 'by', 'at', 'with', 'from', 'as',
  'this', 'that', 'it', 'its', 'or', 'and', 'but', 'if', 'then', 'so', 'because',
  'what', 'which', 'who', 'whom', 'how', 'when', 'where', 'why', 'have', 'has',
  'had', 'do', 'did', 'was', 'were', 'been', 'being', 'can', 'could', 'would',
  'should', 'may', 'might', 'must', 'shall', 'before', 'after', 'above', 'below',
]);

/**
 * Normalize title for matching
 * - lowercase
 * - remove punctuation
 * - normalize "vs" variations
 * - remove stop words
 * - collapse whitespace
 */
export function normalizeTitle(title: string): string {
  let normalized = title.toLowerCase();

  // Remove punctuation except hyphens between words
  normalized = normalized.replace(/[^\w\s-]/g, ' ');

  // Normalize "vs" variations
  normalized = normalized.replace(/\bv\.?\s*/g, 'vs ');
  normalized = normalized.replace(/\bversus\b/g, 'vs');

  // Split into words, filter stop words, rejoin
  const words = normalized.split(/\s+/).filter((word) => {
    return word.length >= 2 && !STOP_WORDS.has(word);
  });

  return words.join(' ').trim();
}

/**
 * Tokenize normalized title into words
 */
export function tokenize(title: string): string[] {
  const normalized = normalizeTitle(title);
  return normalized.split(/\s+/).filter((word) => word.length >= 2);
}

/**
 * Calculate Jaccard similarity between two token sets
 * Returns value between 0 and 1
 */
export function jaccard(aTokens: string[], bTokens: string[]): number {
  if (aTokens.length === 0 && bTokens.length === 0) {
    return 0;
  }

  const setA = new Set(aTokens);
  const setB = new Set(bTokens);

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      intersection++;
    }
  }

  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Calculate time proximity score based on close time difference
 * Returns value between 0 and 1
 */
export function timeScore(aCloseTime: Date | null, bCloseTime: Date | null): number {
  // If both are null, give small bonus
  if (aCloseTime === null && bCloseTime === null) {
    return 0.3;
  }

  // If only one is null, small bonus but not zero
  if (aCloseTime === null || bCloseTime === null) {
    return 0.2;
  }

  const diffMs = Math.abs(aCloseTime.getTime() - bCloseTime.getTime());
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffHours <= 12) return 1.0;
  if (diffHours <= 24) return 0.7;
  if (diffHours <= 48) return 0.4;
  if (diffHours <= 168) return 0.2; // 1 week
  return 0;
}

/**
 * Calculate category match score
 * Returns value between 0 and 1
 */
export function categoryScore(aCategory: string | null, bCategory: string | null): number {
  // If both null, neutral score
  if (aCategory === null && bCategory === null) {
    return 0.5;
  }

  // If only one is null, low score
  if (aCategory === null || bCategory === null) {
    return 0.3;
  }

  const aNorm = aCategory.toLowerCase().trim();
  const bNorm = bCategory.toLowerCase().trim();

  // Exact match
  if (aNorm === bNorm) {
    return 1.0;
  }

  // Prefix match (e.g., "politics" vs "politics-us")
  if (aNorm.startsWith(bNorm) || bNorm.startsWith(aNorm)) {
    return 0.8;
  }

  // Check for common category keywords
  const aWords = aNorm.split(/[\s-_]+/);
  const bWords = bNorm.split(/[\s-_]+/);

  for (const word of aWords) {
    if (bWords.includes(word) && word.length > 3) {
      return 0.6;
    }
  }

  return 0.3;
}

/**
 * Market data for matching
 */
export interface MatchableMarket {
  id: number;
  title: string;
  category: string | null;
  closeTime: Date | null;
  venue: string;
}

/**
 * Match result with score breakdown
 */
export interface MatchResult {
  score: number;
  reason: string;
  jaccardScore: number;
  timeScoreValue: number;
  categoryScoreValue: number;
}

/**
 * Calculate overall match score between two markets
 * Weighted combination: 70% text, 20% time, 10% category
 */
export function matchScore(marketA: MatchableMarket, marketB: MatchableMarket): MatchResult {
  const tokensA = tokenize(marketA.title);
  const tokensB = tokenize(marketB.title);

  const jaccardScore = jaccard(tokensA, tokensB);
  const timeScoreValue = timeScore(marketA.closeTime, marketB.closeTime);
  const categoryScoreValue = categoryScore(marketA.category, marketB.category);

  // Weighted score: 70% text similarity, 20% time proximity, 10% category match
  const score = 0.7 * jaccardScore + 0.2 * timeScoreValue + 0.1 * categoryScoreValue;

  const reason = `words=${jaccardScore.toFixed(2)} time=${timeScoreValue.toFixed(2)} cat=${categoryScoreValue.toFixed(2)}`;

  return {
    score,
    reason,
    jaccardScore,
    timeScoreValue,
    categoryScoreValue,
  };
}

/**
 * Quick filter: check if markets have at least one significant token in common
 * Used to reduce O(n*m) comparisons
 */
export function hasCommonTokens(tokensA: string[], tokensB: string[], minCommon = 1): boolean {
  const setB = new Set(tokensB);

  let common = 0;
  for (const token of tokensA) {
    // Only count tokens with 3+ chars as significant
    if (token.length >= 3 && setB.has(token)) {
      common++;
      if (common >= minCommon) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Build inverted index: token -> market ids
 * For efficient candidate filtering
 */
export function buildTokenIndex(markets: MatchableMarket[]): Map<string, number[]> {
  const index = new Map<string, number[]>();

  for (const market of markets) {
    const tokens = tokenize(market.title);

    for (const token of tokens) {
      // Only index tokens with 3+ chars
      if (token.length >= 3) {
        const ids = index.get(token) || [];
        ids.push(market.id);
        index.set(token, ids);
      }
    }
  }

  return index;
}

/**
 * Find candidate markets using inverted index
 * Returns market IDs that share at least one significant token
 */
export function findCandidates(
  sourceTokens: string[],
  tokenIndex: Map<string, number[]>
): Set<number> {
  const candidates = new Set<number>();

  for (const token of sourceTokens) {
    if (token.length >= 3) {
      const ids = tokenIndex.get(token);
      if (ids) {
        for (const id of ids) {
          candidates.add(id);
        }
      }
    }
  }

  return candidates;
}

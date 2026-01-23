/**
 * MVE (Multi-Variate Event) Detection for Kalshi Sports Markets (v3.0.14)
 *
 * MVE/SGP (Same Game Parlay) markets combine multiple bets into one contract.
 * These are correctly excluded from matching as they have no direct equivalent
 * on Polymarket.
 *
 * Detection sources (priority order):
 * 1. eventTicker prefix: KXMV* (most reliable)
 * 2. seriesTicker prefix: KXMV* (fallback)
 * 3. API field: is_multivariate in metadata
 * 4. Title patterns: "yes X, yes Y", "SGP", parlay indicators
 */

/**
 * Input market structure for MVE detection
 */
export interface MveDetectionInput {
  eventTicker?: string | null;
  metadata?: Record<string, unknown> | null;
  title: string;
}

/**
 * Result of MVE detection with detailed reason
 */
export interface MveDetectionResult {
  isMve: boolean;
  source: 'event_ticker' | 'series_ticker' | 'api_field' | 'title_pattern' | 'unknown';
  reason: string | null;
}

/**
 * MVE title patterns
 * - "yes X, yes Y" or "no X, no Y" pattern (multiple conditions)
 * - "yes X, no Y" mixed conditions
 * - SGP / Same Game Parlay explicit mention
 * - Parlay indicators
 * - Multiple comma-separated betting conditions
 */
const MVE_TITLE_PATTERNS = [
  // "yes X, yes Y" or "no X, no Y" pattern at start
  /^(yes|no)\s+\w+.*,\s*(yes|no)\s+/i,
  // Explicit SGP/parlay mentions
  /same\s+game\s+parlay/i,
  /\bsgp\b/i,
  /\bparlay\b/i,
  // Multiple comma-separated conditions with yes/no
  /^(yes|no)\s+[^,]+,\s*(yes|no)\s+[^,]+,\s*(yes|no)\s+/i,
  // Over/Under combined with win conditions (parlay indicator)
  /(over|under)\s+[\d.]+\s+(points?\s+scored|total).*,\s*(yes|no)\s+/i,
  /wins?\s+by\s+over.*,\s*(over|under)\s+[\d.]+/i,
];

/**
 * Detect if a Kalshi market is MVE (Multi-Variate Event / Same Game Parlay)
 *
 * @param market - Market with eventTicker, metadata, and title
 * @returns Detection result with source and reason
 */
export function detectMve(market: MveDetectionInput): MveDetectionResult {
  // 1. Check eventTicker prefix (most reliable)
  if (market.eventTicker?.startsWith('KXMV')) {
    return {
      isMve: true,
      source: 'event_ticker',
      reason: `eventTicker starts with KXMV: ${market.eventTicker}`,
    };
  }

  const metadata = market.metadata;

  // 2. Check seriesTicker prefix from metadata
  const seriesTicker = metadata?.seriesTicker as string | undefined;
  if (seriesTicker?.startsWith('KXMV')) {
    return {
      isMve: true,
      source: 'series_ticker',
      reason: `seriesTicker starts with KXMV: ${seriesTicker}`,
    };
  }

  // 3. Check API field
  if (metadata?.is_multivariate === true) {
    return {
      isMve: true,
      source: 'api_field',
      reason: 'metadata.is_multivariate = true',
    };
  }
  if (metadata?.is_multivariate === false) {
    return {
      isMve: false,
      source: 'api_field',
      reason: 'metadata.is_multivariate = false',
    };
  }

  // 4. Check title patterns
  const title = market.title;
  for (const pattern of MVE_TITLE_PATTERNS) {
    if (pattern.test(title)) {
      return {
        isMve: true,
        source: 'title_pattern',
        reason: `Title matches MVE pattern: ${pattern.source}`,
      };
    }
  }

  // Not MVE based on available information
  return {
    isMve: false,
    source: 'unknown',
    reason: null,
  };
}

/**
 * Simple boolean check - returns true if MVE, false otherwise
 */
export function isMveMarket(market: MveDetectionInput): boolean {
  return detectMve(market).isMve;
}

/**
 * Batch detect MVE status for multiple markets
 */
export function detectMveBatch(markets: MveDetectionInput[]): Map<string, MveDetectionResult> {
  const results = new Map<string, MveDetectionResult>();
  for (const market of markets) {
    const key = market.eventTicker || market.title;
    results.set(key, detectMve(market));
  }
  return results;
}

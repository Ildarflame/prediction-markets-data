/**
 * Matching module exports
 */

export {
  // Constants
  KALSHI_SPORTS_PREFIXES,
  SPORTS_TITLE_KEYWORDS,
  POLYMARKET_ESPORTS_KEYWORDS,
  MACRO_KEYWORDS,
  MACRO_ENTITIES,
  PERIOD_COMPATIBILITY_SCORES,
  RARE_MACRO_ENTITIES,
  RARE_ENTITY_DEFAULT_LOOKBACK_HOURS,
  // Types
  type MacroSignals,
  type FetchMacroMarketsOptions,
  type FetchMacroMarketsStats,
  type MacroMarket,
  type PeriodCompatibilityKind,
  type PeriodCompatibilityResult,
  // Functions
  buildPeriodKey,
  parsePeriodKey,
  isPeriodCompatible,
  periodCompatibilityScore,
  extractMacroSignals,
  fetchEligibleMacroMarkets,
  collectMacroPeriods,
  collectSamplesByEntity,
} from './macroPipeline.js';

// Crypto Pipeline (v2.5.0)
export {
  // Constants
  CRYPTO_ENTITIES_V1,
  CRYPTO_ENTITIES_EXTENDED,
  CRYPTO_KEYWORDS_STRICT,
  CRYPTO_KEYWORDS_BROAD,
  // Types
  type CryptoEntityV1,
  type CryptoSignals,
  type CryptoMarket,
  type FetchCryptoMarketsOptions,
  type FetchCryptoMarketsStats,
  type CryptoScoreResult,
  // Functions
  getCryptoStrictKeywords,
  extractSettleDate,
  settleDateDayDiff,
  extractCryptoEntity,
  extractCryptoSignals,
  fetchEligibleCryptoMarkets,
  buildCryptoIndex,
  findCryptoCandidates,
  cryptoMatchScore,
  collectCryptoSettleDates,
  collectCryptoSamplesByEntity,
} from './cryptoPipeline.js';

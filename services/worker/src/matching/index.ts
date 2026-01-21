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

// Crypto Pipeline (v2.5.3)
export {
  // Constants
  CRYPTO_ENTITIES_V1,
  CRYPTO_ENTITIES_EXTENDED,
  CRYPTO_KEYWORDS_STRICT,
  CRYPTO_KEYWORDS_BROAD,
  CRYPTO_FULLNAME_KEYWORDS,
  CRYPTO_TICKER_KEYWORDS,
  // Enums (v2.5.3)
  CryptoDateType,
  // Types
  type CryptoEntityV1,
  type CryptoSignals,
  type CryptoMarket,
  type FetchCryptoMarketsOptions,
  type FetchCryptoMarketsStats,
  type CryptoScoreResult,
  type SettleDateResult,
  type CryptoNumberResult,
  // Functions
  getCryptoStrictKeywords,
  getCryptoTickerRegex,
  getCryptoDBPatterns,
  extractSettleDate,
  settleDateDayDiff,
  extractCryptoEntity,
  extractCryptoSignals,
  extractCryptoNumbers,
  areDateTypesCompatible,
  arePeriodsEqual,
  fetchEligibleCryptoMarkets,
  buildCryptoIndex,
  findCryptoCandidates,
  cryptoMatchScore,
  collectCryptoSettleDates,
  collectCryptoSamplesByEntity,
} from './cryptoPipeline.js';

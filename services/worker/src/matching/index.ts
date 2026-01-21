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

// Crypto Pipeline (v2.6.2)
export {
  // Constants
  CRYPTO_ENTITIES_V1,
  CRYPTO_ENTITIES_EXTENDED,
  CRYPTO_KEYWORDS_STRICT,
  CRYPTO_KEYWORDS_BROAD,
  CRYPTO_FULLNAME_KEYWORDS,
  CRYPTO_TICKER_KEYWORDS,
  // Enums (v2.5.3 + v2.6.1)
  CryptoDateType,
  TruthSettleSource,
  CryptoMarketType,
  ComparatorSource,
  // Types
  type CryptoEntityV1,
  type CryptoSignals,
  type CryptoMarket,
  type FetchCryptoMarketsOptions,
  type FetchCryptoMarketsStats,
  type CryptoScoreResult,
  type SettleDateResult,
  type CryptoNumberResult,
  type ComparatorResult,
  // v2.6.2: Intraday types
  type IntradaySlotSize,
  type IntradaySignals,
  type IntradayMarket,
  type IntradayScoreResult,
  // Functions
  getCryptoStrictKeywords,
  getCryptoTickerRegex,
  getCryptoDBPatterns,
  extractSettleDate,
  extractSettleDateWithTruth,
  extractCryptoComparator,
  determineCryptoMarketType,
  areMarketTypesCompatible,
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
  // v2.6.2: Intraday functions
  calculateTimeBucket,
  extractIntradayDirection,
  extractIntradaySignals,
  fetchIntradayCryptoMarkets,
  buildIntradayIndex,
  findIntradayCandidates,
  intradayMatchScore,
} from './cryptoPipeline.js';

// Crypto Bracket Grouping (v2.6.0)
export {
  // Types
  type BracketKey,
  type BracketCandidate,
  type BracketGroup,
  type BracketGroupingOptions,
  type BracketStats,
  type BracketAnalysis,
  // Functions
  buildBracketKey,
  groupByBracket,
  selectRepresentative,
  applyBracketGrouping,
  analyzeBrackets,
} from './cryptoBrackets.js';

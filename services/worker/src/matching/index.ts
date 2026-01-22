/**
 * Matching module exports
 */

// Engine V3 (v3.0.0)
export {
  runMatchingV3,
  runMatchingV3Multi,
  printEngineV3Summary,
} from './engineV3.js';

export type {
  EngineV3Options,
  EngineV3Result,
  EngineV3Stats,
  BaseSignals,
  BaseScoreResult,
  ScoredCandidate,
  HardGateResult,
  FetchOptions,
  PipelineLimits,
  AutoConfirmResult,
  AutoRejectResult,
  SuggestionToWrite,
  MarketWithSignals,
  PipelineInfo,
} from './engineV3.types.js';

export {
  DEFAULT_LIMITS,
  DEFAULT_MIN_SCORES,
  DEFAULT_LOOKBACK_HOURS,
} from './engineV3.types.js';

// Dispatcher (v3.0.0)
export {
  registerPipeline,
  getPipeline,
  hasPipeline,
  getRegisteredTopics,
  getRegisteredPipelineInfos,
  clearPipelines,
  IMPLEMENTED_TOPICS,
  isTopicImplemented,
  parseTopicString,
  getMatchableTopics,
} from './dispatcher.js';

// Pipeline base (v3.0.0)
export {
  type TopicPipeline,
  BasePipeline,
} from './pipelines/index.js';

// Rates Pipeline (v3.0.0)
export {
  RatesPipeline,
  ratesPipeline,
  type RatesMarket,
  type RatesScoreResult,
} from './pipelines/index.js';

// Elections Pipeline (v3.0.0)
export {
  ElectionsPipeline,
  electionsPipeline,
  type ElectionsMarket,
  type ElectionsScoreResult,
} from './pipelines/index.js';

// Signal extraction (v3.0.0)
export {
  // Rates signals
  CentralBank,
  RateAction,
  type RatesSignals,
  extractRatesSignals,
  isRatesMarket,
  // Elections signals
  ElectionCountry,
  ElectionOffice,
  ElectionIntent,
  type ElectionsSignals,
  extractElectionsSignals,
  isElectionsMarket,
} from './signals/index.js';

// Pipeline registration (v3.0.0)
export {
  registerAllPipelines,
  resetPipelineRegistration,
} from './registerPipelines.js';

// Macro Pipeline (legacy)
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

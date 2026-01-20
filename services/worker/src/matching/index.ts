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

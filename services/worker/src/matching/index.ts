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
  // Types
  type MacroSignals,
  type FetchMacroMarketsOptions,
  type FetchMacroMarketsStats,
  type MacroMarket,
  // Functions
  buildPeriodKey,
  extractMacroSignals,
  fetchEligibleMacroMarkets,
  collectMacroPeriods,
  collectSamplesByEntity,
} from './macroPipeline.js';

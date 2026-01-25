/**
 * Pipelines Index (v3.1.0)
 *
 * Exports all topic-specific pipelines.
 *
 * v3.1.0: Added geopolitics, entertainment, and finance pipelines
 */

// Base pipeline
export {
  type TopicPipeline,
  BasePipeline,
} from './basePipeline.js';

// Rates Pipeline (v3.0.0)
export {
  RatesPipeline,
  ratesPipeline,
  type RatesMarket,
  type RatesScoreResult,
} from './ratesPipeline.js';

// Elections Pipeline (v3.0.0)
export {
  ElectionsPipeline,
  electionsPipeline,
  type ElectionsMarket,
  type ElectionsScoreResult,
} from './electionsPipeline.js';

// Crypto Daily Pipeline (v3.0.6)
export {
  CryptoDailyPipeline,
  cryptoDailyPipeline,
  type CryptoDailyMarket,
} from './cryptoDailyPipeline.js';

// Crypto Intraday Pipeline (v3.0.6)
export {
  CryptoIntradayPipeline,
  cryptoIntradayPipeline,
  type CryptoIntradayMarket,
} from './cryptoIntradayPipeline.js';

// Macro Pipeline V3 (v3.0.6)
export {
  MacroPipelineV3,
  macroPipelineV3,
  type MacroMarketV3,
  type MacroScoreResult,
} from './macroPipelineV3.js';

// Commodities Pipeline V3 (v3.0.6)
export {
  CommoditiesPipelineV3,
  commoditiesPipelineV3,
  type CommoditiesMarketV3,
  type CommoditiesScoreResult,
} from './commoditiesPipelineV3.js';

// Climate Pipeline (v3.0.10)
export {
  climatePipeline,
  type ClimateMarket,
  type ClimateScoreResult,
} from './climatePipeline.js';

// Sports Pipeline (v3.0.11)
export {
  sportsPipeline,
  SportsPipeline,
  type SportsMarket,
  type SportsScoreResult,
} from './sportsPipeline.js';

// Universal Pipeline (v3.0.16)
export {
  UniversalPipeline,
  universalPipeline,
  createUniversalPipeline,
  type UniversalMarket,
  type UniversalSignals,
} from './universalPipeline.js';

// Geopolitics Pipeline (v3.1.0)
export {
  GeopoliticsPipeline,
  geopoliticsPipeline,
  type GeopoliticsMarket,
  type GeopoliticsScoreResult,
} from './geopoliticsPipeline.js';

// Entertainment Pipeline (v3.1.0)
export {
  EntertainmentPipeline,
  entertainmentPipeline,
  type EntertainmentMarket,
  type EntertainmentScoreResult,
} from './entertainmentPipeline.js';

// Finance Pipeline (v3.1.0)
export {
  FinancePipeline,
  financePipeline,
  type FinanceMarket,
  type FinanceScoreResult,
} from './financePipeline.js';

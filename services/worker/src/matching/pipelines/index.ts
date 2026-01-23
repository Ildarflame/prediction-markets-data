/**
 * Pipelines Index (v3.0.10)
 *
 * Exports all topic-specific pipelines.
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

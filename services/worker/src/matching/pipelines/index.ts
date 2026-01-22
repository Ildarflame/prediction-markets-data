/**
 * Pipelines Index (v3.0.0)
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

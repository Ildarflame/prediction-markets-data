/**
 * Pipeline Registration (v3.0.6)
 *
 * Registers all available pipelines with the dispatcher.
 * Call this at application startup.
 */

import { registerPipeline } from './dispatcher.js';
import { ratesPipeline } from './pipelines/ratesPipeline.js';
import { electionsPipeline } from './pipelines/electionsPipeline.js';
import { cryptoDailyPipeline } from './pipelines/cryptoDailyPipeline.js';
import { cryptoIntradayPipeline } from './pipelines/cryptoIntradayPipeline.js';
import { macroPipelineV3 } from './pipelines/macroPipelineV3.js';
import { commoditiesPipelineV3 } from './pipelines/commoditiesPipelineV3.js';

/**
 * Flag to track if pipelines have been registered
 */
let isRegistered = false;

/**
 * Register all pipelines with the dispatcher
 * Safe to call multiple times - only registers once
 */
export function registerAllPipelines(): void {
  if (isRegistered) {
    return;
  }

  // Register V3 pipelines (v3.0.0)
  registerPipeline(ratesPipeline);
  registerPipeline(electionsPipeline);

  // Register legacy pipelines wrapped in V3 interface (v3.0.6)
  registerPipeline(cryptoDailyPipeline);
  registerPipeline(cryptoIntradayPipeline);
  registerPipeline(macroPipelineV3);
  registerPipeline(commoditiesPipelineV3);

  isRegistered = true;
  console.log('[registerPipelines] Registered: CRYPTO_DAILY, CRYPTO_INTRADAY, MACRO, RATES, ELECTIONS, COMMODITIES');
}

/**
 * Reset registration (for testing)
 */
export function resetPipelineRegistration(): void {
  isRegistered = false;
}

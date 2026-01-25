/**
 * Pipeline Registration (v3.1.0)
 *
 * Registers all available pipelines with the dispatcher.
 * Call this at application startup.
 *
 * v3.1.0: Added GEOPOLITICS, ENTERTAINMENT, FINANCE pipelines
 */

import { registerPipeline } from './dispatcher.js';
import { ratesPipeline } from './pipelines/ratesPipeline.js';
import { electionsPipeline } from './pipelines/electionsPipeline.js';
import { cryptoDailyPipeline } from './pipelines/cryptoDailyPipeline.js';
import { cryptoIntradayPipeline } from './pipelines/cryptoIntradayPipeline.js';
import { macroPipelineV3 } from './pipelines/macroPipelineV3.js';
import { commoditiesPipelineV3 } from './pipelines/commoditiesPipelineV3.js';
import { climatePipeline } from './pipelines/climatePipeline.js';
import { sportsPipeline } from './pipelines/sportsPipeline.js';
import { universalPipeline } from './pipelines/universalPipeline.js';
import { geopoliticsPipeline } from './pipelines/geopoliticsPipeline.js';
import { entertainmentPipeline } from './pipelines/entertainmentPipeline.js';
import { financePipeline } from './pipelines/financePipeline.js';

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

  // Register CLIMATE pipeline (v3.0.10)
  registerPipeline(climatePipeline);

  // Register SPORTS pipeline (v3.0.11)
  registerPipeline(sportsPipeline);

  // Register UNIVERSAL pipeline (v3.0.16) - topic-agnostic matching
  registerPipeline(universalPipeline);

  // Register GEOPOLITICS pipeline (v3.1.0)
  registerPipeline(geopoliticsPipeline);

  // Register ENTERTAINMENT pipeline (v3.1.0)
  registerPipeline(entertainmentPipeline);

  // Register FINANCE pipeline (v3.1.0)
  registerPipeline(financePipeline);

  isRegistered = true;
  console.log('[registerPipelines] Registered: CRYPTO_DAILY, CRYPTO_INTRADAY, MACRO, RATES, ELECTIONS, COMMODITIES, CLIMATE, SPORTS, UNIVERSAL, GEOPOLITICS, ENTERTAINMENT, FINANCE');
}

/**
 * Reset registration (for testing)
 */
export function resetPipelineRegistration(): void {
  isRegistered = false;
}

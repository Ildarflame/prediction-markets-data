/**
 * Pipeline Registration (v3.0.0)
 *
 * Registers all available pipelines with the dispatcher.
 * Call this at application startup.
 */

import { registerPipeline } from './dispatcher.js';
import { ratesPipeline } from './pipelines/ratesPipeline.js';
import { electionsPipeline } from './pipelines/electionsPipeline.js';

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

  // Register V3 pipelines
  registerPipeline(ratesPipeline);
  registerPipeline(electionsPipeline);

  // TODO: Register legacy pipelines wrapped in V3 interface
  // registerPipeline(cryptoDailyPipeline);
  // registerPipeline(cryptoIntradayPipeline);
  // registerPipeline(macroPipeline);

  isRegistered = true;
  console.log('[registerPipelines] Registered: rates@3.0.0, elections@3.0.0');
}

/**
 * Reset registration (for testing)
 */
export function resetPipelineRegistration(): void {
  isRegistered = false;
}

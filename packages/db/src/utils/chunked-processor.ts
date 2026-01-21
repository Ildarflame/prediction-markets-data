/**
 * Chunked processor for safe batch database operations (v2.6.4)
 *
 * Handles NAPI string conversion errors and transaction timeouts by
 * automatically reducing batch size and retrying.
 * Prevents OOM, Prisma NAPI crashes, and transaction timeouts on large datasets.
 */

export interface ChunkedProcessorOptions {
  /** Initial batch size (default from ENV or 50) */
  batchSize: number;
  /** Minimum batch size before skipping (default 5) */
  minBatchSize: number;
  /** Maximum retries per batch (default 3) */
  maxRetries: number;
  /** Log prefix for console output */
  logPrefix: string;
  /** Enable verbose logging */
  verbose: boolean;
}

export interface ChunkedProcessorStats {
  totalItems: number;
  processedItems: number;
  batches: number;
  retries: number;
  batchSizeReductions: number;
  /** v2.6.4: Count of batches that were skipped due to persistent errors */
  skippedBatches: number;
  /** v2.6.4: Items in skipped batches */
  skippedItems: number;
  errors: string[];
  timeMs: number;
  /** v2.6.4: Final batch size after all reductions */
  finalBatchSize: number;
}

const DEFAULT_OPTIONS: ChunkedProcessorOptions = {
  // v2.6.4: Much smaller default batch sizes to prevent transaction timeouts
  batchSize: parseInt(process.env.KALSHI_DB_BATCH || '50', 10),
  minBatchSize: parseInt(process.env.KALSHI_DB_MIN_BATCH || '5', 10),
  maxRetries: 3,
  logPrefix: '[chunked]',
  verbose: process.env.KALSHI_VERBOSE === 'true',
};

/**
 * Check if error is a NAPI string conversion or memory-like error
 */
export function isNapiOrMemoryError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  const napiPatterns = [
    'failed to convert rust',
    'napi',
    'string conversion',
    'memory',
    'heap',
    'allocation',
    'buffer',
    'too large',
    'payload',
  ];

  return napiPatterns.some(pattern => message.includes(pattern));
}

/**
 * v2.6.4: Check if error is a transaction timeout/closed error
 * These occur when Prisma transactions take too long or are interrupted
 */
export function isTransactionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  const txPatterns = [
    'transaction already closed',
    'transaction expired',
    'transaction timeout',
    'interactive transaction',
    'commit cannot be executed',
    'rollback cannot be executed',
    'can\'t execute query',
    'connection closed',
    'connection reset',
    'econnreset',
    'socket hang up',
  ];

  return txPatterns.some(pattern => message.includes(pattern));
}

/**
 * v2.6.4: Check if error is retryable (NAPI, memory, or transaction)
 */
export function isRetryableError(error: unknown): boolean {
  return isNapiOrMemoryError(error) || isTransactionError(error);
}

/**
 * Process items in chunks with automatic batch size reduction on NAPI errors
 *
 * @param items - Array of items to process
 * @param processBatch - Async function to process a batch of items
 * @param options - Processing options
 * @returns Stats about the processing
 */
export async function processInChunks<T>(
  items: T[],
  processBatch: (batch: T[], batchIndex: number) => Promise<void>,
  options: Partial<ChunkedProcessorOptions> = {}
): Promise<ChunkedProcessorStats> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const startTime = Date.now();

  const stats: ChunkedProcessorStats = {
    totalItems: items.length,
    processedItems: 0,
    batches: 0,
    retries: 0,
    batchSizeReductions: 0,
    skippedBatches: 0,
    skippedItems: 0,
    errors: [],
    timeMs: 0,
    finalBatchSize: opts.batchSize,
  };

  if (items.length === 0) {
    stats.timeMs = Date.now() - startTime;
    return stats;
  }

  let currentBatchSize = opts.batchSize;
  let index = 0;

  while (index < items.length) {
    const batch = items.slice(index, index + currentBatchSize);
    let success = false;
    let attempts = 0;

    while (!success && attempts < opts.maxRetries) {
      try {
        const batchStart = Date.now();
        await processBatch(batch, stats.batches);
        const batchTime = Date.now() - batchStart;

        if (opts.verbose) {
          console.log(
            `${opts.logPrefix} Batch ${stats.batches + 1}: ${batch.length} items in ${batchTime}ms (size=${currentBatchSize})`
          );
        }

        success = true;
        stats.processedItems += batch.length;
        stats.batches++;
        index += batch.length;

        // v2.6.4: More conservative batch size restoration (every 10 batches, +50% instead of 2x)
        if (currentBatchSize < opts.batchSize && stats.batches % 10 === 0) {
          const newSize = Math.min(Math.floor(currentBatchSize * 1.5), opts.batchSize);
          if (newSize > currentBatchSize) {
            if (opts.verbose) {
              console.log(`${opts.logPrefix} Restoring batch size: ${currentBatchSize} -> ${newSize}`);
            }
            currentBatchSize = newSize;
          }
        }
      } catch (error) {
        attempts++;
        stats.retries++;

        // v2.6.4: Check for both NAPI and transaction errors
        const isRetryable = isRetryableError(error);
        const isTxError = isTransactionError(error);
        const errorMsg = error instanceof Error ? error.message : String(error);

        if (isRetryable && currentBatchSize > opts.minBatchSize) {
          // Reduce batch size and retry
          const newBatchSize = Math.max(Math.floor(currentBatchSize / 2), opts.minBatchSize);
          const errorType = isTxError ? 'Transaction' : 'NAPI/Memory';
          console.warn(
            `${opts.logPrefix} ${errorType} error, reducing batch size: ${currentBatchSize} -> ${newBatchSize}`
          );
          console.warn(`${opts.logPrefix} Error: ${errorMsg.slice(0, 200)}`);

          currentBatchSize = newBatchSize;
          stats.batchSizeReductions++;
          stats.finalBatchSize = currentBatchSize;

          // Reset attempts counter when reducing batch size
          attempts = 0;

          // Re-slice batch with new size - will retry from current index
          continue;
        }

        if (attempts >= opts.maxRetries) {
          const fullError = `Batch ${stats.batches + 1} failed after ${attempts} attempts: ${errorMsg.slice(0, 300)}`;
          stats.errors.push(fullError);
          console.error(`${opts.logPrefix} ${fullError}`);

          // v2.6.4: Track skipped batches
          stats.skippedBatches++;
          stats.skippedItems += batch.length;

          // Skip this batch and continue with next
          index += batch.length;
          console.warn(`${opts.logPrefix} Skipping ${batch.length} items, continuing with next batch...`);
          break;
        }

        // v2.6.4: Longer wait before retry for transaction errors
        const waitMs = isTxError ? 500 * attempts : 100 * attempts;
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
    }
  }

  stats.timeMs = Date.now() - startTime;
  stats.finalBatchSize = currentBatchSize;

  // Summary log
  const skippedInfo = stats.skippedBatches > 0
    ? `, ${stats.skippedBatches} skipped (${stats.skippedItems} items)`
    : '';
  console.log(
    `${opts.logPrefix} Complete: ${stats.processedItems}/${stats.totalItems} items, ` +
    `${stats.batches} batches, ${stats.retries} retries, ${stats.batchSizeReductions} reductions${skippedInfo}, ` +
    `${stats.timeMs}ms (final batch=${stats.finalBatchSize})`
  );

  if (stats.errors.length > 0) {
    console.warn(`${opts.logPrefix} Errors: ${stats.errors.length}`);
  }

  return stats;
}

/**
 * Split array into chunks of specified size
 */
export function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

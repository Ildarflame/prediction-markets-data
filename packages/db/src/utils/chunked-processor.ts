/**
 * Chunked processor for safe batch database operations (v2.6.3)
 *
 * Handles NAPI string conversion errors by automatically reducing batch size
 * and retrying. Prevents OOM and Prisma NAPI crashes on large datasets.
 */

export interface ChunkedProcessorOptions {
  /** Initial batch size (default from ENV or 300) */
  batchSize: number;
  /** Minimum batch size before giving up (default 10) */
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
  errors: string[];
  timeMs: number;
}

const DEFAULT_OPTIONS: ChunkedProcessorOptions = {
  batchSize: parseInt(process.env.KALSHI_DB_BATCH || '300', 10),
  minBatchSize: parseInt(process.env.KALSHI_DB_MIN_BATCH || '10', 10),
  maxRetries: 3,
  logPrefix: '[chunked]',
  verbose: process.env.CHUNKED_VERBOSE === 'true',
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
    errors: [],
    timeMs: 0,
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

        // Gradually restore batch size after successful processing
        if (currentBatchSize < opts.batchSize && stats.batches % 5 === 0) {
          const newSize = Math.min(currentBatchSize * 2, opts.batchSize);
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

        const isNapi = isNapiOrMemoryError(error);
        const errorMsg = error instanceof Error ? error.message : String(error);

        if (isNapi && currentBatchSize > opts.minBatchSize) {
          // Reduce batch size and retry
          const newBatchSize = Math.max(Math.floor(currentBatchSize / 2), opts.minBatchSize);
          console.warn(
            `${opts.logPrefix} NAPI/Memory error, reducing batch size: ${currentBatchSize} -> ${newBatchSize}`
          );
          console.warn(`${opts.logPrefix} Error: ${errorMsg.slice(0, 200)}`);

          currentBatchSize = newBatchSize;
          stats.batchSizeReductions++;

          // Re-slice batch with new size
          const smallerBatch = items.slice(index, index + currentBatchSize);
          if (smallerBatch.length < batch.length) {
            // Will retry with smaller batch
            continue;
          }
        }

        if (attempts >= opts.maxRetries) {
          const fullError = `Batch ${stats.batches + 1} failed after ${attempts} attempts: ${errorMsg}`;
          stats.errors.push(fullError);
          console.error(`${opts.logPrefix} ${fullError}`);

          // Skip this batch and continue with next
          index += batch.length;
          console.warn(`${opts.logPrefix} Skipping batch, continuing with next...`);
          break;
        }

        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 100 * attempts));
      }
    }
  }

  stats.timeMs = Date.now() - startTime;

  // Summary log
  console.log(
    `${opts.logPrefix} Complete: ${stats.processedItems}/${stats.totalItems} items, ` +
    `${stats.batches} batches, ${stats.retries} retries, ${stats.batchSizeReductions} size reductions, ` +
    `${stats.timeMs}ms`
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

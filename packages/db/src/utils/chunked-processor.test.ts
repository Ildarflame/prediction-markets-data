/**
 * Unit tests for chunked-processor.ts (v2.6.4)
 * Run with: npx tsx --test packages/db/src/utils/chunked-processor.test.ts
 */
import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import {
  isNapiOrMemoryError,
  isTransactionError,
  isRetryableError,
  processInChunks,
  chunkArray,
} from './chunked-processor.js';

describe('isNapiOrMemoryError (v2.6.4)', () => {
  it('should detect NAPI string conversion errors', () => {
    const error = new Error('Failed to convert rust string to JavaScript string');
    assert.ok(isNapiOrMemoryError(error));
  });

  it('should detect memory allocation errors', () => {
    const error = new Error('JavaScript heap out of memory');
    assert.ok(isNapiOrMemoryError(error));
  });

  it('should detect buffer errors', () => {
    const error = new Error('Buffer allocation failed');
    assert.ok(isNapiOrMemoryError(error));
  });

  it('should detect payload too large errors', () => {
    const error = new Error('Payload too large for buffer');
    assert.ok(isNapiOrMemoryError(error));
  });

  it('should return false for regular errors', () => {
    const error = new Error('Something went wrong');
    assert.ok(!isNapiOrMemoryError(error));
  });

  it('should return false for non-Error objects', () => {
    assert.ok(!isNapiOrMemoryError('string error'));
    assert.ok(!isNapiOrMemoryError(null));
    assert.ok(!isNapiOrMemoryError(undefined));
  });
});

describe('isTransactionError (v2.6.4)', () => {
  it('should detect "transaction already closed" errors', () => {
    const error = new Error('Transaction already closed: A commit cannot be executed');
    assert.ok(isTransactionError(error));
  });

  it('should detect "transaction expired" errors', () => {
    const error = new Error('Transaction expired after 5000ms');
    assert.ok(isTransactionError(error));
  });

  it('should detect "connection closed" errors', () => {
    const error = new Error('Connection closed unexpectedly');
    assert.ok(isTransactionError(error));
  });

  it('should detect ECONNRESET errors', () => {
    const error = new Error('read ECONNRESET');
    assert.ok(isTransactionError(error));
  });

  it('should detect "socket hang up" errors', () => {
    const error = new Error('socket hang up');
    assert.ok(isTransactionError(error));
  });

  it('should return false for regular errors', () => {
    const error = new Error('Something went wrong');
    assert.ok(!isTransactionError(error));
  });

  it('should return false for non-Error objects', () => {
    assert.ok(!isTransactionError('string error'));
    assert.ok(!isTransactionError(null));
  });
});

describe('isRetryableError (v2.6.4)', () => {
  it('should return true for NAPI errors', () => {
    const error = new Error('Failed to convert rust string');
    assert.ok(isRetryableError(error));
  });

  it('should return true for transaction errors', () => {
    const error = new Error('Transaction already closed');
    assert.ok(isRetryableError(error));
  });

  it('should return false for regular errors', () => {
    const error = new Error('Something went wrong');
    assert.ok(!isRetryableError(error));
  });
});

describe('chunkArray', () => {
  it('should split array into chunks', () => {
    const arr = [1, 2, 3, 4, 5];
    const chunks = chunkArray(arr, 2);
    assert.deepStrictEqual(chunks, [[1, 2], [3, 4], [5]]);
  });

  it('should handle empty array', () => {
    const chunks = chunkArray([], 5);
    assert.deepStrictEqual(chunks, []);
  });

  it('should handle chunk size larger than array', () => {
    const arr = [1, 2, 3];
    const chunks = chunkArray(arr, 10);
    assert.deepStrictEqual(chunks, [[1, 2, 3]]);
  });
});

describe('processInChunks (v2.6.4)', () => {
  it('should process all items in batches', async () => {
    const items = [1, 2, 3, 4, 5];
    const processed: number[] = [];

    const stats = await processInChunks(
      items,
      async (batch) => {
        processed.push(...batch);
      },
      { batchSize: 2, minBatchSize: 1, maxRetries: 1, logPrefix: '[test]', verbose: false }
    );

    assert.deepStrictEqual(processed, [1, 2, 3, 4, 5]);
    assert.strictEqual(stats.processedItems, 5);
    assert.strictEqual(stats.batches, 3);
  });

  it('should handle empty input', async () => {
    const stats = await processInChunks(
      [],
      async () => {},
      { batchSize: 2, minBatchSize: 1, maxRetries: 1, logPrefix: '[test]', verbose: false }
    );

    assert.strictEqual(stats.totalItems, 0);
    assert.strictEqual(stats.processedItems, 0);
    assert.strictEqual(stats.batches, 0);
  });

  it('should reduce batch size on retryable error and eventually succeed', async () => {
    let callCount = 0;

    const stats = await processInChunks(
      [1, 2, 3, 4],
      async (batch) => {
        callCount++;
        // Fail on first call with large batch, succeed on smaller
        if (callCount === 1 && batch.length > 2) {
          throw new Error('Transaction already closed: too many items');
        }
      },
      { batchSize: 4, minBatchSize: 2, maxRetries: 3, logPrefix: '[test]', verbose: false }
    );

    assert.ok(stats.batchSizeReductions > 0, 'Should have reduced batch size');
    assert.strictEqual(stats.processedItems, 4);
  });

  it('should skip batch after max retries and continue', async () => {
    const items = [1, 2, 3, 4, 5, 6];
    let processedBatches: number[][] = [];

    const stats = await processInChunks(
      items,
      async (batch) => {
        // Fail on batch containing 3,4
        if (batch.includes(3)) {
          throw new Error('Permanent failure');
        }
        processedBatches.push([...batch]);
      },
      { batchSize: 2, minBatchSize: 2, maxRetries: 1, logPrefix: '[test]', verbose: false }
    );

    // Should have processed batches [1,2] and [5,6], skipped [3,4]
    assert.strictEqual(stats.skippedBatches, 1);
    assert.strictEqual(stats.skippedItems, 2);
    assert.deepStrictEqual(processedBatches, [[1, 2], [5, 6]]);
  });
});

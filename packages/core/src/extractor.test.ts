/**
 * Unit tests for extractor.ts
 * Run with: npx tsx --test packages/core/src/extractor.test.ts
 */
import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { extractNumbers, extractEntities, extractDates, extractComparator, Comparator } from './extractor.js';

describe('extractNumbers', () => {
  it('should extract plain numbers', () => {
    assert.deepStrictEqual(extractNumbers('price is 3700'), [3700]);
    assert.deepStrictEqual(extractNumbers('$50,000 reward'), [50000]);
    assert.deepStrictEqual(extractNumbers('value 79249.99'), [79249.99]);
  });

  it('should extract numbers with immediate k/m/b multipliers', () => {
    assert.deepStrictEqual(extractNumbers('BTC 100k'), [100000]);
    assert.deepStrictEqual(extractNumbers('1.2m downloads'), [1200000]);
    assert.deepStrictEqual(extractNumbers('$5b valuation'), [5000000000]);
    assert.deepStrictEqual(extractNumbers('79k users'), [79000]);
  });

  it('should extract numbers with word multipliers', () => {
    assert.deepStrictEqual(extractNumbers('100 thousand users'), [100000]);
    assert.deepStrictEqual(extractNumbers('1.2 million downloads'), [1200000]);
    assert.deepStrictEqual(extractNumbers('$5 billion valuation'), [5000000000]);
    assert.deepStrictEqual(extractNumbers('2 trillion debt'), [2000000000000]);
  });

  it('should NOT capture "t" from "to" as trillion multiplier', () => {
    // This was the bug: "$79,000 to" was being parsed as 79 trillion
    const result = extractNumbers('$79,000 to 79,249.99');
    assert.deepStrictEqual(result, [79000, 79249.99]);
  });

  it('should handle range patterns correctly', () => {
    const result = extractNumbers('between $3700 and $3800');
    assert.deepStrictEqual(result, [3700, 3800]);
  });

  it('should extract percentages', () => {
    assert.deepStrictEqual(extractNumbers('CPI above 3%'), [3]);
    assert.deepStrictEqual(extractNumbers('inflation at 2.5%'), [2.5]);
  });

  it('should skip date-like numbers (1-31) unless $ or multiplier', () => {
    // "Feb 1" - the "1" should be skipped (date context)
    assert.deepStrictEqual(extractNumbers('Feb 1 deadline'), []);
    // "$1" HAS a dollar sign, so it's kept (despite being small)
    assert.deepStrictEqual(extractNumbers('costs $1'), [1]);
    // "1k" has multiplier, so it's kept
    assert.deepStrictEqual(extractNumbers('1k users'), [1000]);
    // Plain "5" without context should be skipped
    assert.deepStrictEqual(extractNumbers('page 5'), []);
  });

  it('should skip years (1900-2100)', () => {
    assert.deepStrictEqual(extractNumbers('in 2024'), []);
    assert.deepStrictEqual(extractNumbers('by 2025'), []);
  });

  it('should handle complex market titles', () => {
    // ETH price range market
    const ethResult = extractNumbers('ETH between $3,700 to $3,749.99 on Jan 26?');
    assert.deepStrictEqual(ethResult, [3700, 3749.99]);

    // BTC with multiplier
    const btcResult = extractNumbers('BTC hits 100k by Dec 31');
    assert.deepStrictEqual(btcResult, [100000]);
  });

  it('should deduplicate numbers', () => {
    const result = extractNumbers('$3700 and $3700 again');
    assert.deepStrictEqual(result, [3700]);
  });
});

describe('extractEntities', () => {
  it('should extract crypto entities', () => {
    assert.ok(extractEntities('BTC price prediction').includes('BITCOIN'));
    assert.ok(extractEntities('ETH above $3700').includes('ETHEREUM'));
  });

  it('should NOT match substring entities (Hegseth vs ETH)', () => {
    // This was the bug: "Hegseth" was matching "eth" -> ETHEREUM
    const entities = extractEntities('Pete Hegseth confirmed');
    assert.ok(!entities.includes('ETHEREUM'), 'Should not extract ETH from Hegseth');
  });

  it('should extract political entities', () => {
    assert.ok(extractEntities('Trump wins election').includes('DONALD_TRUMP'));
    assert.ok(extractEntities('Biden approval').includes('JOE_BIDEN'));
  });

  it('should extract multi-word entities', () => {
    assert.ok(extractEntities('Elon Musk tweets').includes('ELON_MUSK'));
    assert.ok(extractEntities('Joe Biden speech').includes('JOE_BIDEN'));
  });
});

describe('extractComparator', () => {
  it('should detect GE comparators', () => {
    assert.strictEqual(extractComparator('ETH above $3700'), Comparator.GE);
    assert.strictEqual(extractComparator('BTC reaches 100k'), Comparator.GE);
    assert.strictEqual(extractComparator('price exceeds $50'), Comparator.GE);
  });

  it('should detect LE comparators', () => {
    assert.strictEqual(extractComparator('ETH below $3000'), Comparator.LE);
    assert.strictEqual(extractComparator('falls under 50'), Comparator.LE);
  });

  it('should detect BETWEEN comparators', () => {
    assert.strictEqual(extractComparator('ETH between $3700 and $3800'), Comparator.BETWEEN);
    assert.strictEqual(extractComparator('from $100 to $200'), Comparator.BETWEEN);
    assert.strictEqual(extractComparator('$3700-$3800'), Comparator.BETWEEN);
    assert.strictEqual(extractComparator('$79,000 to 79,249.99'), Comparator.BETWEEN);
  });

  it('should detect WIN comparators', () => {
    assert.strictEqual(extractComparator('Trump wins election'), Comparator.WIN);
    assert.strictEqual(extractComparator('Lakers beat Celtics'), Comparator.WIN);
  });
});

describe('extractDates', () => {
  it('should extract Month Day Year dates', () => {
    const dates = extractDates('deadline Dec 31, 2024');
    assert.strictEqual(dates.length, 1);
    assert.strictEqual(dates[0].year, 2024);
    assert.strictEqual(dates[0].month, 12);
    assert.strictEqual(dates[0].day, 31);
  });

  it('should extract Month Day dates (infer year)', () => {
    const dates = extractDates('by Jan 26');
    assert.strictEqual(dates.length, 1);
    assert.strictEqual(dates[0].month, 1);
    assert.strictEqual(dates[0].day, 26);
  });

  it('should extract Quarter dates', () => {
    const dates = extractDates('Q4 2024 results');
    assert.strictEqual(dates.length, 1);
    assert.strictEqual(dates[0].year, 2024);
    assert.strictEqual(dates[0].month, 12);
  });
});

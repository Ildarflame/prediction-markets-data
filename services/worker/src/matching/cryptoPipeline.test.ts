/**
 * Unit tests for cryptoPipeline.ts (v2.5.3)
 * Run with: npx tsx --test services/worker/src/matching/cryptoPipeline.test.ts
 */
import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import {
  cryptoMatchScore,
  extractCryptoEntity,
  extractSettleDate,
  extractCryptoNumbers,
  settleDateDayDiff,
  getCryptoTickerRegex,
  areDateTypesCompatible,
  arePeriodsEqual,
  CryptoDateType,
  type CryptoMarket,
  type CryptoSignals,
} from './cryptoPipeline.js';
import { buildFingerprint } from '@data-module/core';

// Helper to create a CryptoMarket for testing (v2.5.3)
function makeCryptoMarket(
  id: number,
  title: string,
  entity: string,
  settleDate: string,
  numbers: number[] = [],
  options: {
    dateType?: CryptoDateType;
    settlePeriod?: string | null;
    numberContext?: 'price' | 'threshold' | 'unknown';
    comparator?: string | null;
  } = {}
): CryptoMarket {
  const fingerprint = buildFingerprint(title, null);
  const signals: CryptoSignals = {
    entity,
    settleDate,
    settleDateParsed: null,
    dateType: options.dateType || CryptoDateType.DAY_EXACT,
    settlePeriod: options.settlePeriod ?? null,
    numbers,
    numberContext: options.numberContext || 'unknown',
    comparator: options.comparator ?? fingerprint.comparator,
    intent: fingerprint.intent,
    fingerprint,
  };
  return {
    market: {
      id,
      title,
      category: null,
      status: 'active',
      closeTime: null,
      venue: 'kalshi',
      metadata: null,
    },
    signals,
  };
}

describe('cryptoMatchScore', () => {
  describe('hard gates', () => {
    it('should reject when entities do not match', () => {
      const left = makeCryptoMarket(1, 'Bitcoin above $100k', 'BITCOIN', '2026-01-21', [100000]);
      const right = makeCryptoMarket(2, 'Ethereum above $5k', 'ETHEREUM', '2026-01-21', [5000]);

      const result = cryptoMatchScore(left, right);
      assert.strictEqual(result, null, 'Should return null for entity mismatch');
    });

    it('should reject when date diff > 1 day', () => {
      const left = makeCryptoMarket(1, 'Bitcoin above $100k on Jan 21', 'BITCOIN', '2026-01-21', [100000]);
      const right = makeCryptoMarket(2, 'Bitcoin above $100k on Jan 25', 'BITCOIN', '2026-01-25', [100000]);

      const result = cryptoMatchScore(left, right);
      assert.strictEqual(result, null, 'Should return null for date diff > 1 day');
    });

    it('should reject when left entity is null', () => {
      const left = makeCryptoMarket(1, 'Some crypto market', null as any, '2026-01-21', [100000]);
      const right = makeCryptoMarket(2, 'Bitcoin above $100k', 'BITCOIN', '2026-01-21', [100000]);

      const result = cryptoMatchScore(left, right);
      assert.strictEqual(result, null, 'Should return null when left entity is null');
    });

    it('should reject when date types are incompatible (v2.5.3)', () => {
      const left = makeCryptoMarket(1, 'Bitcoin above $100k', 'BITCOIN', '2026-01-21', [100000], {
        dateType: CryptoDateType.DAY_EXACT,
      });
      const right = makeCryptoMarket(2, 'Bitcoin above $100k end of Jan', 'BITCOIN', '2026-01-31', [100000], {
        dateType: CryptoDateType.MONTH_END,
        settlePeriod: '2026-01',
      });

      const result = cryptoMatchScore(left, right);
      assert.strictEqual(result, null, 'Should return null when date types are incompatible');
    });

    it('should reject MONTH_END when periods do not match (v2.5.3)', () => {
      const left = makeCryptoMarket(1, 'Bitcoin end of Jan', 'BITCOIN', '2026-01-31', [100000], {
        dateType: CryptoDateType.MONTH_END,
        settlePeriod: '2026-01',
      });
      const right = makeCryptoMarket(2, 'Bitcoin end of Feb', 'BITCOIN', '2026-02-28', [100000], {
        dateType: CryptoDateType.MONTH_END,
        settlePeriod: '2026-02',
      });

      const result = cryptoMatchScore(left, right);
      assert.strictEqual(result, null, 'Should return null when MONTH_END periods do not match');
    });
  });

  describe('scoring', () => {
    it('should accept same entity + same date with high score', () => {
      const left = makeCryptoMarket(1, 'Bitcoin above $100,000 on Jan 21', 'BITCOIN', '2026-01-21', [100000]);
      const right = makeCryptoMarket(2, 'Bitcoin above $100,000 on Jan 21', 'BITCOIN', '2026-01-21', [100000]);

      const result = cryptoMatchScore(left, right);
      assert.ok(result !== null, 'Should return a score result');
      assert.ok(result!.score > 0.8, `Score should be > 0.8, got ${result!.score}`);
      assert.strictEqual(result!.dayDiff, 0, 'Day diff should be 0');
      assert.strictEqual(result!.tier, 'STRONG', 'Should be STRONG tier');
    });

    it('should accept same entity + ±1 day with lower date score', () => {
      const left = makeCryptoMarket(1, 'Bitcoin above $100k on Jan 21', 'BITCOIN', '2026-01-21', [100000]);
      const right = makeCryptoMarket(2, 'Bitcoin above $100k on Jan 22', 'BITCOIN', '2026-01-22', [100000]);

      const result = cryptoMatchScore(left, right);
      assert.ok(result !== null, 'Should return a score result');
      assert.strictEqual(result!.dayDiff, 1, 'Day diff should be 1');
      assert.strictEqual(result!.dateScore, 0.6, 'Date score should be 0.6 for ±1 day');
    });

    it('should have full number score when price ranges overlap', () => {
      const left = makeCryptoMarket(1, 'Bitcoin between $99k and $101k', 'BITCOIN', '2026-01-21', [99000, 101000]);
      const right = makeCryptoMarket(2, 'Bitcoin above $100k', 'BITCOIN', '2026-01-21', [100000]);

      const result = cryptoMatchScore(left, right);
      assert.ok(result !== null, 'Should return a score result');
      assert.strictEqual(result!.numberScore, 1.0, 'Number score should be 1.0 when ranges overlap');
    });

    it('should have zero number score when no numbers on one side', () => {
      const left = makeCryptoMarket(1, 'Bitcoin price on Jan 21', 'BITCOIN', '2026-01-21', []);
      const right = makeCryptoMarket(2, 'Bitcoin above $100k on Jan 21', 'BITCOIN', '2026-01-21', [100000]);

      const result = cryptoMatchScore(left, right);
      assert.ok(result !== null, 'Should return a score result');
      assert.strictEqual(result!.numberScore, 0, 'Number score should be 0 when one side has no numbers');
    });

    it('should accept same MONTH_END periods with high score (v2.5.3)', () => {
      const left = makeCryptoMarket(1, 'Bitcoin end of January 2026', 'BITCOIN', '2026-01-31', [100000], {
        dateType: CryptoDateType.MONTH_END,
        settlePeriod: '2026-01',
      });
      const right = makeCryptoMarket(2, 'BTC end of Jan 2026', 'BITCOIN', '2026-01-31', [100000], {
        dateType: CryptoDateType.MONTH_END,
        settlePeriod: '2026-01',
      });

      const result = cryptoMatchScore(left, right);
      assert.ok(result !== null, 'Should return a score result');
      assert.strictEqual(result!.dateScore, 1.0, 'Date score should be 1.0 for matching MONTH_END');
    });

    it('should accept same QUARTER periods with high score (v2.5.3)', () => {
      const left = makeCryptoMarket(1, 'Bitcoin Q1 2026', 'BITCOIN', '2026-03-31', [100000], {
        dateType: CryptoDateType.QUARTER,
        settlePeriod: '2026-Q1',
      });
      const right = makeCryptoMarket(2, 'BTC first quarter 2026', 'BITCOIN', '2026-03-31', [100000], {
        dateType: CryptoDateType.QUARTER,
        settlePeriod: '2026-Q1',
      });

      const result = cryptoMatchScore(left, right);
      assert.ok(result !== null, 'Should return a score result');
      assert.strictEqual(result!.dateScore, 1.0, 'Date score should be 1.0 for matching QUARTER');
    });
  });
});

describe('extractCryptoEntity', () => {
  it('should extract BITCOIN from "bitcoin" token', () => {
    assert.strictEqual(extractCryptoEntity('Bitcoin price on Jan 21', null), 'BITCOIN');
  });

  it('should extract BITCOIN from "btc" token', () => {
    assert.strictEqual(extractCryptoEntity('BTC above $100k', null), 'BITCOIN');
  });

  it('should extract ETHEREUM from "ethereum" token', () => {
    assert.strictEqual(extractCryptoEntity('Ethereum price prediction', null), 'ETHEREUM');
  });

  it('should extract ETHEREUM from "eth" token', () => {
    assert.strictEqual(extractCryptoEntity('ETH price above $5000', null), 'ETHEREUM');
  });

  it('should NOT extract ETHEREUM from "Hegseth"', () => {
    assert.strictEqual(extractCryptoEntity('Pete Hegseth nomination', null), null);
  });

  it('should extract from $BTC ticker pattern', () => {
    assert.strictEqual(extractCryptoEntity('$BTC to the moon', null), 'BITCOIN');
  });

  it('should extract from $ETH ticker pattern', () => {
    assert.strictEqual(extractCryptoEntity('$ETH reaches $10k', null), 'ETHEREUM');
  });
});

describe('settleDateDayDiff', () => {
  it('should return 0 for same date', () => {
    assert.strictEqual(settleDateDayDiff('2026-01-21', '2026-01-21'), 0);
  });

  it('should return 1 for adjacent dates', () => {
    assert.strictEqual(settleDateDayDiff('2026-01-21', '2026-01-22'), 1);
    assert.strictEqual(settleDateDayDiff('2026-01-22', '2026-01-21'), 1);
  });

  it('should return correct diff for dates far apart', () => {
    assert.strictEqual(settleDateDayDiff('2026-01-01', '2026-01-10'), 9);
  });

  it('should return null for invalid date', () => {
    assert.strictEqual(settleDateDayDiff(null, '2026-01-21'), null);
    assert.strictEqual(settleDateDayDiff('2026-01-21', null), null);
    assert.strictEqual(settleDateDayDiff('invalid', '2026-01-21'), null);
  });
});

describe('getCryptoTickerRegex', () => {
  it('should match ticker at start of string', () => {
    const pattern = new RegExp(getCryptoTickerRegex('eth'), 'i');
    assert.ok(pattern.test('ETH price today'), 'Should match ETH at start');
  });

  it('should match ticker with $ prefix', () => {
    const pattern = new RegExp(getCryptoTickerRegex('eth'), 'i');
    assert.ok(pattern.test('$ETH to $5000'), 'Should match $ETH');
  });

  it('should match ticker at end of string', () => {
    const pattern = new RegExp(getCryptoTickerRegex('btc'), 'i');
    assert.ok(pattern.test('Buy some BTC'), 'Should match BTC at end');
  });

  it('should NOT match ticker inside word', () => {
    const pattern = new RegExp(getCryptoTickerRegex('eth'), 'i');
    assert.ok(!pattern.test('Pete Hegseth'), 'Should NOT match Hegseth');
    assert.ok(!pattern.test('Kenneth Lee'), 'Should NOT match Kenneth');
  });

  it('should NOT match sol inside "solution"', () => {
    const pattern = new RegExp(getCryptoTickerRegex('sol'), 'i');
    assert.ok(!pattern.test('This is a solution'), 'Should NOT match solution');
    assert.ok(!pattern.test('Solve this problem'), 'Should NOT match Solve');
  });

  it('should match sol as standalone token', () => {
    const pattern = new RegExp(getCryptoTickerRegex('sol'), 'i');
    assert.ok(pattern.test('SOL price prediction'), 'Should match SOL standalone');
    assert.ok(pattern.test('$SOL to $200'), 'Should match $SOL');
  });
});

describe('extractSettleDate (v2.5.3)', () => {
  it('should extract DAY_EXACT date from title', () => {
    const result = extractSettleDate('Bitcoin price on Jan 21, 2026', null);
    assert.strictEqual(result.date, '2026-01-21');
    assert.strictEqual(result.dateType, CryptoDateType.DAY_EXACT);
    assert.strictEqual(result.settlePeriod, null);
  });

  it('should extract MONTH_END from "end of January 2026"', () => {
    const result = extractSettleDate('Bitcoin end of January 2026', null);
    assert.strictEqual(result.dateType, CryptoDateType.MONTH_END);
    assert.strictEqual(result.settlePeriod, '2026-01');
    assert.strictEqual(result.date, '2026-01-31'); // Last day of January
  });

  it('should extract QUARTER from "Q1 2026"', () => {
    const result = extractSettleDate('Bitcoin price Q1 2026', null);
    assert.strictEqual(result.dateType, CryptoDateType.QUARTER);
    assert.strictEqual(result.settlePeriod, '2026-Q1');
    assert.strictEqual(result.date, '2026-03-31'); // End of Q1
  });

  it('should extract QUARTER from "first quarter 2026"', () => {
    const result = extractSettleDate('Bitcoin first quarter 2026 prediction', null);
    assert.strictEqual(result.dateType, CryptoDateType.QUARTER);
    assert.strictEqual(result.settlePeriod, '2026-Q1');
  });

  it('should fall back to CLOSE_TIME when no date in title', () => {
    const closeTime = new Date('2026-03-15T00:00:00Z');
    const result = extractSettleDate('Bitcoin price prediction', closeTime);
    assert.strictEqual(result.date, '2026-03-15');
    assert.strictEqual(result.dateType, CryptoDateType.CLOSE_TIME);
  });

  it('should return UNKNOWN when no date available', () => {
    const result = extractSettleDate('Bitcoin price prediction', null);
    assert.strictEqual(result.date, null);
    assert.strictEqual(result.dateType, CryptoDateType.UNKNOWN);
  });
});

describe('extractCryptoNumbers (v2.5.3)', () => {
  it('should extract $ prefixed numbers as price', () => {
    const result = extractCryptoNumbers('Bitcoin above $79,000 on Jan 21');
    assert.ok(result.numbers.includes(79000), 'Should extract $79,000');
    assert.strictEqual(result.context, 'price');
  });

  it('should extract numbers with k/m suffixes', () => {
    const result = extractCryptoNumbers('Bitcoin above 100k');
    assert.ok(result.numbers.includes(100000), 'Should extract 100k as 100000');
  });

  it('should NOT extract day numbers from dates', () => {
    const result = extractCryptoNumbers('Bitcoin on Jan 21');
    assert.ok(!result.numbers.includes(21), 'Should NOT include 21 (day)');
  });

  it('should NOT extract year numbers from dates', () => {
    const result = extractCryptoNumbers('Bitcoin in January 2026');
    assert.ok(!result.numbers.includes(2026), 'Should NOT include 2026 (year)');
  });

  it('should extract numbers in comparator context', () => {
    const result = extractCryptoNumbers('Bitcoin above 100000');
    assert.ok(result.numbers.includes(100000), 'Should extract 100000 with comparator');
    assert.strictEqual(result.context, 'threshold');
  });

  it('should extract multiple prices from range', () => {
    const result = extractCryptoNumbers('Bitcoin between $99,000 and $101,000');
    assert.ok(result.numbers.includes(99000), 'Should extract $99,000');
    assert.ok(result.numbers.includes(101000), 'Should extract $101,000');
  });
});

describe('areDateTypesCompatible (v2.5.3)', () => {
  it('DAY_EXACT should be compatible with DAY_EXACT', () => {
    assert.ok(areDateTypesCompatible(CryptoDateType.DAY_EXACT, CryptoDateType.DAY_EXACT));
  });

  it('DAY_EXACT should be compatible with CLOSE_TIME', () => {
    assert.ok(areDateTypesCompatible(CryptoDateType.DAY_EXACT, CryptoDateType.CLOSE_TIME));
  });

  it('MONTH_END should be compatible with MONTH_END', () => {
    assert.ok(areDateTypesCompatible(CryptoDateType.MONTH_END, CryptoDateType.MONTH_END));
  });

  it('QUARTER should be compatible with QUARTER', () => {
    assert.ok(areDateTypesCompatible(CryptoDateType.QUARTER, CryptoDateType.QUARTER));
  });

  it('DAY_EXACT should NOT be compatible with MONTH_END', () => {
    assert.ok(!areDateTypesCompatible(CryptoDateType.DAY_EXACT, CryptoDateType.MONTH_END));
  });

  it('DAY_EXACT should NOT be compatible with QUARTER', () => {
    assert.ok(!areDateTypesCompatible(CryptoDateType.DAY_EXACT, CryptoDateType.QUARTER));
  });

  it('MONTH_END should NOT be compatible with QUARTER', () => {
    assert.ok(!areDateTypesCompatible(CryptoDateType.MONTH_END, CryptoDateType.QUARTER));
  });
});

describe('arePeriodsEqual (v2.5.3)', () => {
  it('should match same month periods', () => {
    assert.ok(arePeriodsEqual('2026-01', '2026-01'));
  });

  it('should not match different month periods', () => {
    assert.ok(!arePeriodsEqual('2026-01', '2026-02'));
  });

  it('should match same quarter periods', () => {
    assert.ok(arePeriodsEqual('2026-Q1', '2026-Q1'));
  });

  it('should not match different quarter periods', () => {
    assert.ok(!arePeriodsEqual('2026-Q1', '2026-Q2'));
  });

  it('should return false for null periods', () => {
    assert.ok(!arePeriodsEqual(null, '2026-01'));
    assert.ok(!arePeriodsEqual('2026-01', null));
    assert.ok(!arePeriodsEqual(null, null));
  });
});

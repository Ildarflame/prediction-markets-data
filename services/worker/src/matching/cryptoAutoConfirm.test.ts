/**
 * Unit tests for cryptoAutoConfirm.ts SAFE_RULES (v2.6.0)
 * Run with: npx tsx --test services/worker/src/matching/cryptoAutoConfirm.test.ts
 */
import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import {
  validateAutoConfirm,
  createEmptyAutoConfirmStats,
  updateStatsFromRejectReason,
} from './cryptoAutoConfirm.js';
import {
  CryptoDateType,
  TruthSettleSource,
  CryptoMarketType,
  ComparatorSource,
  type CryptoMarket,
  type CryptoScoreResult,
} from './cryptoPipeline.js';
import { buildFingerprint } from '@data-module/core';

/**
 * Helper to create a CryptoMarket for testing
 */
function makeCryptoMarket(
  id: number,
  title: string,
  entity: string | null,
  settleDate: string | null,
  numbers: number[] = [],
  options: {
    dateType?: CryptoDateType;
    comparator?: string | null;
  } = {}
): CryptoMarket {
  const fingerprint = buildFingerprint(title, null);
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
    signals: {
      entity,
      settleDate,
      settleDateParsed: null, // Not used in auto-confirm validation
      dateType: options.dateType || CryptoDateType.DAY_EXACT,
      settlePeriod: null,
      settleSource: TruthSettleSource.TITLE_PARSE,
      marketType: CryptoMarketType.DAILY_THRESHOLD,
      numbers,
      numberContext: numbers.length > 0 ? 'price' : 'unknown',
      comparator: options.comparator ?? fingerprint.comparator,
      comparatorSource: ComparatorSource.TITLE,
      intent: fingerprint.intent,
      fingerprint,
    },
  };
}

/**
 * Helper to create a minimal CryptoScoreResult
 */
function makeScoreResult(overrides: Partial<CryptoScoreResult> = {}): CryptoScoreResult {
  return {
    score: 0.95,
    reason: 'test',
    entityScore: 1.0,
    dateScore: 1.0,
    numberScore: 1.0,
    textScore: 0.5,
    tier: 'STRONG',
    dayDiff: 0,
    dateTypeL: CryptoDateType.DAY_EXACT,
    dateTypeR: CryptoDateType.DAY_EXACT,
    numberContextL: 'price',
    numberContextR: 'price',
    comparatorL: 'GE',
    comparatorR: 'GE',
    ...overrides,
  };
}

describe('validateAutoConfirm SAFE_RULES', () => {
  describe('Rule 1: Entity exact match', () => {
    it('should reject when entities do not match', () => {
      const left = makeCryptoMarket(1, 'Bitcoin above $100k', 'BITCOIN', '2026-01-21', [100000]);
      const right = makeCryptoMarket(2, 'Ethereum above $5k', 'ETHEREUM', '2026-01-21', [5000]);
      const scoreResult = makeScoreResult();

      const result = validateAutoConfirm(left, right, scoreResult);
      assert.strictEqual(result.safe, false);
      assert.strictEqual(result.rejectReason, 'entity_mismatch');
      assert.strictEqual(result.ruleChecks.entityMatch, false);
    });

    it('should reject when left entity is null', () => {
      const left = makeCryptoMarket(1, 'Some crypto', null, '2026-01-21', [100000]);
      const right = makeCryptoMarket(2, 'Bitcoin above $100k', 'BITCOIN', '2026-01-21', [100000]);
      const scoreResult = makeScoreResult();

      const result = validateAutoConfirm(left, right, scoreResult);
      assert.strictEqual(result.safe, false);
      assert.strictEqual(result.rejectReason, 'entity_mismatch');
    });

    it('should pass when entities match exactly', () => {
      const left = makeCryptoMarket(1, 'Bitcoin above $100k', 'BITCOIN', '2026-01-21', [100000]);
      const right = makeCryptoMarket(2, 'BTC above $100000', 'BITCOIN', '2026-01-21', [100000]);
      const scoreResult = makeScoreResult();

      const result = validateAutoConfirm(left, right, scoreResult);
      assert.strictEqual(result.ruleChecks.entityMatch, true);
    });
  });

  describe('Rule 2: BOTH dateType must be DAY_EXACT', () => {
    it('should reject when left dateType is MONTH_END', () => {
      const left = makeCryptoMarket(1, 'Bitcoin end of Jan', 'BITCOIN', '2026-01-31', [100000], {
        dateType: CryptoDateType.MONTH_END,
      });
      const right = makeCryptoMarket(2, 'Bitcoin on Jan 31', 'BITCOIN', '2026-01-31', [100000], {
        dateType: CryptoDateType.DAY_EXACT,
      });
      const scoreResult = makeScoreResult({
        dateTypeL: CryptoDateType.MONTH_END,
        dateTypeR: CryptoDateType.DAY_EXACT,
      });

      const result = validateAutoConfirm(left, right, scoreResult);
      assert.strictEqual(result.safe, false);
      assert.ok(result.rejectReason?.startsWith('date_type_not_day_exact'));
      assert.strictEqual(result.ruleChecks.dateTypeMatch, false);
    });

    it('should reject when right dateType is CLOSE_TIME', () => {
      const left = makeCryptoMarket(1, 'Bitcoin on Jan 21', 'BITCOIN', '2026-01-21', [100000], {
        dateType: CryptoDateType.DAY_EXACT,
      });
      const right = makeCryptoMarket(2, 'Bitcoin price', 'BITCOIN', '2026-01-21', [100000], {
        dateType: CryptoDateType.CLOSE_TIME,
      });
      const scoreResult = makeScoreResult({
        dateTypeL: CryptoDateType.DAY_EXACT,
        dateTypeR: CryptoDateType.CLOSE_TIME,
      });

      const result = validateAutoConfirm(left, right, scoreResult);
      assert.strictEqual(result.safe, false);
      assert.ok(result.rejectReason?.startsWith('date_type_not_day_exact'));
    });

    it('should pass when both dateTypes are DAY_EXACT', () => {
      const left = makeCryptoMarket(1, 'Bitcoin on Jan 21', 'BITCOIN', '2026-01-21', [100000]);
      const right = makeCryptoMarket(2, 'BTC Jan 21', 'BITCOIN', '2026-01-21', [100000]);
      const scoreResult = makeScoreResult();

      const result = validateAutoConfirm(left, right, scoreResult);
      assert.strictEqual(result.ruleChecks.dateTypeMatch, true);
    });
  });

  describe('Rule 3: settleDate must be EXACTLY equal', () => {
    it('should reject when dates differ by 1 day', () => {
      const left = makeCryptoMarket(1, 'Bitcoin on Jan 21', 'BITCOIN', '2026-01-21', [100000]);
      const right = makeCryptoMarket(2, 'Bitcoin on Jan 22', 'BITCOIN', '2026-01-22', [100000]);
      const scoreResult = makeScoreResult();

      const result = validateAutoConfirm(left, right, scoreResult);
      assert.strictEqual(result.safe, false);
      assert.ok(result.rejectReason?.startsWith('date_not_exact'));
      assert.strictEqual(result.ruleChecks.dateExact, false);
    });

    it('should reject when one date is null', () => {
      const left = makeCryptoMarket(1, 'Bitcoin', 'BITCOIN', null, [100000]);
      const right = makeCryptoMarket(2, 'Bitcoin on Jan 21', 'BITCOIN', '2026-01-21', [100000]);
      const scoreResult = makeScoreResult();

      const result = validateAutoConfirm(left, right, scoreResult);
      assert.strictEqual(result.safe, false);
      assert.ok(result.rejectReason?.startsWith('date_not_exact'));
    });

    it('should pass when dates are exactly equal', () => {
      const left = makeCryptoMarket(1, 'Bitcoin on Jan 21', 'BITCOIN', '2026-01-21', [100000]);
      const right = makeCryptoMarket(2, 'BTC Jan 21 2026', 'BITCOIN', '2026-01-21', [100000]);
      const scoreResult = makeScoreResult();

      const result = validateAutoConfirm(left, right, scoreResult);
      assert.strictEqual(result.ruleChecks.dateExact, true);
    });
  });

  describe('Rule 4: Comparator must be equal', () => {
    it('should reject when comparators differ (GE vs LE)', () => {
      const left = makeCryptoMarket(1, 'Bitcoin above $100k', 'BITCOIN', '2026-01-21', [100000], {
        comparator: 'GE',
      });
      const right = makeCryptoMarket(2, 'Bitcoin below $100k', 'BITCOIN', '2026-01-21', [100000], {
        comparator: 'LE',
      });
      const scoreResult = makeScoreResult({
        comparatorL: 'GE',
        comparatorR: 'LE',
      });

      const result = validateAutoConfirm(left, right, scoreResult);
      assert.strictEqual(result.safe, false);
      assert.ok(result.rejectReason?.startsWith('comparator_mismatch'));
      assert.strictEqual(result.ruleChecks.comparatorMatch, false);
    });

    it('should reject when one comparator is null', () => {
      const left = makeCryptoMarket(1, 'Bitcoin above $100k', 'BITCOIN', '2026-01-21', [100000], {
        comparator: 'GE',
      });
      const right = makeCryptoMarket(2, 'Bitcoin price', 'BITCOIN', '2026-01-21', [100000], {
        comparator: null,
      });
      const scoreResult = makeScoreResult({
        comparatorL: 'GE',
        comparatorR: null,
      });

      const result = validateAutoConfirm(left, right, scoreResult);
      assert.strictEqual(result.safe, false);
      assert.ok(result.rejectReason?.startsWith('comparator_mismatch'));
    });

    it('should pass when comparators match (both GE)', () => {
      const left = makeCryptoMarket(1, 'Bitcoin above $100k', 'BITCOIN', '2026-01-21', [100000], {
        comparator: 'GE',
      });
      const right = makeCryptoMarket(2, 'BTC over $100000', 'BITCOIN', '2026-01-21', [100000], {
        comparator: 'GE',
      });
      const scoreResult = makeScoreResult({
        comparatorL: 'GE',
        comparatorR: 'GE',
      });

      const result = validateAutoConfirm(left, right, scoreResult);
      assert.strictEqual(result.ruleChecks.comparatorMatch, true);
    });

    it('should normalize GT to GE and pass', () => {
      const left = makeCryptoMarket(1, 'Bitcoin above $100k', 'BITCOIN', '2026-01-21', [100000], {
        comparator: 'GT',
      });
      const right = makeCryptoMarket(2, 'BTC above $100000', 'BITCOIN', '2026-01-21', [100000], {
        comparator: 'GE',
      });
      const scoreResult = makeScoreResult({
        comparatorL: 'GT',
        comparatorR: 'GE',
      });

      const result = validateAutoConfirm(left, right, scoreResult);
      assert.strictEqual(result.ruleChecks.comparatorMatch, true);
    });
  });

  describe('Rule 5: Number compatibility', () => {
    it('should reject when numbers differ beyond tolerance (GE)', () => {
      const left = makeCryptoMarket(1, 'Bitcoin above $100k', 'BITCOIN', '2026-01-21', [100000]);
      const right = makeCryptoMarket(2, 'Bitcoin above $101k', 'BITCOIN', '2026-01-21', [101000]);
      const scoreResult = makeScoreResult({
        comparatorL: 'GE',
        comparatorR: 'GE',
      });

      const result = validateAutoConfirm(left, right, scoreResult);
      assert.strictEqual(result.safe, false);
      assert.ok(result.rejectReason?.startsWith('number_incompatible'));
      assert.strictEqual(result.ruleChecks.numberCompatible, false);
    });

    it('should pass when numbers are within tolerance ($1 or 0.1%)', () => {
      const left = makeCryptoMarket(1, 'Bitcoin above $100000', 'BITCOIN', '2026-01-21', [100000]);
      const right = makeCryptoMarket(2, 'Bitcoin above $100001', 'BITCOIN', '2026-01-21', [100001]);
      const scoreResult = makeScoreResult({
        comparatorL: 'GE',
        comparatorR: 'GE',
      });

      const result = validateAutoConfirm(left, right, scoreResult);
      assert.strictEqual(result.ruleChecks.numberCompatible, true);
    });

    it('should reject when one side has no numbers', () => {
      const left = makeCryptoMarket(1, 'Bitcoin above $100k', 'BITCOIN', '2026-01-21', [100000], {
        comparator: 'GE',
      });
      const right = makeCryptoMarket(2, 'Bitcoin above 100k', 'BITCOIN', '2026-01-21', [], {
        comparator: 'GE',
      });
      const scoreResult = makeScoreResult({
        comparatorL: 'GE',
        comparatorR: 'GE',
      });

      const result = validateAutoConfirm(left, right, scoreResult);
      assert.strictEqual(result.safe, false);
      assert.ok(result.rejectReason?.startsWith('number_incompatible'));
    });

    it('should pass for BETWEEN ranges with high overlap', () => {
      const left = makeCryptoMarket(1, 'Bitcoin between $99k and $101k', 'BITCOIN', '2026-01-21', [99000, 101000]);
      const right = makeCryptoMarket(2, 'Bitcoin between $99k and $101k', 'BITCOIN', '2026-01-21', [99000, 101000]);
      const scoreResult = makeScoreResult({
        comparatorL: 'BETWEEN',
        comparatorR: 'BETWEEN',
      });

      const result = validateAutoConfirm(left, right, scoreResult);
      assert.strictEqual(result.ruleChecks.numberCompatible, true);
    });
  });

  describe('Rule 6: Minimum text sanity', () => {
    it('should reject when titles have very low similarity', () => {
      const left = makeCryptoMarket(1, 'Aaaa bbbb cccc', 'BITCOIN', '2026-01-21', [100000]);
      const right = makeCryptoMarket(2, 'Xxxx yyyy zzzz', 'BITCOIN', '2026-01-21', [100000]);
      const scoreResult = makeScoreResult();

      const result = validateAutoConfirm(left, right, scoreResult);
      assert.strictEqual(result.safe, false);
      assert.ok(result.rejectReason?.startsWith('text_sanity_too_low'));
      assert.strictEqual(result.ruleChecks.textSanity, false);
    });

    it('should pass when titles share common tokens', () => {
      const left = makeCryptoMarket(1, 'Bitcoin above $100k on Jan 21', 'BITCOIN', '2026-01-21', [100000]);
      const right = makeCryptoMarket(2, 'BTC above $100000 January 21', 'BITCOIN', '2026-01-21', [100000]);
      const scoreResult = makeScoreResult();

      const result = validateAutoConfirm(left, right, scoreResult);
      assert.strictEqual(result.ruleChecks.textSanity, true);
    });
  });

  describe('Rule 7: Required fields present', () => {
    it('should reject when left settleDate is null', () => {
      const left = makeCryptoMarket(1, 'Bitcoin above $100k', 'BITCOIN', null, [100000]);
      const right = makeCryptoMarket(2, 'Bitcoin above $100k on Jan 21', 'BITCOIN', '2026-01-21', [100000]);
      const scoreResult = makeScoreResult();

      // This will fail earlier on dateExact rule, but hasRequiredFields would also fail
      const result = validateAutoConfirm(left, right, scoreResult);
      assert.strictEqual(result.safe, false);
    });

    it('should reject when numbers are empty', () => {
      const left = makeCryptoMarket(1, 'Bitcoin price on Jan 21', 'BITCOIN', '2026-01-21', []);
      const right = makeCryptoMarket(2, 'Bitcoin price on Jan 21', 'BITCOIN', '2026-01-21', [100000]);
      const scoreResult = makeScoreResult({
        comparatorL: 'GE',
        comparatorR: 'GE',
      });

      // This will fail on numberCompatible first
      const result = validateAutoConfirm(left, right, scoreResult);
      assert.strictEqual(result.safe, false);
    });
  });

  describe('All rules pass (SAFE)', () => {
    it('should mark as safe when all rules pass', () => {
      const left = makeCryptoMarket(1, 'Bitcoin above $100,000 on Jan 21, 2026', 'BITCOIN', '2026-01-21', [100000], {
        comparator: 'GE',
      });
      const right = makeCryptoMarket(2, 'BTC above $100k Jan 21 2026', 'BITCOIN', '2026-01-21', [100000], {
        comparator: 'GE',
      });
      const scoreResult = makeScoreResult({
        comparatorL: 'GE',
        comparatorR: 'GE',
      });

      const result = validateAutoConfirm(left, right, scoreResult);
      assert.strictEqual(result.safe, true);
      assert.strictEqual(result.rejectReason, null);
      assert.strictEqual(result.ruleChecks.entityMatch, true);
      assert.strictEqual(result.ruleChecks.dateTypeMatch, true);
      assert.strictEqual(result.ruleChecks.dateExact, true);
      assert.strictEqual(result.ruleChecks.comparatorMatch, true);
      assert.strictEqual(result.ruleChecks.numberCompatible, true);
      assert.strictEqual(result.ruleChecks.textSanity, true);
      assert.strictEqual(result.ruleChecks.hasRequiredFields, true);
    });
  });
});

describe('updateStatsFromRejectReason', () => {
  it('should increment entityMismatch count', () => {
    const stats = createEmptyAutoConfirmStats();
    updateStatsFromRejectReason(stats, 'entity_mismatch');
    assert.strictEqual(stats.skippedByRule.entityMismatch, 1);
  });

  it('should increment dateTypeMismatch count', () => {
    const stats = createEmptyAutoConfirmStats();
    updateStatsFromRejectReason(stats, 'date_type_not_day_exact: MONTH_END/DAY_EXACT');
    assert.strictEqual(stats.skippedByRule.dateTypeMismatch, 1);
  });

  it('should increment dateNotExact count', () => {
    const stats = createEmptyAutoConfirmStats();
    updateStatsFromRejectReason(stats, 'date_not_exact: 2026-01-21 vs 2026-01-22');
    assert.strictEqual(stats.skippedByRule.dateNotExact, 1);
  });

  it('should increment comparatorMismatch count', () => {
    const stats = createEmptyAutoConfirmStats();
    updateStatsFromRejectReason(stats, 'comparator_mismatch: GE vs LE');
    assert.strictEqual(stats.skippedByRule.comparatorMismatch, 1);
  });

  it('should increment numberIncompatible count', () => {
    const stats = createEmptyAutoConfirmStats();
    updateStatsFromRejectReason(stats, 'number_incompatible: [100000] vs [110000]');
    assert.strictEqual(stats.skippedByRule.numberIncompatible, 1);
  });

  it('should increment textSanityLow count', () => {
    const stats = createEmptyAutoConfirmStats();
    updateStatsFromRejectReason(stats, 'text_sanity_too_low: 0.05 < 0.12');
    assert.strictEqual(stats.skippedByRule.textSanityLow, 1);
  });

  it('should increment missingFields count', () => {
    const stats = createEmptyAutoConfirmStats();
    updateStatsFromRejectReason(stats, 'missing_required_fields');
    assert.strictEqual(stats.skippedByRule.missingFields, 1);
  });

  it('should not crash on null reason', () => {
    const stats = createEmptyAutoConfirmStats();
    updateStatsFromRejectReason(stats, null);
    // All counts should remain 0
    assert.strictEqual(stats.skippedByRule.entityMismatch, 0);
    assert.strictEqual(stats.skippedByRule.dateTypeMismatch, 0);
  });
});

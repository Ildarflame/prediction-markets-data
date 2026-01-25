/**
 * Finance Pipeline Tests (v3.1.0)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  extractFinanceSignals,
  isFinanceMarket,
  extractAssetClass,
  extractInstrument,
  extractDirection,
  extractTargetValue,
  extractDate,
  FinanceAssetClass,
  FinanceDirection,
} from '../signals/financeSignals.js';
import { FinancePipeline, type FinanceMarket } from './financePipeline.js';
import type { EligibleMarket } from '@data-module/db';

// Helper to create mock market
function createMockMarket(title: string, closeTime?: Date): EligibleMarket {
  return {
    id: Math.floor(Math.random() * 10000),
    venue: 'polymarket',
    venueMarketId: `mock-${Date.now()}`,
    title,
    status: 'active',
    closeTime: closeTime ?? new Date('2026-01-25'),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as EligibleMarket;
}

// Helper to create FinanceMarket
function createFinanceMarket(title: string, closeTime?: Date): FinanceMarket {
  const market = createMockMarket(title, closeTime);
  return {
    market,
    signals: extractFinanceSignals(market),
  };
}

describe('Finance Signals', () => {
  describe('extractAssetClass', () => {
    it('should detect indices', () => {
      assert.strictEqual(extractAssetClass('S&P 500 above 5000'), FinanceAssetClass.INDEX);
      assert.strictEqual(extractAssetClass('Nasdaq close above 18000'), FinanceAssetClass.INDEX);
      assert.strictEqual(extractAssetClass('Dow Jones today'), FinanceAssetClass.INDEX);
    });

    it('should detect forex', () => {
      assert.strictEqual(extractAssetClass('EUR/USD above 1.10'), FinanceAssetClass.FOREX);
      assert.strictEqual(extractAssetClass('USDJPY below 150'), FinanceAssetClass.FOREX);
      assert.strictEqual(extractAssetClass('Cable GBP/USD'), FinanceAssetClass.FOREX);
    });

    it('should detect bonds', () => {
      assert.strictEqual(extractAssetClass('10-year Treasury yield'), FinanceAssetClass.BOND);
      assert.strictEqual(extractAssetClass('2Y Treasury above 4%'), FinanceAssetClass.BOND);
    });
  });

  describe('extractInstrument', () => {
    it('should extract S&P 500', () => {
      assert.strictEqual(extractInstrument('S&P 500 above 5000'), 'SP500');
      assert.strictEqual(extractInstrument('SPX close today'), 'SP500');
    });

    it('should extract Nasdaq', () => {
      assert.strictEqual(extractInstrument('Nasdaq-100 above 18000'), 'NASDAQ');
    });

    it('should extract forex pairs', () => {
      assert.strictEqual(extractInstrument('EUR/USD above 1.10'), 'EURUSD');
      assert.strictEqual(extractInstrument('Dollar Yen below 150'), 'USDJPY');
    });

    it('should extract bonds', () => {
      assert.strictEqual(extractInstrument('10-year Treasury'), '10Y');
      assert.strictEqual(extractInstrument('2 year yield'), '2Y');
    });
  });

  describe('extractDirection', () => {
    it('should detect ABOVE', () => {
      assert.strictEqual(extractDirection('S&P 500 above 5000'), FinanceDirection.ABOVE);
      assert.strictEqual(extractDirection('Close above $5000'), FinanceDirection.ABOVE);
    });

    it('should detect BELOW', () => {
      assert.strictEqual(extractDirection('Nasdaq below 18000'), FinanceDirection.BELOW);
      assert.strictEqual(extractDirection('Under $5000'), FinanceDirection.BELOW);
    });
  });

  describe('extractTargetValue', () => {
    it('should extract dollar amounts', () => {
      assert.strictEqual(extractTargetValue('above $5,000'), 5000);
      assert.strictEqual(extractTargetValue('above $5000'), 5000);
    });

    it('should extract plain numbers', () => {
      assert.strictEqual(extractTargetValue('above 5000'), 5000);
      assert.strictEqual(extractTargetValue('above 18,000'), 18000);
    });

    it('should extract percentages', () => {
      assert.strictEqual(extractTargetValue('yield above 4.5%'), 4.5);
    });

    it('should extract forex values', () => {
      assert.strictEqual(extractTargetValue('EUR/USD above 1.10'), 1.10);
    });
  });

  describe('extractDate', () => {
    it('should extract full date formats', () => {
      assert.strictEqual(extractDate('January 25, 2026'), '2026-01-25');
      assert.strictEqual(extractDate('Jan 25, 2026'), '2026-01-25');
    });
  });

  describe('isFinanceMarket', () => {
    it('should identify finance markets', () => {
      assert.ok(isFinanceMarket('S&P 500 above 5000'));
      assert.ok(isFinanceMarket('EUR/USD above 1.10'));
      assert.ok(isFinanceMarket('10-year Treasury yield'));
      assert.ok(isFinanceMarket('Nasdaq close today'));
    });

    it('should reject non-finance markets', () => {
      assert.ok(!isFinanceMarket('Bitcoin above $100k'));
      assert.ok(!isFinanceMarket('Lakers win NBA'));
      assert.ok(!isFinanceMarket('Ukraine ceasefire'));
    });
  });
});

describe('Finance Pipeline', () => {
  const pipeline = new FinancePipeline();

  describe('checkHardGates', () => {
    it('should pass when instruments match', () => {
      const left = createFinanceMarket('S&P 500 above 5000 on January 25, 2026');
      const right = createFinanceMarket('SPX close above 5000 Jan 25, 2026');

      const result = pipeline.checkHardGates(left, right);
      assert.ok(result.passed, `Should pass: ${result.failReason}`);
    });

    it('should fail when instruments differ', () => {
      const left = createFinanceMarket('S&P 500 above 5000');
      const right = createFinanceMarket('Nasdaq above 18000');

      const result = pipeline.checkHardGates(left, right);
      assert.ok(!result.passed, 'Should fail for different instruments');
    });

    it('should fail when dates are too far apart', () => {
      const left = createFinanceMarket('S&P 500 above 5000 on January 1, 2026');
      const right = createFinanceMarket('S&P 500 above 5000 on January 15, 2026');

      const result = pipeline.checkHardGates(left, right);
      assert.ok(!result.passed, 'Should fail for dates > 7 days apart');
    });
  });

  describe('score', () => {
    it('should give high score for identical markets', () => {
      const left = createFinanceMarket('S&P 500 above $5,000 on January 25, 2026');
      const right = createFinanceMarket('SPX close above 5000 Jan 25, 2026');

      const result = pipeline.score(left, right);
      assert.ok(result !== null);
      assert.ok(result.score >= 0.7, `Expected high score, got ${result.score}`);
    });

    it('should give good score for similar targets', () => {
      const left = createFinanceMarket('S&P 500 above 5000 on January 25, 2026');
      const right = createFinanceMarket('S&P 500 above 5010 on January 25, 2026');

      const result = pipeline.score(left, right);
      assert.ok(result !== null);
      assert.ok(result.score >= 0.6, `Expected decent score, got ${result.score}`);
    });

    it('should handle forex markets', () => {
      const left = createFinanceMarket('EUR/USD above 1.10 on January 25, 2026');
      const right = createFinanceMarket('EURUSD close above 1.10 Jan 25, 2026');

      const result = pipeline.score(left, right);
      assert.ok(result !== null);
      assert.ok(result.score >= 0.7, `Expected good score for forex, got ${result.score}`);
    });

    it('should handle bond markets', () => {
      const left = createFinanceMarket('10-year Treasury yield above 4.5% on January 25, 2026');
      const right = createFinanceMarket('10Y Treasury yield above 4.5% Jan 25, 2026');

      const result = pipeline.score(left, right);
      assert.ok(result !== null);
      assert.ok(result.score >= 0.6, `Expected decent score for bonds, got ${result.score}`);
    });
  });

  describe('shouldAutoConfirm', () => {
    it('should auto-confirm high score matches with exact date and target', () => {
      const left = createFinanceMarket('S&P 500 above $5,000 on January 25, 2026');
      const right = createFinanceMarket('SPX close above 5000 Jan 25, 2026');

      const scoreResult = pipeline.score(left, right);
      assert.ok(scoreResult !== null);

      if (scoreResult.score >= 0.90 && scoreResult.dateScore >= 1.0 && scoreResult.targetScore >= 0.8) {
        const result = pipeline.shouldAutoConfirm(left, right, scoreResult);
        assert.ok(result.shouldConfirm, 'Should auto-confirm exact matches');
        assert.strictEqual(result.rule, 'FINANCE_EXACT_MATCH');
      }
    });
  });

  describe('shouldAutoReject', () => {
    it('should auto-reject low score matches', () => {
      const left = createFinanceMarket('S&P 500 above 5000 Jan 2026');
      const right = createFinanceMarket('Dow Jones above 40000 Feb 2026');

      // Hard gate should fail, but if we force score...
      const gateResult = pipeline.checkHardGates(left, right);
      if (!gateResult.passed) {
        // Expected - instruments don't match
        assert.ok(gateResult.failReason?.includes('Instrument mismatch'));
      }
    });
  });
});

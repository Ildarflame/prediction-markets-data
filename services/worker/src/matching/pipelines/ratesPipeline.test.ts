/**
 * Rates Pipeline Tests (v3.0.0)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ratesPipeline, type RatesMarket } from './ratesPipeline.js';
import { CentralBank, RateAction, type RatesSignals } from '../signals/ratesSignals.js';
import type { EligibleMarket } from '@data-module/db';

// Helper to create test rates market
function makeRatesMarket(
  id: number,
  title: string,
  signals: Partial<RatesSignals>,
  closeTime?: Date
): RatesMarket {
  const market: EligibleMarket = {
    id,
    title,
    venue: 'kalshi',
    externalId: `test-${id}`,
    status: 'active',
    closeTime: closeTime ?? new Date('2025-01-29'),
    category: null,
    metadata: null,
    outcomeCount: 2,
  } as EligibleMarket;

  const fullSignals: RatesSignals = {
    centralBank: signals.centralBank ?? CentralBank.FED,
    meetingDate: signals.meetingDate ?? null,
    meetingMonth: signals.meetingMonth ?? '2025-01',
    action: signals.action ?? RateAction.UNKNOWN,
    basisPoints: signals.basisPoints ?? null,
    targetRate: signals.targetRate ?? null,
    yearEndRate: signals.yearEndRate ?? null,
    year: signals.year ?? 2025,
    actionCount: signals.actionCount ?? null,
    titleTokens: title.toLowerCase().split(/\s+/),
    confidence: signals.confidence ?? 0.8,
  };

  return { market, signals: fullSignals };
}

describe('RatesPipeline', () => {
  describe('checkHardGates', () => {
    it('should pass when central bank matches', () => {
      const left = makeRatesMarket(1, 'Fed cuts 25 bps in January', {
        centralBank: CentralBank.FED,
        meetingMonth: '2025-01',
      });
      const right = makeRatesMarket(2, 'FOMC rate cut January 2025', {
        centralBank: CentralBank.FED,
        meetingMonth: '2025-01',
      });

      const result = ratesPipeline.checkHardGates(left, right);
      assert.equal(result.passed, true);
      assert.equal(result.failReason, null);
    });

    it('should fail when central banks differ', () => {
      const left = makeRatesMarket(1, 'Fed cuts rates', {
        centralBank: CentralBank.FED,
      });
      const right = makeRatesMarket(2, 'ECB cuts rates', {
        centralBank: CentralBank.ECB,
      });

      const result = ratesPipeline.checkHardGates(left, right);
      assert.equal(result.passed, false);
      assert.ok(result.failReason?.includes('Central bank mismatch'));
    });

    it('should fail when months differ by > 1', () => {
      const left = makeRatesMarket(1, 'Fed January meeting', {
        centralBank: CentralBank.FED,
        meetingMonth: '2025-01',
      });
      const right = makeRatesMarket(2, 'Fed March meeting', {
        centralBank: CentralBank.FED,
        meetingMonth: '2025-03',
      });

      const result = ratesPipeline.checkHardGates(left, right);
      assert.equal(result.passed, false);
      assert.ok(result.failReason?.includes('Month difference'));
    });

    it('should fail when dates differ by > 7 days', () => {
      const left = makeRatesMarket(1, 'FOMC Jan 29', {
        centralBank: CentralBank.FED,
        meetingDate: '2025-01-29',
        meetingMonth: '2025-01',
      });
      const right = makeRatesMarket(2, 'FOMC Jan 15', {
        centralBank: CentralBank.FED,
        meetingDate: '2025-01-15',
        meetingMonth: '2025-01',
      });

      const result = ratesPipeline.checkHardGates(left, right);
      assert.equal(result.passed, false);
      assert.ok(result.failReason?.includes('Date difference'));
    });

    it('should pass when dates are within 7 days', () => {
      const left = makeRatesMarket(1, 'FOMC Jan 29', {
        centralBank: CentralBank.FED,
        meetingDate: '2025-01-29',
        meetingMonth: '2025-01',
      });
      const right = makeRatesMarket(2, 'FOMC Jan 28', {
        centralBank: CentralBank.FED,
        meetingDate: '2025-01-28',
        meetingMonth: '2025-01',
      });

      const result = ratesPipeline.checkHardGates(left, right);
      assert.equal(result.passed, true);
    });
  });

  describe('score', () => {
    it('should give high score for exact match', () => {
      const left = makeRatesMarket(1, 'Fed cuts 25 bps January 29 2025', {
        centralBank: CentralBank.FED,
        meetingDate: '2025-01-29',
        meetingMonth: '2025-01',
        action: RateAction.CUT,
        basisPoints: 25,
      });
      const right = makeRatesMarket(2, 'FOMC 25 bps cut Jan 29 2025', {
        centralBank: CentralBank.FED,
        meetingDate: '2025-01-29',
        meetingMonth: '2025-01',
        action: RateAction.CUT,
        basisPoints: 25,
      });

      const result = ratesPipeline.score(left, right);
      assert.ok(result !== null);
      assert.ok(result.score >= 0.85, `Expected score >= 0.85, got ${result.score}`);
      assert.equal(result.tier, 'STRONG');
    });

    it('should give medium score for partial match', () => {
      const left = makeRatesMarket(1, 'Fed rate decision January 2025', {
        centralBank: CentralBank.FED,
        meetingMonth: '2025-01',
        action: RateAction.UNKNOWN,
      });
      const right = makeRatesMarket(2, 'FOMC January meeting', {
        centralBank: CentralBank.FED,
        meetingMonth: '2025-01',
        action: RateAction.UNKNOWN,
      });

      const result = ratesPipeline.score(left, right);
      assert.ok(result !== null);
      assert.ok(result.score >= 0.60);
      assert.ok(result.score < 0.85);
    });

    it('should penalize action mismatch', () => {
      const left = makeRatesMarket(1, 'Fed cuts rates', {
        centralBank: CentralBank.FED,
        meetingMonth: '2025-01',
        action: RateAction.CUT,
      });
      const right = makeRatesMarket(2, 'Fed hikes rates', {
        centralBank: CentralBank.FED,
        meetingMonth: '2025-01',
        action: RateAction.HIKE,
      });

      const result = ratesPipeline.score(left, right);
      assert.ok(result !== null);
      // Action score should be 0 for CUT vs HIKE
      assert.equal(result.actionScore, 0);
    });

    it('should give partial credit for bps mismatch', () => {
      const left = makeRatesMarket(1, 'Fed cuts 25 bps', {
        centralBank: CentralBank.FED,
        basisPoints: 25,
      });
      const right = makeRatesMarket(2, 'Fed cuts 50 bps', {
        centralBank: CentralBank.FED,
        basisPoints: 50,
      });

      const result = ratesPipeline.score(left, right);
      assert.ok(result !== null);
      // BPS score should be 0.4 for 25bps difference
      assert.equal(result.bpsScore, 0.4);
    });
  });

  describe('shouldAutoConfirm', () => {
    it('should auto-confirm high-score exact match', () => {
      const left = makeRatesMarket(1, 'Fed cuts 25 bps January 29 2025', {
        centralBank: CentralBank.FED,
        meetingDate: '2025-01-29',
        meetingMonth: '2025-01',
        action: RateAction.CUT,
        basisPoints: 25,
      });
      const right = makeRatesMarket(2, 'FOMC 25 bps cut Jan 29 2025', {
        centralBank: CentralBank.FED,
        meetingDate: '2025-01-29',
        meetingMonth: '2025-01',
        action: RateAction.CUT,
        basisPoints: 25,
      });

      const score = ratesPipeline.score(left, right)!;
      const result = ratesPipeline.shouldAutoConfirm!(left, right, score);

      // Should auto-confirm if score >= 0.85
      if (score.score >= 0.85) {
        assert.equal(result.shouldConfirm, true);
        assert.equal(result.rule, 'RATES_EXACT_MATCH');
      }
    });

    it('should not auto-confirm when dates differ', () => {
      const left = makeRatesMarket(1, 'Fed January 29', {
        centralBank: CentralBank.FED,
        meetingDate: '2025-01-29',
      });
      const right = makeRatesMarket(2, 'Fed January 28', {
        centralBank: CentralBank.FED,
        meetingDate: '2025-01-28',
      });

      const score = ratesPipeline.score(left, right)!;
      const result = ratesPipeline.shouldAutoConfirm!(left, right, score);

      assert.equal(result.shouldConfirm, false);
    });
  });

  describe('shouldAutoReject', () => {
    it('should auto-reject low score', () => {
      const left = makeRatesMarket(1, 'Fed meeting', {
        centralBank: CentralBank.FED,
      });
      const right = makeRatesMarket(2, 'Fed other topic', {
        centralBank: CentralBank.FED,
      });

      const score = {
        score: 0.45,
        reason: 'test',
        tier: 'WEAK' as const,
        centralBankScore: 1.0,
        dateScore: 0,
        actionScore: 0,
        bpsScore: 0,
        textScore: 0.1,
        dayDiff: null,
        monthDiff: null,
      };

      const result = ratesPipeline.shouldAutoReject!(left, right, score);
      assert.equal(result.shouldReject, true);
      assert.equal(result.rule, 'LOW_SCORE');
    });

    it('should auto-reject action conflict', () => {
      const left = makeRatesMarket(1, 'Fed cuts rates', {
        centralBank: CentralBank.FED,
        action: RateAction.CUT,
      });
      const right = makeRatesMarket(2, 'Fed hikes rates', {
        centralBank: CentralBank.FED,
        action: RateAction.HIKE,
      });

      const score = {
        score: 0.70,
        reason: 'test',
        tier: 'WEAK' as const,
        centralBankScore: 1.0,
        dateScore: 0.5,
        actionScore: 0,
        bpsScore: 0.5,
        textScore: 0.2,
        dayDiff: null,
        monthDiff: null,
      };

      const result = ratesPipeline.shouldAutoReject!(left, right, score);
      assert.equal(result.shouldReject, true);
      assert.equal(result.rule, 'ACTION_CONFLICT');
    });
  });

  describe('buildIndex and findCandidates', () => {
    it('should index by central bank and month', () => {
      const markets: RatesMarket[] = [
        makeRatesMarket(1, 'Fed Jan', { centralBank: CentralBank.FED, meetingMonth: '2025-01' }),
        makeRatesMarket(2, 'Fed Feb', { centralBank: CentralBank.FED, meetingMonth: '2025-02' }),
        makeRatesMarket(3, 'ECB Jan', { centralBank: CentralBank.ECB, meetingMonth: '2025-01' }),
      ];

      const index = ratesPipeline.buildIndex(markets);

      // Should have keys for FED|2025-01, FED|2025-02, ECB|2025-01
      assert.ok(index.has('FED|2025-01'));
      assert.ok(index.has('FED|2025-02'));
      assert.ok(index.has('ECB|2025-01'));
    });

    it('should find candidates for matching month', () => {
      const source = makeRatesMarket(1, 'Fed Jan', {
        centralBank: CentralBank.FED,
        meetingMonth: '2025-01',
      });
      const targets: RatesMarket[] = [
        makeRatesMarket(2, 'FOMC Jan', { centralBank: CentralBank.FED, meetingMonth: '2025-01' }),
        makeRatesMarket(3, 'Fed Feb', { centralBank: CentralBank.FED, meetingMonth: '2025-02' }),
        makeRatesMarket(4, 'ECB Jan', { centralBank: CentralBank.ECB, meetingMonth: '2025-01' }),
      ];

      const index = ratesPipeline.buildIndex(targets);
      const candidates = ratesPipeline.findCandidates(source, index);

      // Should find markets with matching central bank (FED) and nearby months
      assert.ok(candidates.some(c => c.market.id === 2)); // Same month
      assert.ok(candidates.some(c => c.market.id === 3)); // Adjacent month
      assert.ok(!candidates.some(c => c.market.id === 4)); // Different central bank
    });
  });
});

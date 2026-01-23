/**
 * Unit tests for Reject Rules Evaluator (v2.6.8)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  evaluateRejectRules,
  HARD_FLOOR_SCORES,
  TEXT_SANITY_FLOOR,
  type MarketLinkWithMarkets,
} from './reject-rules.js';

describe('evaluateRejectRules', () => {
  const createMockLink = (
    score: number,
    reason: string | null,
    leftTitle: string,
    rightTitle: string,
    createdAt: Date = new Date(Date.now() - 48 * 60 * 60 * 1000) // 48h ago
  ): MarketLinkWithMarkets => ({
    id: 1,
    leftVenue: 'polymarket',
    leftMarketId: 100,
    rightVenue: 'kalshi',
    rightMarketId: 200,
    status: 'suggested',
    score,
    reason,
    algoVersion: 'test',
    topic: 'crypto_daily',
    createdAt,
    updatedAt: new Date(),
    leftMarket: {
      id: 100,
      venue: 'polymarket',
      externalId: 'ext-100',
      title: leftTitle,
      category: null,
      status: 'active',
      statusMeta: null,
      closeTime: new Date(),
      metadata: null,
      sourceUpdatedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      derivedTopic: null,
      pmCategories: null,
      pmTags: null,
      pmEventCategory: null,
      pmEventSubcategory: null,
      taxonomySource: null,
      pmEventId: null,
      pmEventTitle: null,
      pmEventSlug: null,
      pmEventTagSlugs: [],
      kalshiEventTicker: null,
      isMve: null,
      kalshiMveCollectionTicker: null,
      kalshiMveSelectedLegs: null,
      outcomes: [],
    },
    rightMarket: {
      id: 200,
      venue: 'kalshi',
      externalId: 'ext-200',
      title: rightTitle,
      category: null,
      status: 'active',
      statusMeta: null,
      closeTime: new Date(),
      metadata: null,
      sourceUpdatedAt: null,
      derivedTopic: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      pmCategories: null,
      pmTags: null,
      pmEventCategory: null,
      pmEventSubcategory: null,
      taxonomySource: null,
      pmEventId: null,
      pmEventTitle: null,
      pmEventSlug: null,
      pmEventTagSlugs: [],
      kalshiEventTicker: null,
      isMve: null,
      kalshiMveCollectionTicker: null,
      kalshiMveSelectedLegs: null,
      outcomes: [],
    },
  });

  describe('age check', () => {
    it('does not reject fresh links', () => {
      const freshLink = createMockLink(
        0.40, // Below floor
        null,
        'Test market',
        'Test market',
        new Date(Date.now() - 12 * 60 * 60 * 1000) // 12h ago
      );

      const result = evaluateRejectRules(freshLink, 'crypto_daily', 24);
      assert.strictEqual(result.reject, false);
      assert.ok(result.results.some(r => r.ruleId === 'AGE_TOO_FRESH'));
    });

    it('evaluates old links for rejection', () => {
      const oldLink = createMockLink(
        0.40, // Below floor
        null,
        'Test market',
        'Test market',
        new Date(Date.now() - 48 * 60 * 60 * 1000) // 48h ago
      );

      const result = evaluateRejectRules(oldLink, 'crypto_daily', 24);
      assert.strictEqual(result.reject, true);
    });
  });

  describe('score floor', () => {
    it('rejects when score below crypto_daily floor (0.55)', () => {
      const link = createMockLink(0.50, null, 'Test', 'Test');

      const result = evaluateRejectRules(link, 'crypto_daily');
      assert.strictEqual(result.reject, true);
      assert.ok(result.rejectionReasons.includes('SCORE_BELOW_FLOOR'));
    });

    it('does not reject when score above floor', () => {
      const link = createMockLink(0.60, null, 'Test market', 'Test market');

      const result = evaluateRejectRules(link, 'crypto_daily');
      assert.strictEqual(result.reject, false);
    });

    it('uses correct floor per topic', () => {
      // Macro floor is 0.60
      const macroLink = createMockLink(0.58, null, 'Test', 'Test');
      macroLink.topic = 'macro';

      const result = evaluateRejectRules(macroLink, 'macro');
      assert.strictEqual(result.reject, true);

      // Intraday floor is 0.65
      const intradayLink = createMockLink(0.62, null, 'Test', 'Test');
      intradayLink.topic = 'crypto_intraday';

      const result2 = evaluateRejectRules(intradayLink, 'crypto_intraday');
      assert.strictEqual(result2.reject, true);
    });
  });

  describe('entity mismatch detection', () => {
    it('rejects on entity mismatch in reason', () => {
      const link = createMockLink(
        0.70,
        'entity mismatch: BITCOIN vs ETHEREUM',
        'Bitcoin price',
        'Ethereum price'
      );

      const result = evaluateRejectRules(link, 'crypto_daily');
      assert.strictEqual(result.reject, true);
      assert.ok(result.rejectionReasons.includes('ENTITY_MISMATCH'));
    });

    it('detects ENTITY_GATE_FAIL', () => {
      const link = createMockLink(
        0.70,
        'ENTITY_GATE_FAIL: no matching entity',
        'Bitcoin price',
        'Dogecoin price'
      );

      const result = evaluateRejectRules(link, 'crypto_daily');
      assert.strictEqual(result.reject, true);
      assert.ok(result.rejectionReasons.includes('ENTITY_MISMATCH'));
    });
  });

  describe('market type mismatch detection', () => {
    it('rejects daily vs intraday mismatch', () => {
      const link = createMockLink(
        0.70,
        null,
        'Bitcoin price up in next 15 mins?',
        'Bitcoin above $100k on Jan 1, 2026'
      );

      const result = evaluateRejectRules(link, 'all');
      assert.strictEqual(result.reject, true);
      assert.ok(result.rejectionReasons.includes('MARKET_TYPE_MISMATCH'));
    });

    it('does not reject when both are daily', () => {
      const link = createMockLink(
        0.70,
        null,
        'Bitcoin above $100k on Jan 1, 2026',
        'BTC close price above $100,000 on January 1'
      );

      const result = evaluateRejectRules(link, 'crypto_daily');
      // Should not include MARKET_TYPE_MISMATCH
      assert.ok(!result.rejectionReasons.includes('MARKET_TYPE_MISMATCH'));
    });
  });

  describe('date mismatch detection', () => {
    it('rejects large date mismatch for crypto_daily', () => {
      const link = createMockLink(
        0.70,
        'entity=BITCOIN dateType=DAY_EXACT date=0.40(+3d) num=0.50 text=0.30',
        'Bitcoin Jan 1',
        'Bitcoin Jan 4'
      );

      const result = evaluateRejectRules(link, 'crypto_daily');
      assert.strictEqual(result.reject, true);
      assert.ok(result.rejectionReasons.includes('DATE_MISMATCH_LARGE'));
    });

    it('does not reject ±1 day difference', () => {
      const link = createMockLink(
        0.70,
        'entity=BITCOIN dateType=DAY_EXACT date=0.60(+1d) num=0.50 text=0.30',
        'Bitcoin Jan 1',
        'Bitcoin Jan 2'
      );

      const result = evaluateRejectRules(link, 'crypto_daily');
      // Should not include DATE_MISMATCH_LARGE for ±1d
      assert.ok(!result.rejectionReasons.includes('DATE_MISMATCH_LARGE'));
    });

    it('rejects incompatible period for macro', () => {
      const link = createMockLink(
        0.70,
        'PERIOD_GATE_FAIL (incompatible: 2025-01 vs 2025-06)',
        'Unemployment January',
        'Unemployment June'
      );
      link.topic = 'macro';

      const result = evaluateRejectRules(link, 'macro');
      assert.strictEqual(result.reject, true);
      assert.ok(
        result.rejectionReasons.includes('DATE_MISMATCH_LARGE') ||
        result.rejectionReasons.includes('DATE_GATE_FAILED')
      );
    });
  });

  describe('text sanity floor', () => {
    it('rejects when text sanity below floor (0.05)', () => {
      const link = createMockLink(
        0.70,
        'entity=BITCOIN dateType=DAY_EXACT date=1.00(0d) num=0.50 text=0.03',
        'Bitcoin price',
        'BTC market'
      );

      const result = evaluateRejectRules(link, 'crypto_daily');
      assert.strictEqual(result.reject, true);
      assert.ok(result.rejectionReasons.includes('TEXT_SANITY_FLOOR'));
    });

    it('does not reject when text above floor', () => {
      const link = createMockLink(
        0.70,
        'entity=BITCOIN dateType=DAY_EXACT date=1.00(0d) num=0.50 text=0.10',
        'Bitcoin price market',
        'BTC price market'
      );

      const result = evaluateRejectRules(link, 'crypto_daily');
      assert.ok(!result.rejectionReasons.includes('TEXT_SANITY_FLOOR'));
    });
  });

  describe('text gate failure', () => {
    it('rejects on TEXT_GATE_FAIL', () => {
      const link = createMockLink(
        0.70,
        'TEXT_GATE_FAIL (jc=0.02 < 0.35)',
        'Test market',
        'Different market'
      );

      const result = evaluateRejectRules(link, 'crypto_daily');
      assert.strictEqual(result.reject, true);
      assert.ok(result.rejectionReasons.includes('TEXT_GATE_FAILED'));
    });
  });

  describe('multiple rejection reasons', () => {
    it('accumulates multiple rejection reasons', () => {
      const link = createMockLink(
        0.40, // Below floor
        'entity mismatch text=0.02', // Entity mismatch + low text
        'Bitcoin in next 15 mins', // Intraday
        'Ethereum on Jan 1' // Daily + different entity
      );

      const result = evaluateRejectRules(link, 'all');
      assert.strictEqual(result.reject, true);
      assert.ok(result.rejectionReasons.length >= 2);
    });
  });

  describe('valid links', () => {
    it('does not reject valid high-quality link', () => {
      const link = createMockLink(
        0.85,
        'entity=BITCOIN dateType=DAY_EXACT date=1.00(0d) num=0.90[price] text=0.45',
        'Bitcoin above $100,000 on Jan 1, 2026',
        'Bitcoin above $100,000 on January 1, 2026'
      );

      const result = evaluateRejectRules(link, 'crypto_daily');
      assert.strictEqual(result.reject, false);
      assert.strictEqual(result.rejectionReasons.length, 0);
    });
  });
});

describe('constants', () => {
  it('has correct hard floor scores', () => {
    assert.strictEqual(HARD_FLOOR_SCORES.crypto_daily, 0.55);
    assert.strictEqual(HARD_FLOOR_SCORES.crypto_intraday, 0.65);
    assert.strictEqual(HARD_FLOOR_SCORES.macro, 0.60);
    assert.strictEqual(HARD_FLOOR_SCORES.all, 0.50);
  });

  it('has text sanity floor', () => {
    assert.strictEqual(TEXT_SANITY_FLOOR, 0.05);
  });
});

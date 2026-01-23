/**
 * v3.0.7 Smoke Tests - Taxonomy Classification
 *
 * Tests the classification functions used in:
 * - polymarket:taxonomy:backfill --classify
 * - kalshi:taxonomy:backfill --ticker-pattern
 *
 * Run with: npx tsx --test packages/core/src/taxonomy/v307-smoke.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CanonicalTopic } from './types.js';
import {
  classifyPolymarketMarketV3,
  type PolymarketMarketInfoV3,
} from './polymarketRules.js';
import {
  classifyKalshiMarket,
  classifyKalshiByTicker,
} from './kalshiRules.js';

describe('v3.0.7 Smoke Tests', () => {

  describe('classifyPolymarketMarketV3 (DB-only classify mode)', () => {

    it('should classify crypto price market from title', () => {
      const market: PolymarketMarketInfoV3 = {
        title: 'Bitcoin price at Dec 31, 2025 - $100,000 to $100,999.99',
      };
      const result = classifyPolymarketMarketV3(market);

      assert.equal(result.topic, CanonicalTopic.CRYPTO_DAILY);
      assert.equal(result.taxonomySource, 'TITLE');
    });

    it('should classify crypto intraday "up or down" market', () => {
      const market: PolymarketMarketInfoV3 = {
        title: 'Bitcoin up or down on Jan 20?',
      };
      const result = classifyPolymarketMarketV3(market);

      assert.equal(result.topic, CanonicalTopic.CRYPTO_DAILY);
      assert.equal(result.taxonomySource, 'TITLE');
    });

    it('should classify from pmEventTagSlugs (economy → MACRO)', () => {
      // Note: Title with macro keywords will classify via TITLE first
      // Use a neutral title to test event tags classification
      // The PM_TAG_MAP has 'economy' (not 'economics')
      const market: PolymarketMarketInfoV3 = {
        title: 'What will happen in 2026?',
        eventTags: [{ slug: 'economy', label: 'Economy' }],
      };
      const result = classifyPolymarketMarketV3(market);

      assert.equal(result.topic, CanonicalTopic.MACRO);
      assert.equal(result.taxonomySource, 'PM_EVENT_TAGS');
    });

    it('should classify from pmEventTagSlugs (fed → RATES)', () => {
      const market: PolymarketMarketInfoV3 = {
        title: 'Fed rate cut in March 2026?',
        eventTags: [{ slug: 'fed', label: 'Fed' }],
      };
      const result = classifyPolymarketMarketV3(market);

      assert.equal(result.topic, CanonicalTopic.RATES);
      assert.equal(result.taxonomySource, 'PM_EVENT_TAGS');
    });

    it('should classify from pmEventTagSlugs (crypto → CRYPTO_DAILY)', () => {
      // Note: Title with "Ethereum" or "$5000" could trigger TITLE first
      // Use a neutral title to test event tags classification
      const market: PolymarketMarketInfoV3 = {
        title: 'Will the token go up?',
        eventTags: [{ slug: 'crypto', label: 'Crypto' }],
      };
      const result = classifyPolymarketMarketV3(market);

      assert.equal(result.topic, CanonicalTopic.CRYPTO_DAILY);
      assert.equal(result.taxonomySource, 'PM_EVENT_TAGS');
    });

    it('should classify sports market by sportCode', () => {
      const market: PolymarketMarketInfoV3 = {
        title: 'Lakers vs Celtics - Who wins?',
        sportCode: 'basketball_nba',
      };
      const result = classifyPolymarketMarketV3(market);

      assert.equal(result.topic, CanonicalTopic.SPORTS);
      assert.equal(result.taxonomySource, 'PM_SPORTS');
    });

    it('should classify sports by eventCategory', () => {
      const market: PolymarketMarketInfoV3 = {
        title: 'Super Bowl winner 2026',
        eventCategory: 'Sports',
      };
      const result = classifyPolymarketMarketV3(market);

      assert.equal(result.topic, CanonicalTopic.SPORTS);
      assert.equal(result.taxonomySource, 'PM_SPORTS');
    });

    it('should classify from pmCategories', () => {
      const market: PolymarketMarketInfoV3 = {
        title: 'Some market title',
        pmCategories: [{ slug: 'politics', label: 'Politics' }],
      };
      const result = classifyPolymarketMarketV3(market);

      assert.equal(result.topic, CanonicalTopic.ELECTIONS);
      assert.equal(result.taxonomySource, 'PM_CATEGORIES');
    });

    it('should classify from pmTags when pmCategories not available', () => {
      const market: PolymarketMarketInfoV3 = {
        title: 'Some market about commodities',
        pmTags: [{ slug: 'oil', label: 'Oil' }],
      };
      const result = classifyPolymarketMarketV3(market);

      assert.equal(result.topic, CanonicalTopic.COMMODITIES);
      assert.equal(result.taxonomySource, 'PM_TAGS');
    });

    it('should return UNKNOWN for unclassifiable market', () => {
      const market: PolymarketMarketInfoV3 = {
        title: 'Will aliens land on Earth in 2026?',
      };
      const result = classifyPolymarketMarketV3(market);

      assert.equal(result.topic, CanonicalTopic.UNKNOWN);
      assert.equal(result.taxonomySource, 'UNKNOWN');
    });

  });

  describe('classifyKalshiByTicker (ticker pattern filtering)', () => {

    it('should classify KXBTC ticker as CRYPTO_DAILY', () => {
      const result = classifyKalshiByTicker('KXBTC-26JAN20');

      assert.ok(result);
      assert.equal(result.topic, CanonicalTopic.CRYPTO_DAILY);
    });

    it('should classify KXETH ticker as CRYPTO_DAILY', () => {
      const result = classifyKalshiByTicker('KXETH-26JAN20-T3700');

      assert.ok(result);
      assert.equal(result.topic, CanonicalTopic.CRYPTO_DAILY);
    });

    it('should classify KXSOL ticker as CRYPTO_DAILY', () => {
      const result = classifyKalshiByTicker('KXSOL-26JAN20');

      assert.ok(result);
      assert.equal(result.topic, CanonicalTopic.CRYPTO_DAILY);
    });

    it('should classify KXCPI ticker as MACRO', () => {
      const result = classifyKalshiByTicker('KXCPI-26JAN');

      assert.ok(result);
      assert.equal(result.topic, CanonicalTopic.MACRO);
    });

    it('should classify KXGDP ticker as MACRO', () => {
      const result = classifyKalshiByTicker('KXGDP-26Q1');

      assert.ok(result);
      assert.equal(result.topic, CanonicalTopic.MACRO);
    });

    it('should classify KXNFP ticker as MACRO', () => {
      const result = classifyKalshiByTicker('KXNFP-26JAN');

      assert.ok(result);
      assert.equal(result.topic, CanonicalTopic.MACRO);
    });

    it('should classify KXFEDFUNDS ticker as RATES', () => {
      // Note: The pattern is KXFEDFUNDS (with KX prefix)
      const result = classifyKalshiByTicker('KXFEDFUNDS-26MAR');

      assert.ok(result);
      assert.equal(result.topic, CanonicalTopic.RATES);
    });

    it('should classify FOMC ticker as RATES', () => {
      const result = classifyKalshiByTicker('FOMC-26MAR-RATE');

      assert.ok(result);
      assert.equal(result.topic, CanonicalTopic.RATES);
    });

    it('should return null for unknown ticker patterns', () => {
      const result = classifyKalshiByTicker('UNKNOWN-TICKER');

      assert.equal(result, null);
    });

  });

  describe('classifyKalshiMarket (full classification)', () => {

    it('should classify Bitcoin market by title', () => {
      const result = classifyKalshiMarket(
        'Will Bitcoin be above $100,000 on Jan 26?',
        null, // category
        { eventTicker: 'KXBTC-26JAN26' },
      );

      assert.equal(result.topic, CanonicalTopic.CRYPTO_DAILY);
    });

    it('should classify Ethereum range market', () => {
      const result = classifyKalshiMarket(
        'ETH between $3,700 to $3,749.99 on Jan 26?',
        null,
        { eventTicker: 'KXETH-26JAN26-T3700' },
      );

      assert.equal(result.topic, CanonicalTopic.CRYPTO_DAILY);
    });

    it('should classify CPI market by title', () => {
      const result = classifyKalshiMarket(
        'CPI YoY above 2.8% in January 2026?',
        'Economics',
        { eventTicker: 'KXCPI-26JAN' },
      );

      assert.equal(result.topic, CanonicalTopic.MACRO);
    });

    it('should classify Fed rate market', () => {
      // Use 'financial' category which maps to RATES,
      // or use eventTicker with KXFEDFUNDS pattern
      const result = classifyKalshiMarket(
        'Fed cuts rates by 25bps in March 2026',
        'financial', // 'financial' category maps to RATES
        { eventTicker: 'KXFEDFUNDS-26MAR' },
      );

      assert.equal(result.topic, CanonicalTopic.RATES);
    });

    it('should classify sports market', () => {
      const result = classifyKalshiMarket(
        'Lakers win NBA Finals 2026',
        'Sports',
        {},
      );

      assert.equal(result.topic, CanonicalTopic.SPORTS);
    });

    it('should use category for classification when title is ambiguous', () => {
      const result = classifyKalshiMarket(
        'Some ambiguous market title',
        'Economics',
        {},
      );

      // Economics category should map to MACRO
      assert.equal(result.topic, CanonicalTopic.MACRO);
    });

  });

});

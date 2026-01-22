/**
 * Tests for eligibility module (v2.6.7)
 *
 * Run: npx tsx --test services/worker/src/eligibility/eligibility.test.ts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  isEligibleMarket,
  explainEligibility,
  categorizeStaleActive,
  buildEligibleWhere,
  getDefaultLookbackHours,
  getDefaultForwardHours,
  type MarketForEligibility,
} from './eligibility.js';

describe('eligibility', () => {
  const NOW = new Date('2026-01-22T12:00:00Z');
  const GRACE_MINUTES = 60;

  // Helper to create test market
  const createMarket = (
    overrides: Partial<MarketForEligibility> = {}
  ): MarketForEligibility => ({
    id: 1,
    title: 'Test Market',
    status: 'active',
    closeTime: new Date(NOW.getTime() + 24 * 60 * 60 * 1000), // +1 day
    venue: 'kalshi',
    ...overrides,
  });

  describe('isEligibleMarket', () => {
    test('active market with future closeTime is eligible', () => {
      const market = createMarket({
        status: 'active',
        closeTime: new Date(NOW.getTime() + 60 * 60 * 1000), // +1 hour
      });
      assert.strictEqual(isEligibleMarket(market, NOW, GRACE_MINUTES), true);
    });

    test('active market with closeTime in past beyond grace is NOT eligible', () => {
      const market = createMarket({
        status: 'active',
        closeTime: new Date(NOW.getTime() - 2 * 60 * 60 * 1000), // -2 hours (beyond 60m grace)
      });
      assert.strictEqual(isEligibleMarket(market, NOW, GRACE_MINUTES), false);
    });

    test('active market with closeTime within grace IS eligible', () => {
      const market = createMarket({
        status: 'active',
        closeTime: new Date(NOW.getTime() - 30 * 60 * 1000), // -30 minutes (within 60m grace)
      });
      assert.strictEqual(isEligibleMarket(market, NOW, GRACE_MINUTES), true);
    });

    test('closed market within lookback is eligible', () => {
      const market = createMarket({
        status: 'closed',
        closeTime: new Date(NOW.getTime() - 24 * 60 * 60 * 1000), // -1 day
      });
      // Default lookback is 168 hours (7 days) for crypto
      assert.strictEqual(isEligibleMarket(market, NOW, GRACE_MINUTES), true);
    });

    test('resolved market is NOT eligible', () => {
      const market = createMarket({
        status: 'resolved',
        closeTime: new Date(NOW.getTime() - 60 * 60 * 1000),
      });
      assert.strictEqual(isEligibleMarket(market, NOW, GRACE_MINUTES), false);
    });

    test('archived market is NOT eligible', () => {
      const market = createMarket({
        status: 'archived',
        closeTime: new Date(NOW.getTime() - 60 * 60 * 1000),
      });
      assert.strictEqual(isEligibleMarket(market, NOW, GRACE_MINUTES), false);
    });

    test('active market with null closeTime is eligible', () => {
      const market = createMarket({
        status: 'active',
        closeTime: null,
      });
      assert.strictEqual(isEligibleMarket(market, NOW, GRACE_MINUTES), true);
    });
  });

  describe('explainEligibility', () => {
    test('returns stale_active reason for active market with old closeTime', () => {
      const market = createMarket({
        status: 'active',
        closeTime: new Date(NOW.getTime() - 2 * 60 * 60 * 1000), // -2 hours
      });
      const result = explainEligibility(market, NOW, GRACE_MINUTES);

      assert.strictEqual(result.eligible, false);
      const staleReason = result.reasons.find((r) => r.code === 'stale_active');
      assert.ok(staleReason, 'Should have stale_active reason');
      assert.strictEqual(staleReason?.severity, 'exclude');
    });

    test('returns within_grace warning for active market with recent closeTime', () => {
      const market = createMarket({
        status: 'active',
        closeTime: new Date(NOW.getTime() - 30 * 60 * 1000), // -30 minutes
      });
      const result = explainEligibility(market, NOW, GRACE_MINUTES);

      assert.strictEqual(result.eligible, true);
      const graceReason = result.reasons.find((r) => r.code === 'within_grace');
      assert.ok(graceReason, 'Should have within_grace reason');
      assert.strictEqual(graceReason?.severity, 'warn');
    });

    test('returns status_terminal reason for resolved market', () => {
      const market = createMarket({
        status: 'resolved',
      });
      const result = explainEligibility(market, NOW, GRACE_MINUTES);

      assert.strictEqual(result.eligible, false);
      const terminalReason = result.reasons.find((r) => r.code === 'status_terminal');
      assert.ok(terminalReason, 'Should have status_terminal reason');
    });

    test('returns no_close_time info for market without closeTime', () => {
      const market = createMarket({
        closeTime: null,
      });
      const result = explainEligibility(market, NOW, GRACE_MINUTES);

      assert.strictEqual(result.eligible, true);
      const noCloseTimeReason = result.reasons.find((r) => r.code === 'no_close_time');
      assert.ok(noCloseTimeReason, 'Should have no_close_time reason');
      assert.strictEqual(noCloseTimeReason?.severity, 'info');
    });
  });

  describe('categorizeStaleActive', () => {
    test('returns "ok" for non-active market', () => {
      const market = createMarket({ status: 'closed' });
      assert.strictEqual(categorizeStaleActive(market, NOW, GRACE_MINUTES), 'ok');
    });

    test('returns "ok" for market with null closeTime', () => {
      const market = createMarket({ closeTime: null });
      assert.strictEqual(categorizeStaleActive(market, NOW, GRACE_MINUTES), 'ok');
    });

    test('returns "ok" for market with future closeTime', () => {
      const market = createMarket({
        closeTime: new Date(NOW.getTime() + 60 * 60 * 1000),
      });
      assert.strictEqual(categorizeStaleActive(market, NOW, GRACE_MINUTES), 'ok');
    });

    test('returns "minor" for closeTime within grace period', () => {
      const market = createMarket({
        closeTime: new Date(NOW.getTime() - 30 * 60 * 1000), // -30m (within 60m grace)
      });
      assert.strictEqual(categorizeStaleActive(market, NOW, GRACE_MINUTES), 'minor');
    });

    test('returns "major" for closeTime far beyond grace period', () => {
      const market = createMarket({
        closeTime: new Date(NOW.getTime() - 5 * 60 * 60 * 1000), // -5h (well beyond 2x60m=120m)
      });
      assert.strictEqual(categorizeStaleActive(market, NOW, GRACE_MINUTES), 'major');
    });
  });

  describe('buildEligibleWhere', () => {
    test('returns where clause with venue filter', () => {
      const { where } = buildEligibleWhere({
        venue: 'kalshi',
        now: NOW,
      });

      assert.strictEqual(where.venue, 'kalshi');
    });

    test('returns orderBy closeTime asc', () => {
      const { orderBy } = buildEligibleWhere({
        venue: 'kalshi',
        now: NOW,
      });

      assert.strictEqual(orderBy.closeTime, 'asc');
    });

    test('includes OR conditions for status filtering', () => {
      const { where } = buildEligibleWhere({
        venue: 'kalshi',
        now: NOW,
      });

      assert.ok(Array.isArray(where.OR), 'Should have OR conditions');
      assert.ok((where.OR as unknown[]).length > 0, 'Should have at least one OR condition');
    });
  });

  describe('getDefaultLookbackHours', () => {
    test('returns 168 for crypto topics', () => {
      assert.strictEqual(getDefaultLookbackHours('crypto'), 168);
      assert.strictEqual(getDefaultLookbackHours('crypto_daily'), 168);
      assert.strictEqual(getDefaultLookbackHours('crypto_intraday'), 168);
    });

    test('returns 720 for macro/politics topics', () => {
      assert.strictEqual(getDefaultLookbackHours('macro'), 720);
      assert.strictEqual(getDefaultLookbackHours('politics'), 720);
    });
  });

  describe('getDefaultForwardHours', () => {
    test('returns 72 for crypto_daily', () => {
      assert.strictEqual(getDefaultForwardHours('crypto_daily'), 72);
    });

    test('returns 24 for crypto_intraday', () => {
      assert.strictEqual(getDefaultForwardHours('crypto_intraday'), 24);
    });

    test('returns 8760 (1 year) for macro', () => {
      assert.strictEqual(getDefaultForwardHours('macro'), 8760);
    });
  });
});

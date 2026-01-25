/**
 * Geopolitics Pipeline Tests (v3.1.0)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  extractGeopoliticsSignals,
  isGeopoliticsMarket,
  extractRegion,
  extractEventType,
  extractCountries,
  extractActors,
  GeopoliticsRegion,
  GeopoliticsEventType,
} from '../signals/geopoliticsSignals.js';
import { GeopoliticsPipeline, type GeopoliticsMarket } from './geopoliticsPipeline.js';
import type { EligibleMarket } from '@data-module/db';

// Helper to create mock market
function createMockMarket(title: string, closeTime?: Date): EligibleMarket {
  return {
    id: Math.floor(Math.random() * 10000),
    venue: 'polymarket',
    venueMarketId: `mock-${Date.now()}`,
    title,
    status: 'active',
    closeTime: closeTime ?? new Date('2026-06-01'),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as EligibleMarket;
}

// Helper to create GeopoliticsMarket
function createGeopoliticsMarket(title: string, closeTime?: Date): GeopoliticsMarket {
  const market = createMockMarket(title, closeTime);
  return {
    market,
    signals: extractGeopoliticsSignals(market),
  };
}

describe('Geopolitics Signals', () => {
  describe('extractRegion', () => {
    it('should detect Ukraine region', () => {
      assert.strictEqual(extractRegion('Ukraine ceasefire by March'), GeopoliticsRegion.UKRAINE);
      assert.strictEqual(extractRegion('Zelensky peace deal'), GeopoliticsRegion.UKRAINE);
    });

    it('should detect Russia region', () => {
      assert.strictEqual(extractRegion('Putin resignation before 2026'), GeopoliticsRegion.RUSSIA);
      assert.strictEqual(extractRegion('Moscow sanctions'), GeopoliticsRegion.RUSSIA);
    });

    it('should detect China region', () => {
      assert.strictEqual(extractRegion('Taiwan invasion by China'), GeopoliticsRegion.CHINA);
      assert.strictEqual(extractRegion('Xi Jinping third term'), GeopoliticsRegion.CHINA);
    });

    it('should detect Middle East region', () => {
      assert.strictEqual(extractRegion('Gaza ceasefire deal'), GeopoliticsRegion.MIDDLE_EAST);
      assert.strictEqual(extractRegion('Israel-Hamas war'), GeopoliticsRegion.MIDDLE_EAST);
      assert.strictEqual(extractRegion('Iran nuclear deal'), GeopoliticsRegion.MIDDLE_EAST);
    });
  });

  describe('extractEventType', () => {
    it('should detect WAR events', () => {
      assert.strictEqual(extractEventType('Ukraine invasion continues'), GeopoliticsEventType.WAR);
      assert.strictEqual(extractEventType('Military conflict in Gaza'), GeopoliticsEventType.WAR);  // 'conflict' is WAR keyword
    });

    it('should detect PEACE events', () => {
      assert.strictEqual(extractEventType('Ukraine ceasefire agreement'), GeopoliticsEventType.PEACE);
      assert.strictEqual(extractEventType('Peace treaty signed'), GeopoliticsEventType.PEACE);
      assert.strictEqual(extractEventType('Negotiate a deal'), GeopoliticsEventType.PEACE);
    });

    it('should detect SANCTIONS events', () => {
      assert.strictEqual(extractEventType('Russia sanctions lifted'), GeopoliticsEventType.SANCTIONS);
      assert.strictEqual(extractEventType('New tariffs on China'), GeopoliticsEventType.SANCTIONS);
    });

    it('should detect LEADERSHIP events', () => {
      assert.strictEqual(extractEventType('Putin resign by 2026'), GeopoliticsEventType.LEADERSHIP);
      assert.strictEqual(extractEventType('Coup attempt in Russia'), GeopoliticsEventType.LEADERSHIP);
    });
  });

  describe('extractCountries', () => {
    it('should extract single country', () => {
      assert.deepStrictEqual(extractCountries('Ukraine peace deal'), ['UKRAINE']);
    });

    it('should extract multiple countries', () => {
      const countries = extractCountries('Russia and Ukraine ceasefire');
      assert.ok(countries.includes('RUSSIA'));
      assert.ok(countries.includes('UKRAINE'));
    });

    it('should extract Middle East countries', () => {
      const countries = extractCountries('Israel-Gaza-Hamas conflict');
      assert.ok(countries.includes('ISRAEL'));
      assert.ok(countries.includes('GAZA'));
    });
  });

  describe('extractActors', () => {
    it('should extract Putin', () => {
      assert.deepStrictEqual(extractActors('Putin resignation'), ['PUTIN']);
    });

    it('should extract Zelensky', () => {
      assert.deepStrictEqual(extractActors('Zelensky peace deal'), ['ZELENSKY']);
    });

    it('should extract multiple actors', () => {
      const actors = extractActors('Putin and Zelensky meeting');
      assert.ok(actors.includes('PUTIN'));
      assert.ok(actors.includes('ZELENSKY'));
    });
  });

  describe('isGeopoliticsMarket', () => {
    it('should identify geopolitics markets', () => {
      assert.ok(isGeopoliticsMarket('Ukraine ceasefire by March'));
      assert.ok(isGeopoliticsMarket('Russia sanctions lifted'));
      assert.ok(isGeopoliticsMarket('China Taiwan invasion'));
      assert.ok(isGeopoliticsMarket('Gaza peace deal'));
    });

    it('should reject non-geopolitics markets', () => {
      assert.ok(!isGeopoliticsMarket('Bitcoin above $100k'));
      assert.ok(!isGeopoliticsMarket('Fed rate cut in January'));
      assert.ok(!isGeopoliticsMarket('Lakers win NBA championship'));
    });
  });
});

describe('Geopolitics Pipeline', () => {
  const pipeline = new GeopoliticsPipeline();

  describe('checkHardGates', () => {
    it('should pass when regions overlap', () => {
      const left = createGeopoliticsMarket('Ukraine ceasefire by March 2026');
      const right = createGeopoliticsMarket('Ukraine peace deal before summer 2026');

      const result = pipeline.checkHardGates(left, right);
      assert.ok(result.passed, `Should pass: ${result.failReason}`);
    });

    it('should pass when countries overlap', () => {
      const left = createGeopoliticsMarket('Putin resignation by 2026');
      const right = createGeopoliticsMarket('Russia leadership change in 2026');

      const result = pipeline.checkHardGates(left, right);
      assert.ok(result.passed, `Should pass: ${result.failReason}`);
    });

    it('should fail when no region/country overlap', () => {
      const left = createGeopoliticsMarket('Ukraine ceasefire');
      const right = createGeopoliticsMarket('China Taiwan invasion');

      const result = pipeline.checkHardGates(left, right);
      assert.ok(!result.passed, 'Should fail for different regions');
    });

    it('should fail for conflicting event types (WAR vs PEACE)', () => {
      // Create markets that have same region but conflicting event types
      const left = createGeopoliticsMarket('Ukraine invasion escalation 2026');
      const right = createGeopoliticsMarket('Ukraine peace deal 2026');

      // Both should be Ukraine region
      assert.strictEqual(left.signals.region, GeopoliticsRegion.UKRAINE);
      assert.strictEqual(right.signals.region, GeopoliticsRegion.UKRAINE);

      // But event types should conflict
      assert.strictEqual(left.signals.eventType, GeopoliticsEventType.WAR);
      assert.strictEqual(right.signals.eventType, GeopoliticsEventType.PEACE);

      const result = pipeline.checkHardGates(left, right);
      assert.ok(!result.passed, 'Should fail for WAR vs PEACE');
      assert.ok(result.failReason?.includes('Conflicting event types'));
    });

    it('should fail for year mismatch', () => {
      const left = createGeopoliticsMarket('Ukraine ceasefire by 2025');
      const right = createGeopoliticsMarket('Ukraine ceasefire by 2026');

      const result = pipeline.checkHardGates(left, right);
      assert.ok(!result.passed, 'Should fail for year mismatch');
    });
  });

  describe('score', () => {
    it('should give high score for identical markets', () => {
      const left = createGeopoliticsMarket('Ukraine ceasefire by March 2026');
      const right = createGeopoliticsMarket('Ukraine ceasefire agreement by March 2026');

      const result = pipeline.score(left, right);
      assert.ok(result !== null);
      assert.ok(result.score >= 0.8, `Expected high score, got ${result.score}`);
      assert.strictEqual(result.tier, 'STRONG');
    });

    it('should give good score for similar markets', () => {
      const left = createGeopoliticsMarket('Putin resign by end of 2026');
      const right = createGeopoliticsMarket('Putin step down before 2027');

      const result = pipeline.score(left, right);
      assert.ok(result !== null);
      assert.ok(result.score >= 0.6, `Expected decent score, got ${result.score}`);
    });

    it('should give bonus for actor overlap', () => {
      const left = createGeopoliticsMarket('Zelensky peace deal with Putin 2026');
      const right = createGeopoliticsMarket('Putin and Zelensky ceasefire 2026');

      const result = pipeline.score(left, right);
      assert.ok(result !== null);
      assert.ok(result.actorOverlap >= 2, 'Should have actor overlap');
      assert.ok(result.score >= 0.7, `Expected good score with actor overlap, got ${result.score}`);
    });

    it('should handle Middle East markets', () => {
      const left = createGeopoliticsMarket('Gaza ceasefire deal by February 2026');
      const right = createGeopoliticsMarket('Hamas-Israel ceasefire agreement 2026');

      const result = pipeline.score(left, right);
      assert.ok(result !== null);
      assert.ok(result.score >= 0.5, `Expected decent score, got ${result.score}`);
    });
  });

  describe('shouldAutoConfirm', () => {
    it('should auto-confirm high score matches with actor overlap', () => {
      const left = createGeopoliticsMarket('Ukraine ceasefire with Putin and Zelensky meeting 2026');
      const right = createGeopoliticsMarket('Ukraine peace deal Putin Zelensky 2026');

      const scoreResult = pipeline.score(left, right);
      assert.ok(scoreResult !== null);

      if (scoreResult.score >= 0.90 && scoreResult.actorOverlap >= 1) {
        const result = pipeline.shouldAutoConfirm(left, right, scoreResult);
        assert.ok(result.shouldConfirm, 'Should auto-confirm with actor overlap');
        assert.ok(result.rule !== null);
      }
    });
  });

  describe('shouldAutoReject', () => {
    it('should auto-reject low score matches', () => {
      const left = createGeopoliticsMarket('Ukraine sanctions 2026');
      const right = createGeopoliticsMarket('Russia economy 2026');

      const scoreResult = pipeline.score(left, right);
      if (scoreResult && scoreResult.score < 0.55) {
        const result = pipeline.shouldAutoReject(left, right, scoreResult);
        assert.ok(result.shouldReject, 'Should auto-reject low score');
        assert.strictEqual(result.rule, 'LOW_SCORE');
      }
    });
  });
});

/**
 * Unit tests for MVE Detection (v3.0.14)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { detectMve, isMveMarket, type MveDetectionInput } from './mveDetection.js';

describe('detectMve', () => {
  describe('eventTicker detection', () => {
    it('detects MVE from KXMV eventTicker prefix', () => {
      const market: MveDetectionInput = {
        eventTicker: 'KXMV-25JAN23-LAL-BOS-SGP1',
        title: 'Lakers vs Celtics parlay',
      };

      const result = detectMve(market);
      assert.strictEqual(result.isMve, true);
      assert.strictEqual(result.source, 'event_ticker');
      assert.ok(result.reason?.includes('KXMV'));
    });

    it('does not flag non-KXMV eventTicker', () => {
      const market: MveDetectionInput = {
        eventTicker: 'KXNBA-25JAN23-LAL-BOS',
        title: 'Lakers at Celtics Winner',
      };

      const result = detectMve(market);
      assert.strictEqual(result.isMve, false);
    });
  });

  describe('seriesTicker detection', () => {
    it('detects MVE from KXMV seriesTicker in metadata', () => {
      const market: MveDetectionInput = {
        eventTicker: null,
        metadata: { seriesTicker: 'KXMV' },
        title: 'Some parlay market',
      };

      const result = detectMve(market);
      assert.strictEqual(result.isMve, true);
      assert.strictEqual(result.source, 'series_ticker');
    });
  });

  describe('API field detection', () => {
    it('respects is_multivariate=true', () => {
      const market: MveDetectionInput = {
        eventTicker: 'KXNBA-25JAN23-LAL-BOS',
        metadata: { is_multivariate: true },
        title: 'Lakers at Celtics',
      };

      const result = detectMve(market);
      assert.strictEqual(result.isMve, true);
      assert.strictEqual(result.source, 'api_field');
    });

    it('respects is_multivariate=false', () => {
      const market: MveDetectionInput = {
        eventTicker: null,
        metadata: { is_multivariate: false },
        title: 'yes Curry 3+, yes Lakers, yes Boston',
      };

      const result = detectMve(market);
      assert.strictEqual(result.isMve, false);
      assert.strictEqual(result.source, 'api_field');
    });
  });

  describe('title pattern detection', () => {
    it('detects "yes X, yes Y" pattern', () => {
      const market: MveDetectionInput = {
        eventTicker: null,
        metadata: null,
        title: 'yes Stephen Curry: 3+, yes Denver, yes Philadelphia',
      };

      const result = detectMve(market);
      assert.strictEqual(result.isMve, true);
      assert.strictEqual(result.source, 'title_pattern');
    });

    it('detects "Same Game Parlay" in title', () => {
      const market: MveDetectionInput = {
        eventTicker: null,
        metadata: null,
        title: 'NBA Same Game Parlay: Lakers vs Celtics',
      };

      const result = detectMve(market);
      assert.strictEqual(result.isMve, true);
      assert.strictEqual(result.source, 'title_pattern');
    });

    it('detects "SGP" abbreviation', () => {
      const market: MveDetectionInput = {
        eventTicker: null,
        metadata: null,
        title: 'NFL SGP: Chiefs at Bills',
      };

      const result = detectMve(market);
      assert.strictEqual(result.isMve, true);
      assert.strictEqual(result.source, 'title_pattern');
    });

    it('detects "parlay" keyword', () => {
      const market: MveDetectionInput = {
        eventTicker: null,
        metadata: null,
        title: 'NBA Parlay: Multiple legs combined',
      };

      const result = detectMve(market);
      assert.strictEqual(result.isMve, true);
      assert.strictEqual(result.source, 'title_pattern');
    });
  });

  describe('non-MVE markets', () => {
    it('correctly identifies simple game winner market', () => {
      const market: MveDetectionInput = {
        eventTicker: 'KXNBA-25JAN23-LAL-BOS',
        metadata: { seriesTicker: 'KXNBA' },
        title: 'Golden State at Minnesota Winner?',
      };

      const result = detectMve(market);
      assert.strictEqual(result.isMve, false);
      assert.strictEqual(result.source, 'unknown');
    });

    it('correctly identifies point spread market', () => {
      const market: MveDetectionInput = {
        eventTicker: 'KXNFL-25JAN23-KC-BUF',
        metadata: null,
        title: 'Chiefs -3.5 vs Bills',
      };

      const result = detectMve(market);
      assert.strictEqual(result.isMve, false);
    });
  });
});

describe('isMveMarket', () => {
  it('returns boolean true for MVE', () => {
    const market: MveDetectionInput = {
      eventTicker: 'KXMV-TEST',
      title: 'Test',
    };

    assert.strictEqual(isMveMarket(market), true);
  });

  it('returns boolean false for non-MVE', () => {
    const market: MveDetectionInput = {
      eventTicker: 'KXNBA-TEST',
      title: 'Lakers at Celtics',
    };

    assert.strictEqual(isMveMarket(market), false);
  });
});

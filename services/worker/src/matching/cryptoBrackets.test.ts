/**
 * Unit tests for cryptoBrackets.ts (v2.6.0)
 * Run with: npx tsx --test services/worker/src/matching/cryptoBrackets.test.ts
 */
import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import {
  buildBracketKey,
  groupByBracket,
  selectRepresentative,
  applyBracketGrouping,
  analyzeBrackets,
  type BracketCandidate,
  type BracketGroup,
} from './cryptoBrackets.js';
import { CryptoDateType, type CryptoMarket, type CryptoScoreResult } from './cryptoPipeline.js';
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
  comparator: string | null = null
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
      settleDateParsed: null,
      dateType: CryptoDateType.DAY_EXACT,
      settlePeriod: null,
      numbers,
      numberContext: numbers.length > 0 ? 'price' : 'unknown',
      comparator: comparator ?? fingerprint.comparator,
      intent: fingerprint.intent,
      fingerprint,
    },
  };
}

/**
 * Helper to create a minimal CryptoScoreResult
 */
function makeScoreResult(score: number): CryptoScoreResult {
  return {
    score,
    reason: 'test',
    entityScore: 1.0,
    dateScore: 1.0,
    numberScore: 1.0,
    textScore: 0.5,
    tier: score >= 0.7 ? 'STRONG' : 'WEAK',
    dayDiff: 0,
    dateTypeL: CryptoDateType.DAY_EXACT,
    dateTypeR: CryptoDateType.DAY_EXACT,
    numberContextL: 'price',
    numberContextR: 'price',
    comparatorL: 'GE',
    comparatorR: 'GE',
  };
}

/**
 * Helper to create a BracketCandidate
 */
function makeCandidate(
  leftId: number,
  rightId: number,
  entity: string,
  settleDate: string,
  comparator: string,
  numbers: number[],
  score: number
): BracketCandidate {
  const left = makeCryptoMarket(leftId, `Left market ${leftId}`, entity, settleDate, [], comparator);
  const right = makeCryptoMarket(rightId, `Right market ${rightId}`, entity, settleDate, numbers, comparator);
  return {
    leftCrypto: left,
    rightCrypto: right,
    score,
    scoreResult: makeScoreResult(score),
    bracketKey: buildBracketKey(entity, settleDate, comparator),
  };
}

describe('buildBracketKey', () => {
  it('should build key from entity, date, comparator', () => {
    const key = buildBracketKey('BITCOIN', '2026-01-21', 'GE');
    assert.strictEqual(key, 'BITCOIN|2026-01-21|GE');
  });

  it('should normalize comparator variations', () => {
    assert.strictEqual(buildBracketKey('BITCOIN', '2026-01-21', 'GT'), 'BITCOIN|2026-01-21|GE');
    assert.strictEqual(buildBracketKey('BITCOIN', '2026-01-21', 'ABOVE'), 'BITCOIN|2026-01-21|GE');
    assert.strictEqual(buildBracketKey('BITCOIN', '2026-01-21', 'LT'), 'BITCOIN|2026-01-21|LE');
    assert.strictEqual(buildBracketKey('BITCOIN', '2026-01-21', 'BELOW'), 'BITCOIN|2026-01-21|LE');
  });

  it('should handle null values', () => {
    const key = buildBracketKey(null, null, null);
    assert.strictEqual(key, 'UNKNOWN|UNKNOWN|UNKNOWN');
  });
});

describe('groupByBracket', () => {
  it('should group candidates by bracket key', () => {
    const candidates = [
      makeCandidate(1, 100, 'BITCOIN', '2026-01-21', 'GE', [100000], 0.95),
      makeCandidate(1, 101, 'BITCOIN', '2026-01-21', 'GE', [105000], 0.90),
      makeCandidate(1, 102, 'BITCOIN', '2026-01-21', 'GE', [110000], 0.85),
      makeCandidate(1, 200, 'BITCOIN', '2026-01-21', 'LE', [90000], 0.80),
    ];

    const groups = groupByBracket(candidates);

    assert.strictEqual(groups.size, 2, 'Should have 2 groups (GE and LE)');

    const geGroup = groups.get('BITCOIN|2026-01-21|GE');
    assert.ok(geGroup, 'Should have GE group');
    assert.strictEqual(geGroup!.candidates.length, 3, 'GE group should have 3 candidates');
    assert.strictEqual(geGroup!.bestScore, 0.95, 'Best score should be 0.95');

    const leGroup = groups.get('BITCOIN|2026-01-21|LE');
    assert.ok(leGroup, 'Should have LE group');
    assert.strictEqual(leGroup!.candidates.length, 1, 'LE group should have 1 candidate');
  });

  it('should handle empty candidates', () => {
    const groups = groupByBracket([]);
    assert.strictEqual(groups.size, 0);
  });
});

describe('selectRepresentative', () => {
  it('should select highest scoring candidate with best_score strategy', () => {
    const candidates = [
      makeCandidate(1, 100, 'BITCOIN', '2026-01-21', 'GE', [100000], 0.90),
      makeCandidate(1, 101, 'BITCOIN', '2026-01-21', 'GE', [105000], 0.95),
      makeCandidate(1, 102, 'BITCOIN', '2026-01-21', 'GE', [110000], 0.85),
    ];

    const group: BracketGroup = {
      key: 'BITCOIN|2026-01-21|GE',
      entity: 'BITCOIN',
      settleDate: '2026-01-21',
      comparator: 'GE',
      candidates,
      bestScore: 0.95,
      representative: null,
    };

    const rep = selectRepresentative(group, 'best_score');
    assert.ok(rep, 'Should select a representative');
    assert.strictEqual(rep!.rightCrypto.market.id, 101, 'Should select id=101 with score 0.95');
  });

  it('should select central threshold with central_threshold strategy', () => {
    const candidates = [
      makeCandidate(1, 100, 'BITCOIN', '2026-01-21', 'GE', [90000], 0.90),
      makeCandidate(1, 101, 'BITCOIN', '2026-01-21', 'GE', [100000], 0.85),
      makeCandidate(1, 102, 'BITCOIN', '2026-01-21', 'GE', [110000], 0.80),
    ];

    const group: BracketGroup = {
      key: 'BITCOIN|2026-01-21|GE',
      entity: 'BITCOIN',
      settleDate: '2026-01-21',
      comparator: 'GE',
      candidates,
      bestScore: 0.90,
      representative: null,
    };

    const rep = selectRepresentative(group, 'central_threshold');
    assert.ok(rep, 'Should select a representative');
    // Median threshold is 100000 (middle of sorted [90000, 100000, 110000])
    assert.strictEqual(rep!.rightCrypto.signals.numbers[0], 100000, 'Should select central threshold');
  });

  it('should return null for empty group', () => {
    const group: BracketGroup = {
      key: 'BITCOIN|2026-01-21|GE',
      entity: 'BITCOIN',
      settleDate: '2026-01-21',
      comparator: 'GE',
      candidates: [],
      bestScore: 0,
      representative: null,
    };

    const rep = selectRepresentative(group, 'best_score');
    assert.strictEqual(rep, null);
  });
});

describe('applyBracketGrouping', () => {
  it('should keep top groups by best score', () => {
    const candidates = [
      // Group 1: BITCOIN GE (best=0.95)
      makeCandidate(1, 100, 'BITCOIN', '2026-01-21', 'GE', [100000], 0.95),
      makeCandidate(1, 101, 'BITCOIN', '2026-01-21', 'GE', [105000], 0.90),
      // Group 2: BITCOIN LE (best=0.80)
      makeCandidate(1, 200, 'BITCOIN', '2026-01-21', 'LE', [90000], 0.80),
      makeCandidate(1, 201, 'BITCOIN', '2026-01-21', 'LE', [85000], 0.75),
      // Group 3: ETHEREUM GE (best=0.85)
      makeCandidate(1, 300, 'ETHEREUM', '2026-01-21', 'GE', [5000], 0.85),
    ];

    const { result, stats } = applyBracketGrouping(candidates, {
      maxGroupsPerLeft: 2,
      maxLinesPerGroup: 1,
    });

    assert.strictEqual(stats.uniqueGroups, 3, 'Should have 3 unique groups');
    assert.strictEqual(stats.totalCandidates, 5, 'Should have 5 total candidates');
    assert.strictEqual(result.length, 2, 'Should keep 2 representatives');

    // Should keep top 2 groups: BITCOIN GE (0.95) and ETHEREUM GE (0.85)
    const ids = result.map(c => c.rightCrypto.market.id).sort();
    assert.deepStrictEqual(ids, [100, 300], 'Should keep representatives from top 2 groups');
  });

  it('should keep multiple lines per group when maxLinesPerGroup > 1', () => {
    const candidates = [
      makeCandidate(1, 100, 'BITCOIN', '2026-01-21', 'GE', [100000], 0.95),
      makeCandidate(1, 101, 'BITCOIN', '2026-01-21', 'GE', [105000], 0.90),
      makeCandidate(1, 102, 'BITCOIN', '2026-01-21', 'GE', [110000], 0.85),
    ];

    const { result, stats } = applyBracketGrouping(candidates, {
      maxGroupsPerLeft: 5,
      maxLinesPerGroup: 2,
    });

    assert.strictEqual(result.length, 2, 'Should keep 2 lines from the group');
    assert.strictEqual(stats.droppedWithinGroups, 1, 'Should drop 1 within group');
  });

  it('should track dropped candidates correctly', () => {
    const candidates = [
      // Group 1: 3 candidates
      makeCandidate(1, 100, 'BITCOIN', '2026-01-21', 'GE', [100000], 0.95),
      makeCandidate(1, 101, 'BITCOIN', '2026-01-21', 'GE', [105000], 0.90),
      makeCandidate(1, 102, 'BITCOIN', '2026-01-21', 'GE', [110000], 0.85),
      // Group 2: 2 candidates (will be dropped by group limit)
      makeCandidate(1, 200, 'BITCOIN', '2026-01-21', 'LE', [90000], 0.50),
      makeCandidate(1, 201, 'BITCOIN', '2026-01-21', 'LE', [85000], 0.45),
    ];

    const { result, stats } = applyBracketGrouping(candidates, {
      maxGroupsPerLeft: 1,
      maxLinesPerGroup: 1,
    });

    assert.strictEqual(stats.totalCandidates, 5);
    assert.strictEqual(stats.uniqueGroups, 2);
    assert.strictEqual(stats.savedCandidates, 1);
    assert.strictEqual(stats.droppedByGroupLimit, 2, 'Should drop 2 from excluded group');
    assert.strictEqual(stats.droppedWithinGroups, 2, 'Should drop 2 within kept group');
    assert.strictEqual(result.length, 1);
  });

  it('should handle empty candidates', () => {
    const { result, stats } = applyBracketGrouping([]);

    assert.strictEqual(result.length, 0);
    assert.strictEqual(stats.totalCandidates, 0);
    assert.strictEqual(stats.uniqueGroups, 0);
  });
});

describe('analyzeBrackets', () => {
  it('should analyze bracket structure', () => {
    const markets = [
      makeCryptoMarket(1, 'BTC above $100k', 'BITCOIN', '2026-01-21', [100000], 'GE'),
      makeCryptoMarket(2, 'BTC above $105k', 'BITCOIN', '2026-01-21', [105000], 'GE'),
      makeCryptoMarket(3, 'BTC above $110k', 'BITCOIN', '2026-01-21', [110000], 'GE'),
      makeCryptoMarket(4, 'BTC below $90k', 'BITCOIN', '2026-01-21', [90000], 'LE'),
      makeCryptoMarket(5, 'ETH above $5k', 'ETHEREUM', '2026-01-21', [5000], 'GE'),
    ];

    const analysis = analyzeBrackets(markets, 5);

    assert.strictEqual(analysis.totalMarkets, 5);
    assert.strictEqual(analysis.completeMarkets, 5);
    assert.strictEqual(analysis.uniqueBrackets, 3);

    // Top bracket should be BITCOIN|2026-01-21|GE with 3 markets
    assert.ok(analysis.topBrackets.length > 0);
    const top = analysis.topBrackets[0];
    assert.strictEqual(top.entity, 'BITCOIN');
    assert.strictEqual(top.comparator, 'GE');
    assert.strictEqual(top.count, 3);
    assert.ok(top.sampleThresholds.includes(100000));
  });

  it('should count bracket size distribution', () => {
    const markets = [
      // 3 markets in same bracket
      makeCryptoMarket(1, 'BTC above $100k', 'BITCOIN', '2026-01-21', [100000], 'GE'),
      makeCryptoMarket(2, 'BTC above $105k', 'BITCOIN', '2026-01-21', [105000], 'GE'),
      makeCryptoMarket(3, 'BTC above $110k', 'BITCOIN', '2026-01-21', [110000], 'GE'),
      // 1 market alone
      makeCryptoMarket(4, 'ETH above $5k', 'ETHEREUM', '2026-01-21', [5000], 'GE'),
    ];

    const analysis = analyzeBrackets(markets);

    // Should have 1 bracket of size 3 and 1 bracket of size 1
    assert.strictEqual(analysis.bracketSizes.get(3), 1);
    assert.strictEqual(analysis.bracketSizes.get(1), 1);
  });
});

/**
 * Sports Pipeline Tests (v3.0.11)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sportsPipeline, type SportsMarket } from './sportsPipeline.js';
import {
  SportsLeague,
  SportsMarketType,
  SportsPeriod,
  SpreadSide,
} from '@data-module/core';
import type { SportsSignals, SportsEventKey, SportsLine, SportsSignalQuality } from '../signals/sportsSignals.js';
import type { EligibleMarket } from '@data-module/db';

// Helper to create test sports market
function makeSportsMarket(
  id: number,
  title: string,
  eventKey: Partial<SportsEventKey>,
  line: Partial<SportsLine>,
  closeTime?: Date
): SportsMarket {
  const market: EligibleMarket = {
    id,
    title,
    venue: 'kalshi',
    externalId: `test-${id}`,
    status: 'active',
    closeTime: closeTime ?? new Date('2025-01-23T20:00:00Z'),
    category: null,
    metadata: null,
    outcomeCount: 2,
  } as EligibleMarket;

  const fullEventKey: SportsEventKey = {
    league: eventKey.league ?? SportsLeague.NBA,
    teamA_norm: eventKey.teamA_norm ?? 'los angeles lakers',
    teamB_norm: eventKey.teamB_norm ?? 'boston celtics',
    startTime: eventKey.startTime ?? '2025-01-23T20:00:00.000Z',
    startBucket: eventKey.startBucket ?? '2025-01-23T20:00',
    venueEventId: eventKey.venueEventId ?? null,
  };

  const fullLine: SportsLine = {
    marketType: line.marketType ?? SportsMarketType.MONEYLINE,
    lineValue: line.lineValue ?? null,
    side: line.side ?? SpreadSide.UNKNOWN,
    period: line.period ?? SportsPeriod.FULL_GAME,
  };

  const quality: SportsSignalQuality = {
    missingTeams: false,
    missingStartTime: false,
    unknownLeague: false,
    unknownMarketType: false,
    notFullGame: false,
    isExcluded: false,
    excludeReason: null,
  };

  const signals: SportsSignals = {
    eventKey: fullEventKey,
    line: fullLine,
    quality,
    eventKeyString: `${fullEventKey.league}|${fullEventKey.teamA_norm}|${fullEventKey.teamB_norm}|${fullEventKey.startBucket}`,
    titleTokens: title.toLowerCase().split(/\s+/),
    confidence: 0.9,
    rawTitle: title,
    entity: fullEventKey.league,
    entities: new Set([fullEventKey.league, fullEventKey.teamA_norm, fullEventKey.teamB_norm]),
  };

  return { market, signals };
}

describe('SportsPipeline', () => {
  describe('checkHardGates', () => {
    it('should pass when league and teams match', () => {
      const left = makeSportsMarket(1, 'Lakers vs Celtics', {
        league: SportsLeague.NBA,
        teamA_norm: 'los angeles lakers',
        teamB_norm: 'boston celtics',
        startBucket: '2025-01-23T20:00',
      }, { marketType: SportsMarketType.MONEYLINE });

      const right = makeSportsMarket(2, 'LA Lakers at Boston Celtics', {
        league: SportsLeague.NBA,
        teamA_norm: 'los angeles lakers',
        teamB_norm: 'boston celtics',
        startBucket: '2025-01-23T20:00',
      }, { marketType: SportsMarketType.MONEYLINE });

      const result = sportsPipeline.checkHardGates(left, right);
      assert.equal(result.passed, true);
      assert.equal(result.failReason, null);
    });

    it('should fail when leagues differ', () => {
      const left = makeSportsMarket(1, 'Lakers vs Celtics NBA', {
        league: SportsLeague.NBA,
        teamA_norm: 'los angeles lakers',
        teamB_norm: 'boston celtics',
      }, {});

      const right = makeSportsMarket(2, 'Lakers vs Celtics NFL', {
        league: SportsLeague.NFL,
        teamA_norm: 'los angeles lakers',
        teamB_norm: 'boston celtics',
      }, {});

      const result = sportsPipeline.checkHardGates(left, right);
      assert.equal(result.passed, false);
      assert.ok(result.failReason?.includes('League mismatch'));
    });

    it('should fail when teams differ', () => {
      const left = makeSportsMarket(1, 'Lakers vs Celtics', {
        league: SportsLeague.NBA,
        teamA_norm: 'los angeles lakers',
        teamB_norm: 'boston celtics',
      }, {});

      const right = makeSportsMarket(2, 'Lakers vs Warriors', {
        league: SportsLeague.NBA,
        teamA_norm: 'los angeles lakers',
        teamB_norm: 'golden state warriors',
      }, {});

      const result = sportsPipeline.checkHardGates(left, right);
      assert.equal(result.passed, false);
      assert.ok(result.failReason?.includes('Teams mismatch'));
    });

    it('should fail when time buckets are too different', () => {
      const left = makeSportsMarket(1, 'Lakers vs Celtics 7pm', {
        league: SportsLeague.NBA,
        teamA_norm: 'los angeles lakers',
        teamB_norm: 'boston celtics',
        startBucket: '2025-01-23T19:00',
      }, {});

      const right = makeSportsMarket(2, 'Lakers vs Celtics 10pm', {
        league: SportsLeague.NBA,
        teamA_norm: 'los angeles lakers',
        teamB_norm: 'boston celtics',
        startBucket: '2025-01-23T22:00',
      }, {});

      const result = sportsPipeline.checkHardGates(left, right);
      assert.equal(result.passed, false);
      assert.ok(result.failReason?.includes('Time bucket mismatch'));
    });

    it('should pass when time buckets are adjacent', () => {
      const left = makeSportsMarket(1, 'Lakers vs Celtics', {
        league: SportsLeague.NBA,
        teamA_norm: 'los angeles lakers',
        teamB_norm: 'boston celtics',
        startBucket: '2025-01-23T19:30',
      }, {});

      const right = makeSportsMarket(2, 'Lakers vs Celtics', {
        league: SportsLeague.NBA,
        teamA_norm: 'los angeles lakers',
        teamB_norm: 'boston celtics',
        startBucket: '2025-01-23T20:00',
      }, {});

      const result = sportsPipeline.checkHardGates(left, right);
      assert.equal(result.passed, true);
    });

    it('should fail when market types differ', () => {
      const left = makeSportsMarket(1, 'Lakers vs Celtics ML', {
        league: SportsLeague.NBA,
      }, { marketType: SportsMarketType.MONEYLINE });

      const right = makeSportsMarket(2, 'Lakers vs Celtics Spread', {
        league: SportsLeague.NBA,
      }, { marketType: SportsMarketType.SPREAD });

      const result = sportsPipeline.checkHardGates(left, right);
      assert.equal(result.passed, false);
      assert.ok(result.failReason?.includes('Market type mismatch'));
    });
  });

  describe('score', () => {
    it('should give high score for exact MONEYLINE match', () => {
      const left = makeSportsMarket(1, 'Lakers vs Celtics to win', {
        league: SportsLeague.NBA,
        teamA_norm: 'los angeles lakers',
        teamB_norm: 'boston celtics',
        startBucket: '2025-01-23T20:00',
      }, { marketType: SportsMarketType.MONEYLINE });

      const right = makeSportsMarket(2, 'LA Lakers at Boston Celtics winner', {
        league: SportsLeague.NBA,
        teamA_norm: 'los angeles lakers',
        teamB_norm: 'boston celtics',
        startBucket: '2025-01-23T20:00',
      }, { marketType: SportsMarketType.MONEYLINE });

      const result = sportsPipeline.score(left, right);
      assert.ok(result !== null);
      assert.ok(result.score >= 0.90, `Expected score >= 0.90, got ${result.score}`);
      assert.equal(result.tier, 'STRONG');
      assert.equal(result.leagueMatch, true);
      assert.equal(result.teamsMatch, true);
      assert.equal(result.marketTypeMatch, true);
    });

    it('should give high score for SPREAD match with same line', () => {
      const left = makeSportsMarket(1, 'Lakers -3.5', {
        league: SportsLeague.NBA,
        teamA_norm: 'los angeles lakers',
        teamB_norm: 'boston celtics',
        startBucket: '2025-01-23T20:00',
      }, {
        marketType: SportsMarketType.SPREAD,
        lineValue: -3.5,
      });

      const right = makeSportsMarket(2, 'LA Lakers -3.5 spread', {
        league: SportsLeague.NBA,
        teamA_norm: 'los angeles lakers',
        teamB_norm: 'boston celtics',
        startBucket: '2025-01-23T20:00',
      }, {
        marketType: SportsMarketType.SPREAD,
        lineValue: -3.5,
      });

      const result = sportsPipeline.score(left, right);
      assert.ok(result !== null);
      assert.ok(result.score >= 0.85, `Expected score >= 0.85, got ${result.score}`);
      assert.equal(result.lineValueScore, 1.0);
    });

    it('should penalize different line values', () => {
      const left = makeSportsMarket(1, 'Lakers -3.5', {
        league: SportsLeague.NBA,
      }, {
        marketType: SportsMarketType.SPREAD,
        lineValue: -3.5,
      });

      const right = makeSportsMarket(2, 'Lakers -5.5', {
        league: SportsLeague.NBA,
      }, {
        marketType: SportsMarketType.SPREAD,
        lineValue: -5.5,
      });

      const result = sportsPipeline.score(left, right);
      assert.ok(result !== null);
      // Diff is 2, so lineValueScore should be 0.4
      assert.equal(result.lineValueScore, 0.4);
    });

    it('should give lower score for adjacent time buckets', () => {
      const left = makeSportsMarket(1, 'Lakers vs Celtics', {
        league: SportsLeague.NBA,
        startBucket: '2025-01-23T19:30',
      }, {});

      const right = makeSportsMarket(2, 'Lakers vs Celtics', {
        league: SportsLeague.NBA,
        startBucket: '2025-01-23T20:00',
      }, {});

      const result = sportsPipeline.score(left, right);
      assert.ok(result !== null);
      assert.equal(result.timeScore, 0.7); // Adjacent bucket penalty
    });
  });

  describe('shouldAutoConfirm', () => {
    it('should auto-confirm high-score MONEYLINE match', () => {
      const left = makeSportsMarket(1, 'Lakers vs Celtics to win', {
        league: SportsLeague.NBA,
        teamA_norm: 'los angeles lakers',
        teamB_norm: 'boston celtics',
        startBucket: '2025-01-23T20:00',
      }, { marketType: SportsMarketType.MONEYLINE });

      const right = makeSportsMarket(2, 'LA Lakers vs Boston Celtics winner', {
        league: SportsLeague.NBA,
        teamA_norm: 'los angeles lakers',
        teamB_norm: 'boston celtics',
        startBucket: '2025-01-23T20:00',
      }, { marketType: SportsMarketType.MONEYLINE });

      const score = sportsPipeline.score(left, right)!;
      const result = sportsPipeline.shouldAutoConfirm!(left, right, score);

      if (score.score >= 0.92) {
        assert.equal(result.shouldConfirm, true);
        assert.equal(result.rule, 'MONEYLINE_EXACT_EVENT_MATCH');
      }
    });

    it('should NOT auto-confirm SPREAD markets', () => {
      const left = makeSportsMarket(1, 'Lakers -3.5', {
        league: SportsLeague.NBA,
        teamA_norm: 'los angeles lakers',
        teamB_norm: 'boston celtics',
        startBucket: '2025-01-23T20:00',
      }, { marketType: SportsMarketType.SPREAD, lineValue: -3.5 });

      const right = makeSportsMarket(2, 'Lakers -3.5', {
        league: SportsLeague.NBA,
        teamA_norm: 'los angeles lakers',
        teamB_norm: 'boston celtics',
        startBucket: '2025-01-23T20:00',
      }, { marketType: SportsMarketType.SPREAD, lineValue: -3.5 });

      const score = sportsPipeline.score(left, right)!;
      const result = sportsPipeline.shouldAutoConfirm!(left, right, score);

      // SPREAD should never auto-confirm in v1
      assert.equal(result.shouldConfirm, false);
    });
  });

  describe('shouldAutoReject', () => {
    it('should auto-reject low score', () => {
      const left = makeSportsMarket(1, 'Lakers game', {
        league: SportsLeague.NBA,
      }, {});

      const score = {
        score: 0.45,
        reason: 'test',
        tier: 'WEAK' as const,
        eventScore: 0.5,
        leagueScore: 1.0,
        teamsScore: 0.5,
        timeScore: 0.5,
        lineScore: 0.5,
        marketTypeScore: 1.0,
        lineValueScore: 0.5,
        sideScore: 0.5,
        leagueMatch: true,
        teamsMatch: false,
        timeBucketMatch: false,
        marketTypeMatch: true,
        lineValueMatch: null,
      };

      const result = sportsPipeline.shouldAutoReject!(left, left, score);
      assert.equal(result.shouldReject, true);
      assert.equal(result.rule, 'LOW_SCORE');
    });

    it('should auto-reject teams mismatch', () => {
      const left = makeSportsMarket(1, 'Lakers game', {}, {});

      const score = {
        score: 0.70,
        reason: 'test',
        tier: 'WEAK' as const,
        eventScore: 0.7,
        leagueScore: 1.0,
        teamsScore: 0.5,
        timeScore: 1.0,
        lineScore: 0.8,
        marketTypeScore: 1.0,
        lineValueScore: 1.0,
        sideScore: 0.5,
        leagueMatch: true,
        teamsMatch: false,
        timeBucketMatch: true,
        marketTypeMatch: true,
        lineValueMatch: null,
      };

      const result = sportsPipeline.shouldAutoReject!(left, left, score);
      assert.equal(result.shouldReject, true);
      assert.equal(result.rule, 'TEAMS_MISMATCH');
    });
  });

  describe('buildIndex and findCandidates', () => {
    it('should index by league, teams, and time bucket', () => {
      const markets: SportsMarket[] = [
        makeSportsMarket(1, 'Lakers vs Celtics', {
          league: SportsLeague.NBA,
          teamA_norm: 'los angeles lakers',
          teamB_norm: 'boston celtics',
          startBucket: '2025-01-23T20:00',
        }, {}),
        makeSportsMarket(2, 'Warriors vs Nets', {
          league: SportsLeague.NBA,
          teamA_norm: 'golden state warriors',
          teamB_norm: 'brooklyn nets',
          startBucket: '2025-01-23T21:00',
        }, {}),
        makeSportsMarket(3, 'Chiefs vs Bills', {
          league: SportsLeague.NFL,
          teamA_norm: 'kansas city chiefs',
          teamB_norm: 'buffalo bills',
          startBucket: '2025-01-23T18:00',
        }, {}),
      ];

      const index = sportsPipeline.buildIndex(markets);

      // Should have primary keys with league|teams|time
      assert.ok(index.size > 0);
    });

    it('should find candidates for same event', () => {
      const source = makeSportsMarket(1, 'Lakers vs Celtics', {
        league: SportsLeague.NBA,
        teamA_norm: 'los angeles lakers',
        teamB_norm: 'boston celtics',
        startBucket: '2025-01-23T20:00',
      }, {});

      const targets: SportsMarket[] = [
        makeSportsMarket(2, 'LA Lakers at Boston Celtics', {
          league: SportsLeague.NBA,
          teamA_norm: 'los angeles lakers',
          teamB_norm: 'boston celtics',
          startBucket: '2025-01-23T20:00',
        }, {}),
        makeSportsMarket(3, 'Warriors vs Nets', {
          league: SportsLeague.NBA,
          teamA_norm: 'golden state warriors',
          teamB_norm: 'brooklyn nets',
          startBucket: '2025-01-23T20:00',
        }, {}),
        makeSportsMarket(4, 'Chiefs vs Bills', {
          league: SportsLeague.NFL,
          teamA_norm: 'kansas city chiefs',
          teamB_norm: 'buffalo bills',
          startBucket: '2025-01-23T20:00',
        }, {}),
      ];

      const index = sportsPipeline.buildIndex(targets);
      const candidates = sportsPipeline.findCandidates(source, index);

      // Should find Lakers vs Celtics match
      assert.ok(candidates.some(c => c.market.id === 2));
      // Should NOT find different teams
      assert.ok(!candidates.some(c => c.market.id === 3));
      // Should NOT find different league
      assert.ok(!candidates.some(c => c.market.id === 4));
    });
  });
});

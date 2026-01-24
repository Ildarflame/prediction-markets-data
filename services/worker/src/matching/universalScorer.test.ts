/**
 * Universal Scorer Tests (v3.0.27)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  scoreUniversal,
  extractMarketEntities,
  quickMatchCheck,
  DEFAULT_WEIGHTS,
  SCORE_THRESHOLDS,
  type EligibleMarketWithTopic,
} from './universalScorer.js';

// Helper to create mock market
function createMockMarket(
  id: number,
  title: string,
  options: {
    venue?: 'kalshi' | 'polymarket';
    closeTime?: Date;
    derivedTopic?: string;
  } = {}
): EligibleMarketWithTopic {
  const venue = options.venue || 'polymarket';
  return {
    id,
    venue,
    title,
    status: 'active',
    closeTime: options.closeTime || new Date('2026-01-31T00:00:00Z'),
    category: null,
    derivedTopic: options.derivedTopic || null,
  } as EligibleMarketWithTopic;
}

describe('Universal Scorer', () => {
  describe('scoreUniversal', () => {
    test('perfect match - same teams, number, date', () => {
      const left = extractMarketEntities(
        createMockMarket(1, 'Vitality vs Falcons - CS2 - Jan 31, 2026', {
          venue: 'polymarket',
          closeTime: new Date('2026-01-31T12:00:00Z'),
        })
      );

      const right = extractMarketEntities(
        createMockMarket(2, 'Team Vitality vs Team Falcons CS2 January 31 2026', {
          venue: 'kalshi',
          closeTime: new Date('2026-01-31T14:00:00Z'),
        })
      );

      const result = scoreUniversal(left, right);

      // v3.0.17 weights: entity=0.45, event=0.15, number=0.15, time=0.10, text=0.10
      // Teams match gives good entity score, time proximity ~0.95, no event detected
      assert.ok(result.score >= 0.60, `Expected good score, got ${result.score}`);
      assert.ok(result.matchedEntities.length >= 2, 'Should have matched teams');
      assert.ok(result.overlapDetails.teams >= 2, 'Should have 2 team matches');
    });

    test('crypto markets - same org, price, date', () => {
      const left = extractMarketEntities(
        createMockMarket(1, 'Bitcoin above $100k on Jan 31, 2026', {
          venue: 'polymarket',
          closeTime: new Date('2026-01-31T00:00:00Z'),
        })
      );

      const right = extractMarketEntities(
        createMockMarket(2, 'Will BTC be over $100,000 by January 31, 2026?', {
          venue: 'kalshi',
          closeTime: new Date('2026-01-31T00:00:00Z'),
        })
      );

      const result = scoreUniversal(left, right);

      // v3.0.17: With event weight (0.15) taking from other components
      assert.ok(result.score >= 0.65, `Expected good score, got ${result.score}`);
      assert.ok(result.overlapDetails.organizations >= 1, 'Should match BITCOIN org');
      assert.ok(result.overlapDetails.numbers >= 1, 'Should match 100k number');
      assert.ok(result.overlapDetails.dates >= 1, 'Should match Jan 31 date');
    });

    test('politician markets - same people', () => {
      const left = extractMarketEntities(
        createMockMarket(1, 'Will Trump win the 2026 election?', {
          venue: 'polymarket',
          closeTime: new Date('2026-11-05T00:00:00Z'),
        })
      );

      const right = extractMarketEntities(
        createMockMarket(2, 'Donald Trump to win 2026 presidential race', {
          venue: 'kalshi',
          closeTime: new Date('2026-11-05T00:00:00Z'),
        })
      );

      const result = scoreUniversal(left, right);

      // v3.0.17: Person match + time match, no event detected
      assert.ok(result.score >= 0.60, `Expected good score, got ${result.score}`);
      assert.ok(result.overlapDetails.people >= 1, 'Should match Trump');
    });

    test('no match - different entities', () => {
      const left = extractMarketEntities(
        createMockMarket(1, 'Lakers vs Celtics NBA Finals', {
          venue: 'polymarket',
          closeTime: new Date('2026-06-01T00:00:00Z'),
        })
      );

      const right = extractMarketEntities(
        createMockMarket(2, 'Manchester United vs Liverpool EPL', {
          venue: 'kalshi',
          closeTime: new Date('2026-06-01T00:00:00Z'),
        })
      );

      const result = scoreUniversal(left, right);

      assert.ok(result.score < 0.50, `Expected low score, got ${result.score}`);
      assert.strictEqual(result.matchedEntities.length, 0);
    });

    test('partial match - same org, different numbers', () => {
      const left = extractMarketEntities(
        createMockMarket(1, 'Bitcoin above $100k by Jan 2026', {
          venue: 'polymarket',
        })
      );

      const right = extractMarketEntities(
        createMockMarket(2, 'Will BTC reach $150k by January 2026?', {
          venue: 'kalshi',
        })
      );

      const result = scoreUniversal(left, right);

      // Should have org match but not number match
      assert.ok(result.overlapDetails.organizations >= 1, 'Should match BITCOIN org');
      assert.strictEqual(result.overlapDetails.numbers, 0, 'Should NOT match numbers (100k vs 150k)');
    });

    test('time proximity affects score', () => {
      const baseMarket = createMockMarket(1, 'Bitcoin above $100k', {
        venue: 'polymarket',
        closeTime: new Date('2026-01-31T12:00:00Z'),
      });

      // Close time - same day
      const closeTime = extractMarketEntities(
        createMockMarket(2, 'BTC over $100,000', {
          venue: 'kalshi',
          closeTime: new Date('2026-01-31T14:00:00Z'),
        })
      );

      // Far time - 1 month later
      const farTime = extractMarketEntities(
        createMockMarket(3, 'BTC over $100,000', {
          venue: 'kalshi',
          closeTime: new Date('2026-02-28T12:00:00Z'),
        })
      );

      const left = extractMarketEntities(baseMarket);

      const closeScore = scoreUniversal(left, closeTime);
      const farScore = scoreUniversal(left, farTime);

      assert.ok(
        closeScore.breakdown.timeProximity > farScore.breakdown.timeProximity,
        'Close time should score higher'
      );
    });

    test('category boost for same topic', () => {
      const left = extractMarketEntities(
        createMockMarket(1, 'Bitcoin above $100k', {
          venue: 'polymarket',
          derivedTopic: 'CRYPTO_DAILY',
        })
      );

      const rightSameTopic = extractMarketEntities(
        createMockMarket(2, 'BTC over $100,000', {
          venue: 'kalshi',
          derivedTopic: 'CRYPTO_DAILY',
        })
      );

      const rightDiffTopic = extractMarketEntities(
        createMockMarket(3, 'BTC over $100,000', {
          venue: 'kalshi',
          derivedTopic: 'ELECTIONS',
        })
      );

      const sameTopicScore = scoreUniversal(left, rightSameTopic);
      const diffTopicScore = scoreUniversal(left, rightDiffTopic);

      assert.strictEqual(sameTopicScore.breakdown.categoryBoost, 1.0);
      assert.strictEqual(diffTopicScore.breakdown.categoryBoost, 0);
    });

    // v3.0.17: Event matching tests
    test('event match boosts score for same tournament', () => {
      const left = extractMarketEntities(
        createMockMarket(1, 'Will Vitality win IEM Krakow 2026?', {
          venue: 'polymarket',
          closeTime: new Date('2026-02-15T00:00:00Z'),
        })
      );

      const rightSameEvent = extractMarketEntities(
        createMockMarket(2, 'Vitality to win IEM Krakow 2026', {
          venue: 'kalshi',
          closeTime: new Date('2026-02-15T12:00:00Z'),
        })
      );

      const rightDiffEvent = extractMarketEntities(
        createMockMarket(3, 'Vitality to win BLAST Premier 2026', {
          venue: 'kalshi',
          closeTime: new Date('2026-02-15T12:00:00Z'),
        })
      );

      const sameEventScore = scoreUniversal(left, rightSameEvent);
      const diffEventScore = scoreUniversal(left, rightDiffEvent);

      // Same event should have higher eventMatch score
      assert.ok(
        sameEventScore.breakdown.eventMatch > diffEventScore.breakdown.eventMatch,
        `Same event should score higher: ${sameEventScore.breakdown.eventMatch} > ${diffEventScore.breakdown.eventMatch}`
      );

      // Same event should have eventMatch = 1.0
      assert.strictEqual(sameEventScore.breakdown.eventMatch, 1.0);

      // Overall score should be higher for same event
      assert.ok(
        sameEventScore.score > diffEventScore.score,
        `Same event overall score should be higher: ${sameEventScore.score} > ${diffEventScore.score}`
      );
    });

    test('event match partial for same tournament base', () => {
      const left = extractMarketEntities(
        createMockMarket(1, 'Will Team Spirit win BLAST Premier Spring 2026?', {
          venue: 'polymarket',
          closeTime: new Date('2026-03-01T00:00:00Z'),
        })
      );

      const rightPartialEvent = extractMarketEntities(
        createMockMarket(2, 'Team Spirit to win BLAST Premier Fall 2026', {
          venue: 'kalshi',
          closeTime: new Date('2026-09-01T00:00:00Z'),
        })
      );

      const result = scoreUniversal(left, rightPartialEvent);

      // Should have partial event match (0.7) - same tournament base, different stage
      assert.ok(
        result.breakdown.eventMatch >= 0.5,
        `Partial event match expected >= 0.5, got ${result.breakdown.eventMatch}`
      );
    });

    // v3.0.18: Two-team matchup tests
    test('matchup detection - exact match (both teams)', () => {
      const left = extractMarketEntities(
        createMockMarket(1, 'Vitality vs Falcons - CS2 Match', {
          venue: 'polymarket',
          closeTime: new Date('2026-02-15T12:00:00Z'),
        })
      );

      const right = extractMarketEntities(
        createMockMarket(2, 'Team Falcons vs Team Vitality CS2', {
          venue: 'kalshi',
          closeTime: new Date('2026-02-15T14:00:00Z'),
        })
      );

      const result = scoreUniversal(left, right);

      // Both teams match (order doesn't matter) - should get matchup bonus
      assert.strictEqual(result.breakdown.matchupMatch, 1.0, 'Both teams should match');
      assert.ok(result.reason.includes('Matchup:'), 'Reason should include matchup');
    });

    test('matchup detection - partial match (one team only)', () => {
      const left = extractMarketEntities(
        createMockMarket(1, 'Vitality vs Falcons', {
          venue: 'polymarket',
          closeTime: new Date('2026-02-15T12:00:00Z'),
        })
      );

      const right = extractMarketEntities(
        createMockMarket(2, 'Vitality vs Spirit', {
          venue: 'kalshi',
          closeTime: new Date('2026-02-15T14:00:00Z'),
        })
      );

      const result = scoreUniversal(left, right);

      // Only one team matches - should get partial/low matchup score
      assert.ok(
        result.breakdown.matchupMatch <= 0.5,
        `One team match should score low: ${result.breakdown.matchupMatch}`
      );
    });

    test('matchup bonus increases overall score', () => {
      const left = extractMarketEntities(
        createMockMarket(1, 'NaVi vs G2 - IEM Cologne', {
          venue: 'polymarket',
          closeTime: new Date('2026-02-15T12:00:00Z'),
        })
      );

      const rightExactMatchup = extractMarketEntities(
        createMockMarket(2, 'G2 vs NaVi - IEM Cologne 2026', {
          venue: 'kalshi',
          closeTime: new Date('2026-02-15T14:00:00Z'),
        })
      );

      const rightDiffMatchup = extractMarketEntities(
        createMockMarket(3, 'NaVi vs Liquid - IEM Cologne', {
          venue: 'kalshi',
          closeTime: new Date('2026-02-15T14:00:00Z'),
        })
      );

      const exactScore = scoreUniversal(left, rightExactMatchup);
      const diffScore = scoreUniversal(left, rightDiffMatchup);

      // Exact matchup should score significantly higher
      assert.ok(
        exactScore.score > diffScore.score,
        `Exact matchup (${exactScore.score}) should score higher than partial (${diffScore.score})`
      );
    });

    test('reason string includes matched entities', () => {
      const left = extractMarketEntities(
        createMockMarket(1, 'Vitality vs Falcons CS2', { venue: 'polymarket' })
      );

      const right = extractMarketEntities(
        createMockMarket(2, 'Team Vitality vs Team Falcons', { venue: 'kalshi' })
      );

      const result = scoreUniversal(left, right);

      assert.ok(result.reason.includes('Teams:'), 'Reason should mention teams');
      assert.ok(
        result.reason.includes('TEAM_VITALITY') || result.reason.includes('Vitality'),
        'Reason should include team name'
      );
    });

    // v3.0.23: Multi-entity bonus test
    test('multi-entity bonus increases score for multiple matches', () => {
      // Market with 2 teams - should get multi-entity bonus
      const left2Teams = extractMarketEntities(
        createMockMarket(1, 'Vitality vs Falcons CS2', {
          venue: 'polymarket',
          closeTime: new Date('2026-02-15T12:00:00Z'),
        })
      );

      const right2Teams = extractMarketEntities(
        createMockMarket(2, 'Team Vitality vs Team Falcons', {
          venue: 'kalshi',
          closeTime: new Date('2026-02-15T14:00:00Z'),
        })
      );

      // Market with 1 team only (different market context to avoid matchup detection)
      const left1Team = extractMarketEntities(
        createMockMarket(3, 'Will Vitality win the CS2 tournament?', {
          venue: 'polymarket',
          closeTime: new Date('2026-02-15T12:00:00Z'),
        })
      );

      const right1Team = extractMarketEntities(
        createMockMarket(4, 'Vitality to win tournament', {
          venue: 'kalshi',
          closeTime: new Date('2026-02-15T14:00:00Z'),
        })
      );

      const score2Teams = scoreUniversal(left2Teams, right2Teams);
      const score1Team = scoreUniversal(left1Team, right1Team);

      // Verify 2 teams were detected in first pair
      assert.ok(
        score2Teams.overlapDetails.teams >= 2,
        `Should have 2+ team matches, got ${score2Teams.overlapDetails.teams}`
      );

      // Verify 1 team in second pair
      assert.ok(
        score1Team.overlapDetails.teams >= 1,
        `Should have 1+ team match, got ${score1Team.overlapDetails.teams}`
      );

      // 2 team matches should score higher overall due to:
      // - multi-entity bonus (2 entities = +0.10)
      // - same-category bonus (2 teams = +0.05)
      // - matchup bonus (both teams detected)
      assert.ok(
        score2Teams.score > score1Team.score,
        `2 teams (${score2Teams.score.toFixed(3)}) should score higher than 1 team (${score1Team.score.toFixed(3)})`
      );

      // The 2-team market should have more matched entities
      assert.ok(
        score2Teams.matchedEntities.length > score1Team.matchedEntities.length,
        `2 teams (${score2Teams.matchedEntities.length} entities) > 1 team (${score1Team.matchedEntities.length} entities)`
      );
    });

    test('comparator match penalizes ABOVE vs BELOW conflicts', () => {
      // Same asset but opposite directions - should NOT match!
      const leftAbove = extractMarketEntities(
        createMockMarket(1, 'Bitcoin above $100k by March 2026?', {
          venue: 'polymarket',
          closeTime: new Date('2026-03-31T00:00:00Z'),
        })
      );

      const rightBelow = extractMarketEntities(
        createMockMarket(2, 'Will Bitcoin fall below $100k in March 2026?', {
          venue: 'kalshi',
          closeTime: new Date('2026-03-31T00:00:00Z'),
        })
      );

      // Same direction - should match
      const rightAbove = extractMarketEntities(
        createMockMarket(3, 'BTC to exceed $100k by end of March 2026', {
          venue: 'kalshi',
          closeTime: new Date('2026-03-31T00:00:00Z'),
        })
      );

      const scoreConflict = scoreUniversal(leftAbove, rightBelow);
      const scoreMatch = scoreUniversal(leftAbove, rightAbove);

      // ABOVE vs BELOW should get 0 comparator score → final score = 0
      assert.ok(
        scoreConflict.breakdown.comparatorMatch === 0,
        `ABOVE vs BELOW should have comparatorMatch=0, got ${scoreConflict.breakdown.comparatorMatch}`
      );
      assert.ok(
        scoreConflict.score === 0,
        `ABOVE vs BELOW conflict should have score=0, got ${scoreConflict.score}`
      );

      // Same direction should have higher comparator score
      assert.ok(
        scoreMatch.breakdown.comparatorMatch > 0,
        `Same direction should have comparatorMatch > 0, got ${scoreMatch.breakdown.comparatorMatch}`
      );
      assert.ok(
        scoreMatch.score > scoreConflict.score,
        `Same direction (${scoreMatch.score.toFixed(3)}) should score higher than conflict (${scoreConflict.score.toFixed(3)})`
      );
    });

    test('smart number matching - price context bonus', () => {
      // Two markets with same price target - should get bonus for price match
      const leftPrice = extractMarketEntities(
        createMockMarket(1, 'Bitcoin to reach $100,000 by end of 2026', {
          venue: 'polymarket',
          closeTime: new Date('2026-12-31T00:00:00Z'),
        })
      );

      const rightPrice = extractMarketEntities(
        createMockMarket(2, 'Will BTC hit $100k before 2027?', {
          venue: 'kalshi',
          closeTime: new Date('2026-12-31T00:00:00Z'),
        })
      );

      // Markets with same number but no price context
      const leftNoContext = extractMarketEntities(
        createMockMarket(3, 'Will there be 100000 attendees at the event?', {
          venue: 'polymarket',
          closeTime: new Date('2026-06-15T00:00:00Z'),
        })
      );

      const rightNoContext = extractMarketEntities(
        createMockMarket(4, 'Event attendance to exceed 100k people', {
          venue: 'kalshi',
          closeTime: new Date('2026-06-15T00:00:00Z'),
        })
      );

      const scorePrice = scoreUniversal(leftPrice, rightPrice);
      const scoreNoContext = scoreUniversal(leftNoContext, rightNoContext);

      // Price match should score higher on numberMatch due to price context bonus
      assert.ok(
        scorePrice.breakdown.numberMatch >= 0.5,
        `Price match should have high numberMatch, got ${scorePrice.breakdown.numberMatch}`
      );

      // Both should have positive number match
      assert.ok(
        scoreNoContext.breakdown.numberMatch >= 0.3,
        `Non-price match should still have positive numberMatch, got ${scoreNoContext.breakdown.numberMatch}`
      );
    });
  });

  describe('quickMatchCheck', () => {
    test('returns true for entity overlap', () => {
      const left = extractMarketEntities(
        createMockMarket(1, 'Vitality vs NaVi', { venue: 'polymarket' })
      );

      const right = extractMarketEntities(
        createMockMarket(2, 'Team Vitality game', { venue: 'kalshi' })
      );

      assert.strictEqual(quickMatchCheck(left, right), true);
    });

    test('returns true for high token overlap', () => {
      const left = extractMarketEntities(
        createMockMarket(1, 'Will the unemployment rate increase in Q1?', {
          venue: 'polymarket',
        })
      );

      const right = extractMarketEntities(
        createMockMarket(2, 'Unemployment rate to increase Q1 2026', {
          venue: 'kalshi',
        })
      );

      assert.strictEqual(quickMatchCheck(left, right), true);
    });

    test('returns true for close time proximity', () => {
      const left = extractMarketEntities(
        createMockMarket(1, 'Some market A', {
          venue: 'polymarket',
          closeTime: new Date('2026-01-31T12:00:00Z'),
        })
      );

      const right = extractMarketEntities(
        createMockMarket(2, 'Different market B', {
          venue: 'kalshi',
          closeTime: new Date('2026-01-31T14:00:00Z'),
        })
      );

      assert.strictEqual(quickMatchCheck(left, right), true);
    });

    test('returns false for no overlap', () => {
      const left = extractMarketEntities(
        createMockMarket(1, 'Lakers NBA championship', {
          venue: 'polymarket',
          closeTime: new Date('2026-06-01T00:00:00Z'),
        })
      );

      const right = extractMarketEntities(
        createMockMarket(2, 'Manchester United Premier League', {
          venue: 'kalshi',
          closeTime: new Date('2026-12-01T00:00:00Z'),
        })
      );

      assert.strictEqual(quickMatchCheck(left, right), false);
    });
  });

  describe('extractMarketEntities', () => {
    test('extracts teams from esports title', () => {
      const market = createMockMarket(1, 'Vitality vs Falcons - CS2 Major');
      const result = extractMarketEntities(market);

      assert.ok(result.entities.teams.includes('TEAM_VITALITY'));
      assert.ok(result.entities.teams.includes('TEAM_FALCONS'));
      assert.strictEqual(result.entities.gameType, 'CS2');
    });

    test('extracts people from election title', () => {
      // Use explicit election keyword for gameType detection
      const market = createMockMarket(1, 'Will Biden win the 2026 presidential election against Trump?');
      const result = extractMarketEntities(market);

      assert.ok(result.entities.people.includes('JOE_BIDEN'));
      assert.ok(result.entities.people.includes('DONALD_TRUMP'));
      assert.strictEqual(result.entities.gameType, 'ELECTION');
    });

    test('extracts numbers from crypto title', () => {
      const market = createMockMarket(1, 'Bitcoin above $100k by end of January');
      const result = extractMarketEntities(market);

      assert.ok(result.entities.organizations.includes('BITCOIN'));
      assert.ok(result.entities.numbers.length > 0);
      assert.strictEqual(result.entities.numbers[0].value, 100000);
      assert.strictEqual(result.entities.numbers[0].unit, 'USD');
    });

    test('extracts dates from title', () => {
      const market = createMockMarket(1, 'Event on January 31, 2026');
      const result = extractMarketEntities(market);

      assert.ok(result.entities.dates.length > 0);
      const date = result.entities.dates[0];
      assert.strictEqual(date.year, 2026);
      assert.strictEqual(date.month, 1);
      assert.strictEqual(date.day, 31);
    });
  });

  describe('scoring thresholds', () => {
    test('DEFAULT_WEIGHTS base components sum to 1.0', () => {
      // v3.0.18: eventMatch and matchupBonus are BONUSES, not part of base 1.0
      const baseSum =
        DEFAULT_WEIGHTS.entityOverlap +
        DEFAULT_WEIGHTS.numberMatch +
        DEFAULT_WEIGHTS.timeProximity +
        DEFAULT_WEIGHTS.textSimilarity +
        DEFAULT_WEIGHTS.categoryBoost;

      assert.strictEqual(baseSum, 1.0, 'Base weights should sum to 1.0');
      assert.ok(DEFAULT_WEIGHTS.eventMatch > 0, 'Event bonus should be positive');
      assert.ok(DEFAULT_WEIGHTS.matchupBonus > 0, 'Matchup bonus should be positive');
    });

    test('SCORE_THRESHOLDS are in correct order', () => {
      assert.ok(SCORE_THRESHOLDS.AUTO_CONFIRM > SCORE_THRESHOLDS.HIGH_CONFIDENCE);
      assert.ok(SCORE_THRESHOLDS.HIGH_CONFIDENCE > SCORE_THRESHOLDS.MEDIUM_CONFIDENCE);
      assert.ok(SCORE_THRESHOLDS.STRONG < SCORE_THRESHOLDS.AUTO_CONFIRM);
    });
  });
});

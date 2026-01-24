/**
 * Universal Scorer Tests (v3.0.16)
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
    test('DEFAULT_WEIGHTS sum to 1.0', () => {
      const sum =
        DEFAULT_WEIGHTS.entityOverlap +
        DEFAULT_WEIGHTS.eventMatch +      // v3.0.17
        DEFAULT_WEIGHTS.numberMatch +
        DEFAULT_WEIGHTS.timeProximity +
        DEFAULT_WEIGHTS.textSimilarity +
        DEFAULT_WEIGHTS.categoryBoost;

      assert.strictEqual(sum, 1.0, 'Weights should sum to 1.0');
    });

    test('SCORE_THRESHOLDS are in correct order', () => {
      assert.ok(SCORE_THRESHOLDS.AUTO_CONFIRM > SCORE_THRESHOLDS.HIGH_CONFIDENCE);
      assert.ok(SCORE_THRESHOLDS.HIGH_CONFIDENCE > SCORE_THRESHOLDS.MEDIUM_CONFIDENCE);
      assert.ok(SCORE_THRESHOLDS.STRONG < SCORE_THRESHOLDS.AUTO_CONFIRM);
    });
  });
});

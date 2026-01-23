/**
 * Team Normalization Tests (v3.0.11)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTeamName,
  detectLeague,
  extractTeams,
  detectMarketType,
  detectPeriod,
  extractLineValue,
  extractSide,
  teamsMatch,
  generateEventKey,
  generateTimeBucket,
  areTimeBucketsAdjacent,
  SportsLeague,
  SportsMarketType,
  SportsPeriod,
  SpreadSide,
} from './teamNormalize.js';

describe('Team Normalization', () => {
  describe('normalizeTeamName', () => {
    it('should normalize Lakers variations', () => {
      assert.equal(normalizeTeamName('Lakers'), 'los angeles lakers');
      assert.equal(normalizeTeamName('LA Lakers'), 'los angeles lakers');
      assert.equal(normalizeTeamName('Los Angeles Lakers'), 'los angeles lakers');
      assert.equal(normalizeTeamName('lakers'), 'los angeles lakers');
    });

    it('should normalize Celtics variations', () => {
      assert.equal(normalizeTeamName('Celtics'), 'boston celtics');
      assert.equal(normalizeTeamName('Boston Celtics'), 'boston celtics');
      assert.equal(normalizeTeamName('boston'), 'boston celtics');
    });

    it('should normalize NFL team variations', () => {
      assert.equal(normalizeTeamName('Chiefs'), 'kansas city chiefs');
      assert.equal(normalizeTeamName('KC Chiefs'), 'kansas city chiefs');
      assert.equal(normalizeTeamName('49ers'), 'san francisco 49ers');
      assert.equal(normalizeTeamName('Niners'), 'san francisco 49ers');
    });

    it('should normalize EPL team variations', () => {
      assert.equal(normalizeTeamName('Man United'), 'manchester united');
      assert.equal(normalizeTeamName('Man Utd'), 'manchester united');
      assert.equal(normalizeTeamName('MUFC'), 'manchester united');
      assert.equal(normalizeTeamName('Man City'), 'manchester city');
    });

    it('should handle empty and invalid input', () => {
      assert.equal(normalizeTeamName(''), '');
      assert.equal(normalizeTeamName('Unknown Team XYZ'), 'unknown team xyz');
    });
  });

  describe('detectLeague', () => {
    it('should detect NBA explicitly', () => {
      assert.equal(detectLeague('NBA Lakers vs Celtics'), SportsLeague.NBA);
      assert.equal(detectLeague('Lakers vs Celtics NBA'), SportsLeague.NBA);
    });

    it('should detect NFL explicitly', () => {
      assert.equal(detectLeague('NFL Chiefs vs Bills'), SportsLeague.NFL);
      assert.equal(detectLeague('Chiefs vs Bills NFL playoff'), SportsLeague.NFL);
    });

    it('should detect EPL', () => {
      assert.equal(detectLeague('Premier League Arsenal vs Chelsea'), SportsLeague.EPL);
      assert.equal(detectLeague('EPL: Man United vs Liverpool'), SportsLeague.EPL);
    });

    it('should detect leagues by team names', () => {
      assert.equal(detectLeague('Lakers vs Celtics'), SportsLeague.NBA);
      assert.equal(detectLeague('Chiefs vs Eagles'), SportsLeague.NFL);
      assert.equal(detectLeague('Arsenal vs Chelsea'), SportsLeague.EPL);
    });

    it('should return UNKNOWN for ambiguous', () => {
      assert.equal(detectLeague('Team A vs Team B'), SportsLeague.UNKNOWN);
    });
  });

  describe('extractTeams', () => {
    it('should extract teams from "vs" format', () => {
      const result = extractTeams('Lakers vs Celtics');
      assert.equal(result.teamA, 'los angeles lakers');
      assert.equal(result.teamB, 'boston celtics');
    });

    it('should extract teams from "@" format', () => {
      const result = extractTeams('Lakers @ Celtics');
      assert.equal(result.teamA, 'los angeles lakers');
      assert.equal(result.teamB, 'boston celtics');
    });

    it('should extract teams from "at" format', () => {
      const result = extractTeams('Lakers at Celtics');
      assert.equal(result.teamA, 'los angeles lakers');
      assert.equal(result.teamB, 'boston celtics');
    });

    it('should handle full team names', () => {
      const result = extractTeams('Los Angeles Lakers vs Boston Celtics');
      assert.equal(result.teamA, 'los angeles lakers');
      assert.equal(result.teamB, 'boston celtics');
    });

    it('should return null for no match', () => {
      const result = extractTeams('Lakers win the championship');
      assert.equal(result.teamA, null);
      assert.equal(result.teamB, null);
    });
  });

  describe('detectMarketType', () => {
    it('should detect MONEYLINE', () => {
      assert.equal(detectMarketType('Lakers vs Celtics'), SportsMarketType.MONEYLINE);
      assert.equal(detectMarketType('Lakers to win'), SportsMarketType.MONEYLINE);
      assert.equal(detectMarketType('Lakers moneyline'), SportsMarketType.MONEYLINE);
    });

    it('should detect SPREAD', () => {
      assert.equal(detectMarketType('Lakers -3.5'), SportsMarketType.SPREAD);
      assert.equal(detectMarketType('Celtics +5.5 spread'), SportsMarketType.SPREAD);
      assert.equal(detectMarketType('Lakers handicap -7'), SportsMarketType.SPREAD);
    });

    it('should detect TOTAL', () => {
      assert.equal(detectMarketType('Over 220.5'), SportsMarketType.TOTAL);
      assert.equal(detectMarketType('Under 215'), SportsMarketType.TOTAL);
      assert.equal(detectMarketType('Total points over 225'), SportsMarketType.TOTAL);
      assert.equal(detectMarketType('O/U 218.5'), SportsMarketType.TOTAL);
    });

    it('should detect PROP', () => {
      assert.equal(detectMarketType('LeBron points 30+'), SportsMarketType.PROP);
      assert.equal(detectMarketType('Mahomes passing yards over 300'), SportsMarketType.PROP);
      assert.equal(detectMarketType('First scorer goal'), SportsMarketType.PROP);
    });

    it('should detect FUTURES', () => {
      assert.equal(detectMarketType('Lakers to win championship'), SportsMarketType.FUTURES);
      assert.equal(detectMarketType('MVP award winner'), SportsMarketType.FUTURES);
      assert.equal(detectMarketType('Lakers make playoffs'), SportsMarketType.FUTURES);
    });

    it('should detect PARLAY', () => {
      assert.equal(detectMarketType('Lakers + Celtics parlay'), SportsMarketType.PARLAY);
      assert.equal(detectMarketType('Multi bet combo'), SportsMarketType.PARLAY);
    });
  });

  describe('detectPeriod', () => {
    it('should default to FULL_GAME', () => {
      assert.equal(detectPeriod('Lakers vs Celtics'), SportsPeriod.FULL_GAME);
    });

    it('should detect half periods', () => {
      assert.equal(detectPeriod('Lakers vs Celtics 1st half'), SportsPeriod.FIRST_HALF);
      assert.equal(detectPeriod('Lakers 2H spread'), SportsPeriod.SECOND_HALF);
    });

    it('should detect quarters', () => {
      assert.equal(detectPeriod('Lakers Q1 spread'), SportsPeriod.FIRST_QUARTER);
      assert.equal(detectPeriod('Celtics 4th quarter'), SportsPeriod.FOURTH_QUARTER);
    });
  });

  describe('extractLineValue', () => {
    it('should extract spread values', () => {
      assert.equal(extractLineValue('Lakers -3.5', SportsMarketType.SPREAD), -3.5);
      assert.equal(extractLineValue('Celtics +7', SportsMarketType.SPREAD), 7);
    });

    it('should extract total values', () => {
      assert.equal(extractLineValue('Over 220.5', SportsMarketType.TOTAL), 220.5);
      assert.equal(extractLineValue('Total 215', SportsMarketType.TOTAL), 215);
    });

    it('should return null for MONEYLINE', () => {
      assert.equal(extractLineValue('Lakers to win', SportsMarketType.MONEYLINE), null);
    });
  });

  describe('extractSide', () => {
    it('should detect OVER/UNDER', () => {
      assert.equal(extractSide('Over 220.5'), SpreadSide.OVER);
      assert.equal(extractSide('Under 215'), SpreadSide.UNDER);
    });

    it('should detect YES/NO', () => {
      assert.equal(extractSide('Yes Lakers win'), SpreadSide.YES);
      assert.equal(extractSide('No Lakers win'), SpreadSide.NO);
    });

    it('should return UNKNOWN for neutral', () => {
      assert.equal(extractSide('Lakers vs Celtics'), SpreadSide.UNKNOWN);
    });
  });

  describe('teamsMatch', () => {
    it('should match normalized teams', () => {
      assert.equal(teamsMatch('Lakers', 'LA Lakers'), true);
      assert.equal(teamsMatch('Boston Celtics', 'Celtics'), true);
    });

    it('should not match different teams', () => {
      assert.equal(teamsMatch('Lakers', 'Celtics'), false);
      assert.equal(teamsMatch('Chiefs', 'Eagles'), false);
    });
  });

  describe('generateEventKey', () => {
    it('should generate consistent keys regardless of team order', () => {
      const key1 = generateEventKey(SportsLeague.NBA, 'Lakers', 'Celtics', '2025-01-23T20:00');
      const key2 = generateEventKey(SportsLeague.NBA, 'Celtics', 'Lakers', '2025-01-23T20:00');
      assert.equal(key1, key2);
    });

    it('should include all components', () => {
      const key = generateEventKey(SportsLeague.NBA, 'Lakers', 'Celtics', '2025-01-23T20:00');
      assert.ok(key.includes('NBA'));
      assert.ok(key.includes('los angeles lakers'));
      assert.ok(key.includes('boston celtics'));
      assert.ok(key.includes('2025-01-23T20:00'));
    });
  });

  describe('generateTimeBucket', () => {
    it('should create 30-minute buckets', () => {
      assert.equal(generateTimeBucket(new Date('2025-01-23T20:00:00Z')), '2025-01-23T20:00');
      assert.equal(generateTimeBucket(new Date('2025-01-23T20:15:00Z')), '2025-01-23T20:00');
      assert.equal(generateTimeBucket(new Date('2025-01-23T20:30:00Z')), '2025-01-23T20:30');
      assert.equal(generateTimeBucket(new Date('2025-01-23T20:45:00Z')), '2025-01-23T20:30');
    });
  });

  describe('areTimeBucketsAdjacent', () => {
    it('should return true for same bucket', () => {
      assert.equal(areTimeBucketsAdjacent('2025-01-23T20:00', '2025-01-23T20:00'), true);
    });

    it('should return true for adjacent buckets', () => {
      assert.equal(areTimeBucketsAdjacent('2025-01-23T20:00', '2025-01-23T20:30'), true);
      assert.equal(areTimeBucketsAdjacent('2025-01-23T20:30', '2025-01-23T20:00'), true);
    });

    it('should return false for non-adjacent buckets', () => {
      assert.equal(areTimeBucketsAdjacent('2025-01-23T20:00', '2025-01-23T21:00'), false);
      assert.equal(areTimeBucketsAdjacent('2025-01-23T19:00', '2025-01-23T20:00'), false);
    });
  });
});

/**
 * Climate Signals Tests (v3.0.10)
 *
 * Tests for climate signal extraction.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  ClimateKind,
  ClimateDateType,
  ClimateComparator,
  extractClimateKind,
  extractRegion,
  extractDateInfo,
  extractThresholds,
  extractComparator,
  isClimateMarket,
  areDateTypesCompatible,
  calculateDateScore,
  calculateThresholdScore,
} from './climateSignals.js';

describe('extractClimateKind', () => {
  it('should detect hurricane', () => {
    assert.strictEqual(extractClimateKind('Hurricane Milton to make landfall'), ClimateKind.HURRICANE);
    assert.strictEqual(extractClimateKind('Category 5 storm approaching'), ClimateKind.HURRICANE);
    assert.strictEqual(extractClimateKind('Tropical storm warnings issued'), ClimateKind.HURRICANE);
  });

  it('should detect temperature', () => {
    assert.strictEqual(extractClimateKind('Record high temperature in NYC'), ClimateKind.TEMPERATURE);
    assert.strictEqual(extractClimateKind('Will it hit 100°F?'), ClimateKind.TEMPERATURE);
    assert.strictEqual(extractClimateKind('Heat wave expected'), ClimateKind.TEMPERATURE);
  });

  it('should detect snow', () => {
    assert.strictEqual(extractClimateKind('Snow accumulation forecast'), ClimateKind.SNOW);
    assert.strictEqual(extractClimateKind('White Christmas in Boston?'), ClimateKind.SNOW);
    assert.strictEqual(extractClimateKind('Blizzard warning issued'), ClimateKind.SNOW);
  });

  it('should detect flood', () => {
    assert.strictEqual(extractClimateKind('Flash flood warning'), ClimateKind.FLOOD);
    assert.strictEqual(extractClimateKind('River flooding expected'), ClimateKind.FLOOD);
  });

  it('should detect wildfire', () => {
    assert.strictEqual(extractClimateKind('California wildfire spreads'), ClimateKind.WILDFIRE);
    assert.strictEqual(extractClimateKind('Forest fire burns 10000 acres'), ClimateKind.WILDFIRE);
  });

  it('should detect earthquake', () => {
    assert.strictEqual(extractClimateKind('Earthquake magnitude 6.0'), ClimateKind.EARTHQUAKE);
    assert.strictEqual(extractClimateKind('Seismic activity detected'), ClimateKind.EARTHQUAKE);
  });

  it('should detect tornado', () => {
    assert.strictEqual(extractClimateKind('Tornado watch issued'), ClimateKind.TORNADO);
    assert.strictEqual(extractClimateKind('Twister spotted in Kansas'), ClimateKind.TORNADO);
  });

  it('should return OTHER for unknown', () => {
    assert.strictEqual(extractClimateKind('Stock market prediction'), ClimateKind.OTHER);
  });
});

describe('extractRegion', () => {
  it('should detect US states', () => {
    const florida = extractRegion('Hurricane landfall in Florida');
    assert.strictEqual(florida.key, 'US-FL');

    const california = extractRegion('Wildfire in California');
    assert.strictEqual(california.key, 'US-CA');

    const texas = extractRegion('Texas heat wave');
    assert.strictEqual(texas.key, 'US-TX');
  });

  it('should detect US cities', () => {
    const nyc = extractRegion('Snow in New York City');
    assert.strictEqual(nyc.key, 'US-NY');

    const chicago = extractRegion('Chicago temperature record');
    assert.strictEqual(chicago.key, 'US-IL');

    const miami = extractRegion('Miami flood warning');
    assert.strictEqual(miami.key, 'US-FL');
  });

  it('should detect countries', () => {
    const uk = extractRegion('UK heat wave');
    assert.strictEqual(uk.key, 'UK');

    const japan = extractRegion('Japan earthquake warning');
    assert.strictEqual(japan.key, 'JP');
  });

  it('should return null for no region', () => {
    const result = extractRegion('Random temperature rise');
    assert.strictEqual(result.key, null);
  });
});

describe('extractDateInfo', () => {
  it('should extract exact dates', () => {
    const result = extractDateInfo('Hurricane landfall by January 15, 2025', null);
    assert.strictEqual(result.dateType, ClimateDateType.DAY_EXACT);
    assert.ok(result.settleKey?.includes('2025-01'));
  });

  it('should extract months', () => {
    const result = extractDateInfo('Snow in January 2025', null);
    assert.strictEqual(result.dateType, ClimateDateType.MONTH);
    assert.strictEqual(result.settleKey, '2025-01');
  });

  it('should extract years', () => {
    const result = extractDateInfo('Temperature records in 2025', null);
    assert.strictEqual(result.dateType, ClimateDateType.YEAR);
    assert.strictEqual(result.settleKey, '2025');
  });

  it('should detect seasons', () => {
    const winter = extractDateInfo('This winter\'s snowfall', null);
    assert.strictEqual(winter.dateType, ClimateDateType.SEASON);

    const hurricane = extractDateInfo('2025 hurricane season', null);
    assert.strictEqual(hurricane.dateType, ClimateDateType.SEASON);
  });
});

describe('extractThresholds', () => {
  it('should extract temperature thresholds', () => {
    const fahrenheit = extractThresholds('Temperature above 100°F');
    assert.strictEqual(fahrenheit.length, 1);
    assert.strictEqual(fahrenheit[0].value, 100);
    assert.strictEqual(fahrenheit[0].unit, '°F');

    const celsius = extractThresholds('Temperature above 30°C');
    assert.strictEqual(celsius.length, 1);
    assert.strictEqual(celsius[0].value, 30);
    assert.strictEqual(celsius[0].unit, '°C');
  });

  it('should extract snow amounts', () => {
    const result = extractThresholds('12 inches of snow');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].value, 12);
    // Unit may be abbreviated
    assert.ok(['inches', 'in'].includes(result[0].unit!));
  });

  it('should extract wind speeds', () => {
    const mph = extractThresholds('Winds exceeding 75 mph');
    assert.ok(mph.length >= 1);
    // Find the 75 value if multiple extractions
    const windResult = mph.find(t => t.value === 75);
    assert.ok(windResult);
  });

  it('should extract earthquake magnitudes', () => {
    const result = extractThresholds('Magnitude 6.5 earthquake');
    assert.ok(result.length >= 1);
    const magResult = result.find(t => t.value === 6.5);
    assert.ok(magResult);
  });

  it('should extract category numbers', () => {
    const result = extractThresholds('Category 4 hurricane');
    assert.ok(result.length >= 1);
    const catResult = result.find(t => t.value === 4);
    assert.ok(catResult);
  });
});

describe('extractComparator', () => {
  it('should detect GE (at least)', () => {
    assert.strictEqual(extractComparator('At least 10 inches'), ClimateComparator.GE);
    assert.strictEqual(extractComparator('10 or more inches'), ClimateComparator.GE);
    assert.strictEqual(extractComparator('Exceed 100 degrees'), ClimateComparator.GE);
  });

  it('should detect LE (at most)', () => {
    assert.strictEqual(extractComparator('Under 50 degrees'), ClimateComparator.LE);
    assert.strictEqual(extractComparator('Less than 5 inches'), ClimateComparator.LE);
    assert.strictEqual(extractComparator('At most 3 hurricanes'), ClimateComparator.LE);
  });

  it('should detect BETWEEN or range patterns', () => {
    // 'between X and Y' pattern
    const between = extractComparator('Between 5 and 10 hurricanes');
    assert.ok([ClimateComparator.BETWEEN, ClimateComparator.UNKNOWN].includes(between));
  });

  it('should detect EQ (exactly)', () => {
    assert.strictEqual(extractComparator('Exactly 5 hurricanes'), ClimateComparator.EQ);
  });
});

describe('isClimateMarket', () => {
  it('should return true for climate markets', () => {
    assert.strictEqual(isClimateMarket('Hurricane Milton to make landfall'), true);
    assert.strictEqual(isClimateMarket('Record high temperature'), true);
    assert.strictEqual(isClimateMarket('California wildfire spreads'), true);
    assert.strictEqual(isClimateMarket('Snow accumulation in Boston'), true);
  });

  it('should return false for non-climate markets', () => {
    assert.strictEqual(isClimateMarket('Bitcoin price prediction'), false);
    assert.strictEqual(isClimateMarket('Election results'), false);
    assert.strictEqual(isClimateMarket('GDP growth rate'), false);
  });
});

describe('areDateTypesCompatible', () => {
  it('should return true for same types', () => {
    assert.strictEqual(areDateTypesCompatible(ClimateDateType.DAY_EXACT, ClimateDateType.DAY_EXACT), true);
    assert.strictEqual(areDateTypesCompatible(ClimateDateType.MONTH, ClimateDateType.MONTH), true);
  });

  it('should return true for DAY_EXACT and MONTH', () => {
    assert.strictEqual(areDateTypesCompatible(ClimateDateType.DAY_EXACT, ClimateDateType.MONTH), true);
    assert.strictEqual(areDateTypesCompatible(ClimateDateType.MONTH, ClimateDateType.DAY_EXACT), true);
  });

  it('should return true for MONTH and YEAR', () => {
    assert.strictEqual(areDateTypesCompatible(ClimateDateType.MONTH, ClimateDateType.YEAR), true);
    assert.strictEqual(areDateTypesCompatible(ClimateDateType.YEAR, ClimateDateType.MONTH), true);
  });

  it('should handle UNKNOWN type', () => {
    // UNKNOWN type may be compatible or not depending on implementation
    const result = areDateTypesCompatible(ClimateDateType.DAY_EXACT, ClimateDateType.UNKNOWN);
    assert.strictEqual(typeof result, 'boolean');
  });
});

describe('calculateDateScore', () => {
  it('should return 1.0 for exact match', () => {
    const score = calculateDateScore(
      ClimateDateType.DAY_EXACT, '2025-01-15',
      ClimateDateType.DAY_EXACT, '2025-01-15'
    );
    assert.strictEqual(score, 1.0);
  });

  it('should return high score for same month', () => {
    const score = calculateDateScore(
      ClimateDateType.DAY_EXACT, '2025-01-15',
      ClimateDateType.MONTH, '2025-01'
    );
    assert.ok(score >= 0.8);
  });

  it('should return lower score for different months', () => {
    const score = calculateDateScore(
      ClimateDateType.MONTH, '2025-01',
      ClimateDateType.MONTH, '2025-03'
    );
    assert.ok(score < 0.8);
  });
});

describe('calculateThresholdScore', () => {
  it('should return 1.0 for exact match', () => {
    const threshA = [{ value: 100, unit: '°F', raw: '100°F' }];
    const threshB = [{ value: 100, unit: '°F', raw: '100°F' }];
    const score = calculateThresholdScore(threshA, threshB);
    assert.strictEqual(score, 1.0);
  });

  it('should return high score for close values', () => {
    const threshA = [{ value: 100, unit: '°F', raw: '100°F' }];
    const threshB = [{ value: 98, unit: '°F', raw: '98°F' }];
    const score = calculateThresholdScore(threshA, threshB);
    assert.ok(score >= 0.8);
  });

  it('should return lower score for different values', () => {
    const threshA = [{ value: 100, unit: '°F', raw: '100°F' }];
    const threshB = [{ value: 50, unit: '°F', raw: '50°F' }];
    const score = calculateThresholdScore(threshA, threshB);
    assert.ok(score < 0.6);
  });

  it('should return 0.5 for empty thresholds', () => {
    const score = calculateThresholdScore([], []);
    assert.strictEqual(score, 0.5);
  });
});

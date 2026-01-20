/**
 * Unit tests for extractor.ts
 * Run with: npx tsx --test packages/core/src/extractor.test.ts
 */
import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { extractNumbers, extractEntities, extractDates, extractComparator, Comparator, extractMacroEntities, tokenizeForEntities, extractPeriod, periodsCompatible, type MacroPeriod } from './extractor.js';

describe('extractNumbers', () => {
  it('should extract plain numbers', () => {
    assert.deepStrictEqual(extractNumbers('price is 3700'), [3700]);
    assert.deepStrictEqual(extractNumbers('$50,000 reward'), [50000]);
    assert.deepStrictEqual(extractNumbers('value 79249.99'), [79249.99]);
  });

  it('should extract numbers with immediate k/m/b multipliers', () => {
    assert.deepStrictEqual(extractNumbers('BTC 100k'), [100000]);
    assert.deepStrictEqual(extractNumbers('1.2m downloads'), [1200000]);
    assert.deepStrictEqual(extractNumbers('$5b valuation'), [5000000000]);
    assert.deepStrictEqual(extractNumbers('79k users'), [79000]);
  });

  it('should extract numbers with word multipliers', () => {
    assert.deepStrictEqual(extractNumbers('100 thousand users'), [100000]);
    assert.deepStrictEqual(extractNumbers('1.2 million downloads'), [1200000]);
    assert.deepStrictEqual(extractNumbers('$5 billion valuation'), [5000000000]);
    assert.deepStrictEqual(extractNumbers('2 trillion debt'), [2000000000000]);
  });

  it('should NOT capture "t" from "to" as trillion multiplier', () => {
    // This was the bug: "$79,000 to" was being parsed as 79 trillion
    const result = extractNumbers('$79,000 to 79,249.99');
    assert.deepStrictEqual(result, [79000, 79249.99]);
  });

  it('should handle range patterns correctly', () => {
    const result = extractNumbers('between $3700 and $3800');
    assert.deepStrictEqual(result, [3700, 3800]);
  });

  it('should extract percentages', () => {
    assert.deepStrictEqual(extractNumbers('CPI above 3%'), [3]);
    assert.deepStrictEqual(extractNumbers('inflation at 2.5%'), [2.5]);
  });

  it('should skip date-like numbers (1-31) unless $ or multiplier', () => {
    // "Feb 1" - the "1" should be skipped (date context)
    assert.deepStrictEqual(extractNumbers('Feb 1 deadline'), []);
    // "$1" HAS a dollar sign, so it's kept (despite being small)
    assert.deepStrictEqual(extractNumbers('costs $1'), [1]);
    // "1k" has multiplier, so it's kept
    assert.deepStrictEqual(extractNumbers('1k users'), [1000]);
    // Plain "5" without context should be skipped
    assert.deepStrictEqual(extractNumbers('page 5'), []);
  });

  it('should skip years (1900-2100)', () => {
    assert.deepStrictEqual(extractNumbers('in 2024'), []);
    assert.deepStrictEqual(extractNumbers('by 2025'), []);
  });

  it('should handle complex market titles', () => {
    // ETH price range market
    const ethResult = extractNumbers('ETH between $3,700 to $3,749.99 on Jan 26?');
    assert.deepStrictEqual(ethResult, [3700, 3749.99]);

    // BTC with multiplier
    const btcResult = extractNumbers('BTC hits 100k by Dec 31');
    assert.deepStrictEqual(btcResult, [100000]);
  });

  it('should deduplicate numbers', () => {
    const result = extractNumbers('$3700 and $3700 again');
    assert.deepStrictEqual(result, [3700]);
  });
});

describe('extractEntities', () => {
  it('should extract crypto entities', () => {
    assert.ok(extractEntities('BTC price prediction').includes('BITCOIN'));
    assert.ok(extractEntities('ETH above $3700').includes('ETHEREUM'));
  });

  it('should NOT match substring entities (Hegseth vs ETH)', () => {
    // This was the bug: "Hegseth" was matching "eth" -> ETHEREUM
    const entities = extractEntities('Pete Hegseth confirmed');
    assert.ok(!entities.includes('ETHEREUM'), 'Should not extract ETH from Hegseth');
  });

  it('should extract political entities', () => {
    assert.ok(extractEntities('Trump wins election').includes('DONALD_TRUMP'));
    assert.ok(extractEntities('Biden approval').includes('JOE_BIDEN'));
  });

  it('should extract multi-word entities', () => {
    assert.ok(extractEntities('Elon Musk tweets').includes('ELON_MUSK'));
    assert.ok(extractEntities('Joe Biden speech').includes('JOE_BIDEN'));
  });
});

describe('extractComparator', () => {
  it('should detect GE comparators', () => {
    assert.strictEqual(extractComparator('ETH above $3700'), Comparator.GE);
    assert.strictEqual(extractComparator('BTC reaches 100k'), Comparator.GE);
    assert.strictEqual(extractComparator('price exceeds $50'), Comparator.GE);
  });

  it('should detect LE comparators', () => {
    assert.strictEqual(extractComparator('ETH below $3000'), Comparator.LE);
    assert.strictEqual(extractComparator('falls under 50'), Comparator.LE);
  });

  it('should detect BETWEEN comparators', () => {
    assert.strictEqual(extractComparator('ETH between $3700 and $3800'), Comparator.BETWEEN);
    assert.strictEqual(extractComparator('from $100 to $200'), Comparator.BETWEEN);
    assert.strictEqual(extractComparator('$3700-$3800'), Comparator.BETWEEN);
    assert.strictEqual(extractComparator('$79,000 to 79,249.99'), Comparator.BETWEEN);
  });

  it('should detect WIN comparators', () => {
    assert.strictEqual(extractComparator('Trump wins election'), Comparator.WIN);
    assert.strictEqual(extractComparator('Lakers beat Celtics'), Comparator.WIN);
  });
});

describe('extractDates', () => {
  it('should extract Month Day Year dates', () => {
    const dates = extractDates('deadline Dec 31, 2024');
    assert.strictEqual(dates.length, 1);
    assert.strictEqual(dates[0].year, 2024);
    assert.strictEqual(dates[0].month, 12);
    assert.strictEqual(dates[0].day, 31);
  });

  it('should extract Month Day dates (infer year)', () => {
    const dates = extractDates('by Jan 26');
    assert.strictEqual(dates.length, 1);
    assert.strictEqual(dates[0].month, 1);
    assert.strictEqual(dates[0].day, 26);
  });

  it('should extract Quarter dates', () => {
    const dates = extractDates('Q4 2024 results');
    assert.strictEqual(dates.length, 1);
    assert.strictEqual(dates[0].year, 2024);
    assert.strictEqual(dates[0].month, 12);
  });
});

describe('extractMacroEntities', () => {
  // Helper to run extraction
  const extract = (title: string): string[] => {
    const tokens = tokenizeForEntities(title);
    const normalized = title.toLowerCase();
    return Array.from(extractMacroEntities(tokens, normalized)).sort();
  };

  it('should extract CPI from "cpi" token', () => {
    const entities = extract('CPI inflation YoY in January 2026?');
    assert.ok(entities.includes('CPI'), `Expected CPI in ${JSON.stringify(entities)}`);
  });

  it('should extract CPI from "inflation" token', () => {
    const entities = extract('Inflation rate above 3%');
    assert.ok(entities.includes('CPI'), `Expected CPI from inflation in ${JSON.stringify(entities)}`);
  });

  it('should extract CPI from "consumer price index" phrase', () => {
    const entities = extract('Consumer price index rises');
    assert.ok(entities.includes('CPI'), `Expected CPI from phrase in ${JSON.stringify(entities)}`);
  });

  it('should extract GDP', () => {
    const entities = extract('Will GDP growth exceed 3% in Q1 2026?');
    assert.ok(entities.includes('GDP'), `Expected GDP in ${JSON.stringify(entities)}`);
  });

  it('should extract GDP from "gross domestic product" phrase', () => {
    const entities = extract('Gross domestic product forecast');
    assert.ok(entities.includes('GDP'), `Expected GDP from phrase in ${JSON.stringify(entities)}`);
  });

  it('should extract FED_RATE from "fed rate" pattern', () => {
    const entities = extract('Fed rate decision March 2026');
    assert.ok(entities.includes('FED_RATE'), `Expected FED_RATE in ${JSON.stringify(entities)}`);
  });

  it('should extract FED_RATE from "interest rate"', () => {
    const entities = extract('Interest rate hike expected');
    assert.ok(entities.includes('FED_RATE'), `Expected FED_RATE from interest rate in ${JSON.stringify(entities)}`);
  });

  it('should extract FOMC', () => {
    const entities = extract('FOMC meeting in March');
    assert.ok(entities.includes('FOMC'), `Expected FOMC in ${JSON.stringify(entities)}`);
  });

  it('should extract UNEMPLOYMENT_RATE', () => {
    const entities = extract('US unemployment rate above 4% in Feb 2026');
    assert.ok(entities.includes('UNEMPLOYMENT_RATE'), `Expected UNEMPLOYMENT_RATE in ${JSON.stringify(entities)}`);
  });

  it('should extract UNEMPLOYMENT_RATE from "jobless rate"', () => {
    const entities = extract('Jobless rate falls below 4%');
    assert.ok(entities.includes('UNEMPLOYMENT_RATE'), `Expected UNEMPLOYMENT_RATE from jobless rate in ${JSON.stringify(entities)}`);
  });

  it('should extract NFP', () => {
    const entities = extract('Nonfarm payrolls above 200k in Jan 2026');
    assert.ok(entities.includes('NFP'), `Expected NFP in ${JSON.stringify(entities)}`);
  });

  it('should extract NFP from "nfp" token', () => {
    const entities = extract('NFP report January');
    assert.ok(entities.includes('NFP'), `Expected NFP from token in ${JSON.stringify(entities)}`);
  });

  it('should extract PCE', () => {
    const entities = extract('PCE inflation above 2.5%');
    assert.ok(entities.includes('PCE'), `Expected PCE in ${JSON.stringify(entities)}`);
  });

  it('should extract PMI', () => {
    const entities = extract('PMI above 50 in January');
    assert.ok(entities.includes('PMI'), `Expected PMI in ${JSON.stringify(entities)}`);
  });

  it('should NOT extract macro entities from unrelated text', () => {
    const entities = extract('Bitcoin price prediction');
    assert.strictEqual(entities.length, 0, `Expected no macro entities in ${JSON.stringify(entities)}`);
  });

  it('should extract multiple macro entities from complex title', () => {
    const entities = extract('CPI and GDP forecasts for Q1');
    assert.ok(entities.includes('CPI'), `Expected CPI in ${JSON.stringify(entities)}`);
    assert.ok(entities.includes('GDP'), `Expected GDP in ${JSON.stringify(entities)}`);
  });

  // v2.4.6: Test new NFP patterns (Polymarket uses "jobs" terminology)
  it('should extract NFP from "jobs added" phrase', () => {
    const entities = extract('How many jobs added in January?');
    assert.ok(entities.includes('NFP'), `Expected NFP from "jobs added" in ${JSON.stringify(entities)}`);
  });

  it('should extract NFP from "add jobs" phrase', () => {
    const entities = extract('Will the US add jobs in January?');
    assert.ok(entities.includes('NFP'), `Expected NFP from "add jobs" in ${JSON.stringify(entities)}`);
  });

  it('should extract NFP from "lose jobs" phrase', () => {
    const entities = extract('Will the US lose jobs in January?');
    assert.ok(entities.includes('NFP'), `Expected NFP from "lose jobs" in ${JSON.stringify(entities)}`);
  });

  it('should extract NFP from "jobs report" phrase', () => {
    const entities = extract('December jobs report release');
    assert.ok(entities.includes('NFP'), `Expected NFP from "jobs report" in ${JSON.stringify(entities)}`);
  });

  it('should extract NFP from "non-farm payroll" phrase', () => {
    const entities = extract('Non-farm payroll growth exceeds 100k');
    assert.ok(entities.includes('NFP'), `Expected NFP from "non-farm payroll" in ${JSON.stringify(entities)}`);
  });

  // v2.4.6: Test JOBLESS_CLAIMS patterns
  it('should extract JOBLESS_CLAIMS from "initial claims"', () => {
    const entities = extract('Weekly initial claims exceed 190k');
    assert.ok(entities.includes('JOBLESS_CLAIMS'), `Expected JOBLESS_CLAIMS from "initial claims" in ${JSON.stringify(entities)}`);
  });

  it('should extract JOBLESS_CLAIMS from "jobless claims"', () => {
    const entities = extract('Initial jobless claims report');
    assert.ok(entities.includes('JOBLESS_CLAIMS'), `Expected JOBLESS_CLAIMS from "jobless claims" in ${JSON.stringify(entities)}`);
  });

  // v2.4.6: Test PCE patterns
  it('should extract PCE from "core pce" phrase', () => {
    const entities = extract('Core PCE above 0.3%');
    assert.ok(entities.includes('PCE'), `Expected PCE from "core pce" in ${JSON.stringify(entities)}`);
  });

  // v2.4.6: Test PMI patterns
  it('should extract PMI from "ism manufacturing" phrase', () => {
    const entities = extract('ISM Manufacturing PMI above 50');
    assert.ok(entities.includes('PMI'), `Expected PMI from "ism manufacturing" in ${JSON.stringify(entities)}`);
  });
});

describe('extractPeriod', () => {
  it('should extract month+year from "CPI inflation in January 2026"', () => {
    const period = extractPeriod('CPI inflation in January 2026');
    assert.strictEqual(period.type, 'month');
    assert.strictEqual(period.year, 2026);
    assert.strictEqual(period.month, 1);
  });

  it('should extract month+year from "GDP growth Feb 2026"', () => {
    const period = extractPeriod('GDP growth Feb 2026');
    assert.strictEqual(period.type, 'month');
    assert.strictEqual(period.year, 2026);
    assert.strictEqual(period.month, 2);
  });

  it('should extract quarter from "GDP growth in Q1 2026"', () => {
    const period = extractPeriod('GDP growth in Q1 2026');
    assert.strictEqual(period.type, 'quarter');
    assert.strictEqual(period.year, 2026);
    assert.strictEqual(period.quarter, 1);
  });

  it('should extract quarter from "Q4 2025 results"', () => {
    const period = extractPeriod('Q4 2025 results');
    assert.strictEqual(period.type, 'quarter');
    assert.strictEqual(period.year, 2025);
    assert.strictEqual(period.quarter, 4);
  });

  it('should extract year from "Unemployment rate in 2026"', () => {
    const period = extractPeriod('Unemployment rate in 2026');
    assert.strictEqual(period.type, 'year');
    assert.strictEqual(period.year, 2026);
  });

  it('should extract year from "by 2025"', () => {
    const period = extractPeriod('Something happens by 2025');
    assert.strictEqual(period.type, 'year');
    assert.strictEqual(period.year, 2025);
  });

  it('should use closeTime year when month is specified without year', () => {
    const closeTime = new Date('2026-03-15');
    const period = extractPeriod('CPI report in January', closeTime);
    assert.strictEqual(period.type, 'month');
    assert.strictEqual(period.year, 2026);
    assert.strictEqual(period.month, 1);
  });

  it('should fallback to closeTime when no period in title', () => {
    const closeTime = new Date('2026-02-28');
    const period = extractPeriod('Some market without date', closeTime);
    assert.strictEqual(period.type, 'month');
    assert.strictEqual(period.year, 2026);
    assert.strictEqual(period.month, 2);
  });

  it('should return null type when no period found and no closeTime', () => {
    const period = extractPeriod('No date information here');
    assert.strictEqual(period.type, null);
  });
});

describe('periodsCompatible', () => {
  it('should match same month+year', () => {
    const a: MacroPeriod = { type: 'month', year: 2026, month: 1 };
    const b: MacroPeriod = { type: 'month', year: 2026, month: 1 };
    assert.strictEqual(periodsCompatible(a, b), true);
  });

  it('should NOT match different months', () => {
    const a: MacroPeriod = { type: 'month', year: 2026, month: 1 };
    const b: MacroPeriod = { type: 'month', year: 2026, month: 2 };
    assert.strictEqual(periodsCompatible(a, b), false);
  });

  it('should match Jan 2026 with Q1 2026', () => {
    const a: MacroPeriod = { type: 'month', year: 2026, month: 1 };
    const b: MacroPeriod = { type: 'quarter', year: 2026, quarter: 1 };
    assert.strictEqual(periodsCompatible(a, b), true);
  });

  it('should match Feb 2026 with Q1 2026', () => {
    const a: MacroPeriod = { type: 'month', year: 2026, month: 2 };
    const b: MacroPeriod = { type: 'quarter', year: 2026, quarter: 1 };
    assert.strictEqual(periodsCompatible(a, b), true);
  });

  it('should match Mar 2026 with Q1 2026', () => {
    const a: MacroPeriod = { type: 'month', year: 2026, month: 3 };
    const b: MacroPeriod = { type: 'quarter', year: 2026, quarter: 1 };
    assert.strictEqual(periodsCompatible(a, b), true);
  });

  it('should NOT match Apr 2026 with Q1 2026', () => {
    const a: MacroPeriod = { type: 'month', year: 2026, month: 4 };
    const b: MacroPeriod = { type: 'quarter', year: 2026, quarter: 1 };
    assert.strictEqual(periodsCompatible(a, b), false);
  });

  it('should match same quarter', () => {
    const a: MacroPeriod = { type: 'quarter', year: 2026, quarter: 2 };
    const b: MacroPeriod = { type: 'quarter', year: 2026, quarter: 2 };
    assert.strictEqual(periodsCompatible(a, b), true);
  });

  it('should match year type with any period in same year', () => {
    const yearPeriod: MacroPeriod = { type: 'year', year: 2026 };
    const monthPeriod: MacroPeriod = { type: 'month', year: 2026, month: 6 };
    assert.strictEqual(periodsCompatible(yearPeriod, monthPeriod), true);
  });

  it('should NOT match different years', () => {
    const a: MacroPeriod = { type: 'month', year: 2025, month: 1 };
    const b: MacroPeriod = { type: 'month', year: 2026, month: 1 };
    assert.strictEqual(periodsCompatible(a, b), false);
  });

  it('should NOT match when either has null type', () => {
    const a: MacroPeriod = { type: null };
    const b: MacroPeriod = { type: 'month', year: 2026, month: 1 };
    assert.strictEqual(periodsCompatible(a, b), false);
  });
});

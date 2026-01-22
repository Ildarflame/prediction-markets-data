/**
 * Unit tests for Safe Rules Evaluator (v2.6.8)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  parseReasonString,
  extractNumbers,
  numbersCompatible,
  extractComparator,
  comparatorsCompatible,
  evaluateSafeRules,
  type MarketLinkWithMarkets,
} from './safe-rules.js';

describe('parseReasonString', () => {
  it('parses MACRO reason format', () => {
    const reason = 'MACRO: tier=STRONG me=0.50 per=0.24[month_in_quarter](2025-Q1/2025-Q1) num=0.05 txt=0.05';
    const parsed = parseReasonString(reason);

    assert.strictEqual(parsed._type, 'MACRO');
    assert.strictEqual(parsed.tier, 'STRONG');
    assert.strictEqual(parsed.me, '0.50');
    assert.strictEqual(parsed.per, '0.24');
    assert.strictEqual(parsed.perKind, 'month_in_quarter');
    assert.strictEqual(parsed.perPeriods, '2025-Q1/2025-Q1');
    assert.strictEqual(parsed.num, '0.05');
    assert.strictEqual(parsed.txt, '0.05');
  });

  it('parses MACRO reason with exact period', () => {
    const reason = 'MACRO: tier=STRONG me=0.50 per=0.40[exact](2025-01/2025-01) num=0.10 txt=0.08';
    const parsed = parseReasonString(reason);

    assert.strictEqual(parsed.perKind, 'exact');
    assert.strictEqual(parsed.per, '0.40');
  });

  it('parses Crypto daily reason format', () => {
    const reason = 'entity=BITCOIN dateType=DAY_EXACT date=1.00(0d) num=0.90[price] text=0.45';
    const parsed = parseReasonString(reason);

    assert.strictEqual(parsed._type, 'CRYPTO');
    assert.strictEqual(parsed.entity, 'BITCOIN');
    assert.strictEqual(parsed.dateType, 'DAY_EXACT');
    assert.strictEqual(parsed.date, '1.00');
    assert.strictEqual(parsed.dateDiff, '0d');
    assert.strictEqual(parsed.num, '0.90');
    assert.strictEqual(parsed.numContext, 'price');
    assert.strictEqual(parsed.text, '0.45');
  });

  it('parses Crypto daily with day offset', () => {
    const reason = 'entity=ETHEREUM dateType=DAY_EXACT date=0.60(+1d) num=0.85[threshold] text=0.38';
    const parsed = parseReasonString(reason);

    assert.strictEqual(parsed.entity, 'ETHEREUM');
    assert.strictEqual(parsed.dateDiff, '+1d');
  });

  it('parses Intraday reason format', () => {
    const reason = 'entity=BITCOIN bucket=2026-01-21T14:00:00.000Z dir=up/up text=0.45';
    const parsed = parseReasonString(reason);

    assert.strictEqual(parsed._type, 'INTRADAY');
    assert.strictEqual(parsed.entity, 'BITCOIN');
    assert.strictEqual(parsed.bucket, '2026-01-21T14:00:00.000Z');
    assert.strictEqual(parsed.dirL, 'up');
    assert.strictEqual(parsed.dirR, 'up');
    assert.strictEqual(parsed.text, '0.45');
  });

  it('handles null/empty reason', () => {
    assert.deepStrictEqual(parseReasonString(null), {});
    assert.deepStrictEqual(parseReasonString(''), {});
  });
});

describe('extractNumbers', () => {
  it('extracts currency amounts', () => {
    const nums = extractNumbers('Bitcoin above $100,000 on Jan 1');
    assert.ok(nums.includes(100000));
  });

  it('extracts percentages', () => {
    const nums = extractNumbers('Unemployment below 5.5% in Q1');
    assert.ok(nums.includes(5.5));
  });

  it('extracts k/m suffixes', () => {
    const nums = extractNumbers('Price above $50k');
    assert.ok(nums.includes(50000));
  });

  it('skips years', () => {
    const nums = extractNumbers('Bitcoin price on Jan 1, 2025');
    assert.ok(!nums.includes(2025)); // Years should be skipped
    // Note: "1" from "Jan 1" may be extracted - that's acceptable
  });

  it('handles multiple numbers', () => {
    const nums = extractNumbers('Between $95,000 and $100,000');
    assert.ok(nums.includes(95000));
    assert.ok(nums.includes(100000));
  });
});

describe('numbersCompatible', () => {
  it('compatible when exact match', () => {
    const result = numbersCompatible([100000], [100000]);
    assert.strictEqual(result.compatible, true);
  });

  it('compatible when absolute diff <= 1', () => {
    const result = numbersCompatible([5.5], [5.6]);
    // 5.6 - 5.5 = 0.1 <= 1
    assert.strictEqual(result.compatible, true);
  });

  it('compatible when relative diff <= 0.1%', () => {
    const result = numbersCompatible([100000], [100050]);
    // 50 / 100050 = 0.0005 <= 0.001
    assert.strictEqual(result.compatible, true);
  });

  it('incompatible when no match', () => {
    const result = numbersCompatible([100000], [95000]);
    assert.strictEqual(result.compatible, false);
  });

  it('compatible when both empty', () => {
    const result = numbersCompatible([], []);
    assert.strictEqual(result.compatible, true);
    assert.strictEqual(result.reason, 'no_numbers');
  });

  it('incompatible when one side empty', () => {
    const result = numbersCompatible([100000], []);
    assert.strictEqual(result.compatible, false);
    assert.strictEqual(result.reason, 'missing_numbers');
  });
});

describe('extractComparator', () => {
  it('extracts GE comparator', () => {
    assert.strictEqual(extractComparator('Bitcoin above $100,000'), 'GE');
    assert.strictEqual(extractComparator('at or above 5%'), 'GE');
    assert.strictEqual(extractComparator('at least 50'), 'GE');
  });

  it('extracts LE comparator', () => {
    assert.strictEqual(extractComparator('Bitcoin below $100,000'), 'LE');
    assert.strictEqual(extractComparator('at or below 5%'), 'LE');
  });

  it('extracts BETWEEN comparator', () => {
    assert.strictEqual(extractComparator('Bitcoin between $90k and $100k'), 'BETWEEN');
    assert.strictEqual(extractComparator('price range $50k-$60k'), 'BETWEEN');
  });

  it('returns null when no comparator', () => {
    assert.strictEqual(extractComparator('Bitcoin price on Jan 1'), null);
  });
});

describe('comparatorsCompatible', () => {
  it('compatible when same', () => {
    assert.strictEqual(comparatorsCompatible('GE', 'GE'), true);
    assert.strictEqual(comparatorsCompatible('LE', 'LE'), true);
  });

  it('compatible when either is null', () => {
    assert.strictEqual(comparatorsCompatible('GE', null), true);
    assert.strictEqual(comparatorsCompatible(null, 'LE'), true);
    assert.strictEqual(comparatorsCompatible(null, null), true);
  });

  it('incompatible when different', () => {
    assert.strictEqual(comparatorsCompatible('GE', 'LE'), false);
    assert.strictEqual(comparatorsCompatible('BETWEEN', 'GE'), false);
  });
});

describe('evaluateSafeRules', () => {
  const createMockLink = (
    score: number,
    reason: string,
    leftTitle: string,
    rightTitle: string
  ): MarketLinkWithMarkets => ({
    id: 1,
    leftVenue: 'polymarket',
    leftMarketId: 100,
    rightVenue: 'kalshi',
    rightMarketId: 200,
    status: 'suggested',
    score,
    reason,
    algoVersion: 'test',
    topic: 'crypto_daily',
    createdAt: new Date(),
    updatedAt: new Date(),
    leftMarket: {
      id: 100,
      venue: 'polymarket',
      externalId: 'ext-100',
      title: leftTitle,
      category: null,
      status: 'active',
      statusMeta: null,
      closeTime: new Date(),
      metadata: null,
      sourceUpdatedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      outcomes: [],
    },
    rightMarket: {
      id: 200,
      venue: 'kalshi',
      externalId: 'ext-200',
      title: rightTitle,
      category: null,
      status: 'active',
      statusMeta: null,
      closeTime: new Date(),
      metadata: null,
      sourceUpdatedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      outcomes: [],
    },
  });

  it('crypto_daily: passes when all rules met', () => {
    const link = createMockLink(
      0.92,
      'entity=BITCOIN dateType=DAY_EXACT date=1.00(0d) num=0.90[price] text=0.45',
      'Bitcoin above $100,000 on Jan 1',
      'Bitcoin above $100,000 on Jan 1'
    );

    const result = evaluateSafeRules(link, 'crypto_daily');
    assert.strictEqual(result.pass, true, `Failed rules: ${result.failedRules.join(', ')}`);
  });

  it('crypto_daily: fails when score below minimum', () => {
    const link = createMockLink(
      0.75,
      'entity=BITCOIN dateType=DAY_EXACT date=1.00(0d) num=0.90[price] text=0.45',
      'Bitcoin above $100,000',
      'Bitcoin above $100,000'
    );

    const result = evaluateSafeRules(link, 'crypto_daily');
    assert.strictEqual(result.pass, false);
    assert.ok(result.failedRules.includes('SCORE_MINIMUM'));
  });

  it('crypto_daily: fails when date not exact (0d)', () => {
    const link = createMockLink(
      0.92,
      'entity=BITCOIN dateType=DAY_EXACT date=0.60(+1d) num=0.90[price] text=0.45',
      'Bitcoin above $100,000 on Jan 1',
      'Bitcoin above $100,000 on Jan 2'
    );

    const result = evaluateSafeRules(link, 'crypto_daily');
    assert.strictEqual(result.pass, false);
    assert.ok(result.failedRules.includes('CD_DATE_EXACT'));
  });

  it('crypto_daily: fails when text sanity too low', () => {
    const link = createMockLink(
      0.92,
      'entity=BITCOIN dateType=DAY_EXACT date=1.00(0d) num=0.90[price] text=0.08',
      'Bitcoin price target',
      'BTC threshold market'
    );

    const result = evaluateSafeRules(link, 'crypto_daily');
    assert.strictEqual(result.pass, false);
    assert.ok(result.failedRules.includes('CD_TEXT_SANITY'));
  });

  it('crypto_intraday: passes when bucket matches', () => {
    const link = createMockLink(
      0.90,
      'entity=BITCOIN bucket=2026-01-21T14:00:00.000Z dir=up/up text=0.45',
      'BTC price up in next 15 mins?',
      'Bitcoin price up in next 15 mins?'
    );
    link.topic = 'crypto_intraday';

    const result = evaluateSafeRules(link, 'crypto_intraday');
    assert.strictEqual(result.pass, true, `Failed rules: ${result.failedRules.join(', ')}`);
  });

  it('crypto_intraday: fails when direction mismatch', () => {
    const link = createMockLink(
      0.90,
      'entity=BITCOIN bucket=2026-01-21T14:00:00.000Z dir=up/down text=0.45',
      'BTC price up in next 15 mins?',
      'Bitcoin price down in next 15 mins?'
    );
    link.topic = 'crypto_intraday';

    const result = evaluateSafeRules(link, 'crypto_intraday');
    assert.strictEqual(result.pass, false);
    assert.ok(result.failedRules.includes('CI_DIRECTION'));
  });

  it('macro: passes with STRONG tier and exact period', () => {
    const link = createMockLink(
      0.95,
      'MACRO: tier=STRONG me=0.50 per=0.40[exact](2025-01/2025-01) num=0.10 txt=0.12',
      'Will unemployment be below 4% in January 2025?',
      'Unemployment below 4% January 2025'
    );
    link.topic = 'macro';

    const result = evaluateSafeRules(link, 'macro');
    assert.strictEqual(result.pass, true, `Failed rules: ${result.failedRules.join(', ')}`);
  });

  it('macro: fails with WEAK tier', () => {
    const link = createMockLink(
      0.95,
      'MACRO: tier=WEAK me=0.50 per=0.18[month_in_year](2025-01/2025) num=0.10 txt=0.12',
      'Will unemployment be below 4% in January 2025?',
      'Unemployment 2025'
    );
    link.topic = 'macro';

    const result = evaluateSafeRules(link, 'macro');
    assert.strictEqual(result.pass, false);
    assert.ok(result.failedRules.includes('MA_TIER_STRONG'));
  });

  it('macro: fails when period kind is month_in_year (weak)', () => {
    const link = createMockLink(
      0.95,
      'MACRO: tier=STRONG me=0.50 per=0.18[month_in_year](2025-01/2025) num=0.10 txt=0.12',
      'Will unemployment be below 4% in January 2025?',
      'Unemployment 2025'
    );
    link.topic = 'macro';

    const result = evaluateSafeRules(link, 'macro');
    assert.strictEqual(result.pass, false);
    assert.ok(result.failedRules.includes('MA_PERIOD_KIND'));
  });
});

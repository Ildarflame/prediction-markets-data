/**
 * Rates Signals Tests (v3.0.0)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractCentralBank,
  extractRateAction,
  extractBasisPoints,
  extractMeetingDate,
  extractMeetingMonth,
  extractTargetRate,
  extractActionCount,
  extractRatesSignals,
  isRatesMarket,
  CentralBank,
  RateAction,
} from './ratesSignals.js';
import type { EligibleMarket } from '@data-module/db';

// Helper to create test market
function makeMarket(title: string, closeTime?: Date): EligibleMarket {
  return {
    id: 1,
    title,
    venue: 'kalshi',
    externalId: 'test',
    status: 'active',
    closeTime: closeTime ?? new Date('2025-01-29'),
    category: null,
    metadata: null,
    outcomeCount: 2,
  } as EligibleMarket;
}

describe('extractCentralBank', () => {
  it('should detect FED from various keywords', () => {
    assert.equal(extractCentralBank('Fed to cut rates in January'), CentralBank.FED);
    assert.equal(extractCentralBank('FOMC meeting decision'), CentralBank.FED);
    assert.equal(extractCentralBank('Federal Reserve rate hike'), CentralBank.FED);
    assert.equal(extractCentralBank('Powell announces rate decision'), CentralBank.FED);
    assert.equal(extractCentralBank('Fed funds rate target'), CentralBank.FED);
  });

  it('should detect ECB', () => {
    assert.equal(extractCentralBank('ECB rate decision in March'), CentralBank.ECB);
    assert.equal(extractCentralBank('European Central Bank meeting'), CentralBank.ECB);
    assert.equal(extractCentralBank('Lagarde announces rate cut'), CentralBank.ECB);
  });

  it('should detect BOE', () => {
    assert.equal(extractCentralBank('Bank of England rate decision'), CentralBank.BOE);
    assert.equal(extractCentralBank('BOE to hold rates steady'), CentralBank.BOE);
    assert.equal(extractCentralBank('Bailey announces rate hike'), CentralBank.BOE);
  });

  it('should detect BOJ', () => {
    assert.equal(extractCentralBank('Bank of Japan rate policy'), CentralBank.BOJ);
    assert.equal(extractCentralBank('BOJ maintains negative rates'), CentralBank.BOJ);
    assert.equal(extractCentralBank('Ueda signals policy shift'), CentralBank.BOJ);
  });

  it('should return UNKNOWN for non-rate markets', () => {
    assert.equal(extractCentralBank('Bitcoin price prediction'), CentralBank.UNKNOWN);
    assert.equal(extractCentralBank('Trump to win election'), CentralBank.UNKNOWN);
  });
});

describe('extractRateAction', () => {
  it('should detect CUT actions', () => {
    assert.equal(extractRateAction('Fed to cut rates'), RateAction.CUT);
    assert.equal(extractRateAction('ECB cuts interest rates'), RateAction.CUT);
    assert.equal(extractRateAction('Rate reduction expected'), RateAction.CUT);
    assert.equal(extractRateAction('Lower rates coming'), RateAction.CUT);
    assert.equal(extractRateAction('Easing cycle begins'), RateAction.CUT);
  });

  it('should detect HIKE actions', () => {
    assert.equal(extractRateAction('Fed to hike rates'), RateAction.HIKE);
    assert.equal(extractRateAction('BOE raises rates'), RateAction.HIKE);
    assert.equal(extractRateAction('Rate increase expected'), RateAction.HIKE);
    assert.equal(extractRateAction('Tightening continues'), RateAction.HIKE);
  });

  it('should detect HOLD actions', () => {
    assert.equal(extractRateAction('Fed to hold rates steady'), RateAction.HOLD);
    assert.equal(extractRateAction('Rates unchanged'), RateAction.HOLD);
    assert.equal(extractRateAction('No change expected'), RateAction.HOLD);
    assert.equal(extractRateAction('Maintain current rates'), RateAction.HOLD);
  });

  it('should detect PAUSE actions', () => {
    assert.equal(extractRateAction('Fed to pause rate hikes'), RateAction.PAUSE);
    assert.equal(extractRateAction('Skip the next hike'), RateAction.PAUSE);
  });

  it('should return UNKNOWN when no action detected', () => {
    assert.equal(extractRateAction('Fed meeting tomorrow'), RateAction.UNKNOWN);
    assert.equal(extractRateAction('Interest rate discussion'), RateAction.UNKNOWN);
  });
});

describe('extractBasisPoints', () => {
  it('should extract bps from various formats', () => {
    assert.equal(extractBasisPoints('25 bps cut'), 25);
    assert.equal(extractBasisPoints('50 basis points'), 50);
    assert.equal(extractBasisPoints('75bps hike'), 75);
    assert.equal(extractBasisPoints('100 bp increase'), 100);
  });

  it('should extract from percentage format', () => {
    assert.equal(extractBasisPoints('0.25% cut'), 25);
    assert.equal(extractBasisPoints('0.50% hike'), 50);
  });

  it('should extract from word format', () => {
    assert.equal(extractBasisPoints('quarter point cut'), 25);
    assert.equal(extractBasisPoints('half point increase'), 50);
  });

  it('should return null when no bps found', () => {
    assert.equal(extractBasisPoints('Fed to cut rates'), null);
    assert.equal(extractBasisPoints('Rate decision tomorrow'), null);
  });
});

describe('extractMeetingDate', () => {
  it('should extract full dates', () => {
    assert.equal(extractMeetingDate('Meeting on January 29, 2025'), '2025-01-29');
    assert.equal(extractMeetingDate('Decision March 15 2025'), '2025-03-15');
    assert.equal(extractMeetingDate('Dec 12th, 2024'), '2024-12-12');
  });

  it('should fall back to closeTime', () => {
    const closeTime = new Date('2025-06-15');
    assert.equal(extractMeetingDate('FOMC meeting', closeTime), '2025-06-15');
  });

  it('should return null without date', () => {
    assert.equal(extractMeetingDate('FOMC decision'), null);
  });
});

describe('extractMeetingMonth', () => {
  it('should extract month from full date', () => {
    assert.equal(extractMeetingMonth('Meeting January 29, 2025'), '2025-01');
  });

  it('should extract month-year pattern', () => {
    assert.equal(extractMeetingMonth('January 2025 FOMC meeting'), '2025-01');
    assert.equal(extractMeetingMonth('March 2025 rate decision'), '2025-03');
  });

  it('should fall back to closeTime', () => {
    const closeTime = new Date('2025-09-01');
    assert.equal(extractMeetingMonth('FOMC decision', closeTime), '2025-09');
  });
});

describe('extractTargetRate', () => {
  it('should extract rate range', () => {
    const result = extractTargetRate('Target rate 4.25%-4.50%');
    assert.deepEqual(result, { min: 4.25, max: 4.5 });
  });

  it('should extract between format', () => {
    const result = extractTargetRate('Rate between 4.0% and 4.25%');
    assert.deepEqual(result, { min: 4, max: 4.25 });
  });

  it('should return null when no range found', () => {
    assert.equal(extractTargetRate('Fed to cut rates'), null);
  });
});

describe('extractActionCount', () => {
  it('should extract digit counts', () => {
    assert.equal(extractActionCount('3 rate cuts this year'), 3);
    assert.equal(extractActionCount('2 hikes expected'), 2);
  });

  it('should extract word counts', () => {
    assert.equal(extractActionCount('three cuts expected'), 3);
    assert.equal(extractActionCount('no cuts this year'), 0);
    assert.equal(extractActionCount('two rate hikes'), 2);
  });

  it('should return null when no count found', () => {
    assert.equal(extractActionCount('Fed to cut rates'), null);
  });
});

describe('extractRatesSignals', () => {
  it('should extract full signals from Fed market', () => {
    const market = makeMarket('Fed to cut rates by 25 bps in January 2025', new Date('2025-01-29'));
    const signals = extractRatesSignals(market);

    assert.equal(signals.centralBank, CentralBank.FED);
    assert.equal(signals.action, RateAction.CUT);
    assert.equal(signals.basisPoints, 25);
    assert.equal(signals.meetingMonth, '2025-01');
    assert.ok(signals.confidence > 0.5);
  });

  it('should extract signals from ECB market', () => {
    const market = makeMarket('ECB holds rates steady at March meeting', new Date('2025-03-15'));
    const signals = extractRatesSignals(market);

    assert.equal(signals.centralBank, CentralBank.ECB);
    assert.equal(signals.action, RateAction.HOLD);
    assert.equal(signals.meetingMonth, '2025-03');
  });
});

describe('isRatesMarket', () => {
  it('should return true for rates markets', () => {
    assert.ok(isRatesMarket('Fed to cut rates'));
    assert.ok(isRatesMarket('FOMC decision tomorrow'));
    assert.ok(isRatesMarket('Interest rate increase'));
    assert.ok(isRatesMarket('ECB rate decision'));
    assert.ok(isRatesMarket('25 bps cut expected'));
  });

  it('should return false for non-rates markets', () => {
    assert.ok(!isRatesMarket('Bitcoin price prediction'));
    assert.ok(!isRatesMarket('Trump wins election'));
    assert.ok(!isRatesMarket('GDP growth report'));
  });
});

/**
 * Elections Signals Tests (v3.0.0)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractCountry,
  extractOffice,
  extractIntent,
  extractElectionYear,
  extractState,
  extractCandidates,
  extractParty,
  extractElectionsSignals,
  isElectionsMarket,
  ElectionCountry,
  ElectionOffice,
  ElectionIntent,
} from './electionsSignals.js';
import type { EligibleMarket } from '@data-module/db';

// Helper to create test market
function makeMarket(title: string, closeTime?: Date): EligibleMarket {
  return {
    id: 1,
    title,
    venue: 'polymarket',
    externalId: 'test',
    status: 'active',
    closeTime: closeTime ?? new Date('2024-11-05'),
    category: null,
    metadata: null,
    outcomeCount: 2,
  } as EligibleMarket;
}

describe('extractCountry', () => {
  it('should detect US from various keywords', () => {
    assert.equal(extractCountry('US presidential election 2024'), ElectionCountry.US);
    assert.equal(extractCountry('United States Senate race'), ElectionCountry.US);
    assert.equal(extractCountry('Who wins the presidency'), ElectionCountry.US);
    assert.equal(extractCountry('Congress to flip'), ElectionCountry.US);
    assert.equal(extractCountry('Senate control'), ElectionCountry.US);
  });

  it('should detect UK', () => {
    assert.equal(extractCountry('UK general election'), ElectionCountry.UK);
    assert.equal(extractCountry('British parliamentary vote'), ElectionCountry.UK);
    assert.equal(extractCountry('Downing Street next PM'), ElectionCountry.UK);
  });

  it('should detect France', () => {
    assert.equal(extractCountry('French presidential election'), ElectionCountry.FRANCE);
    assert.equal(extractCountry('Macron vs Le Pen'), ElectionCountry.FRANCE);
  });

  it('should default to US for presidential without country', () => {
    assert.equal(extractCountry('Trump wins presidential election'), ElectionCountry.US);
    assert.equal(extractCountry('Who wins the president'), ElectionCountry.US);
  });

  it('should return UNKNOWN for non-political markets', () => {
    assert.equal(extractCountry('Bitcoin price 100k'), ElectionCountry.UNKNOWN);
  });
});

describe('extractOffice', () => {
  it('should detect PRESIDENT', () => {
    assert.equal(extractOffice('Presidential election 2024'), ElectionOffice.PRESIDENT);
    assert.equal(extractOffice('Who becomes president'), ElectionOffice.PRESIDENT);
    assert.equal(extractOffice('White House race'), ElectionOffice.PRESIDENT);
  });

  it('should detect SENATE', () => {
    assert.equal(extractOffice('Senate race in Georgia'), ElectionOffice.SENATE);
    assert.equal(extractOffice('Who wins senator seat'), ElectionOffice.SENATE);
  });

  it('should detect HOUSE', () => {
    assert.equal(extractOffice('House of Representatives control'), ElectionOffice.HOUSE);
    assert.equal(extractOffice('Congressional district race'), ElectionOffice.HOUSE);
  });

  it('should detect GOVERNOR', () => {
    assert.equal(extractOffice('Governor race in Texas'), ElectionOffice.GOVERNOR);
    assert.equal(extractOffice('Gubernatorial election'), ElectionOffice.GOVERNOR);
  });

  it('should detect PRIME_MINISTER', () => {
    assert.equal(extractOffice('Next Prime Minister of UK'), ElectionOffice.PRIME_MINISTER);
    assert.equal(extractOffice('Who becomes PM'), ElectionOffice.PRIME_MINISTER);
  });

  it('should return UNKNOWN for non-office markets', () => {
    assert.equal(extractOffice('Trump wins election'), ElectionOffice.UNKNOWN);
  });
});

describe('extractIntent', () => {
  it('should detect WINNER intent', () => {
    assert.equal(extractIntent('Who will win the election'), ElectionIntent.WINNER);
    assert.equal(extractIntent('Trump wins presidency'), ElectionIntent.WINNER);
    assert.equal(extractIntent('Next president'), ElectionIntent.WINNER);
  });

  it('should detect MARGIN intent', () => {
    assert.equal(extractIntent('Popular vote margin'), ElectionIntent.MARGIN);
    assert.equal(extractIntent('Electoral vote count'), ElectionIntent.MARGIN);
    assert.equal(extractIntent('Win by landslide'), ElectionIntent.MARGIN);
  });

  it('should detect TURNOUT intent', () => {
    assert.equal(extractIntent('Voter turnout 2024'), ElectionIntent.TURNOUT);
    assert.equal(extractIntent('Participation rate'), ElectionIntent.TURNOUT);
  });

  it('should detect PARTY_CONTROL intent', () => {
    assert.equal(extractIntent('Republicans control Senate'), ElectionIntent.PARTY_CONTROL);
    assert.equal(extractIntent('Democrats flip the House'), ElectionIntent.PARTY_CONTROL);
  });

  it('should detect NOMINEE intent', () => {
    assert.equal(extractIntent('Republican nominee 2024'), ElectionIntent.NOMINEE);
    assert.equal(extractIntent('Who gets the nomination'), ElectionIntent.NOMINEE);
    assert.equal(extractIntent('Primary winner'), ElectionIntent.NOMINEE);
  });
});

describe('extractElectionYear', () => {
  it('should extract year from title', () => {
    assert.equal(extractElectionYear('2024 presidential election'), 2024);
    assert.equal(extractElectionYear('Election 2026 forecast'), 2026);
  });

  it('should fall back to closeTime', () => {
    const closeTime = new Date('2028-11-05');
    assert.equal(extractElectionYear('Next president', closeTime), 2028);
  });

  it('should return null without year', () => {
    assert.equal(extractElectionYear('Election outcome'), null);
  });
});

describe('extractState', () => {
  it('should extract state abbreviations', () => {
    assert.equal(extractState('Senate race in GA '), 'GA');
    assert.equal(extractState('TX governor election'), 'TX');
  });

  it('should extract state names', () => {
    assert.equal(extractState('Georgia Senate race'), 'GA');
    assert.equal(extractState('California governor'), 'CA');
    assert.equal(extractState('Pennsylvania primary'), 'PA');
    assert.equal(extractState('New York congressional'), 'NY');
  });

  it('should return null for national races', () => {
    assert.equal(extractState('Presidential election 2024'), null);
    assert.equal(extractState('Who wins the White House'), null);
  });
});

describe('extractCandidates', () => {
  it('should extract major candidates', () => {
    const candidates = extractCandidates('Trump vs Biden 2024');
    assert.ok(candidates.includes('TRUMP'));
    assert.ok(candidates.includes('BIDEN'));
  });

  it('should extract Harris', () => {
    const candidates = extractCandidates('Kamala Harris wins presidency');
    assert.ok(candidates.includes('HARRIS'));
  });

  it('should extract multiple candidates', () => {
    const candidates = extractCandidates('Trump, DeSantis, Haley in primary');
    assert.ok(candidates.includes('TRUMP'));
    assert.ok(candidates.includes('DESANTIS'));
    assert.ok(candidates.includes('HALEY'));
  });

  it('should extract UK candidates', () => {
    const candidates = extractCandidates('Starmer vs Sunak debate');
    assert.ok(candidates.includes('STARMER'));
    assert.ok(candidates.includes('SUNAK'));
  });

  it('should return empty for no candidates', () => {
    const candidates = extractCandidates('Senate control 2024');
    assert.equal(candidates.length, 0);
  });
});

describe('extractParty', () => {
  it('should detect Republican', () => {
    assert.equal(extractParty('Republican nominee'), 'REPUBLICAN');
    assert.equal(extractParty('GOP primary'), 'REPUBLICAN');
  });

  it('should detect Democrat', () => {
    assert.equal(extractParty('Democratic candidate'), 'DEMOCRAT');
    assert.equal(extractParty('Democrat wins'), 'DEMOCRAT');
  });

  it('should detect UK parties', () => {
    assert.equal(extractParty('Conservative win'), 'CONSERVATIVE');
    assert.equal(extractParty('Labour victory'), 'LABOUR');
  });

  it('should return null for non-partisan', () => {
    assert.equal(extractParty('Presidential election'), null);
  });
});

describe('extractElectionsSignals', () => {
  it('should extract full signals from US presidential market', () => {
    const market = makeMarket('Trump wins 2024 presidential election', new Date('2024-11-05'));
    const signals = extractElectionsSignals(market);

    assert.equal(signals.country, ElectionCountry.US);
    assert.equal(signals.office, ElectionOffice.PRESIDENT);
    assert.equal(signals.year, 2024);
    assert.ok(signals.candidates.includes('TRUMP'));
    assert.equal(signals.intent, ElectionIntent.WINNER);
    assert.ok(signals.confidence > 0.5);
  });

  it('should extract signals from state-level race', () => {
    const market = makeMarket('Georgia Senate race 2024', new Date('2024-11-05'));
    const signals = extractElectionsSignals(market);

    assert.equal(signals.country, ElectionCountry.US);
    assert.equal(signals.office, ElectionOffice.SENATE);
    assert.equal(signals.state, 'GA');
    assert.equal(signals.year, 2024);
  });

  it('should extract signals from party control market', () => {
    const market = makeMarket('Republicans control Senate 2024', new Date('2024-11-05'));
    const signals = extractElectionsSignals(market);

    assert.equal(signals.country, ElectionCountry.US);
    assert.equal(signals.office, ElectionOffice.SENATE);
    assert.equal(signals.party, 'REPUBLICAN');
    assert.equal(signals.intent, ElectionIntent.PARTY_CONTROL);
  });
});

describe('isElectionsMarket', () => {
  it('should return true for election markets', () => {
    assert.ok(isElectionsMarket('Presidential election 2024'));
    assert.ok(isElectionsMarket('Trump wins'));
    assert.ok(isElectionsMarket('Senate race'));
    assert.ok(isElectionsMarket('Congress control'));
    assert.ok(isElectionsMarket('Republican nominee'));
    assert.ok(isElectionsMarket('Who wins the vote'));
  });

  it('should return false for non-election markets', () => {
    assert.ok(!isElectionsMarket('Bitcoin price 100k'));
    assert.ok(!isElectionsMarket('Fed cuts rates'));
    assert.ok(!isElectionsMarket('GDP growth'));
  });
});

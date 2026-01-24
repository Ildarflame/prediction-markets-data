/**
 * Universal Extractor Tests (v3.0.16)
 *
 * 50+ test cases covering:
 * - Esports team extraction
 * - Traditional sports teams
 * - UFC fighters
 * - Tennis players
 * - Politicians
 * - Celebrities
 * - Numbers (prices, spreads, percentages, bps)
 * - Dates (multiple formats)
 * - Game type detection
 * - Market type detection
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  extractUniversalEntities,
  extractTeams,
  extractPeople,
  extractOrganizations,
  extractNumbers,
  extractDates,
  extractComparator,
  detectGameType,
  detectMarketType,
  GameType,
  UniversalMarketType,
  UniversalComparator,
  jaccardSets,
  countEntityOverlap,
  tokenize,
  normalizeTitle,
} from './universalExtractor.js';

// ============================================================================
// ESPORTS TEAM EXTRACTION
// ============================================================================

describe('Esports Team Extraction', () => {
  it('extracts CS2 teams: Vitality vs Falcons', () => {
    const title = 'Team Vitality vs Team Falcons - CS2 Match';
    const result = extractTeams(title);
    assert.ok(result.teams.includes('TEAM_VITALITY'), 'Should extract Vitality');
    assert.ok(result.teams.includes('TEAM_FALCONS'), 'Should extract Falcons');
  });

  it('extracts CS2 teams with aliases: vit vs fal', () => {
    const title = 'VIT vs FAL - cs2-vit-fal2-2026-01-24';
    const result = extractTeams(title);
    assert.ok(result.teams.includes('TEAM_VITALITY'), 'Should extract VIT as Vitality');
    assert.ok(result.teams.includes('TEAM_FALCONS'), 'Should extract FAL as Falcons');
  });

  it('extracts NAVI with apostrophe', () => {
    const title = "Na'Vi vs G2 Esports - BLAST Premier";
    const result = extractTeams(title);
    assert.ok(result.teams.includes('NAVI'), "Should extract Na'Vi");
    assert.ok(result.teams.includes('G2_ESPORTS'), 'Should extract G2');
  });

  it('extracts FaZe Clan', () => {
    const title = 'FaZe Clan vs Team Spirit';
    const result = extractTeams(title);
    assert.ok(result.teams.includes('FAZE_CLAN'), 'Should extract FaZe');
    assert.ok(result.teams.includes('TEAM_SPIRIT'), 'Should extract Spirit');
  });

  it('extracts Cloud9 with C9 alias', () => {
    const title = 'C9 vs Fnatic - ESL Match';
    const result = extractTeams(title);
    assert.ok(result.teams.includes('CLOUD9'), 'Should extract C9 as Cloud9');
    assert.ok(result.teams.includes('FNATIC'), 'Should extract Fnatic');
  });

  it('extracts Valorant teams', () => {
    const title = 'Sentinels vs LOUD - VCT Americas';
    const result = extractTeams(title);
    assert.ok(result.teams.includes('SENTINELS'), 'Should extract Sentinels');
    assert.ok(result.teams.includes('LOUD'), 'Should extract LOUD');
  });

  it('extracts LoL teams: T1 vs Gen.G', () => {
    const title = 'T1 vs Gen.G - LCK Finals';
    const result = extractTeams(title);
    assert.ok(result.teams.includes('T1'), 'Should extract T1');
    assert.ok(result.teams.includes('GEN_G'), 'Should extract Gen.G');
  });

  it('extracts Team Liquid (multi-game org)', () => {
    const title = 'Team Liquid vs Evil Geniuses';
    const result = extractTeams(title);
    assert.ok(result.teams.includes('LIQUID'), 'Should extract Team Liquid');
    assert.ok(result.teams.includes('EVIL_GENIUSES'), 'Should extract EG');
  });
});

// ============================================================================
// UFC FIGHTER EXTRACTION
// ============================================================================

describe('UFC Fighter Extraction', () => {
  it('extracts Islam Makhachev', () => {
    const title = 'Islam Makhachev vs Charles Oliveira - UFC 294';
    const result = extractTeams(title);
    assert.ok(result.teams.includes('ISLAM_MAKHACHEV'), 'Should extract Islam');
    assert.ok(result.teams.includes('CHARLES_OLIVEIRA'), 'Should extract Oliveira');
  });

  it('extracts Jon Jones with nickname', () => {
    const title = 'Jon "Bones" Jones UFC Heavyweight';
    const result = extractTeams(title);
    assert.ok(result.teams.includes('JON_JONES'), 'Should extract Jones');
  });

  it('extracts Conor McGregor', () => {
    const title = 'Conor McGregor vs Dustin Poirier - UFC Fight';
    const result = extractTeams(title);
    assert.ok(result.teams.includes('CONOR_MCGREGOR'), 'Should extract McGregor');
    assert.ok(result.teams.includes('DUSTIN_POIRIER'), 'Should extract Poirier');
  });

  it('extracts Alex Pereira', () => {
    const title = 'Alex Pereira to win at UFC 300';
    const result = extractTeams(title);
    assert.ok(result.teams.includes('ALEX_PEREIRA'), 'Should extract Pereira');
  });
});

// ============================================================================
// TENNIS PLAYER EXTRACTION
// ============================================================================

describe('Tennis Player Extraction', () => {
  it('extracts Djokovic vs Alcaraz', () => {
    const title = 'Djokovic vs Alcaraz - Wimbledon Final';
    const result = extractTeams(title);
    assert.ok(result.teams.includes('NOVAK_DJOKOVIC'), 'Should extract Djokovic');
    assert.ok(result.teams.includes('CARLOS_ALCARAZ'), 'Should extract Alcaraz');
  });

  it('extracts Sinner with first name', () => {
    const title = 'Jannik Sinner to win Australian Open';
    const result = extractTeams(title);
    assert.ok(result.teams.includes('JANNIK_SINNER'), 'Should extract Sinner');
  });

  it('extracts WTA players', () => {
    const title = 'Swiatek vs Sabalenka - WTA Finals';
    const result = extractTeams(title);
    assert.ok(result.teams.includes('IGA_SWIATEK'), 'Should extract Swiatek');
    assert.ok(result.teams.includes('ARYNA_SABALENKA'), 'Should extract Sabalenka');
  });

  it('extracts Coco Gauff', () => {
    const title = 'Coco Gauff vs Emma Raducanu';
    const result = extractTeams(title);
    assert.ok(result.teams.includes('COCO_GAUFF'), 'Should extract Gauff');
    assert.ok(result.teams.includes('EMMA_RADUCANU'), 'Should extract Raducanu');
  });
});

// ============================================================================
// POLITICIAN EXTRACTION
// ============================================================================

describe('Politician Extraction', () => {
  it('extracts Trump vs Biden', () => {
    const title = 'Will Trump beat Biden in 2024?';
    const result = extractPeople(title);
    assert.ok(result.people.includes('DONALD_TRUMP'), 'Should extract Trump');
    assert.ok(result.people.includes('JOE_BIDEN'), 'Should extract Biden');
  });

  it('extracts Kamala Harris with title', () => {
    const title = 'VP Harris to become President?';
    const result = extractPeople(title);
    assert.ok(result.people.includes('KAMALA_HARRIS'), 'Should extract Harris');
  });

  it('extracts Elon Musk', () => {
    const title = 'Elon Musk to lead DOGE?';
    const result = extractPeople(title);
    assert.ok(result.people.includes('ELON_MUSK'), 'Should extract Musk');
  });

  it('extracts international politicians', () => {
    const title = 'Putin and Zelensky peace talks';
    const result = extractPeople(title);
    assert.ok(result.people.includes('VLADIMIR_PUTIN'), 'Should extract Putin');
    assert.ok(result.people.includes('VOLODYMYR_ZELENSKY'), 'Should extract Zelensky');
  });

  it('extracts RFK Jr with aliases', () => {
    const title = 'RFK Jr to join Trump cabinet?';
    const result = extractPeople(title);
    assert.ok(result.people.includes('RFK_JR'), 'Should extract RFK Jr');
  });

  it('extracts DeSantis', () => {
    const title = 'Ron DeSantis to run for President 2028?';
    const result = extractPeople(title);
    assert.ok(result.people.includes('RON_DESANTIS'), 'Should extract DeSantis');
  });
});

// ============================================================================
// CELEBRITY EXTRACTION
// ============================================================================

describe('Celebrity Extraction', () => {
  it('extracts Taylor Swift', () => {
    const title = 'Taylor Swift Album of the Year?';
    const result = extractPeople(title);
    assert.ok(result.people.includes('TAYLOR_SWIFT'), 'Should extract Swift');
  });

  it('extracts LeBron James', () => {
    const title = 'LeBron James MVP 2026?';
    const result = extractPeople(title);
    assert.ok(result.people.includes('LEBRON_JAMES'), 'Should extract LeBron');
  });

  it('extracts Messi and Ronaldo', () => {
    const title = 'Messi vs Ronaldo Ballon d\'Or';
    const result = extractPeople(title);
    assert.ok(result.people.includes('LIONEL_MESSI'), 'Should extract Messi');
    assert.ok(result.people.includes('CRISTIANO_RONALDO'), 'Should extract Ronaldo');
  });

  it('extracts MrBeast', () => {
    const title = 'MrBeast subscriber count January 2026';
    const result = extractPeople(title);
    assert.ok(result.people.includes('MR_BEAST'), 'Should extract MrBeast');
  });
});

// ============================================================================
// ORGANIZATION EXTRACTION
// ============================================================================

describe('Organization Extraction', () => {
  it('extracts central banks: Fed, ECB', () => {
    const title = 'Fed rate decision vs ECB meeting';
    const result = extractOrganizations(title);
    assert.ok(result.orgs.includes('FED'), 'Should extract Fed');
    assert.ok(result.orgs.includes('ECB'), 'Should extract ECB');
  });

  it('extracts sports leagues', () => {
    const title = 'NBA Finals 2026';
    const result = extractOrganizations(title);
    assert.ok(result.orgs.includes('NBA'), 'Should extract NBA');
  });

  it('extracts crypto projects', () => {
    const title = 'Bitcoin and Ethereum price comparison';
    const result = extractOrganizations(title);
    assert.ok(result.orgs.includes('BITCOIN'), 'Should extract Bitcoin');
    assert.ok(result.orgs.includes('ETHEREUM'), 'Should extract Ethereum');
  });

  it('extracts tech companies', () => {
    const title = 'Apple vs Microsoft market cap';
    const result = extractOrganizations(title);
    assert.ok(result.orgs.includes('APPLE'), 'Should extract Apple');
    assert.ok(result.orgs.includes('MICROSOFT'), 'Should extract Microsoft');
  });
});

// ============================================================================
// NUMBER EXTRACTION
// ============================================================================

describe('Number Extraction', () => {
  it('extracts dollar amounts: $3700', () => {
    const numbers = extractNumbers('ETH above $3700');
    assert.ok(numbers.some(n => n.value === 3700 && n.unit === 'USD'), 'Should extract $3700');
  });

  it('extracts dollar amounts with multiplier: $100k', () => {
    const numbers = extractNumbers('BTC hits $100k');
    assert.ok(numbers.some(n => n.value === 100000 && n.unit === 'USD'), 'Should extract $100k');
  });

  it('extracts dollar amounts with word multiplier: $1.2 million', () => {
    const numbers = extractNumbers('Prize pool $1.2 million');
    assert.ok(numbers.some(n => n.value === 1200000), 'Should extract $1.2 million');
  });

  it('extracts percentages: 3.5%', () => {
    const numbers = extractNumbers('CPI above 3.5%');
    assert.ok(numbers.some(n => n.value === 3.5 && n.unit === '%'), 'Should extract 3.5%');
  });

  it('extracts basis points: 25 bps', () => {
    const numbers = extractNumbers('Fed cuts 25 bps');
    assert.ok(numbers.some(n => n.value === 25 && n.unit === 'bps'), 'Should extract 25 bps');
  });

  it('extracts spread values: +3.5', () => {
    const numbers = extractNumbers('Lakers +3.5 points');
    assert.ok(numbers.some(n => n.value === 3.5 && n.context === 'spread'), 'Should extract +3.5');
  });

  it('extracts multiple numbers', () => {
    const numbers = extractNumbers('BTC between $90,000 and $100,000');
    assert.ok(numbers.some(n => n.value === 90000), 'Should extract $90,000');
    assert.ok(numbers.some(n => n.value === 100000), 'Should extract $100,000');
  });

  it('does not extract years as prices', () => {
    const numbers = extractNumbers('Election 2024 winner');
    assert.ok(!numbers.some(n => n.value === 2024), 'Should not extract 2024 as a number');
  });
});

// ============================================================================
// DATE EXTRACTION
// ============================================================================

describe('Date Extraction', () => {
  it('extracts Month Day, Year: Jan 26, 2026', () => {
    const dates = extractDates('ETH above $3700 by Jan 26, 2026');
    assert.ok(dates.some(d => d.year === 2026 && d.month === 1 && d.day === 26), 'Should extract Jan 26, 2026');
  });

  it('extracts ISO format: 2026-01-24', () => {
    const dates = extractDates('cs2-vit-fal2-2026-01-24');
    assert.ok(dates.some(d => d.year === 2026 && d.month === 1 && d.day === 24), 'Should extract 2026-01-24');
  });

  it('extracts Month Year: January 2026', () => {
    const dates = extractDates('CPI January 2026');
    assert.ok(dates.some(d => d.year === 2026 && d.month === 1 && d.precision === 'MONTH'), 'Should extract January 2026');
  });

  it('extracts Quarter: Q1 2026', () => {
    const dates = extractDates('GDP Q1 2026');
    assert.ok(dates.some(d => d.year === 2026 && d.month === 3 && d.precision === 'QUARTER'), 'Should extract Q1 2026');
  });

  it('extracts Month Day without year (infers from context)', () => {
    const dates = extractDates('Match on Jan 24', new Date('2026-01-20'));
    assert.ok(dates.some(d => d.month === 1 && d.day === 24), 'Should extract Jan 24');
  });

  it('handles December with year rollover', () => {
    const dates = extractDates('Event on Dec 31', new Date('2026-01-15'));
    assert.ok(dates.some(d => d.month === 12 && d.day === 31), 'Should extract Dec 31');
  });
});

// ============================================================================
// COMPARATOR EXTRACTION
// ============================================================================

describe('Comparator Extraction', () => {
  it('extracts ABOVE from "above"', () => {
    assert.strictEqual(extractComparator('ETH above $3700'), UniversalComparator.ABOVE);
  });

  it('extracts ABOVE from "exceed"', () => {
    assert.strictEqual(extractComparator('BTC to exceed $100k'), UniversalComparator.ABOVE);
  });

  it('extracts BELOW from "below"', () => {
    assert.strictEqual(extractComparator('ETH below $3000'), UniversalComparator.BELOW);
  });

  it('extracts BELOW from "fall below"', () => {
    assert.strictEqual(extractComparator('Price to fall below $50k'), UniversalComparator.BELOW);
  });

  it('extracts WIN from "win"', () => {
    assert.strictEqual(extractComparator('Lakers to win'), UniversalComparator.WIN);
  });

  it('extracts WIN from "defeat"', () => {
    assert.strictEqual(extractComparator('Team A to defeat Team B'), UniversalComparator.WIN);
  });

  it('extracts BETWEEN from range pattern', () => {
    assert.strictEqual(extractComparator('BTC between $90k and $100k'), UniversalComparator.BETWEEN);
  });

  it('extracts BETWEEN from dash range', () => {
    assert.strictEqual(extractComparator('ETH $3700-$3800'), UniversalComparator.BETWEEN);
  });
});

// ============================================================================
// GAME TYPE DETECTION
// ============================================================================

describe('Game Type Detection', () => {
  it('detects CS2 from explicit mention', () => {
    assert.strictEqual(detectGameType('CS2 Match: Vitality vs Falcons'), GameType.CS2);
  });

  it('detects CS2 from counter-strike', () => {
    assert.strictEqual(detectGameType('Counter-Strike 2 Major'), GameType.CS2);
  });

  it('detects Valorant', () => {
    assert.strictEqual(detectGameType('Valorant VCT Americas'), GameType.VALORANT);
  });

  it('detects LoL from LCK', () => {
    assert.strictEqual(detectGameType('LCK Spring Finals'), GameType.LOL);
  });

  it('detects NBA', () => {
    assert.strictEqual(detectGameType('NBA Finals 2026'), GameType.NBA);
  });

  it('detects NFL from Super Bowl', () => {
    assert.strictEqual(detectGameType('Super Bowl winner'), GameType.NFL);
  });

  it('detects Soccer from Premier League', () => {
    assert.strictEqual(detectGameType('Premier League match'), GameType.SOCCER);
  });

  it('detects UFC', () => {
    assert.strictEqual(detectGameType('UFC 300 main event'), GameType.UFC);
  });

  it('detects Tennis from Wimbledon', () => {
    assert.strictEqual(detectGameType('Wimbledon final'), GameType.TENNIS);
  });

  it('detects Election', () => {
    assert.strictEqual(detectGameType('Presidential election 2028'), GameType.ELECTION);
  });

  it('detects Crypto', () => {
    assert.strictEqual(detectGameType('Bitcoin price prediction'), GameType.CRYPTO);
  });

  it('detects Macro', () => {
    assert.strictEqual(detectGameType('Fed rate decision'), GameType.MACRO);
  });
});

// ============================================================================
// MARKET TYPE DETECTION
// ============================================================================

describe('Market Type Detection', () => {
  it('detects WINNER from vs pattern', () => {
    const comparator = extractComparator('Vitality vs Falcons');
    assert.strictEqual(detectMarketType('Vitality vs Falcons', comparator), UniversalMarketType.WINNER);
  });

  it('detects WINNER from "to win"', () => {
    const comparator = extractComparator('Lakers to win');
    assert.strictEqual(detectMarketType('Lakers to win', comparator), UniversalMarketType.WINNER);
  });

  it('detects SPREAD from spread keyword', () => {
    const comparator = extractComparator('Lakers spread +3.5');
    assert.strictEqual(detectMarketType('Lakers spread +3.5', comparator), UniversalMarketType.SPREAD);
  });

  it('detects TOTAL from over/under', () => {
    const comparator = extractComparator('Total points over 220');
    assert.strictEqual(detectMarketType('Total points over 220', comparator), UniversalMarketType.TOTAL);
  });

  it('detects PRICE_TARGET from crypto price', () => {
    const comparator = extractComparator('BTC above $100k');
    assert.strictEqual(detectMarketType('BTC above $100k', comparator), UniversalMarketType.PRICE_TARGET);
  });
});

// ============================================================================
// FULL EXTRACTION INTEGRATION
// ============================================================================

describe('Full Extraction Integration', () => {
  it('extracts CS2 match: Vitality vs Falcons', () => {
    const result = extractUniversalEntities('Team Vitality vs Team Falcons - CS2 Match Jan 24, 2026');

    assert.ok(result.teams.includes('TEAM_VITALITY'), 'Should extract Vitality');
    assert.ok(result.teams.includes('TEAM_FALCONS'), 'Should extract Falcons');
    assert.strictEqual(result.gameType, GameType.CS2, 'Should detect CS2');
    assert.ok(result.dates.some(d => d.month === 1 && d.day === 24), 'Should extract date');
    assert.ok(result.confidence >= 0.5, 'Should have confidence');
  });

  it('extracts Polymarket CS2 format', () => {
    // Realistic Polymarket format: full team names
    const result = extractUniversalEntities('CS2 Match - Vitality vs Falcons - 2026-01-24');

    assert.ok(result.teams.includes('TEAM_VITALITY'), 'Should extract Vitality');
    assert.ok(result.teams.includes('TEAM_FALCONS'), 'Should extract Falcons');
    assert.ok(result.dates.some(d => d.year === 2026 && d.month === 1 && d.day === 24), 'Should extract ISO date');
  });

  it('extracts Kalshi CS2 format', () => {
    // Realistic Kalshi format: includes descriptive title
    const result = extractUniversalEntities('Vitality vs Falcons - CS2 IEM Katowice - Team Falcons to win');

    assert.ok(result.teams.includes('TEAM_FALCONS'), 'Should extract Falcons');
    assert.ok(result.teams.includes('TEAM_VITALITY'), 'Should extract Vitality');
    assert.strictEqual(result.gameType, GameType.CS2, 'Should detect CS2');
  });

  it('extracts election market', () => {
    const result = extractUniversalEntities('Will Trump win the 2024 Presidential Election?');

    assert.ok(result.people.includes('DONALD_TRUMP'), 'Should extract Trump');
    assert.strictEqual(result.gameType, GameType.ELECTION, 'Should detect Election');
    assert.strictEqual(result.comparator, UniversalComparator.WIN, 'Should detect WIN comparator');
  });

  it('extracts crypto price target', () => {
    const result = extractUniversalEntities('Will ETH be above $3700 on Jan 26?');

    assert.ok(result.numbers.some(n => n.value === 3700), 'Should extract $3700');
    assert.strictEqual(result.gameType, GameType.CRYPTO, 'Should detect Crypto');
    assert.strictEqual(result.comparator, UniversalComparator.ABOVE, 'Should detect ABOVE');
    assert.ok(result.dates.some(d => d.day === 26), 'Should extract date');
  });

  it('extracts UFC fight', () => {
    const result = extractUniversalEntities('Islam Makhachev vs Charles Oliveira - UFC 300');

    assert.ok(result.teams.includes('ISLAM_MAKHACHEV'), 'Should extract Islam');
    assert.ok(result.teams.includes('CHARLES_OLIVEIRA'), 'Should extract Oliveira');
    assert.strictEqual(result.gameType, GameType.UFC, 'Should detect UFC');
  });

  it('extracts tennis match', () => {
    const result = extractUniversalEntities('Djokovic vs Sinner - Australian Open Final');

    assert.ok(result.teams.includes('NOVAK_DJOKOVIC'), 'Should extract Djokovic');
    assert.ok(result.teams.includes('JANNIK_SINNER'), 'Should extract Sinner');
    assert.strictEqual(result.gameType, GameType.TENNIS, 'Should detect Tennis');
  });

  it('extracts macro economic market', () => {
    const result = extractUniversalEntities('CPI above 3.5% in January 2026?');

    assert.ok(result.percentages.includes(3.5), 'Should extract 3.5%');
    assert.ok(result.dates.some(d => d.month === 1 && d.year === 2026), 'Should extract January 2026');
    assert.strictEqual(result.gameType, GameType.MACRO, 'Should detect Macro');
  });
});

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

describe('Utility Functions', () => {
  it('jaccardSets: identical sets', () => {
    const a = new Set(['a', 'b', 'c']);
    const b = new Set(['a', 'b', 'c']);
    assert.strictEqual(jaccardSets(a, b), 1.0);
  });

  it('jaccardSets: partial overlap', () => {
    const a = new Set(['a', 'b', 'c']);
    const b = new Set(['a', 'b', 'd']);
    assert.ok(jaccardSets(a, b) > 0.4 && jaccardSets(a, b) < 0.6);
  });

  it('jaccardSets: no overlap', () => {
    const a = new Set(['a', 'b']);
    const b = new Set(['c', 'd']);
    assert.strictEqual(jaccardSets(a, b), 0);
  });

  it('jaccardSets: arrays work', () => {
    const a = ['a', 'b', 'c'];
    const b = ['a', 'b', 'c'];
    assert.strictEqual(jaccardSets(a, b), 1.0);
  });

  it('countEntityOverlap: same entities', () => {
    const a = extractUniversalEntities('Vitality vs Falcons');
    const b = extractUniversalEntities('Team Vitality vs Team Falcons');
    assert.ok(countEntityOverlap(a, b) >= 2, 'Should have at least 2 overlapping entities');
  });

  it('countEntityOverlap: no overlap', () => {
    const a = extractUniversalEntities('Lakers vs Celtics');
    const b = extractUniversalEntities('Trump vs Biden');
    assert.strictEqual(countEntityOverlap(a, b), 0, 'Should have no overlap');
  });

  it('tokenize: handles special characters', () => {
    const tokens = tokenize("Na'Vi vs. G2-Esports");
    assert.ok(tokens.includes('na'), 'Should include na');
    assert.ok(tokens.includes('vi'), 'Should include vi');
    assert.ok(tokens.includes('g2'), 'Should include g2');
  });

  it('normalizeTitle: preserves apostrophes', () => {
    const normalized = normalizeTitle("Na'Vi vs G2");
    assert.ok(normalized.includes("na'vi"), "Should preserve apostrophe");
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('Edge Cases', () => {
  it('handles empty title', () => {
    const result = extractUniversalEntities('');
    assert.deepStrictEqual(result.teams, []);
    assert.deepStrictEqual(result.people, []);
    assert.strictEqual(result.gameType, GameType.UNKNOWN);
  });

  it('handles title with only numbers', () => {
    const result = extractUniversalEntities('$100,000 by 2026');
    assert.ok(result.numbers.some(n => n.value === 100000), 'Should extract number');
    assert.deepStrictEqual(result.teams, []);
  });

  it('handles ambiguous team name (Falcons - could be NFL or esports)', () => {
    // Without esports context, should still extract
    const result = extractUniversalEntities('Falcons game tomorrow');
    // Both NFL and esports Falcons could match
    assert.ok(result.teams.length > 0, 'Should extract some team');
  });

  it('handles mixed case sensitivity', () => {
    const result1 = extractUniversalEntities('VITALITY vs FALCONS');
    const result2 = extractUniversalEntities('vitality vs falcons');
    assert.deepStrictEqual(result1.teams.sort(), result2.teams.sort(), 'Case should not matter');
  });

  it('does not extract partial matches (Hegseth should not match ETH)', () => {
    const result = extractUniversalEntities('Pete Hegseth nomination');
    // Should not extract ETHEREUM
    assert.ok(!result.organizations.includes('ETHEREUM'), 'Should not match ETH from Hegseth');
    // Should extract Hegseth
    assert.ok(result.people.includes('PETE_HEGSETH'), 'Should extract Hegseth');
  });

  it('handles very long titles', () => {
    const longTitle = 'Will ' + 'very '.repeat(100) + 'Trump win?';
    const result = extractUniversalEntities(longTitle);
    assert.ok(result.people.includes('DONALD_TRUMP'), 'Should still extract Trump');
  });
});

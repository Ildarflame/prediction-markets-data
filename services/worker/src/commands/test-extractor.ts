/**
 * Test Universal Extractor on real market data (v3.0.16)
 */
import { getClient, type Market } from '@data-module/db';
import {
  extractUniversalEntities,
  countEntityOverlapDetailed,
  type UniversalEntities,
  type EntityOverlapResult,
} from '@data-module/core';

export interface TestExtractorOptions {
  venue?: 'polymarket' | 'kalshi';
  query?: string;
  limit?: number;
  crossMatch?: boolean;
}

export interface TestExtractorResult {
  totalMarkets: number;
  withTeams: number;
  withPeople: number;
  matches?: number;
}

export async function runTestExtractor(opts: TestExtractorOptions): Promise<TestExtractorResult> {
  const prisma = getClient();
  const limit = opts.limit ?? 10;
  const query = opts.query ?? 'vs';

  if (opts.crossMatch) {
    // Cross-venue matching test
    console.log('\n=== Cross-Venue Matching Test ===\n');

    const polymarkets = await prisma.market.findMany({
      where: {
        venue: 'polymarket',
        status: 'active',
        title: { contains: query, mode: 'insensitive' },
      },
      take: limit,
      orderBy: { updatedAt: 'desc' },
    });

    const kalshiMarkets = await prisma.market.findMany({
      where: {
        venue: 'kalshi',
        status: 'active',
        title: { contains: query, mode: 'insensitive' },
      },
      take: limit,
      orderBy: { updatedAt: 'desc' },
    });

    console.log(`Polymarket: ${polymarkets.length} markets`);
    console.log(`Kalshi: ${kalshiMarkets.length} markets`);
    console.log('');

    // Extract entities for all
    type MarketWithEntities = { market: Market; entities: UniversalEntities };
    const polyEntities: MarketWithEntities[] = polymarkets.map((m: Market) => ({
      market: m,
      entities: extractUniversalEntities(m.title),
    }));

    const kalshiEntities: MarketWithEntities[] = kalshiMarkets.map((m: Market) => ({
      market: m,
      entities: extractUniversalEntities(m.title),
    }));

    // Find potential matches
    let matchCount = 0;
    for (const p of polyEntities) {
      const pHasEntities = p.entities.teams.length > 0 || p.entities.people.length > 0 || p.entities.organizations.length > 0;
      if (!pHasEntities) continue;

      for (const k of kalshiEntities) {
        const kHasEntities = k.entities.teams.length > 0 || k.entities.people.length > 0 || k.entities.organizations.length > 0;
        if (!kHasEntities) continue;

        const overlap = countEntityOverlapDetailed(p.entities, k.entities);
        if (overlap.total >= 2) {
          matchCount++;
          // Show breakdown
          const breakdown: string[] = [];
          if (overlap.organizations > 0) breakdown.push(`orgs=${overlap.organizations}`);
          if (overlap.numbers > 0) breakdown.push(`nums=${overlap.numbers}`);
          if (overlap.dates > 0) breakdown.push(`dates=${overlap.dates}`);
          if (overlap.teams > 0) breakdown.push(`teams=${overlap.teams}`);
          if (overlap.people > 0) breakdown.push(`people=${overlap.people}`);

          console.log(`MATCH (total=${overlap.total}: ${breakdown.join(', ')}):`);
          console.log(`  Poly: ${p.market.title.substring(0, 80)}`);
          console.log(`  Kalshi: ${k.market.title.substring(0, 80)}`);
          if (overlap.matchedNumbers.length > 0) {
            console.log(`    Matched numbers: ${overlap.matchedNumbers.map(n => `${n.a.raw}≈${n.b.raw}`).join(', ')}`);
          }
          if (overlap.matchedDates.length > 0) {
            console.log(`    Matched dates: ${overlap.matchedDates.map(d => `${d.a.raw}≈${d.b.raw}`).join(', ')}`);
          }
          console.log('');
        }
      }
    }

    console.log(`Total potential matches: ${matchCount}`);

    const withTeams = polyEntities.filter((e) => e.entities.teams.length > 0).length +
      kalshiEntities.filter((e) => e.entities.teams.length > 0).length;
    const withPeople = polyEntities.filter((e) => e.entities.people.length > 0).length +
      kalshiEntities.filter((e) => e.entities.people.length > 0).length;
    const withOrgs = polyEntities.filter((e) => e.entities.organizations.length > 0).length +
      kalshiEntities.filter((e) => e.entities.organizations.length > 0).length;

    console.log(`\nStats: ${withTeams} with teams, ${withPeople} with people, ${withOrgs} with orgs`);

    return {
      totalMarkets: polymarkets.length + kalshiMarkets.length,
      withTeams,
      withPeople,
      matches: matchCount,
    };
  } else {
    // Single venue extraction test
    const venue = opts.venue ?? 'polymarket';
    console.log(`\n=== Extraction Test: ${venue} ===\n`);

    const markets = await prisma.market.findMany({
      where: {
        venue,
        status: 'active',
        title: { contains: query, mode: 'insensitive' },
      },
      take: limit,
      orderBy: { updatedAt: 'desc' },
    });

    console.log(`Found ${markets.length} markets with "${query}" in title\n`);

    let withTeams = 0;
    let withPeople = 0;

    for (const m of markets) {
      const e = extractUniversalEntities(m.title);
      if (e.teams.length > 0) withTeams++;
      if (e.people.length > 0) withPeople++;

      console.log(`Title: ${m.title.substring(0, 80)}`);
      console.log(`  Teams: ${e.teams.join(', ') || 'none'}`);
      console.log(`  People: ${e.people.join(', ') || 'none'}`);
      console.log(`  Orgs: ${e.organizations.join(', ') || 'none'}`);
      console.log(`  Game: ${e.gameType}, Market: ${e.marketType}`);
      console.log(`  Comparator: ${e.comparator}`);
      console.log('');
    }

    return {
      totalMarkets: markets.length,
      withTeams,
      withPeople,
    };
  }
}

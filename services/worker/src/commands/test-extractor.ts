/**
 * Test Universal Extractor on real market data (v3.0.16)
 */
import { getClient, type Market } from '@data-module/db';
import {
  extractUniversalEntities,
  countEntityOverlap,
  type UniversalEntities,
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
      if (p.entities.teams.length === 0 && p.entities.people.length === 0) continue;

      for (const k of kalshiEntities) {
        if (k.entities.teams.length === 0 && k.entities.people.length === 0) continue;

        const overlap = countEntityOverlap(p.entities, k.entities);
        if (overlap >= 2) {
          matchCount++;
          console.log(`MATCH (overlap=${overlap}):`);
          console.log(`  Poly: ${p.market.title.substring(0, 70)}`);
          console.log(`    Teams: ${p.entities.teams.join(', ') || 'none'}`);
          console.log(`    People: ${p.entities.people.join(', ') || 'none'}`);
          console.log(`  Kalshi: ${k.market.title.substring(0, 70)}`);
          console.log(`    Teams: ${k.entities.teams.join(', ') || 'none'}`);
          console.log(`    People: ${k.entities.people.join(', ') || 'none'}`);
          console.log('');
        }
      }
    }

    console.log(`Total potential matches: ${matchCount}`);

    return {
      totalMarkets: polymarkets.length + kalshiMarkets.length,
      withTeams: polyEntities.filter((e) => e.entities.teams.length > 0).length +
        kalshiEntities.filter((e) => e.entities.teams.length > 0).length,
      withPeople: polyEntities.filter((e) => e.entities.people.length > 0).length +
        kalshiEntities.filter((e) => e.entities.people.length > 0).length,
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

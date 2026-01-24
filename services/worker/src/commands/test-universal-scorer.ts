/**
 * Test Universal Scorer on real market data (v3.0.16)
 *
 * Usage:
 *   pnpm --filter @data-module/worker test:universal-scorer --query "vs" --limit 50
 *   pnpm --filter @data-module/worker test:universal-scorer --cross-match --limit 100
 */
import { getClient } from '@data-module/db';
import {
  extractUniversalEntities,
  countEntityOverlapDetailed,
} from '@data-module/core';
import {
  scoreUniversal,
  SCORE_THRESHOLDS,
} from '../matching/universalScorer.js';

export interface TestUniversalScorerOptions {
  query?: string;
  limit?: number;
  crossMatch?: boolean;
  minScore?: number;
}

export interface TestUniversalScorerResult {
  polymarketCount: number;
  kalshiCount: number;
  matchesFound: number;
  autoConfirmable: number;
  scoreDistribution: {
    above90: number;
    above80: number;
    above70: number;
    above60: number;
    below60: number;
  };
}

export async function runTestUniversalScorer(
  opts: TestUniversalScorerOptions
): Promise<TestUniversalScorerResult> {
  const prisma = getClient();
  const limit = opts.limit ?? 50;
  const query = opts.query ?? 'vs';
  const minScore = opts.minScore ?? 0.50;

  console.log('\n=== Universal Scorer Test ===\n');

  // Fetch markets from both venues
  const polymarkets = await prisma.market.findMany({
    where: {
      venue: 'polymarket',
      status: 'active',
      title: { contains: query, mode: 'insensitive' },
    },
    take: limit,
    orderBy: { updatedAt: 'desc' },
    include: { outcomes: true },
  });

  const kalshiMarkets = await prisma.market.findMany({
    where: {
      venue: 'kalshi',
      status: 'active',
      title: { contains: query, mode: 'insensitive' },
    },
    take: limit,
    orderBy: { updatedAt: 'desc' },
    include: { outcomes: true },
  });

  // Filter to binary markets
  const polyBinary = polymarkets.filter(
    m => m.outcomes.length === 2 &&
    m.outcomes.some(o => o.side === 'yes') &&
    m.outcomes.some(o => o.side === 'no')
  );

  const kalshiBinary = kalshiMarkets.filter(
    m => m.outcomes.length === 2 &&
    m.outcomes.some(o => o.side === 'yes') &&
    m.outcomes.some(o => o.side === 'no')
  );

  console.log(`Polymarket: ${polyBinary.length} binary markets (of ${polymarkets.length} total)`);
  console.log(`Kalshi: ${kalshiBinary.length} binary markets (of ${kalshiMarkets.length} total)`);
  console.log('');

  // Extract entities for all markets
  const polyWithEntities = polyBinary.map(m => ({
    market: {
      id: m.id,
      title: m.title,
      venue: m.venue,
      status: m.status,
      closeTime: m.closeTime,
      category: m.category,
    },
    entities: extractUniversalEntities(m.title, m.closeTime),
  }));

  const kalshiWithEntities = kalshiBinary.map(m => ({
    market: {
      id: m.id,
      title: m.title,
      venue: m.venue,
      status: m.status,
      closeTime: m.closeTime,
      category: m.category,
    },
    entities: extractUniversalEntities(m.title, m.closeTime),
  }));

  // Count entities extracted
  const polyWithTeams = polyWithEntities.filter(e => e.entities.teams.length > 0).length;
  const polyWithPeople = polyWithEntities.filter(e => e.entities.people.length > 0).length;
  const polyWithOrgs = polyWithEntities.filter(e => e.entities.organizations.length > 0).length;

  const kalshiWithTeams = kalshiWithEntities.filter(e => e.entities.teams.length > 0).length;
  const kalshiWithPeople = kalshiWithEntities.filter(e => e.entities.people.length > 0).length;
  const kalshiWithOrgs = kalshiWithEntities.filter(e => e.entities.organizations.length > 0).length;

  console.log('Entity extraction stats:');
  console.log(`  Polymarket: ${polyWithTeams} with teams, ${polyWithPeople} with people, ${polyWithOrgs} with orgs`);
  console.log(`  Kalshi: ${kalshiWithTeams} with teams, ${kalshiWithPeople} with people, ${kalshiWithOrgs} with orgs`);
  console.log('');

  // Cross-match using Universal Scorer
  const matches: Array<{
    poly: typeof polyWithEntities[0];
    kalshi: typeof kalshiWithEntities[0];
    score: number;
    reason: string;
    autoConfirmable: boolean;
  }> = [];

  const scoreDistribution = {
    above90: 0,
    above80: 0,
    above70: 0,
    above60: 0,
    below60: 0,
  };

  for (const p of polyWithEntities) {
    for (const k of kalshiWithEntities) {
      // Quick overlap check first
      const overlap = countEntityOverlapDetailed(p.entities, k.entities);
      if (overlap.total < 1 && p.entities.tokens.filter(t => k.entities.tokens.includes(t)).length < 3) {
        continue; // Skip if no overlap
      }

      // Full scoring
      const result = scoreUniversal(
        { market: p.market as any, entities: p.entities },
        { market: k.market as any, entities: k.entities }
      );

      // Track distribution
      if (result.score >= 0.90) scoreDistribution.above90++;
      else if (result.score >= 0.80) scoreDistribution.above80++;
      else if (result.score >= 0.70) scoreDistribution.above70++;
      else if (result.score >= 0.60) scoreDistribution.above60++;
      else scoreDistribution.below60++;

      // Record if above threshold
      if (result.score >= minScore) {
        const autoConfirmable = result.score >= SCORE_THRESHOLDS.AUTO_CONFIRM &&
          result.matchedEntities.length >= 1;

        matches.push({
          poly: p,
          kalshi: k,
          score: result.score,
          reason: result.reason,
          autoConfirmable,
        });
      }
    }
  }

  // Sort by score descending
  matches.sort((a, b) => b.score - a.score);

  // Print results
  console.log('=== TOP MATCHES ===\n');

  const topMatches = matches.slice(0, 20);
  for (const match of topMatches) {
    const confirmStr = match.autoConfirmable ? ' [AUTO-CONFIRM]' : '';
    console.log(`Score: ${(match.score * 100).toFixed(1)}%${confirmStr}`);
    console.log(`  Poly: ${match.poly.market.title.substring(0, 80)}`);
    console.log(`  Kalshi: ${match.kalshi.market.title.substring(0, 80)}`);
    console.log(`  ${match.reason}`);
    console.log('');
  }

  // Summary
  console.log('=== SUMMARY ===\n');
  console.log(`Total comparisons: ${polyWithEntities.length * kalshiWithEntities.length}`);
  console.log(`Matches found (>=${(minScore * 100).toFixed(0)}%): ${matches.length}`);
  console.log(`Auto-confirmable (>=${(SCORE_THRESHOLDS.AUTO_CONFIRM * 100).toFixed(0)}%): ${matches.filter(m => m.autoConfirmable).length}`);
  console.log('');
  console.log('Score distribution:');
  console.log(`  ≥90%: ${scoreDistribution.above90}`);
  console.log(`  80-89%: ${scoreDistribution.above80}`);
  console.log(`  70-79%: ${scoreDistribution.above70}`);
  console.log(`  60-69%: ${scoreDistribution.above60}`);
  console.log(`  <60%: ${scoreDistribution.below60}`);

  return {
    polymarketCount: polyBinary.length,
    kalshiCount: kalshiBinary.length,
    matchesFound: matches.length,
    autoConfirmable: matches.filter(m => m.autoConfirmable).length,
    scoreDistribution,
  };
}

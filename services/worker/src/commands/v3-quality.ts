/**
 * V3 Quality Commands (v3.0.9)
 *
 * v3:best  - Show top matches by score for a topic
 * v3:worst - Show worst matches by score for a topic (potential false positives)
 */

import { getClient, type Venue } from '@data-module/db';
import { CanonicalTopic } from '@data-module/core';

export interface V3QualityOptions {
  /** Topic to analyze */
  topic: CanonicalTopic;
  /** Minimum score threshold (for best) */
  minScore?: number;
  /** Maximum score threshold (for worst) */
  maxScore?: number;
  /** Limit results */
  limit?: number;
  /** Left venue */
  leftVenue?: Venue;
  /** Right venue */
  rightVenue?: Venue;
  /** Filter by status */
  status?: 'suggested' | 'confirmed' | 'rejected' | 'all';
}

export interface V3QualityMatch {
  linkId: number;
  leftId: number;
  rightId: number;
  leftTitle: string;
  rightTitle: string;
  score: number;
  status: string;
  algoVersion: string | null;
  reason: string | null;
  createdAt: Date;
}

export interface V3QualityResult {
  ok: boolean;
  topic: CanonicalTopic;
  mode: 'best' | 'worst';
  matches: V3QualityMatch[];
  totalCount: number;
}

/**
 * Get best matches for a topic
 */
export async function runV3Best(options: V3QualityOptions): Promise<V3QualityResult> {
  const {
    topic,
    minScore = 0.9,
    limit = 50,
    leftVenue = 'polymarket',
    rightVenue = 'kalshi',
    status = 'all',
  } = options;

  console.log(`\n=== V3 Best Matches (v3.0.9) ===\n`);
  console.log(`Topic:     ${topic}`);
  console.log(`Min score: ${minScore}`);
  console.log(`Limit:     ${limit}`);
  console.log(`Venues:    ${leftVenue} ↔ ${rightVenue}`);
  if (status !== 'all') console.log(`Status:    ${status}`);
  console.log();

  const prisma = getClient();

  // Build where clause (handle mixed-case topic values in DB)
  const topicVariants = [topic, topic.toLowerCase(), topic.toUpperCase()];
  const whereClause: any = {
    topic: { in: topicVariants },
    score: { gte: minScore },
    leftVenue: leftVenue,
    rightVenue: rightVenue,
  };

  if (status !== 'all') {
    whereClause.status = status;
  }

  // Get total count
  const totalCount = await prisma.marketLink.count({ where: whereClause });

  // Get matches
  const links = await prisma.marketLink.findMany({
    where: whereClause,
    include: {
      leftMarket: { select: { id: true, title: true, venue: true, derivedTopic: true } },
      rightMarket: { select: { id: true, title: true, venue: true, derivedTopic: true } },
    },
    orderBy: { score: 'desc' },
    take: limit,
  });

  const matches: V3QualityMatch[] = links.map(link => ({
    linkId: link.id,
    leftId: link.leftMarketId,
    rightId: link.rightMarketId,
    leftTitle: link.leftMarket.title,
    rightTitle: link.rightMarket.title,
    score: link.score,
    status: link.status,
    algoVersion: link.algoVersion,
    reason: link.reason,
    createdAt: link.createdAt,
  }));

  // Print results
  console.log(`--- Best Matches (${matches.length}/${totalCount} total) ---\n`);

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    console.log(`[${i + 1}] Score: ${m.score.toFixed(3)} | Status: ${m.status} | Algo: ${m.algoVersion || 'N/A'}`);
    console.log(`    Left:  [${m.leftId}] ${m.leftTitle.substring(0, 60)}...`);
    console.log(`    Right: [${m.rightId}] ${m.rightTitle.substring(0, 60)}...`);

    if (m.reason) {
      console.log(`    Reason: ${m.reason}`);
    }
    console.log();
  }

  console.log(`\nTotal matches with score >= ${minScore}: ${totalCount}`);

  return {
    ok: true,
    topic,
    mode: 'best',
    matches,
    totalCount,
  };
}

/**
 * Get worst matches for a topic (potential false positives)
 */
export async function runV3Worst(options: V3QualityOptions): Promise<V3QualityResult> {
  const {
    topic,
    maxScore = 0.6,
    limit = 50,
    leftVenue = 'polymarket',
    rightVenue = 'kalshi',
    status = 'all',
  } = options;

  console.log(`\n=== V3 Worst Matches (v3.0.9) ===\n`);
  console.log(`Topic:     ${topic}`);
  console.log(`Max score: ${maxScore}`);
  console.log(`Limit:     ${limit}`);
  console.log(`Venues:    ${leftVenue} ↔ ${rightVenue}`);
  if (status !== 'all') console.log(`Status:    ${status}`);
  console.log();

  const prisma = getClient();

  // Build where clause (handle mixed-case topic values in DB)
  const topicVariants = [topic, topic.toLowerCase(), topic.toUpperCase()];
  const whereClause: any = {
    topic: { in: topicVariants },
    score: { lte: maxScore, gt: 0 },
    leftVenue: leftVenue,
    rightVenue: rightVenue,
  };

  if (status !== 'all') {
    whereClause.status = status;
  }

  // Get total count
  const totalCount = await prisma.marketLink.count({ where: whereClause });

  // Get matches
  const links = await prisma.marketLink.findMany({
    where: whereClause,
    include: {
      leftMarket: { select: { id: true, title: true, venue: true, derivedTopic: true } },
      rightMarket: { select: { id: true, title: true, venue: true, derivedTopic: true } },
    },
    orderBy: { score: 'asc' },
    take: limit,
  });

  const matches: V3QualityMatch[] = links.map(link => ({
    linkId: link.id,
    leftId: link.leftMarketId,
    rightId: link.rightMarketId,
    leftTitle: link.leftMarket.title,
    rightTitle: link.rightMarket.title,
    score: link.score,
    status: link.status,
    algoVersion: link.algoVersion,
    reason: link.reason,
    createdAt: link.createdAt,
  }));

  // Print results
  console.log(`--- Worst Matches (${matches.length}/${totalCount} total) ---\n`);

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    console.log(`[${i + 1}] Score: ${m.score.toFixed(3)} | Status: ${m.status} | Algo: ${m.algoVersion || 'N/A'}`);
    console.log(`    Left:  [${m.leftId}] ${m.leftTitle.substring(0, 60)}...`);
    console.log(`    Right: [${m.rightId}] ${m.rightTitle.substring(0, 60)}...`);

    if (m.reason) {
      console.log(`    Reason: ${m.reason}`);
    }
    console.log();
  }

  console.log(`\nTotal matches with score <= ${maxScore}: ${totalCount}`);

  // Diagnosis for worst matches
  if (matches.length > 0) {
    console.log('\n--- Diagnosis ---\n');
    console.log('Low-score matches may indicate:');
    console.log('  • Different underlying assets or indicators');
    console.log('  • Date/time mismatches');
    console.log('  • Different market intents (e.g., above vs below)');
    console.log('\nConsider:');
    console.log('  → Review and reject false positives');
    console.log('  → Adjust hard gates if too permissive');
    console.log('  → Increase min_score threshold');
  }

  return {
    ok: true,
    topic,
    mode: 'worst',
    matches,
    totalCount,
  };
}

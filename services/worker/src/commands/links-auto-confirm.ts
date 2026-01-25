/**
 * links:auto-confirm - Automatically confirm high-quality links (v2.6.8)
 *
 * Uses SAFE_RULES to ensure only valid matches are confirmed.
 *
 * Run: pnpm --filter @data-module/worker links:auto-confirm --topic crypto_daily --dry-run
 * Run: pnpm --filter @data-module/worker links:auto-confirm --topic all --apply
 */

import { getClient, type LinkStatus } from '@data-module/db';
import {
  evaluateSafeRules,
  formatEvaluation,
  DEFAULT_MIN_SCORES,
  type Topic,
} from '../ops/safe-rules.js';

export interface AutoConfirmOptions {
  topic: Topic | 'all';
  minScore?: number;
  limit?: number;
  dryRun?: boolean;
  apply?: boolean;
  explain?: boolean;
}

export interface AutoConfirmResult {
  topic: Topic | 'all';
  dryRun: boolean;
  candidates: number;
  confirmed: number;
  skipped: number;
  avgScore: number;
  byTopic: Record<string, { confirmed: number; skipped: number }>;
  byRule: Record<string, number>;
}

// v3.1.0: Added ELECTIONS, GEOPOLITICS, ENTERTAINMENT, FINANCE, RATES, CLIMATE, COMMODITIES, SPORTS
const TOPICS: Topic[] = [
  'crypto_daily',
  'crypto_intraday',
  'macro',
  'rates',
  'elections',
  'geopolitics',
  'entertainment',
  'finance',
  'climate',
  'commodities',
  'sports',
];

export async function runAutoConfirm(
  options: AutoConfirmOptions
): Promise<AutoConfirmResult> {
  const {
    topic,
    minScore,
    limit = 500,
    dryRun = true,
    apply = false,
    explain = false,
  } = options;

  // --apply overrides --dry-run
  const effectiveDryRun = apply ? false : dryRun;

  const prisma = getClient();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[links:auto-confirm] Auto-Confirm Links (v2.6.8)`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Topic: ${topic}`);
  console.log(`Min Score: ${minScore ?? 'default per topic'}`);
  console.log(`Limit: ${limit}`);
  console.log(`Mode: ${effectiveDryRun ? 'DRY RUN' : '⚠️  APPLY (will confirm)'}`);
  if (explain) console.log(`Explain: enabled (showing rule details)`);
  console.log();

  // Determine which topics to process
  const topicsToProcess = topic === 'all' ? TOPICS : [topic];

  let totalCandidates = 0;
  let totalConfirmed = 0;
  let totalSkipped = 0;
  let scoreSum = 0;
  const byTopic: Record<string, { confirmed: number; skipped: number }> = {};
  const byRule: Record<string, number> = {};

  for (const currentTopic of topicsToProcess) {
    console.log(`[${currentTopic}] Processing...`);

    const effectiveMinScore = minScore ?? DEFAULT_MIN_SCORES[currentTopic];

    // Fetch suggested links for this topic
    const links = await prisma.marketLink.findMany({
      where: {
        status: 'suggested' as LinkStatus,
        topic: currentTopic,
        score: { gte: effectiveMinScore },
      },
      include: {
        leftMarket: { include: { outcomes: true } },
        rightMarket: { include: { outcomes: true } },
      },
      orderBy: { score: 'desc' },
      take: limit,
    });

    console.log(`  Found ${links.length} candidates (score >= ${effectiveMinScore})`);

    byTopic[currentTopic] = { confirmed: 0, skipped: 0 };
    let topicConfirmed = 0;
    let topicSkipped = 0;

    for (const link of links) {
      totalCandidates++;
      scoreSum += link.score;

      // Evaluate safe rules
      const evaluation = evaluateSafeRules(link, currentTopic, effectiveMinScore);

      if (explain) {
        console.log();
        console.log(`  [Link ${link.id}] score=${link.score.toFixed(3)}`);
        console.log(`    L: ${link.leftMarket.title.slice(0, 50)}...`);
        console.log(`    R: ${link.rightMarket.title.slice(0, 50)}...`);
        console.log(formatEvaluation(evaluation).split('\n').map(l => '    ' + l).join('\n'));
      }

      if (evaluation.pass) {
        topicConfirmed++;
        totalConfirmed++;

        if (!effectiveDryRun) {
          const confirmReason = `auto_confirm@2.6.8:${currentTopic}:SAFE_RULES`;
          await prisma.marketLink.update({
            where: { id: link.id },
            data: {
              status: 'confirmed',
              reason: confirmReason,
            },
          });
        }

        // Track which rules were evaluated
        for (const ruleId of evaluation.passedRules) {
          byRule[ruleId] = (byRule[ruleId] || 0) + 1;
        }
      } else {
        topicSkipped++;
        totalSkipped++;

        // Track which rules failed
        for (const ruleId of evaluation.failedRules) {
          byRule[`FAIL:${ruleId}`] = (byRule[`FAIL:${ruleId}`] || 0) + 1;
        }
      }
    }

    byTopic[currentTopic] = { confirmed: topicConfirmed, skipped: topicSkipped };
    console.log(`  [${currentTopic}] Confirmed: ${topicConfirmed}, Skipped: ${topicSkipped}`);
  }

  // Summary
  console.log();
  console.log(`${'='.repeat(60)}`);
  console.log(`[Summary]`);
  console.log(`  Candidates evaluated: ${totalCandidates}`);
  console.log(`  Would confirm:        ${totalConfirmed}`);
  console.log(`  Skipped (rules):      ${totalSkipped}`);
  console.log(`  Avg score:            ${totalCandidates > 0 ? (scoreSum / totalCandidates).toFixed(3) : 'N/A'}`);
  console.log();

  console.log(`[By Topic]`);
  for (const [t, stats] of Object.entries(byTopic)) {
    console.log(`  ${t.padEnd(18)} confirmed=${String(stats.confirmed).padStart(4)} skipped=${String(stats.skipped).padStart(4)}`);
  }
  console.log();

  console.log(`[By Rule]`);
  const sortedRules = Object.entries(byRule).sort((a, b) => b[1] - a[1]);
  for (const [rule, count] of sortedRules.slice(0, 15)) {
    console.log(`  ${rule.padEnd(25)} ${String(count).padStart(5)}`);
  }

  if (effectiveDryRun) {
    console.log();
    console.log(`[DRY RUN] No changes made. Use --apply to confirm links.`);
  } else {
    console.log();
    console.log(`[APPLIED] Confirmed ${totalConfirmed} links.`);
  }

  return {
    topic,
    dryRun: effectiveDryRun,
    candidates: totalCandidates,
    confirmed: totalConfirmed,
    skipped: totalSkipped,
    avgScore: totalCandidates > 0 ? scoreSum / totalCandidates : 0,
    byTopic,
    byRule,
  };
}

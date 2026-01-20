import {
  buildFingerprint,
  extractPeriod,
  type MacroPeriod,
} from '@data-module/core';
import {
  getClient,
  MarketLinkRepository,
  type LinkStatus,
} from '@data-module/db';

/**
 * Format time difference in hours
 */
function formatTimeDiff(a: Date | null, b: Date | null): string {
  if (!a || !b) return 'N/A';

  const diffMs = Math.abs(a.getTime() - b.getTime());
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffHours < 1) return '<1h';
  if (diffHours < 24) return `${Math.round(diffHours)}h`;
  return `${Math.round(diffHours / 24)}d`;
}

/**
 * Truncate string with ellipsis
 */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

/**
 * Build period key string from MacroPeriod
 */
function buildPeriodKey(period: MacroPeriod): string {
  if (!period.type || !period.year) return '-';

  if (period.type === 'month' && period.month) {
    return `${period.year}-${String(period.month).padStart(2, '0')}`;
  } else if (period.type === 'quarter' && period.quarter) {
    return `${period.year}-Q${period.quarter}`;
  } else if (period.type === 'year') {
    return `${period.year}`;
  }
  return '-';
}

/**
 * Extract entity from market title
 */
function extractEntity(title: string, closeTime: Date | null): string {
  const fingerprint = buildFingerprint(title, closeTime, {});
  if (fingerprint.macroEntities?.size) {
    return Array.from(fingerprint.macroEntities).join(',');
  }
  return '-';
}

/**
 * Extract period from market title
 */
function extractPeriodKey(title: string, closeTime: Date | null): string {
  const period = extractPeriod(title, closeTime);
  return buildPeriodKey(period);
}

export interface ListSuggestionsOptions {
  minScore?: number;
  status?: LinkStatus;
  limit?: number;
}

/**
 * List market link suggestions
 */
export async function runListSuggestions(options: ListSuggestionsOptions = {}): Promise<void> {
  const { minScore = 0, status, limit = 50 } = options;

  const prisma = getClient();
  const linkRepo = new MarketLinkRepository(prisma);

  console.log(`[matching] Listing suggestions (minScore=${minScore}, status=${status || 'all'}, limit=${limit})\n`);

  const links = await linkRepo.listSuggestions({
    minScore,
    status,
    limit,
  });

  if (links.length === 0) {
    console.log('No suggestions found.');
    return;
  }

  // Print header: id | score | entity | periodLeft | periodRight | leftTitle | rightTitle | reason
  console.log('ID    | Score | Entity     | PeriodL  | PeriodR  | Left Title              | Right Title             | Reason');
  console.log('-'.repeat(140));

  for (const link of links) {
    const entity = truncate(extractEntity(link.leftMarket.title, link.leftMarket.closeTime), 10);
    const periodLeft = extractPeriodKey(link.leftMarket.title, link.leftMarket.closeTime);
    const periodRight = extractPeriodKey(link.rightMarket.title, link.rightMarket.closeTime);
    const leftTitle = truncate(link.leftMarket.title, 23);
    const rightTitle = truncate(link.rightMarket.title, 23);
    const reason = link.reason ? truncate(link.reason, 30) : 'N/A';

    console.log(
      `${String(link.id).padStart(5)} | ${link.score.toFixed(2).padStart(5)} | ${entity.padEnd(10)} | ${periodLeft.padEnd(8)} | ${periodRight.padEnd(8)} | ${leftTitle.padEnd(23)} | ${rightTitle.padEnd(23)} | ${reason}`
    );
  }

  console.log('-'.repeat(140));
  console.log(`Total: ${links.length} suggestions`);

  // Show counts by status
  const counts = await linkRepo.countByStatus();
  console.log(`\nBy status: suggested=${counts.suggested}, confirmed=${counts.confirmed}, rejected=${counts.rejected}`);
}

/**
 * Show details of a market link
 */
export async function runShowLink(id: number): Promise<void> {
  const prisma = getClient();
  const linkRepo = new MarketLinkRepository(prisma);

  const link = await linkRepo.getById(id);

  if (!link) {
    console.error(`Link #${id} not found`);
    return;
  }

  // Extract fingerprints for both markets
  const leftFingerprint = buildFingerprint(link.leftMarket.title, link.leftMarket.closeTime, {});
  const rightFingerprint = buildFingerprint(link.rightMarket.title, link.rightMarket.closeTime, {});
  const leftPeriod = extractPeriod(link.leftMarket.title, link.leftMarket.closeTime);
  const rightPeriod = extractPeriod(link.rightMarket.title, link.rightMarket.closeTime);

  console.log(`\n=== Market Link #${link.id} ===\n`);

  // Show key matching info at top
  console.log(`Reason: ${link.reason || 'N/A'}`);
  console.log(`Score: ${link.score.toFixed(4)}`);
  console.log(`Status: ${link.status}`);

  // Show entities
  const leftEntities = leftFingerprint.macroEntities?.size
    ? Array.from(leftFingerprint.macroEntities).join(', ')
    : 'none';
  const rightEntities = rightFingerprint.macroEntities?.size
    ? Array.from(rightFingerprint.macroEntities).join(', ')
    : 'none';
  console.log(`\nEntities:`);
  console.log(`  Left:  ${leftEntities}`);
  console.log(`  Right: ${rightEntities}`);

  // Show periods
  console.log(`\nPeriods:`);
  console.log(`  Left:  ${buildPeriodKey(leftPeriod)}`);
  console.log(`  Right: ${buildPeriodKey(rightPeriod)}`);

  // Time difference
  const timeDiff = formatTimeDiff(link.leftMarket.closeTime, link.rightMarket.closeTime);
  console.log(`  Close Time Diff: ${timeDiff}`);

  console.log(`\nCreated: ${link.createdAt.toISOString()}`);
  console.log(`Updated: ${link.updatedAt.toISOString()}`);

  console.log(`\n--- Left Market (${link.leftVenue}) ---`);
  console.log(`ID: ${link.leftMarket.id}`);
  console.log(`External ID: ${link.leftMarket.externalId}`);
  console.log(`Title: ${link.leftMarket.title}`);
  console.log(`Category: ${link.leftMarket.category || 'N/A'}`);
  console.log(`Status: ${link.leftMarket.status}`);
  console.log(`Close Time: ${link.leftMarket.closeTime?.toISOString() || 'N/A'}`);
  console.log(`Outcomes: ${link.leftMarket.outcomes.length}`);
  for (const o of link.leftMarket.outcomes) {
    console.log(`  - ${o.name} (${o.side})`);
  }

  console.log(`\n--- Right Market (${link.rightVenue}) ---`);
  console.log(`ID: ${link.rightMarket.id}`);
  console.log(`External ID: ${link.rightMarket.externalId}`);
  console.log(`Title: ${link.rightMarket.title}`);
  console.log(`Category: ${link.rightMarket.category || 'N/A'}`);
  console.log(`Status: ${link.rightMarket.status}`);
  console.log(`Close Time: ${link.rightMarket.closeTime?.toISOString() || 'N/A'}`);
  console.log(`Outcomes: ${link.rightMarket.outcomes.length}`);
  for (const o of link.rightMarket.outcomes) {
    console.log(`  - ${o.name} (${o.side})`);
  }
}

/**
 * Confirm a market link
 */
export async function runConfirmMatch(id: number): Promise<void> {
  const prisma = getClient();
  const linkRepo = new MarketLinkRepository(prisma);

  const link = await linkRepo.getById(id);

  if (!link) {
    console.error(`Link #${id} not found`);
    return;
  }

  if (link.status === 'confirmed') {
    console.log(`Link #${id} is already confirmed`);
    return;
  }

  const updated = await linkRepo.confirm(id);
  console.log(`Link #${id} confirmed`);
  console.log(`  Left: ${truncate(link.leftMarket.title, 50)} (${link.leftVenue})`);
  console.log(`  Right: ${truncate(link.rightMarket.title, 50)} (${link.rightVenue})`);
  console.log(`  Score: ${updated.score.toFixed(4)}`);
}

/**
 * Reject a market link
 */
export async function runRejectMatch(id: number): Promise<void> {
  const prisma = getClient();
  const linkRepo = new MarketLinkRepository(prisma);

  const link = await linkRepo.getById(id);

  if (!link) {
    console.error(`Link #${id} not found`);
    return;
  }

  if (link.status === 'rejected') {
    console.log(`Link #${id} is already rejected`);
    return;
  }

  if (link.status === 'confirmed') {
    console.log(`Warning: Link #${id} was confirmed, now rejecting`);
  }

  await linkRepo.reject(id);
  console.log(`Link #${id} rejected`);
  console.log(`  Left: ${truncate(link.leftMarket.title, 50)} (${link.leftVenue})`);
  console.log(`  Right: ${truncate(link.rightMarket.title, 50)} (${link.rightVenue})`);
}

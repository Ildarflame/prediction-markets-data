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

  // Print header
  console.log('ID    | Score | Status     | Left Title                    | Right Title                   | Reason');
  console.log('-'.repeat(130));

  for (const link of links) {
    const leftTitle = truncate(link.leftMarket.title, 28);
    const rightTitle = truncate(link.rightMarket.title, 28);
    const reason = link.reason ? truncate(link.reason, 40) : 'N/A';

    console.log(
      `${String(link.id).padStart(5)} | ${link.score.toFixed(2).padStart(5)} | ${link.status.padEnd(10)} | ${leftTitle.padEnd(29)} | ${rightTitle.padEnd(29)} | ${reason}`
    );
  }

  console.log('-'.repeat(130));
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

  console.log(`\n=== Market Link #${link.id} ===\n`);
  console.log(`Status: ${link.status}`);
  console.log(`Score: ${link.score.toFixed(4)}`);
  console.log(`Reason: ${link.reason || 'N/A'}`);
  console.log(`Created: ${link.createdAt.toISOString()}`);
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

  // Time difference
  const timeDiff = formatTimeDiff(link.leftMarket.closeTime, link.rightMarket.closeTime);
  console.log(`\nClose Time Difference: ${timeDiff}`);
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

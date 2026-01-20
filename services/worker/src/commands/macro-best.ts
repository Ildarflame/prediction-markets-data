import {
  buildFingerprint,
  extractPeriod,
  type MacroPeriod,
} from '@data-module/core';
import {
  getClient,
  MarketLinkRepository,
} from '@data-module/db';

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

/**
 * Extract tier from reason string (v2.4.5)
 * Parses "tier=STRONG" or "tier=WEAK" from reason
 */
function extractTier(reason: string | null): 'STRONG' | 'WEAK' | null {
  if (!reason) return null;
  const match = reason.match(/tier=(STRONG|WEAK)/);
  return match ? (match[1] as 'STRONG' | 'WEAK') : null;
}

export interface MacroBestOptions {
  /** Minimum score filter (default: 0.85) */
  minScore?: number;
  /** Only STRONG tier (default: true) */
  onlyStrong?: boolean;
  /** Maximum results (default: 50) */
  limit?: number;
  /** Auto-confirm the selected matches (default: false = dry-run) */
  apply?: boolean;
}

export interface MacroBestResult {
  shown: number;
  confirmed: number;
  skippedWeak: number;
}

/**
 * Show and optionally confirm the best high-score STRONG suggestions (v2.4.5)
 *
 * This is a helper for quickly selecting the highest quality macro matches.
 * By default runs in dry-run mode (just shows). Use --apply to auto-confirm.
 */
export async function runMacroBest(options: MacroBestOptions = {}): Promise<MacroBestResult> {
  const { minScore = 0.85, onlyStrong = true, limit = 50, apply = false } = options;

  const prisma = getClient();
  const linkRepo = new MarketLinkRepository(prisma);

  const mode = apply ? 'APPLY' : 'DRY-RUN';
  console.log(`[macro:best] ${mode} mode - minScore=${minScore}, onlyStrong=${onlyStrong}, limit=${limit}\n`);

  // Fetch suggestions with high score
  const fetchLimit = onlyStrong ? limit * 3 : limit;
  const allLinks = await linkRepo.listSuggestions({
    minScore,
    status: 'suggested', // only suggested status
    limit: fetchLimit,
  });

  // Filter by tier if onlyStrong
  let links = allLinks;
  let skippedWeak = 0;
  if (onlyStrong) {
    links = allLinks.filter(link => {
      const tier = extractTier(link.reason);
      if (tier === 'WEAK') {
        skippedWeak++;
        return false;
      }
      // Include STRONG or pre-2.4.5 suggestions (no tier)
      return true;
    });
  }

  // Apply limit
  if (links.length > limit) {
    links = links.slice(0, limit);
  }

  if (links.length === 0) {
    if (skippedWeak > 0) {
      console.log(`No high-score STRONG suggestions found. (${skippedWeak} WEAK skipped)`);
    } else {
      console.log('No suggestions found matching criteria.');
    }
    return { shown: 0, confirmed: 0, skippedWeak };
  }

  // Print header
  console.log('ID    | Score | Tier   | Entity     | PeriodL  | PeriodR  | Left Title              | Right Title');
  console.log('-'.repeat(130));

  for (const link of links) {
    const tier = extractTier(link.reason) || '-';
    const entity = truncate(extractEntity(link.leftMarket.title, link.leftMarket.closeTime), 10);
    const periodLeft = extractPeriodKey(link.leftMarket.title, link.leftMarket.closeTime);
    const periodRight = extractPeriodKey(link.rightMarket.title, link.rightMarket.closeTime);
    const leftTitle = truncate(link.leftMarket.title, 23);
    const rightTitle = truncate(link.rightMarket.title, 23);

    console.log(
      `${String(link.id).padStart(5)} | ${link.score.toFixed(2).padStart(5)} | ${tier.padEnd(6)} | ${entity.padEnd(10)} | ${periodLeft.padEnd(8)} | ${periodRight.padEnd(8)} | ${leftTitle.padEnd(23)} | ${rightTitle.padEnd(23)}`
    );
  }

  console.log('-'.repeat(130));
  console.log(`Found: ${links.length} high-quality suggestions`);
  if (skippedWeak > 0) {
    console.log(`Skipped: ${skippedWeak} WEAK tier suggestions`);
  }

  // If apply mode, confirm all
  let confirmed = 0;
  if (apply) {
    console.log(`\nConfirming ${links.length} matches...`);
    for (const link of links) {
      try {
        await linkRepo.confirm(link.id);
        confirmed++;
        console.log(`  Confirmed #${link.id}`);
      } catch (err) {
        console.error(`  Failed to confirm #${link.id}: ${err}`);
      }
    }
    console.log(`\nConfirmed: ${confirmed}/${links.length} matches`);
  } else {
    console.log(`\nDRY-RUN: use --apply to confirm these ${links.length} matches`);
  }

  return { shown: links.length, confirmed, skippedWeak };
}

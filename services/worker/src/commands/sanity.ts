import { getClient, MarketRepository, QuoteRepository, type Venue } from '@data-module/db';

export interface SanityOptions {
  venue?: Venue;
  maxAgeMinutes?: number;
}

export interface SanityResult {
  venue: Venue;
  markets: {
    active: number;
    closed: number;
    resolved: number;
    archived: number;
  };
  outcomes: {
    total: number;
    withFreshQuotes: number;
    freshnessPercent: number;
  };
  warnings: string[];
}

/**
 * Run sanity checks on data
 */
export async function runSanityCheck(options: SanityOptions = {}): Promise<SanityResult[]> {
  const { venue, maxAgeMinutes = 10 } = options;
  const prisma = getClient();
  const marketRepo = new MarketRepository(prisma);
  const quoteRepo = new QuoteRepository(prisma);

  const venues: Venue[] = venue ? [venue] : ['polymarket', 'kalshi'];
  const results: SanityResult[] = [];

  console.log('Running sanity checks...\n');

  for (const v of venues) {
    console.log(`=== ${v.toUpperCase()} ===`);

    const warnings: string[] = [];

    // Get market counts by status
    const marketCounts = await marketRepo.getStatusCounts(v);
    console.log('Markets by status:');
    console.log(`  Active: ${marketCounts.active}`);
    console.log(`  Closed: ${marketCounts.closed}`);
    console.log(`  Resolved: ${marketCounts.resolved}`);
    console.log(`  Archived: ${marketCounts.archived}`);

    // Check quote freshness
    const quoteFreshness = await quoteRepo.countFreshLatestQuotes(v, maxAgeMinutes);
    const freshnessPercent =
      quoteFreshness.total > 0
        ? Math.round((quoteFreshness.fresh / quoteFreshness.total) * 100)
        : 0;

    console.log(`\nOutcome quote freshness (max age: ${maxAgeMinutes}min):`);
    console.log(`  Total outcomes: ${quoteFreshness.total}`);
    console.log(`  With fresh quotes: ${quoteFreshness.fresh} (${freshnessPercent}%)`);

    // Generate warnings
    if (marketCounts.active === 0) {
      warnings.push('No active markets found');
    }

    if (freshnessPercent < 50 && quoteFreshness.total > 0) {
      warnings.push(
        `Only ${freshnessPercent}% of outcomes have quotes fresher than ${maxAgeMinutes} minutes`
      );
    }

    if (quoteFreshness.total > 0 && quoteFreshness.fresh === 0) {
      warnings.push('No fresh quotes found - ingestion may be failing');
    }

    // Print warnings
    if (warnings.length > 0) {
      console.log('\nWarnings:');
      for (const w of warnings) {
        console.log(`  ⚠️  ${w}`);
      }
    } else {
      console.log('\n✅ All checks passed');
    }

    console.log('');

    results.push({
      venue: v,
      markets: marketCounts,
      outcomes: {
        total: quoteFreshness.total,
        withFreshQuotes: quoteFreshness.fresh,
        freshnessPercent,
      },
      warnings,
    });
  }

  return results;
}

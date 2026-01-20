import {
  getClient,
  IngestionRepository,
  QuoteRepository,
  type Venue,
} from '@data-module/db';

export interface HealthOptions {
  maxStaleMinutes?: number;
  maxLastSuccessMinutes?: number;
}

export interface HealthResult {
  ok: boolean;
  database: boolean;
  jobs: Array<{
    venue: string;
    jobName: string;
    lastSuccessAt: Date | null;
    lastError: string | null;
    isStale: boolean;
  }>;
  quotesFreshness: Array<{
    venue: string;
    total: number;
    fresh: number;
    stalePercent: number;
  }>;
  errors: string[];
}

/**
 * Run health check
 */
export async function runHealthCheck(options: HealthOptions = {}): Promise<HealthResult> {
  const { maxStaleMinutes = 5, maxLastSuccessMinutes = 10 } = options;

  const result: HealthResult = {
    ok: true,
    database: false,
    jobs: [],
    quotesFreshness: [],
    errors: [],
  };

  const prisma = getClient();
  const ingestionRepo = new IngestionRepository(prisma);
  const quoteRepo = new QuoteRepository(prisma);

  // Check database connection
  try {
    await prisma.$queryRaw`SELECT 1`;
    result.database = true;
    console.log('✓ Database connection: OK');
  } catch (error) {
    result.ok = false;
    result.errors.push(`Database connection failed: ${error}`);
    console.log('✗ Database connection: FAILED');
    return result;
  }

  // Check ingestion states
  const states = await ingestionRepo.getAllStates();
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - maxLastSuccessMinutes * 60 * 1000);

  console.log('\nIngestion Jobs:');
  for (const state of states) {
    const isStale = !state.lastSuccessAt || state.lastSuccessAt < staleCutoff;

    result.jobs.push({
      venue: state.venue,
      jobName: state.jobName,
      lastSuccessAt: state.lastSuccessAt,
      lastError: state.lastError,
      isStale,
    });

    const statusIcon = isStale ? '✗' : '✓';
    const lastSuccess = state.lastSuccessAt
      ? `${Math.round((now.getTime() - state.lastSuccessAt.getTime()) / 1000 / 60)}m ago`
      : 'never';

    console.log(`  ${statusIcon} ${state.venue}/${state.jobName}: last success ${lastSuccess}`);

    if (state.lastError) {
      console.log(`    └─ Last error: ${state.lastError.substring(0, 80)}...`);
    }

    if (isStale) {
      result.ok = false;
      result.errors.push(`Job ${state.venue}/${state.jobName} is stale`);
    }
  }

  // Check quotes freshness for each venue
  console.log('\nQuotes Freshness:');
  const venues: Venue[] = ['polymarket', 'kalshi'];

  for (const venue of venues) {
    try {
      const freshness = await quoteRepo.countFreshLatestQuotes(venue, maxStaleMinutes);
      const stalePercent = freshness.total > 0
        ? Math.round((1 - freshness.fresh / freshness.total) * 100)
        : 0;

      result.quotesFreshness.push({
        venue,
        total: freshness.total,
        fresh: freshness.fresh,
        stalePercent,
      });

      const statusIcon = stalePercent > 50 ? '✗' : stalePercent > 20 ? '⚠' : '✓';
      console.log(`  ${statusIcon} ${venue}: ${freshness.fresh}/${freshness.total} fresh (${stalePercent}% stale)`);

      if (stalePercent > 50) {
        result.ok = false;
        result.errors.push(`${venue} has ${stalePercent}% stale quotes`);
      }
    } catch (error) {
      console.log(`  ✗ ${venue}: Error checking freshness`);
    }
  }

  // Summary
  console.log('\n' + (result.ok ? '✓ Health check PASSED' : '✗ Health check FAILED'));

  if (result.errors.length > 0) {
    console.log('\nErrors:');
    for (const error of result.errors) {
      console.log(`  - ${error}`);
    }
  }

  return result;
}

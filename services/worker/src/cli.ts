#!/usr/bin/env node

import 'dotenv/config';
import * as fs from 'node:fs';
import { Command } from 'commander';
import { type Venue, DEFAULT_DEDUP_CONFIG, loadVenueConfig, formatVenueConfig } from '@data-module/core';
import { disconnect } from '@data-module/db';
import { runIngestion, runIngestionLoop } from './pipeline/ingest.js';
import { runSplitIngestionLoop } from './pipeline/split-runner.js';
import { runSeed, runArchive, runSanityCheck, runHealthCheck, runReconcile, runSuggestMatches, runListSuggestions, runShowLink, runConfirmMatch, runRejectMatch, runKalshiReport, runKalshiSmoke, runKalshiDiscoverSeries, KNOWN_POLITICAL_TICKERS, runOverlapReport, DEFAULT_OVERLAP_KEYWORDS } from './commands/index.js';
import type { LinkStatus } from '@data-module/db';
import { getSupportedVenues, type KalshiAuthConfig } from './adapters/index.js';

const program = new Command();

/**
 * Load Kalshi auth from environment variables
 */
function loadKalshiAuth(): KalshiAuthConfig | undefined {
  const apiKeyId = process.env.KALSHI_API_KEY_ID;
  const privateKeyPath = process.env.KALSHI_PRIVATE_KEY_PATH;
  const privateKeyPem = process.env.KALSHI_PRIVATE_KEY_PEM;

  if (!apiKeyId) {
    return undefined;
  }

  let keyPem: string;

  if (privateKeyPem) {
    // Key provided directly as env var (useful for Docker secrets)
    keyPem = privateKeyPem.replace(/\\n/g, '\n');
  } else if (privateKeyPath) {
    // Key provided as file path
    try {
      keyPem = fs.readFileSync(privateKeyPath, 'utf-8');
    } catch (err) {
      console.warn(`[kalshi] Failed to read private key from ${privateKeyPath}: ${err}`);
      return undefined;
    }
  } else {
    console.warn('[kalshi] KALSHI_API_KEY_ID set but no private key provided');
    return undefined;
  }

  return { apiKeyId, privateKeyPem: keyPem };
}

program
  .name('worker')
  .description('Data Module worker for prediction market data ingestion')
  .version('1.0.0');

// Ingest command
program
  .command('ingest')
  .description('Ingest data from a prediction market venue')
  .requiredOption('-v, --venue <venue>', `Venue to ingest from (${getSupportedVenues().join(', ')})`)
  .option('-m, --mode <mode>', 'Mode: once, loop, or split', 'once')
  .option('-i, --interval <seconds>', 'Interval between ingestion cycles (loop mode)', '60')
  .option('--max-markets <number>', 'Maximum markets to fetch', '10000')
  .option('--page-size <number>', 'Page size for API requests', '100')
  .option('--epsilon <number>', 'Price change threshold for dedup', String(DEFAULT_DEDUP_CONFIG.epsilon))
  .option('--min-interval <seconds>', 'Minimum interval between quotes', String(DEFAULT_DEDUP_CONFIG.minIntervalSeconds))
  .option('--markets-refresh <seconds>', 'Markets refresh interval (split mode)', process.env.MARKETS_REFRESH_SECONDS || '1800')
  .option('--quotes-refresh <seconds>', 'Quotes refresh interval (split mode)', process.env.QUOTES_REFRESH_SECONDS || '60')
  .option('--quotes-lookback <hours>', 'Closed markets lookback for quotes (split mode)', process.env.QUOTES_CLOSED_LOOKBACK_HOURS || '24')
  .action(async (opts) => {
    const venue = opts.venue as Venue;
    const supportedVenues = getSupportedVenues();

    if (!supportedVenues.includes(venue)) {
      console.error(`Invalid venue: ${venue}. Supported: ${supportedVenues.join(', ')}`);
      process.exit(1);
    }

    // Load venue config from env (can be overridden by CLI args)
    const venueConfig = loadVenueConfig(venue);

    // CLI args override env config
    const dedupConfig = {
      epsilon: opts.epsilon !== String(DEFAULT_DEDUP_CONFIG.epsilon)
        ? parseFloat(opts.epsilon)
        : venueConfig.dedup.epsilon,
      minIntervalSeconds: opts.minInterval !== String(DEFAULT_DEDUP_CONFIG.minIntervalSeconds)
        ? parseInt(opts.minInterval, 10)
        : venueConfig.dedup.minIntervalSeconds,
    };

    // Log config at startup
    console.log(formatVenueConfig(venue, { ...venueConfig, dedup: dedupConfig }));

    // Load Kalshi auth if available
    const kalshiAuth = venue === 'kalshi' ? loadKalshiAuth() : undefined;

    try {
      if (opts.mode === 'split') {
        // Split mode: separate intervals for markets and quotes
        await runSplitIngestionLoop({
          venue,
          maxMarkets: parseInt(opts.maxMarkets, 10),
          pageSize: parseInt(opts.pageSize, 10),
          dedupConfig,
          kalshiAuth,
          marketsRefreshSeconds: parseInt(opts.marketsRefresh, 10) || venueConfig.marketsRefreshSeconds,
          quotesRefreshSeconds: parseInt(opts.quotesRefresh, 10) || venueConfig.quotesRefreshSeconds,
          quotesClosedLookbackHours: parseInt(opts.quotesLookback, 10) || venueConfig.quotesClosedLookbackHours,
          quotesMaxMarketsPerCycle: venueConfig.quotesMaxMarketsPerCycle,
        });
      } else if (opts.mode === 'loop') {
        await runIngestionLoop({
          venue,
          maxMarkets: parseInt(opts.maxMarkets, 10),
          pageSize: parseInt(opts.pageSize, 10),
          dedupConfig,
          kalshiAuth,
          intervalSeconds: parseInt(opts.interval, 10),
        });
      } else {
        const result = await runIngestion({
          venue,
          maxMarkets: parseInt(opts.maxMarkets, 10),
          pageSize: parseInt(opts.pageSize, 10),
          dedupConfig,
          kalshiAuth,
        });

        if (!result.ok) {
          process.exit(1);
        }
      }
    } catch (error) {
      console.error('Ingestion error:', error);
      process.exit(1);
    } finally {
      await disconnect();
    }
  });

// Seed command
program
  .command('seed')
  .description('Generate seed data for testing')
  .option('-m, --markets <number>', 'Number of markets to create', '10')
  .option('-o, --outcomes <number>', 'Outcomes per market', '2')
  .option('-d, --duration <minutes>', 'Quote history duration in minutes', '5')
  .option('-i, --interval <seconds>', 'Quote interval in seconds', '10')
  .action(async (opts) => {
    try {
      await runSeed({
        markets: parseInt(opts.markets, 10),
        outcomesPerMarket: parseInt(opts.outcomes, 10),
        quoteDurationMinutes: parseInt(opts.duration, 10),
        quoteIntervalSeconds: parseInt(opts.interval, 10),
      });
    } catch (error) {
      console.error('Seed error:', error);
      process.exit(1);
    } finally {
      await disconnect();
    }
  });

// Archive command
program
  .command('archive')
  .description('Archive old markets')
  .option('--resolved-days <days>', 'Archive resolved markets older than N days', '30')
  .option('--closed-days <days>', 'Archive closed markets older than N days', '14')
  .option('--dry-run', 'Show what would be archived without making changes', false)
  .action(async (opts) => {
    try {
      await runArchive({
        resolvedDays: parseInt(opts.resolvedDays, 10),
        closedDays: parseInt(opts.closedDays, 10),
        dryRun: opts.dryRun,
      });
    } catch (error) {
      console.error('Archive error:', error);
      process.exit(1);
    } finally {
      await disconnect();
    }
  });

// Sanity check command
program
  .command('sanity')
  .description('Run data sanity checks')
  .option('-v, --venue <venue>', 'Check specific venue only')
  .option('--max-age <minutes>', 'Maximum age for fresh quotes in minutes', '10')
  .action(async (opts) => {
    try {
      const results = await runSanityCheck({
        venue: opts.venue as Venue | undefined,
        maxAgeMinutes: parseInt(opts.maxAge, 10),
      });

      // Exit with error if any warnings
      const hasWarnings = results.some((r) => r.warnings.length > 0);
      if (hasWarnings) {
        process.exit(1);
      }
    } catch (error) {
      console.error('Sanity check error:', error);
      process.exit(1);
    } finally {
      await disconnect();
    }
  });

// Health check command
program
  .command('health')
  .description('Run health check on database and ingestion jobs')
  .option('--max-stale <minutes>', 'Max age for quotes to be considered fresh', '5')
  .option('--max-job-age <minutes>', 'Max age for last successful job run', '10')
  .action(async (opts) => {
    try {
      const result = await runHealthCheck({
        maxStaleMinutes: parseInt(opts.maxStale, 10),
        maxLastSuccessMinutes: parseInt(opts.maxJobAge, 10),
      });

      if (!result.ok) {
        process.exit(1);
      }
    } catch (error) {
      console.error('Health check error:', error);
      process.exit(1);
    } finally {
      await disconnect();
    }
  });

// Reconcile command
program
  .command('reconcile')
  .description('Reconcile markets from source with database')
  .requiredOption('-v, --venue <venue>', `Venue to reconcile (${getSupportedVenues().join(', ')})`)
  .option('--page-size <number>', 'Page size for API requests', '100')
  .option('--max-markets <number>', 'Maximum markets to fetch from source', '50000')
  .option('--dry-run', 'Preview what would be added without making changes', false)
  .action(async (opts) => {
    const venue = opts.venue as Venue;
    const supportedVenues = getSupportedVenues();

    if (!supportedVenues.includes(venue)) {
      console.error(`Invalid venue: ${venue}. Supported: ${supportedVenues.join(', ')}`);
      process.exit(1);
    }

    try {
      const result = await runReconcile({
        venue,
        pageSize: parseInt(opts.pageSize, 10),
        maxMarkets: parseInt(opts.maxMarkets, 10),
        dryRun: opts.dryRun,
      });

      if (result.errors.length > 0) {
        process.exit(1);
      }
    } catch (error) {
      console.error('Reconcile error:', error);
      process.exit(1);
    } finally {
      await disconnect();
    }
  });

// Suggest matches command
program
  .command('suggest-matches')
  .description('Find potential market matches between venues (v2: fingerprint-based)')
  .requiredOption('--from <venue>', `Source venue (${getSupportedVenues().join(', ')})`)
  .requiredOption('--to <venue>', `Target venue (${getSupportedVenues().join(', ')})`)
  .option('--min-score <number>', 'Minimum match score (0-1)', '0.55')
  .option('--top-k <number>', 'Top K matches per source market', '10')
  .option('--lookback-hours <hours>', 'Include closed markets within N hours', '24')
  .option('--limit-left <number>', 'Max source markets to process', '2000')
  .option('--debug-one <marketId>', 'Debug single market: show top 20 candidates with breakdown')
  .option('--require-overlap-keywords', 'Skip pairs with no keyword overlap (default: true)', true)
  .option('--no-require-overlap-keywords', 'Disable keyword overlap prefilter')
  .action(async (opts) => {
    const supportedVenues = getSupportedVenues();

    if (!supportedVenues.includes(opts.from)) {
      console.error(`Invalid --from venue: ${opts.from}. Supported: ${supportedVenues.join(', ')}`);
      process.exit(1);
    }

    if (!supportedVenues.includes(opts.to)) {
      console.error(`Invalid --to venue: ${opts.to}. Supported: ${supportedVenues.join(', ')}`);
      process.exit(1);
    }

    if (opts.from === opts.to) {
      console.error('--from and --to must be different venues');
      process.exit(1);
    }

    try {
      const result = await runSuggestMatches({
        fromVenue: opts.from as Venue,
        toVenue: opts.to as Venue,
        minScore: parseFloat(opts.minScore),
        topK: parseInt(opts.topK, 10),
        lookbackHours: parseInt(opts.lookbackHours, 10),
        limitLeft: parseInt(opts.limitLeft, 10),
        debugMarketId: opts.debugOne ? parseInt(opts.debugOne, 10) : undefined,
        requireOverlapKeywords: opts.requireOverlapKeywords,
      });

      if (result.errors.length > 0) {
        process.exit(1);
      }
    } catch (error) {
      console.error('Suggest matches error:', error);
      process.exit(1);
    } finally {
      await disconnect();
    }
  });

// List suggestions command
program
  .command('list-suggestions')
  .description('List market link suggestions')
  .option('--min-score <number>', 'Minimum score filter', '0')
  .option('--status <status>', 'Filter by status (suggested, confirmed, rejected)')
  .option('--limit <number>', 'Maximum results to show', '50')
  .action(async (opts) => {
    try {
      await runListSuggestions({
        minScore: parseFloat(opts.minScore),
        status: opts.status as LinkStatus | undefined,
        limit: parseInt(opts.limit, 10),
      });
    } catch (error) {
      console.error('List suggestions error:', error);
      process.exit(1);
    } finally {
      await disconnect();
    }
  });

// Show link command
program
  .command('show-link')
  .description('Show details of a market link')
  .requiredOption('--id <id>', 'Link ID to show')
  .action(async (opts) => {
    try {
      await runShowLink(parseInt(opts.id, 10));
    } catch (error) {
      console.error('Show link error:', error);
      process.exit(1);
    } finally {
      await disconnect();
    }
  });

// Confirm match command
program
  .command('confirm-match')
  .description('Confirm a market link suggestion')
  .requiredOption('--id <id>', 'Link ID to confirm')
  .action(async (opts) => {
    try {
      await runConfirmMatch(parseInt(opts.id, 10));
    } catch (error) {
      console.error('Confirm match error:', error);
      process.exit(1);
    } finally {
      await disconnect();
    }
  });

// Reject match command
program
  .command('reject-match')
  .description('Reject a market link suggestion')
  .requiredOption('--id <id>', 'Link ID to reject')
  .action(async (opts) => {
    try {
      await runRejectMatch(parseInt(opts.id, 10));
    } catch (error) {
      console.error('Reject match error:', error);
      process.exit(1);
    } finally {
      await disconnect();
    }
  });

// Kalshi report command
program
  .command('kalshi-report')
  .description('Show Kalshi market coverage report (series, categories, statuses)')
  .option('--skip-markets', 'Skip fetching markets, only show series catalog')
  .action(async (opts) => {
    const kalshiAuth = loadKalshiAuth();

    try {
      await runKalshiReport({ kalshiAuth, skipMarkets: opts.skipMarkets });
    } catch (error) {
      console.error('Kalshi report error:', error);
      process.exit(1);
    }
  });

// Kalshi smoke test command
program
  .command('kalshi-smoke')
  .description('Test Kalshi API access for specific market tickers')
  .option('--tickers <tickers>', 'Comma-separated list of tickers to test')
  .option('--known', 'Use known political/economic tickers')
  .action(async (opts) => {
    let tickers: string[];

    if (opts.tickers) {
      tickers = opts.tickers.split(',').map((t: string) => t.trim()).filter((t: string) => t.length > 0);
    } else if (opts.known) {
      tickers = KNOWN_POLITICAL_TICKERS;
    } else {
      console.error('Specify --tickers or --known');
      process.exit(1);
    }

    try {
      await runKalshiSmoke({ tickers });
    } catch (error) {
      console.error('Kalshi smoke test error:', error);
      process.exit(1);
    }
  });

// Kalshi discover series command
program
  .command('kalshi-discover')
  .description('Discover all Kalshi series and their categories')
  .action(async () => {
    try {
      await runKalshiDiscoverSeries();
    } catch (error) {
      console.error('Kalshi discover error:', error);
      process.exit(1);
    }
  });

// Overlap report command
program
  .command('overlap-report')
  .description('Check keyword overlap between venues in database')
  .option('--keywords <keywords>', 'Comma-separated list of keywords to check')
  .action(async (opts) => {
    let keywords: string[] = [];

    if (opts.keywords) {
      keywords = opts.keywords.split(',').map((k: string) => k.trim().toLowerCase()).filter((k: string) => k.length > 0);
    } else {
      keywords = DEFAULT_OVERLAP_KEYWORDS;
    }

    try {
      await runOverlapReport({ keywords });
    } catch (error) {
      console.error('Overlap report error:', error);
      process.exit(1);
    } finally {
      await disconnect();
    }
  });

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nShutting down...');
  await disconnect();
  process.exit(0);
});

program.parse();

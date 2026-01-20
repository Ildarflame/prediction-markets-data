#!/usr/bin/env node

import 'dotenv/config';
import * as fs from 'node:fs';
import { Command } from 'commander';
import { type Venue, DEFAULT_DEDUP_CONFIG, loadVenueConfig, formatVenueConfig } from '@data-module/core';
import { disconnect } from '@data-module/db';
import { runIngestion, runIngestionLoop } from './pipeline/ingest.js';
import { runSplitIngestionLoop } from './pipeline/split-runner.js';
import { runSeed, runArchive, runSanityCheck, runHealthCheck, runReconcile } from './commands/index.js';
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

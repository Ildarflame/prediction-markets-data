#!/usr/bin/env node

import 'dotenv/config';
import * as fs from 'node:fs';
import { Command } from 'commander';
import { type Venue, DEFAULT_DEDUP_CONFIG, loadVenueConfig, formatVenueConfig } from '@data-module/core';
import { disconnect } from '@data-module/db';
import { runIngestion, runIngestionLoop } from './pipeline/ingest.js';
import { runSplitIngestionLoop } from './pipeline/split-runner.js';
import { runSeed, runArchive, runSanityCheck, runHealthCheck, runReconcile, runSuggestMatches, runListSuggestions, runShowLink, runConfirmMatch, runRejectMatch, runKalshiReport, runKalshiSmoke, runKalshiDiscoverSeries, KNOWN_POLITICAL_TICKERS, runOverlapReport, DEFAULT_OVERLAP_KEYWORDS, runMetaSample, runMacroOverlap, runMacroProbe, runMacroCounts, runMacroBest, runMacroAudit, runAuditPack, getSupportedEntities, runTruthAudit, runTruthAuditBatch, getSupportedTruthAuditEntities, runCryptoCounts, runCryptoOverlap, runCryptoTruthAudit, runCryptoTruthAuditBatch, getSupportedCryptoTruthAuditEntities, runCryptoQuality, runCryptoBrackets, runCryptoDateAudit, runCryptoTruthDateAudit, runCryptoTypeAudit, runCryptoEthDebug, runCryptoSeriesAudit, runCryptoEligibleExplain, runKalshiIngestionDiag, runLinksStats, runLinksCleanup, runIntradayBest } from './commands/index.js';
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
  .description('Find potential market matches between venues (v2.4.2: macro-first with cap)')
  .requiredOption('--from <venue>', `Source venue (${getSupportedVenues().join(', ')})`)
  .option('--to <venue>', `Target venue (${getSupportedVenues().join(', ')})`)
  .option('--min-score <number>', 'Minimum match score (0-1)', '0.6')
  .option('--top-k <number>', 'Top K matches per source market', '10')
  .option('--max-per-left <number>', 'Max suggestions per left market (reduces bracket duplicates, env: MAX_SUGGESTIONS_PER_LEFT)', '5')
  .option('--lookback-hours <hours>', 'Include closed markets within N hours', '24')
  .option('--limit-left <number>', 'Max source markets to process', '2000')
  .option('--limit-right <number>', 'Max target markets to fetch', '20000')
  .option('--topic <topic>', 'Topic filter: crypto, crypto_daily, crypto_intraday, macro, politics, all (default: all)', 'all')
  .option('--macro-min-year <year>', 'Min year for macro markets (default: currentYear-1)')
  .option('--macro-max-year <year>', 'Max year for macro markets (default: currentYear+1)')
  .option('--debug-one <marketId>', 'Debug single market: show top 20 candidates with breakdown')
  .option('--require-overlap-keywords', 'Skip pairs with no keyword overlap (default: true)', true)
  .option('--no-require-overlap-keywords', 'Disable keyword overlap prefilter')
  .option('--exclude-sports', 'Exclude sports/esports markets (default: true)', true)
  .option('--no-exclude-sports', 'Disable sports/esports exclusion filter')
  .action(async (opts) => {
    const supportedVenues = getSupportedVenues();
    const validTopics = ['crypto', 'crypto_daily', 'crypto_intraday', 'macro', 'politics', 'all'];

    if (!supportedVenues.includes(opts.from)) {
      console.error(`Invalid --from venue: ${opts.from}. Supported: ${supportedVenues.join(', ')}`);
      process.exit(1);
    }

    if (!validTopics.includes(opts.topic)) {
      console.error(`Invalid --topic: ${opts.topic}. Supported: ${validTopics.join(', ')}`);
      process.exit(1);
    }

    // Default --to to the other venue
    const toVenue = opts.to || (opts.from === 'polymarket' ? 'kalshi' : 'polymarket');

    if (!supportedVenues.includes(toVenue)) {
      console.error(`Invalid --to venue: ${toVenue}. Supported: ${supportedVenues.join(', ')}`);
      process.exit(1);
    }

    if (opts.from === toVenue) {
      console.error('--from and --to must be different venues');
      process.exit(1);
    }

    try {
      const result = await runSuggestMatches({
        fromVenue: opts.from as Venue,
        toVenue: toVenue as Venue,
        minScore: parseFloat(opts.minScore),
        topK: parseInt(opts.topK, 10),
        maxSuggestionsPerLeft: parseInt(opts.maxPerLeft, 10),
        lookbackHours: parseInt(opts.lookbackHours, 10),
        limitLeft: parseInt(opts.limitLeft, 10),
        limitRight: parseInt(opts.limitRight, 10),
        topic: opts.topic as 'crypto' | 'macro' | 'politics' | 'all',
        macroMinYear: opts.macroMinYear ? parseInt(opts.macroMinYear, 10) : undefined,
        macroMaxYear: opts.macroMaxYear ? parseInt(opts.macroMaxYear, 10) : undefined,
        debugMarketId: opts.debugOne ? parseInt(opts.debugOne, 10) : undefined,
        requireOverlapKeywords: opts.requireOverlapKeywords,
        excludeSports: opts.excludeSports,
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

// Macro overlap report command
program
  .command('macro:overlap')
  .description('Show macro period overlap between venues (v2.4.2 - unified pipeline)')
  .option('--from <venue>', `Source venue (${getSupportedVenues().join(', ')})`, 'kalshi')
  .option('--to <venue>', `Target venue (${getSupportedVenues().join(', ')})`, 'polymarket')
  .option('--lookback-hours <hours>', 'Include markets within N hours (default: 24, same as suggest-matches)', '24')
  .option('--limit-left <number>', 'Max source markets (default: 2000)', '2000')
  .option('--limit-right <number>', 'Max target markets (default: 20000)', '20000')
  .option('--macro-min-year <year>', 'Min year for macro markets')
  .option('--macro-max-year <year>', 'Max year for macro markets')
  .option('--sample <count>', 'Show N sample markets per entity for debugging', '0')
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

    try {
      await runMacroOverlap({
        fromVenue: opts.from as Venue,
        toVenue: opts.to as Venue,
        lookbackHours: parseInt(opts.lookbackHours, 10),
        limitLeft: parseInt(opts.limitLeft, 10),
        limitRight: parseInt(opts.limitRight, 10),
        macroMinYear: opts.macroMinYear ? parseInt(opts.macroMinYear, 10) : undefined,
        macroMaxYear: opts.macroMaxYear ? parseInt(opts.macroMaxYear, 10) : undefined,
        sampleCount: parseInt(opts.sample, 10),
      });
    } catch (error) {
      console.error('Macro overlap report error:', error);
      process.exit(1);
    } finally {
      await disconnect();
    }
  });

// Macro probe command (v2.4.2)
program
  .command('macro:probe')
  .description('Diagnose macro entity detection (data vs extractor issue)')
  .requiredOption('--venue <venue>', `Venue to probe (${getSupportedVenues().join(', ')})`)
  .requiredOption('--entity <entity>', 'Entity to probe (e.g., GDP, CPI, UNEMPLOYMENT)')
  .option('--lookback-hours <hours>', 'Search window in hours', '720')
  .option('--limit <number>', 'Max markets to analyze', '100')
  .option('--macro-min-year <year>', 'Min year filter')
  .option('--macro-max-year <year>', 'Max year filter')
  .action(async (opts) => {
    const supportedVenues = getSupportedVenues();

    if (!supportedVenues.includes(opts.venue)) {
      console.error(`Invalid --venue: ${opts.venue}. Supported: ${supportedVenues.join(', ')}`);
      process.exit(1);
    }

    try {
      await runMacroProbe({
        venue: opts.venue as Venue,
        entity: opts.entity,
        lookbackHours: parseInt(opts.lookbackHours, 10),
        limit: parseInt(opts.limit, 10),
        macroMinYear: opts.macroMinYear ? parseInt(opts.macroMinYear, 10) : undefined,
        macroMaxYear: opts.macroMaxYear ? parseInt(opts.macroMaxYear, 10) : undefined,
      });
    } catch (error) {
      console.error('Macro probe error:', error);
      process.exit(1);
    } finally {
      await disconnect();
    }
  });

// Macro counts command (v2.4.5)
program
  .command('macro:counts')
  .description('Show macro entity counts and samples per venue (v2.4.5)')
  .requiredOption('--venue <venue>', `Venue to analyze (${getSupportedVenues().join(', ')})`)
  .option('--lookback-hours <hours>', 'Search window in hours', '720')
  .option('--limit <number>', 'Max markets to fetch', '5000')
  .option('--samples <number>', 'Sample titles per entity', '5')
  .action(async (opts) => {
    const supportedVenues = getSupportedVenues();

    if (!supportedVenues.includes(opts.venue)) {
      console.error(`Invalid --venue: ${opts.venue}. Supported: ${supportedVenues.join(', ')}`);
      process.exit(1);
    }

    try {
      await runMacroCounts({
        venue: opts.venue as Venue,
        lookbackHours: parseInt(opts.lookbackHours, 10),
        limit: parseInt(opts.limit, 10),
        samplesPerEntity: parseInt(opts.samples, 10),
      });
    } catch (error) {
      console.error('Macro counts error:', error);
      process.exit(1);
    } finally {
      await disconnect();
    }
  });

// Macro best command (v2.4.5)
program
  .command('macro:best')
  .description('Show/confirm best high-score STRONG suggestions (v2.4.5)')
  .option('--min-score <number>', 'Minimum score filter (default: 0.85)', '0.85')
  .option('--only-strong', 'Only STRONG tier (default: true)', true)
  .option('--no-only-strong', 'Include WEAK tier')
  .option('--limit <number>', 'Maximum results', '50')
  .option('--apply', 'Auto-confirm matches (default: dry-run)', false)
  .action(async (opts) => {
    try {
      await runMacroBest({
        minScore: parseFloat(opts.minScore),
        onlyStrong: opts.onlyStrong,
        limit: parseInt(opts.limit, 10),
        apply: opts.apply,
      });
    } catch (error) {
      console.error('Macro best error:', error);
      process.exit(1);
    } finally {
      await disconnect();
    }
  });

// Macro audit command (v2.4.7)
program
  .command('macro:audit')
  .description('Two-phase fact-check: DB scan + pipeline scan (v2.4.7)')
  .requiredOption('--venue <venue>', `Venue to audit (${getSupportedVenues().join(', ')})`)
  .requiredOption('--entity <entity>', `Entity to audit (${getSupportedEntities().join(', ')})`)
  .option('--all-time', 'Disable lookback filter (scan entire DB history)', false)
  .option('--include-resolved', 'Include resolved/archived markets in pipeline', false)
  .option('--db-limit <number>', 'Limit for DB fact scan', '2000')
  .option('--lookback-hours <number>', 'Lookback hours for window mode', '720')
  .action(async (opts) => {
    const supportedVenues = getSupportedVenues();

    if (!supportedVenues.includes(opts.venue)) {
      console.error(`Invalid --venue: ${opts.venue}. Supported: ${supportedVenues.join(', ')}`);
      process.exit(1);
    }

    try {
      await runMacroAudit({
        venue: opts.venue as Venue,
        entity: opts.entity,
        allTime: opts.allTime,
        includeResolved: opts.includeResolved,
        dbLimit: parseInt(opts.dbLimit, 10),
        lookbackHours: parseInt(opts.lookbackHours, 10),
      });
    } catch (error) {
      console.error('Macro audit error:', error);
      process.exit(1);
    } finally {
      await disconnect();
    }
  });

// Macro audit-pack command (v2.4.7)
program
  .command('macro:audit-pack')
  .description('Batch audit multiple entities with compact table output (v2.4.7)')
  .requiredOption('--venue <venue>', `Venue to audit (${getSupportedVenues().join(', ')})`)
  .option('--entities <list>', 'Comma-separated entities (default: all)', '')
  .option('--all-time', 'Disable lookback filter', false)
  .option('--include-resolved', 'Include resolved/archived markets', false)
  .action(async (opts) => {
    const supportedVenues = getSupportedVenues();

    if (!supportedVenues.includes(opts.venue)) {
      console.error(`Invalid --venue: ${opts.venue}. Supported: ${supportedVenues.join(', ')}`);
      process.exit(1);
    }

    const entities = opts.entities ? opts.entities.split(',').map((e: string) => e.trim()) : undefined;

    try {
      await runAuditPack({
        venue: opts.venue as Venue,
        entities,
        allTime: opts.allTime,
        includeResolved: opts.includeResolved,
      });
    } catch (error) {
      console.error('Audit pack error:', error);
      process.exit(1);
    } finally {
      await disconnect();
    }
  });

// Macro truth-audit command (v2.4.10)
program
  .command('macro:truth-audit')
  .description('Ground-truth verification for macro entity presence (v2.4.10)')
  .requiredOption('--venue <venue>', `Venue to audit (${getSupportedVenues().join(', ')})`)
  .option('--entity <entity>', `Entity to audit (${getSupportedTruthAuditEntities().join(', ')})`)
  .option('--all', 'Audit all supported entities', false)
  .option('--include-resolved', 'Include resolved/archived markets (default: true)', true)
  .option('--no-include-resolved', 'Exclude resolved/archived markets')
  .option('--db-limit <number>', 'Limit for DB all-time scan', '5000')
  .option('--sample <number>', 'Sample size for display', '20')
  .option('--lookback-hours <number>', 'Lookback hours for eligible window', '720')
  .action(async (opts) => {
    const supportedVenues = getSupportedVenues();

    if (!supportedVenues.includes(opts.venue)) {
      console.error(`Invalid --venue: ${opts.venue}. Supported: ${supportedVenues.join(', ')}`);
      process.exit(1);
    }

    if (!opts.entity && !opts.all) {
      console.error('Must specify --entity <name> or --all');
      process.exit(1);
    }

    try {
      if (opts.all) {
        // Batch audit all entities
        await runTruthAuditBatch(
          opts.venue as Venue,
          getSupportedTruthAuditEntities(),
          {
            includeResolved: opts.includeResolved,
            dbLimit: parseInt(opts.dbLimit, 10),
            sampleSize: parseInt(opts.sample, 10),
            lookbackHours: parseInt(opts.lookbackHours, 10),
          }
        );
      } else {
        // Single entity audit
        await runTruthAudit({
          venue: opts.venue as Venue,
          entity: opts.entity,
          includeResolved: opts.includeResolved,
          dbLimit: parseInt(opts.dbLimit, 10),
          sampleSize: parseInt(opts.sample, 10),
          lookbackHours: parseInt(opts.lookbackHours, 10),
        });
      }
    } catch (error) {
      console.error('Truth audit error:', error);
      process.exit(1);
    } finally {
      await disconnect();
    }
  });

// Crypto counts command (v2.5.0)
program
  .command('crypto:counts')
  .description('Diagnostic counts for crypto markets per venue (v2.5.0, v2.6.2 topic filter)')
  .requiredOption('--venue <venue>', `Venue to audit (${getSupportedVenues().join(', ')})`)
  .option('--lookback-hours <number>', 'Lookback hours', '720')
  .option('--limit <number>', 'DB limit', '5000')
  .option('--include-resolved', 'Include resolved/archived markets', false)
  .option('--all-time', 'Disable lookback filter', false)
  .option('--topic <topic>', 'Topic filter: crypto, crypto_daily, crypto_intraday', 'crypto')
  .action(async (opts) => {
    const supportedVenues = getSupportedVenues();

    if (!supportedVenues.includes(opts.venue)) {
      console.error(`Invalid --venue: ${opts.venue}. Supported: ${supportedVenues.join(', ')}`);
      process.exit(1);
    }

    const validTopics = ['crypto', 'crypto_daily', 'crypto_intraday'];
    if (!validTopics.includes(opts.topic)) {
      console.error(`Invalid --topic: ${opts.topic}. Supported: ${validTopics.join(', ')}`);
      process.exit(1);
    }

    try {
      await runCryptoCounts({
        venue: opts.venue as Venue,
        lookbackHours: parseInt(opts.lookbackHours, 10),
        limit: parseInt(opts.limit, 10),
        includeResolved: opts.includeResolved,
        allTime: opts.allTime,
        topic: opts.topic,
      });
    } catch (error) {
      console.error('Crypto counts error:', error);
      process.exit(1);
    } finally {
      await disconnect();
    }
  });

// Crypto overlap command (v2.5.0)
program
  .command('crypto:overlap')
  .description('Cross-venue overlap report for crypto markets (v2.5.0, v2.6.2 topic filter)')
  .requiredOption('--from <venue>', `Source venue (${getSupportedVenues().join(', ')})`)
  .requiredOption('--to <venue>', `Target venue (${getSupportedVenues().join(', ')})`)
  .option('--lookback-hours <number>', 'Lookback hours', '720')
  .option('--limit <number>', 'DB limit per venue', '5000')
  .option('--topic <topic>', 'Topic filter: crypto, crypto_daily, crypto_intraday', 'crypto')
  .action(async (opts) => {
    const supportedVenues = getSupportedVenues();

    if (!supportedVenues.includes(opts.from)) {
      console.error(`Invalid --from: ${opts.from}. Supported: ${supportedVenues.join(', ')}`);
      process.exit(1);
    }
    if (!supportedVenues.includes(opts.to)) {
      console.error(`Invalid --to: ${opts.to}. Supported: ${supportedVenues.join(', ')}`);
      process.exit(1);
    }

    const validTopics = ['crypto', 'crypto_daily', 'crypto_intraday'];
    if (!validTopics.includes(opts.topic)) {
      console.error(`Invalid --topic: ${opts.topic}. Supported: ${validTopics.join(', ')}`);
      process.exit(1);
    }

    try {
      await runCryptoOverlap({
        fromVenue: opts.from as Venue,
        toVenue: opts.to as Venue,
        lookbackHours: parseInt(opts.lookbackHours, 10),
        limit: parseInt(opts.limit, 10),
        topic: opts.topic,
      });
    } catch (error) {
      console.error('Crypto overlap error:', error);
      process.exit(1);
    } finally {
      await disconnect();
    }
  });

// Crypto truth-audit command (v2.5.0)
program
  .command('crypto:truth-audit')
  .description('Ground-truth verification for crypto entity presence (v2.5.0)')
  .requiredOption('--venue <venue>', `Venue to audit (${getSupportedVenues().join(', ')})`)
  .option('--entity <entity>', `Entity to audit (${getSupportedCryptoTruthAuditEntities().join(', ')})`)
  .option('--all', 'Audit all supported entities', false)
  .option('--include-resolved', 'Include resolved/archived markets (default: true)', true)
  .option('--no-include-resolved', 'Exclude resolved/archived markets')
  .option('--db-limit <number>', 'Limit for DB all-time scan', '5000')
  .option('--sample <number>', 'Sample size for display', '20')
  .option('--lookback-hours <number>', 'Lookback hours for eligible window', '720')
  .action(async (opts) => {
    const supportedVenues = getSupportedVenues();

    if (!supportedVenues.includes(opts.venue)) {
      console.error(`Invalid --venue: ${opts.venue}. Supported: ${supportedVenues.join(', ')}`);
      process.exit(1);
    }

    if (!opts.entity && !opts.all) {
      console.error('Must specify --entity <name> or --all');
      process.exit(1);
    }

    try {
      if (opts.all) {
        await runCryptoTruthAuditBatch(
          opts.venue as Venue,
          getSupportedCryptoTruthAuditEntities(),
          {
            includeResolved: opts.includeResolved,
            dbLimit: parseInt(opts.dbLimit, 10),
            sampleSize: parseInt(opts.sample, 10),
            lookbackHours: parseInt(opts.lookbackHours, 10),
          }
        );
      } else {
        await runCryptoTruthAudit({
          venue: opts.venue as Venue,
          entity: opts.entity,
          includeResolved: opts.includeResolved,
          dbLimit: parseInt(opts.dbLimit, 10),
          sampleSize: parseInt(opts.sample, 10),
          lookbackHours: parseInt(opts.lookbackHours, 10),
        });
      }
    } catch (error) {
      console.error('Crypto truth audit error:', error);
      process.exit(1);
    } finally {
      await disconnect();
    }
  });

// Crypto quality review commands (v2.6.0)
program
  .command('crypto:best')
  .description('Show/auto-confirm best high-score crypto matches (v2.6.0)')
  .option('--min-score <number>', 'Minimum score filter', '0.90')
  .option('--limit <number>', 'Maximum results', '50')
  .option('--from <venue>', 'Source venue', 'kalshi')
  .option('--to <venue>', 'Target venue', 'polymarket')
  .option('--lookback-hours <hours>', 'Lookback hours', '720')
  .option('--apply', 'Auto-confirm safe matches (SAFE_RULES)', false)
  .option('--dry-run', 'Show what would be confirmed without applying', false)
  .action(async (opts) => {
    try {
      await runCryptoQuality({
        mode: 'best',
        minScore: parseFloat(opts.minScore),
        limit: parseInt(opts.limit, 10),
        fromVenue: opts.from as Venue,
        toVenue: opts.to as Venue,
        lookbackHours: parseInt(opts.lookbackHours, 10),
        apply: opts.apply,
        dryRun: opts.dryRun,
      });
    } catch (error) {
      console.error('Crypto best error:', error);
      process.exit(1);
    } finally {
      await disconnect();
    }
  });

program
  .command('crypto:worst')
  .description('Show worst low-score crypto matches for quality review (v2.5.3)')
  .option('--max-score <number>', 'Maximum score filter', '0.60')
  .option('--limit <number>', 'Maximum results', '50')
  .option('--from <venue>', 'Source venue', 'kalshi')
  .option('--to <venue>', 'Target venue', 'polymarket')
  .option('--lookback-hours <hours>', 'Lookback hours', '720')
  .action(async (opts) => {
    try {
      await runCryptoQuality({
        mode: 'worst',
        maxScore: parseFloat(opts.maxScore),
        limit: parseInt(opts.limit, 10),
        fromVenue: opts.from as Venue,
        toVenue: opts.to as Venue,
        lookbackHours: parseInt(opts.lookbackHours, 10),
      });
    } catch (error) {
      console.error('Crypto worst error:', error);
      process.exit(1);
    } finally {
      await disconnect();
    }
  });

program
  .command('crypto:sample')
  .description('Show random sample of crypto matches for quality review (v2.5.3)')
  .option('--limit <number>', 'Maximum results', '30')
  .option('--seed <number>', 'Random seed for reproducibility', '42')
  .option('--from <venue>', 'Source venue', 'kalshi')
  .option('--to <venue>', 'Target venue', 'polymarket')
  .option('--lookback-hours <hours>', 'Lookback hours', '720')
  .action(async (opts) => {
    try {
      await runCryptoQuality({
        mode: 'sample',
        seed: parseInt(opts.seed, 10),
        limit: parseInt(opts.limit, 10),
        fromVenue: opts.from as Venue,
        toVenue: opts.to as Venue,
        lookbackHours: parseInt(opts.lookbackHours, 10),
      });
    } catch (error) {
      console.error('Crypto sample error:', error);
      process.exit(1);
    } finally {
      await disconnect();
    }
  });

// Crypto brackets diagnostic command (v2.6.0)
program
  .command('crypto:brackets')
  .description('Analyze bracket structure in crypto markets (v2.6.0)')
  .option('--venue <venue>', 'Venue to analyze', 'polymarket')
  .option('--lookback-hours <hours>', 'Lookback hours', '720')
  .option('--limit <number>', 'Max markets to fetch', '5000')
  .option('--top-n <number>', 'Top N brackets to show', '20')
  .action(async (opts) => {
    const supportedVenues = getSupportedVenues();

    if (!supportedVenues.includes(opts.venue)) {
      console.error(`Invalid --venue: ${opts.venue}. Supported: ${supportedVenues.join(', ')}`);
      process.exit(1);
    }

    try {
      await runCryptoBrackets({
        venue: opts.venue as Venue,
        lookbackHours: parseInt(opts.lookbackHours, 10),
        limit: parseInt(opts.limit, 10),
        topN: parseInt(opts.topN, 10),
      });
    } catch (error) {
      console.error('Crypto brackets error:', error);
      process.exit(1);
    } finally {
      await disconnect();
    }
  });

// Crypto date-audit diagnostic command (v2.6.0)
program
  .command('crypto:date-audit')
  .description('Analyze date extraction quality for crypto markets (v2.6.0)')
  .option('--venue <venue>', 'Venue to analyze', 'polymarket')
  .option('--lookback-hours <hours>', 'Lookback hours', '720')
  .option('--limit <number>', 'Max markets to fetch', '5000')
  .option('--sample-per-type <number>', 'Sample size per dateType', '10')
  .action(async (opts) => {
    const supportedVenues = getSupportedVenues();

    if (!supportedVenues.includes(opts.venue)) {
      console.error(`Invalid --venue: ${opts.venue}. Supported: ${supportedVenues.join(', ')}`);
      process.exit(1);
    }

    try {
      await runCryptoDateAudit({
        venue: opts.venue as Venue,
        lookbackHours: parseInt(opts.lookbackHours, 10),
        limit: parseInt(opts.limit, 10),
        samplePerType: parseInt(opts.samplePerType, 10),
      });
    } catch (error) {
      console.error('Crypto date-audit error:', error);
      process.exit(1);
    } finally {
      await disconnect();
    }
  });

// Crypto truth-date-audit diagnostic command (v2.6.1)
program
  .command('crypto:truth-date-audit')
  .description('Analyze settle date source distribution for crypto markets (v2.6.1)')
  .option('--venue <venue>', 'Venue to analyze', 'polymarket')
  .option('--entity <entity>', 'Entity filter (BITCOIN, ETHEREUM, or all)', 'all')
  .option('--lookback-hours <hours>', 'Lookback hours', '720')
  .option('--limit <number>', 'Max markets to fetch', '5000')
  .option('--sample-per-source <number>', 'Sample size per source', '10')
  .action(async (opts) => {
    const supportedVenues = getSupportedVenues();

    if (!supportedVenues.includes(opts.venue)) {
      console.error(`Invalid --venue: ${opts.venue}. Supported: ${supportedVenues.join(', ')}`);
      process.exit(1);
    }

    try {
      await runCryptoTruthDateAudit({
        venue: opts.venue as Venue,
        entity: opts.entity,
        lookbackHours: parseInt(opts.lookbackHours, 10),
        limit: parseInt(opts.limit, 10),
        samplePerSource: parseInt(opts.samplePerSource, 10),
      });
    } catch (error) {
      console.error('Crypto truth-date-audit error:', error);
      process.exit(1);
    } finally {
      await disconnect();
    }
  });

// Crypto type-audit diagnostic command (v2.6.1)
program
  .command('crypto:type-audit')
  .description('Analyze market type classification for crypto markets (v2.6.1)')
  .option('--venue <venue>', 'Venue to analyze', 'kalshi')
  .option('--entity <entity>', 'Entity filter (BITCOIN, ETHEREUM, or all)', 'all')
  .option('--lookback-hours <hours>', 'Lookback hours', '720')
  .option('--limit <number>', 'Max markets to fetch', '5000')
  .option('--sample-per-type <number>', 'Sample size per type', '10')
  .action(async (opts) => {
    const supportedVenues = getSupportedVenues();

    if (!supportedVenues.includes(opts.venue)) {
      console.error(`Invalid --venue: ${opts.venue}. Supported: ${supportedVenues.join(', ')}`);
      process.exit(1);
    }

    try {
      await runCryptoTypeAudit({
        venue: opts.venue as Venue,
        entity: opts.entity,
        lookbackHours: parseInt(opts.lookbackHours, 10),
        limit: parseInt(opts.limit, 10),
        samplePerType: parseInt(opts.samplePerType, 10),
      });
    } catch (error) {
      console.error('Crypto type-audit error:', error);
      process.exit(1);
    } finally {
      await disconnect();
    }
  });

// Crypto ETH debug command (v2.6.1)
program
  .command('crypto:eth-debug')
  .description('Diagnose ETH matching issues between venues (v2.6.1)')
  .option('--from <venue>', 'Source venue', 'kalshi')
  .option('--to <venue>', 'Target venue', 'polymarket')
  .option('--lookback-hours <hours>', 'Lookback hours', '720')
  .option('--limit <number>', 'Max markets per venue', '2000')
  .option('--min-score <score>', 'Min score for analysis', '0.8')
  .option('--top-dates <n>', 'Top N dates to analyze', '10')
  .action(async (opts) => {
    const supportedVenues = getSupportedVenues();

    if (!supportedVenues.includes(opts.from)) {
      console.error(`Invalid --from: ${opts.from}. Supported: ${supportedVenues.join(', ')}`);
      process.exit(1);
    }
    if (!supportedVenues.includes(opts.to)) {
      console.error(`Invalid --to: ${opts.to}. Supported: ${supportedVenues.join(', ')}`);
      process.exit(1);
    }

    try {
      await runCryptoEthDebug({
        from: opts.from as Venue,
        to: opts.to as Venue,
        lookbackHours: parseInt(opts.lookbackHours, 10),
        limit: parseInt(opts.limit, 10),
        minScore: parseFloat(opts.minScore),
        topDates: parseInt(opts.topDates, 10),
      });
    } catch (error) {
      console.error('Crypto eth-debug error:', error);
      process.exit(1);
    } finally {
      await disconnect();
    }
  });

// Crypto series audit command (v2.6.2)
program
  .command('crypto:series-audit')
  .description('Audit crypto market series/event tickers to diagnose coverage issues (v2.6.2)')
  .option('--venue <venue>', 'Venue to audit', 'kalshi')
  .option('--entity <entity>', 'Entity filter (BITCOIN, ETHEREUM, or all)', 'all')
  .option('--lookback-hours <hours>', 'Lookback hours', '720')
  .option('--limit <number>', 'Max markets to fetch', '20000')
  .option('--sample-per-group <n>', 'Samples per group', '10')
  .option('--top-groups <n>', 'Top N groups to show', '30')
  .action(async (opts) => {
    const supportedVenues = getSupportedVenues();
    if (!supportedVenues.includes(opts.venue)) {
      console.error(`Invalid --venue: ${opts.venue}. Supported: ${supportedVenues.join(', ')}`);
      process.exit(1);
    }

    try {
      await runCryptoSeriesAudit({
        venue: opts.venue as Venue,
        entity: opts.entity,
        lookbackHours: parseInt(opts.lookbackHours, 10),
        limit: parseInt(opts.limit, 10),
        samplePerGroup: parseInt(opts.samplePerGroup, 10),
        topGroups: parseInt(opts.topGroups, 10),
      });
    } catch (error) {
      console.error('Crypto series-audit error:', error);
      process.exit(1);
    } finally {
      await disconnect();
    }
  });

// Crypto eligible explain command (v2.6.2)
program
  .command('crypto:eligible-explain')
  .description('Explain why eligible selection produces certain results (v2.6.2)')
  .option('--venue <venue>', 'Venue to analyze', 'kalshi')
  .option('--entity <entity>', 'Entity to analyze (BITCOIN, ETHEREUM)', 'ETHEREUM')
  .option('--lookback-hours <hours>', 'Lookback hours', '720')
  .option('--limit <number>', 'Max markets to fetch', '4000')
  .option('--mode <mode>', 'Mode: daily or intraday', 'daily')
  .action(async (opts) => {
    const supportedVenues = getSupportedVenues();
    if (!supportedVenues.includes(opts.venue)) {
      console.error(`Invalid --venue: ${opts.venue}. Supported: ${supportedVenues.join(', ')}`);
      process.exit(1);
    }
    if (!['daily', 'intraday'].includes(opts.mode)) {
      console.error(`Invalid --mode: ${opts.mode}. Supported: daily, intraday`);
      process.exit(1);
    }

    try {
      await runCryptoEligibleExplain({
        venue: opts.venue as Venue,
        entity: opts.entity,
        lookbackHours: parseInt(opts.lookbackHours, 10),
        limit: parseInt(opts.limit, 10),
        mode: opts.mode as 'daily' | 'intraday',
      });
    } catch (error) {
      console.error('Crypto eligible-explain error:', error);
      process.exit(1);
    } finally {
      await disconnect();
    }
  });

// ============================================================
// Crypto Intraday Commands (v2.6.3)
// Convenience shortcuts for crypto:* commands with --topic crypto_intraday
// ============================================================

// crypto:intraday:counts (shortcut for crypto:counts --topic crypto_intraday)
program
  .command('crypto:intraday:counts')
  .description('Diagnostic counts for INTRADAY crypto markets per venue (v2.6.3)')
  .requiredOption('--venue <venue>', `Venue to audit (${getSupportedVenues().join(', ')})`)
  .option('--lookback-hours <number>', 'Lookback hours', '720')
  .option('--limit <number>', 'DB limit', '5000')
  .option('--slot-size <size>', 'Time bucket size: 15m, 30m, 1h, 2h, 4h', '15m')
  .action(async (opts) => {
    const supportedVenues = getSupportedVenues();
    if (!supportedVenues.includes(opts.venue)) {
      console.error(`Invalid --venue: ${opts.venue}. Supported: ${supportedVenues.join(', ')}`);
      process.exit(1);
    }

    try {
      // Set slot size for intraday matching
      process.env.INTRADAY_SLOT_SIZE = opts.slotSize;
      await runCryptoCounts({
        venue: opts.venue as Venue,
        lookbackHours: parseInt(opts.lookbackHours, 10),
        limit: parseInt(opts.limit, 10),
        includeResolved: false,
        allTime: false,
        topic: 'crypto_intraday',
      });
    } catch (error) {
      console.error('Crypto intraday counts error:', error);
      process.exit(1);
    } finally {
      await disconnect();
    }
  });

// crypto:intraday:overlap (shortcut for crypto:overlap --topic crypto_intraday)
program
  .command('crypto:intraday:overlap')
  .description('Cross-venue overlap report for INTRADAY crypto markets (v2.6.3)')
  .requiredOption('--from <venue>', `Source venue (${getSupportedVenues().join(', ')})`)
  .requiredOption('--to <venue>', `Target venue (${getSupportedVenues().join(', ')})`)
  .option('--lookback-hours <number>', 'Lookback hours', '720')
  .option('--limit <number>', 'DB limit per venue', '5000')
  .option('--slot-size <size>', 'Time bucket size: 15m, 30m, 1h, 2h, 4h', '15m')
  .action(async (opts) => {
    const supportedVenues = getSupportedVenues();
    if (!supportedVenues.includes(opts.from)) {
      console.error(`Invalid --from: ${opts.from}. Supported: ${supportedVenues.join(', ')}`);
      process.exit(1);
    }
    if (!supportedVenues.includes(opts.to)) {
      console.error(`Invalid --to: ${opts.to}. Supported: ${supportedVenues.join(', ')}`);
      process.exit(1);
    }

    try {
      process.env.INTRADAY_SLOT_SIZE = opts.slotSize;
      await runCryptoOverlap({
        fromVenue: opts.from as Venue,
        toVenue: opts.to as Venue,
        lookbackHours: parseInt(opts.lookbackHours, 10),
        limit: parseInt(opts.limit, 10),
        topic: 'crypto_intraday',
      });
    } catch (error) {
      console.error('Crypto intraday overlap error:', error);
      process.exit(1);
    } finally {
      await disconnect();
    }
  });

// crypto:intraday:best - Show best intraday matches from market_links (v2.6.4)
program
  .command('crypto:intraday:best')
  .description('Show best high-score INTRADAY crypto matches (v2.6.4, --apply to auto-confirm)')
  .option('--min-score <number>', 'Minimum score filter', '0.85')
  .option('--limit <number>', 'Maximum results', '50')
  .option('--from <venue>', 'Source venue', 'kalshi')
  .option('--to <venue>', 'Target venue', 'polymarket')
  .option('--apply', 'Auto-confirm high-quality matches (score >= apply-min-score)', false)
  .option('--apply-min-score <number>', 'Minimum score for auto-confirm', '0.90')
  .action(async (opts) => {
    const supportedVenues = getSupportedVenues();
    if (!supportedVenues.includes(opts.from)) {
      console.error(`Invalid --from: ${opts.from}. Supported: ${supportedVenues.join(', ')}`);
      process.exit(1);
    }
    if (!supportedVenues.includes(opts.to)) {
      console.error(`Invalid --to: ${opts.to}. Supported: ${supportedVenues.join(', ')}`);
      process.exit(1);
    }

    try {
      await runIntradayBest({
        minScore: parseFloat(opts.minScore),
        limit: parseInt(opts.limit, 10),
        fromVenue: opts.from as Venue,
        toVenue: opts.to as Venue,
        apply: opts.apply,
        applyMinScore: parseFloat(opts.applyMinScore),
      });
    } catch (error) {
      console.error('Crypto intraday best error:', error);
      process.exit(1);
    } finally {
      await disconnect();
    }
  });

// List suggestions command
program
  .command('list-suggestions')
  .description('List market link suggestions (v2.4.5: shows only STRONG by default)')
  .option('--min-score <number>', 'Minimum score filter', '0')
  .option('--status <status>', 'Filter by status (suggested, confirmed, rejected)')
  .option('--limit <number>', 'Maximum results to show', '50')
  .option('--include-weak', 'Include WEAK tier suggestions (default: only STRONG)', false)
  .action(async (opts) => {
    try {
      await runListSuggestions({
        minScore: parseFloat(opts.minScore),
        status: opts.status as LinkStatus | undefined,
        limit: parseInt(opts.limit, 10),
        includeWeak: opts.includeWeak,
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

// Kalshi ingestion diagnostics command (v2.6.2)
program
  .command('kalshi:ingestion:diag')
  .description('Diagnose Kalshi ingestion health and identify stuck/failing states (v2.6.2)')
  .option('--show-runs <number>', 'Number of recent runs to show', '20')
  .action(async (opts) => {
    try {
      const result = await runKalshiIngestionDiag({
        venue: 'kalshi',
        showRuns: parseInt(opts.showRuns, 10),
      });

      // Exit with error code if STUCK or FAILING
      if (result.status === 'STUCK' || result.status === 'FAILING') {
        process.exit(1);
      }
    } catch (error) {
      console.error('Kalshi ingestion diagnostics error:', error);
      process.exit(1);
    } finally {
      await disconnect();
    }
  });

// Link hygiene commands (v2.6.3)
program
  .command('links:stats')
  .description('Show market link statistics by status, topic, and algoVersion (v2.6.3)')
  .action(async () => {
    try {
      await runLinksStats();
    } catch (error) {
      console.error('Links stats error:', error);
      process.exit(1);
    } finally {
      await disconnect();
    }
  });

program
  .command('links:cleanup')
  .description('Delete old market link suggestions (v2.6.3)')
  .option('--older-than-days <days>', 'Delete links older than N days', '30')
  .option('--status <status>', 'Filter by status: suggested, rejected, all', 'suggested')
  .option('--algo-version <version>', 'Filter by algoVersion (e.g., "crypto_daily@2.6.0")')
  .option('--topic <topic>', 'Filter by topic (e.g., "crypto_daily", "crypto_intraday", "macro")')
  .option('--dry-run', 'Preview without actually deleting', false)
  .action(async (opts) => {
    const validStatuses = ['suggested', 'rejected', 'all'];
    if (!validStatuses.includes(opts.status)) {
      console.error(`Invalid --status: ${opts.status}. Supported: ${validStatuses.join(', ')}`);
      process.exit(1);
    }

    try {
      await runLinksCleanup({
        olderThanDays: parseInt(opts.olderThanDays, 10),
        status: opts.status as 'suggested' | 'rejected' | 'all',
        algoVersion: opts.algoVersion,
        topic: opts.topic,
        dryRun: opts.dryRun,
      });
    } catch (error) {
      console.error('Links cleanup error:', error);
      process.exit(1);
    } finally {
      await disconnect();
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

// Kalshi metadata sample command
program
  .command('kalshi:meta-sample')
  .description('Sample Kalshi market metadata to understand available fields')
  .option('--limit <number>', 'Number of markets to sample', '20')
  .action(async (opts) => {
    try {
      await runMetaSample({
        venue: 'kalshi',
        limit: parseInt(opts.limit, 10),
      });
    } catch (error) {
      console.error('Meta sample error:', error);
      process.exit(1);
    } finally {
      await disconnect();
    }
  });

// Polymarket metadata sample command
program
  .command('polymarket:meta-sample')
  .description('Sample Polymarket market metadata to understand available fields')
  .option('--limit <number>', 'Number of markets to sample', '20')
  .action(async (opts) => {
    try {
      await runMetaSample({
        venue: 'polymarket',
        limit: parseInt(opts.limit, 10),
      });
    } catch (error) {
      console.error('Meta sample error:', error);
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

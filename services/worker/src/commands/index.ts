export { runSeed, type SeedOptions } from './seed.js';
export { runArchive, type ArchiveOptions } from './archive.js';
export { runSanityCheck, type SanityOptions, type SanityResult } from './sanity.js';
export { runHealthCheck, type HealthOptions, type HealthResult } from './health.js';
export { runReconcile, type ReconcileOptions, type ReconcileResult } from './reconcile.js';
export { runSuggestMatches, type SuggestMatchesOptions, type SuggestMatchesResult } from './suggest-matches.js';
export { runListSuggestions, runShowLink, runConfirmMatch, runRejectMatch, type ListSuggestionsOptions } from './matching-review.js';
export { runKalshiReport, type KalshiReportOptions } from './kalshi-report.js';
export { runKalshiSmoke, runKalshiDiscoverSeries, type KalshiSmokeOptions, type KalshiSmokeResult, KNOWN_POLITICAL_TICKERS } from './kalshi-smoke.js';
export { runOverlapReport, type OverlapReportOptions, type OverlapReportResult, DEFAULT_OVERLAP_KEYWORDS } from './overlap-report.js';
export { runMetaSample, type MetaSampleOptions } from './meta-sample.js';
export { runMacroOverlap, type MacroOverlapOptions } from './macro-overlap.js';
export { runMacroProbe, type MacroProbeOptions } from './macro-probe.js';
export { runMacroCounts, type MacroCountsOptions } from './macro-counts.js';
export { runMacroBest, type MacroBestOptions, type MacroBestResult } from './macro-best.js';
export {
  runMacroAudit,
  runAuditPack,
  getSupportedEntities,
  formatAvailability,
  AuditVerdict,
  VERDICT_DESCRIPTIONS,
  type MacroAuditOptions,
  type MacroAuditResult,
  type AuditPackOptions,
  type AuditPackRow,
} from './macro-audit.js';
export {
  runTruthAudit,
  runTruthAuditBatch,
  getSupportedTruthAuditEntities,
  TruthVerdict,
  VERDICT_DESCRIPTIONS as TRUTH_VERDICT_DESCRIPTIONS,
  type TruthAuditOptions,
  type TruthAuditResult,
} from './macro-truth-audit.js';

// Crypto commands (v2.5.0, v2.5.3, v2.6.0, v2.6.1)
export { runCryptoCounts, type CryptoCountsOptions, type CryptoCountsResult } from './crypto-counts.js';
export { runCryptoOverlap, type CryptoOverlapOptions, type CryptoOverlapResult } from './crypto-overlap.js';
export {
  runCryptoTruthAudit,
  runCryptoTruthAuditBatch,
  getSupportedCryptoTruthAuditEntities,
  CryptoTruthVerdict,
  CRYPTO_VERDICT_DESCRIPTIONS,
  type CryptoTruthAuditOptions,
  type CryptoTruthAuditResult,
} from './crypto-truth-audit.js';
export { runCryptoQuality, type CryptoQualityOptions, type CryptoQualityResult, type CryptoQualityMatch } from './crypto-quality.js';
export { runCryptoBrackets, type CryptoBracketsOptions, type CryptoBracketsResult } from './crypto-brackets.js';
export { runCryptoDateAudit, type CryptoDateAuditOptions, type CryptoDateAuditResult } from './crypto-date-audit.js';

// Crypto commands v2.6.1
export { runCryptoTruthDateAudit, type TruthDateAuditOptions, type TruthDateAuditResult } from './crypto-truth-date-audit.js';
export { runCryptoTypeAudit, type TypeAuditOptions, type TypeAuditResult } from './crypto-type-audit.js';
export { runCryptoEthDebug, type EthDebugOptions, type EthDebugResult } from './crypto-eth-debug.js';

// Crypto commands v2.6.2
export { runCryptoSeriesAudit, type SeriesAuditOptions, type SeriesAuditResult } from './crypto-series-audit.js';
export { runCryptoEligibleExplain, type EligibleExplainOptions, type EligibleExplainResult } from './crypto-eligible-explain.js';

// Kalshi ingestion diagnostics (v2.6.2)
export { runKalshiIngestionDiag, type IngestionDiagOptions, type IngestionDiagResult } from './kalshi-ingestion-diag.js';

// Kalshi sanity checks (v2.6.6)
export { runKalshiSanityStatus, type KalshiSanityStatusOptions, type KalshiSanityStatusResult } from './kalshi-sanity-status.js';

// Quotes freshness (v2.6.6)
export { runQuotesFreshness, type QuotesFreshnessOptions, type QuotesFreshnessResult } from './quotes-freshness.js';

// Polymarket cursor diagnostics (v2.6.6)
export { runPolymarketCursorDiag, type PolymarketCursorResult } from './polymarket-cursor-diag.js';

// Crypto intraday commands (v2.6.3)
export { runIntradayBest, type IntradayBestOptions, type IntradayBestResult, type IntradayBestMatch } from './crypto-intraday-best.js';

// Link hygiene commands (v2.6.2, v2.6.4)
export { runLinksStats, type LinksStatsResult } from './links-stats.js';
export { runLinksCleanup, type LinksCleanupOptions, type LinksCleanupResult } from './links-cleanup.js';
export { runLinksBackfill, type LinksBackfillOptions, type LinksBackfillResult } from './links-backfill.js';

// v2.6.7: Eligibility commands
export { runVenueSanityEligible, type VenueSanityEligibleOptions, type VenueSanityEligibleResult } from './venue-sanity-eligible.js';

// v2.6.7: Watchlist commands
export { runLinksWatchlistSync, type LinksWatchlistSyncOptions, type LinksWatchlistSyncResult } from './links-watchlist-sync.js';
export { runWatchlistStats, type WatchlistStatsOptions, type WatchlistStatsResult } from './watchlist-stats.js';
export { runWatchlistList, type WatchlistListOptions, type WatchlistListResult } from './watchlist-list.js';
export { runWatchlistCleanup, type WatchlistCleanupOptions, type WatchlistCleanupResult } from './watchlist-cleanup.js';

// v2.6.7: Review loop commands
export { runLinksQueue, type LinksQueueOptions, type LinksQueueResult } from './links-queue.js';
export { runLinksAutoReject, type LinksAutoRejectOptions, type LinksAutoRejectResult } from './links-auto-reject.js';

// v2.6.8: Auto-confirm and ops commands
export { runAutoConfirm, type AutoConfirmOptions, type AutoConfirmResult } from './links-auto-confirm.js';
export { runOps, type OpsRunOptions, type OpsRunResult } from './ops-run.js';
export { runOpsKpi, type OpsKpiResult } from './ops-kpi.js';

// v3.0.0: Taxonomy and V3 engine commands
export { runTaxonomyCoverage, type TaxonomyCoverageOptions } from './taxonomy-coverage.js';
export { runV3SuggestMatches, type V3SuggestMatchesOptions, type V3SuggestMatchesResult } from './v3-suggest-matches.js';

// v3.0.1: Taxonomy truth-audit and series sync
export { runKalshiSeriesSync, type KalshiSeriesSyncOptions } from './kalshi-series-sync.js';
export { runTaxonomyTruthAudit, type TaxonomyTruthAuditOptions, type TaxonomyTruthAuditResult } from './taxonomy-truth-audit.js';

// v3.0.2: Polymarket taxonomy backfill
export { runPolymarketTaxonomyBackfill, type PolymarketTaxonomyBackfillOptions, type PolymarketTaxonomyBackfillResult } from './polymarket-taxonomy-backfill.js';

// v3.0.4: Polymarket events sync and coverage
export {
  runPolymarketEventsSync,
  runPolymarketEventsCoverage,
  type PolymarketEventsSyncOptions,
  type PolymarketEventsSyncResult,
  type PolymarketEventsCoverageResult,
} from './polymarket-events-sync.js';

// v3.0.4: Commodities pipeline
export {
  runCommoditiesPipeline,
  runCommoditiesCounts,
  runCommoditiesOverlap,
  runCommoditiesBest,
  type CommoditiesPipelineOptions,
  type CommoditiesPipelineResult,
} from '../matching/commoditiesPipeline.js';

// v3.0.5: Topic overlap dashboard and ops:run v3
export { runTaxonomyOverlap, type TaxonomyOverlapOptions, type TaxonomyOverlapResult } from './taxonomy-overlap.js';
export { runOpsV3, type OpsV3Options, type OpsV3Result } from './ops-run-v3.js';

// v3.0.6: Kalshi taxonomy backfill
export { runKalshiTaxonomyBackfill, type KalshiTaxonomyBackfillOptions, type KalshiTaxonomyBackfillResult } from './kalshi-taxonomy-backfill.js';

// v3.0.8: Kalshi series audit
export { runKalshiSeriesAudit, type KalshiSeriesAuditOptions, type KalshiSeriesAuditResult } from './kalshi-series-audit.js';

// v3.0.9: Taxonomy gap report and v3 quality commands
export { runTaxonomyGapReport, type TaxonomyGapReportOptions, type TaxonomyGapReportResult } from './taxonomy-gap-report.js';
export { runV3Best, runV3Worst, type V3QualityOptions, type V3QualityResult, type V3QualityMatch } from './v3-quality.js';

// v3.0.12: Kalshi events sync for SPORTS
export { runKalshiEventsSync, type KalshiEventsSyncOptions, type KalshiEventsSyncResult } from './kalshi-events-sync.js';

// v3.0.13: Smart event sync (by market eventTickers)
export { runKalshiEventsSmartSync, type SmartSyncOptions, type SmartSyncResult } from './kalshi-events-smart-sync.js';

// v3.0.12: Sports debug commands
// v3.0.13: Added event coverage command
export {
  runSportsAudit,
  runSportsSample,
  runSportsEligible,
  runSportsEventCoverage,
  type SportsAuditOptions,
  type SportsAuditResult,
  type SportsSampleOptions,
  type SportsSampleResult,
  type SportsEligibleOptions,
  type SportsEligibleResult,
  type EventCoverageOptions,
  type EventCoverageResult,
} from './sports-debug.js';

// v3.0.14: MVE detection and backfill
export { runKalshiMveBackfill, type MveBackfillOptions, type MveBackfillResult } from './kalshi-mve-backfill.js';
export { runKalshiSportsBreakdown, type SportsBreakdownOptions, type SportsBreakdownResult } from './kalshi-sports-breakdown.js';

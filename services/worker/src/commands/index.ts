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

// Crypto intraday commands (v2.6.3)
export { runIntradayBest, type IntradayBestOptions, type IntradayBestResult, type IntradayBestMatch } from './crypto-intraday-best.js';

// Link hygiene commands (v2.6.2, v2.6.4)
export { runLinksStats, type LinksStatsResult } from './links-stats.js';
export { runLinksCleanup, type LinksCleanupOptions, type LinksCleanupResult } from './links-cleanup.js';
export { runLinksBackfill, type LinksBackfillOptions, type LinksBackfillResult } from './links-backfill.js';

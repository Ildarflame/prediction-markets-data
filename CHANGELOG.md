# Changelog

All notable changes to the Data Module project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.1.0] - 2026-01-XX

### Added
- **LLM Validation**: OpenAI API support for link validation with GPT-4
- **Web UI**: Manual link review server with visual interface (`review:server`)
- **Review Rollback**: Command to undo accidental confirmations/rejections (`review:rollback`)
- **Multi-Topic Matching**: `v3:suggest-all` command for running all registered topics
- **HTTP Proxy Support**: Kalshi adapter now supports proxy via `HTTP_PROXY` environment variable
- **JWT Authentication**: Kalshi API authentication for authenticated endpoints
- **Rate Limiting**: Automatic rate limit handling to prevent OpenAI API errors
- **Unlimited Ingestion**: Removed 10k market limits, now supports unlimited fetching
- **GEOPOLITICS Pipeline**: Topic-specific matching for geopolitical events
- **ENTERTAINMENT Pipeline**: Topic-specific matching for awards and entertainment
- **FINANCE Pipeline**: Topic-specific matching for financial markets

### Fixed
- Proxy support using undici ProxyAgent
- fetchAllMarkets now works correctly in split-runner for Kalshi catalog mode
- Increased default max-markets from 10k to 100k
- TypeScript errors in v3.1.0

### Changed
- Removed debug logging from Kalshi JWT and proxy
- LLM validation prompt improved with few-shot examples
- Taxonomy coverage command now supports unlimited markets

## [3.0.15] - 2026-01-24

### Added
- **MVE Truth Fields**: Native Kalshi API fields for MVE detection (`mve_collection_ticker`, `mve_selected_legs`)
- **MVE Audit Command**: `kalshi:mve:audit` for analyzing MVE detection coverage
- **Sports Event-First Matching**: Event enrichment for better team/league extraction
- **Smart Events Sync**: `kalshi:events:smart-sync` for efficient event data fetching
- **MVE Backfill**: Populate `isMve` field using Kalshi API truth data
- **Sports Breakdown**: `kalshi:sports:breakdown` showing MVE vs non-MVE statistics

### Fixed
- Series ticker league detection with fallback (KXNBA→NBA, KXNHL→NHL)
- MVE extraction for both legacy and API data sources
- V3 eligibility for Polymarket sports markets
- Sports pipeline now uses event data for better signal extraction

### Changed
- ELECTIONS auto-confirm MIN_SCORE lowered to 0.95
- Sports eligibility v3 with proper MVE filtering
- Event-first approach for sports matching prioritizes event metadata over market titles

## [3.0.10-3.0.14] - 2026-01-15 to 2026-01-23

### Added
- **CLIMATE Pipeline**: Weather, natural disasters, and climate events matching
- **COMMODITIES Pipeline**: Oil, gold, gas, and commodity markets
- **SPORTS Pipeline**: Event-first matching with team normalization
- **Universal Entity Extractor**: Cross-venue entity matching with people, organizations, numbers, dates
- **Universal Scorer**: Generic scoring system for all topic types
- **Test Commands**: `test:extractor` and `test:universal-scorer` for debugging
- **MVE Detection**: `isMve` field for Same-Game Parlay identification
- **Events Sync**: Kalshi and Polymarket events synchronization
- **Smart Number Matching**: Improved number value comparison
- **Two-Team Matchup Detection**: Specialized logic for team-based sports

### Fixed
- COMMODITIES/CLIMATE ticker priority conflicts
- Stricter date matching requiring exact day precision
- Event matching bonus (was incorrectly a penalty)
- Consolidate duplicate team aliases
- BETWEEN pattern extraction for ranges

### Changed
- More permissive auto-confirm rules for high-confidence matches
- Multi-entity bonus in entity overlap scoring
- Comparator matching penalty for better precision
- Market type classification improvements

## [3.0.0-3.0.9] - 2026-01-01 to 2026-01-15

### Added
- **Engine V3**: Unified matching orchestrator with dispatcher
- **Topic Pipelines**: RATES, ELECTIONS, MACRO, CRYPTO topic-specific matchers
- **Taxonomy System**: Automated topic classification for markets
- **ops:run:v3**: V3 operations loop with auto-confirm/reject
- **taxonomy Commands**: Coverage, overlap, gap reports, truth audits
- **v3:suggest-matches**: Run V3 matching engine for specific topics
- **v3:best/v3:worst**: Quality review commands for suggested matches
- **Kalshi Taxonomy Backfill**: Derive topics from series metadata
- **Polymarket Taxonomy Backfill**: Classify markets using events
- **derivedTopic**: Database field for computed topic classification

### Changed
- RATES pipeline to v3.0.5 with improved scoring
- Taxonomy overlap now uses DB derivedTopic by default
- Series-based classification for Kalshi markets
- Events-based classification for Polymarket markets

## [2.6.7] - 2026-01-22

### Added
- **Eligibility Module v3**: Unified time-based market filtering
- **Watchlist Quotes**: Targeted quotes for relevant markets only (`quote_watchlist` table)
- **Review Loop**: `links:queue` and `links:auto-reject` for suggested link management
- **Watchlist Sync**: `links:watchlist:sync` to populate from confirmed/top-suggested links
- **Watchlist Stats**: `watchlist:stats`, `watchlist:list`, `watchlist:cleanup` commands
- **Venue Sanity**: `venue:sanity:eligible` for eligibility diagnostics
- **Kalshi Status Hardening**: Minor/major anomaly buckets in `kalshi:sanity:status`

### Changed
- Eligibility now uses `ELIGIBILITY_GRACE_MINUTES` and `ELIGIBILITY_LOOKBACK_HOURS_*`
- Quotes worker supports `QUOTES_MODE=watchlist` for targeted fetching
- Split-runner now supports watchlist mode

## [2.6.6] - 2026-01-22

### Added
- **Score Sanity**: Clamping utilities to ensure scores stay in [0, 1] range
- **Kalshi Status Sanity**: `kalshi:sanity:status` for detecting status/closeTime anomalies
- **Quotes Freshness**: `quotes:freshness` command for coverage analysis
- **Polymarket Cursor Diagnostics**: `polymarket:ingestion:cursor` for cursor state
- **Links Hygiene**: `links:stats` now shows avgScore by status

### Fixed
- MACRO scoring formula bug that allowed scores > 1.0
- Cursor reset protection for stuck Polymarket cursors
- Links backfill now preserves confirmed links (no overwrite)

## [2.6.2-2.6.5] - 2026-01-20

### Added
- **Crypto Intraday Matching**: Time-bucketed crypto markets (15min intervals)
- **Kalshi Ingestion Diagnostics**: `kalshi:ingestion:diag` for health monitoring
- **Crypto Topic Filter**: `crypto_daily` vs `crypto_intraday` separation
- **Database Batch Tuning**: `KALSHI_DB_BATCH`, `KALSHI_QUOTE_BATCH` configuration

### Fixed
- Rate limiting with configurable thresholds (`KALSHI_STUCK_THRESHOLD_MIN`, `KALSHI_MAX_FAILURES_IN_ROW`)

## [2.4.0-2.6.1] - 2026-01 to 2026-01-19

### Added
- **Matching Module**: Cross-venue market matching with Jaccard similarity
- **Topic-Specific Pipelines**: Crypto, Macro, Rates, Finance, etc.
- **Auto-Confirm/Reject**: Automated link quality management
- **Truth Audit**: Ground-truth verification for entity extraction
- **Crypto Brackets**: Price bracket extraction from crypto markets
- **Date Audit**: Settle date source distribution analysis
- **Type Audit**: Market type classification quality checks

## [1.2.0] - Initial Matching Release

### Added
- Market link suggestions between Polymarket and Kalshi
- Rule-based scoring (text similarity + time proximity + category match)
- Inverted token index for efficient candidate filtering
- Review workflow (suggest, confirm, reject)

## [1.1.1] - 2025-12

### Added
- Per-venue dedup configuration
- Retry-After support for rate limiting
- Reconcile dry-run mode
- Docker healthcheck support

## [1.1.0] - 2025-11

### Added
- Split sync mode (separate intervals for markets and quotes)
- Float-safe quote deduplication
- In-cycle dedup prevention
- Raw JSON storage for debugging
- Health check command
- Reconcile command for missing markets

## [1.0.0] - 2025-10

### Added
- Initial release
- Multi-venue support (Polymarket, Kalshi)
- Append-only quote history
- Latest quotes materialized view
- Checkpointing for resumable ingestion
- Audit trail for ingestion runs
- Seed mode for testing
- Archive command for old markets

---

## Version Numbering

- **v3.x.x**: Engine V3 with unified topic pipelines and taxonomy system
- **v2.x.x**: Matching module with cross-venue link suggestions
- **v1.x.x**: Core ingestion system with multi-venue adapters

## Links

- [GitHub Repository](https://github.com/your-org/data-module-v1)
- [Documentation](./README.md)
- [Claude.md](./CLAUDE.md)

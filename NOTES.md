# Implementation Notes

## Release v2.6.7 - Eligibility Hardening + Watchlist Quotes + Review Loop

**Released**: 2026-01-22

### Goal
Stop trying to quote all 1.2M Kalshi markets. Focus on relevant markets via watchlist.

### Changes

#### BLOCK A: Eligibility v3
- **Added**: Unified eligibility module (`services/worker/src/eligibility/`)
- **Key principle**: Never trust `status` alone - use time-based filtering
- **Added**: `buildEligibleWhere()` - Prisma WHERE for eligible markets
- **Added**: `isEligibleMarket()` - Runtime check for single market
- **Added**: `explainEligibility()` - Detailed reasons array
- **Added**: `stale_active` detection - active markets with closeTime in past
- **Added**: CLI `venue:sanity:eligible --venue kalshi --topic crypto_daily`
- **Config**: `ELIGIBILITY_GRACE_MINUTES`, `ELIGIBILITY_LOOKBACK_HOURS_*`

#### BLOCK B: Kalshi Status Hardening
- **Updated**: `kalshi:sanity:status` now shows minor/major buckets
- **minor**: Within grace period (configurable, default 60m)
- **major**: Beyond grace period (stale_active)
- **Added**: Top 20 major anomalies with age info

#### BLOCK C: Watchlist Quotes
- **Added**: `quote_watchlist` table in Prisma schema
- **Added**: `WatchlistRepository` with upsertMany, list, cleanup
- **Added**: `links:watchlist:sync` - Populate from links
  - Confirmed links -> priority 100
  - Top suggested (score >= 0.92) -> priority 50
- **Added**: Quotes worker watchlist mode (`QUOTES_MODE=watchlist`)
- **Added**: CLI commands: `watchlist:stats`, `watchlist:list`, `watchlist:cleanup`
- **Config**: `QUOTES_MODE`, `QUOTES_WATCHLIST_LIMIT`, `WATCHLIST_MIN_SCORE`

#### BLOCK D: Review Loop
- **Added**: `links:queue` - Show suggested links for review
- **Added**: `links:auto-reject` - Auto-reject low-quality (default: dry-run)
  - Rejects: score < 0.55, older than 14 days, entity/date mismatch in reason

#### BLOCK E: Tests + Docs
- **Added**: `services/worker/src/eligibility/eligibility.test.ts`
- **Updated**: CLAUDE.md with new commands and modules
- **Updated**: NOTES.md with release notes

### Post-Deploy Checklist

```bash
# 1. Run database migration
pnpm --filter @data-module/db db:migrate

# 2. Check eligibility diagnostics
pnpm --filter @data-module/worker venue:sanity:eligible --venue kalshi --topic crypto_daily

# 3. Sync watchlist (dry-run first)
pnpm --filter @data-module/worker links:watchlist:sync --dry-run
pnpm --filter @data-module/worker links:watchlist:sync

# 4. Check watchlist stats
pnpm --filter @data-module/worker watchlist:stats

# 5. Enable watchlist mode for quotes (in .env)
# QUOTES_MODE=watchlist
# QUOTES_WATCHLIST_LIMIT=2000

# 6. Review suggested links
pnpm --filter @data-module/worker links:queue --topic crypto_daily --limit 50

# 7. Auto-reject low-quality (dry-run first)
pnpm --filter @data-module/worker links:auto-reject --dry-run
```

### Files Changed

- `packages/db/prisma/schema.prisma` - Added QuoteWatchlist model
- `packages/db/src/repositories/watchlist.repository.ts` - New
- `packages/db/src/repositories/index.ts` - Export WatchlistRepository
- `packages/db/src/index.ts` - Export QuoteWatchlist type
- `services/worker/src/eligibility/eligibility.ts` - New
- `services/worker/src/eligibility/eligibility.test.ts` - New
- `services/worker/src/eligibility/index.ts` - New
- `services/worker/src/commands/venue-sanity-eligible.ts` - New
- `services/worker/src/commands/links-watchlist-sync.ts` - New
- `services/worker/src/commands/watchlist-stats.ts` - New
- `services/worker/src/commands/watchlist-list.ts` - New
- `services/worker/src/commands/watchlist-cleanup.ts` - New
- `services/worker/src/commands/links-queue.ts` - New
- `services/worker/src/commands/links-auto-reject.ts` - New
- `services/worker/src/commands/kalshi-sanity-status.ts` - Added minor/major
- `services/worker/src/commands/index.ts` - Exports
- `services/worker/src/pipeline/split-runner.ts` - Watchlist mode
- `services/worker/src/cli.ts` - New commands
- `CLAUDE.md` - Updated
- `NOTES.md` - Updated

---

## Release v2.6.6 - Data Sanity + Cursor + Score Cap

**Released**: 2026-01-22

### Changes

#### BLOCK A: Score Sanity (0..1)
- **Fixed**: MACRO scoring formula bug that allowed scores > 1.0 (was max 1.1, now max 1.0)
- **Added**: `clampScoreSimple()` and `clampScore()` utilities in core for score validation
- **Added**: All scoring functions now clamp results to [0, 1] range
- **Added**: NaN/Infinity handling - replaced with 0/1 respectively
- **Added**: Unit tests for score sanity (`packages/core/src/score-sanity.test.ts`)

#### BLOCK B: Kalshi Market Status Sanity
- **Added**: CLI command `kalshi:sanity:status` to detect status/closeTime anomalies
- Counts active markets with closeTime in the past
- Counts closed markets with closeTime in the future
- Returns exit code 1 if anomaly rate > 0.5%

#### BLOCK C: Quotes Freshness + Round-Robin
- Round-robin cursor already implemented in split-runner.ts
- **Added**: CLI command `quotes:freshness --venue <venue> --minutes <N>`
- Shows fresh/stale outcome coverage
- Shows top stale markets by oldest latest_quote

#### BLOCK D: Polymarket Cursor Reset
- **Fixed**: Cursor not resetting when reaching end of data
- **Added**: Protection against stuck cursors (3 consecutive zero-fetch cycles triggers reset)
- **Added**: CLI command `polymarket:ingestion:cursor` for cursor diagnostics

#### BLOCK E: Links Hygiene
- **Improved**: `links:stats` now shows avgScore by status
- **Fixed**: `links:backfill` no longer touches confirmed links (preserves manual curation)

### Post-Deploy Checklist

```bash
# After deploying v2.6.6, run these commands to verify:

# 1. Check Kalshi market status anomalies
pnpm --filter @data-module/worker kalshi:sanity:status

# 2. Check quotes freshness (should show healthy coverage)
pnpm --filter @data-module/worker quotes:freshness --venue kalshi --minutes 10
pnpm --filter @data-module/worker quotes:freshness --venue polymarket --minutes 10

# 3. Check Polymarket cursor state
pnpm --filter @data-module/worker polymarket:ingestion:cursor

# 4. Check link statistics
pnpm --filter @data-module/worker links:stats

# 5. Run score sanity tests
npx tsx --test packages/core/src/score-sanity.test.ts
```

### Files Changed

- `packages/core/src/utils.ts` - Added clampScore utilities
- `packages/core/src/score-sanity.test.ts` - New test file
- `packages/db/src/repositories/market-link.repository.ts` - Added avgScoreByStatus
- `services/worker/src/commands/suggest-matches.ts` - Fixed MACRO scoring bug, added clamp
- `services/worker/src/commands/kalshi-sanity-status.ts` - New command
- `services/worker/src/commands/quotes-freshness.ts` - New command
- `services/worker/src/commands/polymarket-cursor-diag.ts` - New command
- `services/worker/src/commands/links-stats.ts` - Added avgScore display
- `services/worker/src/commands/links-backfill.ts` - Skip confirmed links
- `services/worker/src/matching/cryptoPipeline.ts` - Added clamp
- `services/worker/src/pipeline/split-runner.ts` - Added cursor reset protection
- `services/worker/src/cli.ts` - Registered new commands
- `CLAUDE.md` - Added sanity/diagnostics section

---

## API Research Summary

### Polymarket
**Status: ✅ Fully implemented**

- **Gamma API** (`https://gamma-api.polymarket.com`): Used for market/event discovery
  - No authentication required for public data
  - Rate limits: 300 req/10s for /markets, 500 req/10s for /events
  - Pagination via `limit` and `offset` parameters

- **CLOB API** (`https://clob.polymarket.com`): Used for orderbook/price data
  - No authentication required for read operations
  - Batch endpoint `/books` accepts array of token IDs
  - Returns bid/ask arrays with price and size

- **Token ID Mapping**: Markets have `clobTokenIds` array that maps 1:1 with outcomes

### Kalshi
**Status: ✅ Implemented (public endpoints only)**

- **Base URL**: `https://api.elections.kalshi.com/trade-api/v2`
  - Despite "elections" subdomain, provides access to ALL markets

- **Public Endpoints** (no auth):
  - `GET /markets` - List markets with bid/ask prices
  - `GET /events` - List events
  - `GET /markets/trades` - Trade history

- **Authenticated Endpoints** (RSA-PSS signature required):
  - `GET /markets/{ticker}/orderbook` - Full orderbook depth
  - Trading endpoints

**Current Implementation**: Uses bid/ask prices from `/markets` endpoint (no auth required).
For full orderbook depth, API key authentication would need to be added.

## Known Limitations

1. **Kalshi Orderbook**: Full orderbook data requires API key authentication with RSA-PSS signatures.
   Current implementation uses `yes_bid`, `yes_ask` from markets endpoint.

2. **WebSocket Support**: Neither adapter implements WebSocket connections for real-time data.
   Would be needed for sub-second latency requirements.

3. **Historical Backfill**: No mechanism for backfilling historical data.
   API calls only fetch current state.

## Future Improvements

- [ ] Add Kalshi API key authentication for orderbook endpoint
- [ ] Implement WebSocket adapters for real-time updates
- [ ] Add Manifold Markets adapter (open API available)
- [ ] Add metrics/observability (Prometheus metrics)
- [ ] Implement data retention policy (auto-delete old quotes)

# Implementation Notes

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

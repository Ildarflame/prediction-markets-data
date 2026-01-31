# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Data Module v1 - ingestion system for prediction markets (Polymarket, Kalshi). Collects markets, outcomes, and price quotes with deduplication, checkpointing, and archival. Includes cross-venue market matching.

## Build & Development Commands

```bash
pnpm install                              # Install dependencies
pnpm build                                # Build all packages
docker compose up -d postgres             # Start Postgres
pnpm --filter @data-module/db db:generate # Generate Prisma client
pnpm --filter @data-module/db db:migrate  # Run migrations
pnpm --filter @data-module/db db:studio   # Prisma GUI for database
pnpm typecheck                            # Type check all packages

# Run tests (uses Node's built-in test runner)
npx tsx --test packages/core/src/ticker.test.ts                         # Single test file
npx tsx --test services/worker/src/matching/cryptoAutoConfirm.test.ts   # Matching tests
```

## Worker CLI Commands

```bash
# Ingestion
pnpm --filter @data-module/worker ingest -v polymarket -m once   # Single ingestion run
pnpm --filter @data-module/worker ingest -v polymarket -m loop   # Continuous ingestion
pnpm --filter @data-module/worker ingest -v kalshi -m split      # Split mode (separate market/quote intervals)

# Data management
pnpm --filter @data-module/worker seed                           # Generate test data
pnpm --filter @data-module/worker archive                        # Archive old markets
pnpm --filter @data-module/worker sanity                         # Data quality checks
pnpm --filter @data-module/worker health                         # Health check (DB, jobs, freshness)
pnpm --filter @data-module/worker reconcile -v polymarket        # Find missing markets

# Cross-venue matching
pnpm --filter @data-module/worker suggest-matches --from polymarket --to kalshi
pnpm --filter @data-module/worker list-suggestions --status suggested
pnpm --filter @data-module/worker confirm-match --id <link_id>

# Kalshi diagnostics
pnpm --filter @data-module/worker kalshi:ingestion:diag          # Check Kalshi ingestion health

# Sanity/Diagnostics (v2.6.6, v2.6.7)
pnpm --filter @data-module/worker kalshi:sanity:status           # Check Kalshi status/closeTime anomalies (minor/major buckets)
pnpm --filter @data-module/worker quotes:freshness --venue kalshi --minutes 10  # Quotes freshness check
pnpm --filter @data-module/worker polymarket:ingestion:cursor    # Polymarket cursor diagnostics
pnpm --filter @data-module/worker links:stats                    # Link statistics with avgScore
pnpm --filter @data-module/worker venue:sanity:eligible --venue kalshi --topic crypto_daily  # Eligibility diagnostics

# Watchlist Quotes (v2.6.7) - targeted quotes instead of all markets
pnpm --filter @data-module/worker links:watchlist:sync --dry-run   # Sync links to watchlist
pnpm --filter @data-module/worker watchlist:stats                  # Watchlist statistics
pnpm --filter @data-module/worker watchlist:list --venue kalshi    # List watchlist entries
pnpm --filter @data-module/worker watchlist:cleanup --older-than-days 30 --dry-run

# Review Loop (v2.6.7) - manage suggested links
pnpm --filter @data-module/worker links:queue --topic crypto_daily  # Show links for review
pnpm --filter @data-module/worker links:auto-reject --dry-run       # Auto-reject low-quality

# V3 Engine Commands (v3.0.0+)
pnpm --filter @data-module/worker v3:suggest-matches --topic RATES      # Run V3 matching for specific topic
pnpm --filter @data-module/worker v3:suggest-all                        # Run V3 matching for all topics
pnpm --filter @data-module/worker v3:best --topic CRYPTO_DAILY          # Show top matches by score
pnpm --filter @data-module/worker v3:worst --topic CRYPTO_DAILY         # Show worst matches (potential false positives)

# LLM Validation & Review (v3.1.0)
pnpm --filter @data-module/worker llm:validate --link-id <id>           # Validate link using LLM (Ollama or OpenAI)
pnpm --filter @data-module/worker review:server                         # Start web UI for manual review
pnpm --filter @data-module/worker review:rollback --link-id <id>        # Undo accidental confirmation/rejection

# Taxonomy Classification (v3.0.0+)
pnpm --filter @data-module/worker taxonomy:coverage                     # Show topic coverage across venues
pnpm --filter @data-module/worker taxonomy:overlap --topic RATES        # Cross-venue market overlap per topic
pnpm --filter @data-module/worker taxonomy:gap-report --topic SPORTS    # Analyze why topic has low overlap
pnpm --filter @data-module/worker taxonomy:truth-audit --topic RATES    # Verify taxonomy classification accuracy
pnpm --filter @data-module/worker polymarket:taxonomy:backfill          # Backfill Polymarket taxonomy
pnpm --filter @data-module/worker kalshi:taxonomy:backfill              # Backfill Kalshi taxonomy

# Operations & Automation (v2.6.8+)
pnpm --filter @data-module/worker ops:run                               # Run scheduled operations loop (V2)
pnpm --filter @data-module/worker ops:run:v3 --topics RATES,CRYPTO      # Run V3 operations loop
pnpm --filter @data-module/worker ops:kpi                               # Show key performance indicators dashboard

# Testing & Debugging (v3.0.16)
pnpm --filter @data-module/worker test:extractor --topic RATES          # Test Universal Entity Extractor
pnpm --filter @data-module/worker test:universal-scorer --topic RATES   # Test Universal Scorer

# Events Management (v3.0.4+)
pnpm --filter @data-module/worker polymarket:events:sync                # Sync Polymarket events from Gamma API
pnpm --filter @data-module/worker polymarket:events:coverage            # Show Polymarket events linkage coverage
pnpm --filter @data-module/worker kalshi:events:sync --series KXNBA     # Sync Kalshi events for series
pnpm --filter @data-module/worker kalshi:events:smart-sync --non-mve    # Smart sync based on market eventTickers
pnpm --filter @data-module/worker kalshi:series:sync                    # Sync Kalshi series metadata
pnpm --filter @data-module/worker kalshi:series:audit --topic SPORTS    # Audit series categories/tags mapping

# Topic-Specific Commands

## Commodities (v3.0.4+)
pnpm --filter @data-module/worker commodities:counts                    # Count commodities markets per venue
pnpm --filter @data-module/worker commodities:overlap                   # Find commodities overlap
pnpm --filter @data-module/worker commodities:best                      # Show best commodities matches

## Sports (v3.0.12+)
pnpm --filter @data-module/worker sports:audit                          # Show sports market breakdown by eligibility
pnpm --filter @data-module/worker sports:sample                         # Show sample sports markets with signals
pnpm --filter @data-module/worker sports:eligible                       # Show eligible sports markets count
pnpm --filter @data-module/worker sports:event-coverage --venue kalshi  # Show event coverage for sports
pnpm --filter @data-module/worker kalshi:mve:backfill                   # Backfill isMve field for Kalshi sports
pnpm --filter @data-module/worker kalshi:mve:audit                      # Audit MVE truth field coverage
pnpm --filter @data-module/worker kalshi:sports:breakdown               # Show MVE vs Non-MVE breakdown

## Crypto Intraday (v2.6.3+)
pnpm --filter @data-module/worker crypto:intraday:counts                # Count intraday crypto markets
pnpm --filter @data-module/worker crypto:intraday:overlap               # Find intraday crypto overlap
pnpm --filter @data-module/worker crypto:intraday:best --apply          # Show/auto-confirm best intraday matches
```

## Architecture

**Monorepo structure** (pnpm workspaces):
- **packages/core**: Shared types (DTOs, Venue, MarketStatus), utilities (dedup, retry, batch, ticker extraction)
- **packages/db**: Prisma schema, client, repositories (Market, Quote, Ingestion, MarketLink)
- **services/worker**: CLI (Commander.js), venue adapters, pipelines

**Data flow**: Adapter → MarketDTO → Repository → Postgres

**Ingestion modes**:
- `once`: Single run
- `loop`: Fixed interval
- `split`: Separate intervals for markets (slow, 30min) and quotes (fast, 60s)

**Quote deduplication**: Price threshold (epsilon=0.001) OR time threshold (60s) - writes if either exceeded

## Matching Module

Cross-venue matching (`services/worker/src/matching/`):
- **Scoring**: 70% Jaccard text similarity + 20% time proximity + 10% category match
- **cryptoPipeline.ts**: Crypto-specific matching with bracket extraction
- **cryptoBrackets.ts**: Parse price brackets from market titles
- **cryptoAutoConfirm.ts**: Auto-confirm high-confidence crypto matches
- Only binary markets (2 outcomes) are matched

## Kalshi Authentication

For full orderbook access, configure in `.env`:
```
KALSHI_API_KEY_ID=your_key_id
KALSHI_PRIVATE_KEY_PATH=./kalshi-private-key.pem
```

Kalshi modes: `KALSHI_MODE=markets` (direct) or `KALSHI_MODE=catalog` (series→events→markets hierarchy)

## Eligibility Module (v2.6.7)

Unified market eligibility filtering (`services/worker/src/eligibility/`):
- **Key Principle**: Never trust `status` alone - use time-based filtering
- `buildEligibleWhere()`: Prisma WHERE clause for eligible markets
- `isEligibleMarket()`: Runtime check for single market
- `explainEligibility()`: Detailed reasons for eligibility/exclusion
- **stale_active**: Active markets with closeTime in past (beyond grace period)
- Configurable via `ELIGIBILITY_GRACE_MINUTES`, `ELIGIBILITY_LOOKBACK_HOURS_*`

## Watchlist Quotes (v2.6.7)

Instead of quoting all 1.2M markets, use targeted watchlist:
1. `links:watchlist:sync` - Populate from confirmed/top-suggested links
2. Set `QUOTES_MODE=watchlist` in environment
3. Quotes worker fetches only from `quote_watchlist` table
4. Priority: 100 (confirmed) > 50 (top_suggested) > 0 (manual)

Environment variables:
```
QUOTES_MODE=watchlist          # or 'global' for legacy mode
QUOTES_WATCHLIST_LIMIT=2000    # Max markets per quote cycle
WATCHLIST_MIN_SCORE=0.92       # Min score for top_suggested
```

## Key Files

- `packages/db/prisma/schema.prisma` - Database schema (Market, Outcome, Quote, MarketLink, QuoteWatchlist)
- `services/worker/src/cli.ts` - CLI entry point
- `services/worker/src/adapters/` - Venue API adapters
- `services/worker/src/pipeline/ingest.ts` - Main ingestion pipeline
- `services/worker/src/pipeline/split-runner.ts` - Split mode runner (watchlist support)
- `services/worker/src/eligibility/` - Eligibility filtering module
- `.env.example` - Full environment variables reference

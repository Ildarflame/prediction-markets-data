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

# Sanity/Diagnostics (v2.6.6)
pnpm --filter @data-module/worker kalshi:sanity:status           # Check Kalshi status/closeTime anomalies
pnpm --filter @data-module/worker quotes:freshness --venue kalshi --minutes 10  # Quotes freshness check
pnpm --filter @data-module/worker polymarket:ingestion:cursor    # Polymarket cursor diagnostics
pnpm --filter @data-module/worker links:stats                    # Link statistics with avgScore
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

## Key Files

- `packages/db/prisma/schema.prisma` - Database schema (Market, Outcome, Quote, MarketLink)
- `services/worker/src/cli.ts` - CLI entry point
- `services/worker/src/adapters/` - Venue API adapters
- `services/worker/src/pipeline/ingest.ts` - Main ingestion pipeline
- `services/worker/src/pipeline/split-runner.ts` - Split mode runner
- `.env.example` - Full environment variables reference

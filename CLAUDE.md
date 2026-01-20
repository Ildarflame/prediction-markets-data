# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Data Module v1 - ingestion system for prediction markets (Polymarket, Kalshi). Collects markets, outcomes, and price quotes with deduplication, checkpointing, and archival.

## Build & Development Commands

```bash
pnpm install                              # Install dependencies
pnpm build                                # Build all packages
docker compose up -d postgres             # Start Postgres
pnpm --filter @data-module/db db:generate # Generate Prisma client
pnpm --filter @data-module/db db:migrate  # Run migrations

# Worker commands
pnpm --filter @data-module/worker seed                           # Generate test data
pnpm --filter @data-module/worker ingest -v polymarket -m once   # Single ingestion run
pnpm --filter @data-module/worker ingest -v polymarket -m loop   # Continuous ingestion
pnpm --filter @data-module/worker archive                        # Archive old markets
pnpm --filter @data-module/worker sanity                         # Data quality checks
```

## Architecture

- **packages/core**: Shared types (DTOs, Venue, MarketStatus), utilities (dedup, retry, batch)
- **packages/db**: Prisma schema, client, repositories (Market, Quote, Ingestion)
- **services/worker**: CLI, venue adapters (Polymarket, Kalshi), ingestion pipeline

## Key Files

- `packages/db/prisma/schema.prisma` - Database schema
- `services/worker/src/cli.ts` - CLI entry point
- `services/worker/src/adapters/` - Venue API adapters
- `services/worker/src/pipeline/ingest.ts` - Main ingestion pipeline
- `docker-compose.yml` - Postgres container
- `.env.example` - Environment variables template

# Data Module v1.1.1

Data ingestion module for prediction markets (Polymarket, Kalshi). Collects markets, outcomes, and price quotes with deduplication, checkpointing, and archival support.

## Features

- **Multi-venue support**: Polymarket and Kalshi adapters
- **Append-only quotes**: Full price history with deduplication
- **Latest quotes view**: Fast access to current prices
- **Checkpointing**: Resume ingestion from last position
- **Audit trail**: Track all ingestion runs
- **Archival**: Automatic archiving of old/resolved markets
- **Seed mode**: Generate test data without API calls

### v1.1 Improvements

- **Split sync mode**: Separate intervals for markets (slow) and quotes (fast)
- **Float-safe dedup**: Bucket-based price comparison
- **In-cycle dedup**: Prevent duplicates within same ingestion run
- **Raw JSON storage**: Debug data saved with quotes
- **Health check**: Monitor database and job health
- **Reconcile**: Find and add missing markets from source

### v1.1.1 Improvements

- **Per-venue dedup config**: Separate epsilon/interval settings per venue via env
- **Retry-After support**: Respects API rate limit headers, exponential backoff with jitter
- **Reconcile dry-run**: Preview missing markets without writing to DB
- **Docker healthcheck**: Worker containers report health via CLI health command
- **Quotes-sync pagination**: Round-robin cursor for large market counts (QUOTES_MAX_MARKETS_PER_CYCLE)

## Project Structure

```
data_module_v1/
├── packages/
│   ├── core/          # Shared types, DTOs, utilities
│   └── db/            # Prisma schema, client, repositories
├── services/
│   └── worker/        # CLI, adapters, ingestion pipeline
├── docker-compose.yml # Postgres container
├── .env.example       # Environment template
└── NOTES.md           # API research and implementation notes
```

## Quickstart

### 1. Install dependencies

```bash
pnpm install
```

### 2. Start Postgres

```bash
docker compose up -d postgres
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env if needed (defaults work with docker-compose)
```

### 4. Run migrations

```bash
pnpm --filter @data-module/db db:generate
pnpm --filter @data-module/db db:migrate
```

### 5. Seed test data (optional)

```bash
pnpm --filter @data-module/worker seed
```

### 6. Run ingestion

```bash
# Single run
pnpm --filter @data-module/worker ingest --venue polymarket --mode once

# Continuous loop (every 60 seconds)
pnpm --filter @data-module/worker ingest --venue polymarket --mode loop --interval 60

# Kalshi
pnpm --filter @data-module/worker ingest --venue kalshi --mode once
```

## CLI Commands

### Ingest

Fetch data from a prediction market venue.

```bash
pnpm --filter @data-module/worker ingest [options]

Options:
  -v, --venue <venue>          Venue: polymarket, kalshi (required)
  -m, --mode <mode>            Mode: once, loop, or split (default: once)
  -i, --interval <seconds>     Loop interval in seconds (default: 60)
  --max-markets <number>       Max markets to fetch (default: 10000)
  --page-size <number>         API page size (default: 100)
  --epsilon <number>           Price dedup threshold (default: 0.001)
  --min-interval <seconds>     Min seconds between quotes (default: 60)
  --markets-refresh <seconds>  Markets refresh interval, split mode (default: 1800)
  --quotes-refresh <seconds>   Quotes refresh interval, split mode (default: 60)
  --quotes-lookback <hours>    Include closed markets within N hours (default: 24)
```

**Modes:**
- `once`: Single ingestion run
- `loop`: Continuous ingestion at fixed interval
- `split`: Separate intervals for markets (slow) and quotes (fast)

### Seed

Generate test data for development.

```bash
pnpm --filter @data-module/worker seed [options]

Options:
  -m, --markets <number>    Markets to create (default: 10)
  -o, --outcomes <number>   Outcomes per market (default: 2)
  -d, --duration <minutes>  Quote history duration (default: 5)
  -i, --interval <seconds>  Quote interval (default: 10)
```

### Archive

Archive old markets.

```bash
pnpm --filter @data-module/worker archive [options]

Options:
  --resolved-days <days>  Archive resolved after N days (default: 30)
  --closed-days <days>    Archive closed after N days (default: 14)
  --dry-run               Preview without changes
```

### Sanity Check

Validate data quality.

```bash
pnpm --filter @data-module/worker sanity [options]

Options:
  -v, --venue <venue>     Check specific venue only
  --max-age <minutes>     Max age for fresh quotes (default: 10)
```

### Health Check (v1.1)

Check database connection, job states, and quote freshness.

```bash
pnpm --filter @data-module/worker health [options]

Options:
  --max-stale <minutes>    Max age for fresh quotes (default: 5)
  --max-job-age <minutes>  Max age for last successful job (default: 10)
```

Exit code 0 if healthy, 1 if issues detected.

### Reconcile (v1.1)

Find and add missing markets from source.

```bash
pnpm --filter @data-module/worker reconcile [options]

Options:
  -v, --venue <venue>       Venue to reconcile (required)
  --page-size <number>      API page size (default: 100)
  --max-markets <number>    Max markets to fetch (default: 50000)
  --dry-run                 Preview without making changes (v1.1.1)
```

Example dry-run:
```bash
pnpm --filter @data-module/worker reconcile -v polymarket --dry-run
```

## Database Schema

### Tables

| Table | Description |
|-------|-------------|
| `markets` | Prediction markets with status and metadata |
| `outcomes` | Market outcomes (Yes/No/Other) |
| `quotes` | Append-only price history |
| `latest_quotes` | Most recent quote per outcome |
| `ingestion_state` | Checkpoint data for resumable ingestion |
| `ingestion_runs` | Audit log of ingestion executions |

### Market Lifecycle

```
active → closed → resolved → archived
           ↓
        archived (if no resolution after 14 days)
```

### Key Indexes

- `quotes(outcome_id, ts DESC)` - Fast quote history queries
- `markets(venue, external_id) UNIQUE` - Dedup market inserts
- `markets(status, close_time)` - Archive queries
- `latest_quotes(outcome_id) UNIQUE` - One latest per outcome

## Quote Deduplication

Quotes are deduplicated to reduce storage:

1. **Price threshold** (epsilon=0.001): Skip if price changed < 0.1%
2. **Time threshold** (60s): Always record if 60+ seconds since last quote

Both conditions use OR logic - a quote is written if EITHER threshold is exceeded.

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | - | Postgres connection string |
| `INGEST_PAGE_SIZE` | 100 | Markets per API request |
| `INGEST_MAX_MARKETS` | 10000 | Max markets per run |
| `INGEST_INTERVAL_SECONDS` | 60 | Loop mode interval |
| `DEDUP_EPSILON` | 0.001 | Price change threshold (global default) |
| `DEDUP_MIN_INTERVAL_SECONDS` | 60 | Min seconds between quotes (global default) |
| `MARKETS_REFRESH_SECONDS` | 1800 | Markets sync interval (split mode) |
| `QUOTES_REFRESH_SECONDS` | 60 | Quotes sync interval (split mode) |
| `QUOTES_CLOSED_LOOKBACK_HOURS` | 24 | Include closed markets within N hours |
| `QUOTES_MAX_MARKETS_PER_CYCLE` | 2000 | Max markets per quotes-sync cycle |

### Per-venue dedup settings (v1.1.1)

| Variable | Default | Description |
|----------|---------|-------------|
| `DEDUP_EPSILON_POLYMARKET` | 0.001 | Polymarket price threshold |
| `DEDUP_MIN_INTERVAL_SECONDS_POLYMARKET` | 60 | Polymarket min interval |
| `DEDUP_EPSILON_KALSHI` | 0.001 | Kalshi price threshold |
| `DEDUP_MIN_INTERVAL_SECONDS_KALSHI` | 60 | Kalshi min interval |

## Development

### Build all packages

```bash
pnpm build
```

### Type check

```bash
pnpm typecheck
```

### Prisma Studio (DB GUI)

```bash
pnpm --filter @data-module/db db:studio
```

## Supported Venues

| Venue | Status | Notes |
|-------|--------|-------|
| Polymarket | ✅ Full | Gamma API + CLOB API |
| Kalshi | ✅ Partial | Public endpoints only (orderbook needs API key) |

See [NOTES.md](./NOTES.md) for detailed API documentation and limitations.

# Schema Migrator Agent

Manage Prisma schema and database migrations.

## Files
- `packages/db/prisma/schema.prisma` - Main schema file
- `packages/db/src/repositories/` - Repository implementations

## Key Tables

### Core
- `markets` - Market definitions (Polymarket, Kalshi)
- `outcomes` - Binary outcomes for each market
- `quotes` - Price quotes with timestamps

### Matching
- `market_links` - Cross-venue market matches
- `quote_watchlist` - Targeted quote fetching list

### Ingestion
- `ingestion_checkpoints` - Cursor positions for incremental ingestion

## Commands

### Generate Prisma Client
```bash
pnpm --filter @data-module/db db:generate
```

### Create Migration
```bash
pnpm --filter @data-module/db db:migrate --name <migration_name>
```

### Open Prisma Studio
```bash
pnpm --filter @data-module/db db:studio
```

### Push Schema (dev only)
```bash
pnpm --filter @data-module/db db:push
```

## Workflow

1. Edit `schema.prisma`
2. Run `db:generate` to update client types
3. Run `db:migrate` to create migration
4. Commit migration file
5. Deploy: pull on server, run migrate

## Instructions

1. Always backup before destructive changes
2. Use nullable fields for new columns to avoid migration issues
3. Add indexes for frequently queried fields
4. Update repositories after schema changes
5. Test locally before deploying to production

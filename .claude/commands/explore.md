# Codebase Explorer Agent

Quick reference for navigating the codebase.

## Project Structure

```
data_module_v1/
├── packages/
│   ├── core/                 # Shared types & utilities
│   │   └── src/
│   │       ├── types/        # DTOs, enums (Venue, MarketStatus)
│   │       └── utils/        # dedup, retry, batch, ticker
│   └── db/                   # Database layer
│       ├── prisma/
│       │   └── schema.prisma # Database schema
│       └── src/
│           └── repositories/ # Data access
├── services/
│   └── worker/              # CLI & pipelines
│       └── src/
│           ├── cli.ts       # Entry point
│           ├── adapters/    # Venue API clients
│           │   ├── kalshi/
│           │   └── polymarket/
│           ├── pipeline/    # Ingestion pipelines
│           ├── matching/    # V3 matching engine
│           │   ├── engineV3.ts
│           │   ├── pipelines/   # Topic pipelines
│           │   └── signals/     # Signal extractors
│           └── eligibility/ # Market filtering
├── docs/
│   └── releases/           # Release documentation
└── .claude/
    └── commands/           # Claude Code agents
```

## Key Files by Feature

### Matching
- `engineV3.ts` - Core matching loop
- `basePipeline.ts` - Pipeline interface
- `*Pipeline.ts` - Topic implementations
- `*Signals.ts` - Signal extraction

### Ingestion
- `pipeline/ingest.ts` - Main ingestion
- `pipeline/split-runner.ts` - Split mode
- `adapters/*/` - API clients

### Database
- `schema.prisma` - All tables
- `market.repository.ts` - Market CRUD
- `market-link.repository.ts` - Link CRUD

## Quick Searches

### Find Pipeline
```
services/worker/src/matching/pipelines/*Pipeline.ts
```

### Find Signal Extractor
```
services/worker/src/matching/signals/*Signals.ts
```

### Find CLI Command
```
grep -r "\.command\(" services/worker/src/
```

### Find Repository Method
```
grep -r "async methodName" packages/db/src/repositories/
```

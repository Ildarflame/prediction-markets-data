# Ingestion Doctor Agent

Diagnose and fix ingestion issues.

## Adapters
- `services/worker/src/adapters/polymarket/` - Polymarket CLOB API
- `services/worker/src/adapters/kalshi/` - Kalshi REST API

## Ingestion Modes
- `once` - Single run
- `loop` - Fixed interval continuous
- `split` - Separate intervals for markets (slow) and quotes (fast)

## Diagnostic Commands

### Check Ingestion Health
```bash
node services/worker/dist/cli.js health
```

### Kalshi Diagnostics
```bash
node services/worker/dist/cli.js kalshi:ingestion:diag
node services/worker/dist/cli.js kalshi:sanity:status
```

### Polymarket Cursor
```bash
node services/worker/dist/cli.js polymarket:ingestion:cursor
```

### Quote Freshness
```bash
node services/worker/dist/cli.js quotes:freshness --venue kalshi --minutes 10
node services/worker/dist/cli.js quotes:freshness --venue polymarket --minutes 10
```

### Market Counts
```bash
node services/worker/dist/cli.js venue:sanity:eligible --venue kalshi
node services/worker/dist/cli.js venue:sanity:eligible --venue polymarket
```

## Common Issues

### Stale Quotes
1. Check if ingestion worker is running
2. Verify API credentials
3. Check rate limits

### Missing Markets
1. Run reconcile command
2. Check category filters
3. Verify API pagination

### Kalshi Auth Issues
```
KALSHI_API_KEY_ID=...
KALSHI_PRIVATE_KEY_PATH=./kalshi-private-key.pem
```

## Instructions

1. Always check health first
2. Compare expected vs actual market counts
3. Verify cursor positions haven't stalled
4. Check Docker logs for errors on server

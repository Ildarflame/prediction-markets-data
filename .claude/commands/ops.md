# Ops Runner Agent

Run operations on the production server (64.111.93.112).

## Server Connection
```
Host: 64.111.93.112
User: root
Password: gimgimlil123A$A
Project: ~/data_module_v1
```

## Common Operations

### Matching Cycle
```bash
# Run all V3 matching pipelines
for topic in CRYPTO_DAILY MACRO RATES ELECTIONS; do
  node services/worker/dist/cli.js v3:suggest-matches --topic $topic --auto-confirm --auto-reject
done
node services/worker/dist/cli.js links:watchlist:sync
```

### Check Stats
```bash
node services/worker/dist/cli.js links:stats
node services/worker/dist/cli.js watchlist:stats
```

### Quote Freshness
```bash
node services/worker/dist/cli.js quotes:freshness --venue kalshi --minutes 10
node services/worker/dist/cli.js quotes:freshness --venue polymarket --minutes 10
```

### Health Check
```bash
node services/worker/dist/cli.js health
```

## Instructions

1. Always use sshpass for SSH connections
2. Always cd to ~/data_module_v1 first
3. Use DEBUG='' to suppress prisma logs
4. Pull latest code and rebuild before running if code was changed locally
5. Report results in a clear summary table

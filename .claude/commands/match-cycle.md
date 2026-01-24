# Match Cycle Agent

Run the full V3 matching cycle with auto-confirm/reject.

## Quick Run

Execute on server:
```bash
sshpass -p 'gimgimlil123A$A' ssh -o StrictHostKeyChecking=no root@64.111.93.112 "cd ~/data_module_v1 && \
  for topic in CRYPTO_DAILY MACRO RATES ELECTIONS; do \
    echo '=== Running $topic ===' && \
    node services/worker/dist/cli.js v3:suggest-matches --topic \$topic --auto-confirm --auto-reject --lookback-hours 720; \
  done && \
  echo '=== Syncing watchlist ===' && \
  node services/worker/dist/cli.js links:watchlist:sync && \
  echo '=== Final stats ===' && \
  node services/worker/dist/cli.js links:stats"
```

## Topics

| Topic | Auto-Confirm | Auto-Reject | Notes |
|-------|--------------|-------------|-------|
| CRYPTO_DAILY | Yes | Yes | Bracket + ticker match |
| MACRO | Yes | Yes | Metric + threshold match |
| RATES | Yes | Yes | Metric + threshold match |
| ELECTIONS | Yes | Yes | Country + office + year + candidate |
| COMMODITIES | No | No | Too many false positives |
| CLIMATE | No | No | Team name confusion |
| SPORTS | N/A | N/A | No data overlap |

## Expected Output

After successful run:
- New suggestions created
- High-quality matches auto-confirmed
- Low-quality matches auto-rejected
- Watchlist synced with confirmed links

## Instructions

1. Run this after code changes that affect matching
2. Check the auto-confirmed count for each topic
3. Review suggestions with score 0.85-0.95 manually
4. Report final confirmed/rejected counts

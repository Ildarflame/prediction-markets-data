# Matching Debugger Agent

Debug and analyze V3 matching pipelines.

## Pipeline Files
- `services/worker/src/matching/pipelines/` - All pipeline implementations
- `services/worker/src/matching/signals/` - Signal extraction logic
- `services/worker/src/matching/engineV3.ts` - Core matching engine

## Key Concepts

### Signals
Each pipeline extracts domain-specific signals:
- CRYPTO: ticker, bracket, direction, date
- ELECTIONS: country, office, year, candidates
- RATES: metric, threshold, direction, date
- SPORTS: league, teams, gameDate

### Scoring
```
score = weighted_sum(component_scores)
components: text, time, category, domain-specific
```

### Hard Gates
Binary pass/fail checks before scoring:
- Must match on critical fields
- UNKNOWN values typically fail (v3.0.10)

### Auto-Confirm Rules
- Score threshold (varies by topic)
- All component scores must be 1.0
- Domain-specific checks

## Debug Commands

### Debug Single Market
```bash
node services/worker/dist/cli.js v3:suggest-matches --topic <TOPIC> --debug-one <MARKET_ID> --dry-run
```

### Check Link Queue
```bash
node services/worker/dist/cli.js links:queue --topic <TOPIC> --limit 20
```

### Explain Why Match Failed
1. Read the pipeline's checkHardGates() method
2. Check signal extraction for both markets
3. Verify component scores in reason field

## Instructions

1. When debugging matches, always read both market titles first
2. Extract signals manually to verify signal extraction
3. Check hard gates before investigating scoring
4. Use --dry-run for testing changes

# Implementation Notes

## API Research Summary

### Polymarket
**Status: ✅ Fully implemented**

- **Gamma API** (`https://gamma-api.polymarket.com`): Used for market/event discovery
  - No authentication required for public data
  - Rate limits: 300 req/10s for /markets, 500 req/10s for /events
  - Pagination via `limit` and `offset` parameters

- **CLOB API** (`https://clob.polymarket.com`): Used for orderbook/price data
  - No authentication required for read operations
  - Batch endpoint `/books` accepts array of token IDs
  - Returns bid/ask arrays with price and size

- **Token ID Mapping**: Markets have `clobTokenIds` array that maps 1:1 with outcomes

### Kalshi
**Status: ✅ Implemented (public endpoints only)**

- **Base URL**: `https://api.elections.kalshi.com/trade-api/v2`
  - Despite "elections" subdomain, provides access to ALL markets

- **Public Endpoints** (no auth):
  - `GET /markets` - List markets with bid/ask prices
  - `GET /events` - List events
  - `GET /markets/trades` - Trade history

- **Authenticated Endpoints** (RSA-PSS signature required):
  - `GET /markets/{ticker}/orderbook` - Full orderbook depth
  - Trading endpoints

**Current Implementation**: Uses bid/ask prices from `/markets` endpoint (no auth required).
For full orderbook depth, API key authentication would need to be added.

## Known Limitations

1. **Kalshi Orderbook**: Full orderbook data requires API key authentication with RSA-PSS signatures.
   Current implementation uses `yes_bid`, `yes_ask` from markets endpoint.

2. **WebSocket Support**: Neither adapter implements WebSocket connections for real-time data.
   Would be needed for sub-second latency requirements.

3. **Historical Backfill**: No mechanism for backfilling historical data.
   API calls only fetch current state.

## Future Improvements

- [ ] Add Kalshi API key authentication for orderbook endpoint
- [ ] Implement WebSocket adapters for real-time updates
- [ ] Add Manifold Markets adapter (open API available)
- [ ] Add metrics/observability (Prometheus metrics)
- [ ] Implement data retention policy (auto-delete old quotes)

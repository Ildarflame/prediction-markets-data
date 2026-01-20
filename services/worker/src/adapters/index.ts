import type { Venue } from '@data-module/core';
import { type VenueAdapter, type AdapterConfig } from './types.js';
import { PolymarketAdapter } from './polymarket.adapter.js';
import { KalshiAdapter } from './kalshi.adapter.js';

export { type VenueAdapter, type AdapterConfig } from './types.js';
export { PolymarketAdapter } from './polymarket.adapter.js';
export { KalshiAdapter } from './kalshi.adapter.js';

/**
 * Create adapter for a venue
 */
export function createAdapter(venue: Venue, config?: AdapterConfig): VenueAdapter {
  switch (venue) {
    case 'polymarket':
      return new PolymarketAdapter(config);
    case 'kalshi':
      return new KalshiAdapter(config);
    default:
      throw new Error(`Unknown venue: ${venue}`);
  }
}

/**
 * Get all supported venues
 */
export function getSupportedVenues(): Venue[] {
  return ['polymarket', 'kalshi'];
}

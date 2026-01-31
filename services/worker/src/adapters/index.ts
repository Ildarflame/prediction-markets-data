import type { Venue } from '@data-module/core';
import { type VenueAdapter, type AdapterConfig } from './types.js';
import { PolymarketAdapter } from './polymarket.adapter.js';
import { KalshiAdapter, type KalshiAuthConfig } from './kalshi.adapter.js';

export { type VenueAdapter, type AdapterConfig } from './types.js';
export { BaseAdapter, type BaseAdapterConfig } from './base.adapter.js';
export { PolymarketAdapter } from './polymarket.adapter.js';
export { KalshiAdapter, type KalshiAuthConfig, type KalshiFetchStats } from './kalshi.adapter.js';
export { type KalshiConfig, type KalshiMode, loadKalshiConfig, formatKalshiConfig } from './kalshi.config.js';

export interface CreateAdapterOptions {
  config?: AdapterConfig;
  kalshiAuth?: KalshiAuthConfig;
}

/**
 * Create adapter for a venue
 */
export function createAdapter(venue: Venue, options: CreateAdapterOptions = {}): VenueAdapter {
  const { config, kalshiAuth } = options;

  switch (venue) {
    case 'polymarket':
      return new PolymarketAdapter(config);
    case 'kalshi':
      return new KalshiAdapter(config, kalshiAuth);
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

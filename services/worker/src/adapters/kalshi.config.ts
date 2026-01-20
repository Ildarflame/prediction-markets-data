/**
 * Kalshi ingestion configuration
 */

export type KalshiMode = 'markets' | 'catalog';

export interface KalshiConfig {
  /** Markets per page (max 1000) */
  marketsLimit: number;
  /** Max pages to fetch (0 = unlimited) */
  maxPages: number;
  /** Ingestion mode */
  mode: KalshiMode;
  /** Series tickers to fetch in catalog mode (empty = all) */
  seriesTickers: string[];
  /** Event statuses to fetch */
  eventsStatus: string[];
  /** Include nested markets in events response */
  withNestedMarkets: boolean;
  /** Hard cap on total markets */
  globalCapMarkets: number;
}

export const DEFAULT_KALSHI_CONFIG: KalshiConfig = {
  marketsLimit: 1000,
  maxPages: 0,
  mode: 'markets',
  seriesTickers: [],
  eventsStatus: ['open', 'closed'],
  withNestedMarkets: true,
  globalCapMarkets: 100000,
};

/**
 * Load Kalshi config from environment variables
 */
export function loadKalshiConfig(): KalshiConfig {
  const config: KalshiConfig = { ...DEFAULT_KALSHI_CONFIG };

  if (process.env.KALSHI_MARKETS_LIMIT) {
    config.marketsLimit = Math.min(1000, parseInt(process.env.KALSHI_MARKETS_LIMIT, 10) || 1000);
  }

  if (process.env.KALSHI_MAX_PAGES) {
    config.maxPages = parseInt(process.env.KALSHI_MAX_PAGES, 10) || 0;
  }

  if (process.env.KALSHI_MODE) {
    const mode = process.env.KALSHI_MODE.toLowerCase();
    if (mode === 'markets' || mode === 'catalog') {
      config.mode = mode;
    }
  }

  if (process.env.KALSHI_SERIES_TICKERS) {
    config.seriesTickers = process.env.KALSHI_SERIES_TICKERS
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }

  if (process.env.KALSHI_EVENTS_STATUS) {
    config.eventsStatus = process.env.KALSHI_EVENTS_STATUS
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(s => ['open', 'closed', 'settled'].includes(s));
  }

  if (process.env.KALSHI_WITH_NESTED_MARKETS !== undefined) {
    config.withNestedMarkets = process.env.KALSHI_WITH_NESTED_MARKETS.toLowerCase() === 'true';
  }

  if (process.env.KALSHI_GLOBAL_CAP_MARKETS) {
    config.globalCapMarkets = parseInt(process.env.KALSHI_GLOBAL_CAP_MARKETS, 10) || 100000;
  }

  return config;
}

/**
 * Format Kalshi config for logging
 */
export function formatKalshiConfig(config: KalshiConfig): string {
  const lines = [
    `[kalshi] Configuration:`,
    `  Mode: ${config.mode}`,
    `  Markets limit per page: ${config.marketsLimit}`,
    `  Max pages: ${config.maxPages === 0 ? 'unlimited' : config.maxPages}`,
    `  Global cap: ${config.globalCapMarkets}`,
  ];

  if (config.mode === 'catalog') {
    lines.push(`  Series tickers: ${config.seriesTickers.length > 0 ? config.seriesTickers.join(', ') : 'all'}`);
    lines.push(`  Events status: ${config.eventsStatus.join(', ')}`);
    lines.push(`  With nested markets: ${config.withNestedMarkets}`);
  }

  return lines.join('\n');
}

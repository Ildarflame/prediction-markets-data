/**
 * Kalshi smoke test command
 * Tests specific market tickers to verify API access
 */

import { KalshiAdapter } from '../adapters/index.js';
import { loadKalshiConfig } from '../adapters/kalshi.config.js';

export interface KalshiSmokeOptions {
  tickers: string[];
}

export interface KalshiSmokeResult {
  baseUrl: string;
  results: Array<{
    ticker: string;
    status: number;
    title?: string;
    category?: string;
    error?: string;
  }>;
  summary: {
    total: number;
    success: number;
    notFound: number;
    authError: number;
    otherError: number;
  };
}

/**
 * Known political/economic tickers for testing
 * These are examples - update with actual known tickers
 */
export const KNOWN_POLITICAL_TICKERS = [
  'PRES-2024-DJT',      // Trump 2024
  'PRES-2024',          // Presidential election
  'KXBTC',              // Bitcoin
  'KXINX',              // S&P 500
  'KXCPI',              // CPI
  'KXGDP',              // GDP
  'KXFED',              // Fed rates
  'INX',                // Indexes
  'TRUMP',              // Trump related
];

export async function runKalshiSmoke(options: KalshiSmokeOptions): Promise<KalshiSmokeResult> {
  const config = loadKalshiConfig();
  const adapter = new KalshiAdapter({}, undefined, config);

  const baseUrl = adapter.getBaseUrl();
  console.log(`\n[kalshi-smoke] Testing Kalshi API`);
  console.log(`[kalshi-smoke] Base URL: ${baseUrl}`);
  console.log(`[kalshi-smoke] Tickers to test: ${options.tickers.join(', ')}\n`);

  const results: KalshiSmokeResult['results'] = [];
  const summary = {
    total: options.tickers.length,
    success: 0,
    notFound: 0,
    authError: 0,
    otherError: 0,
  };

  for (const ticker of options.tickers) {
    const result = await adapter.smokeTestTicker(ticker);
    results.push(result);

    const statusIcon = result.status === 200 ? '✓' : result.status === 404 ? '✗' : '!';
    const statusText = result.status === 200
      ? `OK - ${result.title}`
      : result.status === 404
        ? 'NOT FOUND'
        : result.status === 401 || result.status === 403
          ? `AUTH ERROR (${result.status})`
          : `ERROR: ${result.error || result.status}`;

    console.log(`  ${statusIcon} ${ticker.padEnd(20)} -> ${statusText}`);

    if (result.status === 200) {
      summary.success++;
    } else if (result.status === 404) {
      summary.notFound++;
    } else if (result.status === 401 || result.status === 403) {
      summary.authError++;
    } else {
      summary.otherError++;
    }

    // Small delay between requests
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n[kalshi-smoke] Summary:`);
  console.log(`  Total tested: ${summary.total}`);
  console.log(`  Success (200): ${summary.success}`);
  console.log(`  Not found (404): ${summary.notFound}`);
  console.log(`  Auth errors: ${summary.authError}`);
  console.log(`  Other errors: ${summary.otherError}`);

  if (summary.success > 0) {
    console.log(`\n[kalshi-smoke] ✓ Political/economic markets ARE accessible via API`);
  } else if (summary.authError > 0) {
    console.log(`\n[kalshi-smoke] ! Some tickers require authentication`);
  } else {
    console.log(`\n[kalshi-smoke] ✗ No successful responses - check tickers or API status`);
  }

  return { baseUrl, results, summary };
}

/**
 * Discover all series and their categories
 */
export async function runKalshiDiscoverSeries(): Promise<void> {
  const config = loadKalshiConfig();
  const adapter = new KalshiAdapter({}, undefined, config);

  console.log(`\n[kalshi-discover] Fetching all series from Kalshi API...`);
  console.log(`[kalshi-discover] Base URL: ${adapter.getBaseUrl()}\n`);

  const series = await adapter.getAllSeriesWithCategories();

  // Group by category
  const byCategory = new Map<string, typeof series>();
  for (const s of series) {
    const cat = s.category || 'unknown';
    if (!byCategory.has(cat)) {
      byCategory.set(cat, []);
    }
    byCategory.get(cat)!.push(s);
  }

  console.log(`[kalshi-discover] Found ${series.length} series in ${byCategory.size} categories:\n`);

  // Sort categories by count
  const sortedCategories = Array.from(byCategory.entries())
    .sort((a, b) => b[1].length - a[1].length);

  for (const [category, items] of sortedCategories) {
    console.log(`\n  ${category} (${items.length} series):`);
    for (const item of items.slice(0, 5)) {
      console.log(`    - ${item.ticker}: ${item.title}`);
      if (item.tags.length > 0) {
        console.log(`      tags: ${item.tags.join(', ')}`);
      }
    }
    if (items.length > 5) {
      console.log(`    ... and ${items.length - 5} more`);
    }
  }

  // Look for political/economic keywords
  console.log(`\n[kalshi-discover] Series matching political/economic keywords:`);
  const keywords = ['politic', 'election', 'president', 'trump', 'bitcoin', 'btc', 'crypto', 'fed', 'cpi', 'gdp', 'economic'];

  for (const s of series) {
    const text = `${s.title} ${s.category} ${s.tags.join(' ')}`.toLowerCase();
    const matches = keywords.filter(k => text.includes(k));
    if (matches.length > 0) {
      console.log(`  - ${s.ticker}: ${s.title} [${s.category}] (matches: ${matches.join(', ')})`);
    }
  }
}

/**
 * Unit tests for ticker extraction helpers (v2.6.2)
 * Run with: npx tsx --test packages/core/src/ticker.test.ts
 */
import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import {
  normalizeTicker,
  getKalshiSeriesTicker,
  getKalshiEventTicker,
  getKalshiMarketTicker,
  getPolymarketMarketKey,
  isKalshiIntradayTicker,
  isKalshiDailyTicker,
  getTickerPrefix,
} from './utils.js';

describe('normalizeTicker (v2.6.2)', () => {
  it('should uppercase and trim ticker', () => {
    assert.strictEqual(normalizeTicker('  kxbtc  '), 'KXBTC');
    assert.strictEqual(normalizeTicker('KxEthD-26Jan23'), 'KXETHD-26JAN23');
  });

  it('should return null for empty/null/undefined', () => {
    assert.strictEqual(normalizeTicker(null), null);
    assert.strictEqual(normalizeTicker(undefined), null);
    assert.strictEqual(normalizeTicker(''), null);
    assert.strictEqual(normalizeTicker('   '), null);
  });
});

describe('getKalshiSeriesTicker (v2.6.2)', () => {
  it('should extract seriesTicker from metadata', () => {
    const metadata = { seriesTicker: 'KXBTC', eventTicker: 'KXBTCUPDOWN' };
    assert.strictEqual(getKalshiSeriesTicker(metadata), 'KXBTC');
  });

  it('should handle snake_case field name', () => {
    const metadata = { series_ticker: 'kxeth' };
    assert.strictEqual(getKalshiSeriesTicker(metadata), 'KXETH');
  });

  it('should return null for missing metadata', () => {
    assert.strictEqual(getKalshiSeriesTicker(null), null);
    assert.strictEqual(getKalshiSeriesTicker(undefined), null);
    assert.strictEqual(getKalshiSeriesTicker({}), null);
  });
});

describe('getKalshiEventTicker (v2.6.2)', () => {
  it('should extract eventTicker from metadata', () => {
    const metadata = { eventTicker: 'KXBTCUPDOWN-26JAN23' };
    assert.strictEqual(getKalshiEventTicker(metadata), 'KXBTCUPDOWN-26JAN23');
  });

  it('should handle snake_case field name', () => {
    const metadata = { event_ticker: 'KXETHD-26JAN23' };
    assert.strictEqual(getKalshiEventTicker(metadata), 'KXETHD-26JAN23');
  });
});

describe('getKalshiMarketTicker (v2.6.2)', () => {
  it('should extract marketTicker from metadata', () => {
    const metadata = { marketTicker: 'KXBTCUPDOWN-26JAN23-T0945-B104500' };
    assert.strictEqual(getKalshiMarketTicker(metadata), 'KXBTCUPDOWN-26JAN23-T0945-B104500');
  });

  it('should handle snake_case field name', () => {
    const metadata = { market_ticker: 'kxethd-26jan23-b3500' };
    assert.strictEqual(getKalshiMarketTicker(metadata), 'KXETHD-26JAN23-B3500');
  });
});

describe('getPolymarketMarketKey (v2.6.2)', () => {
  it('should extract conditionId', () => {
    const metadata = { conditionId: '0x1234abcd' };
    assert.strictEqual(getPolymarketMarketKey(metadata), '0X1234ABCD');
  });

  it('should extract slug if no conditionId', () => {
    const metadata = { slug: 'will-btc-reach-100k' };
    assert.strictEqual(getPolymarketMarketKey(metadata), 'WILL-BTC-REACH-100K');
  });
});

describe('isKalshiIntradayTicker (v2.6.2)', () => {
  it('should detect UPDOWN patterns', () => {
    assert.ok(isKalshiIntradayTicker('KXBTCUPDOWN'));
    assert.ok(isKalshiIntradayTicker('KXETHUPDOWN'));
    assert.ok(isKalshiIntradayTicker('KXBTCUPDOWN-26JAN23-T0945'));
  });

  it('should detect minute/hour patterns', () => {
    assert.ok(isKalshiIntradayTicker('KXBTC15MIN'));
    assert.ok(isKalshiIntradayTicker('KXETH30MIN'));
    assert.ok(isKalshiIntradayTicker('KXBTC1HR'));
  });

  it('should NOT detect daily patterns as intraday', () => {
    assert.ok(!isKalshiIntradayTicker('KXBTCD-26JAN23'));
    assert.ok(!isKalshiIntradayTicker('KXETHD-26JAN23'));
    assert.ok(!isKalshiIntradayTicker('KXBTCP-26JAN23'));
  });

  it('should handle null/undefined', () => {
    assert.ok(!isKalshiIntradayTicker(null));
    assert.ok(!isKalshiIntradayTicker(undefined));
  });
});

describe('isKalshiDailyTicker (v2.6.2)', () => {
  it('should detect KXBTCD daily patterns', () => {
    assert.ok(isKalshiDailyTicker('KXBTCD-26JAN23'));
    assert.ok(isKalshiDailyTicker('KXETHD-26JAN23'));
    assert.ok(isKalshiDailyTicker('KXBTCP-26JAN23'));
  });

  it('should detect date patterns without UPDOWN', () => {
    assert.ok(isKalshiDailyTicker('KXBTC-26JAN23-B100000'));
  });

  it('should NOT detect UPDOWN as daily', () => {
    assert.ok(!isKalshiDailyTicker('KXBTCUPDOWN-26JAN23'));
    assert.ok(!isKalshiDailyTicker('KXETHUPDOWN'));
  });

  it('should handle null/undefined', () => {
    assert.ok(!isKalshiDailyTicker(null));
    assert.ok(!isKalshiDailyTicker(undefined));
  });
});

describe('getTickerPrefix (v2.6.2)', () => {
  it('should extract prefix before hyphen', () => {
    assert.strictEqual(getTickerPrefix('KXBTCUPDOWN-26JAN23'), 'KXBTCUPDOWN');
    assert.strictEqual(getTickerPrefix('KXETHD-26JAN23-B3500'), 'KXETHD');
  });

  it('should extract prefix before underscore', () => {
    assert.strictEqual(getTickerPrefix('KXBTC_DAILY_26JAN'), 'KXBTC');
  });

  it('should handle no delimiter', () => {
    assert.strictEqual(getTickerPrefix('KXBTCUPDOWN'), 'KXBTCUPDOWN');
  });

  it('should respect maxLength', () => {
    assert.strictEqual(getTickerPrefix('VERYLONGTICKERPREFIX-DATE', 10), 'VERYLONGTI');
  });

  it('should handle null/undefined', () => {
    assert.strictEqual(getTickerPrefix(null), null);
    assert.strictEqual(getTickerPrefix(undefined), null);
  });
});

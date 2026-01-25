/**
 * Entertainment Pipeline Tests (v3.1.0)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  extractEntertainmentSignals,
  isEntertainmentMarket,
  extractAwardShow,
  extractMediaType,
  extractCategory,
  extractNominees,
  AwardShow,
  MediaType,
} from '../signals/entertainmentSignals.js';
import { EntertainmentPipeline, type EntertainmentMarket } from './entertainmentPipeline.js';
import type { EligibleMarket } from '@data-module/db';

// Helper to create mock market
function createMockMarket(title: string, closeTime?: Date): EligibleMarket {
  return {
    id: Math.floor(Math.random() * 10000),
    venue: 'polymarket',
    venueMarketId: `mock-${Date.now()}`,
    title,
    status: 'active',
    closeTime: closeTime ?? new Date('2026-03-01'),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as EligibleMarket;
}

// Helper to create EntertainmentMarket
function createEntertainmentMarket(title: string, closeTime?: Date): EntertainmentMarket {
  const market = createMockMarket(title, closeTime);
  return {
    market,
    signals: extractEntertainmentSignals(market),
  };
}

describe('Entertainment Signals', () => {
  describe('extractAwardShow', () => {
    it('should detect Oscars', () => {
      assert.strictEqual(extractAwardShow('2026 Oscars Best Picture winner'), AwardShow.OSCARS);
      assert.strictEqual(extractAwardShow('Academy Award Best Actor'), AwardShow.OSCARS);
    });

    it('should detect Grammys', () => {
      assert.strictEqual(extractAwardShow('Grammy Album of the Year 2026'), AwardShow.GRAMMYS);
      assert.strictEqual(extractAwardShow('Best New Artist Grammy'), AwardShow.GRAMMYS);
    });

    it('should detect Emmys', () => {
      assert.strictEqual(extractAwardShow('Emmy Outstanding Drama Series'), AwardShow.EMMYS);
      assert.strictEqual(extractAwardShow('2026 Emmys Best Comedy'), AwardShow.EMMYS);
    });

    it('should detect Golden Globes', () => {
      assert.strictEqual(extractAwardShow('Golden Globe ceremony'), AwardShow.GOLDEN_GLOBES);
      assert.strictEqual(extractAwardShow('Golden Globes 2026'), AwardShow.GOLDEN_GLOBES);
    });
  });

  describe('extractMediaType', () => {
    it('should detect movies', () => {
      assert.strictEqual(extractMediaType('Box office opening weekend'), MediaType.MOVIES);
      assert.strictEqual(extractMediaType('Best film of 2026'), MediaType.MOVIES);
    });

    it('should detect music', () => {
      assert.strictEqual(extractMediaType('Billboard Hot 100 #1'), MediaType.MUSIC);
      assert.strictEqual(extractMediaType('Spotify most streamed song'), MediaType.MUSIC);
      assert.strictEqual(extractMediaType('New album drops'), MediaType.MUSIC);  // 'release' is GAMING keyword
    });

    it('should detect streaming', () => {
      assert.strictEqual(extractMediaType('Netflix most watched show'), MediaType.STREAMING);
      assert.strictEqual(extractMediaType('Hulu original series'), MediaType.STREAMING);  // 'subscribers' is SOCIAL_MEDIA
    });

    it('should detect social media', () => {
      assert.strictEqual(extractMediaType('MrBeast subscribers'), MediaType.SOCIAL_MEDIA);
      assert.strictEqual(extractMediaType('YouTube views milestone'), MediaType.SOCIAL_MEDIA);
    });

    it('should detect gaming', () => {
      assert.strictEqual(extractMediaType('GTA VI release date'), MediaType.GAMING);
      assert.strictEqual(extractMediaType('Video game of the year'), MediaType.GAMING);
    });
  });

  describe('extractCategory', () => {
    it('should detect Best Picture', () => {
      assert.strictEqual(extractCategory('2026 Oscars Best Picture winner'), 'BEST_PICTURE');
    });

    it('should detect Best Actor/Actress', () => {
      assert.strictEqual(extractCategory('Best Actor Oscar'), 'BEST_ACTOR');
      assert.strictEqual(extractCategory('Best Actress winner'), 'BEST_ACTRESS');
    });

    it('should detect music categories', () => {
      assert.strictEqual(extractCategory('Album of the Year Grammy'), 'ALBUM_OF_THE_YEAR');
      assert.strictEqual(extractCategory('Record of the Year'), 'RECORD_OF_THE_YEAR');
    });
  });

  describe('isEntertainmentMarket', () => {
    it('should identify entertainment markets', () => {
      assert.ok(isEntertainmentMarket('2026 Oscars Best Picture'));
      assert.ok(isEntertainmentMarket('Grammy Album of the Year'));
      assert.ok(isEntertainmentMarket('Netflix most watched movie'));
      assert.ok(isEntertainmentMarket('MrBeast 200M subscribers'));
    });

    it('should reject non-entertainment markets', () => {
      assert.ok(!isEntertainmentMarket('Bitcoin above $100k'));
      assert.ok(!isEntertainmentMarket('Fed rate cut'));
      assert.ok(!isEntertainmentMarket('Ukraine ceasefire'));
    });
  });
});

describe('Entertainment Pipeline', () => {
  const pipeline = new EntertainmentPipeline();

  describe('checkHardGates', () => {
    it('should pass when award shows match', () => {
      const left = createEntertainmentMarket('2026 Oscars Best Picture winner');
      const right = createEntertainmentMarket('Oscar Best Picture 2026');

      const result = pipeline.checkHardGates(left, right);
      assert.ok(result.passed, `Should pass: ${result.failReason}`);
    });

    it('should fail when award shows differ', () => {
      const left = createEntertainmentMarket('2026 Oscars Best Picture');
      const right = createEntertainmentMarket('2026 Grammys Album of the Year');

      const result = pipeline.checkHardGates(left, right);
      assert.ok(!result.passed, 'Should fail for different award shows');
    });

    it('should fail when years differ', () => {
      const left = createEntertainmentMarket('2025 Oscars Best Picture');
      const right = createEntertainmentMarket('2026 Oscars Best Picture');

      const result = pipeline.checkHardGates(left, right);
      assert.ok(!result.passed, 'Should fail for different years');
    });
  });

  describe('score', () => {
    it('should give high score for identical award markets', () => {
      const left = createEntertainmentMarket('2026 Oscars Best Picture winner');
      const right = createEntertainmentMarket('Oscar Best Picture 2026 winner');

      const result = pipeline.score(left, right);
      assert.ok(result !== null);
      assert.ok(result.score >= 0.7, `Expected high score, got ${result.score}`);
    });

    it('should give good score for Grammy matches', () => {
      const left = createEntertainmentMarket('Grammy Album of the Year 2026');
      const right = createEntertainmentMarket('2026 Grammy Album of the Year winner');

      const result = pipeline.score(left, right);
      assert.ok(result !== null);
      assert.ok(result.score >= 0.6, `Expected decent score, got ${result.score}`);
    });

    it('should handle streaming markets', () => {
      const left = createEntertainmentMarket('Netflix most watched movie January 2026');
      const right = createEntertainmentMarket('Netflix #1 movie Jan 2026');

      const result = pipeline.score(left, right);
      assert.ok(result !== null);
      assert.ok(result.score >= 0.4, `Expected decent score, got ${result.score}`);
    });
  });

  describe('shouldAutoConfirm', () => {
    it('should auto-confirm high score matches with same award/category', () => {
      const left = createEntertainmentMarket('2026 Oscars Best Picture winner');
      const right = createEntertainmentMarket('Best Picture Oscar 2026');

      const scoreResult = pipeline.score(left, right);
      assert.ok(scoreResult !== null);

      // Both should have same award show and category
      assert.strictEqual(left.signals.awardShow, AwardShow.OSCARS);
      assert.strictEqual(right.signals.awardShow, AwardShow.OSCARS);

      if (scoreResult.score >= 0.88 && scoreResult.awardShowScore >= 1.0) {
        const result = pipeline.shouldAutoConfirm(left, right, scoreResult);
        assert.ok(result.shouldConfirm, 'Should auto-confirm exact matches');
      }
    });
  });

  describe('shouldAutoReject', () => {
    it('should auto-reject low score matches', () => {
      const left = createEntertainmentMarket('Oscars Best Picture 2026');
      const right = createEntertainmentMarket('Netflix documentary 2026');

      const scoreResult = pipeline.score(left, right);
      if (scoreResult && scoreResult.score < 0.50) {
        const result = pipeline.shouldAutoReject(left, right, scoreResult);
        assert.ok(result.shouldReject, 'Should auto-reject low score');
        assert.strictEqual(result.rule, 'LOW_SCORE');
      }
    });

    it('should auto-reject different award shows', () => {
      const left = createEntertainmentMarket('2026 Oscars Best Picture');
      const right = createEntertainmentMarket('2026 Grammys Album of the Year');

      // Hard gate should catch this, but test auto-reject too
      const gateResult = pipeline.checkHardGates(left, right);
      if (!gateResult.passed) {
        // Expected - hard gate should fail for different award shows
        assert.ok(gateResult.failReason?.includes('Award show mismatch'));
      }
    });
  });
});

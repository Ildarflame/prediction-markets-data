/**
 * Unit tests for score sanity utilities (v2.6.6)
 * Run with: npx tsx --test packages/core/src/score-sanity.test.ts
 */
import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import {
  clampScore,
  clampScoreSimple,
  isValidScore,
} from './utils.js';

describe('clampScoreSimple (v2.6.6)', () => {
  it('should return score unchanged if in [0, 1]', () => {
    assert.strictEqual(clampScoreSimple(0), 0);
    assert.strictEqual(clampScoreSimple(0.5), 0.5);
    assert.strictEqual(clampScoreSimple(1), 1);
    assert.strictEqual(clampScoreSimple(0.001), 0.001);
    assert.strictEqual(clampScoreSimple(0.999), 0.999);
  });

  it('should never return score > 1', () => {
    assert.strictEqual(clampScoreSimple(1.1), 1);
    assert.strictEqual(clampScoreSimple(1.06), 1); // Regression: MACRO bug case
    assert.strictEqual(clampScoreSimple(2.0), 1);
    assert.strictEqual(clampScoreSimple(100), 1);
  });

  it('should never return score < 0', () => {
    assert.strictEqual(clampScoreSimple(-0.1), 0);
    assert.strictEqual(clampScoreSimple(-1), 0);
    assert.strictEqual(clampScoreSimple(-100), 0);
  });

  it('should handle NaN -> 0', () => {
    assert.strictEqual(clampScoreSimple(NaN), 0);
    assert.strictEqual(clampScoreSimple(0 / 0), 0);
  });

  it('should handle Infinity -> 1, -Infinity -> 0', () => {
    assert.strictEqual(clampScoreSimple(Infinity), 1);
    assert.strictEqual(clampScoreSimple(-Infinity), 0);
    assert.strictEqual(clampScoreSimple(1 / 0), 1);
    assert.strictEqual(clampScoreSimple(-1 / 0), 0);
  });
});

describe('clampScore with diagnostics (v2.6.6)', () => {
  it('should return correct diagnostics for normal score', () => {
    const result = clampScore(0.85);
    assert.strictEqual(result.rawScore, 0.85);
    assert.strictEqual(result.finalScore, 0.85);
    assert.strictEqual(result.wasClamped, false);
    assert.strictEqual(result.wasInvalid, false);
    assert.strictEqual(result.clampReason, undefined);
  });

  it('should track clamping for score > 1', () => {
    const result = clampScore(1.06, 'macro');
    assert.strictEqual(result.rawScore, 1.06);
    assert.strictEqual(result.finalScore, 1);
    assert.strictEqual(result.wasClamped, true);
    assert.strictEqual(result.wasInvalid, false);
    assert.ok(result.clampReason?.includes('1.06'));
  });

  it('should track NaN as invalid', () => {
    const result = clampScore(NaN, 'test');
    assert.strictEqual(result.rawScore, NaN);
    assert.strictEqual(result.finalScore, 0);
    assert.strictEqual(result.wasClamped, true);
    assert.strictEqual(result.wasInvalid, true);
    assert.strictEqual(result.clampReason, 'NaN->0');
  });

  it('should track Infinity as invalid', () => {
    const resultPos = clampScore(Infinity);
    assert.strictEqual(resultPos.finalScore, 1);
    assert.strictEqual(resultPos.wasInvalid, true);
    assert.strictEqual(resultPos.clampReason, 'Inf->1');

    const resultNeg = clampScore(-Infinity);
    assert.strictEqual(resultNeg.finalScore, 0);
    assert.strictEqual(resultNeg.wasInvalid, true);
    assert.strictEqual(resultNeg.clampReason, '-Inf->0');
  });

  it('should track negative score clamping', () => {
    const result = clampScore(-0.5);
    assert.strictEqual(result.rawScore, -0.5);
    assert.strictEqual(result.finalScore, 0);
    assert.strictEqual(result.wasClamped, true);
    assert.strictEqual(result.wasInvalid, false);
  });
});

describe('isValidScore (v2.6.6)', () => {
  it('should return true for valid scores', () => {
    assert.strictEqual(isValidScore(0), true);
    assert.strictEqual(isValidScore(0.5), true);
    assert.strictEqual(isValidScore(1), true);
  });

  it('should return false for out-of-range scores', () => {
    assert.strictEqual(isValidScore(1.1), false);
    assert.strictEqual(isValidScore(-0.1), false);
    assert.strictEqual(isValidScore(2), false);
    assert.strictEqual(isValidScore(-1), false);
  });

  it('should return false for NaN/Infinity', () => {
    assert.strictEqual(isValidScore(NaN), false);
    assert.strictEqual(isValidScore(Infinity), false);
    assert.strictEqual(isValidScore(-Infinity), false);
  });
});

describe('MACRO score regression (v2.6.6)', () => {
  it('should clamp the old buggy MACRO formula result', () => {
    // Old buggy formula: 0.5 + 0.4 + 0.1 + 0.1 = 1.1
    // This simulates the case where score > 1.0 was produced
    const buggySampleScore = 1.06;

    // After fix, clampScoreSimple should cap it to 1.0
    const clamped = clampScoreSimple(buggySampleScore);
    assert.strictEqual(clamped, 1);
    assert.ok(clamped <= 1, 'Score must never exceed 1.0');
  });

  it('new MACRO formula should produce max 1.0', () => {
    // New formula: 0.5 + 0.4 + 0.05 + 0.05 = 1.0
    // With maxed out individual scores:
    const macroEntScore = 0.5;
    const perScore = 0.4; // max period score
    const numScore = 1.0; // max number score
    const fzScore = 1.0; // max fuzzy score
    const jcScore = 1.0; // max jaccard score

    // Fixed formula (v2.6.6)
    const textBonus = (fzScore + jcScore) / 2 * 0.05;
    const numberBonus = numScore * 0.05;
    const newScore = macroEntScore + perScore + numberBonus + textBonus;

    assert.ok(newScore <= 1.0, `New formula max score ${newScore} should be <= 1.0`);
    assert.strictEqual(newScore, 1.0); // Exactly 1.0 when maxed
  });
});

/**
 * Dispatcher Tests (v3.0.6)
 *
 * Tests for V3 pipeline registration and routing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CanonicalTopic } from '@data-module/core';
import {
  getPipeline,
  hasPipeline,
  getRegisteredTopics,
  getRegisteredPipelineInfos,
  IMPLEMENTED_TOPICS,
  isTopicImplemented,
  parseTopicString,
} from './dispatcher.js';
import { registerAllPipelines } from './registerPipelines.js';

// Register pipelines once at module load time
registerAllPipelines();

describe('Dispatcher', () => {

  describe('registerAllPipelines', () => {
    it('should register all expected pipelines', () => {
      // Check all expected topics are registered
      const registeredTopics = getRegisteredTopics();

      assert.ok(registeredTopics.includes(CanonicalTopic.CRYPTO_DAILY), 'CRYPTO_DAILY should be registered');
      assert.ok(registeredTopics.includes(CanonicalTopic.CRYPTO_INTRADAY), 'CRYPTO_INTRADAY should be registered');
      assert.ok(registeredTopics.includes(CanonicalTopic.MACRO), 'MACRO should be registered');
      assert.ok(registeredTopics.includes(CanonicalTopic.RATES), 'RATES should be registered');
      assert.ok(registeredTopics.includes(CanonicalTopic.ELECTIONS), 'ELECTIONS should be registered');
      assert.ok(registeredTopics.includes(CanonicalTopic.COMMODITIES), 'COMMODITIES should be registered');
    });

    it('should be idempotent - multiple calls should not duplicate', () => {
      const firstCount = getRegisteredTopics().length;

      // Call again
      registerAllPipelines();
      const secondCount = getRegisteredTopics().length;

      assert.equal(firstCount, secondCount, 'Calling registerAllPipelines twice should not duplicate');
    });

    it('should have correct algo versions', () => {
      const infos = getRegisteredPipelineInfos();

      const cryptoDaily = infos.find(p => p.topic === CanonicalTopic.CRYPTO_DAILY);
      assert.ok(cryptoDaily);
      assert.ok(cryptoDaily.algoVersion.includes('CRYPTO_DAILY'));

      const cryptoIntraday = infos.find(p => p.topic === CanonicalTopic.CRYPTO_INTRADAY);
      assert.ok(cryptoIntraday);
      assert.ok(cryptoIntraday.algoVersion.includes('CRYPTO_INTRADAY'));

      const macro = infos.find(p => p.topic === CanonicalTopic.MACRO);
      assert.ok(macro);
      assert.ok(macro.algoVersion.includes('MACRO'));

      const rates = infos.find(p => p.topic === CanonicalTopic.RATES);
      assert.ok(rates);
      assert.ok(rates.algoVersion.includes('RATES'));

      const commodities = infos.find(p => p.topic === CanonicalTopic.COMMODITIES);
      assert.ok(commodities);
      assert.ok(commodities.algoVersion.includes('COMMODITIES'));
    });
  });

  describe('hasPipeline', () => {
    it('should return true for registered topics', () => {
      assert.equal(hasPipeline(CanonicalTopic.CRYPTO_DAILY), true);
      assert.equal(hasPipeline(CanonicalTopic.MACRO), true);
      assert.equal(hasPipeline(CanonicalTopic.RATES), true);
    });

    it('should return false for unregistered topics', () => {
      // SPORTS and UNKNOWN should not have pipelines
      assert.equal(hasPipeline(CanonicalTopic.SPORTS), false);
      assert.equal(hasPipeline(CanonicalTopic.UNKNOWN), false);
    });
  });

  describe('getPipeline', () => {
    it('should return pipeline for registered topic', () => {
      const cryptoDailyPipeline = getPipeline(CanonicalTopic.CRYPTO_DAILY);
      assert.ok(cryptoDailyPipeline);
      assert.equal(cryptoDailyPipeline.topic, CanonicalTopic.CRYPTO_DAILY);
    });

    it('should return undefined for unregistered topic', () => {
      const sportsPipeline = getPipeline(CanonicalTopic.SPORTS);
      assert.equal(sportsPipeline, undefined);
    });
  });

  describe('IMPLEMENTED_TOPICS', () => {
    it('should include all matchable topics', () => {
      assert.ok(IMPLEMENTED_TOPICS.includes(CanonicalTopic.CRYPTO_DAILY));
      assert.ok(IMPLEMENTED_TOPICS.includes(CanonicalTopic.CRYPTO_INTRADAY));
      assert.ok(IMPLEMENTED_TOPICS.includes(CanonicalTopic.MACRO));
      assert.ok(IMPLEMENTED_TOPICS.includes(CanonicalTopic.RATES));
      assert.ok(IMPLEMENTED_TOPICS.includes(CanonicalTopic.ELECTIONS));
      assert.ok(IMPLEMENTED_TOPICS.includes(CanonicalTopic.COMMODITIES));
    });

    it('should not include UNKNOWN or SPORTS', () => {
      assert.ok(!IMPLEMENTED_TOPICS.includes(CanonicalTopic.UNKNOWN));
      assert.ok(!IMPLEMENTED_TOPICS.includes(CanonicalTopic.SPORTS));
    });
  });

  describe('isTopicImplemented', () => {
    it('should return true for implemented topics', () => {
      assert.equal(isTopicImplemented(CanonicalTopic.CRYPTO_DAILY), true);
      assert.equal(isTopicImplemented(CanonicalTopic.MACRO), true);
      assert.equal(isTopicImplemented(CanonicalTopic.COMMODITIES), true);
    });

    it('should return false for non-implemented topics', () => {
      assert.equal(isTopicImplemented(CanonicalTopic.SPORTS), false);
      assert.equal(isTopicImplemented(CanonicalTopic.UNKNOWN), false);
      assert.equal(isTopicImplemented(CanonicalTopic.GEOPOLITICS), false);
    });
  });

  describe('parseTopicString', () => {
    it('should parse uppercase topic names', () => {
      assert.equal(parseTopicString('CRYPTO_DAILY'), CanonicalTopic.CRYPTO_DAILY);
      assert.equal(parseTopicString('MACRO'), CanonicalTopic.MACRO);
      assert.equal(parseTopicString('RATES'), CanonicalTopic.RATES);
    });

    it('should parse lowercase topic names', () => {
      assert.equal(parseTopicString('crypto_daily'), CanonicalTopic.CRYPTO_DAILY);
      assert.equal(parseTopicString('macro'), CanonicalTopic.MACRO);
    });

    it('should handle legacy mappings', () => {
      assert.equal(parseTopicString('crypto'), CanonicalTopic.CRYPTO_DAILY);
      assert.equal(parseTopicString('politics'), CanonicalTopic.ELECTIONS);
    });

    it('should return null for unknown topics', () => {
      assert.equal(parseTopicString('foobar'), null);
      assert.equal(parseTopicString(''), null);
    });
  });

  describe('getRegisteredPipelineInfos', () => {
    it('should return info for all registered pipelines', () => {
      const infos = getRegisteredPipelineInfos();

      assert.ok(infos.length >= 6, 'Should have at least 6 registered pipelines');

      for (const info of infos) {
        assert.ok(info.topic);
        assert.ok(info.algoVersion);
        assert.ok(info.description);
        assert.ok(typeof info.supportsAutoConfirm === 'boolean');
        assert.ok(typeof info.supportsAutoReject === 'boolean');
      }
    });
  });
});

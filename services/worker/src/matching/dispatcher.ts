/**
 * Pipeline Dispatcher (v3.0.11)
 *
 * Routes canonical topics to their corresponding pipelines.
 * Central registry for all matching pipelines.
 */

import { CanonicalTopic } from '@data-module/core';
import type { TopicPipeline } from './pipelines/basePipeline.js';
import type { BaseSignals, BaseScoreResult, MarketWithSignals, PipelineInfo } from './engineV3.types.js';

/**
 * Pipeline registry - maps topics to pipeline instances
 */
const pipelineRegistry = new Map<CanonicalTopic, TopicPipeline<any, any, any>>();

/**
 * Register a pipeline for a topic
 */
export function registerPipeline<
  TMarket extends MarketWithSignals<TSignals>,
  TSignals extends BaseSignals,
  TScoreResult extends BaseScoreResult
>(pipeline: TopicPipeline<TMarket, TSignals, TScoreResult>): void {
  pipelineRegistry.set(pipeline.topic, pipeline);
}

/**
 * Get pipeline for a topic
 */
export function getPipeline<
  TMarket extends MarketWithSignals<TSignals>,
  TSignals extends BaseSignals,
  TScoreResult extends BaseScoreResult
>(topic: CanonicalTopic): TopicPipeline<TMarket, TSignals, TScoreResult> | undefined {
  return pipelineRegistry.get(topic) as TopicPipeline<TMarket, TSignals, TScoreResult> | undefined;
}

/**
 * Check if a pipeline is registered for a topic
 */
export function hasPipeline(topic: CanonicalTopic): boolean {
  return pipelineRegistry.has(topic);
}

/**
 * Get all registered topics
 */
export function getRegisteredTopics(): CanonicalTopic[] {
  return Array.from(pipelineRegistry.keys());
}

/**
 * Get info about all registered pipelines
 */
export function getRegisteredPipelineInfos(): PipelineInfo[] {
  return Array.from(pipelineRegistry.values()).map((pipeline) => ({
    topic: pipeline.topic,
    algoVersion: pipeline.algoVersion,
    description: pipeline.description,
    supportsAutoConfirm: pipeline.supportsAutoConfirm,
    supportsAutoReject: pipeline.supportsAutoReject,
  }));
}

/**
 * Clear all registered pipelines (for testing)
 */
export function clearPipelines(): void {
  pipelineRegistry.clear();
}

/**
 * Topics that are currently implemented (v3.0.11)
 * (Used for validation and CLI help text)
 */
export const IMPLEMENTED_TOPICS: CanonicalTopic[] = [
  CanonicalTopic.CRYPTO_DAILY,
  CanonicalTopic.CRYPTO_INTRADAY,
  CanonicalTopic.MACRO,
  CanonicalTopic.RATES,
  CanonicalTopic.ELECTIONS,
  CanonicalTopic.COMMODITIES,
  CanonicalTopic.CLIMATE,
  CanonicalTopic.SPORTS,
];

/**
 * Check if a topic is implemented
 */
export function isTopicImplemented(topic: CanonicalTopic): boolean {
  return IMPLEMENTED_TOPICS.includes(topic);
}

/**
 * Parse topic string to enum
 */
export function parseTopicString(topic: string): CanonicalTopic | null {
  const upper = topic.toUpperCase().replace(/-/g, '_');

  // Direct match
  if (Object.values(CanonicalTopic).includes(upper as CanonicalTopic)) {
    return upper as CanonicalTopic;
  }

  // Legacy mappings
  const legacyMap: Record<string, CanonicalTopic> = {
    'crypto': CanonicalTopic.CRYPTO_DAILY,
    'crypto_daily': CanonicalTopic.CRYPTO_DAILY,
    'crypto_intraday': CanonicalTopic.CRYPTO_INTRADAY,
    'macro': CanonicalTopic.MACRO,
    'rates': CanonicalTopic.RATES,
    'elections': CanonicalTopic.ELECTIONS,
    'politics': CanonicalTopic.ELECTIONS,
    'climate': CanonicalTopic.CLIMATE,
    'weather': CanonicalTopic.CLIMATE,
    'sports': CanonicalTopic.SPORTS,
  };

  const lower = topic.toLowerCase();
  return legacyMap[lower] || null;
}

/**
 * Get all topics that can be matched
 * (Have registered pipelines)
 */
export function getMatchableTopics(): CanonicalTopic[] {
  return getRegisteredTopics().filter((topic) => isTopicImplemented(topic));
}

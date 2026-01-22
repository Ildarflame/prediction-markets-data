/**
 * Ops Module (v2.6.8)
 *
 * Operational automation for links management.
 */

export {
  parseReasonString,
  extractNumbers,
  numbersCompatible,
  extractComparator,
  comparatorsCompatible,
  evaluateSafeRules,
  formatEvaluation,
  DEFAULT_MIN_SCORES,
  type Topic,
  type SafeRuleResult,
  type SafeEvaluation,
  type MarketLinkWithMarkets,
} from './safe-rules.js';

export {
  evaluateRejectRules,
  formatRejectEvaluation,
  HARD_FLOOR_SCORES,
  TEXT_SANITY_FLOOR,
  type Topic as RejectTopic,
  type RejectRuleResult,
  type RejectEvaluation,
} from './reject-rules.js';

export {
  applyWatchlistPolicy,
  formatPolicyResult,
  DEFAULT_POLICY_CONFIG,
  type WatchlistPolicyConfig,
  type WatchlistCandidate,
  type PolicyResult,
} from './watchlist-policy.js';

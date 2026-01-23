/**
 * Sports Signals Extraction (v3.0.11)
 *
 * Extracts sports-specific features from market titles for matching:
 * - League (NBA, NFL, MLB, NHL, etc.)
 * - Teams (normalized)
 * - Start time (event time bucket)
 * - Market type (MONEYLINE, SPREAD, TOTAL)
 * - Line value (for spread/total)
 * - Period (FULL_GAME only for v1)
 *
 * V1 SAFE SCOPE:
 * - Only MONEYLINE, SPREAD, TOTAL
 * - Only FULL_GAME period
 * - Excludes: player props, futures, parlays, live/in-play
 */

import type { EligibleMarket } from '@data-module/db';
import type { BaseSignals } from '../engineV3.types.js';
import {
  SportsLeague,
  SportsMarketType,
  SportsPeriod,
  SpreadSide,
  normalizeTeamName,
  detectLeague,
  extractTeams,
  detectMarketType,
  detectPeriod,
  extractLineValue,
  extractSide,
  generateEventKey,
  generateTimeBucket,
} from '@data-module/core';

// ============================================================================
// TYPES
// ============================================================================

export interface SportsEventKey {
  league: SportsLeague;
  teamA_norm: string;
  teamB_norm: string;
  startTime: string | null;          // ISO string
  startBucket: string | null;        // e.g., "2025-01-23T19:30"
  venueEventId: string | null;       // Polymarket game_id or Kalshi series ticker
}

export interface SportsLine {
  marketType: SportsMarketType;
  lineValue: number | null;          // For spread/total
  side: SpreadSide;
  period: SportsPeriod;
}

export interface SportsSignalQuality {
  missingTeams: boolean;
  missingStartTime: boolean;
  unknownLeague: boolean;
  unknownMarketType: boolean;
  notFullGame: boolean;              // If period is not FULL_GAME
  isExcluded: boolean;               // Props, futures, parlays, etc.
  excludeReason: string | null;
}

export interface SportsSignals extends BaseSignals {
  // Event-level signals
  eventKey: SportsEventKey;

  // Market-level signals (line info)
  line: SportsLine;

  // Quality flags
  quality: SportsSignalQuality;

  // For matching
  eventKeyString: string | null;     // Composite key for indexing
  titleTokens: string[];
  confidence: number;

  // Raw data for debugging
  rawTitle: string;
}

// ============================================================================
// KEYWORDS FOR EXCLUSION
// ============================================================================

const EXCLUSION_KEYWORDS = [
  // Player props
  'yards', 'passing', 'rushing', 'receiving', 'touchdown', 'td',
  'first scorer', 'last scorer', 'anytime scorer', 'goalscorer',
  'assist', 'rebound', 'block', 'steal', 'double double', 'triple double',
  'strikeout', 'home run', 'hr', 'rbi', 'hit', 'save',
  'shots on goal', 'shots on target', 'corner', 'card', 'booking',

  // Futures/Season
  'champion', 'championship', 'mvp', 'rookie of the year', 'draft pick',
  'win total', 'playoff', 'make playoffs', 'division winner', 'conference winner',
  'regular season', 'postseason', 'award',

  // Parlays/Multi
  'parlay', 'multi', 'combo', 'accumulator', 'acca', 'same game parlay', 'sgp',

  // In-play/Live
  'live', 'in-play', 'in play', 'next point', 'next goal', 'current',

  // Other exclusions
  'special', 'novelty', 'entertainment', 'promotion', 'boost',
  'correct score', 'exact score', 'first to score',
  'fired', 'hired', 'next coach', 'next manager', 'next team',
  'transfer', 'trade', 'signing',
];

/**
 * Check if market should be excluded based on title
 */
function shouldExcludeMarket(title: string): { excluded: boolean; reason: string | null } {
  const titleLower = title.toLowerCase();

  for (const keyword of EXCLUSION_KEYWORDS) {
    if (titleLower.includes(keyword)) {
      return { excluded: true, reason: `Contains excluded keyword: "${keyword}"` };
    }
  }

  // Check for player name patterns (likely props)
  // "Player Name: X+" pattern
  if (/\w+\s+\w+:\s*\d+\+/.test(title)) {
    return { excluded: true, reason: 'Player prop pattern detected' };
  }

  // "yes/no" multi-selection patterns (parlays)
  if (/^yes\s+\w+,\s*yes\s+/i.test(title) || title.split(',').length > 2) {
    return { excluded: true, reason: 'Multi-selection/parlay pattern detected' };
  }

  return { excluded: false, reason: null };
}

// ============================================================================
// EXTRACTION FUNCTIONS
// ============================================================================

/**
 * Extract start time from market metadata or closeTime
 */
function extractStartTime(market: EligibleMarket): { startTime: string | null; startBucket: string | null } {
  const metadata = market.metadata as Record<string, unknown> | null;

  // Try Polymarket eventStartTime first
  if (metadata?.eventStartTime) {
    const startTime = String(metadata.eventStartTime);
    try {
      const date = new Date(startTime);
      if (!isNaN(date.getTime())) {
        return {
          startTime: date.toISOString(),
          startBucket: generateTimeBucket(date),
        };
      }
    } catch {
      // Fall through
    }
  }

  // Try Kalshi metadata fields
  if (metadata?.openTime) {
    try {
      const date = new Date(String(metadata.openTime));
      if (!isNaN(date.getTime())) {
        return {
          startTime: date.toISOString(),
          startBucket: generateTimeBucket(date),
        };
      }
    } catch {
      // Fall through
    }
  }

  // Fallback to closeTime as weak proxy (with penalty in scoring)
  if (market.closeTime) {
    return {
      startTime: market.closeTime.toISOString(),
      startBucket: generateTimeBucket(market.closeTime),
    };
  }

  return { startTime: null, startBucket: null };
}

/**
 * Extract venue-specific event ID
 */
function extractVenueEventId(market: EligibleMarket): string | null {
  const metadata = market.metadata as Record<string, unknown> | null;

  // Polymarket game_id
  if (metadata?.game_id) {
    return String(metadata.game_id);
  }

  // Kalshi eventTicker
  if (metadata?.eventTicker) {
    return String(metadata.eventTicker);
  }

  // Kalshi seriesTicker
  if (metadata?.seriesTicker) {
    return String(metadata.seriesTicker);
  }

  return null;
}

/**
 * Generate title tokens for text similarity
 */
function extractTitleTokens(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length >= 2)
    .filter(token => !['the', 'a', 'an', 'in', 'on', 'at', 'to', 'of', 'be', 'will', 'is', 'are', 'vs', 'versus'].includes(token));
}

/**
 * Main extraction function
 */
export function extractSportsSignals(market: EligibleMarket): SportsSignals {
  const title = market.title;
  const rawTitle = title;

  // Check for exclusions first
  const exclusion = shouldExcludeMarket(title);

  // Extract basic signals
  const league = detectLeague(title);
  const { teamA, teamB } = extractTeams(title);
  const marketType = detectMarketType(title);
  const period = detectPeriod(title);
  const lineValue = extractLineValue(title, marketType);
  const side = extractSide(title);
  const { startTime, startBucket } = extractStartTime(market);
  const venueEventId = extractVenueEventId(market);
  const titleTokens = extractTitleTokens(title);

  // Normalize team names
  const teamA_norm = teamA ? normalizeTeamName(teamA) : '';
  const teamB_norm = teamB ? normalizeTeamName(teamB) : '';

  // Build event key
  const eventKey: SportsEventKey = {
    league,
    teamA_norm,
    teamB_norm,
    startTime,
    startBucket,
    venueEventId,
  };

  // Build line info
  const line: SportsLine = {
    marketType,
    lineValue,
    side,
    period,
  };

  // Build quality flags
  const quality: SportsSignalQuality = {
    missingTeams: !teamA_norm || !teamB_norm,
    missingStartTime: !startBucket,
    unknownLeague: league === SportsLeague.UNKNOWN,
    unknownMarketType: marketType === SportsMarketType.UNKNOWN,
    notFullGame: period !== SportsPeriod.FULL_GAME,
    isExcluded: exclusion.excluded || marketType === SportsMarketType.PROP ||
                marketType === SportsMarketType.FUTURES || marketType === SportsMarketType.PARLAY,
    excludeReason: exclusion.reason ||
                   (marketType === SportsMarketType.PROP ? 'Player prop' : null) ||
                   (marketType === SportsMarketType.FUTURES ? 'Futures market' : null) ||
                   (marketType === SportsMarketType.PARLAY ? 'Parlay/multi' : null),
  };

  // Generate composite event key string (for indexing)
  let eventKeyString: string | null = null;
  if (teamA_norm && teamB_norm && startBucket && league !== SportsLeague.UNKNOWN) {
    eventKeyString = generateEventKey(league, teamA_norm, teamB_norm, startBucket);
  }

  // Calculate confidence
  let confidence = 1.0;
  if (quality.missingTeams) confidence -= 0.4;
  if (quality.missingStartTime) confidence -= 0.2;
  if (quality.unknownLeague) confidence -= 0.15;
  if (quality.unknownMarketType) confidence -= 0.1;
  if (quality.notFullGame) confidence -= 0.1;
  if (quality.isExcluded) confidence = 0;
  confidence = Math.max(0, confidence);

  return {
    eventKey,
    line,
    quality,
    eventKeyString,
    titleTokens,
    confidence,
    rawTitle,
    // Base signals
    entity: league,
    entities: new Set([league, teamA_norm, teamB_norm].filter(Boolean)),
  };
}

/**
 * Check if a market is eligible for SPORTS matching (v1 safe scope)
 */
export function isEligibleSportsMarket(signals: SportsSignals): boolean {
  // Must have both teams
  if (signals.quality.missingTeams) return false;

  // Must have start time
  if (signals.quality.missingStartTime) return false;

  // Must not be excluded (props, futures, parlays)
  if (signals.quality.isExcluded) return false;

  // Must be FULL_GAME period
  if (signals.quality.notFullGame) return false;

  // Must be a supported market type
  const supportedTypes = [SportsMarketType.MONEYLINE, SportsMarketType.SPREAD, SportsMarketType.TOTAL];
  if (!supportedTypes.includes(signals.line.marketType)) return false;

  // Must have known league (helps with indexing)
  if (signals.quality.unknownLeague) return false;

  return true;
}

/**
 * Get exclusion reason for debugging
 */
export function getExclusionReason(signals: SportsSignals): string | null {
  if (signals.quality.isExcluded) return signals.quality.excludeReason;
  if (signals.quality.missingTeams) return 'Missing teams';
  if (signals.quality.missingStartTime) return 'Missing start time';
  if (signals.quality.notFullGame) return `Period is ${signals.line.period}, not FULL_GAME`;
  if (signals.quality.unknownLeague) return 'Unknown league';

  const supportedTypes = [SportsMarketType.MONEYLINE, SportsMarketType.SPREAD, SportsMarketType.TOTAL];
  if (!supportedTypes.includes(signals.line.marketType)) {
    return `Market type ${signals.line.marketType} not supported in v1`;
  }

  return null;
}

// ============================================================================
// SPORTS KEYWORDS FOR MARKET FETCHING
// ============================================================================

export const SPORTS_KEYWORDS = [
  // Matchup patterns
  'vs', 'versus', ' @ ', ' at ',

  // Leagues
  'nba', 'nfl', 'mlb', 'nhl', 'mls', 'premier league', 'epl',
  'la liga', 'bundesliga', 'serie a', 'ligue 1',
  'champions league', 'ucl', 'europa league',
  'ufc', 'mma',

  // Market types
  'moneyline', 'money line', 'spread', 'handicap',
  'over', 'under', 'o/u', 'total points', 'total goals',
];

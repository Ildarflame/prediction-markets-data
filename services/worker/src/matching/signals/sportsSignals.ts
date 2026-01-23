/**
 * Sports Signals Extraction (v3.0.13)
 *
 * Extracts sports-specific features from market titles for matching:
 * - League (NBA, NFL, MLB, NHL, etc.)
 * - Teams (normalized)
 * - Start time (event time bucket)
 * - Market type (MONEYLINE, SPREAD, TOTAL)
 * - Line value (for spread/total)
 * - Period (FULL_GAME only for v1)
 *
 * V2 CHANGES (v3.0.12):
 * - Event-first extraction: for Kalshi markets with kalshiEventTicker,
 *   extract teams/startTime from kalshi_events table
 * - Relaxed eligibility: require (teams OR event teams) AND (startTime OR strikeDate)
 *
 * V1 SAFE SCOPE:
 * - Only MONEYLINE, SPREAD, TOTAL
 * - Only FULL_GAME period
 * - Excludes: player props, futures, parlays, live/in-play
 */

import type { EligibleMarket, KalshiEvent } from '@data-module/db';
import type { BaseSignals } from '../engineV3.types.js';

// ============================================================================
// EVENT DATA TYPE (for event-first extraction)
// ============================================================================

export interface SportsEventData {
  eventTicker: string;
  seriesTicker: string;
  title: string;           // e.g., "Lakers vs Celtics"
  subTitle: string | null; // e.g., "January 23, 2025 7:30 PM ET"
  strikeDate: Date | null; // Event date/time
}

/**
 * Convert KalshiEvent to SportsEventData
 */
export function toSportsEventData(event: KalshiEvent): SportsEventData {
  return {
    eventTicker: event.eventTicker,
    seriesTicker: event.seriesTicker,
    title: event.title,
    subTitle: event.subTitle,
    strikeDate: event.strikeDate,
  };
}
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
  // v3.0.12: Track source of team/time data
  teamsSource: 'market' | 'event' | 'none';
  startTimeSource: 'market' | 'event' | 'closeTime' | 'none';
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
 * v3.0.13: Improved parlay detection - less aggressive, more specific patterns
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

  // v3.0.13: More specific parlay detection patterns
  const parlayPatterns: [RegExp, string][] = [
    [/^yes\s+.+,\s*yes\s+/i, 'Yes X, Yes Y pattern'],                // "Yes Lakers, Yes Celtics"
    [/\+\s*\w+.*\+\s*\w+/i, 'Multiple + combinations'],               // "Lakers + Celtics + Warriors"
    [/\band\b.*\band\b.*\band\b/i, 'Triple AND pattern'],             // "Lakers and Celtics and Warriors"
    [/\bparlay\b|\baccumulator\b|\bsgp\b/i, 'Explicit parlay keyword'], // Explicit parlay keywords
    [/\d+\s*-?\s*leg/i, 'Multi-leg pattern'],                          // "3-leg parlay"
    [/\ball\s+\d+\b/i, 'All N pattern'],                               // "All 4 teams to win"
  ];

  for (const [pattern, reason] of parlayPatterns) {
    if (pattern.test(title)) {
      return { excluded: true, reason: `Parlay: ${reason}` };
    }
  }

  // v3.0.13: Only exclude comma patterns if they look like multi-selections
  // Allow normal commas like "Rangers FC, Glasgow vs Celtic FC, Glasgow"
  const commaSegments = title.split(',');
  if (commaSegments.length >= 3) {
    // Check if this looks like a multi-team parlay (multiple "vs" or team names)
    const vsCount = (title.match(/\bvs\.?\b/gi) || []).length;
    const winCount = (title.match(/\bwin\b/gi) || []).length;

    // If we have multiple "vs" or "win" mentions, it's likely a parlay
    if (vsCount >= 2 || winCount >= 2) {
      return { excluded: true, reason: 'Multi-match parlay pattern' };
    }
  }

  return { excluded: false, reason: null };
}

// ============================================================================
// EXTRACTION FUNCTIONS
// ============================================================================

interface StartTimeResult {
  startTime: string | null;
  startBucket: string | null;
  source: 'market' | 'event' | 'closeTime' | 'none';
}

/**
 * Extract start time from event, market metadata, or closeTime
 * Priority: event.strikeDate > metadata.eventStartTime > metadata.openTime > closeTime
 */
function extractStartTime(market: EligibleMarket, eventData?: SportsEventData): StartTimeResult {
  // v3.0.12: Try event strikeDate first (most reliable for Kalshi)
  if (eventData?.strikeDate) {
    return {
      startTime: eventData.strikeDate.toISOString(),
      startBucket: generateTimeBucket(eventData.strikeDate),
      source: 'event',
    };
  }

  const metadata = market.metadata as Record<string, unknown> | null;

  // Try Polymarket eventStartTime
  if (metadata?.eventStartTime) {
    const startTime = String(metadata.eventStartTime);
    try {
      const date = new Date(startTime);
      if (!isNaN(date.getTime())) {
        return {
          startTime: date.toISOString(),
          startBucket: generateTimeBucket(date),
          source: 'market',
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
          source: 'market',
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
      source: 'closeTime',
    };
  }

  return { startTime: null, startBucket: null, source: 'none' };
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

  // Kalshi eventTicker - also check the market field
  if (market.kalshiEventTicker) {
    return market.kalshiEventTicker;
  }

  if (metadata?.eventTicker) {
    return String(metadata.eventTicker);
  }

  // Kalshi seriesTicker
  if (metadata?.seriesTicker) {
    return String(metadata.seriesTicker);
  }

  return null;
}

interface TeamExtractionResult {
  teamA: string;
  teamB: string;
  teamA_norm: string;
  teamB_norm: string;
  source: 'market' | 'event' | 'none';
}

/**
 * Extract teams from event data or market title
 * Priority: event.title > market.title
 *
 * Event titles typically contain clean team names like "Lakers vs Celtics"
 * Market titles may be parlays/props like "Lakers + Celtics OVER 220.5"
 */
function extractTeamsWithSource(market: EligibleMarket, eventData?: SportsEventData): TeamExtractionResult {
  // v3.0.12: Try event title first (cleaner for Kalshi)
  if (eventData?.title) {
    const { teamA, teamB } = extractTeams(eventData.title);
    if (teamA && teamB) {
      return {
        teamA,
        teamB,
        teamA_norm: normalizeTeamName(teamA),
        teamB_norm: normalizeTeamName(teamB),
        source: 'event',
      };
    }
    // Also try subtitle (might have team names)
    if (eventData.subTitle) {
      const subResult = extractTeams(eventData.subTitle);
      if (subResult.teamA && subResult.teamB) {
        return {
          teamA: subResult.teamA,
          teamB: subResult.teamB,
          teamA_norm: normalizeTeamName(subResult.teamA),
          teamB_norm: normalizeTeamName(subResult.teamB),
          source: 'event',
        };
      }
    }
  }

  // Fall back to market title
  const { teamA, teamB } = extractTeams(market.title);
  if (teamA && teamB) {
    return {
      teamA,
      teamB,
      teamA_norm: normalizeTeamName(teamA),
      teamB_norm: normalizeTeamName(teamB),
      source: 'market',
    };
  }

  return {
    teamA: '',
    teamB: '',
    teamA_norm: '',
    teamB_norm: '',
    source: 'none',
  };
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
 * Main extraction function (v3.0.12: event-first extraction)
 *
 * @param market The market to extract signals from
 * @param eventData Optional Kalshi event data for enrichment
 */
export function extractSportsSignals(market: EligibleMarket, eventData?: SportsEventData): SportsSignals {
  const title = market.title;
  const rawTitle = title;

  // Check for exclusions first
  const exclusion = shouldExcludeMarket(title);

  // v3.0.12: Extract teams from event data or market title
  const teamsResult = extractTeamsWithSource(market, eventData);
  const { teamA_norm, teamB_norm, source: teamsSource } = teamsResult;

  // v3.0.12: Extract start time from event or market
  const { startTime, startBucket, source: startTimeSource } = extractStartTime(market, eventData);

  // Extract basic signals from market title
  // Use event title for league detection if available
  const textForLeague = eventData?.title || title;
  const league = detectLeague(textForLeague);
  const marketType = detectMarketType(title);
  const period = detectPeriod(title);
  const lineValue = extractLineValue(title, marketType);
  const side = extractSide(title);
  const venueEventId = extractVenueEventId(market);
  const titleTokens = extractTitleTokens(title);

  // Build event key with source tracking
  const eventKey: SportsEventKey = {
    league,
    teamA_norm,
    teamB_norm,
    startTime,
    startBucket,
    venueEventId,
    teamsSource,
    startTimeSource,
  };

  // Build line info
  const line: SportsLine = {
    marketType,
    lineValue,
    side,
    period,
  };

  // Build quality flags (v3.0.12: relaxed - missing teams/time OK if from event)
  const hasTeams = teamA_norm !== '' && teamB_norm !== '';
  const hasStartTime = startBucket !== null;

  const quality: SportsSignalQuality = {
    missingTeams: !hasTeams,
    missingStartTime: !hasStartTime,
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
  if (hasTeams && hasStartTime && league !== SportsLeague.UNKNOWN) {
    eventKeyString = generateEventKey(league, teamA_norm, teamB_norm, startBucket);
  }

  // Calculate confidence (v3.0.12: boost for event-sourced data)
  let confidence = 1.0;
  if (quality.missingTeams) confidence -= 0.4;
  if (quality.missingStartTime) confidence -= 0.2;
  if (quality.unknownLeague) confidence -= 0.15;
  if (quality.unknownMarketType) confidence -= 0.1;
  if (quality.notFullGame) confidence -= 0.1;
  if (quality.isExcluded) confidence = 0;

  // Slight boost for event-sourced data (more reliable)
  if (teamsSource === 'event') confidence += 0.05;
  if (startTimeSource === 'event') confidence += 0.05;

  confidence = Math.min(1.0, Math.max(0, confidence));

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
 * Check if a market is eligible for SPORTS matching (v2 relaxed scope)
 *
 * v3.0.12 CHANGES:
 * - Now accepts teams from either market title OR event data
 * - Now accepts startTime from event strikeDate OR closeTime
 * - Keeps exclusion for props/futures/parlays
 * - Keeps FULL_GAME period requirement
 */
export function isEligibleSportsMarket(signals: SportsSignals): boolean {
  // Must have both teams (from any source)
  if (signals.quality.missingTeams) return false;

  // Must have start time (from any source, including closeTime fallback)
  if (signals.quality.missingStartTime) return false;

  // Must not be excluded (props, futures, parlays)
  if (signals.quality.isExcluded) return false;

  // Must be FULL_GAME period (keeps v1 restriction)
  if (signals.quality.notFullGame) return false;

  // Must be a supported market type (keeps v1 restriction)
  const supportedTypes = [SportsMarketType.MONEYLINE, SportsMarketType.SPREAD, SportsMarketType.TOTAL];
  if (!supportedTypes.includes(signals.line.marketType)) return false;

  // Must have known league (helps with indexing)
  if (signals.quality.unknownLeague) return false;

  return true;
}

/**
 * Check if a market is eligible using v2 relaxed rules
 * This version accepts closeTime as a valid time source
 */
export function isEligibleSportsMarketV2(signals: SportsSignals): boolean {
  // Must have both teams (from any source - event or market)
  const hasTeams = !signals.quality.missingTeams;
  if (!hasTeams) return false;

  // Must have start time from ANY source (event, market, or closeTime)
  const hasTime = signals.eventKey.startBucket !== null;
  if (!hasTime) return false;

  // Must not be excluded (props, futures, parlays)
  if (signals.quality.isExcluded) return false;

  // For v2, we relax the FULL_GAME requirement if teams come from event
  // (event-level matches are inherently game-level)
  const isEventSourced = signals.eventKey.teamsSource === 'event';
  if (!isEventSourced && signals.quality.notFullGame) return false;

  // Must be a supported market type
  const supportedTypes = [SportsMarketType.MONEYLINE, SportsMarketType.SPREAD, SportsMarketType.TOTAL, SportsMarketType.UNKNOWN];
  if (!supportedTypes.includes(signals.line.marketType)) return false;

  // Must have known league
  if (signals.quality.unknownLeague) return false;

  return true;
}

/**
 * Get exclusion reason for debugging
 */
export function getExclusionReason(signals: SportsSignals): string | null {
  if (signals.quality.isExcluded) return signals.quality.excludeReason;
  if (signals.quality.missingTeams) {
    return `Missing teams (source: ${signals.eventKey.teamsSource})`;
  }
  if (signals.quality.missingStartTime) {
    return `Missing start time (source: ${signals.eventKey.startTimeSource})`;
  }
  if (signals.quality.notFullGame) return `Period is ${signals.line.period}, not FULL_GAME`;
  if (signals.quality.unknownLeague) return 'Unknown league';

  const supportedTypes = [SportsMarketType.MONEYLINE, SportsMarketType.SPREAD, SportsMarketType.TOTAL];
  if (!supportedTypes.includes(signals.line.marketType)) {
    return `Market type ${signals.line.marketType} not supported`;
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

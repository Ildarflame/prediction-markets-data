/**
 * Entertainment Signals Extraction (v3.1.0)
 *
 * Extracts structured signals from entertainment markets.
 * Used for cross-venue matching of awards, movies, TV, and music markets.
 */

import { tokenizeForEntities } from '@data-module/core';
import type { EligibleMarket } from '@data-module/db';

/**
 * Award shows
 */
export enum AwardShow {
  OSCARS = 'OSCARS',
  GRAMMYS = 'GRAMMYS',
  EMMYS = 'EMMYS',
  GOLDEN_GLOBES = 'GOLDEN_GLOBES',
  TONYS = 'TONYS',
  BAFTAS = 'BAFTAS',
  MTVA = 'MTVA',  // MTV Awards
  UNKNOWN = 'UNKNOWN',
}

/**
 * Media types
 */
export enum MediaType {
  MOVIES = 'MOVIES',
  TV = 'TV',
  MUSIC = 'MUSIC',
  STREAMING = 'STREAMING',
  CELEBRITIES = 'CELEBRITIES',
  GAMING = 'GAMING',
  SOCIAL_MEDIA = 'SOCIAL_MEDIA',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Award show keywords
 */
export const AWARD_KEYWORDS: Record<AwardShow, string[]> = {
  [AwardShow.OSCARS]: [
    'oscar', 'oscars', 'academy award', 'academy awards',
    'best picture', 'best actor', 'best actress', 'best director',
    'best supporting actor', 'best supporting actress',
    'best animated', 'best documentary', 'best international',
  ],
  [AwardShow.GRAMMYS]: [
    'grammy', 'grammys', 'grammy award', 'grammy awards',
    'record of the year', 'album of the year', 'song of the year',
    'best new artist',
  ],
  [AwardShow.EMMYS]: [
    'emmy', 'emmys', 'emmy award', 'emmy awards',
    'outstanding drama', 'outstanding comedy', 'outstanding limited',
    'outstanding lead actor', 'outstanding lead actress',
  ],
  [AwardShow.GOLDEN_GLOBES]: [
    'golden globe', 'golden globes', 'golden globe award',
    'hfpa',
  ],
  [AwardShow.TONYS]: [
    'tony', 'tonys', 'tony award', 'tony awards',
    'best musical', 'best play',
  ],
  [AwardShow.BAFTAS]: [
    'bafta', 'baftas', 'bafta award', 'bafta awards',
    'british academy',
  ],
  [AwardShow.MTVA]: [
    'mtv award', 'mtv awards', 'vma', 'vmas',
    'video music award',
  ],
  [AwardShow.UNKNOWN]: [],
};

/**
 * Media type keywords
 */
export const MEDIA_TYPE_KEYWORDS: Record<MediaType, string[]> = {
  [MediaType.MOVIES]: [
    'movie', 'movies', 'film', 'films', 'cinema',
    'box office', 'opening weekend', 'theatrical', 'blockbuster',
    'director', 'actor', 'actress',
  ],
  [MediaType.TV]: [
    'tv', 'television', 'series', 'show', 'season', 'episode',
    'network', 'cable', 'miniseries', 'sitcom', 'drama series',
  ],
  [MediaType.MUSIC]: [
    'album', 'song', 'chart', 'billboard', 'spotify', 'apple music',
    'streams', 'streaming', 'single', 'artist', 'band', 'singer',
    'rapper', 'pop star', 'record', 'tour', 'concert',
  ],
  [MediaType.STREAMING]: [
    'netflix', 'disney+', 'disney plus', 'hbo', 'hbo max', 'max',
    'amazon prime', 'prime video', 'hulu', 'apple tv', 'peacock',
    'paramount+', 'paramount plus', 'subscribers',
  ],
  [MediaType.CELEBRITIES]: [
    'celebrity', 'celebrities', 'star', 'couple', 'dating', 'married',
    'divorce', 'engagement', 'baby', 'pregnant', 'relationship',
    'breakup', 'split',
  ],
  [MediaType.GAMING]: [
    'game', 'video game', 'gta', 'playstation', 'xbox', 'nintendo',
    'esports', 'twitch', 'gaming', 'release', 'launch',
  ],
  [MediaType.SOCIAL_MEDIA]: [
    'youtube', 'youtuber', 'tiktok', 'twitter', 'x.com',
    'instagram', 'influencer', 'followers', 'subscribers',
    'viral', 'mrbeast', 'pewdiepie', 'tweet', 'post',
  ],
  [MediaType.UNKNOWN]: [],
};

/**
 * Award categories for normalization
 */
export const AWARD_CATEGORIES: Record<string, string[]> = {
  'BEST_PICTURE': ['best picture', 'picture of the year', 'best film'],
  'BEST_ACTOR': ['best actor', 'lead actor', 'leading actor'],
  'BEST_ACTRESS': ['best actress', 'lead actress', 'leading actress'],
  'BEST_DIRECTOR': ['best director', 'directing'],
  'BEST_SUPPORTING_ACTOR': ['best supporting actor', 'supporting actor'],
  'BEST_SUPPORTING_ACTRESS': ['best supporting actress', 'supporting actress'],
  'BEST_ANIMATED': ['best animated', 'animated feature', 'animation'],
  'BEST_DOCUMENTARY': ['best documentary', 'documentary feature'],
  'BEST_INTERNATIONAL': ['best international', 'international feature', 'foreign film'],
  'ALBUM_OF_THE_YEAR': ['album of the year', 'aoty'],
  'RECORD_OF_THE_YEAR': ['record of the year', 'roty'],
  'SONG_OF_THE_YEAR': ['song of the year', 'soty'],
  'BEST_NEW_ARTIST': ['best new artist', 'new artist'],
  'BEST_DRAMA': ['outstanding drama', 'best drama', 'drama series'],
  'BEST_COMEDY': ['outstanding comedy', 'best comedy', 'comedy series'],
};

/**
 * Entertainment signals extracted from a market
 */
export interface EntertainmentSignals {
  /** Award show if applicable */
  awardShow: AwardShow;
  /** Media type */
  mediaType: MediaType;
  /** Year */
  year: number | null;
  /** Award category if applicable */
  category: string | null;
  /** Nominees/contenders mentioned */
  nominees: string[];
  /** Raw title tokens */
  titleTokens: string[];
  /** Confidence in extraction */
  confidence: number;
}

/**
 * Extract award show from title
 */
export function extractAwardShow(title: string): AwardShow {
  const lower = title.toLowerCase();

  for (const [awardShow, keywords] of Object.entries(AWARD_KEYWORDS)) {
    if (awardShow === AwardShow.UNKNOWN) continue;

    for (const keyword of keywords) {
      const pattern = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'i');
      if (pattern.test(lower)) {
        return awardShow as AwardShow;
      }
    }
  }

  return AwardShow.UNKNOWN;
}

/**
 * Extract media type from title
 */
export function extractMediaType(title: string): MediaType {
  const lower = title.toLowerCase();

  // Check for award shows first - they have specific media types
  const awardShow = extractAwardShow(title);
  if (awardShow === AwardShow.OSCARS || awardShow === AwardShow.GOLDEN_GLOBES || awardShow === AwardShow.BAFTAS) {
    return MediaType.MOVIES;
  }
  if (awardShow === AwardShow.GRAMMYS) {
    return MediaType.MUSIC;
  }
  if (awardShow === AwardShow.EMMYS) {
    return MediaType.TV;
  }

  // Check keywords in priority order
  const priority: MediaType[] = [
    MediaType.GAMING,       // Check specific types first
    MediaType.SOCIAL_MEDIA,
    MediaType.STREAMING,
    MediaType.MUSIC,
    MediaType.MOVIES,
    MediaType.TV,
    MediaType.CELEBRITIES,
  ];

  for (const mediaType of priority) {
    const keywords = MEDIA_TYPE_KEYWORDS[mediaType];
    for (const keyword of keywords) {
      const pattern = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'i');
      if (pattern.test(lower)) {
        return mediaType;
      }
    }
  }

  return MediaType.UNKNOWN;
}

/**
 * Extract year from title
 */
export function extractYear(title: string, closeTime?: Date | null): number | null {
  // Look for explicit year in context of awards (e.g., "2026 Oscars", "Oscars 2026")
  const yearMatch = title.match(/\b(202[4-9]|203[0-9])\b/);
  if (yearMatch) {
    return parseInt(yearMatch[1], 10);
  }

  // Derive from closeTime
  if (closeTime) {
    return closeTime.getFullYear();
  }

  return null;
}

/**
 * Extract award category from title
 */
export function extractCategory(title: string): string | null {
  const lower = title.toLowerCase();

  for (const [category, aliases] of Object.entries(AWARD_CATEGORIES)) {
    for (const alias of aliases) {
      const pattern = new RegExp(`\\b${alias.replace(/\s+/g, '\\s+')}\\b`, 'i');
      if (pattern.test(lower)) {
        return category;
      }
    }
  }

  return null;
}

/**
 * Extract nominees/contenders from title
 * This is a simple extraction - looks for quoted strings or capitalized words
 */
export function extractNominees(title: string): string[] {
  const nominees: string[] = [];

  // Extract quoted strings
  const quotedMatches = title.match(/"([^"]+)"|'([^']+)'/g);
  if (quotedMatches) {
    for (const match of quotedMatches) {
      const cleaned = match.replace(/['"]/g, '').trim();
      if (cleaned.length > 2 && !nominees.includes(cleaned.toLowerCase())) {
        nominees.push(cleaned.toLowerCase());
      }
    }
  }

  // Look for movie/album titles (capitalized multi-word phrases)
  // This is a heuristic - may need refinement
  const titlePattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
  let match;
  while ((match = titlePattern.exec(title)) !== null) {
    const candidate = match[1].toLowerCase();
    // Skip common non-title phrases
    const skipPhrases = ['best picture', 'album of', 'song of', 'record of', 'academy award', 'golden globe'];
    if (!skipPhrases.some(p => candidate.includes(p)) && !nominees.includes(candidate)) {
      nominees.push(candidate);
    }
  }

  return nominees;
}

/**
 * Extract all entertainment signals from a market
 */
export function extractEntertainmentSignals(market: EligibleMarket): EntertainmentSignals {
  const title = market.title;
  const closeTime = market.closeTime;

  const awardShow = extractAwardShow(title);
  const mediaType = extractMediaType(title);
  const year = extractYear(title, closeTime);
  const category = extractCategory(title);
  const nominees = extractNominees(title);
  const titleTokens = tokenizeForEntities(title);

  // Calculate confidence
  let confidence = 0;
  if (awardShow !== AwardShow.UNKNOWN) confidence += 0.30;
  if (mediaType !== MediaType.UNKNOWN) confidence += 0.25;
  if (year !== null) confidence += 0.15;
  if (category !== null) confidence += 0.20;
  if (nominees.length > 0) confidence += 0.10;

  return {
    awardShow,
    mediaType,
    year,
    category,
    nominees,
    titleTokens,
    confidence,
  };
}

/**
 * Check if a market is likely an entertainment market
 */
export function isEntertainmentMarket(title: string): boolean {
  const lower = title.toLowerCase();

  // Must have entertainment-related keywords
  const entertainmentKeywords = [
    'oscar', 'grammy', 'emmy', 'golden globe', 'tony', 'bafta',
    'best picture', 'best actor', 'best actress', 'album of the year',
    'box office', 'opening weekend', 'movie', 'film',
    'netflix', 'disney', 'hbo', 'streaming',
    'youtube', 'tiktok', 'mrbeast', 'spotify', 'billboard',
    'celebrity', 'award', 'nominated', 'win', 'gta',
  ];

  return entertainmentKeywords.some(kw => lower.includes(kw));
}

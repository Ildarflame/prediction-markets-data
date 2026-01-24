export * from './types.js';
export * from './utils.js';
export * from './config.js';
export * from './matching.js';
export * from './aliases.js';
export * from './extractor.js';
export * from './taxonomy/index.js';
export * from './sports/index.js';

// Universal Extractor - export with explicit names to avoid conflicts
export {
  // Main function
  extractUniversalEntities,
  // Types
  UniversalComparator,
  GameType,
  UniversalMarketType,
  type NumberEntity,
  type ExtractedDateUniversal,
  type UniversalEntities,
  // Extraction functions (with Universal prefix)
  extractUniversalTeams,
  extractUniversalPeople,
  extractUniversalOrganizations,
  extractUniversalNumbers,
  extractUniversalDates,
  extractUniversalComparator,
  extractEsportsTeams,
  extractPoliticians,
  // Detection functions
  detectUniversalGameType,
  detectUniversalMarketType,
  // Utilities
  normalizeUniversalTitle,
  tokenizeUniversal,
  jaccardSets,
  countEntityOverlap,
  countEntityOverlapDetailed,
  type EntityOverlapResult,
} from './universalExtractor.js';

// Alias exports
export * from './aliases/index.js';

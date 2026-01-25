/**
 * Signals Index (v3.1.0)
 *
 * Exports all signal extraction modules.
 *
 * v3.1.0: Added geopolitics and entertainment signals
 */

// Rates signals
export {
  CentralBank,
  RateAction,
  CENTRAL_BANK_KEYWORDS,
  RATE_ACTION_KEYWORDS,
  FOMC_MEETING_MONTHS_2024_2026,
  type RatesSignals,
  extractCentralBank,
  extractRateAction,
  extractBasisPoints,
  extractMeetingDate,
  extractMeetingMonth,
  extractTargetRate,
  extractYear,
  extractActionCount,
  extractRatesSignals,
  isRatesMarket,
} from './ratesSignals.js';

// Elections signals
export {
  ElectionCountry,
  ElectionOffice,
  ElectionIntent,
  COUNTRY_KEYWORDS,
  OFFICE_KEYWORDS,
  INTENT_KEYWORDS,
  CANDIDATES,
  US_STATES,
  type ElectionsSignals,
  extractCountry,
  extractOffice,
  extractIntent,
  extractElectionYear,
  extractState,
  extractCandidates,
  extractParty,
  extractElectionsSignals,
  isElectionsMarket,
} from './electionsSignals.js';

// Climate signals (v3.0.10)
export {
  ClimateKind,
  ClimateDateType,
  ClimateComparator,
  CLIMATE_KEYWORDS,
  type ClimateSignals,
  extractClimateKind,
  extractRegion,
  extractDateInfo,
  extractThresholds,
  extractComparator,
  extractClimateSignals,
  isClimateMarket,
  areDateTypesCompatible,
  calculateDateScore,
  calculateThresholdScore,
} from './climateSignals.js';

// Sports signals (v3.0.11)
export {
  type SportsEventKey,
  type SportsLine,
  type SportsSignalQuality,
  type SportsSignals,
  extractSportsSignals,
  isEligibleSportsMarket,
  getExclusionReason,
  SPORTS_KEYWORDS,
} from './sportsSignals.js';

// Geopolitics signals (v3.1.0)
export {
  GeopoliticsRegion,
  GeopoliticsEventType,
  REGION_KEYWORDS,
  EVENT_TYPE_KEYWORDS,
  ACTORS,
  COUNTRIES,
  type GeopoliticsSignals,
  extractRegion as extractGeopoliticsRegion,
  extractAllRegions,
  extractEventType,
  extractCountries as extractGeopoliticsCountries,
  extractActors,
  extractYear as extractGeopoliticsYear,
  extractDeadline,
  extractGeopoliticsSignals,
  isGeopoliticsMarket,
} from './geopoliticsSignals.js';

// Entertainment signals (v3.1.0)
export {
  AwardShow,
  MediaType,
  AWARD_KEYWORDS,
  MEDIA_TYPE_KEYWORDS,
  AWARD_CATEGORIES,
  type EntertainmentSignals,
  extractAwardShow,
  extractMediaType,
  extractYear as extractEntertainmentYear,
  extractCategory as extractAwardCategory,
  extractNominees,
  extractEntertainmentSignals,
  isEntertainmentMarket,
} from './entertainmentSignals.js';

// Finance signals (v3.1.0)
export {
  FinanceAssetClass,
  FinanceDirection,
  INDICES,
  FOREX_PAIRS,
  BONDS,
  DIRECTION_KEYWORDS as FINANCE_DIRECTION_KEYWORDS,
  type FinanceSignals,
  extractAssetClass,
  extractInstrument,
  extractDirection as extractFinanceDirection,
  extractTargetValue,
  extractRange,
  extractDate as extractFinanceDate,
  extractTimeframe,
  extractFinanceSignals,
  isFinanceMarket,
} from './financeSignals.js';

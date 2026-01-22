/**
 * Signals Index (v3.0.0)
 *
 * Exports all signal extraction modules.
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

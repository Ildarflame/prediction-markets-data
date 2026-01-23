export { getClient, disconnect, PrismaClient, Prisma } from './client.js';
export * from './repositories/index.js';
export * from './utils/chunked-processor.js';

// Re-export Prisma types
export type {
  Market,
  Outcome,
  Quote,
  LatestQuote,
  IngestionState,
  IngestionRun,
  MarketLink,
  QuoteWatchlist,
  KalshiEvent,
  Venue,
  MarketStatus,
  OutcomeSide,
  LinkStatus,
} from '@prisma/client';

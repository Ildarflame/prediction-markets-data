export { getClient, disconnect, PrismaClient, Prisma } from './client.js';
export * from './repositories/index.js';

// Re-export Prisma types
export type {
  Market,
  Outcome,
  Quote,
  LatestQuote,
  IngestionState,
  IngestionRun,
  MarketLink,
  Venue,
  MarketStatus,
  OutcomeSide,
  LinkStatus,
} from '@prisma/client';

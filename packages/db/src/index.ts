export { getClient, disconnect, PrismaClient, type Prisma } from './client.js';
export * from './repositories/index.js';

// Re-export Prisma types
export type {
  Market,
  Outcome,
  Quote,
  LatestQuote,
  IngestionState,
  IngestionRun,
  Venue,
  MarketStatus,
  OutcomeSide,
} from '@prisma/client';

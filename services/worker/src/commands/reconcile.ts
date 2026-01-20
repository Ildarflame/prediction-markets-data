import type { Venue, MarketDTO } from '@data-module/core';
import {
  getClient,
  MarketRepository,
  type Venue as DbVenue,
} from '@data-module/db';
import { createAdapter } from '../adapters/index.js';

export interface ReconcileOptions {
  venue: Venue;
  pageSize?: number;
  maxMarkets?: number;
}

export interface ReconcileResult {
  totalSource: number;
  totalDb: number;
  missing: number;
  added: number;
  errors: string[];
}

/**
 * Reconcile markets from source with database
 * Finds missing markets and adds them
 *
 * NOTES:
 * - Polymarket: Gamma API provides full list without auth, good coverage
 * - Kalshi: Public API provides full list, good coverage
 * - For 100% coverage of closed/resolved markets, may need historical data export
 */
export async function runReconcile(options: ReconcileOptions): Promise<ReconcileResult> {
  const { venue, pageSize = 100, maxMarkets = 50000 } = options;

  const prisma = getClient();
  const marketRepo = new MarketRepository(prisma);
  const adapter = createAdapter(venue, { config: { pageSize } });

  const result: ReconcileResult = {
    totalSource: 0,
    totalDb: 0,
    missing: 0,
    added: 0,
    errors: [],
  };

  console.log(`[${venue}] Starting reconciliation...`);

  try {
    // Fetch all market external IDs from source
    console.log(`[${venue}] Fetching markets from source...`);
    const sourceMarkets: MarketDTO[] = [];
    let cursor: string | undefined;
    let fetched = 0;

    while (fetched < maxMarkets) {
      const fetchResult = await adapter.fetchMarkets({ cursor, limit: pageSize });
      sourceMarkets.push(...fetchResult.items);
      fetched += fetchResult.items.length;

      console.log(`[${venue}] Fetched ${fetched} markets from source...`);

      if (!fetchResult.nextCursor) break;
      cursor = fetchResult.nextCursor;

      // Rate limit
      await new Promise((r) => setTimeout(r, 100));
    }

    result.totalSource = sourceMarkets.length;
    const sourceIds = new Set(sourceMarkets.map((m) => m.externalId));

    // Get all market external IDs from database
    console.log(`[${venue}] Fetching markets from database...`);
    const dbMarkets = await prisma.market.findMany({
      where: { venue: venue as DbVenue },
      select: { externalId: true },
    });

    result.totalDb = dbMarkets.length;
    const dbIds = new Set(dbMarkets.map((m) => m.externalId));

    // Find missing markets
    const missingMarkets = sourceMarkets.filter((m) => !dbIds.has(m.externalId));
    result.missing = missingMarkets.length;

    console.log(`[${venue}] Found ${result.missing} missing markets`);

    if (missingMarkets.length > 0) {
      // Add missing markets
      console.log(`[${venue}] Adding missing markets...`);
      const upsertResult = await marketRepo.upsertMarkets(venue as DbVenue, missingMarkets);
      result.added = upsertResult.created;
      console.log(`[${venue}] Added ${result.added} markets`);
    }

    // Check for markets in DB that are not in source (may be deleted/hidden)
    const extraInDb = dbMarkets.filter((m) => !sourceIds.has(m.externalId));
    if (extraInDb.length > 0) {
      console.log(`[${venue}] Note: ${extraInDb.length} markets in DB not found in source (may be deleted/hidden)`);
    }

    console.log(`\n[${venue}] Reconciliation complete:`);
    console.log(`  Source markets: ${result.totalSource}`);
    console.log(`  DB markets: ${result.totalDb}`);
    console.log(`  Missing (added): ${result.added}`);
    console.log(`  Extra in DB: ${extraInDb.length}`);

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errors.push(errorMsg);
    console.error(`[${venue}] Reconciliation failed: ${errorMsg}`);
  }

  return result;
}

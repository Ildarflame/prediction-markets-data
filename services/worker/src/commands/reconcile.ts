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
  dryRun?: boolean;
}

export interface ReconcileResult {
  totalSource: number;
  totalDb: number;
  missing: number;
  added: number;
  outcomesAdded: number;
  extraInDb: number;
  missingIds: string[];
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
  const { venue, pageSize = 100, maxMarkets = 50000, dryRun = false } = options;

  const prisma = getClient();
  const marketRepo = new MarketRepository(prisma);
  const adapter = createAdapter(venue, { config: { pageSize } });

  const result: ReconcileResult = {
    totalSource: 0,
    totalDb: 0,
    missing: 0,
    added: 0,
    outcomesAdded: 0,
    extraInDb: 0,
    missingIds: [],
    errors: [],
  };

  console.log(`[${venue}] Starting reconciliation${dryRun ? ' (DRY RUN)' : ''}...`);

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
    result.missingIds = missingMarkets.slice(0, 20).map((m) => m.externalId);

    // Check for markets in DB that are not in source
    const extraInDbMarkets = dbMarkets.filter((m) => !sourceIds.has(m.externalId));
    result.extraInDb = extraInDbMarkets.length;

    console.log(`[${venue}] Found ${result.missing} missing markets`);

    if (dryRun) {
      // Dry run: just output info
      console.log(`\n[${venue}] DRY RUN - No changes made`);
      console.log(`  Source markets: ${result.totalSource}`);
      console.log(`  DB markets: ${result.totalDb}`);
      console.log(`  Missing: ${result.missing}`);
      console.log(`  Extra in DB: ${result.extraInDb}`);

      if (result.missingIds.length > 0) {
        console.log(`\n  Missing market IDs (first ${result.missingIds.length}):`);
        for (const id of result.missingIds) {
          console.log(`    - ${id}`);
        }
      }
    } else if (missingMarkets.length > 0) {
      // Normal run: add missing markets
      console.log(`[${venue}] Adding ${missingMarkets.length} missing markets...`);

      // Calculate total outcomes to be added
      const totalOutcomes = missingMarkets.reduce((sum, m) => sum + m.outcomes.length, 0);

      const upsertResult = await marketRepo.upsertMarkets(venue as DbVenue, missingMarkets);
      result.added = upsertResult.created;
      result.outcomesAdded = totalOutcomes;

      console.log(`[${venue}] Added ${result.added} markets with ${result.outcomesAdded} outcomes`);
    }

    if (!dryRun) {
      console.log(`\n[${venue}] Reconciliation complete:`);
      console.log(`  Source markets: ${result.totalSource}`);
      console.log(`  DB markets: ${result.totalDb}`);
      console.log(`  Missing: ${result.missing}`);
      console.log(`  Added: ${result.added} markets, ${result.outcomesAdded} outcomes`);
      console.log(`  Extra in DB: ${result.extraInDb}`);
    }

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errors.push(errorMsg);
    console.error(`[${venue}] Reconciliation failed: ${errorMsg}`);
  }

  return result;
}
